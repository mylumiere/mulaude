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
  /** cols 변경 시 스크롤백 재캡처 콜백 (tmux reflow된 내용 복원) */
  onRecapture?: () => Promise<string | null>
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
  /** 재캡처 진행 중 여부 — true일 때 PTY 데이터 쓰기를 억제해야 함 */
  recapturingRef: React.MutableRefObject<boolean>
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
  initialContent,
  disabled,
  deps = []
}: UseXtermTerminalParams): UseXtermTerminalReturn {
  const xtermRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const recapturingRef = useRef(false)

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
      // Cmd 조합은 앱 단축키 → window로 전달 (Cmd+Shift+Enter = 줌 토글 등)
      if (event.metaKey) return false
      // Shift+Enter: keydown에서만 전송, keypress/keyup 모두 차단
      // keypress까지 통과시키면 xterm이 \r도 보내서 줄바꿈+즉시제출 됨
      if (event.key === 'Enter' && event.shiftKey) {
        if (event.type === 'keydown') onData('\x1b[13;2u')
        return false
      }
      if (event.type !== 'keydown') return true
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

    // 이미지 붙여넣기 지원
    // Cmd+V 시 클립보드에 이미지만 있으면 temp 파일로 저장 후 경로를 PTY에 전달.
    // Claude Code가 파일 경로를 인식하여 이미지를 처리함.
    const handleImagePaste = (e: KeyboardEvent): void => {
      if (!xtermRef.current || !containerRef.current) return
      if (!containerRef.current.contains(document.activeElement)) return
      if (!(e.metaKey && e.code === 'KeyV')) return
      window.api.saveClipboardImage().then((filePath) => {
        if (filePath) {
          onData(filePath)
        }
      }).catch(() => {})
    }
    document.addEventListener('keydown', handleImagePaste)

    // 파일 드래그 앤 드롭 지원 (Finder → 터미널)
    // capture phase로 등록: xterm 내부 요소가 이벤트를 소비하기 전에 가로챔
    // Claude Code는 이미지, PDF, 텍스트/코드 등 다양한 파일 경로를 인식
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
    // trailing-edge 디바운스: 최종 크기를 확실히 잡음
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        resizeTimer = null
        if (!fitAddonRef.current || !xtermRef.current) return
        const prevCols = xtermRef.current.cols
        fitAddonRef.current.fit()
        const newCols = xtermRef.current.cols
        const newRows = xtermRef.current.rows
        onResize(newCols, newRows)
        if (newCols !== prevCols) {
          // cols 변경: tmux가 hard-wrap한 이전 스크롤백은 reflow 불가
          // → xterm 스크롤백 비우고 tmux에서 reflow된 내용 재캡처
          //
          // 재캡처 중 PTY 데이터 억제:
          // tmux 리사이즈 시 화면 재그리기 시퀀스가 PTY로 흘러들어오는데,
          // 이걸 xterm에 쓰면 재캡처 내용과 중복되어 깨짐 발생.
          // 재캡처 완료까지 PTY 쓰기를 막고, 캡처 내용으로 일괄 교체.
          recapturingRef.current = true
          // 재캡처 대기 중 빈 화면 표시
          xtermRef.current.reset()
          if (onRecapture) {
            const term = xtermRef.current
            setTimeout(() => {
              onRecapture().then((screen) => {
                if (screen && term) {
                  // reset()은 동기적으로 모든 버퍼(뷰포트+스크롤백)를 완전 클리어
                  // ESC 시퀀스와 달리 write 큐와의 경합 없음
                  term.reset()
                  term.write(screen)
                }
              }).catch(() => {}).finally(() => {
                recapturingRef.current = false
                if (term) term.refresh(0, term.rows - 1)
              })
            }, 200) // tmux reflow 대기 (스크롤백 클수록 시간 소요)
          } else {
            recapturingRef.current = false
            xtermRef.current.refresh(0, newRows - 1)
          }
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
      document.removeEventListener('keydown', handleImagePaste)
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

  return { terminalRef: xtermRef, fitAddonRef, recapturingRef }
}
