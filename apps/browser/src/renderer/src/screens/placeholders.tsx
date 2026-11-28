import { useState } from 'react'
import { useT } from '../app/context'
import { useSurface } from '../app/surface'
import { useAskPanel } from '../features/threads'
import { usePageShare } from '../features/page-share'
import { useSignIn } from '../features/session'
import { useSpaces } from '../features/spaces'
import { useTabs } from '../features/tabs'
import { useOmnibox } from '../features/omnibox'
import { useEffect, useRef } from 'react'

/**
 * Plain stand-ins for the designed region contents and screens: enough to see that the plumbing
 * works (and to drive it in tests), nothing more. Each is replaced by a designed component through
 * `screens/index.tsx`. Not styled on purpose.
 */

export function SidebarPlaceholder() {
  const t = useT()
  const tabs = useTabs()
  const spaces = useSpaces()
  const row = (r: (typeof tabs.local)[number]) => (
    <li key={r.tab.id} data-testid="tab-row" data-tab-id={r.tab.id} aria-current={r.active ? 'page' : undefined}>
      <button type="button" onClick={() => tabs.activate(r.tab.id)}>
        {r.tab.title || r.tab.url || t('tab.new')}
      </button>
    </li>
  )
  return (
    <nav data-testid="sidebar">
      <p>{spaces.current?.name ?? ''}</p>
      <p>{t('zone.shared')}</p>
      <ul data-zone="shared">{tabs.shared.map(row)}</ul>
      <p>{t('zone.local')}</p>
      <ul data-zone="local">{[...tabs.pinned, ...tabs.local].map(row)}</ul>
      <button type="button" onClick={() => void tabs.create()}>
        {t('tab.new')}
      </button>
    </nav>
  )
}

export function ToolbarPlaceholder() {
  const t = useT()
  const omnibox = useOmnibox()
  const share = usePageShare()
  const ask = useAskPanel()
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (omnibox.focusRequest > 0) {
      input.current?.focus()
      input.current?.select()
    }
  }, [omnibox.focusRequest])
  return (
    <div data-testid="toolbar">
      <input
        ref={input}
        data-testid="address"
        aria-label={t('address.label')}
        placeholder={t('address.placeholder')}
        value={omnibox.text}
        onFocus={omnibox.begin}
        onBlur={omnibox.end}
        onChange={(e) => omnibox.setText(e.target.value)}
        onKeyDown={(e) => {
          if (omnibox.handleKey(e.key, { alt: e.altKey, meta: e.metaKey, ctrl: e.ctrlKey })) e.preventDefault()
        }}
      />
      <span data-testid="page-state" data-state={share.state}>
        {share.state}
      </span>
      <button type="button" data-overlay-anchor="ask" aria-pressed={ask.open} onClick={ask.toggle}>
        {t('ask.open')}
      </button>
    </div>
  )
}

export function AskPanelPlaceholder() {
  const t = useT()
  const ask = useAskPanel()
  const [text, setText] = useState('')
  return (
    <div data-testid="ask-panel">
      <ol>
        {ask.messages.map((m) => (
          <li key={m.id} data-phase={m.phase}>
            {m.text}
          </li>
        ))}
      </ol>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void ask.ask(text).then((ok) => ok && setText(''))
        }}
      >
        <input aria-label={t('ask.placeholder')} value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit">{t('ask.send')}</button>
      </form>
    </div>
  )
}

export function SurfacePlaceholder() {
  const t = useT()
  const { surface, completeFirstRun, go } = useSurface()
  const signIn = useSignIn()
  return (
    <div data-testid={`surface-${surface.name}`}>
      <p>{surface.name}</p>
      {surface.name === 'first-run' ? (
        <>
          <p>{t('firstRun.body')}</p>
          <button type="button" data-testid="first-run-skip" onClick={completeFirstRun}>
            {t('firstRun.skip')}
          </button>
        </>
      ) : null}
      {surface.name === 'sign-in' ? (
        <button type="button" disabled={signIn.working} onClick={() => void signIn.signInWithGoogle()}>
          {t('signIn.google')}
        </button>
      ) : null}
      {surface.name !== 'page' && surface.name !== 'first-run' && surface.name !== 'new-tab' ? (
        <button type="button" onClick={() => go({ name: 'page' })}>
          {t('common.close')}
        </button>
      ) : null}
    </div>
  )
}
