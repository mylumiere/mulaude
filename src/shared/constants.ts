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

/** 터미널 기본 폰트 사이즈 */
export const TERMINAL_FONT_SIZE = 14
export const AGENT_TERMINAL_FONT_SIZE = 13

/** 메인 터미널 스크롤백 버퍼 줄 수 (tmux history-limit과 동일) */
export const TERMINAL_SCROLLBACK = 50000
/** 에이전트 터미널 스크롤백 버퍼 줄 수 */
export const AGENT_SCROLLBACK = 5000

/** 터미널 기본 폰트 패밀리 */
export const TERMINAL_FONT_FAMILY = '"Menlo", "SF Mono", "Fira Code", "DM Mono", Monaco, monospace'

/** 터미널 줄 높이 */
export const TERMINAL_LINE_HEIGHT = 1.2

/* ═══════ 환경 감지 ═══════ */

/** 로그인 셸 환경변수 수집 타임아웃 (ms) */
export const SHELL_ENV_TIMEOUT = 10000
/** claude CLI 경로 탐색 타임아웃 (ms) */
export const CLAUDE_PATH_TIMEOUT = 5000
/** tmux 버전 확인 타임아웃 (ms) */
export const TMUX_VERSION_TIMEOUT = 3000
/** tmux 세션 생성 타임아웃 (ms) */
export const TMUX_SESSION_CREATE_TIMEOUT = 10000
/** tmux 명령 실행 기본 타임아웃 (ms) */
export const TMUX_EXEC_TIMEOUT = 5000
/** tmux send-keys 타임아웃 (ms) */
export const TMUX_SEND_KEYS_TIMEOUT = 5000
/** legacy 모드 셸 초기화 대기 (ms) */
export const LEGACY_SHELL_INIT_DELAY = 300

/* ═══════ 자식 pane ═══════ */

/** pipe-pane 파일 폴링 간격 (ms) — 50→100ms (체감 지연 미미, I/O 50% 감소) */
export const PIPE_POLL_INTERVAL = 100
/** pane 재캡처 지연 (ms) */
export const PANE_RECAPTURE_DELAY = 200
/** 자식 pane 기본 컬럼 수 */
export const CHILD_PANE_DEFAULT_COLS = 80
/** 자식 pane 기본 행 수 */
export const CHILD_PANE_DEFAULT_ROWS = 24
/** stty 명령 타임아웃 (ms) */
export const STTY_TIMEOUT = 3000

/* ═══════ Hooks ═══════ */

/** hook 중복 fire 방지 만료 시간 (ms) */
export const HOOK_DEDUP_EXPIRY = 5000
/** hook 파일 쓰기 완료 대기 (ms) */
export const HOOK_FILE_READ_DELAY = 10

/* ═══════ 윈도우 ═══════ */

/** 윈도우 상태 저장 디바운스 (ms) */
export const WINDOW_SAVE_DEBOUNCE = 500
/** 세션 저장소 디바운스 (ms) */
export const SESSION_STORE_SAVE_DEBOUNCE = 500
/** 화면 가시성 판정 마진 (px) */
export const SCREEN_VISIBILITY_MARGIN = 100

/* ═══════ Usage ═══════ */

/** usage 캐시 감시 간격 (ms) */
export const USAGE_WATCH_INTERVAL = 5000
/** HUD 숨김 시 백그라운드 폴링 간격 (ms) */
export const HUD_POLL_INTERVAL = 30000

/* ═══════ tmux ═══════ */

/** tmux 스크롤백 버퍼 줄 수 */
export const TMUX_HISTORY_LIMIT = 50000
/** pane 캡처 줄 수 (에이전트 패널용) */
export const PANE_CAPTURE_LINES = 8

/* ═══════ 에이전트 ═══════ */

/** 셸 프로세스 감지 목록 */
export const SHELL_COMMANDS = ['zsh', 'bash', 'sh', 'fish'] as const

/* ═══════ 터미널 레이아웃 ═══════ */

/** 최대 동시 패인 수 */
export const MAX_PANES = 6
/** 패인 최소 비율 */
export const MIN_PANE_RATIO = 0.1
/** 중복 세션 알림 표시 시간 (ms) */
export const DUPLICATE_ALERT_TIMEOUT = 2000
