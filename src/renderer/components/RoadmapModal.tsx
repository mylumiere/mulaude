/**
 * RoadmapModal - 개발 로드맵 다이얼로그
 *
 * 사이드바 하단 아이콘 클릭 시 마일스톤별 기능 목록을 표시합니다.
 */

import { useEffect } from 'react'
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

export default function RoadmapModal({ onClose }: RoadmapModalProps): JSX.Element {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose])

  return (
    <div className="roadmap-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="roadmap-modal">
        <div className="roadmap-header">
          <h3>
            <span className="roadmap-header-icon">✦</span>
            Roadmap
          </h3>
          <button className="roadmap-close-btn" onClick={onClose}>×</button>
        </div>

        <div className="roadmap-body">
          {ROADMAP.map((milestone) => {
            const doneCount = milestone.features.filter(f => f.status === 'done').length
            const total = milestone.features.length
            const percent = total > 0 ? Math.round((doneCount / total) * 100) : 0

            return (
              <div key={milestone.version} className="roadmap-milestone">
                <div className="roadmap-milestone-header">
                  <span className="roadmap-version">{milestone.version}</span>
                  <span className="roadmap-milestone-title">{milestone.title}</span>
                  <span className="roadmap-progress">{doneCount}/{total}</span>
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
