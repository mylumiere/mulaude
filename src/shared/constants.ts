/**
 * 공유 상수 정의
 *
 * main, preload, renderer 프로세스 간 공유되는 매직 넘버를 상수로 관리합니다.
 */

/** IPC 배치 전송 간격 (ms) — ~60fps */
export const IPC_BATCH_INTERVAL = 16

/** 에이전트 pane 폴링 간격 (ms) */
export const PANE_POLL_INTERVAL = 2000

/** PTY 무응답 → idle 전환 타임아웃 (ms) — 300ms는 너무 짧아 false idle 유발 */
export const IDLE_TIMEOUT = 2000

/** 기본 터미널 컬럼 수 */
export const DEFAULT_COLS = 120

/** 기본 터미널 행 수 */
export const DEFAULT_ROWS = 30

/** PostToolUse → thinking 전환 디바운스 (ms) */
export const HOOK_THINKING_DEBOUNCE = 400

/** 에이전트 터미널 다중 fit 안정화 지연 (ms) */
export const AGENT_FIT_DELAY_SHORT = 50
export const AGENT_FIT_DELAY_LONG = 300

/** 터미널 기본 폰트 사이즈 */
export const TERMINAL_FONT_SIZE = 14
export const AGENT_TERMINAL_FONT_SIZE = 13

/** 터미널 스크롤백 버퍼 줄 수 */
export const AGENT_SCROLLBACK = 5000

/** 터미널 기본 폰트 패밀리 */
export const TERMINAL_FONT_FAMILY = '"Menlo", "SF Mono", "Fira Code", "DM Mono", Monaco, monospace'

/** 터미널 줄 높이 */
export const TERMINAL_LINE_HEIGHT = 1.2
