/**
 * useTutorial - 인터랙티브 튜토리얼 상태 관리
 *
 * 액션 유형:
 *   - click: 클릭 프록시로 실제 버튼 클릭 유도 → 세션 증가 시 자동 진행
 *   - drag: 오버레이 비활성화 → 드래그&드롭 가능 → 외부에서 notifyAction() 호출
 *   - shortcut: 키보드 이벤트 감지 (⌘←/⌘→) → 자동 진행
 *   - null: Next/Prev 버튼으로 수동 진행
 */

import { useState, useEffect, useCallback, useRef } from 'react'

export interface TutorialStep {
  selector: string
  position: 'left' | 'right' | 'inside'
  titleKey: string
  descKey: string
  /** 액션 유형 */
  action: 'click' | 'drag' | 'shortcut' | null
  /** shortcut 스텝에서 감지할 키 목록 */
  shortcutKeys?: string[]
  /** shortcut 스텝에서 몇 번 눌러야 진행되는지 (기본 1) */
  shortcutHits?: number
  /** shortcut 스텝에서 Shift 키 필수 여부 */
  shortcutRequireShift?: boolean
  /** true면 querySelectorAll로 모든 매칭 요소의 union bounding box 사용 */
  selectorAll?: boolean
}

const STEPS: TutorialStep[] = [
  { selector: '.sidebar-add-btn', position: 'right', titleKey: 'tutorial.step1.title', descKey: 'tutorial.step1.desc', action: 'click' },
  { selector: '.terminal-area', position: 'inside', titleKey: 'tutorial.step2.title', descKey: 'tutorial.step2.desc', action: null },
  { selector: '.project-add-btn', position: 'right', titleKey: 'tutorial.step3.title', descKey: 'tutorial.step3.desc', action: 'click' },
  { selector: '.session-row', position: 'right', titleKey: 'tutorial.step4.title', descKey: 'tutorial.step4.desc', action: 'shortcut', shortcutKeys: ['ArrowUp', 'ArrowDown'], shortcutHits: 2, selectorAll: true },
  { selector: '.session-row:not(.session-row--active)', position: 'right', titleKey: 'tutorial.step5.title', descKey: 'tutorial.step5.desc', action: 'drag' },
  { selector: '.terminal-area', position: 'inside', titleKey: 'tutorial.step6.title', descKey: 'tutorial.step6.desc', action: 'shortcut', shortcutKeys: ['ArrowLeft', 'ArrowRight'] },
  { selector: '.terminal-area', position: 'inside', titleKey: 'tutorial.step7.title', descKey: 'tutorial.step7.desc', action: 'shortcut', shortcutKeys: ['Enter'], shortcutHits: 2, shortcutRequireShift: true },
  { selector: '.terminal-area', position: 'inside', titleKey: 'tutorial.step8.title', descKey: 'tutorial.step8.desc', action: null },
  { selector: '.sidebar-settings-btn', position: 'right', titleKey: 'tutorial.step9.title', descKey: 'tutorial.step9.desc', action: null },
]

const STORAGE_KEY = 'mulaude-tutorial-done'

export type TutorialPhase = 'idle' | 'setup' | 'welcome' | 'steps'

export interface TutorialState {
  phase: TutorialPhase
  steps: TutorialStep[]
  currentStep: number
  targetRect: DOMRect | null
  /** setup → welcome 전환 (언어·테마 선택 후) */
  confirmSetup: () => void
  start: () => void
  dismiss: () => void
  next: () => void
  prev: () => void
  restart: () => void
  /** 클릭 프록시 핸들러 (action='click' 스텝에서 타겟 클릭 시) */
  handleClickProxy: () => void
  /** 외부에서 액션 완료 알림 (drag 스텝에서 그리드 모드 진입 시 등) */
  notifyAction: () => void
}

export function useTutorial(sessionCount: number): TutorialState {
  const [done, setDone] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === '1' } catch { return false }
  })
  const [phase, setPhase] = useState<TutorialPhase>('idle')
  const [currentStep, setCurrentStep] = useState(0)
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  /** action='click' 스텝 진입 시 세션 수 기록 */
  const sessionCountAtStepRef = useRef(0)
  /** shortcut 스텝 히트 카운트 */
  const shortcutHitsRef = useRef(0)
  /** notifyAction 중복 호출 방지 */
  const notifyCalledRef = useRef(false)

  // 첫 진입: 세션 0개 + 미완료 → 셋업
  useEffect(() => {
    if (!done && sessionCount === 0) {
      setPhase('setup')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // click 스텝 진입 시 세션 수 기록
  useEffect(() => {
    if (phase === 'steps' && STEPS[currentStep]?.action === 'click') {
      sessionCountAtStepRef.current = sessionCount
    }
  }, [phase, currentStep]) // eslint-disable-line react-hooks/exhaustive-deps

  // 세션 수 변화 → click 스텝 자동 진행
  useEffect(() => {
    if (phase !== 'steps') return
    if (STEPS[currentStep]?.action !== 'click') return
    if (sessionCount > sessionCountAtStepRef.current) {
      const timer = setTimeout(() => setCurrentStep(s => s + 1), 400)
      return () => clearTimeout(timer)
    }
  }, [sessionCount, phase, currentStep])

  // shortcut 스텝: 지정된 키 감지 (shortcutHits 횟수만큼 눌러야 진행)
  useEffect(() => {
    if (phase !== 'steps') return
    const step = STEPS[currentStep]
    if (step?.action !== 'shortcut') return
    const keys = step.shortcutKeys ?? ['ArrowLeft', 'ArrowRight']
    const required = step.shortcutHits ?? 1
    const requireShift = step.shortcutRequireShift ?? false
    shortcutHitsRef.current = 0
    notifyCalledRef.current = false
    const handler = (e: KeyboardEvent): void => {
      if (e.metaKey && keys.includes(e.key) && (!requireShift || e.shiftKey)) {
        shortcutHitsRef.current++
        if (shortcutHitsRef.current >= required) {
          setTimeout(() => setCurrentStep(s => s + 1), 300)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [phase, currentStep])

  // action 스텝에서 타겟 요소 강제 표시 (hover에서만 보이는 버튼 대응)
  useEffect(() => {
    if (phase !== 'steps') return
    const step = STEPS[currentStep]
    if (!step?.action || step.action === 'shortcut') return
    const el = document.querySelector(step.selector) as HTMLElement
    if (!el) return
    el.style.opacity = '1'
    return () => { el.style.opacity = '' }
  }, [phase, currentStep])

  // 타겟 좌표 계산
  const updateRect = useCallback(() => {
    if (phase !== 'steps' || currentStep >= STEPS.length) {
      setTargetRect(null)
      return
    }
    const step = STEPS[currentStep]
    if (step.selectorAll) {
      // 모든 매칭 요소의 union bounding box
      const els = document.querySelectorAll(step.selector)
      if (els.length === 0) { setTargetRect(null); return }
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      els.forEach(el => {
        const r = el.getBoundingClientRect()
        minX = Math.min(minX, r.left)
        minY = Math.min(minY, r.top)
        maxX = Math.max(maxX, r.right)
        maxY = Math.max(maxY, r.bottom)
      })
      setTargetRect(new DOMRect(minX, minY, maxX - minX, maxY - minY))
    } else {
      const el = document.querySelector(step.selector)
      if (el) {
        setTargetRect(el.getBoundingClientRect())
      } else {
        setTargetRect(null)
      }
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

  const confirmSetup = useCallback(() => {
    setPhase('welcome')
  }, [])

  const start = useCallback(() => {
    setPhase('steps')
    setCurrentStep(0)
    notifyCalledRef.current = false
  }, [])

  const dismiss = useCallback(() => { finish() }, [finish])

  const next = useCallback(() => {
    notifyCalledRef.current = false
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(s => s + 1)
    } else {
      finish()
    }
  }, [currentStep, finish])

  const prev = useCallback(() => {
    notifyCalledRef.current = false
    if (currentStep > 0) setCurrentStep(currentStep - 1)
  }, [currentStep])

  const restart = useCallback(() => {
    setDone(false)
    setPhase('welcome')
    setCurrentStep(0)
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
  }, [])

  const handleClickProxy = useCallback(() => {
    if (phase !== 'steps') return
    const step = STEPS[currentStep]
    if (step?.action !== 'click') return
    const el = document.querySelector(step.selector) as HTMLElement
    if (el) el.click()
  }, [phase, currentStep])

  /** 외부에서 액션 완료 알림 (drag 스텝 등) */
  const notifyAction = useCallback(() => {
    if (phase !== 'steps') return
    if (notifyCalledRef.current) return
    const step = STEPS[currentStep]
    if (!step?.action) return
    notifyCalledRef.current = true
    setTimeout(() => setCurrentStep(s => s + 1), 300)
  }, [phase, currentStep])

  return {
    phase, steps: STEPS, currentStep, targetRect,
    confirmSetup, start, dismiss, next, prev, restart,
    handleClickProxy, notifyAction
  }
}
