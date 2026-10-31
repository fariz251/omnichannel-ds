// Uji gas/Code.gs dengan layanan Google tiruan (in-memory). Jalankan: npm test
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(dir, '../gas/Code.gs'), 'utf8');

// --- Mock layanan Google ---
const tabs = new Map(); // nama tab -> array baris
const props = { APP_PASSWORD: 'rahasia' };

function makeSheet(name) {
  const rows = tabs.get(name);
  const range = (r, c, nr = 1, nc = 1) => ({
    setFontWeight() { return this; }, setBackground() { return this; },
    getValues: () => [(rows[0] || []).slice(0, nc)],
    getDisplayValues: () => rows.map(x => x.map(String)),
    setValue(v) { while (rows.length < r) rows.push([]); rows[r - 1][c - 1] = v; return this; },
    setValues(v) { v.forEach((row, i) => { while (rows.length <= r - 1 + i) rows.push([]); rows[r - 1 + i] = row.slice(); }); return this; },
  });
  return {
    appendRow: (row) => rows.push(row.map(String)),
    getRange: range,
    getLastColumn: () => Math.max(1, ...rows.map(x => x.length)),
    getDataRange: () => ({ getDisplayValues: () => rows.map(x => x.map(String)) }),
    isSheetHidden: () => false,
    getName: () => name,
  };
}
const activeSs = {
  getSheetByName: (n) => (tabs.has(n) ? makeSheet(n) : null),
  insertSheet: (n) => { tabs.set(n, []); return makeSheet(n); },
  getSheets: () => [...tabs.keys()].map(makeSheet),
};

const makeCtx = () => ({
  console,
  SpreadsheetApp: { getActiveSpreadsheet: () => activeSs, openById: () => activeSs },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: {
    MimeType: { JSON: 'JSON' },
    createTextOutput: (t) => ({ text: t, setMimeType() { return this; }, getContent() { return t; } }),
  },
});
let ctx;
const load = () => { ctx = vm.createContext(makeCtx()); vm.runInContext(code, ctx); };
load();

const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text);
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(ok ? 'PASS' : 'FAIL', label, ok ? '' : JSON.stringify({ got, want }));
  if (!ok) process.exitCode = 1;
};
const pw = 'rahasia';
const base = { 'Status Pesanan': 'Selesai', 'Jumlah': '1', 'Harga Setelah Diskon': '1000' };
const DP = 'Diansari Plastik';

eq('doGet health', JSON.parse(ctx.doGet({}).text).success, true);
eq('tanpa password -> 401', post({ action: 'getData' }).code, 401);
eq('password salah -> 401', post({ action: 'getData', password: 'x' }).code, 401);
eq('action tidak dikenal', post({ action: 'hapus', password: pw }).success, false);
eq('JSON rusak tidak crash', JSON.parse(ctx.doPost({ postData: { contents: '{bukan json' } }).text).success, false);

let r = post({ action: 'upload', password: pw, payload: { storeName: DP, fileType: 'pesanan', data: [{ ...base, 'No. Pesanan': 'A', 'SKU Induk': 's1', 'Nama Variasi': 'v1' }] } });
eq('insert awal', [r.success, r.inserted, r.updated], [true, 1, 0]);
eq('6 tab dibuat otomatis', tabs.size, 6);

r = post({ action: 'upload', password: pw, payload: { storeName: DP, fileType: 'pesanan', data: [
  { ...base, 'No. Pesanan': 'A', 'SKU Induk': 's1', 'Nama Variasi': 'v1', 'Jumlah': '2' },
  { ...base, 'No. Pesanan': 'B', 'SKU Induk': 's2', 'Nama Variasi': 'v2' },
  { ...base, 'No. Pesanan': 'B', 'SKU Induk': 's2', 'Nama Variasi': 'v2', 'Jumlah': '5' },
  { ...base, 'No. Pesanan': '', 'SKU Induk': '', 'Nama Variasi': '' },
] } });
eq('upsert: 1 insert, 2 update', [r.inserted, r.updated], [1, 2]);
const db = tabs.get('Database');
eq('jumlah baris', db.length, 3);
eq('B final', [db[2][0], String(db[2][9]), db[2][12]], ['B', '5', DP]);

r = post({ action: 'upload', password: pw, payload: { storeName: DP, fileType: 'pesanan', data: [{ ...base, 'No. Pesanan': 'A', 'SKU Induk': 's1', 'Nama Variasi': 'v1', 'Jumlah': '2' }] } });
eq('upload ulang identik = no-op', [r.inserted, r.updated], [0, 0]);

r = post({ action: 'upload', password: pw, payload: { storeName: 'Mitra Diansari', fileType: 'pesanan', data: [{ ...base, 'No. Pesanan': 'A', 'SKU Induk': 's1', 'Nama Variasi': 'v1' }] } });
eq('toko lain tidak menimpa toko pertama', [r.inserted, r.updated], [1, 0]);
eq('baris Diansari tetap utuh', [String(db[1][9]), db[1][12]], ['2', DP]);

r = post({ action: 'upload', password: pw, payload: { storeName: '', fileType: 'pesanan', data: [{ 'No. Pesanan': 'Z' }] } });
eq('tanpa nama toko ditolak', r.success, false);

r = post({ action: 'upload', password: pw, payload: { storeName: DP, fileType: 'tiktok', data: [{ 'Tanggal': '2026-10-01', 'Platform': 'TikTok Shop', 'GMV (Omset)': 5000, 'Pesanan': 2 }] } });
eq('tiktok insert', [r.inserted, r.updated], [1, 0]);

r = post({ action: 'saveWa', password: pw, payload: { tanggal: '2026-10-31', sku: 'D-01', varian: 'Hitam', qty: 1, hargaJual: 100, hpp: 60, laba: 40, margin: 40, status: 'Sukses', toko: DP } });
eq('simpan WA', r.success, true);

// Spreadsheet admin: sheet berisi kolom NO PESANAN + TANGGAL PENCATATAN
props.SPREADSHEET_ADMIN_ID = 'admin-id';
tabs.set('AGUSTUS MITRA', [['NO PESANAN', 'TANGGAL PENCATATAN'], ['A', '2026-10-02']]);
load(); // eksekusi baru agar konstanta membaca property baru
r = post({ action: 'getData', password: pw });
eq('getData sukses + 6 tabel', [r.success, Object.keys(r.tables).length], [true, 6]);
eq('tabel pesanan = header + 3 baris', r.tables.pesanan.length, 4);
eq('rekon admin terbaca [tgl, sheet]', r.adminOrders['A'], ['2026-10-02', 'AGUSTUS MITRA']);
