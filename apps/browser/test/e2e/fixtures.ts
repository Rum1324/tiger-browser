import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/** Minimal one-page text PDF (Helvetica, WinAnsi), built byte by byte so offsets are exact. */
export function makeTextPdf(lines: readonly string[]): Buffer {
  const stream = lines
    .map((l, i) => `BT /F1 14 Tf 72 ${760 - i * 24} Td (${l.replace(/[\\()]/g, '\\$&')}) Tj ET`)
    .join('\n')
  return pdfWithContent(stream)
}

/** A page that only paints shapes, like a scan: pdf.js finds no text layer. */
export function makeScanLikePdf(): Buffer {
  return pdfWithContent('0.2 0.2 0.2 rg 72 72 451 698 re f 1 1 1 rg 100 600 300 20 re f')
}

function pdfWithContent(stream: string): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'))
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const o of offsets) pdf += `${String(o).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

const ARTICLE_PARAGRAPHS = [
  'Tiger reads the article you are looking at and turns it into Markdown on your own machine.',
  'Nothing leaves the computer until the member explicitly shares the page with a Space.',
  'The extractor keeps headings, paragraphs and lists, and drops navigation and footers.',
]

export const ARTICLE = {
  title: 'Field notes on local capture',
  heading: 'Field notes on local capture',
  paragraphs: ARTICLE_PARAGRAPHS,
}

const page = (title: string, body: string, head = '') =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body>${body}</body></html>`

const DOWNLOAD_BODY = 'tiger download fixture\n'.repeat(2000)

function articleHtml(): string {
  return page(
    ARTICLE.title,
    `<header><nav><a href="/">Home</a> <a href="/about">About</a></nav></header>
     <main><article>
       <h1>${ARTICLE.heading}</h1>
       <p class="byline">By Aiko Tanaka</p>
       ${ARTICLE_PARAGRAPHS.map((p) => `<p>${p}</p>`).join('\n')}
       <ul><li>First point to remember</li><li>Second point to remember</li></ul>
     </article></main>
     <footer>Copyright footer text</footer>`,
  )
}

type Route = (req: IncomingMessage, res: ServerResponse, url: URL) => void

const html = (res: ServerResponse, body: string, headers: Record<string, string> = {}) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...headers })
  res.end(body)
}

const ROUTES: Record<string, Route> = {
  '/article': (_q, res) => html(res, articleHtml()),
  '/one': (_q, res) => html(res, page('Page One', '<h1>One</h1><p>first page</p>')),
  '/two': (_q, res) => html(res, page('Page Two', '<h1>Two</h1><p>second page apple apple apple</p>')),
  '/opener': (_q, res) =>
    html(
      res,
      page(
        'Opener',
        `<button id="open">open</button>
         <script>
           window.addEventListener('message', (e) => { if (e.data === 'hello-from-popup') document.title = 'OPENER-OK' })
           document.getElementById('open').addEventListener('click', () => { window.open('/popup', 'tiger-popup', 'width=400,height=300') })
         </script>`,
      ),
    ),
  '/popup': (_q, res) =>
    html(
      res,
      page(
        'Popup',
        `<p>popup</p>
         <script>
           document.title = window.opener ? 'HAS-OPENER' : 'NO-OPENER'
           if (window.opener) window.opener.postMessage('hello-from-popup', '*')
           window.closeMe = () => window.close()
         </script>`,
      ),
    ),
  '/set-cookie': (_q, res, url) => {
    const name = url.searchParams.get('name') ?? 'who'
    const value = url.searchParams.get('value') ?? 'tiger'
    html(res, page('Cookie set', `<p>set ${name}</p>`), {
      'set-cookie': `${name}=${value}; Max-Age=86400; Path=/`,
    })
  },
  '/echo-cookie': (req, res) =>
    html(res, page('Cookie echo', `<pre id="cookie">${req.headers.cookie ?? ''}</pre>`)),
  '/doc.pdf': (req, res) => {
    // Only served with the session cookie: proves the capture fetch used the tab's own session.
    if (!(req.headers.cookie ?? '').includes('pdfauth=yes')) {
      res.writeHead(403, { 'content-type': 'text/plain' })
      res.end('forbidden')
      return
    }
    res.writeHead(200, { 'content-type': 'application/pdf' })
    res.end(makeTextPdf(['Quarterly report for the Tiger team', 'Revenue grew in every region']))
  },
  '/scan.pdf': (_q, res) => {
    res.writeHead(200, { 'content-type': 'application/pdf' })
    res.end(makeScanLikePdf())
  },
  '/download-page': (_q, res) =>
    html(res, page('Downloads', '<a id="dl" href="/file.txt" download>get file</a>')),
  '/file.txt': (_q, res) => {
    res.writeHead(200, {
      'content-type': 'text/plain',
      'content-disposition': 'attachment; filename="tiger-fixture.txt"',
      'content-length': String(Buffer.byteLength(DOWNLOAD_BODY)),
    })
    res.end(DOWNLOAD_BODY)
  },
  '/slow.bin': (_q, res) => {
    // Sends a little and then stalls, so the download stays in progress until cancelled.
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-disposition': 'attachment; filename="slow.bin"',
      'content-length': String(10 * 1024 * 1024),
    })
    res.write(Buffer.alloc(64 * 1024))
  },
  '/clicks': (_q, res) =>
    html(
      res,
      page(
        'Clicks',
        `<p>click anywhere</p>
         <script>window.__clicks = 0; document.addEventListener('mousedown', () => { window.__clicks++ })</script>`,
        '<style>html,body{margin:0;height:100%;background:#cde}</style>',
      ),
    ),
  '/perm': (_q, res) => html(res, page('Permissions', '<p>permissions</p>')),
  '/probe': (_q, res) => html(res, page('Probe', '<p>probe</p>')),
}

export interface FixtureServer {
  port: number
  url(host: string, path: string): string
  close(): Promise<void>
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fixture')
    const route = ROUTES[url.pathname]
    if (!route) {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found')
      return
    }
    route(req, res, url)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    port,
    url: (host, path) => `http://${host}:${port}${path}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

export const DOWNLOAD_CONTENT = DOWNLOAD_BODY
