/**
 * SuggestedActions — HarnessPanel 내 추천 액션 섹션
 *
 * 세션의 모든 워크플로우 힌트를 우선순위순으로 표시하며,
 * 각 힌트에 primaryAction + secondaryAction(또는 dismiss) 버튼을 제공합니다.
 */

import { memo, useCallback } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { WorkflowHint, WorkflowActionType } from '../../shared/types'
import type { Locale } from '../i18n'
import { t } from '../i18n'
import './SuggestedActions.css'

interface SuggestedActionsProps {
  hints: WorkflowHint[]
  locale: Locale
  onAction: (hint: WorkflowHint, action: WorkflowActionType) => void
  expanded: boolean
  onToggle: () => void
}

export default memo(function SuggestedActions({
  hints,
  locale,
  onAction,
  expanded,
  onToggle
}: SuggestedActionsProps): JSX.Element | null {
  if (hints.length === 0) return null

  return (
    <div className="harness-section">
      <button className="harness-section-header" onClick={onToggle}>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{t(locale, 'assist.title')}</span>
        <span className="harness-section-count harness-section-count--warn">{hints.length}</span>
      </button>
      {expanded && (
        <div className="suggested-actions">
          {hints.map(hint => (
            <SuggestedActionCard
              key={hint.id}
              hint={hint}
              locale={locale}
              onAction={onAction}
            />
          ))}
        </div>
      )}
    </div>
  )
})

const SuggestedActionCard = memo(function SuggestedActionCard({
  hint,
  locale,
  onAction
}: {
  hint: WorkflowHint
  locale: Locale
  onAction: (hint: WorkflowHint, action: WorkflowActionType) => void
}): JSX.Element {
  const handlePrimary = useCallback(() => {
    onAction(hint, hint.primaryAction)
  }, [hint, onAction])

  const handleSecondary = useCallback(() => {
    onAction(hint, hint.secondaryAction ?? 'dismiss')
  }, [hint, onAction])

  const handleDismiss = useCallback(() => {
    onAction(hint, 'dismiss')
  }, [hint, onAction])

  // i18n 메시지 렌더링 (변수 치환)
  const vars: Record<string, string | number> = {}
  if (hint.payload?.filesModified) vars.count = hint.payload.filesModified.length
  if (hint.payload?.contextPercent != null) vars.pct = hint.payload.contextPercent
  if (hint.payload?.errorCount != null) vars.count = hint.payload.errorCount
  const message = t(locale, hint.messageKey, vars)

  const priorityClass = hint.priority === 1 ? 'suggested-action-card--p1'
    : hint.priority === 2 ? 'suggested-action-card--p2'
    : 'suggested-action-card--p3'

  return (
    <div className={`suggested-action-card ${priorityClass}`}>
      <div className="suggested-action-message">{message}</div>
      <div className="suggested-action-buttons">
        <button className="suggested-action-btn suggested-action-btn--primary" onClick={handlePrimary}>
          {t(locale, `assist.action.${hint.primaryAction}`)}
        </button>
        {hint.secondaryAction && hint.secondaryAction !== 'dismiss' && (
          <button className="suggested-action-btn" onClick={handleSecondary}>
            {t(locale, `assist.action.${hint.secondaryAction}`)}
          </button>
        )}
        <button className="suggested-action-btn suggested-action-btn--dismiss" onClick={handleDismiss}>
          {t(locale, 'assist.action.dismiss')}
        </button>
      </div>
    </div>
  )
})
