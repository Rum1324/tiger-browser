import { elementToMarkdown, type MdContext } from './markdown'
import { collapseSpaces } from './text'

/**
 * Slack web client conversation view. Selectors follow the public `data-qa` hooks and `c-message_kit`
 * class names of app.slack.com; they were written against fixture DOMs, not checked on a live workspace.
 * Only message containers are read, so the composer (an unsent draft) is never captured.
 */

export interface SlackResult {
  title: string
  markdown: string
  siteName: string
}

function text(el: Element | null | undefined): string {
  return collapseSpaces(el?.textContent ?? '')
}

/** Slack message timestamps are `seconds.sequence` in UTC. */
export function slackTsToIso(ts: string | null): string | null {
  if (!ts || !/^\d{9,11}(\.\d+)?$/.test(ts)) return null
  const ms = Math.round(Number.parseFloat(ts) * 1000)
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return null
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

function messageTime(msg: Element): string | null {
  const stamp = msg.querySelector('[data-qa="timestamp"], a.c-timestamp')
  if (!stamp) return null
  return (
    slackTsToIso(stamp.getAttribute('data-ts')) ||
    collapseSpaces(stamp.getAttribute('aria-label') ?? '') ||
    text(stamp) ||
    null
  )
}

function unwrapMentions(root: Element): void {
  const doc = root.ownerDocument
  for (const a of Array.from(
    root.querySelectorAll(
      'a.c-member_slug, a.c-channel_entity_name, a[data-stringify-type="mention"]',
    ),
  )) {
    a.replaceWith(doc.createTextNode(a.textContent ?? ''))
  }
}

function renderMessage(msg: Element, author: string, ctx: MdContext): string {
  const time = messageTime(msg)
  const header = `**${author.replace(/[*_[\]\\]/g, '\\$&')}**${time ? ` · ${time}` : ''}`
  const parts: string[] = [header]
  const body = msg.querySelector('[data-qa="message-text"], .c-message_kit__blocks')
  if (body) {
    unwrapMentions(body)
    const md = elementToMarkdown(body, ctx)
    if (md) parts.push(md)
  }
  for (const att of Array.from(
    msg.querySelectorAll('.c-message_kit__attachments, [data-qa="message_attachment"]'),
  )) {
    const md = elementToMarkdown(att, ctx)
    if (md) parts.push(md)
  }
  const reactions = Array.from(msg.querySelectorAll('.c-reaction'))
    .map((r) => {
      const name = r.querySelector('img')?.getAttribute('alt') ?? ''
      const n = text(r.querySelector('.c-reaction__count'))
      return name ? `${name} ${n}`.trim() : ''
    })
    .filter(Boolean)
  if (reactions.length) parts.push(`Reactions: ${reactions.join(', ')}`)
  const replyCount = text(msg.querySelector('[data-qa="reply_bar_count"]'))
  if (replyCount) {
    const last = text(msg.querySelector('[data-qa="reply_bar_last_reply"]'))
    parts.push(`_Thread: ${replyCount}${last ? ` · ${last}` : ''}_`)
  }
  // Header and body on adjacent lines keep the attribution attached to the text it belongs to.
  return [parts.slice(0, 2).join('\n'), ...parts.slice(2)].join('\n\n')
}

function renderList(list: Element, ctx: MdContext, withDays: boolean): string[] {
  const out: string[] = []
  let author = ''
  const items = list.querySelectorAll('.c-virtual_list__item')
  const units =
    items.length > 0
      ? Array.from(items)
      : Array.from(list.querySelectorAll('[data-qa="message_container"]'))
  for (const item of units) {
    if (ctx.stopped) break
    const day = item.querySelector('.c-message_list__day_divider__label')
    if (day) {
      if (withDays) {
        const label = text(day)
        if (label) out.push(`## ${label}`)
      }
      author = ''
      continue
    }
    const msg = item.matches('[data-qa="message_container"]')
      ? item
      : item.querySelector('[data-qa="message_container"]')
    if (!msg) continue
    const sender = text(
      msg.querySelector('[data-qa="message_sender_name"], .c-message__sender_button'),
    )
    // Consecutive messages from one person omit the name; they inherit the previous sender.
    if (sender) author = sender
    out.push(renderMessage(msg, author || 'Unknown', ctx))
  }
  return out
}

export function extractSlack(doc: Document, ctx: MdContext): SlackResult | null {
  const threadPane = doc.querySelector('[data-qa="threads_flexpane"], .p-threads_flexpane')
  const lists = Array.from(doc.querySelectorAll('[data-qa="slack_kit_list"]'))
  const mainList = lists.find((l) => !threadPane?.contains(l))
  const threadList = threadPane?.querySelector('[data-qa="slack_kit_list"]') ?? null
  if (!mainList && !threadList) return null

  const pageTitle = collapseSpaces(doc.title)
  const titleParts = pageTitle.split(' - ')
  const channel =
    text(doc.querySelector('[data-qa="channel_name"]')) ||
    (titleParts[0] ?? '').replace(/\s*\(.*\)$/, '')
  const workspace = titleParts.length >= 3 ? (titleParts[titleParts.length - 2] ?? '') : ''

  const sections: string[] = []
  if (mainList) sections.push(...renderList(mainList, ctx, true))
  if (threadList) {
    const thread = renderList(threadList, ctx, false)
    if (thread.length) {
      const where = text(threadPane?.querySelector('.p-flexpane_header__secondary_content'))
      sections.push('---', `## Thread${where ? ` in ${where}` : ''}`, ...thread)
    }
  }
  if (sections.every((s) => s.startsWith('## ') || s === '---')) return null
  const title = channel ? `#${channel.replace(/^#/, '')}` : pageTitle || 'Slack'
  return {
    title,
    markdown: sections.join('\n\n'),
    siteName: workspace ? `${workspace} · Slack` : 'Slack',
  }
}
