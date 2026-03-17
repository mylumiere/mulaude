/**
 * plan-storage — Plan 패널 상태 localStorage 영속화
 *
 * preview-storage 패턴을 따릅니다.
 */

const PLAN_SESSIONS_KEY = 'mulaude-plan-sessions'
const PLAN_STATE_PREFIX = 'mulaude-plan-state-'

export interface PlanState {
  filePath: string
}

export function savePlanSessions(sessionIds: string[]): void {
  try {
    localStorage.setItem(PLAN_SESSIONS_KEY, JSON.stringify(sessionIds))
  } catch { /* 무시 */ }
}

export function loadPlanSessions(): string[] {
  try {
    const raw = localStorage.getItem(PLAN_SESSIONS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function savePlanState(sessionId: string, state: Partial<PlanState>): void {
  try {
    const existing = loadPlanState(sessionId) || { filePath: '' }
    const merged = { ...existing, ...state }
    localStorage.setItem(PLAN_STATE_PREFIX + sessionId, JSON.stringify(merged))
  } catch { /* 무시 */ }
}

export function loadPlanState(sessionId: string): PlanState | null {
  try {
    const raw = localStorage.getItem(PLAN_STATE_PREFIX + sessionId)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function deletePlanState(sessionId: string): void {
  try {
    localStorage.removeItem(PLAN_STATE_PREFIX + sessionId)
  } catch { /* 무시 */ }
}
