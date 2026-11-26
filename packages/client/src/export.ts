import { api, type Citation, type EngineResponse } from '@tiger/shared'
import { type ApiClientError, toClientError } from './api'
import type { ClientContext } from './load'

/** Connectors are exits: finished work leaves as a Google Doc, a file, or Markdown on the clipboard. */

export type GoogleExportError = Extract<EngineResponse<'google.exportDoc'>, { ok: false }>['error']
export const GOOGLE_EXPORT_ERRORS = [
  'not-configured',
  'not-connected',
  'denied',
  'failed',
] as const satisfies readonly GoogleExportError[]

export type GoogleExportResult =
  | {
      ok: true
      url: string
      docId: string
      /** The server keeps an audit record of every export; null when that record was written. */
      recordError: ApiClientError | null
    }
  | { ok: false; error: GoogleExportError; detail: string | null }

export interface ExportController {
  /**
   * Create a Google Doc in the member's Drive through the engine (tokens never leave the machine),
   * then record the export on the server for the Space's audit log.
   */
  googleDoc(input: {
    spaceId: string
    title: string
    markdown: string
    messageId?: string
  }): Promise<GoogleExportResult>
  /** Save through the system dialog. Resolves to the path, or null when the member cancelled. */
  saveFile(input: {
    suggestedName: string
    content: string
    extension?: 'md' | 'txt'
  }): Promise<string | null>
  copyMarkdown(markdown: string): Promise<void>
}

/** An answer as Markdown, with its numbered sources listed so the `[n]` markers still resolve. */
export function answerToMarkdown(
  text: string,
  citations: readonly Citation[],
  sourcesHeading = 'Sources',
): string {
  if (citations.length === 0) return text
  const lines = [...citations]
    .sort((a, b) => a.n - b.n)
    .map((c) => `[${c.n}] ${c.title} <${c.url}>${c.available ? '' : ' (unshared)'}`)
  return `${text.trimEnd()}\n\n## ${sourcesHeading}\n\n${lines.join('\n')}\n`
}

export function createExport(ctx: ClientContext): ExportController {
  return {
    async googleDoc({ spaceId, title, markdown, messageId }) {
      const r = await ctx.bridge.invoke('google.exportDoc', { title, markdown })
      if (!r.ok) return { ok: false, error: r.error, detail: r.detail }
      let recordError: ApiClientError | null = null
      try {
        await ctx.api.call(api.recordExport, {
          params: { spaceId },
          body: { title, url: r.url, ...(messageId ? { messageId } : {}) },
        })
      } catch (e) {
        // The document exists either way; the UI can say the audit record failed.
        recordError = toClientError(e)
      }
      return { ok: true, url: r.url, docId: r.docId, recordError }
    },
    async saveFile({ suggestedName, content, extension = 'md' }) {
      const r = await ctx.bridge.invoke('export.saveFile', { suggestedName, content, extension })
      return r?.path ?? null
    },
    async copyMarkdown(markdown) {
      await ctx.bridge.invoke('clipboard.writeText', { text: markdown })
    },
  }
}
