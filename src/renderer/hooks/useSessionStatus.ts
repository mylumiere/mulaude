/**
 * useSessionStatus - PTY + hooks + agents 통합 상태 관리 (래퍼 훅)
 *
 * 3개의 하위 훅을 조합하여 세션 상태를 통합 관리합니다:
 *   - useSessionPtyState: PTY 출력 파싱, 상태 분류, 소스 태깅
 *   - useSessionHooks: Hook 이벤트 처리, 부모/자식 분류
 *   - useSessionAgents: 팀 에이전트 목록 관리, pane 활동 보강
 */

import { useCallback } from 'react'
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
  /** 세션별 서브 에이전트 목록 */
  sessionAgents: Record<string, AgentInfo[]>
  /** 새 세션 생성 시 초기 상태 설정 */
  initSession: (id: string) => void
  /** 세션 삭제 시 내부 상태 정리 */
  cleanupSession: (id: string) => void
}

export function useSessionStatus({
  locale,
  updateSessionSubtitleRef
}: UseSessionStatusParams): UseSessionStatusReturn {
  // 에이전트 관리 (독립적이므로 먼저 초기화)
  const { sessionAgents, setSessionAgents, sessionAgentsRef, cleanupAgentState } =
    useSessionAgents()

  // PTY 상태 감지 (기반 훅)
  const {
    sessionStatuses,
    contextPercents,
    initSession,
    cleanupPtyState,
    updateStatus,
    hasWorked
  } = useSessionPtyState({ updateSessionSubtitleRef })

  // Hook 이벤트 처리 (PTY 상태 + 에이전트에 의존)
  const { cleanupHookState } = useSessionHooks({
    locale,
    updateSessionSubtitleRef,
    updateStatus,
    hasWorked,
    sessionAgentsRef,
    setSessionAgents
  })

  // 통합 정리 함수
  const cleanupSession = useCallback((id: string) => {
    cleanupPtyState(id)
    cleanupHookState(id)
    cleanupAgentState(id)
  }, [cleanupPtyState, cleanupHookState, cleanupAgentState])

  return { sessionStatuses, contextPercents, sessionAgents, initSession, cleanupSession }
}
