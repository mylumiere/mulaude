/**
 * SettingsModal - 앱 설정 모달
 *
 * 탭 구조: 외형 | 알림 | 고급
 * 모든 변경은 즉시 적용 (auto-save 패턴).
 */

import { useState, useEffect, useCallback } from 'react'
import { X } from 'lucide-react'
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
  hideHud: boolean
  onHideHudChange: (hide: boolean) => void
  keychainAccess: boolean
  onKeychainAccessChange: (enabled: boolean) => void
  notifSettings: NotifSettings
  onNotifChange: (settings: NotifSettings) => void
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
  hideHud,
  onHideHudChange,
  keychainAccess,
  onKeychainAccessChange,
  notifSettings,
  onNotifChange,
  sessions,
  onClose
}: SettingsModalProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance')
  const [notifTab, setNotifTab] = useState<'global' | string>('global')
  const [keychainConfirm, setKeychainConfirm] = useState(false)

  /** 키체인 토글 — 켤 때는 확인 단계 표시, 끌 때는 바로 적용 */
  const handleKeychainToggle = useCallback(() => {
    if (keychainAccess) {
      // 끄기: 바로 적용
      onKeychainAccessChange(false)
      setKeychainConfirm(false)
    } else {
      // 켜기: 확인 단계 표시
      setKeychainConfirm(true)
    }
  }, [keychainAccess, onKeychainAccessChange])

  const confirmKeychainAccess = useCallback(() => {
    onKeychainAccessChange(true)
    setKeychainConfirm(false)
  }, [onKeychainAccessChange])

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
          <button className="settings-close-btn" onClick={onClose}><X size={14} /></button>
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

              <div className="settings-section">
                <label className="settings-label">{t(locale, 'settings.hud')}</label>

                {/* HUD 오버레이 숨기기 토글 */}
                <div className="notif-toggle-row">
                  <div>
                    <span className="notif-toggle-label">{t(locale, 'settings.hideHud')}</span>
                    <span className="settings-hint">{t(locale, 'settings.hideHudDesc')}</span>
                  </div>
                  <button
                    className={`notif-toggle ${hideHud ? 'notif-toggle--on' : ''}`}
                    onClick={() => onHideHudChange(!hideHud)}
                  >
                    <div className="notif-toggle-knob" />
                  </button>
                </div>

                {/* Keychain 접근 허용 토글 */}
                <div className="notif-toggle-row">
                  <div>
                    <span className="notif-toggle-label">{t(locale, 'settings.keychainAccess')}</span>
                    <span className="settings-hint">{t(locale, 'settings.keychainDesc')}</span>
                  </div>
                  <button
                    className={`notif-toggle ${keychainAccess ? 'notif-toggle--on' : ''}`}
                    onClick={handleKeychainToggle}
                  >
                    <div className="notif-toggle-knob" />
                  </button>
                </div>
                {keychainConfirm && (
                  <div className="settings-confirm">
                    <span className="settings-confirm-text">{t(locale, 'settings.keychainConfirm')}</span>
                    <div className="settings-confirm-actions">
                      <button className="settings-confirm-btn settings-confirm-btn--ok" onClick={confirmKeychainAccess}>
                        {t(locale, 'settings.keychainAllow')}
                      </button>
                      <button className="settings-confirm-btn" onClick={() => setKeychainConfirm(false)}>
                        {t(locale, 'settings.keychainDeny')}
                      </button>
                    </div>
                  </div>
                )}

                {/* 둘 다 비활성이면 안내 메시지 */}
                {hideHud && !keychainAccess && (
                  <div className="settings-hint settings-hint--info">
                    {t(locale, 'settings.rateLimitWarn')}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
