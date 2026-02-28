/**
 * useTutorial - 인터랙티브 튜토리얼 상태 관리
 *
 * 첫 세션이 생성된 직후(0→1) 자동으로 튜토리얼을 시작합니다.
 * 모든 5단계를 순차적으로 안내합니다.
 */

import { useState, useEffect, useCallback, useRef } from 'react'

export interface TutorialStep {
  selector: string
  position: 'left' | 'right'
  titleKey: string
  descKey: string
}

const STEPS: TutorialStep[] = [
  { selector: '.sidebar-add-btn', position: 'right', titleKey: 'tutorial.step1.title', descKey: 'tutorial.step1.desc' },
  { selector: '.session-row', position: 'right', titleKey: 'tutorial.step2.title', descKey: 'tutorial.step2.desc' },
  { selector: '.terminal-area', position: 'left', titleKey: 'tutorial.step3.title', descKey: 'tutorial.step3.desc' },
  { selector: '.session-row', position: 'right', titleKey: 'tutorial.step4.title', descKey: 'tutorial.step4.desc' },
  { selector: '.sidebar-icon-btn', position: 'right', titleKey: 'tutorial.step5.title', descKey: 'tutorial.step5.desc' },
]

const STORAGE_KEY = 'mulaude-tutorial-done'

export interface TutorialState {
  active: boolean
  steps: TutorialStep[]
  currentStep: number
  targetRect: DOMRect | null
  next: () => void
  prev: () => void
  skip: () => void
}

export function useTutorial(sessionCount: number): TutorialState {
  const [done, setDone] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === '1' } catch { return false }
  })
  const [active, setActive] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const prevCountRef = useRef(sessionCount)

  // 자동 시작: 첫 세션이 생성된 순간 (0→1 전환)
  useEffect(() => {
    if (!done && prevCountRef.current === 0 && sessionCount >= 1) {
      setActive(true)
      setCurrentStep(0)
    }
    prevCountRef.current = sessionCount
  }, [done, sessionCount])

  // 타겟 좌표 계산
  const updateRect = useCallback(() => {
    if (!active || currentStep >= STEPS.length) {
      setTargetRect(null)
      return
    }
    const el = document.querySelector(STEPS[currentStep].selector)
    if (el) {
      setTargetRect(el.getBoundingClientRect())
    } else {
      setTargetRect(null)
    }
  }, [active, currentStep])

  useEffect(() => {
    updateRect()

    // ResizeObserver로 레이아웃 변경 감지
    observerRef.current?.disconnect()
    if (!active) return

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
  }, [active, currentStep, updateRect])

  const finish = useCallback(() => {
    setActive(false)
    setDone(true)
    try { localStorage.setItem(STORAGE_KEY, '1') } catch { /* ignore */ }
  }, [])

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

  const skip = useCallback(() => {
    finish()
  }, [finish])

  return { active, steps: STEPS, currentStep, targetRect, next, prev, skip }
}
