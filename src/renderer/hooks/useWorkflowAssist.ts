/**
 * useWorkflowAssist — 워크플로우 어시스트 엔진
 *
 * 기존 IPC 데이터(metrics, verification, context, sessionStatus)를 조합하여
 * 적시에 적절한 액션을 제안하는 넛지(hint)를 생성합니다.
 *
 * 핵심 원칙:
 *   - 자동화가 아니라 어시스트 — 판단은 사람이, 실행은 원클릭
 *   - 같은 종류 넛지는 세션당 한 번만 (dismiss 가능)
 *   - 데스크톱 알림 없음, 방해 최소화
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type {
  SessionInfo,
  SessionStatus,
  HarnessMetrics,
  VerificationResult,
  WorkflowHint,
  WorkflowActionType,
  CowrkAgentState,
  AppMode
} from '../../shared/types'
import {
  WORKFLOW_EVALUATE_DEBOUNCE,
  WORKFLOW_REVIEW_FILE_THRESHOLD,
  WORKFLOW_NOPLAN_TURN_THRESHOLD,
  WORKFLOW_NOPLAN_FILE_THRESHOLD,
  WORKFLOW_CONTEXT_HIGH_THRESHOLD,
  WORKFLOW_ERROR_COUNT_THRESHOLD
} from '../../shared/constants'

interface UseWorkflowAssistParams {
  sessionStatuses: Record<string, SessionStatus>
  harnessMetrics: Record<string, HarnessMetrics>
  contextPercents: Record<string, number>
  planSessions: Set<string>
  appMode: AppMode
  sessions: SessionInfo[]
  cowrkAgents: CowrkAgentState[]
  onTogglePlan: (sessionId: string) => void | Promise<void>
  onSelectCowrkAgent: (name: string) => void
  onCreateCowrkAgent: () => void
  onAddSession: (workingDir: string) => void
}

interface UseWorkflowAssistReturn {
  /** 세션별 전체 힌트 (우선순위순) */
  hints: Record<string, WorkflowHint[]>
  /** 세션별 최고 우선순위 힌트 (SessionRow 배지용) */
  topHints: Record<string, WorkflowHint | null>
  /** 액션 실행 */
  executeAction: (hint: WorkflowHint, action: WorkflowActionType) => void
}

export function useWorkflowAssist({
  sessionStatuses,
  harnessMetrics,
  contextPercents,
  planSessions,
  appMode,
  sessions,
  cowrkAgents,
  onTogglePlan,
  onSelectCowrkAgent,
  onCreateCowrkAgent,
  onAddSession
}: UseWorkflowAssistParams): UseWorkflowAssistReturn {
  // ─── State ───
  const [hints, setHints] = useState<Record<string, WorkflowHint[]>>({})
  /** dismiss된 힌트 키 셋: "sessionId:type" — ref로 관리하여 평가 디바운스 재시작 방지 */
  const dismissedRef = useRef<Set<string>>(new Set())
  /** dismissed 변경 시 재평가 트리거용 카운터 */
  const [dismissVersion, setDismissVersion] = useState(0)
  /** 세션별 최근 verification 결과 */
  const verificationResultsRef = useRef<Record<string, VerificationResult[]>>({})
  /** 세션별 연속 에러 카운터 */
  const errorCountsRef = useRef<Record<string, number>>({})

  /** dismiss 헬퍼: ref 업데이트 + 재평가 트리거 */
  const dismiss = useCallback((key: string) => {
    if (!dismissedRef.current.has(key)) {
      dismissedRef.current = new Set(dismissedRef.current).add(key)
      setDismissVersion(v => v + 1)
    }
  }, [])

  /** dismiss 해제 헬퍼 */
  const undismiss = useCallback((key: string) => {
    if (dismissedRef.current.has(key)) {
      const next = new Set(dismissedRef.current)
      next.delete(key)
      dismissedRef.current = next
      setDismissVersion(v => v + 1)
    }
  }, [])

  // ─── Verification 결과 수집 (IPC 리스너) ───
  useEffect(() => {
    const cleanup = window.api.onVerificationResult((sessionId, result) => {
      const prev = verificationResultsRef.current[sessionId] || []
      // 같은 type의 최신 결과만 유지
      const filtered = prev.filter(r => r.type !== result.type)
      verificationResultsRef.current = {
        ...verificationResultsRef.current,
        [sessionId]: [...filtered, result]
      }
    })
    return cleanup
  }, [])

  // ─── 에러 카운팅 (sessionStatus 변화 추적) ───
  // error → error 이외의 정상 상태 전환 시 카운터 리셋 (진정한 "연속" 에러만 카운트)
  const prevStatusesRef = useRef<Record<string, SessionStatus>>({})
  useEffect(() => {
    for (const [sessionId, status] of Object.entries(sessionStatuses)) {
      const prev = prevStatusesRef.current[sessionId]
      if (status.state === 'error' && prev?.state !== 'error') {
        // error 진입 → 카운터 증가
        errorCountsRef.current[sessionId] = (errorCountsRef.current[sessionId] || 0) + 1
      } else if (prev?.state === 'error' && status.state !== 'error' && status.state !== 'idle') {
        // error → thinking/tool 등 정상 작업으로 복귀 → 카운터 리셋
        // (idle은 작업 대기이므로 리셋하지 않음 — idle에서 다시 error로 갈 수 있음)
        errorCountsRef.current[sessionId] = 0
      }
    }
    prevStatusesRef.current = { ...sessionStatuses }
  }, [sessionStatuses])

  // ─── UserPromptSubmit 시 일부 dismiss 초기화 ───
  useEffect(() => {
    const cleanup = window.api.onSessionHook((sessionId, event) => {
      if (event.hook_event_name === 'UserPromptSubmit') {
        // verificationFailed, reviewSuggestion dismiss 초기화
        undismiss(`${sessionId}:verificationFailed`)
        undismiss(`${sessionId}:reviewSuggestion`)
        // 에러 카운터 리셋
        errorCountsRef.current[sessionId] = 0
      }
    })
    return cleanup
  }, [undismiss])

  // ─── sessionStatuses ref (액션 실행 시 최신 상태 참조) ───
  const sessionStatusesRef = useRef(sessionStatuses)
  sessionStatusesRef.current = sessionStatuses

  // ─── 넛지 평가 (디바운스) ───
  useEffect(() => {
    const timer = setTimeout(() => {
      const dismissed = dismissedRef.current
      const newHints: Record<string, WorkflowHint[]> = {}

      for (const session of sessions) {
        const sid = session.id
        const status = sessionStatuses[sid]
        const metrics = harnessMetrics[sid]
        const ctx = contextPercents[sid]
        const sessionHints: WorkflowHint[] = []

        // ── 1. verificationFailed: verification fail + idle ──
        if (!dismissed.has(`${sid}:verificationFailed`)) {
          const results = verificationResultsRef.current[sid] || []
          const failedResult = results.find(r => r.status === 'fail')
          if (failedResult && status?.state === 'idle') {
            sessionHints.push({
              id: `${sid}:verificationFailed`,
              type: 'verificationFailed',
              sessionId: sid,
              timestamp: Date.now(),
              messageKey: 'assist.verificationFailed',
              primaryAction: 'feedbackToSession',
              secondaryAction: 'dismiss',
              payload: {
                verificationOutput: failedResult.output,
                verificationType: failedResult.type
              },
              priority: 1
            })
          }
        }

        // ── 2. repeatedErrors: error 이벤트 N회+ 연속 ──
        if (!dismissed.has(`${sid}:repeatedErrors`)) {
          const errorCount = errorCountsRef.current[sid] || 0
          if (errorCount >= WORKFLOW_ERROR_COUNT_THRESHOLD) {
            sessionHints.push({
              id: `${sid}:repeatedErrors`,
              type: 'repeatedErrors',
              sessionId: sid,
              timestamp: Date.now(),
              messageKey: 'assist.repeatedErrors',
              primaryAction: 'openPlan',
              secondaryAction: 'dismiss',
              payload: { errorCount },
              priority: 1
            })
          }
        }

        // ── 3. reviewSuggestion: filesModified >= 10 + idle ──
        if (!dismissed.has(`${sid}:reviewSuggestion`)) {
          if (metrics && metrics.filesModified.length >= WORKFLOW_REVIEW_FILE_THRESHOLD && status?.state === 'idle') {
            sessionHints.push({
              id: `${sid}:reviewSuggestion`,
              type: 'reviewSuggestion',
              sessionId: sid,
              timestamp: Date.now(),
              messageKey: 'assist.reviewSuggestion',
              primaryAction: 'askCowrkReview',
              secondaryAction: 'dismiss',
              payload: { filesModified: metrics.filesModified },
              priority: 2
            })
          }
        }

        // ── 4. contextHigh: context >= 80% + idle ──
        if (!dismissed.has(`${sid}:contextHigh`)) {
          if (ctx != null && ctx >= WORKFLOW_CONTEXT_HIGH_THRESHOLD && status?.state === 'idle') {
            sessionHints.push({
              id: `${sid}:contextHigh`,
              type: 'contextHigh',
              sessionId: sid,
              timestamp: Date.now(),
              messageKey: 'assist.contextHigh',
              primaryAction: 'suggestCompact',
              secondaryAction: 'createNewSession',
              payload: { contextPercent: ctx },
              priority: 2
            })
          }
        }

        // ── 5. noPlan: turnCount >= 3 + filesModified >= 5 + plan 미열림 ──
        if (!dismissed.has(`${sid}:noPlan`)) {
          if (
            metrics &&
            metrics.turnCount >= WORKFLOW_NOPLAN_TURN_THRESHOLD &&
            metrics.filesModified.length >= WORKFLOW_NOPLAN_FILE_THRESHOLD &&
            !planSessions.has(sid)
          ) {
            sessionHints.push({
              id: `${sid}:noPlan`,
              type: 'noPlan',
              sessionId: sid,
              timestamp: Date.now(),
              messageKey: 'assist.noPlan',
              primaryAction: 'openPlan',
              secondaryAction: 'dismiss',
              payload: { filesModified: metrics.filesModified },
              priority: 3
            })
          }
        }

        if (sessionHints.length > 0) {
          sessionHints.sort((a, b) => a.priority - b.priority)
          newHints[sid] = sessionHints
        }
      }

      setHints(newHints)
    }, WORKFLOW_EVALUATE_DEBOUNCE)

    return () => clearTimeout(timer)
    // dismissVersion: dismiss 변경 시 재평가 트리거 (dismissed ref는 deps에 포함하지 않음)
  }, [sessionStatuses, harnessMetrics, contextPercents, planSessions, sessions, dismissVersion])

  // ─── topHints: 세션별 최고 우선순위 ───
  const topHints = useMemo(() => {
    const result: Record<string, WorkflowHint | null> = {}
    for (const [sid, hintList] of Object.entries(hints)) {
      result[sid] = hintList[0] ?? null
    }
    return result
  }, [hints])

  // ─── 액션 실행 ───
  const executeAction = useCallback((hint: WorkflowHint, action: WorkflowActionType) => {
    const sid = hint.sessionId
    const session = sessions.find(s => s.id === sid)
    // 실행 시점 세션 상태 재검증 (feedbackToSession, suggestCompact은 idle일 때만 안전)
    const currentStatus = sessionStatusesRef.current[sid]

    switch (action) {
      case 'feedbackToSession': {
        // idle이 아니면 위험 — 건너뛰고 dismiss
        if (currentStatus?.state !== 'idle') {
          dismiss(hint.id)
          break
        }
        const output = hint.payload?.verificationOutput
        if (!output) break
        // 개행을 공백으로 치환하여 안전하게 한 줄로 전송
        const sanitized = output.slice(0, 2000).replace(/\r?\n/g, ' ↵ ')
        const msg = `[${hint.payload?.verificationType ?? 'check'} failed] ${sanitized}`
        if (appMode === 'native') {
          window.api.sendNativeMessage(sid, msg)
        } else {
          window.api.writeSession(sid, msg + '\n')
        }
        dismiss(hint.id)
        break
      }

      case 'askCowrkReview': {
        if (cowrkAgents.length > 0) {
          const agent = cowrkAgents[0]
          const files = hint.payload?.filesModified ?? []
          const reviewMsg = `Please review the following ${files.length} modified files:\n${files.slice(0, 20).join('\n')}`
          onSelectCowrkAgent(agent.name)
          // 약간의 딜레이 후 메시지 전송 (패널 열림 후)
          setTimeout(() => {
            window.api.cowrkAsk(agent.name, reviewMsg, session?.workingDir)
          }, 300)
        } else {
          onCreateCowrkAgent()
        }
        dismiss(hint.id)
        break
      }

      case 'openPlan':
        onTogglePlan(sid)
        dismiss(hint.id)
        break

      case 'suggestCompact': {
        // idle이 아니면 위험 — 건너뛰고 dismiss
        if (currentStatus?.state !== 'idle') {
          dismiss(hint.id)
          break
        }
        if (appMode === 'native') {
          window.api.sendNativeMessage(sid, '/compact')
        } else {
          window.api.writeSession(sid, '/compact\n')
        }
        dismiss(hint.id)
        break
      }

      case 'createNewSession': {
        if (session) onAddSession(session.workingDir)
        dismiss(hint.id)
        break
      }

      case 'dismiss':
        dismiss(hint.id)
        break
    }
  }, [sessions, appMode, cowrkAgents, onTogglePlan, onSelectCowrkAgent, onCreateCowrkAgent, onAddSession, dismiss])

  return { hints, topHints, executeAction }
}
