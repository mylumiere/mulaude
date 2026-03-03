/**
 * UsageGauge - Claude 사용량 게이지
 *
 * 5시간/7일 사용량 바와 리셋까지 남은 시간을 표시합니다.
 * 데이터 신선도(lastUpdated)를 표시하여 캐시 갱신 여부를 알 수 있습니다.
 * 데이터가 없으면 경고 아이콘과 안내 메시지를 표시합니다.
 */

import { memo, useState, useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { UsageData } from '../../../shared/types'
import type { Locale } from '../../i18n'
import { t } from '../../i18n'

interface UsageGaugeProps {
  usageData: UsageData | null
  locale: Locale
}

/** 리셋까지 남은 시간을 포맷 */
function formatTimeLeft(resetAt: string): string {
  const diff = new Date(resetAt).getTime() - Date.now()
  if (diff <= 0) return '0m'
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

/** lastUpdated로부터 경과 시간을 포맷 */
function formatAge(lastUpdated: number): string {
  const diff = Date.now() - lastUpdated
  if (diff < 60000) return '<1m'
  const m = Math.floor(diff / 60000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h`
}

/** 데이터가 너무 오래됨 (5분 초과) */
const STALE_THRESHOLD = 5 * 60 * 1000

export default memo(function UsageGauge({ usageData, locale }: UsageGaugeProps): JSX.Element {
  // 경과 시간 표시를 위한 리렌더 (30초마다)
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!usageData) return
    const timer = setInterval(() => setTick(t => t + 1), 30000)
    return () => clearInterval(timer)
  }, [usageData])

  if (!usageData) {
    return (
      <div className="sidebar-usage sidebar-usage--warn">
        <div className="sidebar-usage-header">
          <AlertTriangle size={12} />
          <span className="sidebar-usage-plan">Rate Limit</span>
        </div>
        <div className="sidebar-usage-row">
          <span className="sidebar-usage-label">5h</span>
          <div className="sidebar-usage-bar">
            <div className="sidebar-usage-fill sidebar-usage-fill--empty" />
          </div>
          <span className="sidebar-usage-pct">—</span>
        </div>
        <div className="sidebar-usage-row">
          <span className="sidebar-usage-label">7d</span>
          <div className="sidebar-usage-bar">
            <div className="sidebar-usage-fill sidebar-usage-fill--empty" />
          </div>
          <span className="sidebar-usage-pct">—</span>
        </div>
        <div className="sidebar-usage-hint">{t(locale, 'settings.rateLimitWarn')}</div>
      </div>
    )
  }

  const hasTimestamp = typeof usageData.lastUpdated === 'number' && !isNaN(usageData.lastUpdated)
  const isStale = hasTimestamp && (Date.now() - usageData.lastUpdated!) > STALE_THRESHOLD
  const sourceLabel = usageData.source === 'hud' ? 'HUD' : usageData.source === 'keychain' ? 'API' : null

  return (
    <div className="sidebar-usage">
      <div className="sidebar-usage-header">
        <span className="sidebar-usage-plan">{usageData.planName}</span>
        {hasTimestamp && (
          <span className={`sidebar-usage-age ${isStale ? 'sidebar-usage-age--stale' : ''}`}>
            {sourceLabel && `${sourceLabel} · `}{formatAge(usageData.lastUpdated!)}
            {isStale && ' ⚠'}
          </span>
        )}
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
