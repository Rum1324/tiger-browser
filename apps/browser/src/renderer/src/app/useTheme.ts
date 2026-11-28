import { useEffect, useState } from 'react'
import { useEngineSettings } from '../engine/hooks'
import { applyTheme, resolveTheme, type Theme, watchSystemDark } from './theme'

/**
 * Apply Settings.theme (light, dark, or follow the system) to <html data-theme>. Returns the theme
 * in effect. Used by the main view and the overlay view, which both follow the same setting.
 */
export function useThemeEffect(override?: Theme): Theme {
  const setting = useEngineSettings((s) => s?.theme ?? 'system')
  const [systemDark, setSystemDark] = useState(false)
  useEffect(() => {
    const w = watchSystemDark(setSystemDark)
    setSystemDark(w.dark)
    return w.stop
  }, [])
  const theme = override ?? resolveTheme(setting, systemDark)
  useEffect(() => {
    applyTheme(theme)
  }, [theme])
  return theme
}
