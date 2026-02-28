/**
 * TutorialOverlay - 인터랙티브 튜토리얼 UI
 *
 * welcome phase: 중앙 웰컴 다이얼로그
 * steps phase: SVG 스포트라이트 + 툴팁 (외부 클릭 차단)
 */

import type { TutorialState } from '../hooks/useTutorial'
import { type Locale, t } from '../i18n'
import './TutorialOverlay.css'

interface TutorialOverlayProps {
  tutorial: TutorialState
  locale: Locale
}

const PADDING = 8
const TOOLTIP_GAP = 16

export default function TutorialOverlay({ tutorial, locale }: TutorialOverlayProps): JSX.Element | null {
  const { phase } = tutorial

  if (phase === 'idle') return null

  // ── 웰컴 다이얼로그 ──
  if (phase === 'welcome') {
    return (
      <div className="tutorial-overlay tutorial-overlay-blocking">
        <div className="tutorial-backdrop" />
        <div className="tutorial-welcome">
          <div className="tutorial-welcome-icon">👋</div>
          <div className="tutorial-welcome-title">{t(locale, 'tutorial.welcome.title')}</div>
          <div className="tutorial-welcome-desc">{t(locale, 'tutorial.welcome.desc')}</div>
          <div className="tutorial-welcome-actions">
            <button className="tutorial-btn-skip" onClick={tutorial.dismiss}>
              {t(locale, 'tutorial.later')}
            </button>
            <button className="tutorial-btn-next" onClick={tutorial.start}>
              {t(locale, 'tutorial.start')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── 스텝 진행 ──
  const { steps, currentStep, targetRect, next, prev, dismiss } = tutorial
  const step = steps[currentStep]
  const isFirst = currentStep === 0
  const isLast = currentStep === steps.length - 1
  const hasTarget = targetRect !== null

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
      // 타겟 영역 내부 중앙
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
    <div className="tutorial-overlay tutorial-overlay-blocking" key={currentStep}>
      {/* SVG 스포트라이트 — 외부 클릭 차단 (skip 안 함) */}
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

      {/* 툴팁 */}
      <div
        className={`tutorial-tooltip${hasTarget ? '' : ' center'}`}
        style={hasTarget ? tooltipStyle : undefined}
      >
        {arrowDir && (
          <div className={`tutorial-tooltip-arrow arrow-${arrowDir}`} />
        )}
        <div className="tutorial-tooltip-title">{t(locale, step.titleKey)}</div>
        <div className="tutorial-tooltip-desc">{t(locale, step.descKey)}</div>
        <div className="tutorial-dots">
          {steps.map((_, i) => (
            <div key={i} className={`tutorial-dot${i === currentStep ? ' active' : ''}`} />
          ))}
        </div>
        <div className="tutorial-actions">
          <button className="tutorial-btn-skip" onClick={dismiss}>
            {t(locale, 'tutorial.skip')}
          </button>
          {!isFirst && (
            <button className="tutorial-btn-prev" onClick={prev}>
              {t(locale, 'tutorial.prev')}
            </button>
          )}
          <button className="tutorial-btn-next" onClick={next}>
            {t(locale, isLast ? 'tutorial.done' : 'tutorial.next')}
          </button>
        </div>
      </div>
    </div>
  )
}
