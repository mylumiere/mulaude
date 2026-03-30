/**
 * ContextBudget - Context 사용량 시각화 컴포넌트
 *
 * 진행률 바 + 토큰 수 + 분해 요약을 표시합니다.
 * SessionRow 내부에서 렌더링되며, 기존 ctx % 자리를 대체합니다.
 */

import { memo, useState, useCallback } from 'react'
import type { ContextBudget as ContextBudgetType } from '../../../shared/types'
import type { Locale } from '../../i18n'
import { t } from '../../i18n'

interface ContextBudgetProps {
  budget: ContextBudgetType
  locale: Locale
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`
  return String(tokens)
}

export default memo(function ContextBudget({ budget, locale }: ContextBudgetProps): JSX.Element {
  const [showPopover, setShowPopover] = useState(false)

  const handleMouseEnter = useCallback(() => setShowPopover(true), [])
  const handleMouseLeave = useCallback(() => setShowPopover(false), [])

  const isWarn = budget.usedPct >= 80

  return (
    <span
      className="context-budget"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <span className="context-budget-bar">
        <span
          className={`context-budget-fill${isWarn ? ' context-budget-fill--warn' : ''}`}
          style={{ width: `${Math.min(budget.usedPct, 100)}%` }}
        />
      </span>
      <span className={`context-budget-label${isWarn ? ' context-budget-label--warn' : ''}`}>
        {budget.usedPct}%
        {budget.totalTokens > 0 && (
          <span className="context-budget-tokens">
            {formatTokens(budget.usedTokens)}/{formatTokens(budget.totalTokens)}
          </span>
        )}
      </span>
      {showPopover && budget.totalTokens > 0 && (
        <div className="context-budget-popover">
          <div className="context-budget-popover-row">
            <span>{t(locale, 'harness.budget')}</span>
            <span>{budget.usedPct}%</span>
          </div>
          <div className="context-budget-popover-row">
            <span>Tokens</span>
            <span>{formatTokens(budget.usedTokens)} / {formatTokens(budget.totalTokens)}</span>
          </div>
          {(budget.breakdown.filesRead > 0 || budget.breakdown.turnsConsumed > 0 || budget.breakdown.agentsActive > 0) && (
            <div className="context-budget-popover-breakdown">
              {budget.breakdown.filesRead > 0 && (
                <span>{t(locale, 'harness.budgetFiles')}: {budget.breakdown.filesRead}</span>
              )}
              {budget.breakdown.turnsConsumed > 0 && (
                <span>{t(locale, 'harness.budgetTurns')}: {budget.breakdown.turnsConsumed}</span>
              )}
              {budget.breakdown.agentsActive > 0 && (
                <span>{t(locale, 'harness.budgetAgents')}: {budget.breakdown.agentsActive}</span>
              )}
            </div>
          )}
        </div>
      )}
    </span>
  )
})
