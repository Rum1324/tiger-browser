import { type ReactNode, useEffect } from 'react'
import { useEngineSettings } from '../engine/hooks'
import {
  AskPanelRegion,
  PageCoverage,
  PageSlot,
  Sidebar,
  Stage,
  SurfaceRegion,
  Toolbar,
  WindowFrame,
} from '../layout/regions'
import { regionContent, surfaceScreens } from '../screens'
import { useLocale, useT } from './context'
import { ErrorBoundary, type FallbackProps } from './ErrorBoundary'
import { useSurface } from './surface'
import { useThemeEffect } from './useTheme'

/** Keep <html lang> in step with the UI locale (screen readers, fonts, line breaking). */
function useDocumentLang() {
  const locale = useLocale()
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])
}

/** A region that crashed shows this instead; the rest of the chrome keeps working. */
function RegionFallback({ retry }: FallbackProps) {
  const t = useT()
  return (
    <div role="alert" data-testid="region-error">
      <p>{t('boundary.title')}</p>
      <button type="button" onClick={retry}>
        {t('boundary.retry')}
      </button>
    </div>
  )
}

function Guard({ name, children }: { name: string; children: ReactNode }) {
  return (
    <ErrorBoundary name={name} fallback={(p) => <RegionFallback {...p} />}>
      {children}
    </ErrorBoundary>
  )
}

/**
 * The main view: the regions, what is drawn in them, and routing between the page card and the
 * surfaces that replace it. Theme and page-slot coverage are applied here.
 */
export function Shell() {
  useThemeEffect(useEngineSettings((s) => s?.theme ?? 'system'))
  useDocumentLang()
  const { surface } = useSurface()
  const SidebarContent = regionContent.sidebar
  const ToolbarContent = regionContent.toolbar
  const AskContent = regionContent.askPanel
  const Screen = surface.name === 'page' ? null : surfaceScreens[surface.name]
  return (
    <WindowFrame>
      <PageCoverage />
      <Sidebar>
        <Guard name="sidebar">
          <SidebarContent />
        </Guard>
      </Sidebar>
      <Toolbar>
        <Guard name="toolbar">
          <ToolbarContent />
        </Guard>
      </Toolbar>
      <Stage>
        {Screen ? (
          <SurfaceRegion>
            <Guard name={`surface:${surface.name}`}>
              <Screen />
            </Guard>
          </SurfaceRegion>
        ) : (
          <PageSlot />
        )}
      </Stage>
      <AskPanelRegion>
        <Guard name="ask-panel">
          <AskContent />
        </Guard>
      </AskPanelRegion>
    </WindowFrame>
  )
}
