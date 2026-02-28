/**
 * themes.ts - 테마 시스템
 *
 * 6가지 디자인 테마를 제공합니다.
 * 각 테마는 UI용 CSS 변수와 xterm.js 터미널 색상을 포함합니다.
 * 글로벌 테마는 앱 전체 UI에, 세션별 테마는 터미널 색상에만 적용됩니다.
 */

export interface ThemeDef {
  id: string
  name: string
  accent: string
  cssVars: Record<string, string>
  xtermTheme: {
    background: string
    foreground: string
    cursor: string
    cursorAccent: string
    selectionBackground: string
    selectionForeground: string
    black: string
    red: string
    green: string
    yellow: string
    blue: string
    magenta: string
    cyan: string
    white: string
    brightBlack: string
    brightRed: string
    brightGreen: string
    brightYellow: string
    brightBlue: string
    brightMagenta: string
    brightCyan: string
    brightWhite: string
  }
}

const STORAGE_KEY = 'mulaude-theme'

// ─── Void: 딥 스페이스 + 일렉트릭 바이올렛 ───
const voidTheme: ThemeDef = {
  id: 'void',
  name: 'Void',
  accent: '#7c5cfc',
  cssVars: {
    '--bg-void': '#06060e',
    '--bg-deep': '#0a0a18',
    '--bg-surface': '#0e0e20',
    '--bg-elevated': '#141430',
    '--bg-glass': 'rgba(16, 16, 42, 0.65)',
    '--bg-glass-hover': 'rgba(22, 22, 56, 0.75)',
    '--accent-primary': '#7c5cfc',
    '--accent-primary-glow': 'rgba(124, 92, 252, 0.35)',
    '--accent-primary-soft': 'rgba(124, 92, 252, 0.12)',
    '--accent-secondary': '#06d6a0',
    '--accent-secondary-glow': 'rgba(6, 214, 160, 0.3)',
    '--accent-warm': '#f7a046',
    '--accent-danger': '#ff5c72',
    '--text-primary': '#eaeaf4',
    '--text-secondary': '#8585a8',
    '--text-muted': '#4e4e6e',
    '--text-ghost': '#2d2d4a',
    '--border-subtle': 'rgba(124, 92, 252, 0.08)',
    '--border-default': 'rgba(124, 92, 252, 0.15)',
    '--border-active': 'rgba(124, 92, 252, 0.4)',
    '--shadow-glow': '0 0 30px rgba(124, 92, 252, 0.35)',
    '--glow-bg-1': 'rgba(124, 92, 252, 0.06)',
    '--glow-bg-2': 'rgba(6, 214, 160, 0.04)'
  },
  xtermTheme: {
    background: '#0a0a18',
    foreground: '#eaeaf4',
    cursor: '#7c5cfc',
    cursorAccent: '#0a0a18',
    selectionBackground: 'rgba(124, 92, 252, 0.25)',
    selectionForeground: '#ffffff',
    black: '#141430',
    red: '#ff5c72',
    green: '#06d6a0',
    yellow: '#f7a046',
    blue: '#7c9cff',
    magenta: '#c77dff',
    cyan: '#4ecdc4',
    white: '#eaeaf4',
    brightBlack: '#4e4e6e',
    brightRed: '#ff8095',
    brightGreen: '#33e6b8',
    brightYellow: '#ffc078',
    brightBlue: '#a0b8ff',
    brightMagenta: '#dba0ff',
    brightCyan: '#7ee8e0',
    brightWhite: '#ffffff'
  }
}

// ─── Ocean: 딥 네이비 + 사이언 ───
const oceanTheme: ThemeDef = {
  id: 'ocean',
  name: 'Ocean',
  accent: '#22d3ee',
  cssVars: {
    '--bg-void': '#040a10',
    '--bg-deep': '#081420',
    '--bg-surface': '#0c1a2a',
    '--bg-elevated': '#122438',
    '--bg-glass': 'rgba(12, 26, 42, 0.65)',
    '--bg-glass-hover': 'rgba(18, 36, 56, 0.75)',
    '--accent-primary': '#22d3ee',
    '--accent-primary-glow': 'rgba(34, 211, 238, 0.3)',
    '--accent-primary-soft': 'rgba(34, 211, 238, 0.1)',
    '--accent-secondary': '#f472b6',
    '--accent-secondary-glow': 'rgba(244, 114, 182, 0.3)',
    '--accent-warm': '#fbbf24',
    '--accent-danger': '#fb7185',
    '--text-primary': '#e8f4f8',
    '--text-secondary': '#7ba8c4',
    '--text-muted': '#3d6680',
    '--text-ghost': '#1e3a50',
    '--border-subtle': 'rgba(34, 211, 238, 0.06)',
    '--border-default': 'rgba(34, 211, 238, 0.12)',
    '--border-active': 'rgba(34, 211, 238, 0.35)',
    '--shadow-glow': '0 0 30px rgba(34, 211, 238, 0.25)',
    '--glow-bg-1': 'rgba(34, 211, 238, 0.05)',
    '--glow-bg-2': 'rgba(244, 114, 182, 0.03)'
  },
  xtermTheme: {
    background: '#081420',
    foreground: '#e8f4f8',
    cursor: '#22d3ee',
    cursorAccent: '#081420',
    selectionBackground: 'rgba(34, 211, 238, 0.25)',
    selectionForeground: '#ffffff',
    black: '#122438',
    red: '#fb7185',
    green: '#34d399',
    yellow: '#fbbf24',
    blue: '#60a5fa',
    magenta: '#f472b6',
    cyan: '#22d3ee',
    white: '#e8f4f8',
    brightBlack: '#3d6680',
    brightRed: '#fda4af',
    brightGreen: '#6ee7b7',
    brightYellow: '#fde68a',
    brightBlue: '#93c5fd',
    brightMagenta: '#f9a8d4',
    brightCyan: '#67e8f9',
    brightWhite: '#ffffff'
  }
}

// ─── Ember: 다크 차콜 + 앰버 ───
const emberTheme: ThemeDef = {
  id: 'ember',
  name: 'Ember',
  accent: '#f59e0b',
  cssVars: {
    '--bg-void': '#0a0806',
    '--bg-deep': '#141008',
    '--bg-surface': '#1c1610',
    '--bg-elevated': '#28201a',
    '--bg-glass': 'rgba(28, 22, 16, 0.65)',
    '--bg-glass-hover': 'rgba(40, 32, 26, 0.75)',
    '--accent-primary': '#f59e0b',
    '--accent-primary-glow': 'rgba(245, 158, 11, 0.3)',
    '--accent-primary-soft': 'rgba(245, 158, 11, 0.1)',
    '--accent-secondary': '#ef4444',
    '--accent-secondary-glow': 'rgba(239, 68, 68, 0.3)',
    '--accent-warm': '#f59e0b',
    '--accent-danger': '#ef4444',
    '--text-primary': '#f5f0e8',
    '--text-secondary': '#a8977e',
    '--text-muted': '#6b5c48',
    '--text-ghost': '#3a3028',
    '--border-subtle': 'rgba(245, 158, 11, 0.06)',
    '--border-default': 'rgba(245, 158, 11, 0.12)',
    '--border-active': 'rgba(245, 158, 11, 0.35)',
    '--shadow-glow': '0 0 30px rgba(245, 158, 11, 0.25)',
    '--glow-bg-1': 'rgba(245, 158, 11, 0.05)',
    '--glow-bg-2': 'rgba(239, 68, 68, 0.03)'
  },
  xtermTheme: {
    background: '#141008',
    foreground: '#f5f0e8',
    cursor: '#f59e0b',
    cursorAccent: '#141008',
    selectionBackground: 'rgba(245, 158, 11, 0.25)',
    selectionForeground: '#ffffff',
    black: '#28201a',
    red: '#ef4444',
    green: '#84cc16',
    yellow: '#f59e0b',
    blue: '#60a5fa',
    magenta: '#e879f9',
    cyan: '#2dd4bf',
    white: '#f5f0e8',
    brightBlack: '#6b5c48',
    brightRed: '#f87171',
    brightGreen: '#a3e635',
    brightYellow: '#fbbf24',
    brightBlue: '#93c5fd',
    brightMagenta: '#f0abfc',
    brightCyan: '#5eead4',
    brightWhite: '#ffffff'
  }
}

// ─── Forest: 딥 포레스트 + 에메랄드 ───
const forestTheme: ThemeDef = {
  id: 'forest',
  name: 'Forest',
  accent: '#10b981',
  cssVars: {
    '--bg-void': '#040a06',
    '--bg-deep': '#081408',
    '--bg-surface': '#0e1e10',
    '--bg-elevated': '#162a18',
    '--bg-glass': 'rgba(14, 30, 16, 0.65)',
    '--bg-glass-hover': 'rgba(22, 42, 24, 0.75)',
    '--accent-primary': '#10b981',
    '--accent-primary-glow': 'rgba(16, 185, 129, 0.3)',
    '--accent-primary-soft': 'rgba(16, 185, 129, 0.1)',
    '--accent-secondary': '#fbbf24',
    '--accent-secondary-glow': 'rgba(251, 191, 36, 0.3)',
    '--accent-warm': '#fbbf24',
    '--accent-danger': '#f87171',
    '--text-primary': '#e8f5ec',
    '--text-secondary': '#7bac88',
    '--text-muted': '#3d6648',
    '--text-ghost': '#1e3a22',
    '--border-subtle': 'rgba(16, 185, 129, 0.06)',
    '--border-default': 'rgba(16, 185, 129, 0.12)',
    '--border-active': 'rgba(16, 185, 129, 0.35)',
    '--shadow-glow': '0 0 30px rgba(16, 185, 129, 0.25)',
    '--glow-bg-1': 'rgba(16, 185, 129, 0.05)',
    '--glow-bg-2': 'rgba(251, 191, 36, 0.03)'
  },
  xtermTheme: {
    background: '#081408',
    foreground: '#e8f5ec',
    cursor: '#10b981',
    cursorAccent: '#081408',
    selectionBackground: 'rgba(16, 185, 129, 0.25)',
    selectionForeground: '#ffffff',
    black: '#162a18',
    red: '#f87171',
    green: '#10b981',
    yellow: '#fbbf24',
    blue: '#60a5fa',
    magenta: '#c084fc',
    cyan: '#2dd4bf',
    white: '#e8f5ec',
    brightBlack: '#3d6648',
    brightRed: '#fca5a5',
    brightGreen: '#34d399',
    brightYellow: '#fde68a',
    brightBlue: '#93c5fd',
    brightMagenta: '#d8b4fe',
    brightCyan: '#5eead4',
    brightWhite: '#ffffff'
  }
}

// ─── Arctic: 슬레이트 블루그레이 + 아이스 블루 ───
const arcticTheme: ThemeDef = {
  id: 'arctic',
  name: 'Arctic',
  accent: '#38bdf8',
  cssVars: {
    '--bg-void': '#080a0e',
    '--bg-deep': '#0e1218',
    '--bg-surface': '#141a22',
    '--bg-elevated': '#1c242e',
    '--bg-glass': 'rgba(20, 26, 34, 0.65)',
    '--bg-glass-hover': 'rgba(28, 36, 46, 0.75)',
    '--accent-primary': '#38bdf8',
    '--accent-primary-glow': 'rgba(56, 189, 248, 0.3)',
    '--accent-primary-soft': 'rgba(56, 189, 248, 0.1)',
    '--accent-secondary': '#a78bfa',
    '--accent-secondary-glow': 'rgba(167, 139, 250, 0.3)',
    '--accent-warm': '#fbbf24',
    '--accent-danger': '#fb7185',
    '--text-primary': '#e8eef4',
    '--text-secondary': '#8898aa',
    '--text-muted': '#4a5568',
    '--text-ghost': '#2a3444',
    '--border-subtle': 'rgba(56, 189, 248, 0.06)',
    '--border-default': 'rgba(56, 189, 248, 0.12)',
    '--border-active': 'rgba(56, 189, 248, 0.35)',
    '--shadow-glow': '0 0 30px rgba(56, 189, 248, 0.25)',
    '--glow-bg-1': 'rgba(56, 189, 248, 0.05)',
    '--glow-bg-2': 'rgba(167, 139, 250, 0.03)'
  },
  xtermTheme: {
    background: '#0e1218',
    foreground: '#e8eef4',
    cursor: '#38bdf8',
    cursorAccent: '#0e1218',
    selectionBackground: 'rgba(56, 189, 248, 0.25)',
    selectionForeground: '#ffffff',
    black: '#1c242e',
    red: '#fb7185',
    green: '#34d399',
    yellow: '#fbbf24',
    blue: '#38bdf8',
    magenta: '#a78bfa',
    cyan: '#22d3ee',
    white: '#e8eef4',
    brightBlack: '#4a5568',
    brightRed: '#fda4af',
    brightGreen: '#6ee7b7',
    brightYellow: '#fde68a',
    brightBlue: '#7dd3fc',
    brightMagenta: '#c4b5fd',
    brightCyan: '#67e8f9',
    brightWhite: '#ffffff'
  }
}

// ─── Rosé: 다크 모브 + 로즈 핑크 ───
const roseTheme: ThemeDef = {
  id: 'rose',
  name: 'Rosé',
  accent: '#f472b6',
  cssVars: {
    '--bg-void': '#0a060a',
    '--bg-deep': '#140e16',
    '--bg-surface': '#1c1420',
    '--bg-elevated': '#2a1e2e',
    '--bg-glass': 'rgba(28, 20, 32, 0.65)',
    '--bg-glass-hover': 'rgba(42, 30, 46, 0.75)',
    '--accent-primary': '#f472b6',
    '--accent-primary-glow': 'rgba(244, 114, 182, 0.3)',
    '--accent-primary-soft': 'rgba(244, 114, 182, 0.1)',
    '--accent-secondary': '#fb923c',
    '--accent-secondary-glow': 'rgba(251, 146, 60, 0.3)',
    '--accent-warm': '#fb923c',
    '--accent-danger': '#ef4444',
    '--text-primary': '#f5eaf0',
    '--text-secondary': '#a8849a',
    '--text-muted': '#6b4860',
    '--text-ghost': '#3a2234',
    '--border-subtle': 'rgba(244, 114, 182, 0.06)',
    '--border-default': 'rgba(244, 114, 182, 0.12)',
    '--border-active': 'rgba(244, 114, 182, 0.35)',
    '--shadow-glow': '0 0 30px rgba(244, 114, 182, 0.25)',
    '--glow-bg-1': 'rgba(244, 114, 182, 0.05)',
    '--glow-bg-2': 'rgba(251, 146, 60, 0.03)'
  },
  xtermTheme: {
    background: '#140e16',
    foreground: '#f5eaf0',
    cursor: '#f472b6',
    cursorAccent: '#140e16',
    selectionBackground: 'rgba(244, 114, 182, 0.25)',
    selectionForeground: '#ffffff',
    black: '#2a1e2e',
    red: '#fb7185',
    green: '#34d399',
    yellow: '#fbbf24',
    blue: '#93c5fd',
    magenta: '#f472b6',
    cyan: '#67e8f9',
    white: '#f5eaf0',
    brightBlack: '#6b4860',
    brightRed: '#fda4af',
    brightGreen: '#6ee7b7',
    brightYellow: '#fde68a',
    brightBlue: '#bfdbfe',
    brightMagenta: '#f9a8d4',
    brightCyan: '#a5f3fc',
    brightWhite: '#ffffff'
  }
}

export const THEMES: ThemeDef[] = [
  voidTheme,
  oceanTheme,
  emberTheme,
  forestTheme,
  arcticTheme,
  roseTheme
]

export function getThemeById(id: string): ThemeDef {
  return THEMES.find((t) => t.id === id) || THEMES[0]
}

/**
 * 글로벌 UI 테마를 적용합니다.
 * document.documentElement에 CSS 변수를 설정합니다.
 */
export function applyTheme(themeId: string): void {
  const theme = getThemeById(themeId)
  const root = document.documentElement
  for (const [key, value] of Object.entries(theme.cssVars)) {
    root.style.setProperty(key, value)
  }
}

export function getSavedTheme(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || 'void'
  } catch {
    return 'void'
  }
}

export function saveTheme(themeId: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, themeId)
  } catch {
    // 무시
  }
}
