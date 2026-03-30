/**
 * Harness 패널 상태 localStorage 영속화
 */

const STORAGE_KEY = 'mulaude-harness-panel'

interface HarnessPanelStorage {
  /** 열린 세션 ID 목록 */
  openSessions: string[]
  /** 세션별 분할 비율 */
  ratios: Record<string, number>
}

export function loadHarnessPanelState(): HarnessPanelStorage {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return { openSessions: [], ratios: {} }
}

export function saveHarnessPanelState(state: HarnessPanelStorage): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {}
}
