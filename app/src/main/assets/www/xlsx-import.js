/*
 * Pembaca .xlsx ringan (tanpa library, jalan offline di browser/WebView).
 * parseFile : sheet "HARGA PASAR" -> BRAND, MODEL, OBJECT TYPE, OBJECT DESCRIPTION, GROUP TYPE UNIT, VEHICLE, TAHUN, HARGA PASAR
 * readTable  : sheet apa pun dengan judul kolom di baris pertama (dipakai untuk bahan follow up)
 */
(function (root) {
  'use strict';

  /* ---------------- inflate cadangan (untuk WebView lama tanpa DecompressionStream) ---------------- */
  var LBASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  var LEXT = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  var DBASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  var DEXT = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
  var CLORDER = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];

  function huff(lengths, n) {
    var count = new Uint16Array(16), symbol = new Uint16Array(n), offs = new Uint16Array(16), i;
    for (i = 0; i < n; i++) count[lengths[i]]++;
    count[0] = 0;
    for (i = 1; i < 15; i++) offs[i + 1] = offs[i] + count[i];
    for (i = 0; i < n; i++) if (lengths[i]) symbol[offs[lengths[i]]++] = i;
    return { count: count, symbol: symbol };
  }

  function inflateRaw(src, size) {
    var out = new Uint8Array(size), op = 0, ip = 0, bb = 0, bc = 0;
    function bits(n) {
      while (bc < n) { bb |= src[ip++] << bc; bc += 8; }
      var v = bb & ((1 << n) - 1); bb >>>= n; bc -= n; return v;
    }
    function dec(h) {
      var code = 0, first = 0, index = 0;
      for (var len = 1; len <= 15; len++) {
        code |= bits(1);
        var c = h.count[len];
        if (code - c < first) return h.symbol[index + (code - first)];
        index += c; first += c; first <<= 1; code <<= 1;
      }
      throw new Error('inflate: kode tidak valid');
    }
    var fl, fd;
    (function () {
      var l = new Uint8Array(288), i;
      for (i = 0; i < 144; i++) l[i] = 8; for (; i < 256; i++) l[i] = 9; for (; i < 280; i++) l[i] = 7; for (; i < 288; i++) l[i] = 8;
      fl = huff(l, 288);
      var d = new Uint8Array(30); for (i = 0; i < 30; i++) d[i] = 5; fd = huff(d, 30);
    })();
    function codes(hl, hd) {
      for (;;) {
        var s = dec(hl);
        if (s < 256) out[op++] = s;
        else if (s === 256) return;
        else {
          s -= 257; var len = LBASE[s] + bits(LEXT[s]);
          var ds = dec(hd), dist = DBASE[ds] + bits(DEXT[ds]);
          for (var k = 0; k < len; k++, op++) out[op] = out[op - dist];
        }
      }
    }
    var last;
    do {
      last = bits(1);
      var type = bits(2);
      if (type === 0) {
        bb = 0; bc = 0;
        var len = src[ip] | (src[ip + 1] << 8); ip += 4;
        for (var q = 0; q < len; q++) out[op++] = src[ip++];
      } else if (type === 1) codes(fl, fd);
      else if (type === 2) {
        var nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4, i;
        var lengths = new Uint8Array(320);
        for (i = 0; i < ncode; i++) lengths[CLORDER[i]] = bits(3);
        var lh = huff(lengths.subarray(0, 19), 19), idx = 0;
        lengths = new Uint8Array(320);
        while (idx < nlen + ndist) {
          var sym = dec(lh);
          if (sym < 16) lengths[idx++] = sym;
          else {
            var prev = 0, rep;
            if (sym === 16) { prev = lengths[idx - 1]; rep = 3 + bits(2); }
            else if (sym === 17) rep = 3 + bits(3);
            else rep = 11 + bits(7);
            while (rep--) lengths[idx++] = prev;
          }
        }
        codes(huff(lengths.subarray(0, nlen), nlen), huff(lengths.subarray(nlen, nlen + ndist), ndist));
      } else throw new Error('inflate: blok tidak valid');
    } while (!last);
    return out.subarray(0, op);
  }

  async function inflate(u8, size) {
    if (typeof DecompressionStream === 'function' && !root.__forceSoftInflate) {
      try {
        var stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      } catch (e) { /* jatuh ke inflate cadangan */ }
    }
    return inflateRaw(u8, size);
  }

  /* ---------------- ZIP ---------------- */
  function readZip(buf) {
    var u8 = new Uint8Array(buf), dv = new DataView(buf), i = u8.length - 22, entries = {};
    for (; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) break;
    if (i < 0) throw new Error('Bukan file .xlsx yang valid');
    var count = dv.getUint16(i + 10, true), p = dv.getUint32(i + 16, true);
    var dec = new TextDecoder('utf-8');
    for (var k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      var method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
      var nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      var off = dv.getUint32(p + 42, true);
      var name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
      entries[name] = { method: method, csize: csize, usize: usize, off: off };
      p += 46 + nl + el + cl;
    }
    return { u8: u8, dv: dv, entries: entries };
  }

  async function readEntry(zip, name) {
    var e = zip.entries[name];
    if (!e) return null;
    var lo = e.off, nl = zip.dv.getUint16(lo + 26, true), el = zip.dv.getUint16(lo + 28, true);
    var start = lo + 30 + nl + el, data = zip.u8.subarray(start, start + e.csize);
    if (e.method === 0) return data;
    if (e.method === 8) return inflate(data, e.usize);
    throw new Error('Metode kompresi tidak didukung');
  }
  async function readText(zip, name) {
    var d = await readEntry(zip, name);
    return d ? new TextDecoder('utf-8').decode(d) : null;
  }

  /* ---------------- XML ---------------- */
  function unesc(s) {
    if (s.indexOf('&') < 0) return s;
    return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, function (m, g) {
      if (g === 'amp') return '&'; if (g === 'lt') return '<'; if (g === 'gt') return '>';
      if (g === 'quot') return '"'; if (g === 'apos') return "'";
      return String.fromCodePoint(g[1] === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10));
    });
  }
  function textOf(xml) { // gabungkan semua <t>..</t>
    var out = '', re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, m;
    while ((m = re.exec(xml))) out += m[1];
    return unesc(out);
  }
  function parseShared(xml) {
    var list = [], re = /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>|<si\s*\/>/g, m;
    while ((m = re.exec(xml))) list.push(m[1] ? textOf(m[1]) : '');
    return list;
  }
  function colIndex(ref) {
    var n = 0;
    for (var i = 0; i < ref.length; i++) {
      var c = ref.charCodeAt(i);
      if (c < 65 || c > 90) break;
      n = n * 26 + (c - 64);
    }
    return n - 1;
  }
  // Mengembalikan array baris (array sel). maxRows opsional.
  function parseSheet(xml, shared, maxRows) {
    var rows = [], rowRe = /<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g, rm;
    var cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    while ((rm = rowRe.exec(xml))) {
      var body = rm[1] || '', row = [], cm;
      cellRe.lastIndex = 0;
      while ((cm = cellRe.exec(body))) {
        var attrs = cm[1], inner = cm[2] || '';
        var r = /\br="([A-Z]+)\d+"/.exec(attrs), t = /\bt="(\w+)"/.exec(attrs);
        if (!r) continue;
        var ci = colIndex(r[1]), val = null, type = t ? t[1] : 'n';
        if (type === 'inlineStr') val = textOf(inner);
        else {
          var v = /<v>([\s\S]*?)<\/v>/.exec(inner);
          if (v) {
            if (type === 's') val = shared[+v[1]];
            else if (type === 'str' || type === 'e') val = unesc(v[1]);
            else if (type === 'b') val = v[1] === '1';
            else val = Number(v[1]);
          }
        }
        row[ci] = val === undefined ? null : val;
      }
      rows.push(row);
      if (maxRows && rows.length >= maxRows) break;
    }
    return rows;
  }

  /* ---------------- workbook ---------------- */
  async function openWorkbook(buf) {
    var zip = readZip(buf);
    var wbXml = await readText(zip, 'xl/workbook.xml');
    if (!wbXml) throw new Error('Struktur .xlsx tidak dikenali');
    var relXml = (await readText(zip, 'xl/_rels/workbook.xml.rels')) || '';
    var rels = {}, m, rr = /<Relationship\b([^>]*?)\/?>/g;
    while ((m = rr.exec(relXml))) {
      var id = /\bId="([^"]+)"/.exec(m[1]), tg = /\bTarget="([^"]+)"/.exec(m[1]);
      if (id && tg) rels[id[1]] = tg[1].replace(/^\/?(xl\/)?/, 'xl/');
    }
    var sheets = [], sr = /<sheet\b([^>]*?)\/?>/g;
    while ((m = sr.exec(wbXml))) {
      var nm = /\bname="([^"]*)"/.exec(m[1]), rid = /\br:id="([^"]+)"/.exec(m[1]);
      if (nm && rid && rels[rid[1]]) sheets.push({ name: unesc(nm[1]), path: rels[rid[1]] });
    }
    var ssXml = await readText(zip, 'xl/sharedStrings.xml');
    var shared = ssXml ? parseShared(ssXml) : [];
    return {
      sheets: sheets,
      async rows(sheet, maxRows) {
        var xml = await readText(zip, sheet.path);
        return parseSheet(xml, shared, maxRows);
      }
    };
  }

  /* ---------------- transformasi ke format aplikasi ---------------- */
  var norm = function (s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toUpperCase(); };
  var str = function (v) { return v == null ? '' : String(v).trim(); };

  function toHarga(rows) {
    var out = [];
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i] || [];
      var harga = Number(r[7]);
      if (r[0] == null && r[1] == null && r[7] == null) continue;
      if (!isFinite(harga)) continue;
      var tahun = typeof r[6] === 'number' ? r[6] : str(r[6]);
      out.push([str(r[0]), str(r[1]), str(r[2]), str(r[3]), str(r[4]), str(r[5]), tahun, harga]);
    }
    return out;
  }

  // Hanya sheet HARGA PASAR yang dibaca (fitur CLOP sudah diganti bahan follow up).
  async function detect(wb) {
    for (var i = 0; i < wb.sheets.length; i++) {
      var sh = wb.sheets[i], head = await wb.rows(sh, 1);
      if (norm(sh.name) === 'HARGA PASAR' || norm(head[0] && head[0][0]) === 'BRAND') return sh;
    }
    return null;
  }

  async function parseFile(buf, onProgress) {
    var say = onProgress || function () {};
    say('Membuka file...');
    var wb = await openWorkbook(buf), sh = await detect(wb);
    if (!sh) throw new Error('Sheet "HARGA PASAR" tidak ditemukan di file ini.');
    say('Membaca HARGA PASAR...');
    var hr = await wb.rows(sh);
    if (norm(hr[0] && hr[0][0]) !== 'BRAND' || norm(hr[0] && hr[0][7]).indexOf('HARGA') < 0)
      throw new Error('Header sheet HARGA PASAR tidak sesuai (kolom A = BRAND ... kolom H = HARGA PASAR).');
    var harga = toHarga(hr);
    if (!harga.length) throw new Error('Sheet HARGA PASAR kosong.');
    return { harga: harga };
  }

  /* ---------------- tabel umum (bahan follow up) ---------------- */
  var MAX_TABLE_ROWS = 60000;
  function cellText(v, header) {
    if (v == null) return '';
    if (typeof v === 'number') {
      // tanggal Excel (serial) pada kolom bertanda tanggal
      if (/tgl|tanggal|date|jatuh|tempo/i.test(header) && v > 20000 && v < 80000) {
        var d = new Date(Math.round((v - 25569) * 86400000)), p = function (n) { return (n < 10 ? '0' : '') + n; };
        return p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
      }
      if (Number.isInteger(v)) {
        var t = String(v);
        // nomor HP yang tersimpan sebagai angka kehilangan angka 0 di depan
        if (/hp|telp|telepon|phone|whatsapp|\bwa\b/i.test(header) && /^8\d{8,12}$/.test(t)) return '0' + t;
        return t;
      }
      return String(v);
    }
    return String(v).replace(/\s+/g, ' ').trim();
  }
  // Baca sheet pertama (atau yang bernama mengandung "FOLLOW") sebagai tabel: baris pertama berisi judul kolom.
  async function readTable(buf, onProgress) {
    var say = onProgress || function () {};
    say('Membuka file...');
    var wb = await openWorkbook(buf), sh = null, all = null;
    for (var i = 0; i < wb.sheets.length && !sh; i++) if (/follow/i.test(wb.sheets[i].name)) sh = wb.sheets[i];
    sh = sh || wb.sheets[0];
    if (!sh) throw new Error('File tidak berisi sheet.');
    say('Membaca sheet ' + sh.name + '...');
    all = await wb.rows(sh);
    var hi = -1;
    for (var r = 0; r < Math.min(all.length, 5) && hi < 0; r++) {
      var n = 0; (all[r] || []).forEach(function (c) { if (c != null && String(c).trim() !== '') n++; });
      if (n >= 2) hi = r;
    }
    if (hi < 0) throw new Error('Judul kolom tidak ditemukan. Baris pertama harus berisi judul kolom.');
    var headers = [], seen = {}, cols = [];
    (all[hi] || []).forEach(function (c, ci) {
      var h = String(c == null ? '' : c).replace(/\s+/g, ' ').trim();
      if (!h) return;
      var base = h, k = 2; while (seen[h]) h = base + ' ' + (k++);
      seen[h] = 1; headers.push(h); cols.push(ci);
    });
    var out = [], truncated = false;
    for (var j = hi + 1; j < all.length; j++) {
      var row = all[j] || [], o = {}, any = false;
      for (var q = 0; q < cols.length; q++) {
        var t = cellText(row[cols[q]], headers[q]);
        if (t) { o[headers[q]] = t; any = true; }
      }
      if (!any) continue;
      if (out.length >= MAX_TABLE_ROWS) { truncated = true; break; }
      out.push(o);
    }
    if (!out.length) throw new Error('Tidak ada baris data di bawah judul kolom.');
    return { sheet: sh.name, headers: headers, rows: out, truncated: truncated };
  }

  var api = { parseFile: parseFile, readTable: readTable, _inflateRaw: inflateRaw };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OTRImport = api;
})(typeof window !== 'undefined' ? window : globalThis);
