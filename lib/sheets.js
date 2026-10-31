import { google } from 'googleapis';
import { timingSafeEqual } from 'node:crypto';

// ---------------------------------------------------------------
// Definisi sheet & header (sama persis dengan Code.gs versi GAS)
// ---------------------------------------------------------------
export const SHEETS = {
  pesanan: {
    name: 'Database',
    headers: ["No. Pesanan", "Status Pesanan", "Alasan Pembatalan", "Status Pembatalan/Pengembalian", "Waktu Pesanan Dibuat", "Waktu Pengiriman Diatur", "Metode Pembayaran", "SKU Induk", "Nama Variasi", "Jumlah", "Harga Setelah Diskon", "Provinsi", "Nama Toko"],
    keyCols: ["No. Pesanan", "SKU Induk", "Nama Variasi"],
  },
  penghasilan: {
    name: 'Penghasilan',
    headers: ["No. Pesanan", "Lihat berdasarkan", "No Pengajuan", "ID Produk", "Nama Produk", "Waktu Pesanan Dibuat", "Tanggal Dana Dilepaskan", "Total Penghasilan", "Nama Toko"],
    keyCols: ["No. Pesanan"],
  },
  master: {
    name: 'Master Produk',
    headers: ["SKU Induk", "Nama Variasi", "HPP (Modal)"],
    keyCols: [],
  },
  wa: {
    name: 'Data_WA',
    headers: ["Tanggal", "No. Transaksi", "Status", "Alasan", "SKU Induk", "Varian", "Qty", "Harga Jual (Gross)", "HPP (Modal)", "Laba Bersih", "Margin (%)", "Nama Toko"],
    keyCols: [],
  },
  iklan: {
    name: 'Data_Iklan',
    headers: ["Nama Iklan", "Jenis Iklan", "Kode Produk", "Tanggal Mulai", "Tanggal Selesai", "Biaya", "Omzet Penjualan", "Produk Terjual", "Nama Toko", "Periode Laporan"],
    keyCols: ["Nama Iklan", "Kode Produk", "Tanggal Mulai", "Periode Laporan"],
  },
  tiktok: {
    name: 'Data_Tiktok_Tokped',
    headers: ["Tanggal", "Platform", "Nama Toko", "GMV (Omset)", "Pesanan", "Pembeli", "Produk Terjual", "Pengembalian Dana", "Pesanan SKU", "Pendapatan Bruto"],
    keyCols: ["Tanggal", "Platform"],
  },
};

// fileType dari frontend -> definisi sheet
export function sheetKeyForFileType(fileType) {
  if (fileType === 'penghasilan') return 'penghasilan';
  if (fileType === 'iklan') return 'iklan';
  if (fileType === 'tiktok' || fileType === 'tokopedia') return 'tiktok';
  return 'pesanan';
}

export const NUMERIC_HEADERS = new Set([
  "Harga Setelah Diskon", "Jumlah", "Total Penghasilan", "Biaya", "Omzet Penjualan",
  "Produk Terjual", "GMV (Omset)", "Pesanan", "Pembeli", "Pengembalian Dana",
  "Pesanan SKU", "Pendapatan Bruto",
]);

// ---------------------------------------------------------------
// Client Google Sheets (Service Account)
// ---------------------------------------------------------------
let _client = null;

export function getSpreadsheetId() {
  const id = process.env.SHEET_ID;
  if (!id) throw new Error('Environment variable SHEET_ID belum diisi');
  return id;
}

export function getClient() {
  if (_client) return _client;
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  let key = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key) throw new Error('GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY belum diisi');
  key = key.trim().replace(/^"|"$/g, '').replace(/\\n/g, '\n');
  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  _client = google.sheets({ version: 'v4', auth });
  return _client;
}

export function quoteSheet(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

export function colLetter(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// ---------------------------------------------------------------
// Pengganti setupSheet(): pastikan semua tab + header ada
// ---------------------------------------------------------------
let _ready = false;

export async function ensureSheets() {
  if (_ready) return;
  const sheets = getClient();
  const spreadsheetId = getSpreadsheetId();

  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(title,sheetId)' });
  const existing = new Set(meta.data.sheets.map(s => s.properties.title));

  const missing = Object.values(SHEETS).filter(s => !existing.has(s.name));
  if (missing.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: missing.map(s => ({ addSheet: { properties: { title: s.name } } })) },
    });
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: missing.map(s => ({ range: `${quoteSheet(s.name)}!A1`, values: [s.headers] })),
      },
    });
  }

  // Migrasi header untuk sheet lama (Data_WA -> "Nama Toko", Data_Iklan -> "Periode Laporan")
  const legacy = [SHEETS.wa, SHEETS.iklan].filter(s => existing.has(s.name));
  if (legacy.length) {
    const r = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: legacy.map(s => `${quoteSheet(s.name)}!1:1`),
    });
    const updates = [];
    r.data.valueRanges.forEach((vr, i) => {
      const hdr = (vr.values && vr.values[0]) || [];
      const required = legacy[i].headers[legacy[i].headers.length - 1];
      if (hdr.indexOf(required) === -1) {
        updates.push({ range: `${quoteSheet(legacy[i].name)}!${colLetter(hdr.length + 1)}1`, values: [[required]] });
      }
    });
    if (updates.length) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: 'RAW', data: updates },
      });
    }
  }

  _ready = true;
}

// Pastikan grid sheet cukup besar sebelum menulis (values.update tidak auto-expand)
export async function ensureGrid(title, rowsNeeded, colsNeeded) {
  const sheets = getClient();
  const spreadsheetId = getSpreadsheetId();
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(title,sheetId,gridProperties)' });
  const p = meta.data.sheets.map(s => s.properties).find(s => s.title === title);
  if (!p) throw new Error(`Sheet "${title}" tidak ditemukan`);
  const requests = [];
  const rowCount = p.gridProperties.rowCount || 0;
  const colCount = p.gridProperties.columnCount || 0;
  if (rowsNeeded > rowCount) requests.push({ appendDimension: { sheetId: p.sheetId, dimension: 'ROWS', length: rowsNeeded - rowCount } });
  if (colsNeeded > colCount) requests.push({ appendDimension: { sheetId: p.sheetId, dimension: 'COLUMNS', length: colsNeeded - colCount } });
  if (requests.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

// ---------------------------------------------------------------
// Auth sederhana (pengganti sesi Google di GAS)
// ---------------------------------------------------------------
export function guard(req, res, method) {
  if (req.method !== method) {
    res.setHeader('Allow', method);
    res.status(405).json({ success: false, message: 'Method not allowed' });
    return false;
  }
  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    res.status(500).json({ success: false, message: 'APP_PASSWORD belum diatur di environment variables' });
    return false;
  }
  const a = Buffer.from(String(req.headers['x-app-password'] || ''));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ success: false, message: 'Password salah atau belum diisi' });
    return false;
  }
  return true;
}
