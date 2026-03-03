/**
 * useSessionPtyState - PTY 출력 기반 세션 상태 감지
 *
 * PTY 데이터를 파싱하여 세션 상태(idle, thinking, tool, error 등)를 판별합니다.
 * SessionMeta + resolveStatus()로 상태 전이를 관리합니다.
 *
 * 보호 규칙:
 *   - hook이 설정한 상태를 PTY가 덮어쓰려면, 프롬프트 기반 확정 상태(idle/shell/exited)여야 함
 *   - PTY의 추정 상태(thinking/tool/agent/error/permission)는 hook보다 정확도가 낮으므로 무시
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import type { SessionStatus } from '../../shared/types'
import type { SessionMeta } from '../../shared/session-state'
import { createSessionMeta, resolveStatus, activateClaude } from '../../shared/session-state'
import { IDLE_TIMEOUT } from '../../shared/constants'
import { classifyChunk, extractContextPercent, extractSessionName, stripAnsi } from '../pty-parser'

interface UseSessionPtyStateParams {
  updateSessionSubtitleRef: React.MutableRefObject<(id: string, subtitle: string) => void>
}

interface UseSessionPtyStateReturn {
  sessionStatuses: Record<string, SessionStatus>
  contextPercents: Record<string, number>
  /** 새 세션 생성 시 초기 상태 설정 */
  initSession: (id: string, restored: boolean) => void
  /** 세션 삭제 시 PTY 관련 상태 정리 */
  cleanupPtyState: (id: string) => void
  /** 상태 업데이트 (소스 태깅 기반 충돌 방지) — hook 모듈에서도 사용 */
  updateStatus: (id: string, status: SessionStatus, source: 'hook' | 'pty') => void
  /** 세션별 통합 메타데이터 참조 */
  sessionMetas: React.MutableRefObject<Record<string, SessionMeta>>
  /** statusline 기반 context % 설정 (PTY 파싱보다 우선) */
  setContextFromStatusline: (id: string, pct: number) => void
}

export function useSessionPtyState({
  updateSessionSubtitleRef
}: UseSessionPtyStateParams): UseSessionPtyStateReturn {
  const [sessionStatuses, setSessionStatuses] = useState<Record<string, SessionStatus>>({})
  const [contextPercents, setContextPercents] = useState<Record<string, number>>({})

  const idleTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  /** 세션별 통합 메타데이터 (3개 ref를 대체) */
  const sessionMetas = useRef<Record<string, SessionMeta>>({})

  const initSession = useCallback((id: string, restored: boolean) => {
    const meta = createSessionMeta(restored)
    sessionMetas.current[id] = meta
    setSessionStatuses((prev) => ({ ...prev, [id]: meta.status }))
  }, [])

  const cleanupPtyState = useCallback((id: string) => {
    delete sessionMetas.current[id]
    if (idleTimers.current[id]) {
      clearTimeout(idleTimers.current[id])
      delete idleTimers.current[id]
    }
  }, [])

  /**
   * 상태 업데이트 (resolveStatus 기반 전이 규칙 적용)
   */
  const updateStatus = useCallback((id: string, status: SessionStatus, source: 'hook' | 'pty') => {
    const current = sessionMetas.current[id]
    if (!current) return

    const next = resolveStatus(current, status, source)
    if (!next) return // 변경 없음

    sessionMetas.current[id] = next
    setSessionStatuses((prev) => ({ ...prev, [id]: next.status }))
  }, [])

  // ── PTY 데이터 → 상태 감지 엔진 ──
  useEffect(() => {
    const promptBuf: Record<string, string> = {}
    const inputCapture: Record<string, string> = {}
    /** true = > 프롬프트에서 idle 진입 (세션명 캡처 허용), false = 타이머 idle (캡처 차단) */
    const idledByPrompt: Record<string, boolean> = {}
    /** classifyChunk 쓰로틀: 세션별 마지막 호출 시각 */
    const lastClassifyTime: Record<string, number> = {}
    const CLASSIFY_THROTTLE_MS = 100

    const cleanup = window.api.onSessionData((id: string, data: string) => {
      if (idleTimers.current[id]) clearTimeout(idleTimers.current[id])

      const meta = sessionMetas.current[id]
      if (!meta) return

      const wasIdle = meta.status.state === 'idle'

      // > 프롬프트에서 idle 진입한 경우에만 사용자 입력 축적
      if (wasIdle && idledByPrompt[id]) {
        inputCapture[id] = ((inputCapture[id] || '') + data).slice(-500)
      }

      // 프롬프트 버퍼 업데이트
      promptBuf[id] = ((promptBuf[id] || '') + data).slice(-800)

      // HUD 컨텍스트 퍼센테이지 추출 (가벼움, 항상 실행)
      const ctxPct = extractContextPercent(data)
      if (ctxPct !== null) {
        setContextPercents((prev) => prev[id] === ctxPct ? prev : { ...prev, [id]: ctxPct })
      }

      // ── 상태 분석 (100ms 쓰로틀) ──
      const now = performance.now()
      const lastTime = lastClassifyTime[id] || 0
      let result: ReturnType<typeof classifyChunk> = null
      if (now - lastTime >= CLASSIFY_THROTTLE_MS) {
        result = classifyChunk(data, promptBuf[id])
        lastClassifyTime[id] = now
      }

      if (result) {
        // Claude 프롬프트 감지 → 활성화 플래그
        if (result.state === 'idle') {
          sessionMetas.current[id] = activateClaude(sessionMetas.current[id])
        }

        // 초기 셸 프롬프트 억제 (Claude 활성화 전)
        const suppress = result.state === 'shell' && !sessionMetas.current[id].claudeActivated
        if (!suppress) updateStatus(id, result, 'pty')

        // idle/shell 진입 시 버퍼 초기화
        if (result.state === 'idle' || result.state === 'shell') {
          promptBuf[id] = ''
          inputCapture[id] = ''
          idledByPrompt[id] = result.state === 'idle'
        }

        // idle → 작업 전환: > 프롬프트에서 idle이었을 때만 세션명 갱신
        if (wasIdle && idledByPrompt[id] && result.state !== 'idle' && result.state !== 'shell' && result.state !== 'exited') {
          // Hook subtitle이 없을 때만 PTY 추정값 사용
          const currentMeta = sessionMetas.current[id]
          if (!currentMeta?.lastSubtitleFromHook) {
            const name = extractSessionName(inputCapture[id] || '')
            if (name) updateSessionSubtitleRef.current(id, name)
          }
          inputCapture[id] = ''
        }
      } else if (meta.status.state === 'starting') {
        // starting 상태 → 데이터가 흐르면 thinking으로 전환
        if (stripAnsi(data).trim().length > 3) {
          updateStatus(id, { state: 'thinking', label: '' }, 'pty')
        }
      }

      // idle 타이머: IDLE_TIMEOUT ms 무응답 → idle
      idleTimers.current[id] = setTimeout(() => {
        const currentMeta = sessionMetas.current[id]
        if (!currentMeta) return

        // starting 상태에서는 idle 타이머 무효
        if (currentMeta.status.state === 'starting') return
        // claudeActivated=false에서는 idle 전환 억제
        if (!currentMeta.claudeActivated) return
        // 안정 상태는 idle 타이머가 덮지 않음
        if (['exited', 'shell', 'idle', 'permission', 'tool', 'agent'].includes(currentMeta.status.state)) return
        // hook 소스 보호
        if (currentMeta.source === 'hook') return

        promptBuf[id] = ''
        idledByPrompt[id] = false
        updateStatus(id, { state: 'idle', label: '' }, 'pty')
      }, IDLE_TIMEOUT)
    })

    return () => {
      cleanup()
      for (const tmr of Object.values(idleTimers.current)) clearTimeout(tmr)
    }
  }, [updateStatus, updateSessionSubtitleRef])

  // ── 세션 종료 이벤트 ──
  useEffect(() => {
    return window.api.onSessionExit((id: string, exitCode: number) => {
      updateStatus(id, { state: 'exited', label: `Exited (${exitCode})` }, 'pty')
    })
  }, [updateStatus])

  // ── tmux pane_current_command 기반 쉘 감지 ──
  useEffect(() => {
    const shells = new Set(['zsh', 'bash', 'fish', 'sh', 'tcsh', 'csh', 'dash', 'ksh'])

    return window.api.onSessionPaneCommand((id: string, command: string) => {
      const meta = sessionMetas.current[id]
      if (shells.has(command) && meta?.claudeActivated) {
        updateStatus(id, { state: 'shell', label: '' }, 'pty')
      }
      // claude 프로세스 감지 → 복원 세션의 claudeActivated 플래그 설정
      if (command === 'claude') {
        if (meta) {
          sessionMetas.current[id] = activateClaude(meta)
        }
      }
    })
  }, [updateStatus])

  /** statusline IPC 기반 context % 업데이트 (PTY 파싱보다 우선) */
  const setContextFromStatusline = useCallback((id: string, pct: number) => {
    setContextPercents((prev) => prev[id] === pct ? prev : { ...prev, [id]: pct })
  }, [])

  return {
    sessionStatuses,
    contextPercents,
    initSession,
    cleanupPtyState,
    updateStatus,
    sessionMetas,
    setContextFromStatusline
  }
}
