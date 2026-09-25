/*
 * Pengaturan server.
 * apiBase kosong  -> aplikasi berjalan offline seperti sebelumnya (tanpa login & sinkronisasi).
 * apiBase diisi   -> login email wajib, hasil kerja dikirim ke server saat ada internet.
 * Harus https:// (Android memblokir http biasa). Contoh: 'https://otr.perusahaan.co.id'
 */
window.APP = { apiBase: 'https://3000-im7uvu8ns1esmp6wl81ah-e266aadb.sg2.manus.computer', versi: '1.4.0' };
