/**
 * UsageGauge - Claude 사용량 게이지
 *
 * 5시간/7일 사용량 바와 리셋까지 남은 시간을 표시합니다.
 * 부모 Sidebar.css의 스타일을 사용합니다.
 */

import { memo } from 'react'
import type { UsageData } from '../../../shared/types'

interface UsageGaugeProps {
  usageData: UsageData
}

function formatTimeLeft(resetAt: string): string {
  const diff = new Date(resetAt).getTime() - Date.now()
  if (diff <= 0) return '0m'
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export default memo(function UsageGauge({ usageData }: UsageGaugeProps): JSX.Element {
  return (
    <div className="sidebar-usage">
      <div className="sidebar-usage-header">
        <span className="sidebar-usage-plan">{usageData.planName}</span>
      </div>
      <div className="sidebar-usage-row">
        <span className="sidebar-usage-label">5h</span>
        <div className="sidebar-usage-bar">
          <div
            className={`sidebar-usage-fill ${usageData.fiveHour >= 80 ? 'sidebar-usage-fill--warn' : ''}`}
            style={{ width: `${Math.min(usageData.fiveHour, 100)}%` }}
          />
        </div>
        <span className="sidebar-usage-pct">{usageData.fiveHour}%</span>
        <span className="sidebar-usage-reset">{formatTimeLeft(usageData.fiveHourResetAt)}</span>
      </div>
      <div className="sidebar-usage-row">
        <span className="sidebar-usage-label">7d</span>
        <div className="sidebar-usage-bar">
          <div
            className={`sidebar-usage-fill ${usageData.sevenDay >= 80 ? 'sidebar-usage-fill--warn' : ''}`}
            style={{ width: `${Math.min(usageData.sevenDay, 100)}%` }}
          />
        </div>
        <span className="sidebar-usage-pct">{usageData.sevenDay}%</span>
        <span className="sidebar-usage-reset">{formatTimeLeft(usageData.sevenDayResetAt)}</span>
      </div>
    </div>
  )
})
