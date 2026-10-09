import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'

const ThemeContext = createContext(null)

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

const STORAGE_KEY = 'portfolio_theme'
const FONT_SCALE_KEY = 'portfolio_font_scale'
export const FONT_SCALE_MIN = 80
export const FONT_SCALE_MAX = 160
export const FONT_SCALE_STEP = 5

function clampFontScale(n) {
  const v = Math.round(Number(n) / FONT_SCALE_STEP) * FONT_SCALE_STEP
  return Number.isFinite(v) ? Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, v)) : 100
}

function readInitialFontScale() {
  try { return clampFontScale(localStorage.getItem(FONT_SCALE_KEY) || 100) } catch { return 100 }
}

function readInitialTheme() {
  const saved = localStorage.getItem(STORAGE_KEY)
  return saved === 'light' || saved === 'dark' ? saved : 'dark'
}

export default function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(readInitialTheme)

  // Reflect the theme onto <html data-theme="..."> so the [data-theme="light"]
  // CSS overrides in index.css take effect. Dark is the default (no override).
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  // Nearly all text is sized in rem, so scaling the root font size scales the
  // whole UI's text together.
  const [fontScale, setFontScaleRaw] = useState(readInitialFontScale)
  const setFontScale = useCallback(v => setFontScaleRaw(clampFontScale(v)), [])

  useEffect(() => {
    document.documentElement.style.fontSize = `${fontScale}%`
    try { localStorage.setItem(FONT_SCALE_KEY, String(fontScale)) } catch { /* ignore */ }
  }, [fontScale])

  // Ctrl/Cmd + / - / 0
  useEffect(() => {
    const onKey = e => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      if (e.key === '+' || e.key === '=') {
        e.preventDefault(); setFontScaleRaw(v => clampFontScale(v + FONT_SCALE_STEP))
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault(); setFontScaleRaw(v => clampFontScale(v - FONT_SCALE_STEP))
      } else if (e.key === '0') {
        e.preventDefault(); setFontScaleRaw(100)
      }
    }
    // Ctrl/Cmd + mouse wheel (non-passive so Chromium's own page zoom is suppressed)
    const onWheel = e => {
      if (!(e.ctrlKey || e.metaKey) || !e.deltaY) return
      e.preventDefault()
      setFontScaleRaw(v => clampFontScale(v + (e.deltaY < 0 ? FONT_SCALE_STEP : -FONT_SCALE_STEP)))
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onWheel)
    }
  }, [])

  const toggleTheme =useCallback(() => {
    setTheme(t => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  const value = useMemo(
    () => ({ theme, isDark: theme === 'dark', setTheme, toggleTheme, fontScale, setFontScale }),
    [theme, toggleTheme, fontScale, setFontScale]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
