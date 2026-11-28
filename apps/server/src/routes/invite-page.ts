import { createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'

/**
 * The page an invite link (`<PUBLIC_URL>/invite#<token>`) opens in an ordinary browser. The token is
 * in the fragment, which browsers never send to a server, and this page keeps it that way: the only
 * script reads the fragment, builds the `tiger://invite/<token>` link, shows the token for pasting
 * and copies it on request. It makes no request of its own (the CSP forbids any).
 */

/** Runs in the visitor's browser. Kept free of network APIs; a test runs it against a stub DOM. */
export const INVITE_PAGE_SCRIPT = `(function () {
  var token = location.hash.slice(1);
  try { token = decodeURIComponent(token); } catch (e) {}
  token = token.trim();
  var ok = /^[A-Za-z0-9_-]{10,}$/.test(token);
  document.getElementById(ok ? 'invite' : 'broken').hidden = false;
  if (!ok) return;
  document.getElementById('open').setAttribute('href', 'tiger://invite/' + token);
  document.getElementById('token').textContent = token;
  var copy = document.getElementById('copy');
  copy.addEventListener('click', function () {
    navigator.clipboard.writeText(token).then(function () {
      copy.textContent = copy.getAttribute('data-done');
    });
  });
})();`

const STYLE = `
:root { color-scheme: light dark; --ink: #1d1b18; --ink-3: #5f5a52; --ground: #f7f4ee; --card: #fffdf9;
  --line: #e2dcd1; --accent: #b4561c; }
@media (prefers-color-scheme: dark) { :root { --ink: #f1ece4; --ink-3: #b3ab9f; --ground: #1b1a18;
  --card: #24221f; --line: #3a3732; --accent: #e08a4f; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px 16px;
  background: var(--ground); color: var(--ink); text-autospace: normal; line-height: 1.7;
  font-family: "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; }
main { width: 100%; max-width: 520px; background: var(--card); border: 1px solid var(--line);
  border-radius: 12px; padding: 28px 24px; }
h1 { font-size: 20px; margin: 0 0 4px; }
p { margin: 0 0 12px; }
.en { color: var(--ink-3); font-size: 14px; }
.open { display: inline-block; margin: 12px 0 20px; padding: 10px 18px; border-radius: 8px;
  background: var(--accent); color: #fff; text-decoration: none; font-weight: 600; }
.token { display: flex; gap: 8px; align-items: stretch; margin-bottom: 12px; }
code { flex: 1; min-width: 0; overflow-wrap: anywhere; padding: 8px 10px; border: 1px solid var(--line);
  border-radius: 6px; font-size: 13px; user-select: all; }
button { font: inherit; padding: 6px 14px; border-radius: 6px; border: 1px solid var(--line);
  background: transparent; color: var(--ink); cursor: pointer; }
`

const sha256 = (text: string) => createHash('sha256').update(text).digest('base64')

export const INVITE_PAGE_HTML = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Tigerへの招待 / Invitation to Tiger</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>Tigerへの招待</h1>
<p class="en">Invitation to Tiger</p>
<p>Tigerは、チームが共有したページをもとにAIへ質問できるブラウザです。</p>
<p class="en">Tiger is a browser where a team asks AI about the pages its members have shared.</p>
<section id="invite" hidden>
<a id="open" class="open" href="#">Tigerで開く <span lang="en">/ Open in Tiger</span></a>
<p>開かない場合は、Tigerの「招待リンクを貼り付け」にこのコードを貼り付けてください。</p>
<p class="en">If nothing opens, choose “Paste an invite link” in Tiger and paste this code.</p>
<div class="token"><code id="token"></code><button id="copy" type="button" data-done="コピーしました / Copied">コピー / Copy</button></div>
</section>
<section id="broken" hidden>
<p>招待リンクが途中で切れています。受け取ったリンクをそのまま開いてください。</p>
<p class="en">This invite link is incomplete. Open the link exactly as you received it.</p>
</section>
<noscript>
<p>このページのアドレスをすべてコピーして、Tigerの「招待リンクを貼り付け」に貼り付けてください。</p>
<p class="en">Copy this page’s whole address and paste it into “Paste an invite link” in Tiger.</p>
</noscript>
</main>
<script>${INVITE_PAGE_SCRIPT}</script>
</body>
</html>
`

/** Nothing but the inline style and script above may run, and the page may fetch nothing at all. */
export const INVITE_PAGE_CSP = [
  "default-src 'none'",
  `script-src 'sha256-${sha256(INVITE_PAGE_SCRIPT)}'`,
  `style-src 'sha256-${sha256(STYLE)}'`,
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

export function invitePageRoute(app: FastifyInstance): void {
  app.get('/invite', async (_request, reply) => {
    reply
      .header('content-type', 'text/html; charset=utf-8')
      .header('content-security-policy', INVITE_PAGE_CSP)
      .header('referrer-policy', 'no-referrer')
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'public, max-age=300')
    return INVITE_PAGE_HTML
  })
}
