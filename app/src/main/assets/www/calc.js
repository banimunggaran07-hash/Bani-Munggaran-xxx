/*
 * Calculator OTR - logika perhitungan
 * Mengikuti rumus pada file TOOLS_OTR_DAN_CALCULATOR_V1_3.xlsx
 *   - Perhitungan Pajak dan Kaleng
 *   - Perhitungan Potongan Taksasi
 *   - List Taksasi dan Jenis Angsuran (Tipe Angsuran & Plafond)
 *   - Formulas Taksasi (pembulatan Maksimal Pinjaman)
 *   - KALKULATOR TAKSASI (Kontrak Lama / Top Up)
 *   - Reguler / Awda (Angsuran, WAR Gross, Splitting Rate)
 */
(function (root) {
  'use strict';

  /* ---------- util tanggal ---------- */
  function parseDate(s) {
    // "YYYY-MM-DD" -> Date lokal
    if (!s) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }

  /* ---------- Perhitungan Pajak (sheet "Perhitungan Pajak dan Kaleng" A1:H9) ---------- */
  // Mengembalikan jumlah tahun pajak mati (0 = Pajak Hidup)
  function pajakMatiTahun(dateStr, today) {
    var d = parseDate(dateStr);
    if (!d) return null;
    var cy = today.getFullYear();
    var m = d.getMonth() + 1, dd = d.getDate();
    var tm = today.getMonth() + 1 + 1;          // MONTH(TODAY())+1
    var td = today.getDate();
    var B9 = (m > tm) || (m === tm);             // Apakah bulan pajak hidup
    var D9 = (B9 && m > tm) ? true : (dd >= td); // Apakah tanggal pajak hidup
    var hidupPenuh = B9 && D9;

    // Baris 4: deretan tahun (A..H)
    var y = [d.getFullYear()];
    for (var i = 1; i < 8; i++) {
      var p = y[i - 1];
      y.push(p !== null && p + 1 <= cy ? p + 1 : null);
    }
    // Baris 5: hitungan tahun mati
    var r5 = [];
    for (var j = 0; j < 8; j++) {
      var yj = y[j];
      var isCur = yj === cy;
      var prev = j > 0 ? r5[j - 1] : null;
      var v;
      if (j === 0) {
        if (yj > cy) v = null;
        else if (isCur) v = hidupPenuh ? null : 1;
        else v = (yj !== null) ? 1 : null;
      } else if (isCur) {
        v = hidupPenuh ? null : (prev === null ? null : prev + 1);
      } else {
        v = (yj !== null && prev !== null) ? prev + 1 : null;
      }
      r5.push(v);
    }
    var max = 0;
    r5.forEach(function (x) { if (x !== null && x > max) max = x; });
    return max; // C2 = MAX(A5:H5)
  }

  /* ---------- Status Kaleng (C12) ---------- */
  function kalengStatus(dateStr, today) {
    var d = parseDate(dateStr);
    if (!d) return null;
    var cy = today.getFullYear(), ky = d.getFullYear();
    if (ky > cy) return 'Kaleng Hidup';
    if (ky < cy) return 'Kaleng Mati';
    if ((d.getMonth() + 1) < (today.getMonth() + 1 + 1)) return 'Kaleng Mati';
    return d.getDate() >= today.getDate() ? 'Kaleng Hidup' : 'Kaleng Mati';
  }

  /* ---------- Pembulatan Maksimal Pinjaman (sheet "Formulas Taksasi" B2:B5) ---------- */
  // Dibulatkan ke bawah kelipatan 250.000 (000 / 250 / 500 / 750 ribu)
  function bulatkanMaks(x) {
    if (!(x > 0)) return 0;
    var v = Number(Number(x).toPrecision(15)); // Excel memakai 15 digit signifikan
    return Math.floor(v / 250000) * 250000;
  }

  /* ---------- Tipe Angsuran & Plafond (List Taksasi dan Jenis Angsuran) ---------- */
  function lookupPlafond(cfg, tipe, jenis, sendiri) {
    var tnkb = sendiri === 'Ya' ? 'Segaris' : 'Tidak Segaris';
    for (var i = 0; i < cfg.plafond.length; i++) {
      var p = cfg.plafond[i];
      if (p.tipe === tipe && p.jenis === jenis && p.tnkb === tnkb) return p;
    }
    return null;
  }

  /* ---------- KALKULATOR TAKSASI ---------- */
  function hitungTaksasi(cfg, inp, today) {
    today = today || new Date();
    var out = {};
    var pl = lookupPlafond(cfg, inp.tipe, inp.jenis, inp.sendiri) || { angsuran: '-', plafond: 0, tnkb: '-' };
    out.tnkb = pl.tnkb || (inp.sendiri === 'Ya' ? 'Segaris' : 'Tidak Segaris');
    out.tipeAngsuran = pl.angsuran;      // E7
    out.plafond = pl.plafond;            // G13

    var tahunMati = pajakMatiTahun(inp.tglPajak, today);   // C2
    var kaleng = kalengStatus(inp.tglKaleng, today);       // C12
    out.siapHitung = tahunMati !== null && kaleng !== null;
    out.pajakTahun = tahunMati;                             // E9 (0 = Pajak Hidup)
    out.kaleng = kaleng;                                    // F9
    out.faktur = inp.faktur;                                // G9
    out.maxTenor = kaleng === 'Kaleng Hidup' ? 23 : 17;     // G7

    // Potongan
    var potPajak = 0;
    if (tahunMati && tahunMati > 0) {
      var idx = Math.min(tahunMati, 8) - 1;                 // VLOOKUP(...,TRUE)
      potPajak = cfg.potPajak[idx][1];
    }
    var potKaleng = kaleng === 'Kaleng Mati' ? cfg.potKaleng : 0;
    var potFaktur = inp.faktur === 'Tidak Ada' ? cfg.potFaktur : 0;
    out.potPajak = potPajak; out.potKaleng = potKaleng; out.potFaktur = potFaktur;
    out.totalPotongan = potPajak + potKaleng + potFaktur;   // F13

    var otr = Number(inp.otr) || 0;
    out.otr = otr;                                          // E13
    out.hasilRumus = (otr - out.totalPotongan) * out.plafond; // E15
    out.maksPinjaman = bulatkanMaks(out.hasilRumus);          // E17

    // Kontrak lama / Top Up
    var top = inp.topUp === 'YES';
    var denda = Number(inp.denda) || 0, dendaBayar = Number(inp.dendaBayar) || 0;
    var coll = Number(inp.collFee) || 0, collBayar = Number(inp.collFeeBayar) || 0;
    var sisa = Number(inp.sisaAngsuran) || 0;
    out.topUp = top;
    out.totalDenda = top ? (denda - dendaBayar) + (coll - collBayar) : null;   // J12
    out.angsuranDenda = top ? sisa + out.totalDenda : null;                    // J13
    out.j14 = out.maksPinjaman;                                                // J14
    out.j15 = out.angsuranDenda;                                               // J15
    out.totalDiterima = top ? out.j14 - out.angsuranDenda - 5000 : out.j14;    // J16
    return out;
  }

  /* ---------- Angsuran (sheet Reguler / Awda) ---------- */
  function roundUp3(x) { return Math.ceil(x / 1000 - 1e-9) * 1000; } // ROUNDUP(x,-3)

  function bungaFlat(n, annual) {              // ((n*i)/(1-(1+i)^-n))-1
    var i = annual / 12;
    return (n * i) / (1 - Math.pow(1 + i, -n)) - 1;
  }

  function angsuran(cfg, tipe, P, n) {
    var a = cfg.angsuran, r = a.types[tipe].rate;
    var pokok = P + a.admin;
    var total = pokok + pokok * bungaFlat(n, r) + (a.split + a.ms);
    return roundUp3(total / n);
  }

  // Excel RATE(nper,pmt,pv,0,0) dengan bisection
  function rate(n, pmt, pv) {
    var g = function (x) { return pv * Math.pow(1 + x, n) + pmt * (Math.pow(1 + x, n) - 1) / x; };
    var lo = 1e-9, hi = 1.0;
    for (var k = 0; k < 200; k++) {
      var mid = (lo + hi) / 2;
      if (g(mid) > 0) hi = mid; else lo = mid;
    }
    return (lo + hi) / 2;
  }

  function warGross(cfg, tipe, P, n) {
    var a = cfg.angsuran, r = a.types[tipe].rate;
    var pokok = P + a.admin;
    var T = pokok * bungaFlat(n, r) + (a.split + a.ms);
    var pm = (1 + T / pokok) / n;
    return 12 * rate(n, -pm, 1);
  }

  function splittingRate(cfg, tipe, P, n) {
    return warGross(cfg, tipe, P, n) - cfg.angsuran.types[tipe].rate;
  }

  /* ---------- Cek CLOP ---------- */
  function normKontrak(s) {
    s = String(s == null ? '' : s).trim();
    return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, '') : s;
  }

  /* ---------- Pencarian multi kata kunci (SEARCH OTR) ---------- */
  function wildcardRegex(kw) {
    // SEARCH() Excel: ? = 1 karakter, * = banyak karakter, ~ = escape
    var re = '', i = 0;
    while (i < kw.length) {
      var c = kw[i];
      if (c === '~' && i + 1 < kw.length) { re += kw[i + 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); i += 2; continue; }
      if (c === '?') re += '.';
      else if (c === '*') re += '.*';
      else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      i++;
    }
    return new RegExp(re, 'i');
  }

  function kataKunci(q) {
    // maksimal 6 kata kunci (P2:P7)
    return String(q || '').trim().split(/\s+/).filter(Boolean).slice(0, 6);
  }

  function formatRp(n) {
    if (n === null || n === undefined || n === '' || isNaN(n)) return '-';
    var neg = n < 0;
    var s = String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '-' : '') + 'Rp. ' + s;
  }

  var api = {
    parseDate: parseDate, pajakMatiTahun: pajakMatiTahun, kalengStatus: kalengStatus,
    bulatkanMaks: bulatkanMaks, lookupPlafond: lookupPlafond, hitungTaksasi: hitungTaksasi,
    roundUp3: roundUp3, angsuran: angsuran, warGross: warGross, splittingRate: splittingRate,
    normKontrak: normKontrak, kataKunci: kataKunci, wildcardRegex: wildcardRegex, formatRp: formatRp
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OTRCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
