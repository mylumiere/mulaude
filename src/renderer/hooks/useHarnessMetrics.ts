/**
 * useHarnessMetrics — Harness 메트릭 + Context Budget 수신 훅
 *
 * main 프로세스의 HarnessTracker로부터 3초 배치 IPC를 수신하여
 * 세션별 HarnessMetrics 상태를 관리합니다.
 *
 * 또한 statusline-manager의 Context Budget 배치도 수신하여
 * Harness 메트릭 (files, turns, agents)과 결합합니다.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import type { HarnessMetrics, ContextBudget } from '../../shared/types'

declare global {
  interface Window {
    api: {
      readHarnessMetrics: (sessionId?: string) => Promise<Record<string, HarnessMetrics> | HarnessMetrics | null>
      onHarnessMetrics: (cb: (batch: Record<string, HarnessMetrics>) => void) => () => void
      onContextBudgetBatch: (cb: (batch: Record<string, ContextBudget>) => void) => () => void
    }
  }
}

interface UseHarnessMetricsReturn {
  /** 세션별 메트릭 (세션 ID → HarnessMetrics) */
  harnessMetrics: Record<string, HarnessMetrics>
  /** 특정 세션의 도구 사용 요약 문자열 생성 */
  getToolSummary: (sessionId: string) => string
  /** 세션별 Context Budget (claude 세션 ID → ContextBudget) */
  contextBudgets: Record<string, ContextBudget>
}

export function useHarnessMetrics(): UseHarnessMetricsReturn {
  const [harnessMetrics, setHarnessMetrics] = useState<Record<string, HarnessMetrics>>({})
  const [contextBudgets, setContextBudgets] = useState<Record<string, ContextBudget>>({})
  const metricsRef = useRef<Record<string, HarnessMetrics>>({})
  const budgetsRef = useRef<Record<string, ContextBudget>>({})

  // 초기 로드
  useEffect(() => {
    window.api.readHarnessMetrics().then((data) => {
      if (data && typeof data === 'object' && !('toolCounts' in data)) {
        metricsRef.current = data as Record<string, HarnessMetrics>
        setHarnessMetrics(data as Record<string, HarnessMetrics>)
      }
    }).catch(() => {})
  }, [])

  // 실시간 배치 업데이트 수신
  useEffect(() => {
    return window.api.onHarnessMetrics((batch) => {
      metricsRef.current = { ...metricsRef.current, ...batch }
      setHarnessMetrics({ ...metricsRef.current })
    })
  }, [])

  // Context Budget 배치 수신 + Harness 메트릭과 결합
  useEffect(() => {
    return window.api.onContextBudgetBatch((batch) => {
      // Claude session ID → mulaude session ID 매핑은 상위에서 처리
      // 여기서는 원래 키(claudeSessionId)를 그대로 전달
      for (const [sessionId, budget] of Object.entries(batch)) {
        const metrics = metricsRef.current
        // 해당 세션의 harness 메트릭이 있으면 breakdown 보강
        // sessionId가 claudeSessionId이므로, mulaude 세션과 매핑 필요
        // → 매핑은 App.tsx에서 contextPercents처럼 처리
        budgetsRef.current[sessionId] = {
          ...budget,
          breakdown: budget.breakdown // 상위에서 보강 예정
        }
      }
      setContextBudgets({ ...budgetsRef.current })
    })
  }, [])

  // 도구 사용 요약 생성 (상위 3개 도구)
  const getToolSummary = useCallback((sessionId: string): string => {
    const m = metricsRef.current[sessionId]
    if (!m || Object.keys(m.toolCounts).length === 0) return ''

    return Object.entries(m.toolCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, count]) => `${name}:${count}`)
      .join(' ')
  }, [])

  return { harnessMetrics, getToolSummary, contextBudgets }
}
