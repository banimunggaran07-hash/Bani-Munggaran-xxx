/*
 * Login + antrean sinkronisasi ke server (offline-first).
 * Data hasil kerja disimpan dulu di HP, lalu dikirim otomatis saat ada internet.
 * Yang dikirim dari HP marketing hanya ringkasan hitungan dan status/catatan follow up (bukan data nasabah).
 */
(function (root) {
  'use strict';
  var AUTH = 'calculatorotr.auth', QUEUE = 'calculatorotr.queue', META = 'calculatorotr.syncmeta';
  var MAX_QUEUE = 2000, BATCH = 100;
  var ls = function () { return root.localStorage; };
  var listeners = [], hooks = [], running = null, timer = null, lastError = '';

  function cfg() { return (root.APP && root.APP.apiBase || '').replace(/\/+$/, ''); }
  function read(k, d) { try { var v = JSON.parse(ls().getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function write(k, v) { try { ls().setItem(k, JSON.stringify(v)); } catch (e) {} }
  function emit() { listeners.forEach(function (f) { try { f(); } catch (e) {} }); }
  function uuid() {
    var c = root.crypto;
    if (c && c.randomUUID) return c.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (ch) {
      var r = Math.random() * 16 | 0; return (ch === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }

  function enabled() { return !!cfg(); }
  function user() { var a = read(AUTH, null); return a && a.token ? a.user : null; }
  function token() { var a = read(AUTH, null); return a && a.token || null; }
  function meta() { return read(META, { last: null, auto: true }); }
  function setMeta(p) { var m = meta(); Object.keys(p).forEach(function (k) { m[k] = p[k]; }); write(META, m); }

  function request(method, path, payload, tok, ms) {
    var ctl = root.AbortController ? new root.AbortController() : null;
    var to = setTimeout(function () { if (ctl) ctl.abort(); }, ms || 15000);
    var h = { 'Content-Type': 'application/json' };
    if (tok) h.Authorization = 'Bearer ' + tok;
    return root.fetch(cfg() + path, { method: method, headers: h, body: payload ? JSON.stringify(payload) : undefined, signal: ctl ? ctl.signal : undefined })
      .then(function (r) {
        clearTimeout(to);
        return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j }; });
      }, function (e) { clearTimeout(to); throw e; });
  }

  function login(email, pw) {
    if (!enabled()) return Promise.reject(new Error('Server belum diatur.'));
    return request('POST', '/api/login', { email: email, password: pw }).then(function (r) {
      if (r.status === 200 && r.body.token) {
        var prev = user();
        if (prev && prev.id !== r.body.user.id) write(QUEUE, read(QUEUE, []).filter(function (e) { return e.u === r.body.user.id; }));
        write(AUTH, { token: r.body.token, user: r.body.user, at: new Date().toISOString() });
        emit(); schedule(500);
        return r.body.user;
      }
      throw new Error(r.body.error || 'Gagal masuk (kode ' + r.status + ').');
    }, function () { throw new Error('Tidak bisa terhubung ke server. Periksa internet Anda.'); });
  }

  function own() { var u = user(); return u ? read(QUEUE, []).filter(function (e) { return e.u === u.id; }) : []; }
  function pending() { return own().length; }
  function list() { return own().slice().reverse(); }

  function logout() {
    var u = user();
    if (u) write(QUEUE, read(QUEUE, []).filter(function (e) { return e.u !== u.id; }));
    try { ls().removeItem(AUTH); } catch (e) {}
    emit();
  }

  function log(type, data, ts) {
    var u = user(); if (!enabled() || !u) return;
    var q = read(QUEUE, []);
    q.push({ id: uuid(), u: u.id, type: type, ts: ts || new Date().toISOString(), data: data });
    if (q.length > MAX_QUEUE) q = q.slice(q.length - MAX_QUEUE);
    write(QUEUE, q); emit();
    if (meta().auto) schedule(2500);
  }

  function schedule(ms) { clearTimeout(timer); timer = setTimeout(function () { flush(); }, ms); }

  function flush() {
    if (!enabled() || !token()) return Promise.resolve(false);
    if (running) return running;
    if (root.navigator && root.navigator.onLine === false) { lastError = 'Tidak ada internet.'; emit(); return Promise.resolve(false); }
    var u = user();
    running = (function loop() {
      var batch = own().slice(0, BATCH);
      if (!batch.length) { setMeta({ last: new Date().toISOString() }); lastError = ''; return Promise.resolve(true); }
      var events = batch.map(function (e) { return { id: e.id, type: e.type, ts: e.ts, data: e.data }; });
      return request('POST', '/api/events', { events: events }, token()).then(function (r) {
        if (r.status === 401) { try { ls().removeItem(AUTH); } catch (e) {} lastError = 'Sesi berakhir.'; emit(); return false; }
        if (r.status !== 200) { lastError = 'Server sibuk (kode ' + r.status + ').'; return false; }
        var done = {}; (r.body.accepted || []).concat(r.body.rejected || []).forEach(function (id) { done[id] = 1; });
        write(QUEUE, read(QUEUE, []).filter(function (e) { return !(e.u === u.id && done[e.id]); }));
        emit();
        return (r.body.accepted || []).length ? loop() : false;
      });
    })().catch(function () { lastError = 'Tidak bisa terhubung ke server.'; return false; })
      .then(function (ok) {
        running = null; emit();
        if (!ok && pending() && meta().auto && token()) schedule(60000);
        if (ok) hooks.forEach(function (f) { try { f(); } catch (e) {} });
        return ok;
      });
    return running;
  }

  function on(fn) { listeners.push(fn); }
  function onSynced(fn) { hooks.push(fn); }

  // Panggilan API umum dengan token. Melempar Error berisi pesan yang siap ditampilkan.
  function api(method, path, payload, ms) {
    var t = token();
    if (!t) return Promise.reject(new Error('Belum masuk.'));
    return request(method, path, payload, t, ms).then(function (r) {
      if (r.status === 401) { try { ls().removeItem(AUTH); } catch (e) {} emit(); throw new Error('Sesi berakhir. Silakan masuk lagi.'); }
      if (r.status >= 400) throw new Error(r.body.error || 'Gagal (kode ' + r.status + ').');
      return r.body;
    }, function () { throw new Error('Tidak bisa terhubung ke server. Periksa internet Anda.'); });
  }
  function state() {
    return { enabled: enabled(), user: user(), pending: pending(), last: meta().last, auto: !!meta().auto, error: lastError,
      busy: !!running, online: !(root.navigator && root.navigator.onLine === false) };
  }
  function setAuto(v) { setMeta({ auto: !!v }); emit(); if (v) schedule(500); }

  if (root.addEventListener) {
    root.addEventListener('online', function () { if (meta().auto) schedule(800); });
    if (root.document) root.document.addEventListener('visibilitychange', function () {
      if (!root.document.hidden && meta().auto) schedule(800);
    });
    setInterval(function () { if (meta().auto && pending()) flush(); }, 5 * 60 * 1000);
    setTimeout(function () { if (meta().auto) flush(); }, 1500);
  }

  root.OTRSync = { enabled: enabled, user: user, login: login, logout: logout, log: log, flush: flush, pending: pending,
    list: list, on: on, onSynced: onSynced, api: api, state: state, setAuto: setAuto };
})(typeof window !== 'undefined' ? window : globalThis);
