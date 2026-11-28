import { answerToMarkdown, googleExportKey, googleFlowKey } from '@tiger/client'
import type { GoogleConnection } from '@tiger/shared'
import { useCallback, useMemo, useState } from 'react'
import { useServices, useT } from '../app/context'
import type { Notice } from '../i18n'
import { shallow, useStore } from '../lib/store'
import type { MessageView } from './threads'

/**
 * Exits: push finished work out (connectors are exits; no two-way sync). An answer goes out as
 * Markdown with its numbered sources, to a Google Doc in the member's own Drive (tokens stay in the
 * engine; the server only records that it happened), to a file, or to the clipboard.
 */
export type ExportStatus =
  | { state: 'idle' }
  | { state: 'working'; target: 'google' | 'file' | 'copy' }
  | { state: 'done'; target: 'google'; url: string; notice: Notice }
  | { state: 'done'; target: 'file'; path: string; notice: Notice }
  | { state: 'done'; target: 'copy'; notice: Notice }
  | { state: 'cancelled' }
  | { state: 'error'; target: 'google' | 'file' | 'copy'; error: Notice }

export interface ExportView {
  status: ExportStatus
  google: GoogleConnection | null
  googlePhase: 'idle' | 'connecting' | 'disconnecting'
  googleError: Notice | null
  /** An answer (with its sources) as Markdown. */
  markdownOf(message: MessageView): string
  toGoogleDoc(input: { title: string; message: MessageView }): Promise<boolean>
  toFile(input: { title: string; message: MessageView }): Promise<boolean>
  copy(message: MessageView): Promise<boolean>
  connectGoogle(): Promise<boolean>
  cancelGoogle(): Promise<void>
  disconnectGoogle(): Promise<void>
  reset(): void
}

/** A file name from a title: no path separators or control characters, at most 80 characters. */
export function fileNameOf(title: string): string {
  const cleaned = title
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is removed
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return (cleaned || 'tiger').slice(0, 80)
}

export function useExport(): ExportView {
  const { client } = useServices()
  const t = useT()
  const [status, setStatus] = useState<ExportStatus>({ state: 'idle' })
  const g = useStore(client.google.store, (s) => s, shallow)
  const spaceId = useStore(client.spaces.store, (s) => s.currentSpaceId)

  const markdownOf = useCallback(
    (m: MessageView) => answerToMarkdown(m.text, m.citations, t('export.sourcesHeading')),
    [t],
  )

  return useMemo(
    () => ({
      status,
      google: g.connection,
      googlePhase: g.phase,
      googleError: g.error ? { key: googleFlowKey(g.error) } : null,
      markdownOf,
      async toGoogleDoc({ title, message }) {
        if (!spaceId) return false
        setStatus({ state: 'working', target: 'google' })
        const r = await client.exports.googleDoc({
          spaceId,
          title: title.slice(0, 300) || 'Tiger',
          markdown: markdownOf(message),
          messageId: message.id,
        })
        if (r.ok)
          setStatus({ state: 'done', target: 'google', url: r.url, notice: { key: 'export.done' } })
        else
          setStatus({ state: 'error', target: 'google', error: { key: googleExportKey(r.error) } })
        return r.ok
      },
      async toFile({ title, message }) {
        setStatus({ state: 'working', target: 'file' })
        try {
          const path = await client.exports.saveFile({
            suggestedName: fileNameOf(title),
            content: markdownOf(message),
            extension: 'md',
          })
          setStatus(
            path
              ? { state: 'done', target: 'file', path, notice: { key: 'export.saved' } }
              : { state: 'cancelled' },
          )
          return !!path
        } catch {
          setStatus({ state: 'error', target: 'file', error: { key: 'error.internal' } })
          return false
        }
      },
      async copy(message) {
        setStatus({ state: 'working', target: 'copy' })
        try {
          await client.exports.copyMarkdown(markdownOf(message))
          setStatus({ state: 'done', target: 'copy', notice: { key: 'export.copied' } })
          return true
        } catch {
          setStatus({ state: 'error', target: 'copy', error: { key: 'error.internal' } })
          return false
        }
      },
      connectGoogle: () => client.google.connect(),
      cancelGoogle: () => client.google.cancel(),
      disconnectGoogle: () => client.google.disconnect(),
      reset: () => setStatus({ state: 'idle' }),
    }),
    [status, g, spaceId, client, markdownOf],
  )
}
