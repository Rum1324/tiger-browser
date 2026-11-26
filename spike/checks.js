'use strict';
// Shared data: the manual checklist, the block-screen patterns, and the smoke targets.
// The Japanese and English block strings were captured from the live pages on 2026-11-26
// (accounts.google.com/signin/rejected?rrk=46 with hl=ja / hl=en, and Slack's
// unsupported-browser pages served to an old Chrome UA with Accept-Language: ja / en).

const CHECKS = [
  { id: 'google-signin', ja: 'Google にログイン', en: 'Google sign-in',
    url: 'https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmyaccount.google.com%2F',
    hint: 'メール→パスワード→2段階認証まで進む。「ログインできませんでした」が出たら Fail。' },
  { id: 'docs-new', ja: 'Google ドキュメント: 新規作成', en: 'Google Docs: new doc',
    url: 'https://docs.google.com/document/create', hint: '空のドキュメントが開けば Pass。' },
  { id: 'docs-type', ja: 'ドキュメント: 文字入力', en: 'Docs: type', url: null,
    hint: '英字で数行タイプ。カーソル・選択・取り消し (Cmd+Z) が正常か。' },
  { id: 'docs-ime', ja: 'ドキュメント: 日本語入力 (IME)', en: 'Docs: Japanese IME input', url: null,
    hint: 'かな入力→変換→確定。変換候補の位置、二重入力、確定漏れがないか。' },
  { id: 'docs-paste', ja: 'ドキュメント: 貼り付け', en: 'Docs: paste', url: null,
    hint: '他アプリの文字と画像を Cmd+V。右クリック貼り付けも。' },
  { id: 'docs-comment', ja: 'ドキュメント: コメント', en: 'Docs: comment', url: null,
    hint: '文字を選択→コメント追加→投稿。' },
  { id: 'drive', ja: 'Google ドライブ', en: 'Google Drive',
    url: 'https://drive.google.com/drive/my-drive', hint: 'ファイル一覧が表示され、開けるか。' },
  { id: 'slack', ja: 'Slack: ログインしてメッセージ送信', en: 'Slack sign-in and send a message',
    url: 'https://slack.com/signin', hint: 'ワークスペースに入り、自分宛 DM などに1通送信。' },
  { id: 'notion', ja: 'Notion: ログインしてページ編集', en: 'Notion sign-in and edit a page',
    url: 'https://www.notion.so/login', hint: '「Google で続行」も試す (ポップアップ)。ページに1行書く。' },
  { id: 'm365', ja: 'Microsoft 365: ログインして Word Online で編集', en: 'Microsoft 365 sign-in and edit in Word online',
    url: 'https://www.office.com/launch/word', hint: '新規文書を作り1行書く。「ブラウザ非対応」画面が出たら Fail。' },
  { id: 'passkey', ja: 'パスキー / 2段階認証のプロンプト', en: 'passkey or 2FA prompt',
    url: 'https://myaccount.google.com/signinoptions/passkeys',
    hint: 'パスキー・セキュリティキー・スマホ確認のどれが出たか、メモに書く。Touch ID/iCloud パスキーはこの試作では出ない想定。' },
  { id: 'download', ja: 'ファイルのダウンロード', en: 'file download', url: null,
    hint: 'ドキュメントで ファイル→ダウンロード→PDF。~/Downloads に保存されるか (下のログに記録)。' },
  { id: 'upload', ja: 'ファイルのアップロード', en: 'file upload',
    url: 'https://drive.google.com/drive/my-drive', hint: 'ドライブで 新規→ファイルのアップロード。ファイル選択ダイアログが出るか。' },
  { id: 'notification', ja: '通知の許可プロンプト', en: 'notification permission prompt',
    url: 'https://mail.google.com/mail/u/0/#settings/general',
    hint: 'Gmail 設定の「デスクトップ通知を有効にする」をクリック。許可ダイアログが出るか。' },
  { id: 'persist', ja: '終了→再起動後もログインが残る', en: 'login persists after quitting and reopening',
    url: 'https://myaccount.google.com/',
    hint: 'Cmd+Q で終了→もう一度 npm start→開くを押す。ログイン済みなら Pass。' },
  { id: 'oauth-consent', ja: '(追加) OAuth 同意画面をタブで開く', en: '(extra) OAuth consent page in a tab',
    url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=407408718192.apps.googleusercontent.com&redirect_uri=https%3A%2F%2Fdevelopers.google.com%2Foauthplayground&response_type=code&scope=openid%20email&access_type=offline&prompt=consent',
    hint: 'Google OAuth Playground の同意画面。表示されれば Pass (「許可」は押さなくてよい)。disallowed_useragent なら自動で Fail。' },
];

// host: regex the page hostname must match; text: regex on document.body.innerText.
// hard=true marks the check failed; hard=false is only logged (generic wording can false-positive).
const BLOCK_PATTERNS = [
  { id: 'google-insecure-browser', host: /(^|\.)google\.com$/, hard: true,
    text: /This browser or app may not be secure|このブラウザまたはアプリは安全でない可能性があります/ },
  { id: 'google-couldnt-sign-in', host: /^accounts\.google\.com$/, hard: true,
    text: /Couldn[’']t sign you in|ログインできませんでした/ },
  { id: 'google-disallowed-useragent', host: /./, hard: true, text: /disallowed_useragent/ },
  { id: 'google-malformed-request', host: /^accounts\.google\.com$/, hard: true,
    text: /The server cannot process the request because it is malformed|リクエストの形式が正しくないため、サーバーで処理できません/ },
  { id: 'slack-unsupported-browser', host: /(^|\.)slack\.com$/, hard: true,
    text: /Please update your browser or use the Slack app|We are no longer supporting this version of your browser|your browser is not supported|ブラウザを更新するか、Slack アプリを使用してください|お使いのバージョンのブラウザは、もうサポート対象ではありません|お使いのブラウザはサポートされていません/ },
  { id: 'generic-unsupported-browser', host: /./, hard: false,
    text: /(browser|ブラウザ|ブラウザー)[^。.\n]{0,30}(is not supported|isn['’]t supported|is no longer supported|はサポートされていません|には対応していません)/i },
];

function detectBlock(url, bodyText) {
  let host = '';
  try { host = new URL(url).hostname; } catch { return null; }
  for (const p of BLOCK_PATTERNS) {
    if (!p.host.test(host)) continue;
    const m = bodyText.match(p.text);
    if (m) return { id: p.id, hard: p.hard, match: m[0], url };
  }
  return null;
}

// Best-effort mapping of a URL to a check, for tabs the founder opened by hand.
function checkForUrl(url) {
  let h = '';
  try { h = new URL(url).hostname; } catch { return null; }
  if (h === 'accounts.google.com' || h === 'myaccount.google.com') return 'google-signin';
  if (h === 'docs.google.com') return 'docs-new';
  if (h === 'drive.google.com') return 'drive';
  if (/(^|\.)slack\.com$/.test(h)) return 'slack';
  if (/(^|\.)notion\.(so|com)$/.test(h)) return 'notion';
  if (/microsoft|office|live\.com|sharepoint/.test(h)) return 'm365';
  return null;
}

// Unauthenticated pages for `npm run smoke`.
const SMOKE_TARGETS = [
  { id: 'google-signin', url: 'https://accounts.google.com/ServiceLogin?hl=ja' },
  { id: 'google-docs-create', url: 'https://docs.google.com/document/create' },
  { id: 'google-drive', url: 'https://drive.google.com/drive/my-drive' },
  { id: 'google-oauth-authorize', url: CHECKS.find(c => c.id === 'oauth-consent').url },
  { id: 'slack-signin', url: 'https://slack.com/signin' },
  { id: 'slack-client', url: 'https://app.slack.com/client' },
  { id: 'notion-login', url: 'https://www.notion.so/login' },
  { id: 'm365-word', url: 'https://www.office.com/launch/word' },
  { id: 'm365-login', url: 'https://login.microsoftonline.com/' },
  // Detector self-tests: these pages must be detected as blocked in every UA mode.
  { id: 'selftest-google-rejected-ja', url: 'https://accounts.google.com/signin/rejected?rrk=46&hl=ja', expectBlock: 'google-insecure-browser' },
  { id: 'selftest-slack-old-chrome', url: 'https://app.slack.com/client', expectBlock: 'slack-unsupported-browser',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.113 Safari/537.36' },
];

module.exports = { CHECKS, BLOCK_PATTERNS, detectBlock, checkForUrl, SMOKE_TARGETS };
