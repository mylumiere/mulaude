/**
 * useSessionHooks - Claude Code hooks 기반 상태 감지
 *
 * Claude Code hooks 이벤트를 수신하여 세션 상태를 업데이트합니다.
 *
 * session_id 기반 부모/자식 분류:
 *   1. session_id 없음 → handleLegacyEvent
 *   2. parentClaudeSessionId와 일치 → handleParentEvent
 *   3. 다른 session_id → handleChildEvent (부모 상태 절대 건드리지 않음)
 */

import { useEffect, useRef } from 'react'
import type { SessionStatus, HookEvent } from '../../shared/types'
import type { Locale } from '../i18n'
import { t } from '../i18n'
import { HOOK_THINKING_DEBOUNCE } from '../../shared/constants'

interface UseSessionHooksParams {
  locale: Locale
  updateSessionSubtitleRef: React.MutableRefObject<(id: string, subtitle: string) => void>
  /** useSessionPtyState에서 제공하는 상태 업데이트 함수 */
  updateStatus: (id: string, status: SessionStatus, source: 'hook' | 'pty') => void
  /** 작업 수행 여부 추적 */
  hasWorked: React.MutableRefObject<Record<string, boolean>>
  /** 세션 에이전트 목록 참조 (레거시 이벤트용) */
  sessionAgentsRef: React.MutableRefObject<Record<string, { status: string }[]>>
}

interface UseSessionHooksReturn {
  /** 세션 삭제 시 hook 관련 상태 정리 */
  cleanupHookState: (id: string) => void
}

export function useSessionHooks({
  locale,
  updateSessionSubtitleRef,
  updateStatus,
  hasWorked,
  sessionAgentsRef
}: UseSessionHooksParams): UseSessionHooksReturn {
  /** PostToolUse → thinking 전환 디바운스 타이머 (연속 도구 사용 시 깜빡임 방지) */
  const hookThinkingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  /** 부모 Claude session_id 추적 (mulaudeSessionId → claudeSessionId) */
  const parentClaudeSessionIds = useRef<Record<string, string>>({})

  function cleanupHookState(id: string): void {
    if (hookThinkingTimers.current[id]) {
      clearTimeout(hookThinkingTimers.current[id])
      delete hookThinkingTimers.current[id]
    }
    delete parentClaudeSessionIds.current[id]
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
          hasWorked.current[id] = true
          updateStatus(id, { state: 'thinking', label: '' }, 'hook')
          const prompt = (event as Record<string, unknown>).prompt as string | undefined
          if (prompt && typeof prompt === 'string' && prompt.trim().length >= 4) {
            const name = prompt.trim().length > 40 ? prompt.trim().slice(0, 37) + '...' : prompt.trim()
            updateSessionSubtitleRef.current(id, name)
          }
          break
        }

        case 'PreToolUse': {
          const toolName = (event.tool_name as string) || 'Tool'
          if (hookThinkingTimers.current[id]) {
            clearTimeout(hookThinkingTimers.current[id])
            delete hookThinkingTimers.current[id]
          }

          if (toolName === 'Task') {
            updateStatus(id, { state: 'agent', label: toolName }, 'hook')
          } else if (toolName === 'AskUserQuestion') {
            updateStatus(id, { state: 'permission', label: t(locale, 'hook.askUser') }, 'hook')
          } else {
            updateStatus(id, { state: 'tool', label: toolName }, 'hook')
          }
          break
        }

        case 'PostToolUse': {
          if (hookThinkingTimers.current[id]) clearTimeout(hookThinkingTimers.current[id])
          hookThinkingTimers.current[id] = setTimeout(() => {
            delete hookThinkingTimers.current[id]
            updateStatus(id, { state: 'thinking', label: '' }, 'hook')
          }, HOOK_THINKING_DEBOUNCE)
          break
        }

        case 'Stop':
          // 에이전트 삭제는 하지 않음 — Config SSOT가 에이전트 라이프사이클 관리
          updateStatus(id, {
            state: 'idle',
            label: hasWorked.current[id] ? t(locale, 'hook.completed') : ''
          }, 'hook')
          break
      }
    }

    /**
     * 자식 이벤트 처리 (부모 상태를 절대 건드리지 않음)
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

        default:
          break
      }
    }

    /**
     * 레거시 이벤트 처리 (session_id 없는 환경 폴백)
     */
    function handleLegacyEvent(id: string, event: HookEvent): void {
      const hasRunningAgents = (sessionAgentsRef.current[id] || []).some((a) => a.status === 'running')

      switch (event.hook_event_name) {
        case 'Notification':
          if (event.notification_type === 'permission_prompt') {
            updateStatus(id, { state: 'permission', label: t(locale, 'hook.permission') }, 'hook')
          }
          break

        case 'UserPromptSubmit': {
          hasWorked.current[id] = true
          if (!hasRunningAgents) {
            updateStatus(id, { state: 'thinking', label: '' }, 'hook')
            const prompt = (event as Record<string, unknown>).prompt as string | undefined
            if (prompt && typeof prompt === 'string' && prompt.trim().length >= 4) {
              const name = prompt.trim().length > 40 ? prompt.trim().slice(0, 37) + '...' : prompt.trim()
              updateSessionSubtitleRef.current(id, name)
            }
          }
          break
        }

        case 'PreToolUse': {
          const toolName = (event.tool_name as string) || 'Tool'
          if (hookThinkingTimers.current[id]) {
            clearTimeout(hookThinkingTimers.current[id])
            delete hookThinkingTimers.current[id]
          }

          if (toolName === 'Task') {
            updateStatus(id, { state: 'agent', label: toolName }, 'hook')
          } else if (toolName === 'AskUserQuestion') {
            updateStatus(id, { state: 'permission', label: t(locale, 'hook.askUser') }, 'hook')
          } else if (!hasRunningAgents) {
            updateStatus(id, { state: 'tool', label: toolName }, 'hook')
          }
          break
        }

        case 'PostToolUse': {
          if (!hasRunningAgents) {
            if (hookThinkingTimers.current[id]) clearTimeout(hookThinkingTimers.current[id])
            hookThinkingTimers.current[id] = setTimeout(() => {
              delete hookThinkingTimers.current[id]
              updateStatus(id, { state: 'thinking', label: '' }, 'hook')
            }, HOOK_THINKING_DEBOUNCE)
          }
          break
        }

        case 'Stop':
          if (!hasRunningAgents) {
            // 에이전트 삭제는 하지 않음 — Config SSOT가 에이전트 라이프사이클 관리
            updateStatus(id, {
              state: 'idle',
              label: hasWorked.current[id] ? t(locale, 'hook.completed') : ''
            }, 'hook')
          }
          break
      }
    }

    return window.api.onSessionHook((id: string, event: HookEvent) => {
      const sessionId = event.session_id

      if (!sessionId) {
        handleLegacyEvent(id, event)
        return
      }

      const isKnownParent = parentClaudeSessionIds.current[id] === sessionId

      if (isKnownParent) {
        handleParentEvent(id, event)
      } else if (event.hook_event_name === 'UserPromptSubmit') {
        parentClaudeSessionIds.current[id] = sessionId
        handleParentEvent(id, event)
      } else if (!parentClaudeSessionIds.current[id]) {
        parentClaudeSessionIds.current[id] = sessionId
        handleParentEvent(id, event)
      } else {
        handleChildEvent(id, event)
      }
    })
  }, [locale, updateStatus, updateSessionSubtitleRef, hasWorked, sessionAgentsRef])

  return { cleanupHookState }
}
