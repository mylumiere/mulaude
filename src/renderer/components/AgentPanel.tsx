/**
 * AgentPanel - 에이전트 터미널 리스트 컨테이너
 *
 * team config에서 확정된 에이전트 목록(agents)을 기준으로 렌더링합니다.
 * pane 데이터(childPaneMap)는 초기 콘텐츠 제공용 보조 데이터입니다.
 */

import { useRef, useState, useEffect, useCallback } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import type { AgentInfo } from '../../shared/types'
import AgentTerminal from './AgentTerminal'
import './AgentPanel.css'

interface PaneEntry {
  title: string
  initialContent: string
}

interface AgentPanelProps {
  sessionId: string
  themeId: string
  focusedPaneIndex: number | null
  onFocusPane: (paneIndex: number) => void
  /** App.tsx에서 관리하는 pane 맵 (paneIndex → { title, initialContent }) */
  panes: Map<number, PaneEntry>
  /** team config에서 확정된 에이전트 목록 */
  agents?: AgentInfo[]
}

export default function AgentPanel({
  sessionId,
  themeId,
  focusedPaneIndex,
  onFocusPane,
  panes,
  agents
}: AgentPanelProps): JSX.Element {
  // 에이전트 기준 렌더링 (paneIndex 확정된 에이전트만, exited 포함)
  const visibleAgents = (agents || []).filter(
    (a) => a.paneIndex !== undefined && (a.status === 'pending' || a.status === 'running' || a.status === 'completed' || a.status === 'exited')
  )

  const isScrollable = visibleAgents.length > 3
  const listRef = useRef<HTMLDivElement>(null)
  const [scrollInfo, setScrollInfo] = useState({ canUp: false, canDown: false })

  const updateScrollInfo = useCallback(() => {
    const el = listRef.current
    if (!el) return
    setScrollInfo({
      canUp: el.scrollTop > 4,
      canDown: el.scrollTop + el.clientHeight < el.scrollHeight - 4
    })
  }, [])

  useEffect(() => {
    if (!isScrollable) return
    const el = listRef.current
    if (!el) return
    updateScrollInfo()
    el.addEventListener('scroll', updateScrollInfo, { passive: true })
    const ro = new ResizeObserver(updateScrollInfo)
    ro.observe(el)
    return () => { el.removeEventListener('scroll', updateScrollInfo); ro.disconnect() }
  }, [isScrollable, updateScrollInfo, visibleAgents.length])

  // 포커스 변경 시 해당 pane이 보이도록 자동 스크롤
  useEffect(() => {
    if (!isScrollable || focusedPaneIndex === null || !listRef.current) return
    const idx = visibleAgents.findIndex(a => a.paneIndex === focusedPaneIndex)
    if (idx < 0) return
    const child = listRef.current.children[idx] as HTMLElement | undefined
    child?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focusedPaneIndex, isScrollable, visibleAgents])

  const scrollBy = useCallback((delta: number) => {
    listRef.current?.scrollBy({ top: delta, behavior: 'smooth' })
  }, [])

  return (
    <div className="agent-panel">
      <div className="agent-panel-header">
        <span className="agent-panel-title">Agents ({visibleAgents.length})</span>
        {isScrollable && (
          <div className="agent-panel-scroll-nav">
            <button
              className={`agent-panel-scroll-btn ${scrollInfo.canUp ? '' : 'agent-panel-scroll-btn--disabled'}`}
              onClick={() => scrollBy(-200)}
              title="Scroll up"
            ><ChevronUp size={12} /></button>
            <button
              className={`agent-panel-scroll-btn ${scrollInfo.canDown ? '' : 'agent-panel-scroll-btn--disabled'}`}
              onClick={() => scrollBy(200)}
              title="Scroll down"
            ><ChevronDown size={12} /></button>
          </div>
        )}
      </div>
      {isScrollable && scrollInfo.canUp && <div className="agent-panel-fade agent-panel-fade--top" />}
      <div
        ref={listRef}
        className={`agent-panel-list ${isScrollable ? 'agent-panel-list--scroll' : ''}`}
      >
        {visibleAgents.map((agent) => {
          const paneIndex = agent.paneIndex!
          const paneEntry = panes.get(paneIndex)
          const displayTitle = `${agent.name}${agent.type ? ` (${agent.type})` : ''}`

          return (
            <AgentTerminal
              key={`${sessionId}-pane-${paneIndex}`}
              sessionId={sessionId}
              paneIndex={paneIndex}
              title={displayTitle}
              initialContent={paneEntry?.initialContent || ''}
              themeId={themeId}
              isFocused={focusedPaneIndex === paneIndex}
              isPending={agent.status === 'pending'}
              isExited={agent.status === 'exited'}
              onFocus={() => onFocusPane(paneIndex)}
            />
          )
        })}
      </div>
      {isScrollable && scrollInfo.canDown && <div className="agent-panel-fade agent-panel-fade--bottom" />}
    </div>
  )
}
