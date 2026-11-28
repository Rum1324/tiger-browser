import { useEffect, useState } from 'react'
import { applyTheme, resolveTheme, type Theme, type ThemeSetting, watchSystemDark } from './theme'

/**
 * Apply Settings.theme (light, dark, or follow the system) to <html data-theme>. Returns the theme
 * in effect. The main view and the overlay view both call it with the engine setting.
 */
export function useThemeEffect(setting: ThemeSetting, override?: Theme): Theme {
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
