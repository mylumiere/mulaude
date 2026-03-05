/**
 * useXtermTerminal - xterm.js 터미널 공통 훅
 *
 * TerminalView와 AgentTerminal에서 공유하는 xterm 초기화, 테마 적용,
 * 리사이즈 감지 로직을 통합합니다.
 *
 * 스크롤백 동기화:
 * Claude Code TUI는 커서 포지셔닝으로 뷰포트를 제자리 갱신하므로,
 * xterm.js 스크롤백에 새 내용이 자연스럽게 쌓이지 않습니다.
 * tmux는 자체 스크롤백을 관리하므로, cols 변경 시 tmux에서 전체 캡처하여
 * xterm 버퍼를 교체(recapture)합니다.
 *
 * recapture 중 PTY 데이터 처리:
 * reset() + write(captured) 사이에 PTY 데이터가 끼어들면 화면이 깨지므로,
 * recapture 중 PTY 데이터를 버퍼에 쌓아두고 완료 후 일괄 재생합니다.
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
  /** cols 변경 시 스크롤백 재캡처 콜백 (tmux reflow된 내용 복원)
   *  cols/rows를 전달하면 main에서 tmux resize를 await한 후 캡처 (atomic) */
  onRecapture?: (cols: number, rows: number) => Promise<string | null>
  /** 마우스 휠 스크롤 콜백 (tmux copy-mode 스크롤용)
   *  제공 시 휠 이벤트를 가로채서 이 콜백 호출, 미제공 시 xterm 기본 처리 */
  onScroll?: (direction: 'up' | 'down', lines: number) => void
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
  /** 재캡처 진행 중 여부 — true일 때 PTY 데이터를 pendingData에 버퍼링해야 함 */
  recapturingRef: React.MutableRefObject<boolean>
  /** 재캡처 중 버퍼링된 PTY 데이터 */
  pendingDataRef: React.MutableRefObject<string[]>
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
  onRecapture,
  onScroll,
  initialContent,
  disabled,
  deps = []
}: UseXtermTerminalParams): UseXtermTerminalReturn {
  const xtermRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const recapturingRef = useRef(false)
  const pendingDataRef = useRef<string[]>([])

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

    // 마우스 트래킹 + alternate screen 차단
    // 마우스 트래킹을 차단하여 xterm.js 네이티브 텍스트 선택을 유지합니다.
    // 휠 스크롤은 별도 wheel 리스너에서 IPC를 통해 tmux copy-mode로 전달.
    // - 마우스 트래킹: 1000,1002,1003,1004,1006,1015,1016
    // - alternate screen: 47,1047,1049
    const blockedSetParams = [1000, 1002, 1003, 1004, 1006, 1015, 1016, 47, 1047, 1049]
    terminal.parser.registerCsiHandler({ prefix: '?', final: 'h' }, (params) => {
      for (let i = 0; i < params.length; i++) {
        if (blockedSetParams.includes(params[i] as number)) return true
      }
      return false
    })
    const blockedResetParams = [47, 1047, 1049]
    terminal.parser.registerCsiHandler({ prefix: '?', final: 'l' }, (params) => {
      for (let i = 0; i < params.length; i++) {
        if (blockedResetParams.includes(params[i] as number)) return true
      }
      return false
    })

    // PTY 응답 시퀀스 소비 — 리사이즈 시 DA1/CPR 응답이 raw 텍스트로 출력되지 않도록
    terminal.parser.registerCsiHandler({ prefix: '?', final: 'c' }, () => true) // DA1
    terminal.parser.registerCsiHandler({ final: 'R' }, () => true)              // CPR

    // 스크롤백 보호: 파괴적 시퀀스 차단
    terminal.parser.registerCsiHandler({ final: 'J' }, (params) => {
      if (params[0] === 3) return true // \e[3J: clear scrollback
      return false
    })
    terminal.parser.registerEscHandler({ final: 'c' }, () => true) // \ec: full reset

    // 키 이벤트 핸들러: 앱 단축키는 window로 전달, 나머지는 xterm 처리
    terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      // Cmd 조합은 앱 단축키 → window로 전달 (Cmd+Shift+Enter = 줌 토글 등)
      if (event.metaKey) {
        // Cmd+V: 클립보드 이미지 붙여넣기 (xterm 포커스 상태에서만 호출됨)
        if (event.code === 'KeyV' && event.type === 'keydown') {
          window.api.saveClipboardImage().then((filePath) => {
            if (filePath) onData(filePath)
          }).catch(() => {})
        }
        return false
      }
      // Shift+Enter → \n(LF) 전송으로 줄바꿈 (Enter는 xterm이 \r 전송 → 제출)
      // keydown에서만 전송, keypress/keyup은 차단 (xterm이 \r 중복 전송 방지)
      if (event.key === 'Enter' && event.shiftKey) {
        if (event.type === 'keydown') onData('\n')
        return false
      }
      if (event.type !== 'keydown') return true
      return true
    })

    xtermRef.current = terminal
    fitAddonRef.current = fitAddon

    // 초기 fit — 컨테이너 크기가 잡힌 후 1회 실행
    requestAnimationFrame(() => {
      if (!containerRef.current || containerRef.current.clientHeight === 0) return
      fitAddon.fit()

      // initialContent를 먼저 표시 (빈 화면 방지)
      if (initialContent) {
        terminal.write(initialContent)
      }

      onResize(terminal.cols, terminal.rows)
      if (isFocused !== false) terminal.focus()
    })

    const onDataDisposable = terminal.onData(onData)

    // 마우스 휠 → tmux copy-mode 스크롤 (IPC 경유)
    // onScroll 콜백이 제공되면 휠을 가로채서 tmux 명령으로 1줄씩 스크롤.
    // capture phase로 등록: xterm.js가 먼저 소비하기 전에 가로챔.
    const wheelContainer = containerRef.current
    let wheelAccumulator = 0
    const handleWheel = onScroll ? (e: WheelEvent): void => {
      if (!xtermRef.current) return
      e.preventDefault()
      e.stopPropagation()
      const term = xtermRef.current
      const rect = wheelContainer.getBoundingClientRect()
      const cellHeight = rect.height / term.rows
      const delta = e.deltaMode === 1 ? e.deltaY * cellHeight : e.deltaY
      wheelAccumulator += delta
      const absAcc = Math.abs(wheelAccumulator)
      const lines = Math.floor(absAcc / cellHeight)
      if (lines < 1) return
      const direction = wheelAccumulator < 0 ? 'up' : 'down'
      wheelAccumulator = Math.sign(wheelAccumulator) * (absAcc - lines * cellHeight)
      onScroll(direction, lines)
    } : null
    if (handleWheel) {
      wheelContainer.addEventListener('wheel', handleWheel, { capture: true, passive: false })
    }

    // 파일 드래그 앤 드롭 지원 (Finder → 터미널)
    const handleFileDragOver = (e: DragEvent): void => {
      e.preventDefault()
    }
    const handleFileDrop = (e: DragEvent): void => {
      e.preventDefault()
      if (!e.dataTransfer?.files?.length) return
      if (!containerRef.current?.contains(e.target as Node)) return
      const file = e.dataTransfer.files[0]
      const filePath = window.api.getPathForFile(file)
      if (!filePath) return
      onData(filePath)
    }
    document.addEventListener('dragover', handleFileDragOver, true)
    document.addEventListener('drop', handleFileDrop, true)

    // ResizeObserver — 컨테이너 크기 변경 시 fit (유일한 리사이즈 소스)
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        resizeTimer = null
        if (!fitAddonRef.current || !xtermRef.current) return
        if (!containerRef.current || containerRef.current.clientHeight === 0) return
        const prevCols = xtermRef.current.cols
        fitAddonRef.current.fit()
        const newCols = xtermRef.current.cols
        const newRows = xtermRef.current.rows
        onResize(newCols, newRows)

        if (newCols !== prevCols && onRecapture) {
          // cols 변경: tmux 스크롤백을 재캡처하여 xterm 버퍼 교체
          // recapture 중 PTY 데이터는 pendingDataRef에 버퍼링 → 완료 후 재생
          recapturingRef.current = true
          pendingDataRef.current = []
          const term = xtermRef.current

          onRecapture(newCols, newRows).then((screen) => {
            if (screen && term) {
              term.reset()
              term.write(screen, () => {
                // 캡처 내용이 완전히 파싱된 후 버퍼링된 PTY 데이터 재생
                const pending = pendingDataRef.current
                pendingDataRef.current = []
                recapturingRef.current = false
                for (const data of pending) {
                  term.write(data)
                }
                term.refresh(0, term.rows - 1)
              })
            } else {
              // 캡처 실패: 버퍼링된 PTY 데이터 재생 후 xterm reflow 유지
              const pending = pendingDataRef.current
              pendingDataRef.current = []
              recapturingRef.current = false
              if (term) {
                for (const data of pending) {
                  term.write(data)
                }
                term.refresh(0, term.rows - 1)
              }
            }
          }).catch(() => {
            const pending = pendingDataRef.current
            pendingDataRef.current = []
            recapturingRef.current = false
            if (term) {
              for (const data of pending) {
                term.write(data)
              }
            }
          })
        } else {
          xtermRef.current.refresh(0, newRows - 1)
        }
      }, 100)
    })

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current)
    }

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer)
      if (handleWheel) wheelContainer.removeEventListener('wheel', handleWheel, { capture: true })
      document.removeEventListener('dragover', handleFileDragOver, true)
      document.removeEventListener('drop', handleFileDrop, true)
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

  return { terminalRef: xtermRef, fitAddonRef, recapturingRef, pendingDataRef }
}
