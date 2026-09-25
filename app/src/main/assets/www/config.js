/*
 * Pengaturan server.
 * apiBase kosong  -> aplikasi berjalan offline seperti sebelumnya (tanpa login & sinkronisasi).
 * apiBase diisi   -> login email wajib, hasil kerja dikirim ke server saat ada internet.
 * Harus https:// (Android memblokir http biasa). Contoh: 'https://otr.perusahaan.co.id'
 */
window.APP = { apiBase: 'https://calcotrweb-9b9dshof.manus.space', versi: '1.6.0' };
