/**
 * TerminalView - xterm.js 기반 터미널 뷰
 *
 * 세션별 독립 xterm 인스턴스를 관리합니다.
 * useXtermTerminal 공통 훅을 사용하여 초기화, 테마 적용, 리사이즈를 처리합니다.
 */

import { useRef, useEffect } from 'react'
import { useXtermTerminal } from '../hooks/useXtermTerminal'
import { TERMINAL_FONT_SIZE } from '../../shared/constants'
import '@xterm/xterm/css/xterm.css'
import './TerminalView.css'

interface TerminalViewProps {
  sessionId: string
  isActive: boolean
  themeId: string
  contextPercent: number | null
  /** 분할 모드에서 이 터미널이 포커스되었는지 (undefined = 분할 없음) */
  isFocused?: boolean
  /** 분할 모드에서 포커스 요청 콜백 */
  onFocusTerminal?: () => void
}

export default function TerminalView({ sessionId, isActive, themeId, contextPercent, isFocused, onFocusTerminal }: TerminalViewProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)

  const { terminalRef } = useXtermTerminal({
    containerRef,
    themeId,
    fontSize: TERMINAL_FONT_SIZE,
    isActive,
    isFocused,
    onData: (data) => window.api.writeSession(sessionId, data),
    onResize: (cols, rows) => window.api.resizeSession(sessionId, cols, rows),
    deps: [sessionId]
  })

  // PTY 데이터 수신 (터미널 인스턴스에 직접 write)
  useEffect(() => {
    const cleanup = window.api.onSessionData((id: string, data: string) => {
      if (id === sessionId && terminalRef.current) {
        terminalRef.current.write(data)
      }
    })
    return cleanup
  }, [sessionId, terminalRef])

  return (
    <div
      className={`terminal-view-container ${isFocused === true ? 'terminal-view-container--focused' : ''}`}
      onClick={() => onFocusTerminal?.()}
    >
      <div ref={containerRef} className="terminal-view" />
      {contextPercent !== null && (
        <div className={`terminal-context-badge ${contextPercent >= 80 ? 'terminal-context-badge--warn' : ''}`}>
          ctx {contextPercent}%
        </div>
      )}
    </div>
  )
}
