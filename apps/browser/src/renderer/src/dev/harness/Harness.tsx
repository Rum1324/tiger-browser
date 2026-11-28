import type { TigerClient } from '@tiger/client'
import type {
  CaptureResult,
  Download,
  PermissionRequest,
  Rect,
  Settings,
  TabsState,
} from '@tiger/shared'
import { type FormEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { GooglePanel } from './GooglePanel'
import { strings } from './i18n'
import { TeamPanel } from './TeamPanel'

const tiger = window.tiger

/**
 * Developer harness for the engine: just enough UI to drive every engine feature by hand. The
 * designed product UI replaces it and talks to the engine through the same window.tiger bridge.
 */
export function Harness({ client }: { client?: TigerClient } = {}) {
  const [tabs, setTabs] = useState<TabsState | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [address, setAddress] = useState('')
  const [capture, setCapture] = useState<CaptureResult | null>(null)
  const [prompts, setPrompts] = useState<PermissionRequest[]>([])
  const [downloads, setDownloads] = useState<Download[]>([])
  const [hidePage, setHidePage] = useState(false)
  const slot = useRef<HTMLDivElement>(null)
  const t = strings(settings?.locale ?? 'en')

  useEffect(() => {
    tiger.invoke('tabs.get').then(setTabs)
    tiger.invoke('settings.get').then(setSettings)
    tiger.invoke('downloads.list').then(setDownloads)
    const offs = [
      tiger.on('tabs.changed', setTabs),
      tiger.on('settings.changed', setSettings),
      tiger.on('downloads.changed', setDownloads),
      tiger.on('permission.request', (r) => setPrompts((p) => [...p, r])),
      tiger.on('shortcut', ({ action }) => {
        if (action === 'new-tab') tiger.invoke('tabs.create', {})
        if (action === 'focus-address') document.getElementById('address')?.focus()
      }),
    ]
    return () => {
      for (const off of offs) off()
    }
  }, [])

  const active = tabs?.tabs.find((x) => x.id === tabs.activeTabId) ?? null

  useEffect(() => {
    setAddress(active?.url ?? '')
  }, [active?.url])

  // The UI owns layout: report the page slot whenever it moves or resizes.
  const reportBounds = useCallback(() => {
    const el = slot.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const bounds: Rect | null = hidePage
      ? null
      : { x: r.left, y: r.top, width: r.width, height: r.height }
    tiger.invoke('page.setBounds', { bounds, cornerRadius: 8 })
  }, [hidePage])

  useLayoutEffect(() => {
    reportBounds()
    const el = slot.current
    if (!el) return
    const ro = new ResizeObserver(reportBounds)
    ro.observe(el)
    window.addEventListener('resize', reportBounds)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', reportBounds)
    }
  }, [reportBounds])

  const navigate = (e: FormEvent) => {
    e.preventDefault()
    if (!address.trim()) return
    if (active) tiger.invoke('tabs.navigate', { tabId: active.id, input: address })
    else tiger.invoke('tabs.create', { input: address })
  }

  const openOverlay = () => {
    const r = slot.current?.getBoundingClientRect()
    if (!r) return
    tiger.invoke('overlay.setOpen', {
      open: true,
      bounds: { x: r.left + 24, y: r.top + 24, width: 320, height: 180 },
    })
  }

  const answer = (p: PermissionRequest, allow: boolean, remember: boolean) => {
    tiger.invoke('permission.respond', { requestId: p.requestId, allow, remember })
    setPrompts((list) => list.filter((x) => x.requestId !== p.requestId))
  }

  return (
    <div className={tabs?.privateWindow ? 'harness private' : 'harness'}>
      <div className="strip">
        {tabs?.tabs.map((tab) => (
          <div key={tab.id} className={tab.id === tabs.activeTabId ? 'tab active' : 'tab'}>
            {tab.faviconUrl ? <img src={tab.faviconUrl} alt="" width={14} height={14} /> : null}
            <button
              type="button"
              className="tab-title"
              onClick={() => tiger.invoke('tabs.activate', { tabId: tab.id })}
            >
              {tab.isLoading ? '… ' : ''}
              {tab.title || tab.url || t.newTab}
            </button>
            <button
              type="button"
              aria-label={t.close}
              onClick={() => tiger.invoke('tabs.close', { tabId: tab.id })}
            >
              ×
            </button>
          </div>
        ))}
        <button type="button" aria-label={t.newTab} onClick={() => tiger.invoke('tabs.create', {})}>
          +
        </button>
        <button type="button" onClick={() => tiger.invoke('window.create', {})}>
          {t.newWindow}
        </button>
        <button type="button" onClick={() => tiger.invoke('window.create', { private: true })}>
          {t.newPrivateWindow}
        </button>
        {tabs?.privateWindow ? <span>{t.privateWindow}</span> : null}
      </div>

      <form className="toolbar" onSubmit={navigate}>
        <button
          type="button"
          disabled={!active?.canGoBack}
          onClick={() => active && tiger.invoke('tabs.back', { tabId: active.id })}
        >
          {t.back}
        </button>
        <button
          type="button"
          disabled={!active?.canGoForward}
          onClick={() => active && tiger.invoke('tabs.forward', { tabId: active.id })}
        >
          {t.forward}
        </button>
        <button
          type="button"
          onClick={() =>
            active &&
            tiger.invoke(active.isLoading ? 'tabs.stop' : 'tabs.reload', { tabId: active.id })
          }
        >
          {active?.isLoading ? t.stop : t.reload}
        </button>
        <input
          id="address"
          type="text"
          value={address}
          placeholder={t.addressPlaceholder}
          onChange={(e) => setAddress(e.target.value)}
        />
        <button type="submit">{t.go}</button>
        <button
          type="button"
          data-testid="capture"
          disabled={!active?.capture.allowed}
          title={active?.capture.reason ?? ''}
          onClick={async () =>
            active && setCapture(await tiger.invoke('capture.extract', { tabId: active.id }))
          }
        >
          {t.capture}
        </button>
        <label>
          <input
            type="checkbox"
            checked={hidePage}
            onChange={(e) => setHidePage(e.target.checked)}
          />
          {t.hidePage}
        </label>
        <button type="button" onClick={openOverlay}>
          {t.openOverlay}
        </button>
      </form>

      <div className="body">
        <div className="page-slot" ref={slot} />
        <div className="panel">
          {prompts.map((p) => (
            <div key={p.requestId} className="prompt">
              {p.origin} {t.permissionAsk} {p.permission}
              <div>
                <button type="button" onClick={() => answer(p, true, false)}>
                  {t.allow}
                </button>
                <button type="button" onClick={() => answer(p, false, false)}>
                  {t.deny}
                </button>
                {p.permission === 'screen-capture' ? null : (
                  <button type="button" onClick={() => answer(p, true, true)}>
                    {t.allow} + {t.remember}
                  </button>
                )}
              </div>
            </div>
          ))}
          {capture ? (
            capture.ok ? (
              <pre data-testid="capture-markdown">{capture.page.markdown}</pre>
            ) : (
              <pre data-testid="capture-error">
                {t.captureBlocked}: {capture.error} {capture.reason ?? ''} {capture.detail ?? ''}
              </pre>
            )
          ) : null}
          {settings ? <TeamPanel
              t={t}
              serverUrl={settings.serverUrl}
              activeTab={active}
              {...(client ? { client } : {})}
            /> : null}
          <GooglePanel t={t} markdown={capture?.ok ? capture.page.markdown : null} />
          {downloads.length ? (
            <div>
              <strong>{t.downloads}</strong>
              {downloads.map((d) => (
                <div key={d.id}>
                  {d.filename} — {d.state} ({d.receivedBytes}/{d.totalBytes})
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
