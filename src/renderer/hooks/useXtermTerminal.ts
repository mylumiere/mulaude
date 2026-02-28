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
  /** 초기화 후 추가 핏 지연 (ms 배열, 예: [50, 300]) */
  fitDelays?: number[]
  /** 초기 내용 (마운트 직후 write) */
  initialContent?: string
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
  fitDelays,
  initialContent,
  deps = []
}: UseXtermTerminalParams): UseXtermTerminalReturn {
  const xtermRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  // 터미널 초기화
  useEffect(() => {
    if (!containerRef.current) return

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

    // 키 이벤트 핸들러: 앱 단축키는 window로 전달, 나머지는 xterm 처리
    terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (event.type !== 'keydown') return true

      // Cmd+* 조합은 앱 단축키 → xterm이 처리하지 않음
      if (event.metaKey) return false

      // Shift+Enter → CSI u 시퀀스 (Claude Code 멀티라인 입력)
      if (event.key === 'Enter' && event.shiftKey) {
        onData('\x1b[13;2u')
        return false
      }

      return true
    })

    if (initialContent) {
      terminal.write(initialContent)
    }

    // 초기 fit + 리사이즈 통보
    const fitAndResize = (): void => {
      fitAddon.fit()
      onResize(terminal.cols, terminal.rows)
    }

    if (fitDelays && fitDelays.length > 0) {
      requestAnimationFrame(() => {
        for (const delay of fitDelays) {
          setTimeout(fitAndResize, delay)
        }
        if (isFocused !== false) terminal.focus()
      })
    } else {
      requestAnimationFrame(() => {
        fitAndResize()
        if (isFocused !== false) terminal.focus()
      })
    }

    xtermRef.current = terminal
    fitAddonRef.current = fitAddon

    const onDataDisposable = terminal.onData(onData)

    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimer) return
      resizeTimer = setTimeout(() => {
        resizeTimer = null
        if (fitAddonRef.current && xtermRef.current) {
          fitAddonRef.current.fit()
          onResize(xtermRef.current.cols, xtermRef.current.rows)
        }
      }, 100)
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
      requestAnimationFrame(() => {
        fitAddonRef.current?.fit()
        if (isFocused !== false) {
          xtermRef.current?.focus()
        }
        if (xtermRef.current) {
          onResize(xtermRef.current.cols, xtermRef.current.rows)
        }
      })
    }
  }, [isActive, isFocused]) // eslint-disable-line react-hooks/exhaustive-deps

  // 포커스 변경 시 (그리드 패인 이동 / 분할 모드 전환)
  useEffect(() => {
    if (isFocused && isActive !== false && xtermRef.current) {
      // 키보드 이벤트 처리 중 동기 focus()가 씹히므로 다음 틱으로 지연
      const t = setTimeout(() => {
        xtermRef.current?.focus()
      }, 0)
      requestAnimationFrame(() => {
        fitAddonRef.current?.fit()
      })
      return () => clearTimeout(t)
    }
  }, [isFocused, isActive])

  return { terminalRef: xtermRef, fitAddonRef }
}
