/**
 * CommandPalette — ⌘K 커맨드 팔레트 오버레이
 *
 * IDE 스타일 커맨드 팔레트: 검색 입력 → fuzzy filter → 키보드 네비게이션 → Enter 실행
 * 카테고리별 그룹 헤더, 각 액션에 아이콘 + 라벨 + 단축키 힌트
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import type { Locale } from '../i18n'
import { t } from '../i18n'
import './CommandPalette.css'

export interface CommandAction {
  id: string
  labelKey: string
  icon: React.ReactNode
  shortcut?: string
  category: 'panel' | 'session' | 'view' | 'settings'
  execute: () => void
  /** true이면 현재 포커스된 세션이 있을 때만 표시 */
  requiresSession?: boolean
}

interface CommandPaletteProps {
  locale: Locale
  actions: CommandAction[]
  onClose: () => void
}

/** 카테고리 표시 순서 */
const CATEGORY_ORDER: CommandAction['category'][] = ['panel', 'session', 'view', 'settings']

/** 카테고리별 i18n 키 */
const CATEGORY_KEYS: Record<CommandAction['category'], string> = {
  panel: 'cmdPalette.catPanel',
  session: 'cmdPalette.catSession',
  view: 'cmdPalette.catView',
  settings: 'cmdPalette.catSettings'
}

/** 간단한 fuzzy 매칭 (연속 문자 매칭) */
function fuzzyMatch(query: string, text: string): boolean {
  if (!query) return true
  const lower = text.toLowerCase()
  const q = query.toLowerCase()
  let qi = 0
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) qi++
  }
  return qi === q.length
}

export default function CommandPalette({ locale, actions, onClose }: CommandPaletteProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // 오토포커스
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // 필터링된 액션 (카테고리별 정렬 유지)
  const filtered = useMemo(() => {
    return actions.filter(a => {
      const label = t(locale, a.labelKey)
      return fuzzyMatch(query, label) || fuzzyMatch(query, a.id)
    })
  }, [actions, query, locale])

  // 카테고리별 그룹핑
  const groups = useMemo(() => {
    const map = new Map<CommandAction['category'], CommandAction[]>()
    for (const a of filtered) {
      const list = map.get(a.category) || []
      list.push(a)
      map.set(a.category, list)
    }
    // 순서 유지
    return CATEGORY_ORDER
      .filter(c => map.has(c))
      .map(c => ({ category: c, items: map.get(c)! }))
  }, [filtered])

  // 전체 flat 리스트 (네비게이션용)
  const flatItems = useMemo(() => filtered, [filtered])

  // 선택 인덱스 범위 보정
  useEffect(() => {
    if (selectedIndex >= flatItems.length) {
      setSelectedIndex(Math.max(0, flatItems.length - 1))
    }
  }, [flatItems.length, selectedIndex])

  // 선택된 항목 스크롤
  useEffect(() => {
    const el = listRef.current?.querySelector('.cmd-item--selected')
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(prev => Math.min(prev + 1, flatItems.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(prev => Math.max(prev - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const item = flatItems[selectedIndex]
      if (item) {
        item.execute()
        onClose()
      }
      return
    }
  }, [onClose, flatItems, selectedIndex])

  const handleItemClick = useCallback((action: CommandAction) => {
    action.execute()
    onClose()
  }, [onClose])

  // 오버레이 클릭 시 닫기
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }, [onClose])

  // 카테고리 헤더를 고려한 flat 인덱스 추적
  let flatIdx = 0

  return (
    <div className="cmd-overlay" onClick={handleOverlayClick}>
      <div className="cmd-palette" onKeyDown={handleKeyDown}>
        <div className="cmd-input-wrapper">
          <input
            ref={inputRef}
            className="cmd-input"
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIndex(0) }}
            placeholder={t(locale, 'cmdPalette.placeholder')}
            autoFocus
          />
        </div>
        <div className="cmd-list" ref={listRef}>
          {groups.length === 0 && (
            <div className="cmd-empty">{t(locale, 'cmdPalette.noResults')}</div>
          )}
          {groups.map(group => {
            const startIdx = flatIdx
            return (
              <div key={group.category} className="cmd-group">
                <div className="cmd-group-header">{t(locale, CATEGORY_KEYS[group.category])}</div>
                {group.items.map((action) => {
                  const idx = startIdx + group.items.indexOf(action)
                  flatIdx = idx + 1
                  const isSelected = idx === selectedIndex
                  return (
                    <button
                      key={action.id}
                      className={`cmd-item${isSelected ? ' cmd-item--selected' : ''}`}
                      onClick={() => handleItemClick(action)}
                      onMouseEnter={() => setSelectedIndex(idx)}
                    >
                      <span className="cmd-item-icon">{action.icon}</span>
                      <span className="cmd-item-label">{t(locale, action.labelKey)}</span>
                      {action.shortcut && <span className="cmd-item-shortcut">{action.shortcut}</span>}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
