/**
 * TerminalView - xterm.js 기반 터미널 뷰
 *
 * 세션별 독립 xterm 인스턴스를 관리합니다.
 * useXtermTerminal 공통 훅을 사용하여 초기화, 테마 적용, 리사이즈를 처리합니다.
 *
 * 마운트 시 tmux 화면 캡처로 이전 출력을 복원합니다.
 *
 * PTY 데이터 버퍼링:
 * recapture 중(reset+write)에는 PTY 데이터를 pendingData에 쌓아두고,
 * 캡처 write 완료 후 일괄 재생하여 데이터 인터리빙을 방지합니다.
 */

import { useRef, useEffect, useState } from 'react'
import { useXtermTerminal } from '../hooks/useXtermTerminal'
import { TERMINAL_FONT_SIZE, TERMINAL_SCROLLBACK } from '../../shared/constants'
import { t, type Locale } from '../i18n'
import '@xterm/xterm/css/xterm.css'
import './TerminalView.css'

export type PermissionMode = 'default' | 'acceptEdits' | 'plan'

interface TerminalViewProps {
  sessionId: string
  isActive: boolean
  themeId: string
  contextPercent: number | null
  /** 분할 모드에서 이 터미널이 포커스되었는지 (undefined = 분할 없음) */
  isFocused?: boolean
  /** 분할 모드에서 포커스 요청 콜백 */
  onFocusTerminal?: () => void
  /** 현재 퍼미션 모드 */
  permissionMode?: PermissionMode
  /** 퍼미션 모드 순환 콜백 */
  onCycleMode?: () => void
  locale?: Locale
}

export default function TerminalView({ sessionId, isActive, themeId, contextPercent, isFocused, onFocusTerminal, permissionMode, onCycleMode, locale = 'en' }: TerminalViewProps): JSX.Element {
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

  const { terminalRef, recapturingRef, pendingDataRef } = useXtermTerminal({
    containerRef,
    themeId,
    fontSize: TERMINAL_FONT_SIZE,
    scrollback: TERMINAL_SCROLLBACK,
    isActive,
    isFocused,
    onData: (data) => window.api.writeSession(sessionId, data),
    onSendKeys: (data) => window.api.sendKeysToPane(sessionId, data),
    onResize: (cols, rows) => window.api.resizeSession(sessionId, cols, rows),
    onRecapture: (cols, rows) => window.api.captureScreen(sessionId, cols, rows),
    onScroll: (direction, lines) => window.api.scrollSession(sessionId, direction, lines),
    onShiftTab: onCycleMode,
    initialContent,
    disabled: !ready,
    deps: [sessionId, ready]
  })

  // PTY 데이터 수신 (세션별 리스너 — O(1) 디스패치)
  // recapture 중에는 PTY 데이터를 pendingDataRef에 버퍼링하여
  // reset()+write(captured) 사이에 데이터가 끼어드는 것을 방지.
  // 캡처 완료 후 버퍼링된 데이터를 순서대로 재생합니다.
  useEffect(() => {
    return window.api.onSessionDataById(sessionId, (data: string) => {
      if (!terminalRef.current) return
      if (recapturingRef.current) {
        pendingDataRef.current.push(data)
      } else {
        terminalRef.current.write(data)
      }
    })
  }, [sessionId, terminalRef, recapturingRef, pendingDataRef])

  const handleModeBadgeClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    onCycleMode?.()
    // Shift+Tab 키스트로크를 PTY에 전송
    window.api.writeSession(sessionId, '\x1b[Z')
  }

  return (
    <div
      className={`terminal-view-container ${isFocused === true ? 'terminal-view-container--focused' : ''}`}
      onClick={() => onFocusTerminal?.()}
    >
      <div ref={containerRef} className="terminal-view" />
      {permissionMode && permissionMode !== 'default' && (
        <div
          className={`terminal-mode-badge terminal-mode-badge--${permissionMode}`}
          onClick={handleModeBadgeClick}
          title={t(locale, 'mode.cycleTip')}
        >
          {t(locale, `mode.${permissionMode}`)}
        </div>
      )}
      {contextPercent !== null && (
        <div className={`terminal-context-badge ${contextPercent >= 80 ? 'terminal-context-badge--warn' : ''}`}>
          ctx {contextPercent}%
        </div>
      )}
    </div>
  )
}
