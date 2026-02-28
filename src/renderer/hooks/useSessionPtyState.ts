/**
 * useSessionPtyState - PTY 출력 기반 세션 상태 감지
 *
 * PTY 데이터를 파싱하여 세션 상태(idle, thinking, tool, error 등)를 판별합니다.
 * 상태 소스 태깅(source tagging) 기반으로 hook 상태와의 충돌을 방지합니다.
 *
 * 보호 규칙:
 *   - hook이 설정한 상태를 PTY가 덮어쓰려면, 프롬프트 기반 확정 상태(idle/shell/exited)여야 함
 *   - PTY의 추정 상태(thinking/tool/agent/error/permission)는 hook보다 정확도가 낮으므로 무시
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import type { SessionStatus } from '../../shared/types'
import { IDLE_TIMEOUT } from '../../shared/constants'
import { classifyChunk, extractContextPercent, extractSessionName, stripAnsi } from '../pty-parser'

/** 상태 소스를 포함한 내부 상태 */
export interface InternalStatus {
  status: SessionStatus
  source: 'hook' | 'pty'
}

interface UseSessionPtyStateParams {
  updateSessionSubtitleRef: React.MutableRefObject<(id: string, subtitle: string) => void>
}

interface UseSessionPtyStateReturn {
  sessionStatuses: Record<string, SessionStatus>
  contextPercents: Record<string, number>
  /** 새 세션 생성 시 초기 상태 설정 */
  initSession: (id: string) => void
  /** 세션 삭제 시 PTY 관련 상태 정리 */
  cleanupPtyState: (id: string) => void
  /** 상태 업데이트 (소스 태깅 기반 충돌 방지) — hook 모듈에서도 사용 */
  updateStatus: (id: string, status: SessionStatus, source: 'hook' | 'pty') => void
  /** 내부 상태 참조 (hook 모듈이 현재 소스 확인용) */
  internalStatuses: React.MutableRefObject<Record<string, InternalStatus>>
  /** Claude 활성화 여부 추적 */
  claudeActivated: React.MutableRefObject<Set<string>>
  /** 작업 수행 여부 추적 */
  hasWorked: React.MutableRefObject<Record<string, boolean>>
}

export function useSessionPtyState({
  updateSessionSubtitleRef
}: UseSessionPtyStateParams): UseSessionPtyStateReturn {
  const [sessionStatuses, setSessionStatuses] = useState<Record<string, SessionStatus>>({})
  const [contextPercents, setContextPercents] = useState<Record<string, number>>({})

  const idleTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  /** Claude 프롬프트(>) 한 번이라도 감지된 세션 (초기 셸 프롬프트 오판 방지) */
  const claudeActivated = useRef<Set<string>>(new Set())
  /** 상태 소스 태깅 (hook/pty 충돌 방지) */
  const internalStatuses = useRef<Record<string, InternalStatus>>({})
  /** 한 번이라도 작업한 세션 추적 (처음 idle = "입력 대기", 이후 idle = "완료") */
  const hasWorked = useRef<Record<string, boolean>>({})

  const initSession = useCallback((id: string) => {
    const status: SessionStatus = { state: 'thinking', label: 'Starting...' }
    internalStatuses.current[id] = { status, source: 'pty' }
    setSessionStatuses((prev) => ({ ...prev, [id]: status }))
  }, [])

  const cleanupPtyState = useCallback((id: string) => {
    claudeActivated.current.delete(id)
    delete internalStatuses.current[id]
    delete hasWorked.current[id]
    if (idleTimers.current[id]) {
      clearTimeout(idleTimers.current[id])
      delete idleTimers.current[id]
    }
  }, [])

  /**
   * 상태 업데이트 (소스 태깅 기반 충돌 방지)
   */
  const updateStatus = useCallback((id: string, status: SessionStatus, source: 'hook' | 'pty') => {
    const current = internalStatuses.current[id]

    // 같은 상태+라벨 중복 방지
    if (current && current.status.state === status.state && current.status.label === status.label) return

    // hook 소스 보호: PTY는 프롬프트 기반 확정 상태로만 hook을 덮어쓸 수 있음
    if (current && current.source === 'hook' && source === 'pty') {
      const promptStates = ['idle', 'shell', 'exited']
      if (!promptStates.includes(status.state)) {
        return
      }
      // 같은 상태면 hook 라벨 보존 (예: hook의 "완료" 라벨이 PTY의 빈 문자열로 덮어쓰이는 것 방지)
      if (current.status.state === status.state) {
        return
      }
    }

    internalStatuses.current[id] = { status, source }
    setSessionStatuses((prev) => ({ ...prev, [id]: status }))
  }, [])

  // ── PTY 데이터 → 상태 감지 엔진 ──
  useEffect(() => {
    const promptBuf: Record<string, string> = {}
    const inputCapture: Record<string, string> = {}
    /** true = > 프롬프트에서 idle 진입 (세션명 캡처 허용), false = 타이머 idle (캡처 차단) */
    const idledByPrompt: Record<string, boolean> = {}

    const cleanup = window.api.onSessionData((id: string, data: string) => {
      if (idleTimers.current[id]) clearTimeout(idleTimers.current[id])

      const current = internalStatuses.current[id]
      const wasIdle = current?.status.state === 'idle'

      // > 프롬프트에서 idle 진입한 경우에만 사용자 입력 축적
      if (wasIdle && idledByPrompt[id]) {
        inputCapture[id] = ((inputCapture[id] || '') + data).slice(-500)
      }

      // 프롬프트 버퍼 업데이트
      promptBuf[id] = ((promptBuf[id] || '') + data).slice(-800)

      // HUD 컨텍스트 퍼센테이지 추출
      const ctxPct = extractContextPercent(data)
      if (ctxPct !== null) {
        setContextPercents((prev) => prev[id] === ctxPct ? prev : { ...prev, [id]: ctxPct })
      }

      // ── 상태 분석 ──
      const result = classifyChunk(data, promptBuf[id])

      if (result) {
        // Claude 프롬프트 감지 → 활성화 플래그
        if (result.state === 'idle') claudeActivated.current.add(id)

        // 초기 셸 프롬프트 억제 (Claude 활성화 전)
        const suppress = result.state === 'shell' && !claudeActivated.current.has(id)
        if (!suppress) updateStatus(id, result, 'pty')

        // idle/shell 진입 시 버퍼 초기화
        if (result.state === 'idle' || result.state === 'shell') {
          promptBuf[id] = ''
          inputCapture[id] = ''
          idledByPrompt[id] = result.state === 'idle'
        }

        // idle → 작업 전환: > 프롬프트에서 idle이었을 때만 세션명 갱신
        if (wasIdle && idledByPrompt[id] && result.state !== 'idle' && result.state !== 'shell' && result.state !== 'exited') {
          const name = extractSessionName(inputCapture[id] || '')
          if (name) updateSessionSubtitleRef.current(id, name)
          inputCapture[id] = ''
        }
      } else if (!current) {
        // 초기 "Starting" 상태 → 데이터가 흐르면 thinking으로 전환
        if (stripAnsi(data).trim().length > 3) {
          updateStatus(id, { state: 'thinking', label: '' }, 'pty')
        }
      }

      // idle 타이머: IDLE_TIMEOUT ms 무응답 → idle
      idleTimers.current[id] = setTimeout(() => {
        const existing = internalStatuses.current[id]
        if (!existing) return
        // 안정 상태는 idle 타이머가 덮지 않음
        if (['exited', 'shell', 'idle', 'permission', 'tool', 'agent'].includes(existing.status.state)) return
        // hook 소스 보호
        if (existing.source === 'hook') return

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
  // PTY 프롬프트 패턴 매칭보다 robust — tmux가 직접 프로세스명을 보고
  useEffect(() => {
    const shells = new Set(['zsh', 'bash', 'fish', 'sh', 'tcsh', 'csh', 'dash', 'ksh'])

    return window.api.onSessionPaneCommand((id: string, command: string) => {
      if (shells.has(command) && claudeActivated.current.has(id)) {
        updateStatus(id, { state: 'shell', label: '' }, 'pty')
      }
      // claude 프로세스 감지 → 복원 세션의 claudeActivated 플래그 설정
      if (command === 'claude') {
        claudeActivated.current.add(id)
      }
    })
  }, [updateStatus])

  return {
    sessionStatuses,
    contextPercents,
    initSession,
    cleanupPtyState,
    updateStatus,
    internalStatuses,
    claudeActivated,
    hasWorked
  }
}
