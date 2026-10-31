/**
 * ==========================================
 * OMNICHANNEL PERFORMANCE DECK (V14.19)
 * Backend - Code.gs (API bridge untuk frontend GitHub/Vercel)
 * Fitur: Multi-Sheet Admin Reconciliation Tracking
 * ==========================================
 */

// ID spreadsheet admin dibaca dari Script Properties (Project Settings -> Script Properties):
//   SPREADSHEET_ADMIN_ID = <id spreadsheet admin>   (opsional, kosongkan jika tidak dipakai)
//   APP_PASSWORD         = <password untuk membuka aplikasi>
const SPREADSHEET_ADMIN_ID = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ADMIN_ID') || '';

/**
 * API untuk frontend yang dihosting di GitHub/Vercel.
 * Deploy sebagai Web App: Execute as "Me", Who has access "Anyone".
 * Semua request berupa POST (text/plain, supaya tanpa preflight CORS) berisi JSON:
 *   { action: 'getData' | 'upload' | 'saveWa', password: '...', payload: {...} }
 */
function doGet(e) {
  return jsonOut_({ success: true, message: 'Omnichannel API aktif (v14.19)' });
}

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    const expected = PropertiesService.getScriptProperties().getProperty('APP_PASSWORD');
    if (!expected) return jsonOut_({ success: false, message: 'APP_PASSWORD belum diatur di Script Properties' });
    if (String(req.password || '') !== expected) return jsonOut_({ success: false, code: 401, message: 'Password salah atau belum diisi' });

    const p = req.payload || {};
    switch (req.action) {
      case 'getData':
        return jsonOut_(getDashboardData());
      case 'upload':
        if (!p.storeName) return jsonOut_({ success: false, message: 'Nama toko wajib diisi' });
        return jsonOut_(withLock_(() => uploadData(JSON.stringify(p.data || []), String(p.storeName), String(p.fileType || ''))));
      case 'saveWa':
        return jsonOut_(withLock_(() => saveWaTransaction(p)));
      default:
        return jsonOut_({ success: false, message: 'Action tidak dikenal: ' + req.action });
    }
  } catch (error) {
    return jsonOut_({ success: false, message: 'Error Server: ' + error.toString() });
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Cegah dua upload/penyimpanan berjalan bersamaan dan saling menimpa
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// DEFINISI HEADER SHEET
const SHEET_PESANAN = 'Database';
const HEADERS_PESANAN = ["No. Pesanan", "Status Pesanan", "Alasan Pembatalan", "Status Pembatalan/Pengembalian", "Waktu Pesanan Dibuat", "Waktu Pengiriman Diatur", "Metode Pembayaran", "SKU Induk", "Nama Variasi", "Jumlah", "Harga Setelah Diskon", "Provinsi", "Nama Toko"];

const SHEET_PENGHASILAN = 'Penghasilan';
const HEADERS_PENGHASILAN = ["No. Pesanan", "Lihat berdasarkan", "No Pengajuan", "ID Produk", "Nama Produk", "Waktu Pesanan Dibuat", "Tanggal Dana Dilepaskan", "Total Penghasilan", "Nama Toko"];

const SHEET_MASTER = 'Master Produk';
const HEADERS_MASTER = ["SKU Induk", "Nama Variasi", "HPP (Modal)"];

const SHEET_WA = 'Data_WA';
const HEADERS_WA = ["Tanggal", "No. Transaksi", "Status", "Alasan", "SKU Induk", "Varian", "Qty", "Harga Jual (Gross)", "HPP (Modal)", "Laba Bersih", "Margin (%)", "Nama Toko"];

const SHEET_IKLAN = 'Data_Iklan';
const HEADERS_IKLAN = ["Nama Iklan", "Jenis Iklan", "Kode Produk", "Tanggal Mulai", "Tanggal Selesai", "Biaya", "Omzet Penjualan", "Produk Terjual", "Nama Toko", "Periode Laporan"];

const SHEET_TIKTOK_TOKPED = 'Data_Tiktok_Tokped';
const HEADERS_TIKTOK_TOKPED = ["Tanggal", "Platform", "Nama Toko", "GMV (Omset)", "Pesanan", "Pembeli", "Produk Terjual", "Pengembalian Dana", "Pesanan SKU", "Pendapatan Bruto"];

function setupSheet() {
  let ss = SpreadsheetApp.getActiveSpreadsheet();
  
  let sheetP = ss.getSheetByName(SHEET_PESANAN);
  if (!sheetP) { sheetP = ss.insertSheet(SHEET_PESANAN); sheetP.appendRow(HEADERS_PESANAN); sheetP.getRange(1, 1, 1, HEADERS_PESANAN.length).setFontWeight("bold").setBackground("#f3f4f6"); }

  let sheetH = ss.getSheetByName(SHEET_PENGHASILAN);
  if (!sheetH) { sheetH = ss.insertSheet(SHEET_PENGHASILAN); sheetH.appendRow(HEADERS_PENGHASILAN); sheetH.getRange(1, 1, 1, HEADERS_PENGHASILAN.length).setFontWeight("bold").setBackground("#d1fae5"); }

  let sheetM = ss.getSheetByName(SHEET_MASTER);
  if (!sheetM) { sheetM = ss.insertSheet(SHEET_MASTER); sheetM.appendRow(HEADERS_MASTER); sheetM.getRange(1, 1, 1, HEADERS_MASTER.length).setFontWeight("bold").setBackground("#fef08a"); }
  
  let sheetW = ss.getSheetByName(SHEET_WA);
  if (!sheetW) { sheetW = ss.insertSheet(SHEET_WA); sheetW.appendRow(HEADERS_WA); sheetW.getRange(1, 1, 1, HEADERS_WA.length).setFontWeight("bold").setBackground("#dcfce3"); } 
  else {
    let existingHeaders = sheetW.getRange(1, 1, 1, sheetW.getLastColumn()).getValues()[0];
    if (existingHeaders.indexOf("Nama Toko") === -1) { sheetW.getRange(1, existingHeaders.length + 1).setValue("Nama Toko").setFontWeight("bold").setBackground("#dcfce3"); }
  }

  let sheetI = ss.getSheetByName(SHEET_IKLAN);
  if (!sheetI) { sheetI = ss.insertSheet(SHEET_IKLAN); sheetI.appendRow(HEADERS_IKLAN); sheetI.getRange(1, 1, 1, HEADERS_IKLAN.length).setFontWeight("bold").setBackground("#fbcfe8"); } 
  else {
      let existingHeaders = sheetI.getRange(1, 1, 1, sheetI.getLastColumn()).getValues()[0];
      if (existingHeaders.indexOf("Periode Laporan") === -1) { sheetI.getRange(1, existingHeaders.length + 1).setValue("Periode Laporan").setFontWeight("bold").setBackground("#fbcfe8"); }
  }

  let sheetT = ss.getSheetByName(SHEET_TIKTOK_TOKPED);
  if (!sheetT) { sheetT = ss.insertSheet(SHEET_TIKTOK_TOKPED); sheetT.appendRow(HEADERS_TIKTOK_TOKPED); sheetT.getRange(1, 1, 1, HEADERS_TIKTOK_TOKPED.length).setFontWeight("bold").setBackground("#e0e7ff"); }

  return { sheetPesanan: sheetP, sheetPenghasilan: sheetH, sheetMaster: sheetM, sheetWa: sheetW, sheetIklan: sheetI, sheetTiktokTokped: sheetT };
}

function uploadData(jsonData, storeName, fileType) {
  try {
    let sheets = setupSheet(); 
    let data = JSON.parse(jsonData);
    if (data.length === 0) return { success: true, message: "Tidak ada data baru.", inserted: 0, updated: 0 };

    let sheet; let headers; let keyCols = [];
    if (fileType === 'penghasilan') { sheet = sheets.sheetPenghasilan; headers = HEADERS_PENGHASILAN; keyCols = ["No. Pesanan"]; }
    else if (fileType === 'iklan') { sheet = sheets.sheetIklan; headers = HEADERS_IKLAN; keyCols = ["Nama Iklan", "Kode Produk", "Tanggal Mulai", "Periode Laporan"]; }
    else if (fileType === 'tiktok' || fileType === 'tokopedia') { sheet = sheets.sheetTiktokTokped; headers = HEADERS_TIKTOK_TOKPED; keyCols = ["Tanggal", "Platform"]; }
    else { sheet = sheets.sheetPesanan; headers = HEADERS_PESANAN; keyCols = ["No. Pesanan", "SKU Induk", "Nama Variasi"]; }
    
    let existingData = sheet.getDataRange().getDisplayValues();
    if (existingData.length === 0) { existingData = [headers]; }

    let idxMap = {};
    keyCols.forEach(col => {
        let idx = existingData[0].indexOf(col);
        if (idx !== -1) idxMap[col] = idx;
    });
    
    let rowMap = {}; let idxStore = existingData[0].indexOf("Nama Toko");
    for (let i = 1; i < existingData.length; i++) {
      let row = existingData[i]; 
      let rowStore = (idxStore !== -1 && String(row[idxStore] || "").trim()) || storeName;
      let pKey = keyCols.map(c => String(row[idxMap[c]] || "").trim()).join("_") + "_" + rowStore;
      if (pKey) { rowMap[pKey] = i; } 
    }

    let insertedCount = 0; let updatedCount = 0;
    for (let i = 0; i < data.length; i++) {
      let row = data[i]; 
      
      let pKeyParts = []; let isRowValid = false;
      keyCols.forEach(col => { 
          let val = String(row[col] || "").trim(); 
          pKeyParts.push(val); 
          if(val !== "") isRowValid = true; 
      });
      if(!isRowValid) continue; 

      let pKey = pKeyParts.join("_") + "_" + storeName;

      let newRow = [];
      headers.forEach(header => {
        if (header === "Nama Toko") { newRow.push(storeName); } 
        else {
          let val = row[header] !== undefined ? row[header] : "";
          if (header === "Harga Setelah Diskon" || header === "Jumlah" || header === "Total Penghasilan" || header === "Biaya" || header === "Omzet Penjualan" || header === "Produk Terjual" || header === "GMV (Omset)" || header === "Pesanan" || header === "Pembeli" || header === "Pengembalian Dana" || header === "Pesanan SKU" || header === "Pendapatan Bruto") { 
             val = parseInt(val) || 0; 
          }
          newRow.push(val);
        }
      });
      
      if (rowMap[pKey] !== undefined) {
         let existingIndex = rowMap[pKey]; 
         let oldFingerprint = existingData[existingIndex].join("|||").toLowerCase(); 
         let newFingerprint = newRow.join("|||").toLowerCase();
         if (oldFingerprint !== newFingerprint) { existingData[existingIndex] = newRow; updatedCount++; }
      } else { 
         existingData.push(newRow); 
         rowMap[pKey] = existingData.length - 1; 
         insertedCount++; 
      }
    }
    
    sheet.getRange(1, 1, existingData.length, headers.length).setValues(existingData);
    return { success: true, message: `Sukses diproses.`, inserted: insertedCount, updated: updatedCount };
  } catch (error) { return { success: false, message: "Error Server: " + error.toString() }; }
}

function saveWaTransaction(formData) {
  try {
    let sheets = setupSheet(); let sheetW = sheets.sheetWa; let orderId = formData.orderId || ('WA-' + new Date().getTime());
    let newRow = [formData.tanggal, orderId, formData.status, formData.alasan || "-", formData.sku, formData.varian, formData.qty, formData.hargaJual, formData.hpp, formData.laba, formData.margin, formData.toko || "-" ];
    sheetW.appendRow(newRow);
    return { success: true, message: "Transaksi WhatsApp berhasil disimpan!" };
  } catch (error) { return { success: false, message: "Gagal menyimpan WA: " + error.toString() }; }
}

function getDashboardData() {
  try {
    let sheets = setupSheet();

    // Dikirim sebagai array-of-arrays (header + baris) agar payload ringkas;
    // frontend yang mengubahnya menjadi array objek.
    let toRows = (sheet) => sheet.getDataRange().getDisplayValues();

    let adminOrders = {};
    if (SPREADSHEET_ADMIN_ID) {
      try {
        let adminSs = SpreadsheetApp.openById(SPREADSHEET_ADMIN_ID);
        adminSs.getSheets().forEach(sheet => {
          if (sheet.isSheetHidden()) return;
          let sheetName = sheet.getName();
          let rawData = sheet.getDataRange().getDisplayValues();
          if (rawData.length === 0) return;
          let headers = rawData[0].map(h => String(h).trim().toUpperCase());
          let idxId = headers.indexOf("NO PESANAN");
          let idxTgl = headers.indexOf("TANGGAL PENCATATAN");
          if (idxTgl === -1) idxTgl = headers.indexOf("TANGGAL");
          if (idxId === -1) return;
          for (let i = 1; i < rawData.length; i++) {
            let id = String(rawData[i][idxId]).trim();
            if (!id) continue;
            let tgl = (idxTgl !== -1) ? String(rawData[i][idxTgl]).trim() : "-";
            adminOrders[id] = [tgl, sheetName];
          }
        });
      } catch (e) { console.error("Gagal membaca Spreadsheet Admin: " + e.message); }
    }

    return {
      success: true,
      tables: {
        pesanan: toRows(sheets.sheetPesanan),
        penghasilan: toRows(sheets.sheetPenghasilan),
        master: toRows(sheets.sheetMaster),
        wa: toRows(sheets.sheetWa),
        iklan: toRows(sheets.sheetIklan),
        tiktok: toRows(sheets.sheetTiktokTokped)
      },
      adminOrders: adminOrders
    };
  } catch (error) { return { success: false, message: "Gagal memuat data: " + error.toString() }; }
}
