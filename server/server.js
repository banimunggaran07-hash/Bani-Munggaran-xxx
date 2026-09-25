'use strict';
/*
 * Server referensi Calculator OTR (login + terima data sinkronisasi).
 * Tanpa dependensi, Node 18+.  Jalankan:  node server.js
 * Tambah akun:  node server.js adduser <id> <email> "<Nama>" <marketing|supervisor|admin> "<Tim>" <password>
 * PENTING: untuk produksi letakkan di belakang HTTPS (reverse proxy) dan pindahkan
 * penyimpanan ke database sungguhan (PostgreSQL/MySQL). File JSON ini hanya untuk uji coba.
 */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = Number(process.env.PORT) || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const ORIGINS = (process.env.CORS_ORIGIN || 'https://appassets.androidplatform.net').split(',').map(function (s) { return s.trim(); });
const ROLES = ['marketing', 'supervisor', 'admin'];
const TYPES = ['taksasi', 'followup', 'topup'];
const FU_STATUS = ['baru', 'dihubungi', 'janji', 'berhasil', 'tidak'];
const TOKEN_DAYS = 30;
fs.mkdirSync(DATA_DIR, { recursive: true });

const SECRET = process.env.TOKEN_SECRET || (function () {
  var f = path.join(DATA_DIR, 'secret.key');
  try { return fs.readFileSync(f, 'utf8').trim(); } catch (e) {
    var s = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(f, s, { mode: 0o600 }); return s;
  }
})();

var db = { users: [], events: [] };
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) {}
if (!db.fu) db.fu = { batches: [], rows: [], seq: 0 };
var fuIdx = new Map();
db.fu.rows.forEach(function (r) { fuIdx.set(r.fid, r); });
var timer = null;
function writeNow() {
  var t = DB_FILE + '.tmp'; fs.writeFileSync(t, JSON.stringify(db)); fs.renameSync(t, DB_FILE);
}
function persist() { if (!timer) timer = setTimeout(function () { timer = null; writeNow(); }, 400); }

/* ---------- akun & token ---------- */
function hashPw(pw, salt) { return crypto.scryptSync(String(pw), salt, 64).toString('hex'); }
function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim().toLowerCase()); }
function addUser(u) {
  if (!/^[A-Za-z0-9._-]{2,40}$/.test(u.id || '')) throw new Error('ID hanya huruf/angka/titik/strip, 2-40 karakter');
  if (!validEmail(u.email)) throw new Error('Email tidak valid.');
  if (ROLES.indexOf(u.role) < 0) throw new Error('Peran harus marketing, supervisor, atau admin');
  if (String(u.password || '').length < 8) throw new Error('Kata sandi minimal 8 karakter');
  if (db.users.some(function (x) { return x.id === u.id; })) throw new Error('ID sudah dipakai');
  if (db.users.some(function (x) { return String(x.email || '').toLowerCase() === String(u.email).trim().toLowerCase(); })) throw new Error('Email sudah dipakai');
  var salt = crypto.randomBytes(16).toString('hex');
  db.users.push({ id: u.id, email: String(u.email).trim().toLowerCase(), name: String(u.name || u.id).slice(0, 80), role: u.role, team: String(u.team || '').slice(0, 80),
    salt: salt, hash: hashPw(u.password, salt), active: true, createdAt: new Date().toISOString() });
}
function pub(u) { return { id: u.id, email: u.email || '', name: u.name, role: u.role, team: u.team, active: u.active }; }
function sign(p) {
  var b = Buffer.from(JSON.stringify(p)).toString('base64url');
  return b + '.' + crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
}
function verify(t) {
  try {
    var a = String(t).split('.'), e = crypto.createHmac('sha256', SECRET).update(a[0]).digest('base64url');
    if (a.length !== 2 || a[1].length !== e.length || !crypto.timingSafeEqual(Buffer.from(a[1]), Buffer.from(e))) return null;
    var p = JSON.parse(Buffer.from(a[0], 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch (e) { return null; }
}

/* ---------- util HTTP ---------- */
var tries = new Map();
function limited(key) {
  var now = Date.now(), t = tries.get(key);
  if (!t || t.reset < now) { t = { n: 0, reset: now + 15 * 60 * 1000 }; tries.set(key, t); }
  return ++t.n > 10;
}
function send(res, code, obj, origin) {
  var h = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (origin && ORIGINS.indexOf(origin) >= 0) {
    h['Access-Control-Allow-Origin'] = origin; h['Vary'] = 'Origin';
    h['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'; h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
  }
  res.writeHead(code, h); res.end(obj === undefined ? '' : JSON.stringify(obj));
}
function body(req, max) {
  max = max || 512 * 1024;
  return new Promise(function (ok, no) {
    var n = 0, c = [];
    req.on('data', function (d) { n += d.length; if (n > max) { no(new Error('too large')); req.destroy(); } else c.push(d); });
    req.on('end', function () { try { ok(JSON.parse(Buffer.concat(c).toString() || '{}')); } catch (e) { no(new Error('bad json')); } });
    req.on('error', no);
  });
}
function auth(req) {
  var m = /^Bearer (.+)$/.exec(req.headers.authorization || ''), p = m && verify(m[1]);
  var u = p && db.users.find(function (x) { return x.id === p.uid; });
  return u && u.active ? u : null;
}
function validEvent(e) {
  return e && typeof e.id === 'string' && e.id.length > 0 && e.id.length <= 64 && TYPES.indexOf(e.type) >= 0 &&
    !isNaN(Date.parse(e.ts)) && e.data && typeof e.data === 'object' && JSON.stringify(e.data).length <= 2048;
}

/* ---------- bahan follow up ---------- */
const K = {
  // urutan = prioritas pencocokan akun marketing (ID akun/CS ID lebih dulu, lalu nama)
  mkt: ['csid', 'idmarketing', 'idkaryawan', 'marketing', 'namamarketing', 'pic', 'sales', 'petugas'],
  nama: ['namakonsumen', 'nama', 'namacustomer', 'namanasabah', 'namadebitur', 'customer', 'debitur'],
  kontrak: ['nokontrak', 'nomorkontrak', 'kontrak', 'contractno', 'nocontract', 'agreementno'],
  hp: ['nohp', 'nomorhp', 'hp', 'telepon', 'telp', 'notelp', 'handphone', 'whatsapp', 'wa'],
  unit: ['objdesc', 'unit', 'motor', 'kendaraan', 'objmodel', 'merktype', 'tipe', 'type', 'merk']
};
function nk(h) { return String(h).toLowerCase().replace(/[^a-z0-9]/g, ''); }
function pick(cols, keys) {
  var names = Object.keys(cols);
  for (var i = 0; i < keys.length; i++) for (var j = 0; j < names.length; j++)
    if (nk(names[j]) === keys[i] && String(cols[names[j]]).trim()) return String(cols[names[j]]).trim();
  return '';
}
function pickAll(cols, keys) {
  var out = [], names = Object.keys(cols);
  keys.forEach(function (k) { names.forEach(function (n) {
    var v = String(cols[n]).trim();
    if (nk(n) === k && v && out.indexOf(v) < 0) out.push(v);
  }); });
  return out;
}
function cleanCell(v) { return v == null ? '' : String(v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 300); }
function fuRow(r) {
  return { fid: r.fid, bn: r.bn, cols: r.cols, nama: r.nama, kontrak: r.kontrak, hp: r.hp, unit: r.unit,
    status: r.status, note: r.note, statusAt: r.statusAt, archived: !!r.archived, seq: r.seq };
}
function applyFollowup(me, e) {
  var d = e.data, row = d && typeof d.fid === 'string' ? fuIdx.get(d.fid) : null;
  if (!row || row.uid !== me.id || row.archived || FU_STATUS.indexOf(d.status) < 0) return false;
  var t = Date.parse(e.ts);
  if (!row.statusAt || t > Date.parse(row.statusAt)) {
    row.status = d.status; row.note = String(d.note || '').slice(0, 300); row.statusAt = new Date(t).toISOString(); row.seq = ++db.fu.seq;
  }
  return true;
}
function fuUpload(me, b) {
  var rows = Array.isArray(b.rows) ? b.rows : [], offset = Number(b.offset) || 0;
  if (!rows.length) throw new Error('Tidak ada baris data.');
  if (rows.length > 2000) throw new Error('Maksimal 2.000 baris per permintaan.');
  var bid = /^[A-Za-z0-9_-]{6,40}$/.test(b.batch || '') ? b.batch : 'b' + Date.now().toString(36);
  var mine = db.fu.rows.filter(function (r) { return r.by === me.id && !r.archived; }).length;
  if (mine + rows.length > 100000) throw new Error('Batas 100.000 baris aktif tercapai. Arsipkan bahan lama dulu.');
  var pool = db.users.filter(function (u) { return u.role === 'marketing' && u.active && (me.role === 'admin' || u.team === me.team); });
  var byKey = new Map();
  pool.forEach(function (u) { byKey.set(u.id.toLowerCase(), u); if (!byKey.has(u.name.toLowerCase())) byKey.set(u.name.toLowerCase(), u); });
  var at = new Date().toISOString(), name = String(b.name || 'Bahan follow up').slice(0, 80);
  var per = {}, miss = {}, assigned = 0, created = 0, updated = 0, same = 0, seen = 0;
  if (!db.fu.batches.some(function (x) { return x.id === bid; })) db.fu.batches.push({ id: bid, name: name, by: me.id, at: at, count: 0 });
  var batch = db.fu.batches.filter(function (x) { return x.id === bid; })[0];
  rows.forEach(function (raw, i) {
    if (!raw || typeof raw !== 'object') return;
    var cols = {}, n = 0;
    Object.keys(raw).slice(0, 40).forEach(function (h) { var v = cleanCell(raw[h]), hh = cleanCell(h).slice(0, 60); if (hh && v) { cols[hh] = v; n++; } });
    if (!n) return;
    seen++;
    var cands = pickAll(cols, K.mkt), u = null;
    for (var c = 0; c < cands.length && !u; c++) u = byKey.get(cands[c].toLowerCase()) || null;
    if (!u) { var lbl = cands.length ? cands[cands.length - 1] : '(kosong)'; miss[lbl] = (miss[lbl] || 0) + 1; return; } // tidak disimpan
    assigned++; per[u.id] = per[u.id] || { name: u.name, count: 0 }; per[u.id].count++;
    var f = { nama: pick(cols, K.nama), kontrak: pick(cols, K.kontrak), hp: pick(cols, K.hp), unit: pick(cols, K.unit) };
    var kd = f.kontrak.replace(/\D/g, ''), fid = kd ? 'c' + kd + '-' + u.id : bid + '-' + (offset + i);
    var old = fuIdx.get(fid);
    if (old) {
      var unchanged = !old.archived && old.bn === name && JSON.stringify(old.cols) === JSON.stringify(cols);
      old.batch = bid; old.by = me.id;
      if (unchanged) { same++; return; }
      old.cols = cols; old.nama = f.nama; old.kontrak = f.kontrak; old.hp = f.hp; old.unit = f.unit; old.bn = name;
      old.team = u.team; old.archived = false; old.seq = ++db.fu.seq; updated++;       // status & catatan lama tetap
    } else {
      var r = { fid: fid, bn: name, batch: bid, uid: u.id, by: me.id, team: u.team, cols: cols, nama: f.nama, kontrak: f.kontrak, hp: f.hp, unit: f.unit,
        status: 'baru', note: '', statusAt: null, archived: false, seq: ++db.fu.seq, at: at };
      db.fu.rows.push(r); fuIdx.set(fid, r); created++;
    }
  });
  batch.count += created + updated + same;
  var archived = 0;
  if (b.last && b.replace !== false) {
    db.fu.rows.forEach(function (r) { if (r.by === me.id && !r.archived && r.batch !== bid) { r.archived = true; r.seq = ++db.fu.seq; archived++; } });
  }
  db.fu.batches = db.fu.batches.slice(-50);
  persist();
  return { batch: bid, total: seen, assigned: assigned, unassigned: seen - assigned, created: created, updated: updated, unchanged: same, archived: archived,
    perMarketing: Object.keys(per).map(function (k) { return { id: k, name: per[k].name, count: per[k].count }; }),
    unmatched: Object.keys(miss).slice(0, 30).map(function (k) { return { value: k, count: miss[k] }; }) };
}

/* ---------- rute ---------- */
var server = http.createServer(function (req, res) {
  var origin = req.headers.origin, url = new URL(req.url, 'http://x'), p = url.pathname;
  if (req.method === 'OPTIONS') return send(res, 204, undefined, origin);
  if (p === '/health') return send(res, 200, { ok: true }, origin);

  if (p === '/api/login' && req.method === 'POST') {
    return body(req).then(function (b) {
      var identity = String(b.email || b.id || '').trim().toLowerCase(), key = req.socket.remoteAddress + '|' + identity;
      if (limited(key)) return send(res, 429, { error: 'Terlalu banyak percobaan. Coba lagi 15 menit lagi.' }, origin);
      var u = db.users.find(function (x) { return String(x.email || '').toLowerCase() === identity || x.id.toLowerCase() === identity; });
      var ok = u && crypto.timingSafeEqual(Buffer.from(hashPw(b.password || '', u.salt)), Buffer.from(u.hash));
      if (!ok) return send(res, 401, { error: 'Email atau kata sandi salah.' }, origin);
      if (!u.active) return send(res, 403, { error: 'Akun dinonaktifkan. Hubungi admin.' }, origin);
      tries.delete(key);
      send(res, 200, { token: sign({ uid: u.id, exp: Date.now() + TOKEN_DAYS * 864e5 }), user: pub(u) }, origin);
    }).catch(function () { send(res, 400, { error: 'Permintaan tidak valid.' }, origin); });
  }

  var me = auth(req);
  if (!me) return send(res, 401, { error: 'Sesi berakhir. Silakan masuk lagi.' }, origin);

  if (p === '/api/me' && req.method === 'GET') return send(res, 200, { user: pub(me) }, origin);

  if (p === '/api/events' && req.method === 'POST') {
    return body(req).then(function (b) {
      var list = Array.isArray(b.events) ? b.events.slice(0, 200) : [], accepted = [], rejected = [];
      var have = new Set(db.events.filter(function (e) { return e.uid === me.id; }).map(function (e) { return e.id; }));
      list.forEach(function (e) {
        if (!validEvent(e)) { if (e && typeof e.id === 'string') rejected.push(e.id); return; }
        if (!have.has(e.id)) {
          if (e.type === 'followup' && !applyFollowup(me, e)) { rejected.push(e.id); return; }
          db.events.push({ id: e.id, uid: me.id, type: e.type, ts: new Date(e.ts).toISOString(), data: e.data, receivedAt: new Date().toISOString() });
          have.add(e.id);
        }
        accepted.push(e.id);
      });
      persist(); send(res, 200, { accepted: accepted, rejected: rejected }, origin);
    }).catch(function () { send(res, 400, { error: 'Permintaan tidak valid.' }, origin); });
  }

  if (p === '/api/events' && req.method === 'GET') {
    var since = url.searchParams.get('since') || '', limit = Math.min(Number(url.searchParams.get('limit')) || 100, 500);
    var ids = me.role === 'admin' ? null : me.role === 'supervisor'
      ? db.users.filter(function (u) { return u.team === me.team; }).map(function (u) { return u.id; }) : [me.id];
    var out = db.events.filter(function (e) { return (!ids || ids.indexOf(e.uid) >= 0) && e.ts > since; })
      .sort(function (a, b) { return a.ts < b.ts ? 1 : -1; }).slice(0, limit);
    return send(res, 200, { events: out }, origin);
  }

  if (p === '/api/followup/upload' && req.method === 'POST') {
    if (me.role === 'marketing') return send(res, 403, { error: 'Khusus supervisor atau admin.' }, origin);
    return body(req, 12 * 1024 * 1024).then(function (b) { send(res, 200, fuUpload(me, b), origin); })
      .catch(function (e) { send(res, 400, { error: e.message === 'too large' ? 'File terlalu besar.' : e.message }, origin); });
  }
  if (p === '/api/followup' && req.method === 'GET') {
    var since = Number(url.searchParams.get('since')) || 0, out = [];
    if (me.role === 'marketing') {
      out = db.fu.rows.filter(function (r) { return r.uid === me.id && r.seq > since; }).sort(function (a, b) { return a.seq - b.seq; });
    }
    var more = out.length > 500; out = out.slice(0, 500);
    return send(res, 200, { rows: out.map(fuRow), seq: out.length ? out[out.length - 1].seq : since, more: more }, origin);
  }
  if (p === '/api/followup/summary' && req.method === 'GET') {
    if (me.role === 'marketing') return send(res, 403, { error: 'Khusus supervisor atau admin.' }, origin);
    var people = db.users.filter(function (u) { return u.role === 'marketing' && u.active && (me.role === 'admin' || u.team === me.team); });
    var act = db.fu.rows.filter(function (r) { return !r.archived && (me.role === 'admin' || r.team === me.team || r.by === me.id); });
    var mk = people.map(function (u) {
      var o = { id: u.id, name: u.name, total: 0, baru: 0, dihubungi: 0, janji: 0, berhasil: 0, tidak: 0 };
      act.forEach(function (r) { if (r.uid === u.id) { o.total++; o[r.status]++; } });
      return o;
    });
    return send(res, 200, { marketing: mk,
      batches: db.fu.batches.filter(function (x) { return me.role === 'admin' || x.by === me.id; }).slice(-5).reverse() }, origin);
  }

  if (p.indexOf('/api/admin/') === 0) {
    if (me.role !== 'admin') return send(res, 403, { error: 'Khusus admin.' }, origin);
    if (p === '/api/admin/users' && req.method === 'GET') return send(res, 200, { users: db.users.map(pub) }, origin);
    if (p === '/api/admin/users' && req.method === 'POST') {
      return body(req).then(function (b) { addUser(b); persist(); send(res, 201, { ok: true }, origin); })
        .catch(function (e) { send(res, 400, { error: e.message }, origin); });
    }
    var m = /^\/api\/admin\/users\/([^/]+)\/active$/.exec(p);
    if (m && req.method === 'POST') {
      return body(req).then(function (b) {
        var u = db.users.find(function (x) { return x.id === decodeURIComponent(m[1]); });
        if (!u) return send(res, 404, { error: 'Akun tidak ditemukan.' }, origin);
        u.active = !!b.active; persist(); send(res, 200, { user: pub(u) }, origin);
      }).catch(function () { send(res, 400, { error: 'Permintaan tidak valid.' }, origin); });
    }
  }
  send(res, 404, { error: 'Tidak ditemukan.' }, origin);
});

if (process.argv[2] === 'setemail') {
  var s = process.argv.slice(3);
  try {
    var target = db.users.find(function (u) { return u.id === s[0]; });
    if (!target) throw new Error('Akun tidak ditemukan.');
    if (!validEmail(s[1])) throw new Error('Email tidak valid.');
    if (db.users.some(function (u) { return u !== target && String(u.email || '').toLowerCase() === String(s[1]).trim().toLowerCase(); })) throw new Error('Email sudah dipakai');
    target.email = String(s[1]).trim().toLowerCase(); writeNow(); console.log('Email diperbarui:', target.id, target.email);
  } catch (e) { console.error('Gagal:', e.message); process.exit(1); }
} else if (process.argv[2] === 'adduser') {
  var a = process.argv.slice(3);
  try { addUser({ id: a[0], email: a[1], name: a[2], role: a[3], team: a[4], password: a[5] }); writeNow(); console.log('Akun dibuat:', a[0], a[1], '(' + a[3] + ')'); }
  catch (e) { console.error('Gagal:', e.message); process.exit(1); }
} else if (require.main === module) {
  server.listen(PORT, function () { console.log('Calculator OTR server berjalan di port ' + PORT + ' (' + db.users.length + ' akun)'); });
}
module.exports = server;
