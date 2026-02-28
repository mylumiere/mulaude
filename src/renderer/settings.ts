/**
 * settings.ts - 앱 설정 관리
 *
 * 글씨 크기, 알림 설정 등을 localStorage에 저장/복원합니다.
 */

// ─── UI 글씨 크기 ───
export type FontSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

export interface FontSizeOption {
  id: FontSize
  label: string
  scale: number // rem 기준 스케일
}

export const FONT_SIZES: FontSizeOption[] = [
  { id: 'xs', label: 'XS', scale: 0.9 },
  { id: 'sm', label: 'S', scale: 1.0 },
  { id: 'md', label: 'M', scale: 1.1 },
  { id: 'lg', label: 'L', scale: 1.2 },
  { id: 'xl', label: 'XL', scale: 1.35 }
]

export function getSavedFontSize(): FontSize {
  try {
    const saved = localStorage.getItem('mulaude-fontsize') as FontSize | null
    if (saved && FONT_SIZES.find((f) => f.id === saved)) return saved
  } catch { /* ignore */ }
  return 'md'
}

export function saveFontSize(size: FontSize): void {
  try { localStorage.setItem('mulaude-fontsize', size) } catch { /* ignore */ }
}

export function applyFontSize(size: FontSize): void {
  const option = FONT_SIZES.find((f) => f.id === size) || FONT_SIZES[2]
  document.documentElement.style.setProperty('--ui-scale', String(option.scale))
}

// ─── 알림 설정 ───

/**
 * 알림 이벤트 종류:
 *   - onIdle: Claude가 입력 대기 상태로 전환될 때
 *   - onError: 에러 발생 시
 *   - onComplete: 세션/작업 완료 시
 *   - onAgent: 에이전트 상태 변경 시
 */
export type NotifEvent = 'onIdle' | 'onError' | 'onComplete' | 'onAgent'

export const NOTIF_EVENTS: { id: NotifEvent; labelKey: string }[] = [
  { id: 'onIdle', labelKey: 'notif.onIdle' },
  { id: 'onError', labelKey: 'notif.onError' },
  { id: 'onComplete', labelKey: 'notif.onComplete' },
  { id: 'onAgent', labelKey: 'notif.onAgent' }
]

export interface NotifSettings {
  global: Record<NotifEvent, boolean>
  perSession: Record<string, Record<NotifEvent, boolean>>
}

const DEFAULT_NOTIF: Record<NotifEvent, boolean> = {
  onIdle: true,
  onError: true,
  onComplete: true,
  onAgent: false
}

export function getSavedNotifSettings(): NotifSettings {
  try {
    const raw = localStorage.getItem('mulaude-notif')
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        global: { ...DEFAULT_NOTIF, ...parsed.global },
        perSession: parsed.perSession || {}
      }
    }
  } catch { /* ignore */ }
  return { global: { ...DEFAULT_NOTIF }, perSession: {} }
}

export function saveNotifSettings(settings: NotifSettings): void {
  try { localStorage.setItem('mulaude-notif', JSON.stringify(settings)) } catch { /* ignore */ }
}

/** 특정 세션의 특정 이벤트 알림이 켜져 있는지 확인 */
export function isNotifEnabled(
  settings: NotifSettings,
  sessionId: string,
  event: NotifEvent
): boolean {
  const perSession = settings.perSession[sessionId]
  if (perSession && perSession[event] !== undefined) return perSession[event]
  return settings.global[event]
}

/** 데스크톱 알림 발송 (Electron 네이티브) */
export function sendNotification(title: string, body: string): void {
  window.api.sendNotification(title, body || title)
}

// ─── 세션별 테마 오버라이드 ───

export function getSavedSessionThemes(): Record<string, string> {
  try {
    const raw = localStorage.getItem('mulaude-session-themes')
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return {}
}

export function saveSessionThemes(themes: Record<string, string>): void {
  try { localStorage.setItem('mulaude-session-themes', JSON.stringify(themes)) } catch { /* ignore */ }
}

// ─── HUD 오버레이 숨기기 ───

export function getSavedHideHud(): boolean {
  try {
    const saved = localStorage.getItem('mulaude-hide-hud')
    if (saved === null) return true  // 기본값: HUD 숨김
    return saved === 'true'
  } catch { return true }
}

export function saveHideHud(hide: boolean): void {
  try { localStorage.setItem('mulaude-hide-hud', String(hide)) } catch { /* ignore */ }
}
