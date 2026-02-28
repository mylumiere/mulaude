/**
 * SettingsModal - 앱 설정 모달
 *
 * 탭 구조: 외형 | 알림 | 고급
 * 모든 변경은 즉시 적용 (auto-save 패턴).
 */

import { useState, useEffect } from 'react'
import { type Locale, LOCALES, t } from '../i18n'
import { THEMES } from '../themes'
import {
  type FontSize, type NotifSettings, type NotifEvent,
  FONT_SIZES, NOTIF_EVENTS
} from '../settings'
import type { SessionInfo } from '../../shared/types'
import './SettingsModal.css'

type SettingsTab = 'appearance' | 'notifications' | 'advanced'

interface SettingsModalProps {
  locale: Locale
  onLocaleChange: (locale: Locale) => void
  globalThemeId: string
  onThemeChange: (themeId: string) => void
  fontSize: FontSize
  onFontSizeChange: (size: FontSize) => void
  notifSettings: NotifSettings
  onNotifChange: (settings: NotifSettings) => void
  hideHud: boolean
  onHideHudChange: (hide: boolean) => void
  sessions: SessionInfo[]
  onClose: () => void
}

export default function SettingsModal({
  locale,
  onLocaleChange,
  globalThemeId,
  onThemeChange,
  fontSize,
  onFontSizeChange,
  notifSettings,
  onNotifChange,
  hideHud,
  onHideHudChange,
  sessions,
  onClose
}: SettingsModalProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance')
  const [notifTab, setNotifTab] = useState<'global' | string>('global')

  // ─── 알림 핸들러 (즉시 적용) ───
  const toggleGlobalNotif = (event: NotifEvent): void => {
    onNotifChange({
      ...notifSettings,
      global: { ...notifSettings.global, [event]: !notifSettings.global[event] }
    })
  }

  const toggleSessionNotif = (sessionId: string, event: NotifEvent): void => {
    const current = notifSettings.perSession[sessionId] || { ...notifSettings.global }
    onNotifChange({
      ...notifSettings,
      perSession: {
        ...notifSettings.perSession,
        [sessionId]: { ...current, [event]: !current[event] }
      }
    })
  }

  const resetSessionNotif = (sessionId: string): void => {
    const next = { ...notifSettings.perSession }
    delete next[sessionId]
    onNotifChange({ ...notifSettings, perSession: next })
    setNotifTab('global')
  }

  const currentNotifEvents =
    notifTab === 'global'
      ? notifSettings.global
      : notifSettings.perSession[notifTab] || notifSettings.global

  const hasOverride = notifTab !== 'global' && !!notifSettings.perSession[notifTab]

  // ─── ESC 키로 닫기 ───
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose])

  const TABS: { id: SettingsTab; labelKey: string }[] = [
    { id: 'appearance', labelKey: 'settings.tab.appearance' },
    { id: 'notifications', labelKey: 'settings.tab.notifications' },
    { id: 'advanced', labelKey: 'settings.tab.advanced' },
  ]

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h3>{t(locale, 'settings.title')}</h3>
          <button className="settings-close-btn" onClick={onClose}>×</button>
        </div>

        {/* 탭 바 */}
        <div className="settings-tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`settings-tab ${activeTab === tab.id ? 'settings-tab--active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {t(locale, tab.labelKey)}
            </button>
          ))}
        </div>

        <div className="settings-body">
          {/* ──── 외형 탭 ──── */}
          {activeTab === 'appearance' && (
            <>
              <div className="settings-section">
                <label className="settings-label">{t(locale, 'settings.themeGlobal')}</label>
                <div className="settings-theme-grid">
                  {THEMES.map((theme) => (
                    <button
                      key={theme.id}
                      className={`theme-card ${globalThemeId === theme.id ? 'theme-card--active' : ''}`}
                      onClick={() => onThemeChange(theme.id)}
                    >
                      <div className="theme-card-preview">
                        <div className="theme-card-bg" style={{ background: theme.cssVars['--bg-deep'] }}>
                          <div className="theme-card-sidebar" style={{ background: theme.cssVars['--bg-surface'] }} />
                          <div className="theme-card-content">
                            <div className="theme-card-accent" style={{ background: theme.accent }} />
                            <div className="theme-card-line" style={{ background: theme.cssVars['--text-muted'] }} />
                            <div className="theme-card-line theme-card-line--short" style={{ background: theme.cssVars['--text-ghost'] }} />
                          </div>
                        </div>
                      </div>
                      <span className="theme-card-name">{theme.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-section">
                <label className="settings-label">{t(locale, 'settings.fontSize')}</label>
                <div className="font-size-bar">
                  {FONT_SIZES.map((opt) => (
                    <button
                      key={opt.id}
                      className={`font-size-btn ${fontSize === opt.id ? 'font-size-btn--active' : ''}`}
                      onClick={() => onFontSizeChange(opt.id)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ──── 알림 탭 ──── */}
          {activeTab === 'notifications' && (
            <div className="settings-section">
              <div className="notif-tabs">
                <button
                  className={`notif-tab ${notifTab === 'global' ? 'notif-tab--active' : ''}`}
                  onClick={() => setNotifTab('global')}
                >
                  {t(locale, 'notif.global')}
                </button>
                {sessions.map((s) => (
                  <button
                    key={s.id}
                    className={`notif-tab ${notifTab === s.id ? 'notif-tab--active' : ''}`}
                    onClick={() => setNotifTab(s.id)}
                  >
                    {s.name}
                  </button>
                ))}
              </div>

              <div className="notif-toggles">
                {NOTIF_EVENTS.map((evt) => (
                  <div key={evt.id} className="notif-toggle-row">
                    <span className="notif-toggle-label">{t(locale, evt.labelKey)}</span>
                    <button
                      className={`notif-toggle ${currentNotifEvents[evt.id] ? 'notif-toggle--on' : ''}`}
                      onClick={() =>
                        notifTab === 'global'
                          ? toggleGlobalNotif(evt.id)
                          : toggleSessionNotif(notifTab, evt.id)
                      }
                    >
                      <div className="notif-toggle-knob" />
                    </button>
                  </div>
                ))}
                {hasOverride && (
                  <button
                    className="notif-reset-btn"
                    onClick={() => resetSessionNotif(notifTab)}
                  >
                    Reset to global
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ──── 고급 탭 ──── */}
          {activeTab === 'advanced' && (
            <>
              <div className="settings-section">
                <label className="settings-label">{t(locale, 'settings.hud')}</label>
                <div className="notif-toggles">
                  <div className="notif-toggle-row">
                    <span className="notif-toggle-label">{t(locale, 'settings.hideHud')}</span>
                    <button
                      className={`notif-toggle ${hideHud ? 'notif-toggle--on' : ''}`}
                      onClick={() => onHideHudChange(!hideHud)}
                    >
                      <div className="notif-toggle-knob" />
                    </button>
                  </div>
                  <p className="settings-hint">{t(locale, 'settings.hideHudDesc')}</p>
                </div>
              </div>

              <div className="settings-section">
                <label className="settings-label">{t(locale, 'settings.language')}</label>
                <div className="settings-locale-grid">
                  {LOCALES.map((loc) => (
                    <button
                      key={loc.code}
                      className={`settings-locale-btn ${locale === loc.code ? 'settings-locale-btn--active' : ''}`}
                      onClick={() => onLocaleChange(loc.code)}
                    >
                      <span className="settings-locale-native">{loc.nativeLabel}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
