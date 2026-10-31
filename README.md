# Omnichannel Performance Deck

Dashboard omnichannel (Shopee, TikTok Shop, Tokopedia, WhatsApp) dengan Google Sheets sebagai database.
Frontend statis di `public/`, backend berupa Vercel Serverless Functions di `api/`.

```
public/index.html   frontend (upload xlsx/csv diproses di browser)
api/data.js         GET  /api/data    -> baca semua sheet + spreadsheet admin
api/upload.js       POST /api/upload  -> upsert data hasil upload (per batch 500 baris)
api/wa.js           POST /api/wa      -> simpan transaksi WhatsApp
lib/sheets.js       koneksi Google Sheets, definisi sheet/header, auth password
test/api.test.mjs   uji logika dengan Sheets palsu (npm test)
```

## 1. Siapkan Service Account (sekali saja)

1. Google Cloud Console -> buat project -> aktifkan **Google Sheets API**.
2. IAM & Admin -> Service Accounts -> buat akun -> tab Keys -> **Add key (JSON)**.
3. Buka spreadsheet utama dan spreadsheet admin -> **Share** ke `client_email` dari file JSON tadi.
   - Spreadsheet utama: akses **Editor**.
   - Spreadsheet admin (rekonsiliasi): cukup **Viewer**.

## 2. Environment variables

Isi di Vercel (Project -> Settings -> Environment Variables), contoh ada di `.env.example`.

| Variable | Isi |
|---|---|
| `SHEET_ID` | ID spreadsheet utama |
| `SPREADSHEET_ADMIN_ID` | ID spreadsheet admin (opsional) |
| `GOOGLE_CLIENT_EMAIL` | `client_email` dari JSON |
| `GOOGLE_PRIVATE_KEY` | `private_key` dari JSON, salin apa adanya |
| `APP_PASSWORD` | password untuk membuka aplikasi |

## 3. Deploy

```bash
git init && git add . && git commit -m "init"
git remote add origin <url-repo-github>
git push -u origin main
```

Di vercel.com: **Add New -> Project -> Import** repo tersebut -> isi env vars -> Deploy.
Setiap `git push` berikutnya otomatis ter-deploy.

## Development lokal

```bash
npm install
cp .env.example .env.local   # isi nilainya
npx vercel dev
npm test
```

## Catatan

- Tab yang belum ada (Database, Penghasilan, Master Produk, Data_WA, Data_Iklan, Data_Tiktok_Tokped) dibuat otomatis, sama seperti `setupSheet()` di versi GAS.
- Password disimpan di `sessionStorage` browser dan dikirim lewat header `x-app-password`. Ini proteksi dasar, bukan sistem login per pengguna.
- Batas Vercel: respon fungsi 4,5 MB dan durasi 60 detik (plan Hobby). Data `/api/data` dikirim dalam format array ringkas untuk menghemat ukuran. Jika data sudah sangat besar dan mulai gagal dimuat, pertimbangkan memfilter per bulan di sisi server.

## CSS (Tailwind)

Tampilan memakai Tailwind yang **dikompilasi saat build** (`public/tailwind.css`), bukan script `cdn.tailwindcss.com`. Browser tidak lagi menghitung CSS saat halaman berubah, sehingga ganti tab dan menu lebih ringan.

- Di Vercel, CSS dibuat otomatis lewat `buildCommand` di `vercel.json`. Tidak ada yang perlu dijalankan manual.
- Jika Anda menambah class Tailwind baru di `public/index.html` dan ingin mencobanya lokal: `npm install && npm run build:css`.
