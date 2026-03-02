/**
 * TerminalView - xterm.js 기반 터미널 뷰
 *
 * 세션별 독립 xterm 인스턴스를 관리합니다.
 * useXtermTerminal 공통 훅을 사용하여 초기화, 테마 적용, 리사이즈를 처리합니다.
 *
 * 마운트 시 tmux 화면 캡처로 이전 출력을 복원합니다.
 */

import { useRef, useEffect, useState } from 'react'
import { useXtermTerminal } from '../hooks/useXtermTerminal'
import { TERMINAL_FONT_SIZE, TERMINAL_SCROLLBACK } from '../../shared/constants'
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
  const [initialContent, setInitialContent] = useState<string | undefined>(undefined)
  const [ready, setReady] = useState(false)

  // 마운트 시 tmux 화면 캡처로 이전 출력 복원
  useEffect(() => {
    let cancelled = false
    window.api.captureScreen(sessionId).then((screen) => {
      if (cancelled) return
      if (screen) setInitialContent(screen)
      setReady(true)
    }).catch(() => {
      if (!cancelled) setReady(true)
    })
    return () => { cancelled = true }
  }, [sessionId])

  const { terminalRef, recapturingRef } = useXtermTerminal({
    containerRef,
    themeId,
    fontSize: TERMINAL_FONT_SIZE,
    scrollback: TERMINAL_SCROLLBACK,
    isActive,
    isFocused,
    onData: (data) => window.api.writeSession(sessionId, data),
    onResize: (cols, rows) => window.api.resizeSession(sessionId, cols, rows),
    onRecapture: () => window.api.captureScreen(sessionId),
    initialContent,
    disabled: !ready,
    deps: [sessionId, ready]
  })

  // PTY 데이터 수신 (세션별 리스너 — O(1) 디스패치)
  // 재캡처 중(recapturingRef)일 때는 PTY 데이터 쓰기를 억제.
  // tmux 리사이즈 시 보내는 화면 재그리기 시퀀스와 재캡처 내용이 중복되어
  // 화면 깨짐(잘림/중복 렌더링)을 유발하기 때문.
  useEffect(() => {
    return window.api.onSessionDataById(sessionId, (data: string) => {
      if (terminalRef.current && !recapturingRef.current) {
        terminalRef.current.write(data)
      }
    })
  }, [sessionId, terminalRef, recapturingRef])

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
