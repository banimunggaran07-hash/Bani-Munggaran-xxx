# Calculator OTR (Android)

Aplikasi WebView untuk taksasi motor, estimasi angsuran, dan follow up nasabah, mengikuti file Excel TOOLS OTR DAN CALCULATOR V1.3.
Kode web ada di `app/src/main/assets/www` (buka `index.html` lewat server statis apa pun untuk uji cepat).
Package: `com.bani.calculatorotr` | minSdk 26 (Android 8+) | versi 1.2.1

## Fitur

| Tab / layar | Isi |
|---|---|
| **Taksasi** | Kalkulator OTR, potongan, plafond, maksimal pinjaman. Tombol **Cari** membuka pencarian harga pasar. Tautan **Hitung top up** untuk kontrak lama. |
| **Angsuran** | Estimasi angsuran per tenor (Reguler/Awda, angsuran/WAR gross/splitting rate). |
| **Follow up** | Marketing: daftar nasabah dari supervisor, telepon/WhatsApp, ubah status + catatan, dan tombol **Cari harga pasar & simulasikan** yang langsung mengisi OTR. Supervisor/admin: unggah Excel bahan follow up dan pantau progres tim. |
| **Data** | Update harga pasar dari Excel, data cabang, potongan, plafond, cara kerja. |
| **Pengaturan** (ikon gear) | Pintasan data, sinkronisasi, keluar akun, tentang. |

Fitur **Cek CLOP** sudah dihapus dan digantikan oleh **Follow up**. Data `data-clop.js` tidak lagi dibundel.

## Dua mode

* **Offline** (`apiBase` kosong di `config.js`): berjalan seperti sebelumnya, tanpa login. Tab Follow up menampilkan pemberitahuan "Butuh server".
* **Terhubung server** (`apiBase` diisi): login wajib, hasil kerja dikirim otomatis saat ada internet, bahan follow up diterima dari supervisor.

Aktifkan dengan mengedit `app/src/main/assets/www/config.js`:

```js
window.APP = { apiBase: 'https://otr.perusahaan.co.id', versi: '1.1.0' };
```

`apiBase` harus **https** (Android memblokir http biasa).

## Alur follow up

1. Supervisor login di aplikasi, buka tab **Follow up**, pilih file Excel, cek pratinjau, lalu **Unggah & bagikan**.
2. Server membagi baris ke marketing berdasarkan kolom **Marketing** (cocok dengan ID atau nama akun, hanya marketing di tim yang sama; admin bisa semua tim).
3. Aplikasi marketing menarik bahan otomatis setelah sinkron (atau tombol segarkan). Data tersimpan di HP, jadi tetap bisa dibuka tanpa internet.
4. Marketing mengubah status (Baru, Dihubungi, Janji, Berhasil, Tidak berminat) dan catatan. Perubahan masuk antrean dan dikirim saat online.
5. Supervisor melihat progres per marketing di tab yang sama.

### Format Excel bahan follow up

Format yang dipakai: sheet **BAHAN FOLLOW UP** (dibaca otomatis; sheet lain seperti data mentah 133 kolom tidak dibaca). Baris pertama berisi judul kolom. Maksimal 60.000 baris; file diunggah bertahap (1.500 baris per permintaan), jadi file 28 ribu baris aman. Contoh: `contoh-bahan-follow-up.xlsx`.

| Kolom | Fungsi |
|---|---|
| `CS ID` atau `MARKETING` | **Wajib.** Dicocokkan dengan **ID akun** atau **nama akun** marketing. Disarankan ID akun = CS ID. |
| `NAMA KONSUMEN` | Judul kartu dan nama di gambar simulasi |
| `NO KONTRAK` | Kunci baris: unggah ulang memperbarui baris yang sama tanpa menghapus status/catatan |
| `NO HP` | Tombol telepon/WhatsApp dan nomor tujuan gambar (angka 0 di depan dipulihkan otomatis) |
| `TAHUN`, `OBJ_TYPE`, `OBJ_DESC` | Dicocokkan ke data harga pasar untuk mengisi OTR otomatis |
| `TIPE CORI` | GOOD LOYAL / GOOD / MEDIUM otomatis memilih tipe customer; tipe lain (GOLD, SILVER, dst.) dipilih manual |
| kolom lain (NOPOL, SISA TENOR, cabang, dst.) | Tetap tampil di layar detail dan ikut dicari |

**Baris untuk marketing yang belum punya akun tidak disimpan** di server (hanya dilaporkan setelah unggah). Buat akunnya lalu unggah ulang; baris yang sudah ada tidak dobel.

### Cari harga pasar & simulasi langsung

Di layar detail nasabah, tombol **Cari harga pasar & simulasikan** mencocokkan `OBJ_TYPE` + `TAHUN` (cadangan: `OBJ_DESC` + `TAHUN`) ke data harga pasar. Jika harganya satu, OTR, tahun, dan jenis motor terisi dan langsung ke Taksasi; jika ada beberapa harga atau tidak persis cocok, pencarian terbuka dengan kata kunci terisi. Marketing tinggal melengkapi tanggal pajak dan kaleng. Nama nasabah tampil sebagai banner, dan ikut terisi di kolom **Nama nasabah** kalkulator top up.

### Kirim gambar simulasi ke WhatsApp nasabah

Di layar Angsuran (tombol koral, atau tombol bagikan di pojok kanan bawah) aplikasi membuat gambar JPG: nama nasabah, unit, maksimal pinjaman, dan angsuran per tenor (hanya tenor yang diizinkan). Nomor WhatsApp terisi dari `NO HP` dan bisa diubah. Tombol **Kirim ke WhatsApp nasabah** membuka obrolan nasabah dengan gambar terlampir lewat jembatan Kotlin `AndroidShare` (FileProvider), atau **Bagikan ke aplikasi lain**. Jika WhatsApp tidak mengenali nomor tujuan, ia akan meminta memilih kontak; marketing tetap bisa menekan kirim.

Unggahan baru mengarsipkan bahan sebelumnya milik supervisor yang sama (bisa dimatikan lewat kotak centang). Baris yang kolom Marketing-nya tidak cocok dilaporkan setelah unggah.

## Server

Folder `server/` berisi server referensi tanpa dependensi (Node.js 18+).

```bash
cd server
node server.js adduser admin1 admin@perusahaan.co.id "Admin" admin "Pusat" "kata-sandi-kuat"
node server.js adduser hendra hendra@perusahaan.co.id "Hendra" supervisor "Parung Panjang" "kata-sandi-kuat"
node server.js adduser andi   andi@perusahaan.co.id   "Andi"   marketing  "Parung Panjang" "kata-sandi-kuat"
node server.js            # mendengarkan di port 8080
```

Untuk akun lama yang sebelumnya hanya memiliki ID, tambahkan email tanpa menghapus data dengan perintah: `node server.js setemail andi andi@perusahaan.co.id`.

Pilot ini menerima login memakai **email kerja + kata sandi**. Akun tetap dibuat oleh admin/server; belum ada verifikasi email atau reset kata sandi melalui SMTP. Untuk menghubungkan APK, isi `apiBase` di `app/src/main/assets/www/config.js`, misalnya `https://otr.perusahaan.co.id`.

Variabel lingkungan: `PORT`, `DATA_DIR` (default `server/data`), `CORS_ORIGIN` (default `https://appassets.androidplatform.net`, asal halaman di WebView), `TOKEN_SECRET`.

Peran: **marketing** (melihat dan mengubah bahan miliknya), **supervisor** (unggah bahan, ringkasan tim), **admin** (semua tim, kelola akun lewat `/api/admin/users`).

| Endpoint | Fungsi |
|---|---|
| `POST /api/login` | Email + kata sandi, mengembalikan token (berlaku 30 hari); ID lama masih diterima sebagai fallback |
| `POST /api/events` | Terima antrean sinkronisasi (idempoten per id event) |
| `GET /api/followup?since=` | Bahan follow up milik marketing (bertahap, berdasarkan nomor urut) |
| `POST /api/followup/upload` | Unggah bahan bertahap (supervisor/admin), upsert per nomor kontrak |
| `GET /api/followup/summary` | Progres per marketing (supervisor/admin) |
| `GET/POST /api/admin/users` | Daftar dan buat akun (admin) |

**Sebelum dipakai sungguhan:** jalankan di belakang HTTPS (reverse proxy), pindahkan penyimpanan dari file JSON ke database (PostgreSQL/MySQL), atur backup, tambahkan verifikasi/reset email melalui SMTP, dan pastikan bagian IT/compliance menyetujui pengelolaan data nasabah. Bahan follow up berisi data pribadi (nama, nomor HP, nomor kontrak): batasi siapa yang boleh menjadi supervisor/admin, dan hapus bahan yang sudah tidak diperlukan.

## Data yang dikirim dari HP marketing

Hanya ringkasan hitungan (jenis motor, tipe customer, OTR, maksimal pinjaman, plafond, dst.), id baris follow up (berisi nomor kontrak), serta status/catatan follow up. Nama nasabah dan nomor HP tidak dikirim balik dari HP; nama yang diketik di kalkulator top up hanya tersimpan di HP. Catatan bebas yang diketik marketing ikut terkirim, jadi hindari menulis data sensitif di sana.

## Build

Android `allowBackup` dimatikan agar data nasabah yang tersimpan di HP tidak ikut tercadangkan. `gradle assembleDebug` (workflow GitHub Actions `Build APK` sudah tersedia). Untuk tampilan persis desain, taruh `PlusJakartaSans.woff2` di `assets/www/fonts/` dan aktifkan `@font-face` di `app.css`.
