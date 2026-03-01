/**
 * useXtermTerminal - xterm.js 터미널 공통 훅
 *
 * TerminalView와 AgentTerminal에서 공유하는 xterm 초기화, 테마 적용,
 * 리사이즈 감지 로직을 통합합니다.
 */

import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { getThemeById } from '../themes'
import {
  TERMINAL_FONT_FAMILY,
  TERMINAL_LINE_HEIGHT
} from '../../shared/constants'

interface UseXtermTerminalParams {
  /** DOM 컨테이너 ref */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** 테마 ID */
  themeId: string
  /** 폰트 사이즈 */
  fontSize: number
  /** 스크롤백 줄 수 (undefined = xterm 기본값) */
  scrollback?: number
  /** 터미널이 활성 상태인지 (탭 전환 시) */
  isActive?: boolean
  /** 분할 모드에서 포커스 여부 */
  isFocused?: boolean
  /** 키 입력 핸들러 */
  onData: (data: string) => void
  /** 리사이즈 핸들러 (cols, rows) */
  onResize: (cols: number, rows: number) => void
  /** 초기 내용 (마운트 직후 write) */
  initialContent?: string
  /** 터미널 비활성화 (pending 상태 등에서 xterm 생성 방지) */
  disabled?: boolean
  /** 의존성 키 배열 (터미널 재생성 트리거) */
  deps?: unknown[]
}

interface UseXtermTerminalReturn {
  terminalRef: React.MutableRefObject<Terminal | null>
  fitAddonRef: React.MutableRefObject<FitAddon | null>
}

export function useXtermTerminal({
  containerRef,
  themeId,
  fontSize,
  scrollback,
  isActive,
  isFocused,
  onData,
  onResize,
  initialContent,
  disabled,
  deps = []
}: UseXtermTerminalParams): UseXtermTerminalReturn {
  const xtermRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  // 터미널 초기화
  useEffect(() => {
    if (!containerRef.current || disabled) return

    const theme = getThemeById(themeId)

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize,
      fontFamily: TERMINAL_FONT_FAMILY,
      lineHeight: TERMINAL_LINE_HEIGHT,
      theme: theme.xtermTheme,
      allowProposedApi: true,
      macOptionIsMeta: true,
      ...(scrollback !== undefined ? { scrollback } : {})
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(containerRef.current)

    // 마우스 트래킹 차단 — Claude Code가 보내는 mouse tracking enable 시퀀스를 무시
    terminal.parser.registerCsiHandler({ prefix: '?', final: 'h' }, (params) => {
      const mouseParams = [1000, 1002, 1003, 1004, 1006, 1015, 1016]
      for (let i = 0; i < params.length; i++) {
        if (mouseParams.includes(params[i] as number)) return true
      }
      return false
    })

    // PTY 응답 시퀀스 소비 — 리사이즈 시 DA1/CPR 응답이 raw 텍스트로 출력되지 않도록
    terminal.parser.registerCsiHandler({ prefix: '?', final: 'c' }, () => true) // DA1
    terminal.parser.registerCsiHandler({ final: 'R' }, () => true)              // CPR

    // 키 이벤트 핸들러: 앱 단축키는 window로 전달, 나머지는 xterm 처리
    terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (event.type !== 'keydown') return true
      if (event.metaKey) return false
      if (event.key === 'Enter' && event.shiftKey) {
        onData('\x1b[13;2u')
        return false
      }
      return true
    })

    if (initialContent) {
      terminal.write(initialContent)
    }

    xtermRef.current = terminal
    fitAddonRef.current = fitAddon

    // 초기 fit — 컨테이너 크기가 잡힌 후 1회 실행
    requestAnimationFrame(() => {
      if (!containerRef.current || containerRef.current.clientHeight === 0) return
      fitAddon.fit()
      onResize(terminal.cols, terminal.rows)
      if (isFocused !== false) terminal.focus()
    })

    const onDataDisposable = terminal.onData(onData)

    // ResizeObserver — 컨테이너 크기 변경 시 fit (유일한 리사이즈 소스)
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimer) return
      resizeTimer = setTimeout(() => {
        resizeTimer = null
        if (fitAddonRef.current && xtermRef.current) {
          fitAddonRef.current.fit()
          onResize(xtermRef.current.cols, xtermRef.current.rows)
          xtermRef.current.refresh(0, xtermRef.current.rows - 1)
        }
      }, 150)
    })

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current)
    }

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer)
      onDataDisposable.dispose()
      resizeObserver.disconnect()
      terminal.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
    }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps

  // 테마 변경 시 실시간 반영
  useEffect(() => {
    if (xtermRef.current) {
      const theme = getThemeById(themeId)
      xtermRef.current.options.theme = theme.xtermTheme
    }
  }, [themeId])

  // 활성 탭 전환 시 fit + focus
  useEffect(() => {
    if (isActive && fitAddonRef.current && xtermRef.current) {
      fitAddonRef.current.fit()
      onResize(xtermRef.current.cols, xtermRef.current.rows)
      if (isFocused !== false) xtermRef.current.focus()
    }
  }, [isActive]) // eslint-disable-line react-hooks/exhaustive-deps

  // 포커스 변경 시 (그리드 패인 이동 / 분할 모드 전환)
  useEffect(() => {
    if (isFocused && isActive !== false && xtermRef.current) {
      xtermRef.current.focus()
    }
  }, [isFocused, isActive])

  // 앱 윈도우 포커스 복귀 시 터미널 자동 포커스
  useEffect(() => {
    const handleWindowFocus = (): void => {
      if (xtermRef.current && isFocused !== false && isActive !== false) {
        xtermRef.current.focus()
      }
    }
    window.addEventListener('focus', handleWindowFocus)
    return () => window.removeEventListener('focus', handleWindowFocus)
  }, [isFocused, isActive])

  return { terminalRef: xtermRef, fitAddonRef }
}
