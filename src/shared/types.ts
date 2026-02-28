/**
 * 공유 타입 정의
 *
 * main, preload, renderer 프로세스 간 공유되는 인터페이스를 정의합니다.
 * 타입 중복을 방지하기 위해 이 파일에서 모든 공유 타입을 관리합니다.
 */

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
 * Claude 사용량 데이터 (claude-hud 플러그인 캐시에서 읽음)
 */
export interface UsageData {
  planName: string
  fiveHour: number
  sevenDay: number
  fiveHourResetAt: string
  sevenDayResetAt: string
}

/**
 * Claude Code 세션 상태
 *
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
  state: 'idle' | 'thinking' | 'tool' | 'agent' | 'permission' | 'error' | 'shell' | 'exited'
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
  /** 에이전트 상태 (exited = 비정상 종료) */
  status: 'running' | 'completed' | 'exited'
  /** pane 폴링에서 얻은 현재 활동 (예: "Read src/main/...", "Bash" 등) */
  detail?: string
  /** 연결된 tmux pane 인덱스 */
  paneIndex?: number
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

/** 프로젝트 그룹 (같은 workingDir의 세션을 묶음) */
export interface ProjectGroup {
  workingDir: string
  name: string
  sessions: SessionInfo[]
}
