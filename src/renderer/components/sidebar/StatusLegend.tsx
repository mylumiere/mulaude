/**
 * StatusLegend - 상태 범례
 *
 * 세션 상태 인디케이터의 색상 범례를 표시합니다.
 * 부모 Sidebar.css의 스타일을 사용합니다.
 */

import { memo } from 'react'
import type { Locale } from '../../i18n'
import { t } from '../../i18n'

interface StatusLegendProps {
  locale: Locale
}

export default memo(function StatusLegend({ locale }: StatusLegendProps): JSX.Element {
  return (
    <div className="sidebar-legend">
      <div className="sidebar-legend-row">
        <div className="session-row-indicator indicator--thinking" />
        <span>{t(locale, 'legend.thinking')}</span>
      </div>
      <div className="sidebar-legend-row">
        <div className="session-row-indicator indicator--tool" />
        <span>{t(locale, 'legend.tool')}</span>
      </div>
      <div className="sidebar-legend-row">
        <div className="session-row-indicator indicator--agent" />
        <span>{t(locale, 'legend.agent')}</span>
      </div>
      <div className="sidebar-legend-row">
        <div className="session-row-indicator indicator--completed" />
        <span>{t(locale, 'legend.completed')}</span>
      </div>
      <div className="sidebar-legend-row">
        <div className="session-row-indicator indicator--idle" />
        <span>{t(locale, 'legend.idle')}</span>
      </div>
      <div className="sidebar-legend-row">
        <div className="session-row-indicator indicator--permission" />
        <span>{t(locale, 'legend.permission')}</span>
      </div>
      <div className="sidebar-legend-row">
        <div className="session-row-indicator indicator--error" />
        <span>{t(locale, 'legend.error')}</span>
      </div>
      <div className="sidebar-legend-row">
        <span className="session-row-shell-icon legend-shell-icon">{'>'}_</span>
        <span>{t(locale, 'legend.shell')}</span>
      </div>
      <div className="sidebar-legend-row">
        <div className="session-row-indicator indicator--exited" />
        <span>{t(locale, 'legend.exited')}</span>
      </div>
    </div>
  )
})
