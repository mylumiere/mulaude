/**
 * TutorialOverlay - 인터랙티브 튜토리얼 UI
 *
 * welcome: 중앙 웰컴 다이얼로그
 * steps:
 *   - click: SVG 스포트라이트 + 클릭 프록시
 *   - drag: 비차단 오버레이 (드래그 가능) + 드래그 힌트
 *   - shortcut: 차단 오버레이 + 키 힌트
 *   - null: SVG 스포트라이트 + Next/Prev
 */

import type { TutorialState } from '../hooks/useTutorial'
import { type Locale, t, LOCALES } from '../i18n'
import { THEMES } from '../themes'
import tutorialOctopus from '../assets/tutorial-octopus.png'
import './TutorialOverlay.css'

interface TutorialOverlayProps {
  tutorial: TutorialState
  locale: Locale
  /** setup 페이즈에서 사용 */
  globalThemeId?: string
  onLocaleChange?: (locale: Locale) => void
  onThemeChange?: (themeId: string) => void
}

const PADDING = 8
const TOOLTIP_GAP = 16

export default function TutorialOverlay({ tutorial, locale, globalThemeId, onLocaleChange, onThemeChange }: TutorialOverlayProps): JSX.Element | null {
  const { phase } = tutorial

  if (phase === 'idle') return null

  // ── 셋업 다이얼로그 (언어 + 테마 선택) ──
  if (phase === 'setup') {
    return (
      <div className="tutorial-overlay tutorial-overlay-blocking">
        <div className="tutorial-backdrop" />
        <div className="tutorial-setup">
          <div className="tutorial-setup-icon">
            <img src={tutorialOctopus} alt="Setup" className="tutorial-welcome-img" />
          </div>
          <div className="tutorial-setup-title">{t(locale, 'tutorial.setup.title')}</div>
          <div className="tutorial-setup-desc">{t(locale, 'tutorial.setup.desc')}</div>

          {/* 언어 선택 */}
          <div className="tutorial-setup-section">
            <div className="tutorial-setup-label">{t(locale, 'tutorial.setup.language')}</div>
            <div className="tutorial-setup-locale-grid">
              {LOCALES.map((loc) => (
                <button
                  key={loc.code}
                  className={`tutorial-setup-locale-btn${locale === loc.code ? ' active' : ''}`}
                  onClick={() => onLocaleChange?.(loc.code)}
                >
                  <span className="tutorial-setup-locale-native">{loc.nativeLabel}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 테마 선택 */}
          <div className="tutorial-setup-section">
            <div className="tutorial-setup-label">{t(locale, 'tutorial.setup.theme')}</div>
            <div className="tutorial-setup-theme-grid">
              {THEMES.map((theme) => (
                <button
                  key={theme.id}
                  className={`tutorial-setup-theme-btn${globalThemeId === theme.id ? ' active' : ''}`}
                  onClick={() => onThemeChange?.(theme.id)}
                  title={theme.name}
                >
                  <div
                    className="tutorial-setup-theme-swatch"
                    style={{ background: theme.accent }}
                  />
                  <span className="tutorial-setup-theme-name">{theme.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="tutorial-setup-actions">
            <button className="tutorial-btn-start" onClick={tutorial.confirmSetup}>
              {t(locale, 'tutorial.setup.continue')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── 웰컴 다이얼로그 ──
  if (phase === 'welcome') {
    return (
      <div className="tutorial-overlay tutorial-overlay-blocking">
        <div className="tutorial-backdrop" />
        <div className="tutorial-welcome">
          <div className="tutorial-welcome-icon">
            <img src={tutorialOctopus} alt="Tutorial" className="tutorial-welcome-img" />
          </div>
          <div className="tutorial-welcome-title">{t(locale, 'tutorial.welcome.title')}</div>
          <div className="tutorial-welcome-desc">{t(locale, 'tutorial.welcome.desc')}</div>
          <div className="tutorial-welcome-actions">
            <button className="tutorial-btn-later" onClick={tutorial.dismiss}>
              {t(locale, 'tutorial.later')}
            </button>
            <button className="tutorial-btn-start" onClick={tutorial.start}>
              {t(locale, 'tutorial.start')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── 스텝 진행 ──
  const { steps, currentStep, targetRect, next, prev, dismiss, handleClickProxy } = tutorial
  const step = steps[currentStep]
  const isLast = currentStep === steps.length - 1
  const actionType = step.action
  const hasTarget = targetRect !== null

  // 드래그 스텝: 오버레이 비차단 (드래그 허용)
  const isDrag = actionType === 'drag'
  const canGoPrev = currentStep > 0

  // 스포트라이트 영역
  const sx = hasTarget ? targetRect.x - PADDING : 0
  const sy = hasTarget ? targetRect.y - PADDING : 0
  const sw = hasTarget ? targetRect.width + PADDING * 2 : 0
  const sh = hasTarget ? targetRect.height + PADDING * 2 : 0

  // 툴팁 위치 계산
  let tooltipStyle: React.CSSProperties = {}
  let arrowDir: 'left' | 'right' | null = null

  if (hasTarget) {
    if (step.position === 'inside') {
      tooltipStyle = {
        left: targetRect.x + targetRect.width / 2 - 150,
        top: targetRect.y + targetRect.height / 2 - 60,
      }
      arrowDir = null
    } else if (step.position === 'right') {
      tooltipStyle = {
        left: targetRect.x + targetRect.width + TOOLTIP_GAP + PADDING,
        top: targetRect.y + targetRect.height / 2 - 30,
      }
      arrowDir = 'left'
    } else {
      tooltipStyle = {
        left: targetRect.x - PADDING - TOOLTIP_GAP - 300,
        top: targetRect.y + targetRect.height / 2 - 30,
      }
      arrowDir = 'right'
    }
  }

  return (
    <div
      className={`tutorial-overlay ${isDrag ? '' : 'tutorial-overlay-blocking'}`}
      key={currentStep}
    >
      {/* SVG 스포트라이트 */}
      <svg className="tutorial-spotlight">
        <defs>
          <mask id="tutorial-mask">
            <rect width="100%" height="100%" fill="white" />
            {hasTarget && (
              <rect x={sx} y={sy} width={sw} height={sh} rx={8} fill="black" />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.6)"
          mask="url(#tutorial-mask)"
        />
      </svg>

      {/* 클릭 프록시 (action='click') */}
      {actionType === 'click' && hasTarget && (
        <div
          className="tutorial-click-proxy"
          style={{ left: sx, top: sy, width: sw, height: sh }}
          onClick={handleClickProxy}
        />
      )}

      {/* 툴팁 */}
      <div
        className={`tutorial-tooltip${hasTarget ? '' : ' center'}`}
        style={hasTarget ? tooltipStyle : undefined}
      >
        {arrowDir && (
          <div className={`tutorial-tooltip-arrow arrow-${arrowDir}`} />
        )}
        <div className="tutorial-step-badge">
          {currentStep + 1} / {steps.length}
        </div>
        <div className="tutorial-tooltip-title">{t(locale, step.titleKey)}</div>
        <div className="tutorial-tooltip-desc">{t(locale, step.descKey)}</div>

        {/* 액션별 힌트 */}
        {actionType === 'click' && (
          <div className="tutorial-action-hint">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <rect x="4.5" y="1" width="7" height="11" rx="3.5" stroke="currentColor" strokeWidth="1.2"/>
              <line x1="8" y1="3.5" x2="8" y2="6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            {t(locale, 'tutorial.clickHint')}
          </div>
        )}
        {actionType === 'drag' && (
          <div className="tutorial-action-hint tutorial-action-hint--drag">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M8 2v12M8 2L5 5M8 2l3 3M8 14l-3-3M8 14l3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {t(locale, 'tutorial.dragHint')}
          </div>
        )}
        {actionType === 'shortcut' && (
          <div className="tutorial-action-hint tutorial-action-hint--shortcut">
            <div className="tutorial-shortcut-keys">
              {step.shortcutKeys?.[0] === 'ArrowUp' ? (
                <><kbd>⌘</kbd><kbd>↑</kbd><span className="tutorial-shortcut-or">/</span><kbd>⌘</kbd><kbd>↓</kbd></>
              ) : (
                <><kbd>⌘</kbd><kbd>←</kbd><span className="tutorial-shortcut-or">/</span><kbd>⌘</kbd><kbd>→</kbd></>
              )}
            </div>
            {t(locale, 'tutorial.shortcutHint')}
          </div>
        )}

        <div className="tutorial-dots">
          {steps.map((_, i) => (
            <div key={i} className={`tutorial-dot${i === currentStep ? ' active' : ''}`} />
          ))}
        </div>
        <div className="tutorial-actions">
          <button className="tutorial-btn-skip" onClick={dismiss}>
            {t(locale, 'tutorial.skip')}
          </button>
          {canGoPrev && (
            <button className="tutorial-btn-prev" onClick={prev}>
              {t(locale, 'tutorial.prev')}
            </button>
          )}
          {actionType !== 'click' && (
            <button className="tutorial-btn-next" onClick={next}>
              {t(locale, isLast ? 'tutorial.done' : 'tutorial.next')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
