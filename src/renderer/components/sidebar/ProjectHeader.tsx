/**
 * ProjectHeader - 프로젝트 그룹 헤더
 *
 * 프로젝트 이름, 접기/펼치기, 세션 추가, 프로젝트 삭제 버튼을 표시합니다.
 * 부모 Sidebar.css의 스타일을 사용합니다.
 */

import { memo } from 'react'
import { ChevronRight, X } from 'lucide-react'
import type { CliType } from '../../../shared/types'
import type { Locale } from '../../i18n'
import { t } from '../../i18n'
import CliPicker from './CliPicker'

interface ProjectHeaderProps {
  name: string
  workingDir: string
  sessionCount: number
  isCollapsed: boolean
  shortcut: string
  locale: Locale
  onToggleCollapse: () => void
  onAddSession: (cliType: CliType) => void
  /** 튜토리얼 진행 중 (CLI 선택 메뉴 대신 즉시 Claude 생성) */
  tutorialActive?: boolean
  onRemoveProject: () => void
}

export default memo(function ProjectHeader({
  name,
  workingDir,
  sessionCount,
  isCollapsed,
  shortcut,
  locale,
  onToggleCollapse,
  onAddSession,
  tutorialActive,
  onRemoveProject
}: ProjectHeaderProps): JSX.Element {
  return (
    <div className="project-header">
      <button className="project-toggle" onClick={onToggleCollapse}>
        <span className={`project-arrow ${isCollapsed ? '' : 'project-arrow--open'}`}>
          <ChevronRight size={12} />
        </span>
      </button>
      <div
        className="project-name"
        onClick={onToggleCollapse}
        title={`${workingDir}${shortcut ? `  (${shortcut})` : ''}`}
      >
        {name}
      </div>
      {shortcut && <span className="project-shortcut">{shortcut}</span>}
      <span className="project-count">{sessionCount}</span>
      <CliPicker
        className="project-action-btn project-add-btn"
        title={t(locale, 'project.addSession')}
        iconSize={12}
        tutorialActive={tutorialActive}
        onPick={onAddSession}
      />
      <button
        className="project-action-btn project-action-btn--danger"
        onClick={onRemoveProject}
        title={t(locale, 'project.remove')}
      >
        <X size={12} />
      </button>
    </div>
  )
})
