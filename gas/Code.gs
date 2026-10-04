// 波どこ？ 実況と写真の受け口
// アプリから送られた「どのポイント・何時・サイズ・ひとこと・写真」を、このスプレッドシートに1行ずつ記録する。
// 文字の実況も写真も、届いたらすぐアプリに出る。写真を隠したい時は「写真の公開」の列を「非公開」に書きかえる。
// 合言葉は無し（誰でも送れる）。そのかわり1日の件数に上限をつけ、変な写真はあとから隠せるようにしてある。

const SHEET = '実況';
const SPOTS = ['long', 'loco', 'minato', 'zen', 'shin', 'sentan', 'omain', 'melon', 'shizu', 'kata'];
const HEAD = ['受けた日時', '写真の公開', '日', '時刻', 'ポイント', 'サイズ', '乗りやすさ', 'ひとこと', '名前', '写真ID', '予想の印', '予想のサイズm', '版'];
const MAX_PER_DAY = 30;        // 1日に受ける件数の上限（いたずら対策）
const MAX_IMG_CHARS = 1500000; // 写真の大きさの上限（約1MB）

// 最初に1回だけ、エディタの「実行」で動かす。シートと写真フォルダを作り、必要な許可をまとめて取る
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(SHEET)) ss.insertSheet(SHEET).appendRow(HEAD);
  folder_();
}

function folder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('FOLDER');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const f = DriveApp.createFolder('波どこ 写真');
  props.setProperty('FOLDER', f.getId());
  return f;
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// 文字は長さを切り、先頭の = + - @ を外す（スプレッドシートの式として動かないように）
function text_(v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').replace(/^[=+\-@\s]+/, '').slice(0, n); }
function int_(v, max) { const n = Math.floor(Number(v)); return n >= 0 && n <= max ? n : ''; }

// アプリから実況を受け取る
function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, err: 'format' }); }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (SPOTS.indexOf(d.spot) < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(d.date) || !/^\d{2}:\d{2}$/.test(d.time)) return json_({ ok: false, err: 'format' });
  const img = typeof d.img === 'string' ? d.img : '';
  if (img.length > MAX_IMG_CHARS || (img && !/^[A-Za-z0-9+/=]+$/.test(img))) return json_({ ok: false, err: 'image' });

  const lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    const sh = ss.getSheetByName(SHEET);
    const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
    const n = sh.getLastRow() < 2 ? 0 : sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues()
      .filter(function (r) { return r[0] && Utilities.formatDate(new Date(r[0]), 'Asia/Tokyo', 'yyyy-MM-dd') === today; }).length;
    if (n >= MAX_PER_DAY) return json_({ ok: false, err: 'limit' });
    let fileId = '';
    if (img) {
      const blob = Utilities.newBlob(Utilities.base64Decode(img), 'image/jpeg', d.date + '_' + d.time.replace(':', '') + '_' + d.spot + '.jpg');
      const file = folder_().createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      fileId = file.getId();
    }
    const pred = d.pred || {};
    sh.appendRow([new Date(), img ? '公開' : '', "'" + d.date, "'" + d.time, d.spot, int_(d.size, 9), int_(d.cond, 3),
      text_(d.memo, 60), text_(d.by, 12), fileId, int_(pred.mark + 1, 4) === '' ? '' : pred.mark, Number(pred.face) > 0 ? Math.round(pred.face * 100) / 100 : '', text_(d.ver, 8)]);
    return json_({ ok: true });
  } finally { lock.releaseLock(); }
}

// アプリに、最近14日分の実況を返す。写真IDは「公開」の行だけ返す（「非公開」に書きかえた写真は出ない）
function doGet() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET);
  if (!sh || sh.getLastRow() < 2) return json_({ ok: true, list: [] });
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, HEAD.length).getDisplayValues()
    .map(function (r) { r[2] = r[2].replace(/^'/, ''); r[3] = r[3].replace(/^'/, ''); return r; });
  const since = Utilities.formatDate(new Date(Date.now() - 14 * 864e5), 'Asia/Tokyo', 'yyyy-MM-dd');
  const list = rows.filter(function (r) { return r[2] >= since && SPOTS.indexOf(r[4]) >= 0; }).slice(-80).map(function (r) {
    return { date: r[2], time: r[3], spot: r[4], size: r[5], cond: r[6], memo: r[7], by: r[8],
      img: r[1] === '公開' && /^[A-Za-z0-9_\-]+$/.test(r[9]) ? r[9] : '', hold: r[1] === '保留', predMark: r[10], predFace: r[11] };
  });
  return json_({ ok: true, list: list });
}
