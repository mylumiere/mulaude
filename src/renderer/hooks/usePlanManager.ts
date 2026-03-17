/**
 * usePlanManager — 세션별 Plan 패널 상태 관리
 *
 * Preview 패널의 usePreviewManager 패턴을 따릅니다.
 * 플랜 파일 경로, 내용, 분할 비율 등을 관리합니다.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { PREVIEW_DEFAULT_RATIO, MIN_PANE_RATIO } from '../../shared/constants'
import { savePlanSessions, loadPlanSessions, deletePlanState, savePlanState, loadPlanState } from '../utils/plan-storage'

export interface PlanInfo {
  filePath: string
  content: string
}

interface UsePlanManagerReturn {
  planSessions: Set<string>
  planInfos: Record<string, PlanInfo>
  planRatios: Record<string, number>
  openPlan: (sessionId: string, filePath: string) => void
  closePlan: (sessionId: string) => void
  cleanupPlan: (sessionId: string) => void
  switchFile: (sessionId: string, filePath: string) => void
  handlePlanResize: (sessionId: string) => (e: React.MouseEvent) => void
  planSessionsRef: React.MutableRefObject<Set<string>>
}

export function usePlanManager(): UsePlanManagerReturn {
  const [planSessions, setPlanSessions] = useState<Set<string>>(() => {
    return new Set(loadPlanSessions())
  })
  const [planInfos, setPlanInfos] = useState<Record<string, PlanInfo>>({})
  const [planRatios, setPlanRatios] = useState<Record<string, number>>({})
  const containerRef = useRef<HTMLElement | null>(null)

  const planSessionsRef = useRef(planSessions)
  planSessionsRef.current = planSessions

  const persist = useCallback((sessions: Set<string>) => {
    savePlanSessions(Array.from(sessions))
  }, [])

  const openPlan = useCallback((sessionId: string, filePath: string) => {
    setPlanSessions(prev => {
      const next = new Set(prev)
      next.add(sessionId)
      persist(next)
      return next
    })
    setPlanInfos(prev => ({
      ...prev,
      [sessionId]: { filePath, content: prev[sessionId]?.content || '' }
    }))
    savePlanState(sessionId, { filePath })
    // IPC: 파일 감시 시작
    window.api.watchPlanFile(sessionId, filePath)
  }, [persist])

  const closePlan = useCallback((sessionId: string) => {
    setPlanSessions(prev => {
      if (!prev.has(sessionId)) return prev
      const next = new Set(prev)
      next.delete(sessionId)
      persist(next)
      return next
    })
    // 이전 내용 제거 — 재열기 시 stale content flash 방지
    setPlanInfos(prev => {
      if (!prev[sessionId]) return prev
      const next = { ...prev }
      delete next[sessionId]
      return next
    })
    // IPC: 파일 감시 해제
    window.api.unwatchPlanFile(sessionId)
  }, [persist])

  const cleanupPlan = useCallback((sessionId: string) => {
    closePlan(sessionId)
    deletePlanState(sessionId)
    setPlanInfos(prev => {
      const next = { ...prev }
      delete next[sessionId]
      return next
    })
  }, [closePlan])

  const switchFile = useCallback((sessionId: string, filePath: string) => {
    // 기존 watcher 해제 + 새 파일 watch
    window.api.unwatchPlanFile(sessionId)
    window.api.watchPlanFile(sessionId, filePath)
    setPlanInfos(prev => ({
      ...prev,
      [sessionId]: { filePath, content: '' }
    }))
    savePlanState(sessionId, { filePath })
  }, [])

  // IPC 수신: 파일 내용 업데이트
  useEffect(() => {
    const cleanup = window.api.onPlanContentUpdate((sessionId: string, filePath: string, content: string) => {
      setPlanInfos(prev => ({
        ...prev,
        [sessionId]: { filePath, content }
      }))
    })
    return cleanup
  }, [])

  // 세션 복원 시 저장된 플랜 파일 감시 재시작
  const restoredRef = useRef(false)
  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true

    for (const sessionId of planSessions) {
      const state = loadPlanState(sessionId)
      if (state?.filePath) {
        window.api.watchPlanFile(sessionId, state.filePath)
        setPlanInfos(prev => ({
          ...prev,
          [sessionId]: { filePath: state.filePath, content: '' }
        }))
      }
    }
  }, [planSessions])

  const handlePlanResize = useCallback((sessionId: string) => {
    return (e: React.MouseEvent) => {
      e.preventDefault()
      const container = (e.target as HTMLElement).parentElement
      if (!container) return
      containerRef.current = container

      const startX = e.clientX
      const startRatio = planRatios[sessionId] ?? PREVIEW_DEFAULT_RATIO

      const onMouseMove = (ev: MouseEvent) => {
        if (!containerRef.current) return
        const rect = containerRef.current.getBoundingClientRect()
        const delta = (ev.clientX - startX) / rect.width
        const newRatio = Math.max(MIN_PANE_RATIO, Math.min(1 - MIN_PANE_RATIO, startRatio + delta))
        setPlanRatios(prev => ({ ...prev, [sessionId]: newRatio }))
      }

      const onMouseUp = () => {
        document.body.classList.remove('resizing')
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      document.body.classList.add('resizing')
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    }
  }, [planRatios])

  return {
    planSessions, planInfos, planRatios,
    openPlan, closePlan, cleanupPlan, switchFile,
    handlePlanResize, planSessionsRef
  }
}
