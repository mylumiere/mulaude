/**
 * TutorialOverlay - 인터랙티브 튜토리얼 UI
 *
 * SVG mask로 타겟 요소만 투명하게 뚫는 스포트라이트 + 툴팁 박스를 렌더링합니다.
 * 타겟이 없는 스텝은 화면 중앙에 카드로 표시합니다.
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
  if (!tutorial.active) return null

  const { steps, currentStep, targetRect, next, prev, skip } = tutorial
  const step = steps[currentStep]
  const isFirst = currentStep === 0
  const isLast = currentStep === steps.length - 1
  const hasTarget = targetRect !== null

  // 스포트라이트 영역 (패딩 포함)
  const sx = hasTarget ? targetRect.x - PADDING : 0
  const sy = hasTarget ? targetRect.y - PADDING : 0
  const sw = hasTarget ? targetRect.width + PADDING * 2 : 0
  const sh = hasTarget ? targetRect.height + PADDING * 2 : 0

  // 툴팁 위치 계산
  let tooltipStyle: React.CSSProperties = {}
  if (hasTarget) {
    if (step.position === 'right') {
      tooltipStyle = {
        left: targetRect.x + targetRect.width + TOOLTIP_GAP + PADDING,
        top: targetRect.y + targetRect.height / 2 - 30,
      }
    } else {
      tooltipStyle = {
        left: targetRect.x - PADDING - TOOLTIP_GAP - 300,
        top: targetRect.y + targetRect.height / 2 - 30,
      }
    }
  }

  return (
    <div className="tutorial-overlay" key={currentStep}>
      {/* SVG 스포트라이트 */}
      <svg className="tutorial-spotlight" onClick={skip}>
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
        {hasTarget && (
          <div className={`tutorial-tooltip-arrow arrow-${step.position === 'right' ? 'left' : 'right'}`} />
        )}
        <div className="tutorial-tooltip-title">{t(locale, step.titleKey)}</div>
        <div className="tutorial-tooltip-desc">{t(locale, step.descKey)}</div>
        <div className="tutorial-dots">
          {steps.map((_, i) => (
            <div key={i} className={`tutorial-dot${i === currentStep ? ' active' : ''}`} />
          ))}
        </div>
        <div className="tutorial-actions">
          <button className="tutorial-btn-skip" onClick={skip}>
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
