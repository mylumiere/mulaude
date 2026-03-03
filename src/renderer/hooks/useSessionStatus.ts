/**
 * useSessionStatus - PTY + hooks + agents 통합 상태 관리 (래퍼 훅)
 *
 * 3개의 하위 훅을 조합하여 세션 상태를 통합 관리합니다:
 *   - useSessionPtyState: PTY 출력 파싱, 상태 분류, SessionMeta 관리
 *   - useSessionHooks: Hook 이벤트 처리, 부모/자식 분류
 *   - useSessionAgents: 팀 에이전트 목록 관리, pane 활동 보강
 */

import { useCallback, useEffect, useRef } from 'react'
import type { SessionStatus, AgentInfo } from '../../shared/types'
import type { Locale } from '../i18n'
import { useSessionPtyState } from './useSessionPtyState'
import { useSessionHooks } from './useSessionHooks'
import { useSessionAgents } from './useSessionAgents'

interface UseSessionStatusParams {
  locale: Locale
  updateSessionSubtitleRef: React.MutableRefObject<(id: string, subtitle: string) => void>
}

interface UseSessionStatusReturn {
  sessionStatuses: Record<string, SessionStatus>
  contextPercents: Record<string, number>
  /** team config 기반 에이전트 (Config SSOT — pane split, AgentTree, 알림용) */
  teamAgents: Record<string, AgentInfo[]>
  /** Hook 이벤트 기반 Task 에이전트 카운터 (사이드바 라벨 전용) */
  hookAgents: Record<string, AgentInfo[]>
  /** 부모 Claude session ID (mulaudeSessionId → claudeSessionId) */
  claudeSessionIds: Record<string, string>
  /** 새 세션 생성 시 초기 상태 설정 */
  initSession: (id: string, restored: boolean) => void
  /** 세션 삭제 시 내부 상태 정리 */
  cleanupSession: (id: string) => void
  /** 상태 직접 업데이트 (native 모드에서 채팅 phase → 사이드바 상태 연동) */
  updateStatus: (id: string, status: SessionStatus, source: 'hook' | 'pty') => void
}

export function useSessionStatus({
  locale,
  updateSessionSubtitleRef
}: UseSessionStatusParams): UseSessionStatusReturn {
  // 에이전트 관리 (독립적이므로 먼저 초기화)
  const { sessionAgents, cleanupAgentState } =
    useSessionAgents()

  // PTY 상태 감지 (기반 훅)
  const {
    sessionStatuses,
    contextPercents,
    initSession,
    cleanupPtyState,
    updateStatus,
    sessionMetas,
    setContextFromStatusline
  } = useSessionPtyState({ updateSessionSubtitleRef })

  // Hook 이벤트 처리 (통합 메타 참조)
  const { cleanupHookState, hookAgents, claudeSessionIds } = useSessionHooks({
    locale,
    updateSessionSubtitleRef,
    updateStatus,
    sessionMetas
  })

  // ── statusline context batch 리스너 ──
  // claudeSessionId → mulaudeSessionId 역매핑을 통해 context % 업데이트
  const claudeSessionIdsRef = useRef(claudeSessionIds)
  claudeSessionIdsRef.current = claudeSessionIds

  // 매핑 전 도착한 context 데이터 버퍼 (claudeSessionId → pct)
  const unmatchedCtxRef = useRef<Record<string, number>>({})

  useEffect(() => {
    return window.api.onContextBatch((batch: Record<string, number>) => {
      // claude → mulaude 역매핑 구축
      const reverseMap: Record<string, string> = {}
      for (const [mulaudeId, claudeId] of Object.entries(claudeSessionIdsRef.current)) {
        reverseMap[claudeId] = mulaudeId
      }

      for (const [claudeId, pct] of Object.entries(batch)) {
        const mulaudeId = reverseMap[claudeId]
        if (mulaudeId) {
          setContextFromStatusline(mulaudeId, pct)
        } else {
          // 아직 매핑되지 않은 claude session → 버퍼에 저장
          unmatchedCtxRef.current[claudeId] = pct
        }
      }
    })
  }, [setContextFromStatusline])

  // claudeSessionIds 변경 시 버퍼된 데이터 flush
  useEffect(() => {
    const buf = unmatchedCtxRef.current
    if (Object.keys(buf).length === 0) return

    for (const [claudeId, pct] of Object.entries(buf)) {
      for (const [mulaudeId, cId] of Object.entries(claudeSessionIds)) {
        if (cId === claudeId) {
          setContextFromStatusline(mulaudeId, pct)
          delete buf[claudeId]
          break
        }
      }
    }
  }, [claudeSessionIds, setContextFromStatusline])

  // 통합 정리 함수
  const cleanupSession = useCallback((id: string) => {
    cleanupPtyState(id)
    cleanupHookState(id)
    cleanupAgentState(id)
  }, [cleanupPtyState, cleanupHookState, cleanupAgentState])

  return { sessionStatuses, contextPercents, teamAgents: sessionAgents, hookAgents, claudeSessionIds, initSession, cleanupSession, updateStatus }
}
