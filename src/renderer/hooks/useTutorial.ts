/**
 * useTutorial - 인터랙티브 튜토리얼 상태 관리
 *
 * 흐름:
 *   1. 세션 0개 + 미완료 → 웰컴 다이얼로그 (welcome phase)
 *   2. "시작해볼까요?" 클릭 → 새 프로젝트 생성 + step 1 (+ 버튼 스포트라이트)
 *   3. 세션 생성 감지 (0→1) → step 1 완료, step 2~5 순차 진행
 *   4. 튜토리얼 중 외부 클릭 차단
 */

import { useState, useEffect, useCallback, useRef } from 'react'

export interface TutorialStep {
  selector: string
  position: 'left' | 'right' | 'inside'
  titleKey: string
  descKey: string
}

const STEPS: TutorialStep[] = [
  { selector: '.sidebar-add-btn', position: 'right', titleKey: 'tutorial.step1.title', descKey: 'tutorial.step1.desc' },
  { selector: '.session-row', position: 'right', titleKey: 'tutorial.step2.title', descKey: 'tutorial.step2.desc' },
  { selector: '.terminal-area', position: 'inside', titleKey: 'tutorial.step3.title', descKey: 'tutorial.step3.desc' },
  { selector: '.session-row', position: 'right', titleKey: 'tutorial.step4.title', descKey: 'tutorial.step4.desc' },
  { selector: '.sidebar-icon-btn', position: 'right', titleKey: 'tutorial.step5.title', descKey: 'tutorial.step5.desc' },
]

const STORAGE_KEY = 'mulaude-tutorial-done'

export type TutorialPhase = 'idle' | 'welcome' | 'steps'

export interface TutorialState {
  phase: TutorialPhase
  steps: TutorialStep[]
  currentStep: number
  targetRect: DOMRect | null
  /** 웰컴에서 "시작" 클릭 */
  start: () => void
  /** 웰컴에서 "나중에" 또는 스텝에서 "건너뛰기" */
  dismiss: () => void
  next: () => void
  prev: () => void
  /** 튜토리얼 다시보기 (세션이 있는 상태에서) */
  restart: () => void
}

export function useTutorial(
  sessionCount: number,
  createProject: () => void
): TutorialState {
  const [done, setDone] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === '1' } catch { return false }
  })
  const [phase, setPhase] = useState<TutorialPhase>('idle')
  const [currentStep, setCurrentStep] = useState(0)
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const prevCountRef = useRef(sessionCount)
  /** step 1에서 세션 생성 대기 중인지 */
  const waitingForSessionRef = useRef(false)

  // 첫 진입: 세션 0개 + 미완료 → 웰컴
  useEffect(() => {
    if (!done && sessionCount === 0) {
      setPhase('welcome')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 세션 생성 감지 (0→1): step 1 대기 중이면 다음 스텝으로
  useEffect(() => {
    if (waitingForSessionRef.current && prevCountRef.current === 0 && sessionCount >= 1) {
      waitingForSessionRef.current = false
      setCurrentStep(1)
    }
    prevCountRef.current = sessionCount
  }, [sessionCount])

  // 타겟 좌표 계산
  const updateRect = useCallback(() => {
    if (phase !== 'steps' || currentStep >= STEPS.length) {
      setTargetRect(null)
      return
    }
    const el = document.querySelector(STEPS[currentStep].selector)
    if (el) {
      setTargetRect(el.getBoundingClientRect())
    } else {
      setTargetRect(null)
    }
  }, [phase, currentStep])

  useEffect(() => {
    updateRect()

    observerRef.current?.disconnect()
    if (phase !== 'steps') return

    const el = document.querySelector(STEPS[currentStep]?.selector ?? '')
    if (el) {
      const ro = new ResizeObserver(updateRect)
      ro.observe(el)
      observerRef.current = ro
    }

    window.addEventListener('resize', updateRect)
    return () => {
      observerRef.current?.disconnect()
      window.removeEventListener('resize', updateRect)
    }
  }, [phase, currentStep, updateRect])

  const finish = useCallback(() => {
    setPhase('idle')
    setDone(true)
    try { localStorage.setItem(STORAGE_KEY, '1') } catch { /* ignore */ }
  }, [])

  const start = useCallback(() => {
    setPhase('steps')
    setCurrentStep(0)
    waitingForSessionRef.current = true
    // 즉시 새 프로젝트 생성
    createProject()
  }, [createProject])

  const dismiss = useCallback(() => {
    finish()
  }, [finish])

  const next = useCallback(() => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep((s) => s + 1)
    } else {
      finish()
    }
  }, [currentStep, finish])

  const prev = useCallback(() => {
    if (currentStep > 0) setCurrentStep((s) => s - 1)
  }, [currentStep])

  const restart = useCallback(() => {
    setDone(false)
    setPhase('steps')
    setCurrentStep(0)
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
  }, [])

  return { phase, steps: STEPS, currentStep, targetRect, start, dismiss, next, prev, restart }
}
