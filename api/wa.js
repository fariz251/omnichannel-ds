import { SHEETS, ensureSheets, getClient, getSpreadsheetId, quoteSheet, guard } from '../lib/sheets.js';

// Port dari saveWaTransaction() di Code.gs
export default async function handler(req, res) {
  if (!guard(req, res, 'POST')) return;
  try {
    const f = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    if (!f.tanggal || !f.sku || !f.varian) {
      return res.status(400).json({ success: false, message: 'Tanggal, SKU, dan Varian wajib diisi' });
    }

    await ensureSheets();
    const sheets = getClient();
    const orderId = f.orderId || ('WA-' + Date.now());
    const row = [f.tanggal, orderId, f.status, f.alasan || '-', f.sku, f.varian, f.qty, f.hargaJual, f.hpp, f.laba, f.margin, f.toko || '-'];

    await sheets.spreadsheets.values.append({
      spreadsheetId: getSpreadsheetId(),
      range: `${quoteSheet(SHEETS.wa.name)}!A1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });

    res.status(200).json({ success: true, message: 'Transaksi WhatsApp berhasil disimpan!' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Gagal menyimpan WA: ' + (error.message || String(error)) });
  }
}
