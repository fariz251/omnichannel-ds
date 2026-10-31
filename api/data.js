import { SHEETS, ensureSheets, getClient, getSpreadsheetId, quoteSheet, guard } from '../lib/sheets.js';

const TABLE_KEYS = ['pesanan', 'penghasilan', 'master', 'wa', 'iklan', 'tiktok'];

// Membaca semua sheet visible di spreadsheet admin -> { "NO PESANAN": [tgl, namaSheet] }
async function readAdminOrders(sheets) {
  const adminId = process.env.SPREADSHEET_ADMIN_ID;
  if (!adminId) return {};
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: adminId, fields: 'sheets.properties(title,hidden)' });
    const titles = meta.data.sheets.map(s => s.properties).filter(p => !p.hidden).map(p => p.title);
    if (!titles.length) return {};

    const r = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: adminId,
      ranges: titles.map(quoteSheet),
      valueRenderOption: 'FORMATTED_VALUE',
    });

    const orders = {};
    r.data.valueRanges.forEach((vr, k) => {
      const raw = vr.values || [];
      if (!raw.length) return;
      const headers = raw[0].map(h => String(h).trim().toUpperCase());
      const idxId = headers.indexOf('NO PESANAN');
      if (idxId === -1) return;
      let idxTgl = headers.indexOf('TANGGAL PENCATATAN');
      if (idxTgl === -1) idxTgl = headers.indexOf('TANGGAL');
      for (let i = 1; i < raw.length; i++) {
        const id = String(raw[i][idxId] ?? '').trim();
        if (!id) continue;
        const tgl = idxTgl !== -1 ? String(raw[i][idxTgl] ?? '').trim() : '-';
        orders[id] = [tgl, titles[k]];
      }
    });
    return orders;
  } catch (e) {
    console.error('Gagal membaca Spreadsheet Admin: ' + e.message);
    return {};
  }
}

export default async function handler(req, res) {
  if (!guard(req, res, 'GET')) return;
  try {
    await ensureSheets();
    const sheets = getClient();
    const spreadsheetId = getSpreadsheetId();

    const [main, adminOrders] = await Promise.all([
      sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: TABLE_KEYS.map(k => quoteSheet(SHEETS[k].name)),
        valueRenderOption: 'FORMATTED_VALUE',
      }),
      readAdminOrders(sheets),
    ]);

    // Dikirim sebagai array-of-arrays (header + baris) agar payload ringkas;
    // frontend yang mengubahnya menjadi array objek.
    const tables = {};
    TABLE_KEYS.forEach((k, i) => { tables[k] = main.data.valueRanges[i].values || []; });

    res.status(200).json({ success: true, tables, adminOrders });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Gagal memuat data: ' + (error.message || String(error)) });
  }
}
