/**
 * AgentTerminal - 에이전트 전용 xterm.js 터미널
 *
 * useXtermTerminal 공통 훅을 사용하여 자식 tmux pane의 출력을 실시간 표시합니다.
 * pending 상태에서는 xterm 대신 placeholder를 표시합니다.
 */

import { memo, useRef, useEffect } from 'react'
import { useXtermTerminal } from '../hooks/useXtermTerminal'
import {
  AGENT_TERMINAL_FONT_SIZE,
  AGENT_SCROLLBACK,
  AGENT_FIT_DELAY_SHORT,
  AGENT_FIT_DELAY_LONG
} from '../../shared/constants'
import '@xterm/xterm/css/xterm.css'
import './AgentTerminal.css'

interface AgentTerminalProps {
  sessionId: string
  paneIndex: number
  title: string
  initialContent: string
  themeId: string
  isFocused: boolean
  /** 에이전트가 pane 대기 중 (placeholder 표시) */
  isPending?: boolean
  /** 에이전트가 종료된 상태 (dimmed + overlay 표시) */
  isExited?: boolean
  onFocus: () => void
}

export default memo(function AgentTerminal({
  sessionId,
  paneIndex,
  title,
  initialContent,
  themeId,
  isFocused,
  isPending,
  isExited,
  onFocus
}: AgentTerminalProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)

  const { terminalRef } = useXtermTerminal({
    containerRef,
    themeId,
    fontSize: AGENT_TERMINAL_FONT_SIZE,
    scrollback: AGENT_SCROLLBACK,
    isFocused: isFocused && !isPending,
    onData: (data) => window.api.writeChildPane(sessionId, paneIndex, data),
    onResize: (cols, rows) => window.api.resizeChildPane(sessionId, paneIndex, cols, rows),
    fitDelays: [AGENT_FIT_DELAY_SHORT, AGENT_FIT_DELAY_LONG],
    initialContent,
    deps: [sessionId, paneIndex],
    disabled: isPending
  })

  // pane 출력 수신 (O(1) 키 기반 디스패치)
  useEffect(() => {
    if (isPending) return
    return window.api.onChildPaneDataById(sessionId, paneIndex, (data: string) => {
      if (terminalRef.current) {
        terminalRef.current.write(data)
      }
    })
  }, [sessionId, paneIndex, terminalRef, isPending])

  const displayTitle = title || `Agent #${paneIndex}`

  const containerClass = [
    'agent-terminal-container',
    isFocused ? 'agent-terminal-container--focused' : '',
    isPending ? 'agent-terminal-container--pending' : '',
    isExited ? 'agent-terminal-container--exited' : ''
  ].filter(Boolean).join(' ')

  return (
    <div className={containerClass} onClick={onFocus}>
      <div className="agent-terminal-header">
        <span className="agent-terminal-name">{displayTitle}</span>
        {isPending && <span className="agent-terminal-badge agent-terminal-badge--pending">starting</span>}
        {isExited && <span className="agent-terminal-badge agent-terminal-badge--exited">exited</span>}
        {!isPending && <span className="agent-terminal-badge">pane {paneIndex}</span>}
      </div>
      <div className="agent-terminal-body-wrapper">
        {isPending ? (
          <div className="agent-terminal-pending">
            <div className="agent-terminal-pending-spinner" />
            <span className="agent-terminal-pending-label">Starting {title || 'agent'}…</span>
          </div>
        ) : (
          <>
            <div ref={containerRef} className="agent-terminal-body" />
            {isExited && (
              <div className="agent-terminal-exited-overlay">
                <span className="agent-terminal-exited-label">{title} exited</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
})
