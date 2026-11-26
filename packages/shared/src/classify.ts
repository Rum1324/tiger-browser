// This module must stay free of zod: it is bundled into the sandboxed page preload.
import type { SourceType } from './domain'

/**
 * Capture eligibility: the single rule that decides whether a page's content may ever leave the machine.
 * The engine (main process) calls this before every extraction; the UI calls the same function to explain
 * the state. A page that fails here cannot be shared or attached, whatever the UI does.
 */

export const CAPTURE_BLOCK_REASONS = [
  'incognito',
  'scheme',
  'banking',
  'email',
  'password-manager',
  'auth',
  'government-id',
  'local-network',
  'user-rule',
] as const
export type CaptureBlockReason = (typeof CAPTURE_BLOCK_REASONS)[number]

export interface CaptureEligibility {
  allowed: boolean
  reason: CaptureBlockReason | null
  /** The rule that matched, for display: a host suffix or a path pattern name. */
  rule: string | null
}

interface HostRule {
  category: Exclude<CaptureBlockReason, 'incognito' | 'scheme' | 'user-rule' | 'local-network'>
  /** Host suffixes, matched on a label boundary: `mufg.jp` matches `direct.bk.mufg.jp`, not `notmufg.jp`. */
  hosts: readonly string[]
}

const HOST_RULES: readonly HostRule[] = [
  {
    category: 'banking',
    hosts: [
      // Japan: banks
      'mufg.jp',
      'smbc.co.jp',
      'mizuhobank.co.jp',
      'japanpost.jp',
      'resonabank.co.jp',
      'saitamaresona.co.jp',
      'rakuten-bank.co.jp',
      'netbk.co.jp',
      'sbishinseibank.co.jp',
      'paypay-bank.co.jp',
      'sonybank.jp',
      'aeonbank.co.jp',
      'aozorabank.co.jp',
      'jibunbank.co.jp',
      'gmo-aozora.com',
      'sevenbank.co.jp',
      'smtb.jp',
      // Japan: brokerages, cards, household finance, tax
      'sbisec.co.jp',
      'rakuten-sec.co.jp',
      'monex.co.jp',
      'nomura.co.jp',
      'matsui.co.jp',
      'smbc-card.com',
      'rakuten-card.co.jp',
      'jcb.co.jp',
      'saisoncard.co.jp',
      'eposcard.co.jp',
      'moneyforward.com',
      'zaim.net',
      'e-tax.nta.go.jp',
      // Global
      'paypal.com',
      'wise.com',
      'revolut.com',
      'chase.com',
      'bankofamerica.com',
      'wellsfargo.com',
      'citi.com',
      'hsbc.com',
      'americanexpress.com',
      'schwab.com',
      'fidelity.com',
      'coinbase.com',
      'binance.com',
      'bitflyer.com',
      'coincheck.com',
    ],
  },
  {
    category: 'email',
    hosts: [
      'mail.google.com',
      'outlook.live.com',
      'outlook.office.com',
      'outlook.office365.com',
      'mail.yahoo.co.jp',
      'mail.yahoo.com',
      'mail.proton.me',
      'app.fastmail.com',
      'mail.zoho.com',
      'app.hey.com',
      'mail.superhuman.com',
    ],
  },
  {
    category: 'password-manager',
    hosts: [
      '1password.com',
      '1password.eu',
      'bitwarden.com',
      'lastpass.com',
      'dashlane.com',
      'keepersecurity.com',
      'nordpass.com',
      'passwords.google.com',
    ],
  },
  {
    category: 'auth',
    hosts: [
      'accounts.google.com',
      'myaccount.google.com',
      'login.microsoftonline.com',
      'login.live.com',
      'appleid.apple.com',
      'account.apple.com',
      'auth0.com',
      'okta.com',
      'onelogin.com',
    ],
  },
  {
    category: 'government-id',
    hosts: ['myna.go.jp', 'mynaportal.go.jp', 'nenkin.go.jp'],
  },
]

/**
 * Sign-in and credential pages on any site, matched on the first two path segments.
 * A documentation page about OAuth (`/docs/oauth2`, `developers.example.com/.../oauth2`) is not a
 * credential page, so a docs-like segment or host label cancels the match.
 * The rule is deliberately narrow: a missed sign-in page exposes a form with no private content,
 * while a false match stops a member sharing a page they need. Deeper sign-in pages rely on the
 * host rules.
 */
const AUTH_SEGMENT =
  /^(login|log-in|log_in|signin|sign-in|sign_in|signup|sign-up|sign_up|password|passwd|reset-password|2fa|mfa|two-factor|oauth2?|authorize|sso|saml)(\.[a-z0-9]+)?$/i
const DOCS_SEGMENT =
  /^(docs?|documentation|help|support|blog|guides?|articles?|learn|kb|wiki|reference|manual)$/i

const DOCS_HOST_LABEL = /^(developers?|docs?|support|help|learn|blog|wiki|dev|api)$/i

function isAuthPath(host: string, pathname: string): boolean {
  if (DOCS_HOST_LABEL.test(host.split('.')[0] ?? '')) return false
  const segments = pathname.split('/').filter(Boolean).slice(0, 2)
  for (const segment of segments) {
    if (DOCS_SEGMENT.test(segment)) return false
    if (AUTH_SEGMENT.test(segment)) return true
  }
  return false
}

/** iCloud Mail lives under a path on a host that also serves non-mail apps. */
const PATH_RULES: readonly {
  category: CaptureBlockReason
  host: string
  path: RegExp
  name: string
}[] = [{ category: 'email', host: 'icloud.com', path: /^\/mail(\/|$)/i, name: 'icloud.com/mail' }]

function hostMatches(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`)
}

function isLocalNetworkHost(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) return true
  if (host.startsWith('[')) {
    const v6 = host.slice(1, -1).toLowerCase()
    return v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80')
  }
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  )
}

const blocked = (reason: CaptureBlockReason, rule: string): CaptureEligibility => ({
  allowed: false,
  reason,
  rule,
})

export interface CaptureContext {
  /** True for tabs in a private (incognito) session. */
  incognito: boolean
  /** Host suffixes the member added themselves. */
  userBlockedHosts?: readonly string[]
}

export function captureEligibility(rawUrl: string, ctx: CaptureContext): CaptureEligibility {
  if (ctx.incognito) return blocked('incognito', 'incognito')

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return blocked('scheme', 'invalid-url')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return blocked('scheme', url.protocol)
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (isLocalNetworkHost(host)) return blocked('local-network', host)

  for (const suffix of ctx.userBlockedHosts ?? []) {
    const s = suffix.toLowerCase().trim()
    if (s && hostMatches(host, s)) return blocked('user-rule', s)
  }
  for (const rule of HOST_RULES) {
    for (const suffix of rule.hosts) {
      if (hostMatches(host, suffix)) return blocked(rule.category, suffix)
    }
  }
  for (const rule of PATH_RULES) {
    if (hostMatches(host, rule.host) && rule.path.test(url.pathname)) {
      return blocked(rule.category, rule.name)
    }
  }
  if (isAuthPath(host, url.pathname)) return blocked('auth', 'auth-path')

  return { allowed: true, reason: null, rule: null }
}

/** Classify a URL by the app it belongs to; picks the extractor and the source glyph. */
export function sourceTypeForUrl(rawUrl: string): SourceType {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return 'other'
  }
  const host = url.hostname.toLowerCase()
  const path = url.pathname
  if (host === 'docs.google.com') {
    if (path.startsWith('/document/')) return 'google-doc'
    if (path.startsWith('/spreadsheets/')) return 'google-sheet'
    if (path.startsWith('/presentation/')) return 'google-slides'
  }
  if (hostMatches(host, 'slack.com')) return 'slack'
  if (hostMatches(host, 'notion.so') || hostMatches(host, 'notion.site')) return 'notion'
  if (/\.pdf$/i.test(path)) return 'pdf'
  return url.protocol === 'https:' || url.protocol === 'http:' ? 'web' : 'other'
}

export { MAX_MARKDOWN_CHARS } from './limits'
export { canonicalUrl } from './url'
