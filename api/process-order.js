const { google } = require('googleapis');
const { Readable } = require('stream');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    orderId, paymentKey, amount,
    recipient, phone, address, timingLabel, letter, photoCount, paymentDate,
    photos
  } = req.body || {};

  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/spreadsheets'
      ]
    });

    const drive  = google.drive({ version: 'v3', auth });
    const sheets = google.sheets({ version: 'v4', auth });

    /* ── 1. 구글 드라이브 사진 업로드 ── */
    let folderUrl = '';

    if (Array.isArray(photos) && photos.length > 0) {
      const folderName = (String(orderId || '') + (recipient ? '_' + recipient : '')).slice(0, 50);

      const folderRes = await drive.files.create({
        requestBody: {
          name:     folderName,
          mimeType: 'application/vnd.google-apps.folder',
          parents:  process.env.DRIVE_FOLDER_ID ? [process.env.DRIVE_FOLDER_ID] : []
        }
      });
      const folderId = folderRes.data.id;

      await drive.permissions.create({
        fileId:      folderId,
        requestBody: { role: 'reader', type: 'anyone' }
      });

      await Promise.all(photos.map(async (dataUrl, i) => {
        try {
          const comma  = dataUrl.indexOf(',');
          const mime   = dataUrl.slice(0, comma).match(/:(.*?);/)[1];
          const b64    = dataUrl.slice(comma + 1);
          const ext    = mime === 'image/png' ? 'png' : 'jpg';
          const num    = String(i + 1).padStart(2, '0');
          const buffer = Buffer.from(b64, 'base64');

          await drive.files.create({
            requestBody: { name: `photo_${num}.${ext}`, parents: [folderId] },
            media: { mimeType: mime, body: Readable.from(buffer) }
          });
        } catch (e) {
          console.error(`photo ${i + 1} failed:`, e.message);
        }
      }));

      folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
    }

    /* ── 2. 구글 시트 저장 ── */
    const spreadsheetId = process.env.SPREADSHEET_ID;

    const check = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'A1:A1'
    });
    if (!check.data.values || check.data.values.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'A1',
        valueInputOption: 'RAW',
        requestBody: {
          values: [['받는 사람','전화번호','주소','발송 시기','편지 내용','사진 수','사진 폴더','결제일','주문 번호','결제 금액']]
        }
      });
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'A:J',
      valueInputOption: 'RAW',
      requestBody: {
        values: [[
          recipient   || '',
          phone       || '',
          address     || '',
          timingLabel || '',
          letter      || '',
          (photoCount || 0) + '장',
          folderUrl,
          paymentDate || new Date().toLocaleString('ko-KR'),
          orderId     || '',
          '₩' + (amount || 50000)
        ]]
      }
    });

    return res.json({ ok: true, folderUrl });

  } catch (err) {
    console.error('process-order error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
