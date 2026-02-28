/**
 * useSessionHooks - Claude Code hooks 기반 상태 감지
 *
 * Claude Code hooks 이벤트를 수신하여 세션 상태를 업데이트합니다.
 *
 * session_id 기반 부모/자식 분류:
 *   1. session_id 없음 → 레거시 (부모와 동일 처리)
 *   2. parentClaudeSessionId와 일치 → handleParentEvent
 *   3. 다른 session_id → handleChildEvent (부모 상태 절대 건드리지 않음)
 *
 * Task 에이전트 라이프사이클:
 *   - PreToolUse(Task) → total++, running++ (team_name이 있으면 스킵)
 *   - PostToolUse(Task) → foreground면 running-- (bg는 pendingBgTasks로 추적, 스킵)
 *   - 부모 Stop(첫 번째) → 부모 idle
 *   - 후속 Stop (parentStopped 이후) → bg agent running--
 *   - PreToolUse (parentStopped 이후) → 부모 복귀 (parentStopped 해제)
 *   - UserPromptSubmit → 카운터 리셋 (running 중이면 유지)
 *   - 사이드바에 "2/4 agents" 형태로 표시
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import type { SessionStatus, HookEvent, AgentInfo } from '../../shared/types'
import type { SessionMeta } from '../../shared/session-state'
import { markWorked } from '../../shared/session-state'
import type { Locale } from '../i18n'
import { t } from '../i18n'
import { HOOK_THINKING_DEBOUNCE } from '../../shared/constants'

interface UseSessionHooksParams {
  locale: Locale
  updateSessionSubtitleRef: React.MutableRefObject<(id: string, subtitle: string) => void>
  /** useSessionPtyState에서 제공하는 상태 업데이트 함수 */
  updateStatus: (id: string, status: SessionStatus, source: 'hook' | 'pty') => void
  /** 세션별 통합 메타데이터 참조 */
  sessionMetas: React.MutableRefObject<Record<string, SessionMeta>>
}

interface UseSessionHooksReturn {
  /** 세션 삭제 시 hook 관련 상태 정리 */
  cleanupHookState: (id: string) => void
  /** Hook 이벤트에서 감지된 Task 에이전트 목록 (사이드바 표시용) */
  hookAgents: Record<string, AgentInfo[]>
}

/** 세션별 에이전트 카운터 */
interface AgentCounts {
  total: number
  running: number
}

export function useSessionHooks({
  locale,
  updateSessionSubtitleRef,
  updateStatus,
  sessionMetas
}: UseSessionHooksParams): UseSessionHooksReturn {
  /** PostToolUse → thinking 전환 디바운스 타이머 (연속 도구 사용 시 깜빡임 방지) */
  const hookThinkingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  /** 부모 Claude session_id 추적 (mulaudeSessionId → claudeSessionId) */
  const parentClaudeSessionIds = useRef<Record<string, string>>({})
  /** 부모 Stop 이후 child Stop 구분용 (bg agent Stop도 같은 session_id로 옴) */
  const parentStopped = useRef<Record<string, boolean>>({})
  /** 세션별 에이전트 카운터 (total/running) */
  const agentCounts = useRef<Record<string, AgentCounts>>({})
  /** background Task 카운터 (PostToolUse[Task] 시 fg/bg 구분용) */
  const pendingBgTasks = useRef<Record<string, number>>({})
  /** Hook 이벤트에서 감지된 Task 에이전트 (사이드바 리스트 전용) */
  const [hookAgents, setHookAgents] = useState<Record<string, AgentInfo[]>>({})

  /**
   * 카운터 → hookAgents 상태 동기화
   * ref를 setState 콜백 안에서 읽어 React 배칭 시 최신값 보장
   */
  const syncAgentDisplay = useCallback((id: string) => {
    setHookAgents(prev => {
      const counts = agentCounts.current[id]
      if (!counts || counts.total === 0) {
        if (!prev[id]) return prev
        const next = { ...prev }
        delete next[id]
        return next
      }
      const label = counts.running > 0
        ? `${counts.running}/${counts.total} agents`
        : `${counts.total}/${counts.total} done`
      const status: AgentInfo['status'] = counts.running > 0 ? 'running' : 'completed'
      const existing = prev[id]
      if (existing?.length === 1 && existing[0].name === label && existing[0].status === status) return prev
      return { ...prev, [id]: [{ name: label, status }] }
    })
  }, [])

  /** PreToolUse(Task) → 에이전트 카운터 증가 */
  const incrementAgent = useCallback((id: string) => {
    if (!agentCounts.current[id]) agentCounts.current[id] = { total: 0, running: 0 }
    agentCounts.current[id].total++
    agentCounts.current[id].running++
    syncAgentDisplay(id)
  }, [syncAgentDisplay])

  /** child Stop → 에이전트 카운터 감소 */
  const decrementAgent = useCallback((id: string) => {
    const counts = agentCounts.current[id]
    if (!counts || counts.running <= 0) return
    counts.running--
    syncAgentDisplay(id)
  }, [syncAgentDisplay])

  /** 새 턴 시작 시 에이전트 카운터 리셋 */
  const resetAgents = useCallback((id: string) => {
    delete agentCounts.current[id]
    delete pendingBgTasks.current[id]
    syncAgentDisplay(id)
  }, [syncAgentDisplay])

  function cleanupHookState(id: string): void {
    if (hookThinkingTimers.current[id]) {
      clearTimeout(hookThinkingTimers.current[id])
      delete hookThinkingTimers.current[id]
    }
    delete parentClaudeSessionIds.current[id]
    delete parentStopped.current[id]
    resetAgents(id)
  }

  useEffect(() => {
    /**
     * 부모 이벤트 처리 (session_id로 확실히 부모임을 확인)
     */
    function handleParentEvent(id: string, event: HookEvent): void {
      switch (event.hook_event_name) {
        case 'Notification':
          if (event.notification_type === 'permission_prompt') {
            updateStatus(id, { state: 'permission', label: t(locale, 'hook.permission') }, 'hook')
          }
          break

        case 'UserPromptSubmit': {
          const agentsRunning = (agentCounts.current[id]?.running ?? 0) > 0
          if (!agentsRunning) {
            resetAgents(id)
            parentStopped.current[id] = false
          }

          const meta = sessionMetas.current[id]
          if (meta) sessionMetas.current[id] = markWorked(meta)

          updateStatus(id, { state: 'thinking', label: '' }, 'hook')
          const prompt = (event as Record<string, unknown>).prompt as string | undefined
          if (prompt && typeof prompt === 'string' && prompt.trim().length >= 4) {
            const name = prompt.trim().length > 40 ? prompt.trim().slice(0, 37) + '...' : prompt.trim()
            updateSessionSubtitleRef.current(id, name)
            if (meta) sessionMetas.current[id] = { ...sessionMetas.current[id], lastSubtitleFromHook: true }
          }
          break
        }

        case 'PreToolUse':
          handlePreToolUse(id, event)
          break

        case 'PostToolUse':
          handlePostToolUse(id, event)
          break

        case 'Stop': {
          if (!parentStopped.current[id]) {
            parentStopped.current[id] = true
            const meta = sessionMetas.current[id]
            updateStatus(id, {
              state: 'idle',
              label: meta?.hasWorked ? t(locale, 'hook.completed') : ''
            }, 'hook')
          } else {
            decrementAgent(id)
          }
          break
        }
      }
    }

    /**
     * 자식 이벤트 처리 (부모 상태를 절대 건드리지 않음)
     *
     * child Stop → 에이전트 카운터 감소 (백그라운드 Task agent 종료)
     */
    function handleChildEvent(id: string, event: HookEvent): void {
      switch (event.hook_event_name) {
        case 'Notification':
          if (event.notification_type === 'permission_prompt') {
            updateStatus(id, { state: 'permission', label: t(locale, 'hook.permission') }, 'hook')
          }
          break

        case 'PreToolUse':
          if ((event.tool_name as string) === 'AskUserQuestion') {
            updateStatus(id, { state: 'permission', label: t(locale, 'hook.askUser') }, 'hook')
          }
          break

        case 'Stop':
          decrementAgent(id)
          break

        default:
          break
      }
    }

    /** PreToolUse 공통 처리 */
    function handlePreToolUse(id: string, event: HookEvent): void {
      const toolName = (event.tool_name as string) || 'Tool'
      if (hookThinkingTimers.current[id]) {
        clearTimeout(hookThinkingTimers.current[id])
        delete hookThinkingTimers.current[id]
      }

      if (toolName === 'Task') {
        const input = event.tool_input as Record<string, unknown> | undefined
        const isTeamTask = !!input?.team_name
        const isBg = !!input?.run_in_background
        updateStatus(id, { state: 'agent', label: toolName }, 'hook')
        if (!isTeamTask) {
          incrementAgent(id)
          if (isBg) {
            pendingBgTasks.current[id] = (pendingBgTasks.current[id] || 0) + 1
          }
        }
      } else if (toolName === 'AskUserQuestion') {
        updateStatus(id, { state: 'permission', label: t(locale, 'hook.askUser') }, 'hook')
      } else {
        updateStatus(id, { state: 'tool', label: toolName }, 'hook')
      }
    }

    /** PostToolUse 공통 처리 */
    function handlePostToolUse(id: string, event: HookEvent): void {
      const toolName = (event.tool_name as string) || ''
      // foreground Task 완료 → decrement (bg는 child Stop에서 처리)
      if (toolName === 'Task') {
        const bg = pendingBgTasks.current[id] || 0
        if (bg > 0) {
          pendingBgTasks.current[id] = bg - 1
        } else {
          decrementAgent(id)
        }
      }
      if (hookThinkingTimers.current[id]) clearTimeout(hookThinkingTimers.current[id])
      hookThinkingTimers.current[id] = setTimeout(() => {
        delete hookThinkingTimers.current[id]
        updateStatus(id, { state: 'thinking', label: '' }, 'hook')
      }, HOOK_THINKING_DEBOUNCE)
    }

    return window.api.onSessionHook((id: string, event: HookEvent) => {
      const sessionId = event.session_id

      // session_id 없음 → 레거시 (부모와 동일 처리)
      if (!sessionId) {
        handleParentEvent(id, event)
        return
      }

      // UserPromptSubmit → 항상 부모 (새 턴 시작, parentStopped 리셋)
      if (event.hook_event_name === 'UserPromptSubmit') {
        parentClaudeSessionIds.current[id] = sessionId
        handleParentEvent(id, event)
        return
      }

      // 부모 session_id 미확정 → 첫 이벤트로 확정
      if (!parentClaudeSessionIds.current[id]) {
        parentClaudeSessionIds.current[id] = sessionId
        handleParentEvent(id, event)
        return
      }

      const isKnownParent = parentClaudeSessionIds.current[id] === sessionId
      const isStopped = parentStopped.current[id]

      // parentStopped 이후: 같은 session_id라도 child로 라우팅
      // 단, PreToolUse는 부모가 다시 활동 시작한 것이므로 부모로 복귀
      if (isKnownParent && isStopped) {
        if (event.hook_event_name === 'PreToolUse') {
          parentStopped.current[id] = false
          handleParentEvent(id, event)
        } else {
          handleChildEvent(id, event)
        }
      } else if (isKnownParent) {
        handleParentEvent(id, event)
      } else {
        handleChildEvent(id, event)
      }
    })
  }, [locale, updateStatus, updateSessionSubtitleRef, sessionMetas, incrementAgent, decrementAgent, resetAgents])

  return { cleanupHookState, hookAgents }
}
