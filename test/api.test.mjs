// Uji logika API dengan Google Sheets palsu (in-memory). Jalankan: npm test
import { google } from 'googleapis';

process.env.APP_PASSWORD = 'x';
process.env.SHEET_ID = 'sid';
process.env.GOOGLE_CLIENT_EMAIL = 'a@b.c';
process.env.GOOGLE_PRIVATE_KEY = 'k';

const store = new Map(); // judul tab -> baris
const colNum = s => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
const parseRange = r => { const [t, a] = r.split('!'); return { title: t.replace(/^'|'$/g, '').replace(/''/g, "'"), a }; };

const fake = { spreadsheets: {
  get: async () => ({ data: { sheets: [...store.keys()].map(t => ({ properties: { title: t, sheetId: 1, gridProperties: { rowCount: 1000, columnCount: 26 } } })) } }),
  batchUpdate: async ({ requestBody }) => { for (const r of requestBody.requests) if (r.addSheet) store.set(r.addSheet.properties.title, []); return {}; },
  values: {
    batchUpdate: async ({ requestBody }) => {
      for (const d of requestBody.data) {
        const { title, a } = parseRange(d.range); const m = a.match(/^([A-Z]+)(\d+)/);
        const row0 = +m[2] - 1; const c0 = colNum(m[1]) - 1; const rows = store.get(title);
        d.values.forEach((vals, i) => {
          while (rows.length <= row0 + i) rows.push([]);
          const r = rows[row0 + i];
          vals.forEach((v, j) => { while (r.length <= c0 + j) r.push(''); r[c0 + j] = String(v); });
        });
      }
      return {};
    },
    get: async ({ range }) => ({ data: { values: (store.get(parseRange(range).title) || []).map(r => [...r]) } }),
    batchGet: async ({ ranges }) => ({ data: { valueRanges: ranges.map(rg => { const { title, a } = parseRange(rg); const rows = store.get(title) || []; return { values: a === '1:1' ? [rows[0] || []] : rows }; }) } }),
    append: async ({ range, requestBody }) => { store.get(parseRange(range).title).push(...requestBody.values.map(r => r.map(String))); return {}; },
  },
} };
google.sheets = () => fake;

const up = (await import('../api/upload.js')).default;
const wa = (await import('../api/wa.js')).default;
const data = (await import('../api/data.js')).default;

const call = async (h, method, body, pw = 'x') => {
  const o = { code: 0, body: null };
  await h({ method, headers: pw ? { 'x-app-password': pw } : {}, body }, { setHeader() {}, status(c) { o.code = c; return this; }, json(b) { o.body = b; return this; } });
  return o;
};
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(ok ? 'PASS' : 'FAIL', label, ok ? '' : JSON.stringify({ got, want }));
  if (!ok) process.exitCode = 1;
};

const base = { 'Status Pesanan': 'Selesai', 'Jumlah': '1', 'Harga Setelah Diskon': '1000' };
const DP = 'Diansari Plastik';

eq('tanpa password -> 401', (await call(data, 'GET', undefined, '')).code, 401);
eq('password salah -> 401', (await call(data, 'GET', undefined, 'salah')).code, 401);
eq('method salah -> 405', (await call(data, 'POST')).code, 405);

let r = await call(up, 'POST', { storeName: DP, fileType: 'pesanan', data: [{ ...base, 'No. Pesanan': 'A', 'SKU Induk': 's1', 'Nama Variasi': 'v1' }] });
eq('insert awal', [r.body.inserted, r.body.updated], [1, 0]);
eq('6 tab dibuat otomatis', store.size, 6);

r = await call(up, 'POST', { storeName: DP, fileType: 'pesanan', data: [
  { ...base, 'No. Pesanan': 'A', 'SKU Induk': 's1', 'Nama Variasi': 'v1', 'Jumlah': '2' },
  { ...base, 'No. Pesanan': 'B', 'SKU Induk': 's2', 'Nama Variasi': 'v2' },
  { ...base, 'No. Pesanan': 'B', 'SKU Induk': 's2', 'Nama Variasi': 'v2', 'Jumlah': '5' },
  { ...base, 'No. Pesanan': '', 'SKU Induk': '', 'Nama Variasi': '' },
] });
eq('upsert: 1 insert, 2 update, baris kosong dilewati', [r.body.inserted, r.body.updated], [1, 2]);
const db = store.get('Database');
eq('jumlah baris', db.length, 3);
eq('A ter-update', db[1][9], '2');
eq('B final (update atas baris yang baru di-insert)', [db[2][0], db[2][9], db[2][12]], ['B', '5', DP]);

r = await call(up, 'POST', { storeName: DP, fileType: 'pesanan', data: [{ ...base, 'No. Pesanan': 'A', 'SKU Induk': 's1', 'Nama Variasi': 'v1', 'Jumlah': '2' }] });
eq('upload ulang identik = no-op', [r.body.inserted, r.body.updated], [0, 0]);

r = await call(up, 'POST', { storeName: 'Mitra Diansari', fileType: 'pesanan', data: [{ ...base, 'No. Pesanan': 'A', 'SKU Induk': 's1', 'Nama Variasi': 'v1' }] });
eq('toko lain tidak menimpa toko pertama', [r.body.inserted, r.body.updated], [1, 0]);
eq('baris Diansari tetap utuh', [db[1][9], db[1][12]], ['2', DP]);

// Data lama tanpa Nama Toko: dianggap milik toko yang diupload (tidak duplikat)
db.push(['LEGACY', '', '', '', '', '', '', 's9', 'v9', '1', '1000', '', '']);
r = await call(up, 'POST', { storeName: DP, fileType: 'pesanan', data: [{ ...base, 'No. Pesanan': 'LEGACY', 'SKU Induk': 's9', 'Nama Variasi': 'v9' }] });
eq('data lama tanpa Nama Toko tidak diduplikasi', r.body.inserted, 0);

r = await call(up, 'POST', { storeName: DP, fileType: 'tiktok', data: [{ 'Tanggal': '2026-10-01', 'Platform': 'TikTok Shop', 'GMV (Omset)': 5000, 'Pesanan': 2 }] });
eq('tiktok insert', [r.body.inserted, r.body.updated], [1, 0]);

r = await call(wa, 'POST', { tanggal: '2026-10-31', sku: 'D-01', varian: 'Hitam', qty: 1, hargaJual: 100, hpp: 60, laba: 40, margin: 40, status: 'Sukses' });
eq('simpan WA', r.code, 200);
eq('WA tanpa field wajib -> 400', (await call(wa, 'POST', {})).code, 400);

r = await call(data, 'GET');
eq('GET data: 6 tabel', [r.code, Object.keys(r.body.tables).length], [200, 6]);
eq('tabel pesanan = header + 4 baris', r.body.tables.pesanan.length, 5);
