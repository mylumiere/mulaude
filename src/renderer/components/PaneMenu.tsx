/**
 * PaneMenu — 패인 헤더 드롭다운 메뉴
 *
 * 햄버거 아이콘 클릭 시 사이드 패널(Plan/Preview/Diff/Viewer) 토글 메뉴를 표시합니다.
 * 활성 패널에는 체크마크가 표시됩니다.
 */

import { useState, useRef, useEffect, useCallback, memo } from 'react'
import { Menu, FileText, Eye, GitCompareArrows, BookOpen, Check } from 'lucide-react'
import { t, type Locale } from '../i18n'
import './PaneMenu.css'

interface PaneMenuProps {
  locale: Locale
  hasPlan: boolean
  hasPreview: boolean
  hasDiff: boolean
  hasViewer: boolean
  onTogglePlan: () => void
  onTogglePreview: () => void
  onToggleDiff: () => void
  onToggleViewer: () => void
}

const items = [
  { key: 'plan', labelKey: 'cmdPalette.togglePlan', Icon: FileText, shortcut: null },
  { key: 'preview', labelKey: 'cmdPalette.togglePreview', Icon: Eye, shortcut: '⌘⇧P' },
  { key: 'diff', labelKey: 'cmdPalette.toggleDiff', Icon: GitCompareArrows, shortcut: '⌘⇧D' },
  { key: 'viewer', labelKey: 'cmdPalette.toggleViewer', Icon: BookOpen, shortcut: '⌘⇧V' },
] as const

function PaneMenu({
  locale,
  hasPlan,
  hasPreview,
  hasDiff,
  hasViewer,
  onTogglePlan,
  onTogglePreview,
  onToggleDiff,
  onToggleViewer,
}: PaneMenuProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const activeMap: Record<string, boolean> = { plan: hasPlan, preview: hasPreview, diff: hasDiff, viewer: hasViewer }
  const toggleMap: Record<string, () => void> = { plan: onTogglePlan, preview: onTogglePreview, diff: onToggleDiff, viewer: onToggleViewer }

  // 외부 클릭 시 닫기
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleClick = useCallback((key: string) => {
    toggleMap[key]?.()
    setOpen(false)
  }, [toggleMap])

  return (
    <div className="pane-menu" ref={menuRef}>
      <button
        className={`pane-menu-trigger${open ? ' pane-menu-trigger--open' : ''}`}
        onClick={(e) => { e.stopPropagation(); setOpen(prev => !prev) }}
        title={t(locale, 'cmdPalette.title')}
      >
        <Menu size={10} />
      </button>
      {open && (
        <div className="pane-menu-dropdown">
          {items.map(({ key, labelKey, Icon, shortcut }) => (
            <button
              key={key}
              className={`pane-menu-item${activeMap[key] ? ' pane-menu-item--active' : ''}`}
              onClick={(e) => { e.stopPropagation(); handleClick(key) }}
            >
              <span className="pane-menu-item-check">
                {activeMap[key] && <Check size={10} />}
              </span>
              <Icon size={12} className="pane-menu-item-icon" />
              <span className="pane-menu-item-label">{t(locale, labelKey)}</span>
              {shortcut && <span className="pane-menu-item-shortcut">{shortcut}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default memo(PaneMenu)
