/**
 * RoadmapModal - 개발 로드맵 다이얼로그
 *
 * 수평 타임라인 + 버전별 기능 목록을 표시합니다.
 * 타임라인의 버전 점을 클릭하면 해당 마일스톤으로 스크롤됩니다.
 */

import { useEffect, useRef, useState } from 'react'
import { Route, X } from 'lucide-react'
import { ROADMAP, type FeatureStatus } from '../roadmap'
import './RoadmapModal.css'

interface RoadmapModalProps {
  onClose: () => void
}

const STATUS_ICON: Record<FeatureStatus, string> = {
  planned: '○',
  'in-progress': '◐',
  done: '●'
}

/** 마일스톤의 전체 진행률 계산 */
function getMilestoneProgress(features: { status: FeatureStatus }[]): number {
  if (features.length === 0) return 0
  const done = features.filter(f => f.status === 'done').length
  return done / features.length
}

/** 글로벌 진행률 (전체 완료 마일스톤 기준) */
function getGlobalProgress(): { completed: number; total: number; percent: number } {
  const total = ROADMAP.length
  let completed = 0
  for (const m of ROADMAP) {
    const p = getMilestoneProgress(m.features)
    if (p >= 1) completed++
    else break // 순차 진행이므로 첫 미완료에서 중단
  }
  // 현재 진행 중인 마일스톤의 부분 진행률 반영
  const currentIdx = completed < total ? completed : total - 1
  const currentProgress = getMilestoneProgress(ROADMAP[currentIdx].features)
  const percent = ((completed + (completed < total ? currentProgress * 0.8 : 0)) / total) * 100
  return { completed, total, percent }
}

export default function RoadmapModal({ onClose }: RoadmapModalProps): JSX.Element {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [activeVersion, setActiveVersion] = useState(ROADMAP[0].version)
  const global = getGlobalProgress()

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose])

  const scrollToMilestone = (version: string): void => {
    setActiveVersion(version)
    const el = bodyRef.current?.querySelector(`[data-version="${version}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // 스크롤 시 활성 버전 감지
  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const handleScroll = (): void => {
      // 스크롤 바닥이면 마지막 마일스톤 활성화
      if (Math.abs(body.scrollHeight - body.scrollTop - body.clientHeight) < 4) {
        const children = body.querySelectorAll('[data-version]')
        const last = children[children.length - 1]
        if (last) { setActiveVersion(last.getAttribute('data-version') || ''); return }
      }
      const children = body.querySelectorAll('[data-version]')
      for (const child of children) {
        const rect = child.getBoundingClientRect()
        const bodyRect = body.getBoundingClientRect()
        if (rect.top >= bodyRect.top - 20) {
          setActiveVersion(child.getAttribute('data-version') || '')
          break
        }
      }
    }
    body.addEventListener('scroll', handleScroll, { passive: true })
    return () => body.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <div className="roadmap-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="roadmap-modal">
        <div className="roadmap-header">
          <h3>
            <Route className="roadmap-header-icon" size={18} />
            Roadmap
          </h3>
          <button className="roadmap-close-btn" onClick={onClose}><X size={14} /></button>
        </div>

        {/* ── 수평 타임라인 ── */}
        <div className="roadmap-timeline">
          <div className="roadmap-timeline-track">
            <div
              className="roadmap-timeline-fill"
              style={{ width: `${global.percent}%` }}
            />
          </div>
          <div className="roadmap-timeline-dots">
            {ROADMAP.map((m, i) => {
              const p = getMilestoneProgress(m.features)
              const isDone = p >= 1
              const isCurrent = !isDone && i === global.completed
              const dotClass = [
                'roadmap-timeline-dot',
                isDone ? 'roadmap-timeline-dot--done' : '',
                isCurrent ? 'roadmap-timeline-dot--current' : '',
                activeVersion === m.version ? 'roadmap-timeline-dot--active' : ''
              ].filter(Boolean).join(' ')

              return (
                <button
                  key={m.version}
                  className={dotClass}
                  onClick={() => scrollToMilestone(m.version)}
                  title={`${m.version} — ${m.title}`}
                >
                  <div className="roadmap-timeline-dot-inner" />
                  <span className="roadmap-timeline-dot-label">{m.version}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── 마일스톤 목록 ── */}
        <div className="roadmap-body" ref={bodyRef}>
          {ROADMAP.map((milestone) => {
            const doneCount = milestone.features.filter(f => f.status === 'done').length
            const total = milestone.features.length
            const percent = total > 0 ? Math.round((doneCount / total) * 100) : 0
            const isAllDone = doneCount === total

            return (
              <div
                key={milestone.version}
                className={`roadmap-milestone${isAllDone ? ' roadmap-milestone--done' : ''}`}
                data-version={milestone.version}
              >
                <div className="roadmap-milestone-header">
                  <span className="roadmap-version">{milestone.version}</span>
                  <span className="roadmap-milestone-title">{milestone.title}</span>
                  <span className="roadmap-progress">
                    {isAllDone ? '✓' : `${doneCount}/${total}`}
                  </span>
                </div>

                <div className="roadmap-progress-bar">
                  <div
                    className="roadmap-progress-fill"
                    style={{ width: `${percent}%` }}
                  />
                </div>

                <div className="roadmap-features">
                  {milestone.features.map((feature) => (
                    <div
                      key={feature.title}
                      className={`roadmap-feature ${feature.status === 'done' ? 'roadmap-feature--done' : ''}`}
                    >
                      <span className={`roadmap-feature-status roadmap-feature-status--${feature.status}`}>
                        {STATUS_ICON[feature.status]}
                      </span>
                      <div className="roadmap-feature-content">
                        <div className="roadmap-feature-title">{feature.title}</div>
                        <div className="roadmap-feature-desc">{feature.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        <div className="roadmap-footer">
          <span className="roadmap-footer-text">MULAUDE DEVELOPMENT ROADMAP</span>
        </div>
      </div>
    </div>
  )
}
