import {
  SHEETS, NUMERIC_HEADERS, sheetKeyForFileType,
  ensureSheets, ensureGrid, getClient, getSpreadsheetId, quoteSheet, colLetter, guard,
} from '../lib/sheets.js';

// Port dari uploadData() di Code.gs: upsert per kunci unik + Nama Toko.
// Perbedaan implementasi: baris baru ditulis dengan satu update range,
// baris yang berubah ditulis lewat batchUpdate (tidak menulis ulang seluruh sheet).
export default async function handler(req, res) {
  if (!guard(req, res, 'POST')) return;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const data = Array.isArray(body.data) ? body.data : [];
    const storeName = String(body.storeName || '').trim();
    const fileType = String(body.fileType || '');

    if (!data.length) return res.status(200).json({ success: true, message: 'Tidak ada data baru.', inserted: 0, updated: 0 });
    if (!storeName) return res.status(400).json({ success: false, message: 'Nama toko wajib diisi' });

    await ensureSheets();
    const sheets = getClient();
    const spreadsheetId = getSpreadsheetId();

    const def = SHEETS[sheetKeyForFileType(fileType)];
    const { headers, keyCols, name } = def;
    const width = headers.length;

    const read = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: quoteSheet(name),
      valueRenderOption: 'FORMATTED_VALUE',
    });
    let existing = read.data.values || [];
    if (!existing.length) existing = [headers];

    const norm = (row) => { const r = row.slice(0, width); while (r.length < width) r.push(''); return r; };

    const idxMap = {};
    keyCols.forEach(col => { const i = existing[0].indexOf(col); if (i !== -1) idxMap[col] = i; });

    const baseLen = existing.length;     // jumlah baris (termasuk header) sebelum upload
    const appended = [];                 // baris baru
    const changed = new Map();           // indexBaris -> row baru (untuk baris lama)
    const rowMap = {};

    // Baris lama di-key dengan Nama Toko miliknya sendiri (fallback ke toko upload bila kosong,
    // untuk data lama sebelum kolom Nama Toko ada). Di versi GAS, semua baris lama dianggap
    // milik toko yang sedang diupload sehingga bisa menimpa data toko lain.
    const idxStore = existing[0].indexOf('Nama Toko');
    for (let i = 1; i < existing.length; i++) {
      const row = existing[i];
      const rowStore = (idxStore !== -1 && String(row[idxStore] ?? '').trim()) || storeName;
      const pKey = keyCols.map(c => String(row[idxMap[c]] ?? '').trim()).join('_') + '_' + rowStore;
      rowMap[pKey] = i;
    }

    let inserted = 0, updated = 0;
    for (const row of data) {
      const parts = [];
      let valid = false;
      for (const col of keyCols) {
        const v = String(row[col] ?? '').trim();
        parts.push(v);
        if (v !== '') valid = true;
      }
      if (!valid) continue;
      const pKey = parts.join('_') + '_' + storeName;

      const newRow = headers.map(h => {
        if (h === 'Nama Toko') return storeName;
        let v = row[h] !== undefined ? row[h] : '';
        if (NUMERIC_HEADERS.has(h)) v = parseInt(v) || 0;
        return v;
      });

      const idx = rowMap[pKey];
      if (idx !== undefined) {
        const current = idx >= baseLen ? appended[idx - baseLen] : (changed.get(idx) || norm(existing[idx]));
        const oldFp = current.join('|||').toLowerCase();
        const newFp = newRow.join('|||').toLowerCase();
        if (oldFp !== newFp) {
          if (idx >= baseLen) appended[idx - baseLen] = newRow; else changed.set(idx, newRow);
          updated++;
        }
      } else {
        appended.push(newRow);
        rowMap[pKey] = baseLen + appended.length - 1;
        inserted++;
      }
    }

    const writes = [];
    for (const [idx, r] of changed) {
      writes.push({ range: `${quoteSheet(name)}!A${idx + 1}:${colLetter(width)}${idx + 1}`, values: [r] });
    }
    if (appended.length) {
      const startRow = baseLen + 1;
      const endRow = baseLen + appended.length;
      await ensureGrid(name, endRow, width);
      writes.push({ range: `${quoteSheet(name)}!A${startRow}:${colLetter(width)}${endRow}`, values: appended });
    }

    if (writes.length) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: 'USER_ENTERED', data: writes },
      });
    }

    res.status(200).json({ success: true, message: 'Sukses diproses.', inserted, updated });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Error Server: ' + (error.message || String(error)) });
  }
}
