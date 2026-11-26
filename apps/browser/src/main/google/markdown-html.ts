import { Marked } from 'marked'

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// A private instance: global marked options are process-wide state.
const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    // Raw HTML in an AI answer is text the member saw, not markup to interpret.
    html: ({ text }) => escapeHtml(text),
  },
})

/**
 * The fallback document when Google will not convert the Markdown: GitHub-flavoured Markdown
 * (tables, fenced code, task lists) rendered locally to a complete HTML page, which Docs imports.
 */
export function markdownToHtml(markdown: string, title: string): string {
  const body = marked.parse(markdown, { async: false })
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${body}</body></html>`
}
