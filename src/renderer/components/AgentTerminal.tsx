/**
 * AgentTerminal - 에이전트 전용 xterm.js 터미널
 *
 * useXtermTerminal 공통 훅을 사용하여 자식 tmux pane의 출력을 실시간 표시합니다.
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
  onFocus: () => void
}

export default memo(function AgentTerminal({
  sessionId,
  paneIndex,
  title,
  initialContent,
  themeId,
  isFocused,
  onFocus
}: AgentTerminalProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)

  const { terminalRef } = useXtermTerminal({
    containerRef,
    themeId,
    fontSize: AGENT_TERMINAL_FONT_SIZE,
    scrollback: AGENT_SCROLLBACK,
    isFocused,
    onData: (data) => window.api.writeChildPane(sessionId, paneIndex, data),
    onResize: (cols, rows) => window.api.resizeChildPane(sessionId, paneIndex, cols, rows),
    fitDelays: [AGENT_FIT_DELAY_SHORT, AGENT_FIT_DELAY_LONG],
    initialContent,
    deps: [sessionId, paneIndex]
  })

  // pane 출력 수신
  useEffect(() => {
    const cleanup = window.api.onChildPaneData(
      (sid: string, idx: number, data: string) => {
        if (sid === sessionId && idx === paneIndex && terminalRef.current) {
          terminalRef.current.write(data)
        }
      }
    )
    return cleanup
  }, [sessionId, paneIndex, terminalRef])

  const displayTitle = title || `Agent #${paneIndex}`

  return (
    <div
      className={`agent-terminal-container ${isFocused ? 'agent-terminal-container--focused' : ''}`}
      onClick={onFocus}
    >
      <div className="agent-terminal-header">
        <span className="agent-terminal-name">{displayTitle}</span>
        <span className="agent-terminal-badge">pane {paneIndex}</span>
      </div>
      <div ref={containerRef} className="agent-terminal-body" />
    </div>
  )
})
