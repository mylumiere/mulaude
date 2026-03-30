/**
 * HarnessPanel — Harness Dashboard 패널
 *
 * 세션별 에이전트 활동을 시각화하는 대시보드 패널입니다.
 * PlanPanel/PreviewPanel과 동일한 패턴으로 TerminalGrid 내에서 사이드 패널로 렌더링됩니다.
 *
 * 4개 섹션:
 *   1. Activity Timeline — 최근 이벤트 타임라인
 *   2. Tool Heatmap — 도구별 사용 횟수 히트맵
 *   3. File Activity — 수정/읽기된 파일 목록
 *   4. Agent Summary — 에이전트 상태 요약
 */

import { memo, useState, useCallback } from 'react'
import { X, Minimize2, ChevronDown, ChevronRight } from 'lucide-react'
import type { HarnessMetrics, HarnessTimelineEntry, AgentInfo, VerificationResult, GuardRailViolation, WorkflowHint, WorkflowActionType } from '../../shared/types'
import type { Locale } from '../i18n'
import { t } from '../i18n'
import SuggestedActions from './SuggestedActions'
import './HarnessPanel.css'

interface HarnessPanelProps {
  sessionId: string
  metrics: HarnessMetrics | null
  locale: Locale
  onClose: () => void
  /** Team 에이전트 (Agent Summary용) */
  teamAgents?: AgentInfo[]
  /** Hook 에이전트 (Agent Summary용) */
  hookAgents?: AgentInfo[]
  /** Phase 4: 검증 결과 */
  verificationResults?: VerificationResult[]
  /** Phase 4: 수동 검증 실행 */
  onRunVerification?: (type: string) => void
  /** Phase 5: 위반 목록 */
  violations?: GuardRailViolation[]
  /** Phase 6: 워크플로우 힌트 (전체) */
  workflowHints?: WorkflowHint[]
  /** Phase 6: 워크플로우 액션 실행 콜백 */
  onWorkflowAction?: (hint: WorkflowHint, action: WorkflowActionType) => void
}

/** 이벤트 타입별 아이콘/라벨 매핑 */
const EVENT_LABELS: Record<string, string> = {
  tool_use: '▶',
  tool_done: '✓',
  agent_spawn: '⚡',
  turn_start: '→',
  turn_end: '⏹',
  error: '✗'
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  return formatTime(ts)
}

/** 파일 경로에서 파일명만 추출 */
function basename(path: string): string {
  return path.split('/').pop() || path
}

/** 파일별 사용 횟수 집계 */
function countFiles(files: string[]): Array<{ path: string; count: number }> {
  const map = new Map<string, number>()
  for (const f of files) {
    map.set(f, (map.get(f) || 0) + 1)
  }
  return Array.from(map.entries())
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count)
}

export default memo(function HarnessPanel({
  sessionId: _sessionId,
  metrics,
  locale,
  onClose,
  teamAgents,
  hookAgents,
  verificationResults,
  onRunVerification,
  violations,
  workflowHints,
  onWorkflowAction
}: HarnessPanelProps): JSX.Element {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['suggested', 'timeline', 'heatmap', 'files', 'agents'])
  )

  const toggleSection = useCallback((section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }, [])

  const totalTools = metrics ? Object.values(metrics.toolCounts).reduce((a, b) => a + b, 0) : 0
  const maxToolCount = metrics ? Math.max(...Object.values(metrics.toolCounts), 1) : 1

  return (
    <div className="harness-panel">
      <div className="harness-panel-header">
        <span className="harness-panel-title">{t(locale, 'harness.title')}</span>
        <div className="harness-panel-actions">
          <button className="harness-panel-btn" onClick={onClose} title="Close">
            <X size={12} />
          </button>
        </div>
      </div>

      <div className="harness-panel-body">
        {workflowHints && workflowHints.length > 0 && onWorkflowAction && (
          <SuggestedActions
            hints={workflowHints}
            locale={locale}
            onAction={onWorkflowAction}
            expanded={expandedSections.has('suggested')}
            onToggle={() => toggleSection('suggested')}
          />
        )}
        {!metrics || totalTools === 0 ? (
          <div className="harness-panel-empty">
            {t(locale, 'harness.noActivity')}
          </div>
        ) : (
          <>
            {/* ── Activity Timeline ── */}
            <div className="harness-section">
              <button className="harness-section-header" onClick={() => toggleSection('timeline')}>
                {expandedSections.has('timeline') ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span>{t(locale, 'harness.timeline')}</span>
                <span className="harness-section-count">{metrics.timeline.length}</span>
              </button>
              {expandedSections.has('timeline') && (
                <div className="harness-timeline">
                  {[...metrics.timeline].reverse().slice(0, 30).map((entry, i) => (
                    <TimelineRow key={i} entry={entry} />
                  ))}
                </div>
              )}
            </div>

            {/* ── Tool Heatmap ── */}
            <div className="harness-section">
              <button className="harness-section-header" onClick={() => toggleSection('heatmap')}>
                {expandedSections.has('heatmap') ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span>{t(locale, 'harness.toolHeatmap')}</span>
              </button>
              {expandedSections.has('heatmap') && (
                <div className="harness-heatmap">
                  {Object.entries(metrics.toolCounts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([name, count]) => (
                      <div key={name} className="harness-heatmap-row">
                        <span className="harness-heatmap-name">{name}</span>
                        <div className="harness-heatmap-bar-container">
                          <div
                            className="harness-heatmap-bar"
                            style={{ width: `${(count / maxToolCount) * 100}%` }}
                          />
                        </div>
                        <span className="harness-heatmap-count">{count}</span>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* ── File Activity ── */}
            <div className="harness-section">
              <button className="harness-section-header" onClick={() => toggleSection('files')}>
                {expandedSections.has('files') ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span>{t(locale, 'harness.fileActivity')}</span>
              </button>
              {expandedSections.has('files') && (
                <div className="harness-files">
                  {metrics.filesModified.length > 0 && (
                    <div className="harness-file-group">
                      <span className="harness-file-group-label">
                        {t(locale, 'harness.modified')} ({metrics.filesModified.length})
                      </span>
                      {metrics.filesModified.slice(0, 15).map(f => (
                        <div key={f} className="harness-file-row" title={f}>
                          <span className="harness-file-icon">✎</span>
                          <span className="harness-file-name">{basename(f)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {metrics.filesRead.length > 0 && (
                    <div className="harness-file-group">
                      <span className="harness-file-group-label">
                        {t(locale, 'harness.read')} ({metrics.filesRead.length})
                      </span>
                      {metrics.filesRead.slice(0, 15).map(f => (
                        <div key={f} className="harness-file-row" title={f}>
                          <span className="harness-file-icon">📄</span>
                          <span className="harness-file-name">{basename(f)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Agent Summary ── */}
            <div className="harness-section">
              <button className="harness-section-header" onClick={() => toggleSection('agents')}>
                {expandedSections.has('agents') ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span>{t(locale, 'harness.agentSummary')}</span>
              </button>
              {expandedSections.has('agents') && (
                <div className="harness-agents">
                  <div className="harness-agents-stats">
                    <span>{t(locale, 'harness.turns')}: {metrics.turnCount}</span>
                    <span>{t(locale, 'harness.agents')}: {metrics.agentSpawnCount}</span>
                  </div>
                  {teamAgents && teamAgents.length > 0 && (
                    <div className="harness-agent-list">
                      <span className="harness-file-group-label">Team ({teamAgents.length})</span>
                      {teamAgents.map(a => (
                        <div key={a.name} className="harness-agent-row">
                          <span className={`harness-agent-dot harness-agent-dot--${a.status}`} />
                          <span className="harness-agent-name" style={a.color ? { color: a.color } : undefined}>
                            {a.name}
                          </span>
                          <span className="harness-agent-status">{a.status}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {hookAgents && hookAgents.length > 0 && (
                    <div className="harness-agent-list">
                      <span className="harness-file-group-label">Task ({hookAgents.length})</span>
                      {hookAgents.map((a, i) => (
                        <div key={i} className="harness-agent-row">
                          <span className={`harness-agent-dot harness-agent-dot--${a.status}`} />
                          <span className="harness-agent-name">{a.name}</span>
                          <span className="harness-agent-status">{a.status}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Phase 4: Verification ── */}
            {verificationResults && verificationResults.length > 0 && (
              <div className="harness-section">
                <button className="harness-section-header" onClick={() => toggleSection('verification')}>
                  {expandedSections.has('verification') ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <span>{t(locale, 'harness.verification')}</span>
                </button>
                {expandedSections.has('verification') && (
                  <div className="harness-verification">
                    {verificationResults.map((r, i) => (
                      <div key={i} className={`harness-verification-row harness-verification-row--${r.status}`}>
                        <span className="harness-verification-type">{r.type}</span>
                        <span className={`harness-verification-badge harness-verification-badge--${r.status}`}>
                          {t(locale, `harness.${r.status}`)}
                        </span>
                        {r.durationMs > 0 && (
                          <span className="harness-verification-time">{(r.durationMs / 1000).toFixed(1)}s</span>
                        )}
                        {onRunVerification && (
                          <button
                            className="harness-verification-run"
                            onClick={() => onRunVerification(r.type)}
                          >
                            ▶ {t(locale, 'harness.run')}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Phase 5: Guard Rails Violations ── */}
            {violations && violations.length > 0 && (
              <div className="harness-section">
                <button className="harness-section-header" onClick={() => toggleSection('violations')}>
                  {expandedSections.has('violations') ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <span>{t(locale, 'harness.violations')}</span>
                  <span className="harness-section-count harness-section-count--warn">{violations.length}</span>
                </button>
                {expandedSections.has('violations') && (
                  <div className="harness-violations">
                    {violations.map((v, i) => (
                      <div key={i} className={`harness-violation-row harness-violation-row--${v.action}`}>
                        <span className="harness-violation-time">{formatTime(v.timestamp)}</span>
                        <span className="harness-violation-tool">{v.toolName}</span>
                        <span className="harness-violation-detail">{v.detail}</span>
                        <span className={`harness-violation-badge harness-violation-badge--${v.action}`}>
                          {v.action}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
})

/** 타임라인 단일 행 */
const TimelineRow = memo(function TimelineRow({ entry }: { entry: HarnessTimelineEntry }): JSX.Element {
  return (
    <div className={`harness-timeline-row harness-timeline-row--${entry.eventType}`}>
      <span className="harness-timeline-time">{formatTime(entry.timestamp)}</span>
      <span className="harness-timeline-icon">{EVENT_LABELS[entry.eventType] || '·'}</span>
      <span className="harness-timeline-tool">{entry.toolName || ''}</span>
      {entry.detail && (
        <span className="harness-timeline-detail" title={entry.detail}>
          {entry.detail.length > 40 ? basename(entry.detail) : entry.detail}
        </span>
      )}
    </div>
  )
})
