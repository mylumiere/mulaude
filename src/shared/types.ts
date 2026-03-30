/**
 * 공유 타입 정의
 *
 * main, preload, renderer 프로세스 간 공유되는 인터페이스를 정의합니다.
 * 타입 중복을 방지하기 위해 이 파일에서 모든 공유 타입을 관리합니다.
 */

/** 앱 모드: terminal(기존 xterm.js) / native(stream-json 기반 채팅 UI) */
export type AppMode = 'terminal' | 'native'

/** 세션 정보 */
export interface SessionInfo {
  id: string
  name: string
  /** 자동 감지된 작업명 (PTY 파싱, hooks UserPromptSubmit 등) */
  subtitle?: string
  workingDir: string
  /** tmux 세션명 (tmux 모드에서만 존재) */
  tmuxSessionName?: string
  /** 세션 최초 생성 시각 (ISO 8601) */
  createdAt?: string
  /** 앱 재시작 시 복원된 세션 여부 */
  restored?: boolean
}

/**
 * Claude Code hook 이벤트
 *
 * Claude Code의 hooks 시스템에서 발생하는 이벤트를 나타냅니다.
 * hook_event_name에 따라 다른 필드가 채워집니다.
 */
export interface HookEvent {
  hook_event_name: string
  session_id?: string
  notification_type?: string
  tool_name?: string
  tool_input?: Record<string, unknown>
  [key: string]: unknown
}

/**
 * Claude 사용량 데이터
 *
 * 소스: claude-hud 캐시 (.usage-cache.json) 또는 Keychain OAuth API
 */
export interface UsageData {
  planName: string
  fiveHour: number
  sevenDay: number
  fiveHourResetAt: string
  sevenDayResetAt: string
  /** 데이터 수집 시각 (epoch ms) — 없으면 신선도 표시 생략 */
  lastUpdated?: number
  /** 데이터 소스 — 없으면 소스 표시 생략 */
  source?: 'hud' | 'keychain'
}

/**
 * Claude Code 세션 상태
 *
 *   starting   – 세션 생성/복원 직후, Claude 로딩 중
 *   idle       – Claude 프롬프트(>) 표시, 사용자 입력 대기
 *   thinking   – 생각 중 / 응답 출력 중
 *   tool       – 도구 사용 중 (Read, Edit, Bash 등)
 *   agent      – 에이전트/팀 실행 중
 *   permission – 사용자 확인 요망 (allow/deny, AskUserQuestion 등)
 *   error      – 에러 발생
 *   shell      – Claude 종료 후 일반 셸
 *   exited     – PTY 프로세스 종료
 */
export interface SessionStatus {
  state: 'starting' | 'idle' | 'thinking' | 'tool' | 'agent' | 'permission' | 'error' | 'shell' | 'exited'
  label: string
}

/** 서브 에이전트 정보 */
export interface AgentInfo {
  /** 에이전트 이름 (Task tool의 name 파라미터) */
  name: string
  /** 에이전트 유형 (subagent_type: Explore, Plan, general-purpose 등) */
  type?: string
  /** 간단 설명 (Task tool의 description 파라미터) */
  description?: string
  /** 에이전트 상태 (pending = pane 대기, exited = 종료) */
  status: 'pending' | 'running' | 'completed' | 'exited'
  /** pane 폴링에서 얻은 현재 활동 (예: "Read src/main/...", "Bash" 등) */
  detail?: string
  /** 연결된 tmux pane 인덱스 */
  paneIndex?: number
  /** team config 색상 (blue, green, yellow 등) */
  color?: string
}

/** tmux pane 정보 (에이전트 상태 폴링용) */
export interface TmuxPaneInfo {
  /** pane 인덱스 (0 = 메인, 1+ = 에이전트) */
  index: number
  /** pane 타이틀 (Claude Code가 설정) */
  title: string
  /** 마지막 N줄 캡처 내용 */
  content: string
}

/** 플랜 파일 정보 */
export interface PlanFileInfo {
  name: string
  path: string
  mtime: number
}

/** 프로젝트 그룹 (같은 workingDir의 세션을 묶음) */
export interface ProjectGroup {
  workingDir: string
  name: string
  sessions: SessionInfo[]
}

/* ═══════ Native Chat 타입 ═══════ */

/** 턴 완료 후 통계 (claude-hud 스타일 표시용) */
export interface TurnStats {
  costUsd?: number
  durationMs?: number
  numTools: number
  model?: string
}

/** 대화 메시지 */
export interface ChatMessage {
  role: 'user' | 'assistant'
  text?: string
  blocks?: ChatContentBlock[]
  isStreaming?: boolean
  cancelled?: boolean
  /** 큐 대기 중 메시지 (스트리밍 중 전송 시) */
  queued?: boolean
  timestamp: number
  /** 턴 완료 후 통계 */
  turnStats?: TurnStats
}

export type ChatContentBlock = ChatTextBlock | ChatToolUseBlock | ChatToolResultBlock | ChatThinkingBlock | ChatInputRequestBlock

export interface ChatTextBlock {
  type: 'text'
  text: string
}

export interface ChatToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: string | Record<string, unknown>
}

/** tool_use 결과 블록 (tool_use_id로 매칭) */
export interface ChatToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error?: boolean
}

export interface ChatThinkingBlock {
  type: 'thinking'
  thinking: string
}

/** Native Chat에서 발생할 수 있는 대화형 입력 요청 */
export interface NativeInputRequest {
  /** 요청 유형 */
  type: 'permission' | 'question'
  /** 고유 요청 ID (응답 매칭용) */
  requestId: string
  /** Permission: 도구명 */
  toolName?: string
  /** Permission: 도구 입력 요약 */
  toolInput?: Record<string, unknown>
  /** Question: 질문 텍스트 */
  question?: string
  /** Question: 선택지 */
  options?: Array<{ label: string; description?: string }>
  /** Question: 복수 선택 가능 여부 */
  multiSelect?: boolean
}

/** Input request를 메시지 스트림에 인라인 표시하기 위한 콘텐츠 블록 */
export interface ChatInputRequestBlock {
  type: 'input_request'
  /** 입력 요청 상세 */
  request: NativeInputRequest
  /** 사용자가 응답했는지 여부 */
  answered: boolean
  /** 응답 표시 텍스트 (예: "✓ Allowed", "→ Option A") */
  responseLabel?: string
}

/* ═══════ Diff Viewer 타입 ═══════ */

/** git diff 파일 단위 정보 */
export interface DiffFile {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  oldPath?: string
  additions: number
  deletions: number
  hunks: DiffHunk[]
}

/** diff hunk (변경 블록) */
export interface DiffHunk {
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

/** diff 개별 라인 */
export interface DiffLine {
  type: 'context' | 'add' | 'delete'
  content: string
  oldLineNo?: number
  newLineNo?: number
}

/* ═══════ Viewer (파일 뷰어) 타입 ═══════ */

/** 뷰어 파일 콘텐츠 */
export interface ViewerContent {
  filePath: string
  type: 'markdown' | 'image'
  /** markdown: utf-8 텍스트, image: base64 data URI */
  data: string
}

/* ═══════ Cowrk (영속 AI 팀원) 타입 ═══════ */

/** Cowrk 에이전트 상태 (렌더러 표시용) */
export interface CowrkAgentState {
  name: string
  model: string
  createdAt: string
  totalConversations: number
  lastUsedAt: string | null
  /** 현재 상태 */
  status: 'idle' | 'thinking' | 'error'
  /** 프로필 이미지 절대 경로 (렌더러에서 file:// 로 로드) */
  avatarPath?: string
}

/** Cowrk 채팅 메시지 */
export interface CowrkChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  isStreaming?: boolean
}
