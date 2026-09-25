(function () {
  'use strict';
  var C = window.OTRCalc, CFG = window.CFG, SY = window.OTRSync, FU = window.OTRFollowup;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var KEY = 'calculatorotr.v1_3', WK = 'calculatorotr.welcomed';
  var DEF = {
    jenis: 'Honda', tipe: 'New Customer', sendiri: 'Tidak', faktur: 'Ada', tahun: '', tglPajak: '', tglKaleng: '',
    otr: '', otrNama: '', sisaAngsuran: '', denda: '', dendaBayar: '', collFee: '', collFeeBayar: '',
    qOtr: '', fuQ: '', fuFilter: 'semua', angType: null, angMode: 'angsuran', angDana: '', nasabah: '', hpNasabah: '', fuFid: ''  // topUp dihapus: layar Top up sekarang selalu menghitung sebagai top up
  };
  var S = {};
  function load() {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {}
    S = Object.assign({}, DEF, saved);
  }
  var saveT;
  function save() {
    clearTimeout(saveT);
    saveT = setTimeout(function () { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }, 200);
  }

  /* ---------- format ---------- */
  function rp(n) { return C.formatRp(n); }
  function rpJ(n) { var s = C.formatRp(n); return s === '-' ? s : s.replace('Rp. ', 'Rp '); }
  function dots(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function pct(x, d) { return (x * 100).toFixed(d).replace('.', ',') + '%'; }
  function digits(s) { return String(s || '').replace(/\D/g, ''); }
  function num(k) { var v = S[k]; return v === '' || v == null ? 0 : Number(v); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function set(id, txt) { var e = $('#' + id); if (e) e.textContent = txt; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function tglFmt(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  var toastT;
  function toast(t) {
    var e = $('#toast'); e.textContent = t; e.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { e.classList.remove('show'); }, 2600);
  }
  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(function () { toast('Ringkasan disalin'); }, function () { toast('Tidak bisa menyalin'); });
      return;
    }
    var a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select();
    try { document.execCommand('copy'); toast('Ringkasan disalin'); } catch (e) { toast('Tidak bisa menyalin'); }
    document.body.removeChild(a);
  }
  function shareText(t) {
    if (navigator.share) navigator.share({ text: t }).catch(function () {});
    else copyText(t);
  }

  /* ---------- navigasi ---------- */
  var TABS = ['calc', 'ang', 'fu', 'sup', 'info'];
  var TITLES = { search: 'Cari harga pasar', topup: 'Top up kontrak lama', fudetail: 'Detail follow up', settings: 'Pengaturan', sync: 'Sinkronisasi', sup: 'Kinerja Tim' };
  var cur = 'calc', lastTab = 'calc';
  function backTarget(v) { return { search: 'calc', topup: 'calc', fudetail: 'fu', settings: lastTab, sync: 'settings' }[v] || 'calc'; }
  function go(v) {
    var tab = TABS.indexOf(v) >= 0;
    if (tab) lastTab = v;
    cur = v;
    $$('.view').forEach(function (x) { x.classList.toggle('active', x.id === 'v-' + v); });
    $$('#pill button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === v); });
    $('#app').dataset.m = tab ? 'tabs' : 'sub';
    $('#hdTitle').textContent = TITLES[v] || 'Calculator OTR';
    $('#btnSearch').style.visibility = v === 'calc' ? 'visible' : 'hidden';
    $('#fab').hidden = !(v === 'calc' || v === 'ang');
    $('#pn').scrollTop = 0;
    updateNasbar();
    if (v === 'search') renderSearch(true);
    if (v === 'ang') renderAng();
    if (v === 'fu') renderFu(true);
    if (v === 'sup') renderSupervisor();
    if (v === 'topup') calc();
    if (v === 'settings') renderSettings();
    if (v === 'sync') renderSync();
  }
  // dipanggil MainActivity saat tombol Back: true = sudah ditangani
  window.otrBack = function () {
    if (!$('#auth').hidden) return false;
    if (TABS.indexOf(cur) < 0) { go(backTarget(cur)); return true; }
    if (cur !== 'calc') { go('calc'); return true; }
    return false;
  };

  /* ---------- binding input ---------- */
  function bindInputs() {
    $$('[data-key]').forEach(function (el) {
      var k = el.dataset.key;
      if (el.classList.contains('seg')) {
        el.addEventListener('click', function (e) {
          var b = e.target.closest('button'); if (!b) return;
          S[k] = b.dataset.v; syncControls(); save(); refresh(k);
        });
        return;
      }
      el.addEventListener('input', function () {
        if (el.dataset.money) {
          var d = digits(el.value); S[k] = d === '' ? '' : Number(d);
          el.value = d === '' ? '' : dots(Number(d));
        } else if (k === 'tahun') {
          S[k] = digits(el.value).slice(0, 4); el.value = S[k];
        } else S[k] = el.value;
        save(); refresh(k);
      });
    });
  }
  function syncControls() {
    $$('[data-key]').forEach(function (el) {
      var k = el.dataset.key;
      if (el.classList.contains('seg')) {
        $$('button', el).forEach(function (b) { b.classList.toggle('on', b.dataset.v === S[k]); });
      } else if (document.activeElement !== el) {
        el.value = el.dataset.money ? (S[k] === '' ? '' : dots(S[k])) : (S[k] == null ? '' : S[k]);
      }
    });
    $$('#angType button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === angTypeNow()); });
    $$('#angMode button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === S.angMode); });
  }
  function refresh(k) {
    if (k === 'otr') S.otrNama = '';
    calc();
    if (k === 'qOtr') renderSearch(true);
    if (k === 'angDana') renderAng();
    if (k === 'fuQ' || k === 'fuFilter') renderFu(true);
    if (k === 'nasabah') updateNasbar();
  }

  /* ---------- Taksasi ---------- */
  var last = null;
  function inputs() {
    return { jenis: S.jenis, tipe: S.tipe, sendiri: S.sendiri, faktur: S.faktur, tglPajak: S.tglPajak, tglKaleng: S.tglKaleng,
      otr: num('otr'), topUp: 'YES', sisaAngsuran: num('sisaAngsuran'), denda: num('denda'), dendaBayar: num('dendaBayar'),
      collFee: num('collFee'), collFeeBayar: num('collFeeBayar') };
  }
  function calc() {
    var r = last = C.hitungTaksasi(CFG, inputs(), new Date());
    var ok = r.siapHitung;
    set('o-tipeAng', r.tipeAngsuran); set('o-tipeAng2', r.tipeAngsuran);
    set('o-maxTenor', ok ? r.maxTenor + ' X' : '-');
    set('o-pajak', !ok ? '-' : (r.pajakTahun === 0 ? 'Pajak Hidup' : r.pajakTahun + ' Tahun'));
    set('o-kaleng', ok ? r.kaleng : '-');
    set('o-faktur', r.faktur);
    $('#o-pajak').className = ok ? (r.pajakTahun === 0 ? 'ok' : 'bad') : '';
    $('#o-kaleng').className = ok ? (r.kaleng === 'Kaleng Hidup' ? 'ok' : 'bad') : '';
    $('#o-faktur').className = r.faktur === 'Ada' ? 'ok' : 'bad';
    set('o-potPajak', ok && r.potPajak ? rp(r.potPajak) : '-');
    set('o-potKaleng', ok && r.potKaleng ? rp(r.potKaleng) : '-');
    set('o-potFaktur', r.potFaktur ? rp(r.potFaktur) : '-');
    set('o-otr', r.otr ? dots(r.otr) : '-');
    set('o-total', ok && r.totalPotongan ? dots(r.totalPotongan) : '-');
    var pb = $('#o-plafond'); pb.textContent = pct(r.plafond, 0);
    pb.className = 'badge ' + (r.plafond <= 0.5 ? 'r' : r.plafond <= 0.75 ? 'y' : 'g');
    set('o-hasil', ok ? rp(r.hasilRumus) : '-');
    set('o-maks', ok && r.otr ? rpJ(r.maksPinjaman) : '-');
    set('o-motor', S.otrNama ? 'Dipilih: ' + S.otrNama : '');
    var h = $('#o-hint');
    if (!ok) { h.textContent = 'Isi tanggal pajak dan tanggal kaleng untuk menghitung potongan.'; h.className = 'hint'; }
    else if (!r.otr) { h.textContent = 'Masukkan OTR, atau tekan Cari untuk mengambil harga pasar.'; h.className = 'hint'; }
    else { h.textContent = ''; h.className = 'hint'; }

    // Top up kontrak lama
    set('k-totalDenda', r.topUp ? rpJ(r.totalDenda) : '-');
    set('k-angDenda', r.topUp ? rpJ(r.angsuranDenda) : '-');
    set('k-maks', ok ? rpJ(r.j14) : '-');
    set('k-sisa', r.topUp ? rpJ(r.j15) : '-');
    set('k-diterima', ok ? rpJ(r.totalDiterima) : '-');
    var fr = S.fuFid ? FU.get(S.fuFid) : null, tn = fr ? col(fr, ['sisatenor']) : '';
    set('k-info', fr ? 'Kontrak ' + (fr.kontrak || '-') + (tn ? ' · sisa tenor ' + tn + ' bulan' : '') : '');
  }
  function calcSummary() {
    if (!last || !last.siapHitung || !last.otr) return '';
    return ['Taksasi OTR' + (S.otrNama ? ' - ' + S.otrNama : ''), 'OTR: ' + rpJ(last.otr), 'Total potongan: ' + rpJ(last.totalPotongan),
      'Plafond: ' + pct(last.plafond, 0) + ' (' + last.tipeAngsuran + ')', 'Maksimal pinjaman: ' + rpJ(last.maksPinjaman)].join('\n');
  }
  var lastTaksasiKey = '';
  function logTaksasi() {
    if (!last || !last.siapHitung || !last.otr) return;
    var d = { jenis: S.jenis, tipe: S.tipe, sendiri: S.sendiri, faktur: S.faktur, tahun: S.tahun, motor: S.otrNama || '', otr: last.otr,
      maks: last.maksPinjaman, plafond: last.plafond, tipeAngsuran: last.tipeAngsuran, pajakTahun: last.pajakTahun, kaleng: last.kaleng, potongan: last.totalPotongan, fid: S.fuFid || '' };
    var key = JSON.stringify(d);
    if (key === lastTaksasiKey) return;
    lastTaksasiKey = key;
    SY.log('taksasi', d);
  }

  /* ---------- Cari OTR ---------- */
  var PAGE = 50, sShown = PAGE, hIdx = null, sRes = [];
  function ensureHarga() {
    if (hIdx || !window.HARGA) return hIdx;
    hIdx = window.HARGA.map(function (r) { return r.slice(0, 7).join(' ').toLowerCase(); });
    return hIdx;
  }
  function renderSearch(reset) {
    if (reset) sShown = PAGE;
    var q = S.qOtr, kws = C.kataKunci(q), out = $('#s-results');
    if (!ensureHarga()) { out.innerHTML = '<p class="hint">Memuat data harga pasar...</p>'; return; }
    sRes = [];
    if (kws.length) {
      var res = kws.map(function (k) { return C.wildcardRegex(k); });
      window.HARGA.forEach(function (r, i) {
        var t = hIdx[i];
        for (var j = 0; j < res.length; j++) if (!res[j].test(t)) return;
        sRes.push(r);
      });
    }
    set('s-count', dots(sRes.length));
    var st = $('#s-status');
    st.textContent = (q.trim() && !sRes.length) ? 'Data tidak ditemukan, periksa kembali kata kunci.' : '';
    st.className = 'hint' + (st.textContent ? ' warn' : '');
    var html = '';
    sRes.slice(0, sShown).forEach(function (r, i) {
      html += '<div class="res"><div class="top"><div><div class="name">' + esc(r[0]) + ' ' + esc(r[1]) + '</div>' +
        '<div class="desc">' + esc(r[3]) + '</div></div><div class="price">' + rp(r[7]) + '</div></div>' +
        '<div class="meta"><em>Tahun ' + esc(r[6]) + '</em><em>' + esc(r[2]) + '</em><em>' + esc(r[4]) + '</em><em>' + esc(r[5]) + '</em></div>' +
        '<button class="btn use" data-i="' + i + '" type="button">Pakai sebagai OTR</button></div>';
    });
    out.innerHTML = html;
    $('#s-more').hidden = sRes.length <= sShown;
  }

  /* ---------- Angsuran ---------- */
  function angTypeNow() {
    var t = S.angType || (last && last.tipeAngsuran) || 'Reguler';
    return CFG.angsuran.types[t] ? t : 'Reguler';
  }
  var MODES = {
    angsuran: { f: function (t, P, n) { return C.angsuran(CFG, t, P, n); }, fmt: function (v) { return 'Rp ' + dots(v); } },
    war: { f: function (t, P, n) { return C.warGross(CFG, t, P, n); }, fmt: function (v) { return pct(v, 1); } },
    split: { f: function (t, P, n) { return C.splittingRate(CFG, t, P, n); }, fmt: function (v) { return pct(v, 1); } }
  };
  var angRows = [];
  function renderAng() {
    var A = CFG.angsuran, t = angTypeNow(), M = MODES[S.angMode] || MODES.angsuran;
    syncControls();
    var mt = last && last.siapHitung ? last.maxTenor : 99;
    set('a-follow', (last && last.tipeAngsuran === t) ? 'Sesuai tipe angsuran dari Taksasi.' : (last ? 'Tipe angsuran Taksasi: ' + last.tipeAngsuran : ''));
    set('a-war', pct(A.types[t].rate, 2));
    set('a-admin', rpJ(A.adminMurni));
    var maks = last && last.maksPinjaman > 0 ? last.maksPinjaman : 0;
    var dana = S.angDana !== '' ? Number(S.angDana) : maks;
    set('a-danaHint', S.angDana === '' ? (maks ? 'Terisi dari Maksimal Pinjaman Taksasi. Ubah bila perlu.' : 'Isi Dana Cair atau hitung Taksasi terlebih dahulu.') : 'Kosongkan untuk memakai Maksimal Pinjaman.');
    var ch = ''; angRows = [];
    if (dana > 0) A.tenors.forEach(function (n) {
      var v = M.fmt(M.f(t, dana, n)); angRows.push(n + ' bulan: ' + v + (n > mt ? ' (lewat maks tenor)' : ''));
      ch += '<div class="' + (n > mt ? 'over' : '') + '"><span>' + n + ' bulan</span><b>' + v + '</b></div>';
    });
    $('#a-custom').innerHTML = ch;
    $('#a-custom').hidden = !ch;
    var hi = -1;
    A.danaCair.forEach(function (d, i) { if (dana >= d) hi = i; });
    var h = '<tr><th>Dana Cair</th>' + A.tenors.map(function (n) { return '<th class="' + (n > mt ? 'over' : '') + '">' + n + ' X</th>'; }).join('') + '</tr>';
    A.danaCair.forEach(function (d, i) {
      h += '<tr class="' + (i === hi ? 'hl' : '') + '"><td>' + dots(d) + '</td>' + A.tenors.map(function (n) {
        var v = M.f(t, d, n); return '<td class="' + (n > mt ? 'over' : '') + '">' + (S.angMode === 'angsuran' ? dots(v) : pct(v, 1)) + '</td>';
      }).join('') + '</tr>';
    });
    $('#a-table').innerHTML = h;
  }

  /* ---------- Follow up: marketing ---------- */
  var ST = {}; FU.STATUS.forEach(function (s) { ST[s[0]] = s[1]; });
  var ORDER = { baru: 0, dihubungi: 1, janji: 2, berhasil: 3, tidak: 4 };
  var AVC = ['#6B3FE0', '#3D63D8', '#D8394A', '#B45F06', '#0B6B4A'];
  function avc(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AVC[h % AVC.length]; }
  function fuTitle(r) { return r.nama || r.kontrak || r.unit || 'Tanpa nama'; }
  var FPAGE = 40, fuShown = FPAGE, fuRes = [];
  function renderFu(reset) {
    var u = SY.user(), off = !SY.enabled(), sup = !!u && u.role !== 'marketing';
    $('#fu-off').hidden = !off;
    $('#fu-mkt').hidden = off || sup || !u;
    $('#fu-sup').hidden = off || !sup;
    if (off || !u) return;
    if (sup) { renderSup(); return; }
    if (reset) fuShown = FPAGE;
    var c = FU.counts();
    set('fu-big', dots(c.baru || 0));
    ['dihubungi', 'janji', 'berhasil'].forEach(function (k) { set('fu-c-' + k, dots(c[k] || 0)); });
    set('fu-sub', c.total ? dots(c.total) + ' nasabah dari supervisor' : 'Belum ada bahan');
    var q = String(S.fuQ || '').trim().toLowerCase(), f = S.fuFilter;
    fuRes = FU.all().filter(function (r) {
      return (f === 'semua' || r.status === f) &&
        (!q || qtext(r).indexOf(q) >= 0);
    }).sort(function (a, b) { return (ORDER[a.status] - ORDER[b.status]) || String(a.fid).localeCompare(String(b.fid), undefined, { numeric: true }); });
    var html = '';
    fuRes.slice(0, fuShown).forEach(function (r) {
      var t = fuTitle(r), sub = [unitLabel(r), r.kontrak].filter(Boolean).join(' · ');
      html += '<button class="fu" type="button" data-fid="' + esc(r.fid) + '"><span class="av" style="background:' + avc(t) + '">' + esc(t.charAt(0).toUpperCase()) + '</span>' +
        '<span class="tt"><b>' + esc(t) + '</b><small>' + esc(sub || 'Tanpa keterangan') + '</small></span>' +
        '<span class="chip ' + r.status + (r.pending ? ' pending' : '') + '">' + esc(ST[r.status]) + '</span></button>';
    });
    $('#fu-list').innerHTML = html;
    $('#fu-more').hidden = fuRes.length <= fuShown;
    var em = $('#fu-empty'); em.hidden = fuRes.length > 0;
    set('fu-emptyTxt', !c.total ? (FU.error() ? FU.error() : 'Belum ada bahan follow up. Supervisor akan mengunggah bahan, lalu tekan tombol segarkan di atas.') : 'Tidak ada nasabah yang cocok.');
  }
  var curFid = null, fdStatus = 'baru';
  function openFu(fid) {
    var r = FU.get(fid); if (!r) return;
    curFid = fid; fdStatus = r.status;
    var t = fuTitle(r);
    var av = $('#fd-av'); av.textContent = t.charAt(0).toUpperCase(); av.style.background = avc(t);
    set('fd-name', t); set('fd-sub', [unitLabel(r), r.kontrak].filter(Boolean).join(' · '));
    var ch = $('#fd-chip'); ch.textContent = ST[r.status]; ch.className = 'chip ' + r.status;
    var hp = digits(r.hp), wa = hp.charAt(0) === '0' ? '62' + hp.slice(1) : hp;
    var tel = $('#fd-tel'), wl = $('#fd-wa');
    tel.hidden = wl.hidden = !hp;
    tel.href = hp ? 'tel:' + hp : '#'; wl.href = hp ? 'https://wa.me/' + wa : '#';
    $('#fd-note').value = r.note || '';
    set('fd-when', r.statusAt ? 'Diperbarui ' + tglFmt(r.statusAt) + (r.pending ? ' · menunggu terkirim' : '') : '');
    $$('#fd-status button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === fdStatus); });
    var lines = '';
    Object.keys(r.cols || {}).forEach(function (k) { lines += '<div><span>' + esc(k) + '</span><b>' + esc(r.cols[k]) + '</b></div>'; });
    $('#fd-cols').innerHTML = lines;
    go('fudetail');
  }
  function saveFu() {
    if (!curFid) return;
    if (FU.setStatus(curFid, fdStatus, $('#fd-note').value.trim())) { toast('Tersimpan' + (SY.state().online ? '' : ' · akan dikirim saat online')); go('fu'); }
  }

  /* ---------- Follow up: supervisor / admin ---------- */
  var MK = ['csid', 'idmarketing', 'idkaryawan', 'marketing', 'namamarketing', 'pic', 'sales', 'petugas'];
  var KOLOM = [['Marketing', MK], ['Nama', ['namakonsumen', 'nama', 'namacustomer', 'namanasabah', 'namadebitur', 'customer', 'debitur']],
    ['No Kontrak', ['nokontrak', 'nomorkontrak', 'kontrak', 'contractno', 'nocontract', 'agreementno']],
    ['No HP', ['nohp', 'nomorhp', 'hp', 'telepon', 'telp', 'notelp', 'handphone', 'whatsapp', 'wa']],
    ['Unit', ['objdesc', 'unit', 'motor', 'kendaraan', 'objmodel', 'merktype', 'tipe', 'type', 'merk']],
    ['Tahun', ['tahun', 'objtahun']], ['Kode unit', ['objtype', 'objcode', 'kodeunit']], ['Tipe CORI', ['tipecori', 'cori']]];
  var nk = function (h) { return String(h).toLowerCase().replace(/[^a-z0-9]/g, ''); };
  var fuParsed = null, fuFile = '';
  function fuSay(t, cls) { var m = $('#fu-msg'); m.textContent = t; m.className = 'hint' + (cls ? ' ' + cls : ''); }
  function pickFuFile(file) {
    if (!file) return;
    fuParsed = null; $('#fu-prev').hidden = true; $('#fu-result').innerHTML = '';
    fuSay('Membaca ' + file.name + ' (file besar bisa butuh beberapa detik)...');
    file.arrayBuffer().then(function (buf) { return window.OTRImport.readTable(buf, fuSay); }).then(function (t) {
      fuParsed = t; fuFile = file.name;
      var found = {}; KOLOM.forEach(function (k) { found[k[0]] = t.headers.some(function (h) { return k[1].indexOf(nk(h)) >= 0; }); });
      var mKey = MK.filter(function (k) { return t.headers.some(function (h) { return nk(h) === k; }); })[0];
      var mCol = t.headers.filter(function (h) { return nk(h) === mKey; })[0], names = {};
      if (mCol) t.rows.forEach(function (r) { if (r[mCol]) names[String(r[mCol])] = 1; });
      $('#fu-prevInfo').innerHTML = '<div><span>File</span><b>' + esc(file.name) + '</b></div><div><span>Sheet</span><b>' + esc(t.sheet) + '</b></div>' +
        '<div><span>Baris data</span><b>' + dots(t.rows.length) + '</b></div><div><span>Marketing di file' + (mCol ? ' (' + esc(mCol) + ')' : '') + '</span><b>' + dots(Object.keys(names).length) + '</b></div>';
      $('#fu-cols').innerHTML = KOLOM.map(function (k) { return '<span class="' + (found[k[0]] ? '' : 'no') + '">' + esc(k[0]) + (found[k[0]] ? '' : ' (tidak ada)') + '</span>'; }).join('');
      $('#f-fuName').value = file.name.replace(/\.xlsx$/i, '');
      $('#btnFuUpload').disabled = !found.Marketing;
      $('#fu-prev').hidden = false;
      var warn = !found.Marketing ? 'Kolom Marketing tidak ditemukan. Tambahkan kolom "CS ID" atau "MARKETING" berisi ID atau nama akun marketing.'
        : t.truncated ? 'Hanya 60.000 baris pertama yang dibaca.'
        : (!found['Kode unit'] && !found.Unit) || !found.Tahun ? 'Kolom Tahun dan Kode unit/Unit tidak lengkap: pencarian harga pasar otomatis tidak akan akurat.' : '';
      fuSay(warn, warn ? 'warn' : '');
    }).catch(function (e) { fuSay('Gagal: ' + (e && e.message ? e.message : e), 'warn'); })
      .then(function () { $('#f-fu').value = ''; });
  }
  function uploadFu() {
    if (!fuParsed) return;
    var b = $('#btnFuUpload'); b.disabled = true; fuSay('Mengunggah 0 dari ' + dots(fuParsed.rows.length) + ' baris...');
    FU.upload($('#f-fuName').value.trim() || fuFile, fuParsed.rows, $('#fu-replace').checked, function (d, n) { fuSay('Mengunggah ' + dots(d) + ' dari ' + dots(n) + ' baris...'); }).then(function (r) {
      var h = '<div class="lines"><div><span>Tersimpan untuk marketing</span><b>' + dots(r.assigned) + ' baris</b></div>' +
        '<div><span>Baru / diperbarui / tetap</span><b>' + dots(r.created) + ' / ' + dots(r.updated) + ' / ' + dots(r.unchanged) + '</b></div>' +
        (r.archived ? '<div><span>Bahan lama diarsipkan</span><b>' + dots(r.archived) + ' baris</b></div>' : '') +
        '<div><span>Tanpa akun (tidak disimpan)</span><b>' + dots(r.unassigned) + ' baris</b></div></div>';
      h += r.perMarketing.map(function (m) { return '<div class="lines"><div><span>' + esc(m.name) + '</span><b>' + dots(m.count) + '</b></div></div>'; }).join('');
      if (r.unmatched.length) h += '<p class="hint warn">Belum ada akun di tim Anda untuk: ' + r.unmatched.slice(0, 12).map(function (u) { return esc(u.value) + ' (' + dots(u.count) + ')'; }).join(', ') + '. Buat akunnya (ID akun = CS ID atau nama sama persis), lalu unggah ulang; status yang sudah ada tidak hilang.</p>';
      $('#fu-result').innerHTML = h;
      $('#fu-prev').hidden = true; fuParsed = null;
      fuSay('Selesai. Marketing menerimanya saat aplikasi mereka tersambung.', 'ok');
      loadProg();
    }).catch(function (e) { fuSay('Gagal: ' + e.message + ' Aman untuk diulang: baris yang sudah masuk tidak akan dobel.', 'warn'); b.disabled = false; });
  }
  var SC = { baru: '#C9CBEB', dihubungi: '#3D63D8', janji: '#F5A623', berhasil: '#0B6B4A', tidak: '#9A9CB8' };
  function loadProg() {
    var box = $('#fu-prog');
    FU.summary().then(function (s) {
      var h = '';
      s.marketing.forEach(function (m) {
        var bars = ['berhasil', 'janji', 'dihubungi', 'tidak', 'baru'].map(function (k) { return m.total && m[k] ? '<i style="width:' + (m[k] / m.total * 100) + '%;background:' + SC[k] + '"></i>' : ''; }).join('');
        h += '<div class="prog"><div class="t"><span>' + esc(m.name) + '</span><span>' + dots(m.total) + ' nasabah</span></div><div class="bars">' + bars + '</div>' +
          '<small>' + (m.total ? dots(m.total - m.baru) + ' sudah dihubungi · ' + dots(m.janji) + ' janji · ' + dots(m.berhasil) + ' berhasil' : 'Belum ada bahan') + '</small></div>';
      });
      if (!s.marketing.length) h = '<p class="hint">Belum ada akun marketing di tim Anda.</p>';
      if (s.unassigned) h += '<p class="hint warn">' + dots(s.unassigned) + ' baris belum punya marketing (kolom Marketing tidak cocok).</p>';
      if (s.batches.length) h += '<p class="hint">Bahan terakhir: ' + esc(s.batches[0].name) + ' · ' + tglFmt(s.batches[0].at) + '</p>';
      box.innerHTML = h;
    }, function (e) { box.innerHTML = '<p class="hint warn">' + esc(e.message) + '</p>'; });
  }
  var supLoaded = false;
  function renderSup() { if (!supLoaded) { supLoaded = true; loadProg(); } }

  function renderSupervisor() {
    var u = SY.user();
    if (!u || (u.role !== 'supervisor' && u.role !== 'admin')) { go('fu'); toast('Halaman ini khusus Supervisor atau Admin.'); return; }
    var msg = $('#sup-msg'); msg.textContent = 'Memuat ringkasan tim...'; msg.className = 'hint c';
    FU.summary().then(function (s) {
      var team = (s.marketing || []).slice().sort(function (a, b) { return (b.berhasil || 0) - (a.berhasil || 0) || (b.total || 0) - (a.total || 0); });
      var total = 0, baru = 0, dihubungi = 0, janji = 0, berhasil = 0;
      team.forEach(function (m) { total += Number(m.total || 0); baru += Number(m.baru || 0); dihubungi += Number(m.dihubungi || 0); janji += Number(m.janji || 0); berhasil += Number(m.berhasil || 0); });
      set('sup-active', dots(team.length)); set('sup-total', dots(total)); set('sup-pending', dots(baru) + ' belum dihubungi');
      set('sup-contacted', dots(dihubungi + janji + berhasil)); set('sup-rate', total ? Math.round(berhasil / total * 100) + '%' : '0%'); set('sup-success', dots(berhasil) + ' nasabah berhasil');
      $('#sup-ranking').innerHTML = team.length ? team.map(function (m, i) {
        var done = Number(m.dihubungi || 0) + Number(m.janji || 0) + Number(m.berhasil || 0), p = m.total ? Math.round(done / m.total * 100) : 0;
        return '<div class="sup-person"><span class="sup-rank">' + (i + 1) + '</span><span class="sup-avatar">' + esc(String(m.name || '?').charAt(0).toUpperCase()) + '</span><span class="sup-name"><b>' + esc(m.name || 'Tanpa nama') + '</b><small>' + dots(m.total || 0) + ' follow up</small></span><span class="sup-progress"><i style="width:' + p + '%"></i><small>' + p + '% ditindaklanjuti</small></span><b class="sup-done">' + dots(m.berhasil || 0) + '</b></div>';
      }).join('') : '<p class="hint c">Belum ada akun Sales Force di tim Anda.</p>';
      var rows = [['Baru', baru, 'baru'], ['Dihubungi', dihubungi, 'dihubungi'], ['Janji', janji, 'janji'], ['Berhasil', berhasil, 'berhasil']];
      $('#sup-status').innerHTML = rows.map(function (r) { var p = total ? Math.max(4, Math.round(r[1] / total * 100)) : 4; return '<div class="sup-status"><div><span>' + r[0] + '</span><b>' + dots(r[1]) + '</b></div><div class="sup-track"><i class="' + r[2] + '" style="width:' + p + '%"></i></div></div>'; }).join('');
      msg.textContent = 'Diperbarui ' + pad2(new Date().getHours()) + ':' + pad2(new Date().getMinutes()); msg.className = 'hint c ok';
    }, function (e) { msg.textContent = e.message || 'Gagal memuat ringkasan tim.'; msg.className = 'hint c warn'; });
  }

  /* ---------- follow up -> harga pasar -> simulasi ---------- */
  function nz(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toUpperCase(); }
  function col(r, keys) {
    var c = r && r.cols || {}, names = Object.keys(c);
    for (var i = 0; i < keys.length; i++) for (var j = 0; j < names.length; j++)
      if (nk(names[j]) === keys[i] && String(c[names[j]]).trim()) return String(c[names[j]]).trim();
    return '';
  }
  function unitLabel(r) { return [r.unit || col(r, ['objdesc', 'unit']), col(r, ['tahun', 'objtahun'])].filter(Boolean).join(' '); }
  var qc = {};
  function qtext(r) {
    var k = r.fid + '|' + r.seq;
    if (!qc[k]) qc[k] = Object.keys(r.cols || {}).map(function (h) { return r.cols[h]; }).join(' ').toLowerCase();
    return qc[k];
  }
  // Cocokkan kode unit (OBJ_TYPE) + tahun ke data harga pasar; cadangan: deskripsi unit + tahun.
  function findHarga(r) {
    var H = window.HARGA || [], t = nz(col(r, ['objtype', 'objcode', 'kodeunit'])), d = nz(col(r, ['objdesc', 'unit'])), y = col(r, ['tahun', 'objtahun']);
    var hit = [];
    if (t && y) hit = H.filter(function (h) { return nz(h[2]) === t && String(h[6]) === y; });
    if (!hit.length && d && y) hit = H.filter(function (h) { return nz(h[3]) === d && String(h[6]) === y; });
    var prices = {}; hit.forEach(function (h) { prices[h[7]] = 1; });
    return { rows: hit, unique: hit.length > 0 && Object.keys(prices).length === 1,
      q: (d ? d.split(' ').slice(0, 4).join(' ') : t) + (y ? ' ' + y : '') };
  }
  var CORI = { 'GOOD LOYAL': 'Good Loyal', 'GOOD': 'Good', 'MEDIUM': 'Medium' };
  function simulateFrom(fid) {
    var r = FU.get(fid); if (!r) return;
    var m = findHarga(r), y = col(r, ['tahun', 'objtahun']), cori = CORI[nz(col(r, ['tipecori', 'cori']))];
    S.fuFid = fid; S.nasabah = r.nama || ''; S.hpNasabah = digits(r.hp);
    S.tahun = /^\d{4}$/.test(y) ? y : '';
    if (cori) S.tipe = cori;
    if (m.rows.length) S.jenis = nz(m.rows[0][0]) === 'HONDA' ? 'Honda' : 'Non Honda';
    S.sendiri = DEF.sendiri; S.faktur = DEF.faktur; S.tglPajak = ''; S.tglKaleng = ''; S.angDana = ''; S.angType = null; lastTaksasiKey = '';
    if (m.unique) { S.otr = Number(m.rows[0][7]); S.otrNama = [m.rows[0][0], m.rows[0][3], m.rows[0][6]].join(' ').replace(/\s+/g, ' ').trim(); }
    else { S.otr = ''; S.otrNama = ''; S.qOtr = m.q; }
    save(); syncControls(); calc();
    if (m.unique) { go('calc'); toast('OTR terisi dari harga pasar. Lengkapi tanggal pajak & kaleng.'); }
    else {
      go('search');
      set('s-ctx', (m.rows.length ? 'Ada beberapa harga untuk ' : 'Belum ada yang persis cocok untuk ') + unitLabel(r) + '. Pilih yang sesuai.');
    }
  }
  function updateNasbar() {
    var show = !!S.nasabah && ['calc', 'ang', 'topup'].indexOf(cur) >= 0;
    $('#nasbar').hidden = !show;
    if (show) set('nasTxt', 'Nasabah: ' + S.nasabah);
  }

  /* ---------- gambar simulasi (JPG) untuk WhatsApp nasabah ---------- */
  var FONT = "'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  var BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  var simJpg = '';
  function waNumber(x) {
    var d = digits(x);
    if (d.charAt(0) === '0') d = '62' + d.slice(1); else if (d.charAt(0) === '8') d = '62' + d;
    return d.length >= 10 && d.length <= 15 ? d : '';
  }
  function simData() {
    var maks = last && last.maksPinjaman > 0 ? last.maksPinjaman : 0;
    var dana = S.angDana !== '' ? Number(S.angDana) : maks;
    if (!dana) return null;
    var t = angTypeNow(), mt = last && last.siapHitung ? last.maxTenor : 99, u = SY.user();
    return { dana: dana, custom: S.angDana !== '' && Number(S.angDana) !== maks, nama: S.nasabah, motor: S.otrNama,
      rows: CFG.angsuran.tenors.filter(function (n) { return n <= mt; }).map(function (n) { return [n, 'Rp ' + dots(C.angsuran(CFG, t, dana, n))]; }),
      oleh: u ? u.name : '', kios: CFG.cabang.nama };
  }
  function captionText(d) {
    return 'Halo' + (d.nama ? ' Bapak/Ibu ' + d.nama : '') + ', berikut simulasi pinjaman' + (d.motor ? ' dengan jaminan ' + d.motor : '') +
      '. ' + (d.custom ? 'Dana cair' : 'Maksimal pinjaman') + ' Rp ' + dots(d.dana) + '. Untuk informasi lebih lanjut silakan hubungi kami.' + (d.oleh ? '\n' + d.oleh + ' - ' + d.kios : '');
  }
  function rrect(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function wrap(c, text, maxW, maxLines) {
    var words = String(text).split(/\s+/), lines = [], line = '';
    words.forEach(function (w) {
      var t = line ? line + ' ' + w : w;
      if (c.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
    });
    if (line) lines.push(line);
    if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] += '...'; }
    return lines;
  }
  // Satu fungsi untuk mengukur (draw=false) lalu menggambar (draw=true) agar tinggi gambar pas.
  function paint(c, d, draw) {
    var W = 1080, P = 60, y = 0, now = new Date();
    function T(txt, x, yy, font, color, align) { if (!draw) return; c.font = font; c.fillStyle = color; c.textAlign = align || 'left'; c.textBaseline = 'alphabetic'; c.fillText(txt, x, yy); }
    function B(x, yy, w, h, r, color) { if (!draw) return; rrect(c, x, yy, w, h, r); c.fillStyle = color; c.fill(); }
    if (draw) { c.fillStyle = '#ECEEF9'; c.fillRect(0, 0, W, 4000); }
    // header
    if (draw) { c.fillStyle = '#1E1F4E'; c.beginPath(); c.moveTo(0, 0); c.lineTo(W, 0); c.lineTo(W, 190); c.arcTo(W, 300, W - 110, 300, 110); c.lineTo(0, 300); c.closePath(); c.fill(); }
    T('Simulasi Pinjaman', P, 128, '800 66px ' + FONT, '#FFFFFF');
    T(d.kios, P, 190, '600 34px ' + FONT, '#C9CBEB');
    T(now.getDate() + ' ' + BULAN[now.getMonth()] + ' ' + now.getFullYear(), P, 244, '500 32px ' + FONT, '#C9CBEB');
    y = 340;
    // penerima & unit
    c.font = '800 52px ' + FONT; var nl = d.nama ? wrap(c, d.nama, W - 2 * P - 80, 2) : [];
    c.font = '600 38px ' + FONT; var ml = d.motor ? wrap(c, d.motor, W - 2 * P - 80, 2) : [];
    if (nl.length || ml.length) {
      var h1 = 40 + (nl.length ? 34 + nl.length * 64 : 0) + (ml.length ? ml.length * 50 + (nl.length ? 10 : 0) : 0) + 30;
      B(P, y, W - 2 * P, h1, 40, '#FFFFFF');
      var yy = y + 40;
      if (nl.length) { T('Untuk', P + 40, yy + 26, '600 30px ' + FONT, '#5F6288'); yy += 34; nl.forEach(function (l) { yy += 64; T(l, P + 40, yy - 10, '800 52px ' + FONT, '#1E1F4E'); }); }
      if (ml.length) { yy += nl.length ? 10 : 0; ml.forEach(function (l) { yy += 50; T(l, P + 40, yy - 10, '600 38px ' + FONT, '#3B3D6E'); }); }
      y += h1 + 30;
    }
    // hasil utama
    B(P, y, W - 2 * P, 300, 56, '#1E1F4E');
    T(d.custom ? 'Dana cair' : 'Maksimal pinjaman', P + 50, y + 90, '600 38px ' + FONT, '#C9CBEB');
    T('Rp ' + dots(d.dana), P + 50, y + 215, '800 ' + (dots(d.dana).length > 9 ? 104 : 118) + 'px ' + FONT, '#FFFFFF');
    y += 330;
    // tabel angsuran
    var n = d.rows.length, th = 120 + n * 100 + 20;
    B(P, y, W - 2 * P, th, 40, '#FFFFFF');
    T('Estimasi angsuran per bulan', P + 40, y + 78, '800 42px ' + FONT, '#1E1F4E');
    d.rows.forEach(function (r, i) {
      var ry = y + 120 + i * 100;
      if (i % 2 === 0) B(P + 20, ry, W - 2 * P - 40, 100, 24, '#F3F4FC');
      T(r[0] + ' bulan', P + 50, ry + 65, '600 42px ' + FONT, '#3B3D6E');
      T(r[1], W - P - 50, ry + 66, '800 46px ' + FONT, '#1E1F4E', 'right');
    });
    y += th + 30;
    // catatan
    c.font = '500 30px ' + FONT;
    var note = wrap(c, 'Simulasi ini hanya estimasi dan bukan penawaran yang mengikat. Nilai akhir dan persetujuan mengikuti hasil survei serta ketentuan yang berlaku.', W - 2 * P, 4);
    note.forEach(function (l, i) { T(l, P, y + 30 + i * 42, '500 30px ' + FONT, '#5F6288'); });
    y += 30 + note.length * 42 + 20;
    if (d.oleh) { T('Disiapkan oleh ' + d.oleh, P, y + 34, '700 32px ' + FONT, '#1E1F4E'); y += 60; }
    return y + 40;
  }
  function drawSim(d) {
    var cv = document.createElement('canvas'), c = cv.getContext('2d');
    cv.width = 1080; cv.height = 10; var H = paint(c, d, false);
    cv.width = 1080; cv.height = Math.max(H, 1350); paint(c, d, true);
    return cv.toDataURL('image/jpeg', 0.92);
  }
  function openSheet() {
    var d = simData();
    if (!d) { toast('Hitung Taksasi dulu atau isi Dana Cair.'); return; }
    if (!$('#pn').querySelector('.view.active')) return;
    simJpg = drawSim(d);
    $('#simImg').src = simJpg; set('sheetMsg', ''); $('#sheetMsg').className = 'hint';
    $('#sheet').hidden = false; syncControls();
  }
  function browserShare(cap) {
    fetch(simJpg).then(function (r) { return r.blob(); }).then(function (b) {
      var f = new File([b], 'simulasi.jpg', { type: 'image/jpeg' });
      if (navigator.canShare && navigator.canShare({ files: [f] })) return navigator.share({ files: [f], text: cap });
      var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'simulasi.jpg'; document.body.appendChild(a); a.click(); a.remove();
      toast('Gambar diunduh');
    }).catch(function () {});
  }
  function shareImage(phone) {
    var d = simData(); if (!d || !simJpg) return;
    var cap = captionText(d);
    if (window.AndroidShare) {
      var ok = false;
      try { ok = window.AndroidShare.shareImage(simJpg.split(',')[1], phone, cap); } catch (e) {}
      if (!ok) toast('Tidak bisa membuka aplikasi untuk berbagi');
    } else browserShare(cap);
  }
  function sendWa() {
    var phone = waNumber(S.hpNasabah);
    if (!phone) { set('sheetMsg', 'Isi nomor WhatsApp nasabah, mis. 0812xxxxxxxx.'); $('#sheetMsg').className = 'hint warn'; return; }
    shareImage(phone);
  }

  /* ---------- Info ---------- */
  function renderInfo() {
    var c = CFG.cabang;
    set('c-kios', c.nama); set('i-sub', c.nama);
    $('#i-cabang').innerHTML = [['Kios', c.nama], ['ID Cabang', c.idCabang], ['ID Kios', c.idKios], ['ID Dealer', c.idDealer], ['ID Dealer DM', c.idDealerDM]]
      .map(function (x) { return '<div><span>' + x[0] + '</span><b>' + esc(x[1]) + '</b></div>'; }).join('');
    var p = CFG.potPajak.map(function (x) { return '<div><span>Pajak mati ' + x[0] + ' tahun</span><b>' + rp(x[1]) + '</b></div>'; });
    p.push('<div><span>Kaleng Mati</span><b>' + rp(CFG.potKaleng) + '</b></div>');
    p.push('<div><span>Tanpa Faktur</span><b>' + rp(CFG.potFaktur) + '</b></div>');
    $('#i-potongan').innerHTML = p.join('');
    var h = '<tr><th>Tipe Customer</th><th>Merk</th><th>TNKB</th><th>Angsuran</th><th>Plafond</th></tr>';
    CFG.plafond.forEach(function (x) {
      h += '<tr><td>' + esc(x.tipe) + '</td><td>' + esc(x.jenis) + '</td><td>' + esc(x.tnkb) + '</td><td>' + esc(x.angsuran) + '</td><td>' + pct(x.plafond, 0) + '</td></tr>';
    });
    $('#i-plafond').innerHTML = h;
    set('i-ver', 'Calculator OTR ' + CFG.versi + ' · mengikuti file Excel TOOLS OTR DAN CALCULATOR ' + CFG.versi + '. Created By Bani Munggaran.');
  }

  /* ---------- Update data harga dari Excel (disimpan di IndexedDB) ---------- */
  var BUNDLED = { harga: window.HARGA };
  var META = { harga: { sumber: 'Bawaan aplikasi', tgl: null } };
  function idb() {
    return new Promise(function (res, rej) {
      var q = indexedDB.open('calculatorotr-data', 1);
      q.onupgradeneeded = function () { q.result.createObjectStore('kv'); };
      q.onsuccess = function () { res(q.result); };
      q.onerror = function () { rej(q.error); };
    });
  }
  function idbOp(mode, fn) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction('kv', mode), st = tx.objectStore('kv'), rq = fn(st);
        tx.oncomplete = function () { res(rq && rq.result); db.close(); };
        tx.onerror = tx.onabort = function () { rej(tx.error); };
      });
    });
  }
  var idbGet = function (k) { return idbOp('readonly', function (s) { return s.get(k); }); };
  var idbSet = function (k, v) { return idbOp('readwrite', function (s) { return s.put(v, k); }); };
  var idbDel = function (k) { return idbOp('readwrite', function (s) { return s.delete(k); }); };
  function metaText(m) { return m.tgl ? m.sumber + ' · ' + tglFmt(m.tgl) : m.sumber; }
  function applyHarga(rows, meta) { window.HARGA = rows; hIdx = null; META.harga = meta; }
  function renderDataStatus() {
    $('#d-status').innerHTML = '<div><span>Harga Pasar</span><b>' + dots((window.HARGA || []).length) + ' baris<br><small>' + esc(metaText(META.harga)) + '</small></b></div>';
    set('s-dataInfo', 'Data harga pasar: ' + metaText(META.harga));
  }
  function refreshAllData() { renderDataStatus(); calc(); renderSearch(true); }
  function loadOverrides() {
    if (!window.indexedDB) return Promise.resolve();
    idbDel('clop').catch(function () {}); // sisa fitur CLOP lama
    return idbGet('harga').then(function (r) { if (r && r.rows) applyHarga(r.rows, r.meta); }).catch(function () {});
  }
  function say(t, cls) { var m = $('#d-msg'); m.textContent = t; m.className = 'hint' + (cls ? ' ' + cls : ''); }
  function importFile(file) {
    if (!file) return;
    say('Membaca ' + file.name + ' ...');
    file.arrayBuffer().then(function (buf) {
      return window.OTRImport.parseFile(buf, function (t) { say(t); });
    }).then(function (r) {
      var meta = { sumber: file.name, tgl: new Date().toISOString() }, old = (window.HARGA || []).length;
      if (old && r.harga.length < old * 0.5 && !confirm('Jumlah baris Harga Pasar turun drastis (' + dots(old) + ' -> ' + dots(r.harga.length) + '). Tetap gunakan file ini?')) throw new Error('Dibatalkan.');
      return idbSet('harga', { rows: r.harga, meta: meta }).then(function () {
        applyHarga(r.harga, meta); refreshAllData(); say('Berhasil diperbarui. Harga Pasar: ' + dots(r.harga.length) + ' baris.', 'ok');
      });
    }).catch(function (e) {
      say('Gagal: ' + (e && e.message ? e.message : e), 'warn');
    }).then(function () { $('#f-xlsx').value = ''; });
  }
  function restoreBundled() {
    if (!confirm('Kembalikan Harga Pasar ke data bawaan aplikasi?')) return;
    idbDel('harga').catch(function () {}).then(function () {
      applyHarga(BUNDLED.harga, { sumber: 'Bawaan aplikasi', tgl: null });
      refreshAllData(); say('Data dikembalikan ke bawaan aplikasi.', 'ok');
    });
  }

  /* ---------- Pengaturan & sinkronisasi ---------- */
  function renderSettings() {
    var st = SY.state(), c = CFG.cabang;
    set('st-cabang', c.nama + ' · ID cabang ' + c.idCabang);
    set('st-ver', 'Aturan taksasi ' + CFG.versi);
    set('st-about', 'Versi ' + (window.APP && window.APP.versi || '') + ' · data ' + CFG.versi + ' · offline');
    $('[data-go="sync"]').hidden = !st.enabled;
    $('#btnLogout').hidden = !st.enabled || !st.user;
    set('st-user', st.user ? st.user.name + ' · ' + st.user.role : '');
    set('st-sync', st.pending ? st.pending + ' data menunggu dikirim' : (st.last ? 'Terakhir sinkron ' + tglFmt(st.last) : 'Semua data terkirim'));
  }
  function qLabel(e) {
    var d = e.data || {}, t = new Date(e.ts), jam = pad2(t.getHours()) + ':' + pad2(t.getMinutes());
    if (e.type === 'taksasi') return ['Taksasi · ' + (d.motor || d.jenis || ''), 'Maks ' + rpJ(d.maks) + ' · ' + jam];
    if (e.type === 'followup') return ['Follow up · ' + (ST[d.status] || d.status), jam];
    return [e.type, jam];
  }
  function renderSync() {
    var st = SY.state();
    var tag = !st.enabled ? 'Tanpa server' : (!st.online ? 'Offline' : (st.pending ? 'Menunggu' : 'Tersinkron'));
    set('y-tag', tag);
    set('y-big', !st.enabled ? 'Server belum diatur' : (st.pending ? st.pending + ' data menunggu' : 'Semua data terkirim'));
    set('y-last', st.last ? 'Terakhir sinkron ' + tglFmt(st.last) : 'Belum pernah sinkron');
    set('y-err', st.error || '');
    $('#btnSyncNow').disabled = !st.enabled || st.busy;
    $('#swAuto').setAttribute('aria-checked', st.auto ? 'true' : 'false');
    var l = SY.list().slice(0, 30);
    $('#y-list').innerHTML = l.length ? l.map(function (e) {
      var q = qLabel(e);
      return '<div class="it"><span class="tt"><b>' + esc(q[0]) + '</b><small>' + esc(q[1]) + '</small></span><span class="chip">Menunggu</span></div>';
    }).join('') : '<p class="hint c">Tidak ada antrean.</p>';
  }

  /* ---------- masuk ---------- */
  var wasIn = false;
  function showAuth(which, msg) {
    document.body.classList.add('auth-on');
    $('#auth').hidden = false;
    $('#v-welcome').hidden = which !== 'welcome';
    $('#v-login').hidden = which !== 'login';
    if (which === 'login') { set('l-msg', msg || ''); $('#l-msg').className = 'hint' + (msg ? ' warn' : ''); }
  }
  function renderRoleBadge() {
    var u = SY.user(), e = $('#hdrRole');
    if (!e) return;
    var labels = { marketing: 'Sales Force', supervisor: 'Supervisor', admin: 'Admin' };
    e.textContent = u ? (labels[u.role] || u.role || '') : '';
    e.hidden = !u;
    e.className = 'hdr-role ' + (u ? 'role-' + u.role : '');
    var tab = $('#tabSup');
    if (tab) tab.hidden = !(u && (u.role === 'supervisor' || u.role === 'admin'));
  }
  function showApp() {
    document.body.classList.remove('auth-on');
    $('#auth').hidden = true;
    wasIn = !!SY.user();
    renderRoleBadge();
    go('calc');
    FU.init().then(function () { FU.pull(); });
  }
  function doLogin() {
    var email = $('#l-email').value.trim().toLowerCase(), pw = $('#l-pw').value;
    if (!email || !pw) { showAuth('login', 'Isi email kerja dan kata sandi.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showAuth('login', 'Masukkan email kerja yang valid.'); return; }
    var b = $('#btnLogin'); b.disabled = true; showAuth('login', '');
    SY.login(email, pw).then(function (u) {
      $('#l-pw').value = ''; supLoaded = false;
      showApp(); toast('Halo, ' + u.name);
    }).catch(function (e) { showAuth('login', e.message); }).then(function () { b.disabled = false; });
  }
  function doLogout() {
    var n = SY.pending();
    if (!confirm(n ? n + ' data belum terkirim dan akan dihapus bila Anda keluar. Tetap keluar?' : 'Keluar dari akun ini?')) return;
    SY.logout(); FU.reset(); supLoaded = false; wasIn = false;
    showAuth('login');
  }

  /* ---------- init ---------- */
  function init() {
    load(); bindInputs(); syncControls(); calc(); renderInfo(); renderDataStatus(); renderSettings();
    loadOverrides().then(refreshAllData);

    $('#btnUpload').addEventListener('click', function () { $('#f-xlsx').click(); });
    $('#f-xlsx').addEventListener('change', function (e) { importFile(e.target.files[0]); });
    $('#btnRestore').addEventListener('click', restoreBundled);
    $('#s-dataInfo').addEventListener('click', function () { go('info'); });

    $$('#pill button').forEach(function (b) { b.addEventListener('click', function () { go(b.dataset.tab); }); });
    $('#btnGear').addEventListener('click', function () { go('settings'); });
    $('#btnBack').addEventListener('click', function () { go(backTarget(cur)); });
    function openSearch() { set('s-ctx', ''); go('search'); setTimeout(function () { $('#f-qOtr').focus(); }, 60); }
    $('#btnSearch').addEventListener('click', openSearch);
    $('#btnCariOtr').addEventListener('click', openSearch);
    $('#btnGoTopup').addEventListener('click', function () { go('topup'); });
    $('#btnAngsuran').addEventListener('click', function () { logTaksasi(); S.angDana = ''; S.angType = null; save(); go('ang'); });
    $('#angType').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; S.angType = b.dataset.v; save(); renderAng(); });
    $('#angMode').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; S.angMode = b.dataset.v; save(); renderAng(); });
    $('#s-more').addEventListener('click', function () { sShown += PAGE; renderSearch(false); });
    $('#s-results').addEventListener('click', function (e) {
      var b = e.target.closest('.use'); if (!b) return;
      var r = sRes[Number(b.dataset.i)]; if (!r) return;
      S.otr = Number(r[7]) || 0; S.otrNama = (r[0] + ' ' + r[1] + ' ' + r[6]).replace(/\s+/g, ' ').trim();
      save(); syncControls(); calc(); go('calc');
    });
    $('#btnReset').addEventListener('click', function () {
      if (!confirm('Kosongkan semua isian?')) return;
      S = Object.assign({}, DEF); lastTaksasiKey = ''; save(); syncControls(); calc(); renderSearch(true); go('calc');
    });
    $('#fab').addEventListener('click', openSheet);
    $('#btnAngImg').addEventListener('click', openSheet);
    $('#btnSheetClose').addEventListener('click', function () { $('#sheet').hidden = true; });
    $('#sheet').addEventListener('click', function (e) { if (e.target.id === 'sheet') $('#sheet').hidden = true; });
    $('#btnSendWa').addEventListener('click', sendWa);
    $('#btnShareImg').addEventListener('click', function () { shareImage(''); });
    $('#btnCopyTxt').addEventListener('click', function () { var d = simData(); if (d) copyText(captionText(d)); });
    $('#nasClear').addEventListener('click', function () { S.nasabah = ''; S.hpNasabah = ''; S.fuFid = ''; save(); syncControls(); updateNasbar(); calc(); });
    $('#btnFdSim').addEventListener('click', function () { simulateFrom(curFid); });
    $('#btnFdTopup').addEventListener('click', function () {
      var r = FU.get(curFid); if (!r) return;
      S.fuFid = curFid; S.nasabah = r.nama || ''; S.hpNasabah = digits(r.hp); save(); syncControls(); calc(); go('topup');
    });

    // follow up
    $('#fu-list').addEventListener('click', function (e) { var b = e.target.closest('.fu'); if (b) openFu(b.dataset.fid); });
    $('#fu-more').addEventListener('click', function () { fuShown += FPAGE; renderFu(false); });
    $('#btnFuSync').addEventListener('click', function () {
      SY.flush().then(function () { return FU.pull(); }).then(function (ok) { toast(ok ? 'Bahan follow up diperbarui' : (FU.error() || SY.state().error || 'Belum berhasil, coba lagi')); renderFu(false); });
    });
    $('#fd-status').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return; fdStatus = b.dataset.v;
      $$('#fd-status button').forEach(function (x) { x.classList.toggle('on', x === b); });
    });
    $('#btnFdSave').addEventListener('click', saveFu);
    FU.on(function () { if (cur === 'fu') renderFu(false); });
    $('#btnFuPick').addEventListener('click', function () { $('#f-fu').click(); });
    $('#f-fu').addEventListener('change', function (e) { pickFuFile(e.target.files[0]); });
    $('#btnFuUpload').addEventListener('click', uploadFu);
    $('#btnFuRefresh').addEventListener('click', loadProg);
    $('#btnSupRefresh').addEventListener('click', renderSupervisor);
    $('#btnSupRefresh2').addEventListener('click', renderSupervisor);

    // pengaturan & sinkronisasi
    $$('[data-go]').forEach(function (b) { b.addEventListener('click', function () { go(b.dataset.go); }); });
    $('#btnHow').addEventListener('click', function () { go('info'); setTimeout(function () { $('#i-how').scrollIntoView(); }, 30); });
    $('#btnLogout').addEventListener('click', doLogout);
    $('#btnSyncNow').addEventListener('click', function () {
      SY.flush().then(function (ok) { toast(ok ? 'Sinkronisasi selesai' : (SY.state().error || 'Belum berhasil, coba lagi')); });
    });
    $('#swAuto').addEventListener('click', function () { SY.setAuto(!SY.state().auto); });
    SY.on(function () {
      renderRoleBadge();
      if (cur === 'sync') renderSync();
      if (cur === 'settings') renderSettings();
      if (wasIn && SY.enabled() && !SY.user() && $('#auth').hidden) { wasIn = false; showAuth('login', 'Sesi berakhir. Silakan masuk lagi.'); }
    });

    // masuk
    $('#btnStart').addEventListener('click', function () {
      try { localStorage.setItem(WK, '1'); } catch (e) {}
      if (SY.enabled() && !SY.user()) showAuth('login'); else showApp();
    });
    $('#btnLogin').addEventListener('click', doLogin);
    $('#l-pw').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });

    var welcomed = false;
    try { welcomed = localStorage.getItem(WK) === '1'; } catch (e) {}
    if (!welcomed) showAuth('welcome');
    else if (SY.enabled() && !SY.user()) showAuth('login');
    else showApp();

    window.addEventListener('load', function () { calc(); });
  }
  document.addEventListener('DOMContentLoaded', init);
})();
