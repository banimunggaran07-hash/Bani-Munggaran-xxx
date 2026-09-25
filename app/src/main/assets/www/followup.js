/*
 * Bahan follow up marketing.
 * Supervisor mengunggah Excel -> server membagi ke tiap marketing -> tersinkron ke HP marketing.
 * Marketing memperbarui status/catatan; perubahan dikirim lewat antrean sinkronisasi (offline-first).
 */
(function (root) {
  'use strict';
  var META = 'calculatorotr.fu.meta', OVER = 'calculatorotr.fu.over', DB = 'calculatorotr-followup';
  var STATUS = [['baru', 'Baru'], ['dihubungi', 'Dihubungi'], ['janji', 'Janji'], ['berhasil', 'Berhasil'], ['tidak', 'Tidak berminat']];
  var rows = new Map(), over = {}, meta = { seq: 0, uid: null }, loaded = false, busy = null, listeners = [], lastErr = '';
  var S = function () { return root.OTRSync; };
  var ls = function () { return root.localStorage; };
  function jget(k, d) { try { var v = JSON.parse(ls().getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function jset(k, v) { try { ls().setItem(k, JSON.stringify(v)); } catch (e) {} }
  function emit() { listeners.forEach(function (f) { try { f(); } catch (e) {} }); }

  /* penyimpanan baris: IndexedDB (data bisa ribuan baris); cadangan localStorage */
  function idb() {
    return new Promise(function (res, rej) {
      if (!root.indexedDB) return rej(new Error('no idb'));
      var q = root.indexedDB.open(DB, 1);
      q.onupgradeneeded = function () { q.result.createObjectStore('kv'); };
      q.onsuccess = function () { res(q.result); };
      q.onerror = function () { rej(q.error); };
    });
  }
  function kv(mode, fn) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction('kv', mode), rq = fn(tx.objectStore('kv'));
        tx.oncomplete = function () { res(rq && rq.result); db.close(); };
        tx.onerror = tx.onabort = function () { rej(tx.error); };
      });
    });
  }
  function persistRows() {
    var arr = Array.from(rows.values());
    return kv('readwrite', function (s) { return s.put(arr, 'rows'); }).catch(function () { jset(DB, arr); });
  }
  function loadRows() {
    return kv('readonly', function (s) { return s.get('rows'); }).catch(function () { return jget(DB, []); }).then(function (a) { return a || []; });
  }

  function init() {
    var u = S() && S().user();
    if (!u || u.role !== 'marketing') { rows = new Map(); loaded = true; return Promise.resolve(); }
    meta = jget(META, { seq: 0, uid: null }); over = jget(OVER, {});
    if (meta.uid !== u.id) { meta = { seq: 0, uid: u.id }; over = {}; rows = new Map(); jset(META, meta); jset(OVER, over); return kv('readwrite', function (s) { return s.delete('rows'); }).catch(function () {}).then(function () { loaded = true; emit(); }); }
    return loadRows().then(function (a) { rows = new Map(a.map(function (r) { return [r.fid, r]; })); loaded = true; emit(); });
  }

  function view(r) {
    var o = over[r.fid];
    return o ? Object.assign({}, r, { status: o.status, note: o.note, statusAt: o.ts, pending: true }) : r;
  }
  function all() { return Array.from(rows.values()).map(view); }
  function get(fid) { var r = rows.get(fid); return r ? view(r) : null; }

  function pull() {
    var u = S() && S().user();
    if (!u || u.role !== 'marketing' || !S().enabled()) return Promise.resolve(false);
    if (busy) return busy;
    busy = (function loop() {
      return S().api('GET', '/api/followup?since=' + meta.seq, null, 30000).then(function (b) {
        (b.rows || []).forEach(function (r) {
          if (r.archived) rows.delete(r.fid); else rows.set(r.fid, r);
          var o = over[r.fid];
          if (o && r.statusAt && r.statusAt >= o.ts) delete over[r.fid];
        });
        meta.seq = b.seq || meta.seq; meta.uid = u.id;
        return b.more ? loop() : true;
      });
    })().then(function (ok) { lastErr = ''; jset(META, meta); jset(OVER, over); return persistRows().then(function () { return ok; }); },
      function (e) { lastErr = e.message; return false; })
      .then(function (ok) { busy = null; emit(); return ok; });
    return busy;
  }

  function setStatus(fid, status, note) {
    if (!rows.has(fid) || !STATUS.some(function (s) { return s[0] === status; })) return false;
    var ts = new Date().toISOString();
    over[fid] = { status: status, note: String(note || '').slice(0, 300), ts: ts };
    jset(OVER, over);
    S().log('followup', { fid: fid, status: status, note: over[fid].note }, ts);
    emit(); return true;
  }

  function counts() {
    var c = { total: 0, baru: 0, dihubungi: 0, janji: 0, berhasil: 0, tidak: 0 };
    all().forEach(function (r) { c.total++; c[r.status] = (c[r.status] || 0) + 1; });
    return c;
  }
  function reset() { rows = new Map(); over = {}; meta = { seq: 0, uid: null }; jset(META, meta); jset(OVER, over); kv('readwrite', function (s) { return s.delete('rows'); }).catch(function () {}); emit(); }

  /* ---- sisi supervisor ---- */
  // Unggah bertahap (1.500 baris per permintaan) supaya file besar (puluhan ribu baris) aman. Aman diulang: baris dicocokkan per nomor kontrak.
  function upload(name, list, replace, onProgress) {
    var batch = 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), CH = 1500, total = list.length;
    var agg = { batch: batch, total: 0, assigned: 0, unassigned: 0, created: 0, updated: 0, unchanged: 0, archived: 0 }, per = {}, miss = {};
    function send(off, tryNo) {
      var last = off + CH >= total;
      return S().api('POST', '/api/followup/upload', { name: name, replace: replace !== false, rows: list.slice(off, off + CH), batch: batch, offset: off, last: last }, 120000)
        .catch(function (e) { if (tryNo < 2 && /terhubung/.test(e.message)) return send(off, tryNo + 1); throw e; });
    }
    function step(off) {
      return send(off, 0).then(function (r) {
        ['total', 'assigned', 'unassigned', 'created', 'updated', 'unchanged', 'archived'].forEach(function (k) { agg[k] += r[k] || 0; });
        (r.perMarketing || []).forEach(function (m) { per[m.id] = per[m.id] || { id: m.id, name: m.name, count: 0 }; per[m.id].count += m.count; });
        (r.unmatched || []).forEach(function (m) { miss[m.value] = (miss[m.value] || 0) + m.count; });
        if (onProgress) onProgress(Math.min(off + CH, total), total);
        return off + CH >= total ? finish() : step(off + CH);
      });
    }
    function finish() {
      agg.perMarketing = Object.keys(per).map(function (k) { return per[k]; });
      agg.unmatched = Object.keys(miss).map(function (k) { return { value: k, count: miss[k] }; }).sort(function (a, b) { return b.count - a.count; }).slice(0, 30);
      return agg;
    }
    return step(0);
  }
  function summary() { return S().api('GET', '/api/followup/summary'); }

  if (root.OTRSync) root.OTRSync.onSynced(function () { pull(); });
  root.OTRFollowup = { STATUS: STATUS, init: init, pull: pull, all: all, get: get, setStatus: setStatus, counts: counts, reset: reset,
    upload: upload, summary: summary, on: function (f) { listeners.push(f); }, error: function () { return lastErr; }, ready: function () { return loaded; } };
})(typeof window !== 'undefined' ? window : globalThis);
