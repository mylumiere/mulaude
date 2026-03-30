/**
 * HintBadge — 세션별 워크플로우 힌트 배지
 *
 * SessionRow 오른쪽에 작은 아이콘으로 표시되며,
 * 클릭 시 primaryAction을 실행합니다.
 */

import { memo, useCallback } from 'react'
import type { WorkflowHint, WorkflowActionType } from '../../../shared/types'
import type { Locale } from '../../i18n'
import { t } from '../../i18n'

/** 힌트 타입별 아이콘 */
const HINT_ICONS: Record<string, string> = {
  verificationFailed: '✗',
  repeatedErrors: '⚠',
  reviewSuggestion: '◉',
  contextHigh: '⧗',
  noPlan: '📋'
}

/** 힌트 타입별 CSS 클래스 수식어 */
const HINT_CLASSES: Record<string, string> = {
  verificationFailed: 'hint-badge--error',
  repeatedErrors: 'hint-badge--error',
  reviewSuggestion: 'hint-badge--info',
  contextHigh: 'hint-badge--warn',
  noPlan: 'hint-badge--info'
}

interface HintBadgeProps {
  hint: WorkflowHint
  locale: Locale
  onAction: (hint: WorkflowHint, action: WorkflowActionType) => void
}

export default memo(function HintBadge({ hint, locale, onAction }: HintBadgeProps): JSX.Element {
  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onAction(hint, hint.primaryAction)
  }, [hint, onAction])

  const handleDismiss = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onAction(hint, 'dismiss')
  }, [hint, onAction])

  const icon = HINT_ICONS[hint.type] || '!'
  const className = `hint-badge ${HINT_CLASSES[hint.type] || ''}`
  const actionLabel = t(locale, `assist.action.${hint.primaryAction}`)

  // i18n 변수 구성
  const vars: Record<string, string | number> = {}
  if (hint.payload?.filesModified) vars.count = hint.payload.filesModified.length
  if (hint.payload?.contextPercent != null) vars.pct = hint.payload.contextPercent
  if (hint.payload?.errorCount != null) vars.count = hint.payload.errorCount

  return (
    <span
      className={className}
      title={`${t(locale, hint.messageKey, vars)} — ${actionLabel}`}
      onClick={handleClick}
      onContextMenu={handleDismiss}
    >
      {icon}
    </span>
  )
})
