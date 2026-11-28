import { translate } from '../i18n'
import { type AppBoot, useAppBoot } from './boot'
import { ServicesProvider } from './context'
import { ErrorBoundary } from './ErrorBoundary'
import { Shell } from './Shell'

/** The whole UI failed to draw: offer to reload it (pages and tabs live in the engine, unaffected). */
function AppFallback() {
  const lang = document.documentElement.lang === 'en' ? 'en' : 'ja'
  return (
    <div role="alert" data-testid="app-error">
      <p>{translate(lang, 'boundary.title')}</p>
      <p>{translate(lang, 'boundary.body')}</p>
      <button type="button" onClick={() => location.reload()}>
        {translate(lang, 'boundary.reload')}
      </button>
    </div>
  )
}

/** The main view's root: boot, providers, the outer error boundary, the shell. */
export function App({ boot }: { boot: AppBoot }) {
  const state = useAppBoot(boot)
  if (state.phase === 'failed') return <AppFallback />
  if (state.phase === 'starting') return null
  return (
    <ErrorBoundary name="app" fallback={() => <AppFallback />}>
      <ServicesProvider services={state.services}>
        <Shell />
      </ServicesProvider>
    </ErrorBoundary>
  )
}
