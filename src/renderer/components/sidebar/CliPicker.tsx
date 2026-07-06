/**
 * CliPicker — 세션 생성 CLI 선택 버튼
 *
 * "+" 버튼 클릭 시 Claude/Codex 선택 드롭다운을 표시합니다.
 * 드롭다운은 portal로 document.body에 렌더링 — 사이드바의 stacking context
 * (.sidebar-header/.sidebar-list의 z-index:1)에 갇히면 뒤따르는 형제 요소가
 * 히트테스트를 가로채므로, 컨텍스트 밖으로 완전히 탈출시킵니다.
 * 튜토리얼 진행 중에는 메뉴 없이 즉시 Claude 세션을 생성합니다
 * (튜토리얼 스텝의 click 액션이 기존처럼 동작해야 하므로).
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Plus } from 'lucide-react'
import type { CliType } from '../../../shared/types'

interface CliPickerProps {
  /** 트리거 버튼 클래스 (튜토리얼 셀렉터 유지를 위해 기존 클래스를 그대로 전달) */
  className: string
  title: string
  iconSize: number
  /** 튜토리얼 진행 중 — 메뉴 없이 바로 Claude 생성 */
  tutorialActive?: boolean
  onPick: (cliType: CliType) => void
}

const CLI_OPTIONS: { type: CliType; label: string; dotClass: string }[] = [
  { type: 'claude', label: 'Claude', dotClass: 'cli-picker-dot--claude' },
  { type: 'codex', label: 'Codex', dotClass: 'cli-picker-dot--codex' }
]

export default function CliPicker({
  className,
  title,
  iconSize,
  tutorialActive,
  onPick
}: CliPickerProps): JSX.Element {
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const handleTrigger = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (tutorialActive) {
        onPick('claude')
        return
      }
      if (menuPos) {
        setMenuPos(null)
        return
      }
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      setMenuPos({ top: rect.bottom + 4, left: rect.right })
    },
    [tutorialActive, menuPos, onPick]
  )

  // 외부 클릭 시 닫기 — 드롭다운이 portal에 있으므로 두 ref 모두 검사
  useEffect(() => {
    if (!menuPos) return
    const handler = (ev: MouseEvent): void => {
      const target = ev.target as Node
      if (wrapRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setMenuPos(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuPos])

  return (
    <div className="cli-picker" ref={wrapRef}>
      <button className={className} onClick={handleTrigger} title={title}>
        <Plus size={iconSize} />
      </button>
      {menuPos &&
        createPortal(
          <div
            ref={menuRef}
            className="cli-picker-dropdown"
            style={{ top: menuPos.top, left: menuPos.left }}
          >
            {CLI_OPTIONS.map(({ type, label, dotClass }) => (
              <button
                key={type}
                className="cli-picker-item"
                onClick={(e) => {
                  e.stopPropagation()
                  setMenuPos(null)
                  onPick(type)
                }}
              >
                <span className={`cli-picker-dot ${dotClass}`} />
                {label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  )
}
