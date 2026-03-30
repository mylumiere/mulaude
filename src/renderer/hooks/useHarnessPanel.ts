/**
 * useHarnessPanel — Harness Dashboard 패널 상태 관리
 *
 * PlanPanel/PreviewPanel과 동일한 패턴으로 세션별 패널 열기/닫기/비율 조정을 관리합니다.
 * 열린 세션 목록과 비율은 localStorage에 영속화됩니다.
 */

import { useState, useCallback, useRef } from 'react'
import { loadHarnessPanelState, saveHarnessPanelState } from '../utils/harness-storage'
import { PREVIEW_DEFAULT_RATIO } from '../../shared/constants'

interface UseHarnessPanelReturn {
  /** 열린 세션 Set */
  harnessSessions: Set<string>
  /** 세션별 분할 비율 */
  harnessRatios: Record<string, number>
  /** 패널 토글 (열기/닫기) */
  toggleHarness: (sessionId: string) => void
  /** 패널 닫기 */
  closeHarness: (sessionId: string) => void
  /** 분할 비율 리사이즈 */
  handleHarnessResize: (sessionId: string) => (e: React.MouseEvent) => void
}

export function useHarnessPanel(): UseHarnessPanelReturn {
  const [harnessSessions, setHarnessSessions] = useState<Set<string>>(() => {
    const saved = loadHarnessPanelState()
    return new Set(saved.openSessions)
  })

  const [harnessRatios, setHarnessRatios] = useState<Record<string, number>>(() => {
    return loadHarnessPanelState().ratios
  })

  const harnessSessionsRef = useRef(harnessSessions)
  harnessSessionsRef.current = harnessSessions
  const harnessRatiosRef = useRef(harnessRatios)
  harnessRatiosRef.current = harnessRatios

  const save = useCallback(() => {
    saveHarnessPanelState({
      openSessions: Array.from(harnessSessionsRef.current),
      ratios: harnessRatiosRef.current
    })
  }, [])

  const toggleHarness = useCallback((sessionId: string) => {
    setHarnessSessions(prev => {
      const next = new Set(prev)
      if (next.has(sessionId)) {
        next.delete(sessionId)
      } else {
        next.add(sessionId)
      }
      harnessSessionsRef.current = next
      save()
      return next
    })
  }, [save])

  const closeHarness = useCallback((sessionId: string) => {
    setHarnessSessions(prev => {
      const next = new Set(prev)
      next.delete(sessionId)
      harnessSessionsRef.current = next
      save()
      return next
    })
  }, [save])

  const handleHarnessResize = useCallback((sessionId: string) => {
    return (e: React.MouseEvent): void => {
      e.preventDefault()
      const startX = e.clientX
      const container = (e.target as HTMLElement).parentElement
      if (!container) return

      const containerWidth = container.getBoundingClientRect().width
      const currentRatio = harnessRatiosRef.current[sessionId] ?? PREVIEW_DEFAULT_RATIO

      const onMove = (ev: MouseEvent): void => {
        const dx = ev.clientX - startX
        const newRatio = Math.max(0.2, Math.min(0.8, currentRatio + dx / containerWidth))
        setHarnessRatios(prev => {
          const next = { ...prev, [sessionId]: newRatio }
          harnessRatiosRef.current = next
          return next
        })
      }

      const onUp = (): void => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        save()
      }

      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    }
  }, [save])

  return {
    harnessSessions,
    harnessRatios,
    toggleHarness,
    closeHarness,
    handleHarnessResize
  }
}
