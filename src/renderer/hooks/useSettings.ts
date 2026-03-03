/**
 * useSettings - 앱 설정 관리
 *
 * 테마, 언어, 글씨 크기, 알림, 사이드바 너비, 사용량 데이터 등
 * 앱 전역 설정을 관리합니다.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { type Locale, getSavedLocale, saveLocale } from '../i18n'
import { getSavedTheme, saveTheme, applyTheme } from '../themes'
import {
  type FontSize, type NotifSettings,
  getSavedFontSize, saveFontSize, applyFontSize,
  getSavedNotifSettings, saveNotifSettings,
  getSavedSessionThemes, saveSessionThemes,
  getSavedHideHud, saveHideHud,
  getSavedKeychainAccess, saveKeychainAccess
} from '../settings'
import type { UsageData } from '../../shared/types'

interface UseSettingsReturn {
  locale: Locale
  globalThemeId: string
  fontSize: FontSize
  notifSettings: NotifSettings
  sessionThemes: Record<string, string>
  hideHud: boolean
  keychainAccess: boolean
  showSettings: boolean
  sidebarWidth: number
  usageData: UsageData | null
  handleLocaleChange: (l: Locale) => void
  handleThemeChange: (id: string) => void
  handleFontSizeChange: (s: FontSize) => void
  handleNotifChange: (s: NotifSettings) => void
  handleHideHudChange: (hide: boolean) => void
  handleKeychainAccessChange: (enabled: boolean) => void
  handleSessionThemeChange: (sessionId: string, themeId: string | null) => void
  getSessionThemeId: (sessionId: string) => string
  setShowSettings: (v: boolean) => void
  handleResizeStart: (e: React.MouseEvent) => void
  cleanupSessionTheme: (id: string) => void
}

export function useSettings(): UseSettingsReturn {
  const [locale, setLocale] = useState<Locale>(getSavedLocale)
  const [globalThemeId, setGlobalThemeId] = useState(getSavedTheme)
  const [fontSize, setFontSize] = useState<FontSize>(getSavedFontSize)
  const [notifSettings, setNotifSettings] = useState<NotifSettings>(getSavedNotifSettings)
  const [sessionThemes, setSessionThemes] = useState<Record<string, string>>(getSavedSessionThemes)
  const [hideHud, setHideHud] = useState(getSavedHideHud)
  const [keychainAccess, setKeychainAccess] = useState(getSavedKeychainAccess)
  const [showSettings, setShowSettings] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const saved = localStorage.getItem('mulaude-sidebar-width')
      if (saved) return Math.max(180, Math.min(500, Number(saved)))
    } catch { /* ignore */ }
    return 240
  })
  const [usageData, setUsageData] = useState<UsageData | null>(null)
  const isResizing = useRef(false)

  // 초기 설정 적용
  useEffect(() => { applyTheme(globalThemeId) }, [globalThemeId])
  useEffect(() => { applyFontSize(fontSize) }, [fontSize])
  useEffect(() => {
    window.api.readUsage().then(setUsageData).catch(() => {})
    return window.api.onUsageUpdated(setUsageData)
  }, [])

  // 초기 locale을 main에 전달
  useEffect(() => { window.api.setLocale(locale) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 초기 HUD/키체인 설정을 main에 전달 (main은 기본값으로 시작 → renderer가 저장값으로 갱신)
  useEffect(() => {
    window.api.setHudHidden(hideHud)
    window.api.setKeychainAccess(keychainAccess)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleLocaleChange = useCallback((l: Locale) => { setLocale(l); saveLocale(l); window.api.setLocale(l) }, [])
  const handleThemeChange = useCallback((id: string) => { setGlobalThemeId(id); saveTheme(id); applyTheme(id) }, [])
  const handleFontSizeChange = useCallback((s: FontSize) => { setFontSize(s); saveFontSize(s); applyFontSize(s) }, [])
  const handleNotifChange = useCallback((s: NotifSettings) => { setNotifSettings(s); saveNotifSettings(s) }, [])
  const handleHideHudChange = useCallback((hide: boolean) => { setHideHud(hide); saveHideHud(hide); window.api.setHudHidden(hide) }, [])
  const handleKeychainAccessChange = useCallback((enabled: boolean) => { setKeychainAccess(enabled); saveKeychainAccess(enabled); window.api.setKeychainAccess(enabled) }, [])

  const handleSessionThemeChange = useCallback((sessionId: string, themeId: string | null) => {
    setSessionThemes((prev) => {
      const next = { ...prev }
      if (themeId === null) delete next[sessionId]; else next[sessionId] = themeId
      saveSessionThemes(next)
      return next
    })
  }, [])

  const getSessionThemeId = useCallback(
    (sessionId: string) => sessionThemes[sessionId] || globalThemeId,
    [sessionThemes, globalThemeId]
  )

  const cleanupSessionTheme = useCallback((id: string) => {
    setSessionThemes((prev) => {
      const n = { ...prev }; delete n[id]
      saveSessionThemes(n)
      return n
    })
  }, [])

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizing.current = true
    const onMove = (e: MouseEvent): void => {
      if (!isResizing.current) return
      setSidebarWidth(Math.max(180, Math.min(500, e.clientX)))
    }
    const onUp = (e: MouseEvent): void => {
      isResizing.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      try { localStorage.setItem('mulaude-sidebar-width', String(Math.max(180, Math.min(500, e.clientX)))) } catch { /* */ }
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  return {
    locale,
    globalThemeId,
    fontSize,
    notifSettings,
    sessionThemes,
    hideHud,
    keychainAccess,
    showSettings,
    sidebarWidth,
    usageData,
    handleLocaleChange,
    handleThemeChange,
    handleFontSizeChange,
    handleNotifChange,
    handleHideHudChange,
    handleKeychainAccessChange,
    handleSessionThemeChange,
    getSessionThemeId,
    setShowSettings,
    handleResizeStart,
    cleanupSessionTheme
  }
}
