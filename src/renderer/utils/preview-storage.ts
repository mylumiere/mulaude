/**
 * preview-storage — 세션별 Preview 상태 localStorage 영속화
 */

const KEY_PREFIX = 'mulaude-preview-'
const SESSIONS_KEY = 'mulaude-preview-sessions'

export interface PreviewState {
  url: string
}

export function savePreviewState(sessionId: string, state: Partial<PreviewState>): void {
  try {
    const existing = loadPreviewState(sessionId)
    const merged = { url: '', ...existing, ...state }
    localStorage.setItem(KEY_PREFIX + sessionId, JSON.stringify(merged))
  } catch { /* ignore */ }
}

export function loadPreviewState(sessionId: string): PreviewState | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + sessionId)
    if (!raw) return null
    return JSON.parse(raw) as PreviewState
  } catch { return null }
}

export function deletePreviewState(sessionId: string): void {
  try { localStorage.removeItem(KEY_PREFIX + sessionId) } catch { /* ignore */ }
}

export function savePreviewSessions(sessionIds: string[]): void {
  try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessionIds)) } catch { /* ignore */ }
}

export function loadPreviewSessions(): string[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY)
    if (!raw) return []
    return JSON.parse(raw) as string[]
  } catch { return [] }
}
