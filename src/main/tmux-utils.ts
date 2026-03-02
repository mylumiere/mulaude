/**
 * tmux-utils — tmux 명령어 래퍼 유틸리티
 *
 * tmux 세션 생성, 확인, 삭제 등의 기본 명령어를 Node.js에서 사용할 수 있도록 래핑합니다.
 * Mulaude는 tmux를 통해 세션 영속화를 구현합니다:
 *   - 앱 종료 시에도 tmux 세션이 백그라운드에서 유지됨
 *   - 앱 재시작 시 기존 tmux 세션에 재연결하여 이전 출력 복원
 *
 * 모든 tmux 세션명은 `mulaude-` 접두사를 사용하여 다른 tmux 세션과 구분합니다.
 */

import { execSync, execFileSync, execFile } from 'child_process'
import { promisify } from 'util'
import { TMUX_EXEC_TIMEOUT, SHELL_ENV_TIMEOUT, TMUX_VERSION_TIMEOUT, TMUX_SESSION_CREATE_TIMEOUT, TMUX_HISTORY_LIMIT, TMUX_SEND_KEYS_TIMEOUT } from '../shared/constants'

const execFileAsync = promisify(execFile)

/* ═══════ 기본 실행 ═══════ */

/**
 * tmux 명령을 실행하고 결과를 반환하는 공통 래퍼입니다.
 *
 * 반복적인 try-catch + execFileSync 패턴을 단순화합니다.
 * 에러 발생 시 null을 반환합니다.
 *
 * @param tmuxPath - tmux 실행 파일 경로
 * @param args - tmux 명령 인자 배열
 * @param timeout - 실행 타임아웃 (ms, 기본 5000)
 * @returns 실행 결과 문자열 (trimmed) 또는 null (에러 시)
 */
export function execTmux(tmuxPath: string, args: string[], timeout = TMUX_EXEC_TIMEOUT): string | null {
  try {
    return execFileSync(tmuxPath, ['-u', ...args], { encoding: 'utf-8', timeout }).trim()
  } catch {
    return null
  }
}

/**
 * tmux 명령을 비동기로 실행하고 결과를 반환하는 공통 래퍼입니다.
 * 폴링 경로에서 이벤트 루프 블로킹을 방지합니다.
 *
 * @param tmuxPath - tmux 실행 파일 경로
 * @param args - tmux 명령 인자 배열
 * @param timeout - 실행 타임아웃 (ms, 기본 5000)
 * @returns 실행 결과 문자열 (trimmed) 또는 null (에러 시)
 */
export async function execTmuxAsync(tmuxPath: string, args: string[], timeout = TMUX_EXEC_TIMEOUT): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(tmuxPath, ['-u', ...args], { encoding: 'utf-8', timeout })
    return stdout.trim()
  } catch {
    return null
  }
}

/**
 * tmux 실행 파일의 전체 경로를 탐색합니다.
 *
 * @param env - 셸 환경변수 (PATH 포함)
 * @returns tmux 경로 문자열. 찾지 못하면 null
 */
export function findTmuxPath(env: Record<string, string>): string | null {
  try {
    const shell = process.env.SHELL || '/bin/zsh'
    const result = execSync(`${shell} -ilc 'which tmux'`, {
      encoding: 'utf-8',
      timeout: SHELL_ENV_TIMEOUT,
      env
    }).trim()
    if (result) return result
  } catch {
    // fallback: PATH에서 직접 탐색
  }
  // 일반적인 설치 경로 시도
  const commonPaths = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux']
  for (const p of commonPaths) {
    if (execTmux(p, ['-V'], TMUX_VERSION_TIMEOUT) !== null) return p
  }
  return null
}

/**
 * tmux 버전 문자열을 반환합니다.
 *
 * @returns 버전 문자열 (예: "tmux 3.4") 또는 null
 */
export function getTmuxVersion(tmuxPath: string): string | null {
  return execTmux(tmuxPath, ['-V'], TMUX_VERSION_TIMEOUT)
}

/**
 * 지정된 이름의 tmux 세션이 살아있는지 확인합니다.
 *
 * `tmux has-session -t {name}` 의 exit code로 판별합니다.
 * exit code 0 = 세션 존재, 그 외 = 세션 없음
 *
 * @param tmuxPath - tmux 실행 파일 경로
 * @param name - 확인할 tmux 세션명
 * @returns 세션이 살아있으면 true
 */
export function isTmuxSessionAlive(tmuxPath: string, name: string): boolean {
  return execTmux(tmuxPath, ['has-session', '-t', name]) !== null
}

/**
 * `mulaude-` 접두사를 가진 tmux 세션 목록을 반환합니다.
 *
 * `tmux list-sessions -F '#{session_name}'` 결과에서 필터링합니다.
 *
 * @param tmuxPath - tmux 실행 파일 경로
 * @returns mulaude 세션명 배열
 */
export function listMulaudeTmuxSessions(tmuxPath: string): string[] {
  const output = execTmux(tmuxPath, ['list-sessions', '-F', '#{session_name}'])
  if (!output) return []
  return output.split('\n').filter((name) => name.startsWith('mulaude-'))
}

/* ═══════ 세션 관리 ═══════ */

/**
 * 백그라운드 tmux 세션을 생성합니다.
 *
 * 실행 순서:
 *   1. `tmux new-session -d -s {name} -x {cols} -y {rows}` — 분리 모드로 세션 생성
 *   2. `tmux set-environment -u` — CLAUDECODE/CLAUDE_CODE 제거 (중첩 세션 방지)
 *   3. `tmux set-environment` — MULAUDE_SESSION_ID, MULAUDE_IPC_DIR 등 환경변수 주입
 *   4. `tmux set-option history-limit 50000` — 스크롤백 버퍼 확장
 *   5. `tmux set-option status off` — 상태바 비활성화
 *   6. `tmux set-option mouse on` — 마우스 모드 활성화
 *   7. `tmux set-option allow-passthrough on` — 이스케이프 시퀀스 패스스루
 *
 * @param tmuxPath - tmux 실행 파일 경로
 * @param name - tmux 세션명 (mulaude-xxx 형식)
 * @param cwd - 세션 작업 디렉토리
 * @param cols - 터미널 컬럼 수
 * @param rows - 터미널 행 수
 * @param envVars - 세션에 주입할 환경변수 (MULAUDE_SESSION_ID, MULAUDE_IPC_DIR 등)
 */
export function createTmuxSession(
  tmuxPath: string,
  name: string,
  cwd: string,
  cols: number,
  rows: number,
  envVars: Record<string, string>
): void {
  // 1) 분리 모드로 세션 생성
  execFileSync(tmuxPath, ['-u', 'new-session', '-d', '-s', name, '-x', String(cols), '-y', String(rows)], {
    cwd,
    encoding: 'utf-8',
    timeout: TMUX_SESSION_CREATE_TIMEOUT
  })

  // 2) 중첩 세션 방지: CLAUDECODE 환경변수 제거
  if (execTmux(tmuxPath, ['set-environment', '-t', name, '-u', 'CLAUDECODE']) === null) {
    console.warn('[tmux-utils] unset CLAUDECODE failed')
  }
  if (execTmux(tmuxPath, ['set-environment', '-t', name, '-u', 'CLAUDE_CODE']) === null) {
    console.warn('[tmux-utils] unset CLAUDE_CODE failed')
  }

  // 3) 환경변수 주입 (개별 실패 무시)
  for (const [key, value] of Object.entries(envVars)) {
    if (execTmux(tmuxPath, ['set-environment', '-t', name, key, value]) === null) {
      console.warn(`[tmux-utils] set-environment failed for ${key}`)
    }
  }

  // 4) 스크롤백 버퍼 확장
  if (execTmux(tmuxPath, ['set-option', '-t', name, 'history-limit', String(TMUX_HISTORY_LIMIT)]) === null) {
    console.warn('[tmux-utils] set history-limit failed')
  }

  // 5) tmux 상태바 비활성화 (xterm.js에서 중복 렌더링 방지)
  if (execTmux(tmuxPath, ['set-option', '-t', name, 'status', 'off']) === null) {
    console.warn('[tmux-utils] set status off failed')
  }

  // 6) 마우스 모드 활성화 (스크롤 이벤트를 tmux가 처리하도록)
  //    alt buffer에서 xterm.js가 wheel을 화살표 키로 변환하는 문제 방지
  if (execTmux(tmuxPath, ['set-option', '-t', name, 'mouse', 'on']) === null) {
    console.warn('[tmux-utils] set mouse failed')
  }

  // 7) 이스케이프 시퀀스 패스스루 (이미지 붙여넣기, OSC 52 클립보드 등)
  execTmux(tmuxPath, ['set-option', '-t', name, 'allow-passthrough', 'on'])
}

/**
 * tmux 세션을 완전히 종료(kill)합니다.
 *
 * @param tmuxPath - tmux 실행 파일 경로
 * @param name - 종료할 tmux 세션명
 */
export function killTmuxSession(tmuxPath: string, name: string): void {
  execTmux(tmuxPath, ['kill-session', '-t', name])
}

/* ═══════ 키 입력 / 환경변수 ═══════ */

/**
 * tmux 세션 내에서 키 입력을 전송합니다.
 *
 * `tmux send-keys -t {name} '{command}' Enter` 로 명령어를 실행합니다.
 *
 * @param tmuxPath - tmux 실행 파일 경로
 * @param name - 대상 tmux 세션명
 * @param command - 전송할 명령어 문자열
 */
export function sendKeysToTmux(tmuxPath: string, name: string, command: string): void {
  execFileSync(tmuxPath, ['-u', 'send-keys', '-t', name, command, 'Enter'], {
    encoding: 'utf-8',
    timeout: TMUX_SEND_KEYS_TIMEOUT
  })
}

/* ═══════ 윈도우 / Pane 크기 ═══════ */

/**
 * tmux 세션의 윈도우 크기를 변경합니다.
 *
 * @param tmuxPath - tmux 실행 파일 경로
 * @param name - 대상 tmux 세션명
 * @param cols - 새 컬럼 수
 * @param rows - 새 행 수
 */
export function resizeTmuxWindow(
  tmuxPath: string,
  name: string,
  cols: number,
  rows: number
): void {
  execTmux(tmuxPath, ['resize-window', '-t', name, '-x', String(cols), '-y', String(rows)])

  // 리사이즈 후 클라이언트 새로고침 (ANSI 리플로우 깨짐 방지)
  try {
    execFileSync(tmuxPath, ['-u', 'refresh-client', '-t', name], { timeout: TMUX_EXEC_TIMEOUT })
  } catch { /* 무시 */ }
}

/**
 * tmux pane의 크기를 변경합니다 (break-pane으로 분리된 pane 포함).
 * paneId(%XX)로 타겟팅하여 해당 pane이 속한 window도 함께 리사이즈합니다.
 *
 * @param tmuxPath - tmux 실행 파일 경로
 * @param paneId - 대상 tmux pane ID (%XX 형식)
 * @param cols - 새 컬럼 수
 * @param rows - 새 행 수
 */
export function resizeTmuxPane(
  tmuxPath: string,
  paneId: string,
  cols: number,
  rows: number
): void {
  // resize-window로 pane이 속한 window 전체를 리사이즈
  // (break-pane 후 단일 pane window이므로 window = pane)
  execTmux(tmuxPath, ['resize-window', '-t', paneId, '-x', String(cols), '-y', String(rows)])
}

/**
 * tmux 세션의 환경변수를 갱신합니다.
 *
 * 앱 재시작 시 MULAUDE_IPC_DIR 등을 새 값으로 업데이트할 때 사용합니다.
 *
 * @param tmuxPath - tmux 실행 파일 경로
 * @param name - 대상 tmux 세션명
 * @param envVars - 갱신할 환경변수 맵
 */
export function updateTmuxEnvironment(
  tmuxPath: string,
  name: string,
  envVars: Record<string, string>
): void {
  for (const [key, value] of Object.entries(envVars)) {
    if (execTmux(tmuxPath, ['set-environment', '-t', name, key, value]) === null) {
      console.warn(`[tmux-utils] update env failed for ${key}`)
    }
  }
}

/**
 * tmux 세션에서 환경변수를 제거합니다 (중첩 세션 방지용).
 *
 * @param tmuxPath - tmux 실행 파일 경로
 * @param name - 대상 tmux 세션명
 * @param keys - 제거할 환경변수 이름 배열
 */
export function unsetTmuxEnvironment(
  tmuxPath: string,
  name: string,
  keys: string[]
): void {
  for (const key of keys) {
    if (execTmux(tmuxPath, ['set-environment', '-t', name, '-u', key]) === null) {
      console.warn(`[tmux-utils] unset env failed for ${key}`)
    }
  }
}

/* ═══════ Pane 조회 / 캡처 ═══════ */

/**
 * tmux 세션의 pane 목록을 조회합니다.
 *
 * `tmux list-panes -t {session} -F '#{pane_index}\t#{pane_title}'` 결과를 파싱합니다.
 *
 * @param tmuxPath - tmux 실행 파일 경로
 * @param sessionName - tmux 세션명
 * @returns pane 인덱스와 타이틀 배열
 */
export function listTmuxPanes(
  tmuxPath: string,
  sessionName: string
): { index: number; title: string }[] {
  const output = execTmux(tmuxPath, ['list-panes', '-t', sessionName, '-F', '#{pane_index}\t#{pane_title}'])
  if (!output) return []
  return output.split('\n').map((line) => {
    const [idx, ...rest] = line.split('\t')
    return { index: parseInt(idx, 10), title: rest.join('\t') }
  })
}

/**
 * tmux 세션의 pane 목록을 pane ID(%XX) 포함하여 조회합니다.
 *
 * Team config의 tmuxPaneId와 매칭하여 에이전트-pane 연결에 사용합니다.
 *
 * @param tmuxPath - tmux 실행 파일 경로
 * @param sessionName - tmux 세션명
 * @returns pane 인덱스, 타이틀, pane ID 배열
 */
export function listTmuxPanesWithIds(
  tmuxPath: string,
  sessionName: string
): { windowIndex: number; paneIndex: number; title: string; paneId: string }[] {
  // -s: 세션의 모든 window를 스캔 (break-pane으로 분리된 child pane 포함)
  const output = execTmux(
    tmuxPath,
    ['list-panes', '-s', '-t', sessionName, '-F', '#{window_index}\t#{pane_index}\t#{pane_title}\t#{pane_id}']
  )
  if (!output) return []
  return output.split('\n').map((line) => {
    const [winIdx, paneIdx, title, paneId] = line.split('\t')
    return {
      windowIndex: parseInt(winIdx, 10),
      paneIndex: parseInt(paneIdx, 10),
      title: title || '',
      paneId: paneId || ''
    }
  })
}

/**
 * tmux pane의 마지막 N줄을 캡처합니다.
 *
 * `tmux capture-pane -t {session}.{paneIndex} -p -S -{lines}` 로 내용을 읽습니다.
 *
 * @param tmuxPath - tmux 실행 파일 경로
 * @param sessionName - tmux 세션명
 * @param paneIndex - pane 인덱스
 * @param lines - 캡처할 줄 수
 * @returns 캡처된 문자열
 */
export function captureTmuxPane(
  tmuxPath: string,
  sessionName: string,
  paneIndex: number,
  lines: number
): string {
  return execTmux(tmuxPath, ['capture-pane', '-t', `${sessionName}.${paneIndex}`, '-p', '-S', `-${lines}`]) ?? ''
}

/**
 * 세션 ID를 tmux 세션명으로 변환합니다.
 *
 * tmux 세션명에 허용되지 않는 문자(`.` `:`)를 `-`로 치환하고,
 * `mulaude-` 접두사를 붙여 Mulaude 세션임을 표시합니다.
 *
 * @param sessionId - Mulaude 내부 세션 ID (예: "session-1")
 * @returns tmux 세션명 (예: "mulaude-session-1")
 */
export function toTmuxSessionName(sessionId: string): string {
  return `mulaude-${sessionId.replace(/[.:]/g, '-')}`
}

/**
 * tmux 세션에 auto-break-pane 훅을 설정합니다.
 *
 * 자식 pane이 생성(split-window)될 때 즉시 별도 window로 분리(break-pane -d)하여,
 * 리더 pane(window 0)이 항상 단독 풀사이즈를 유지합니다.
 * zoom toggle 방식과 달리 화면 깜빡임이 없습니다.
 *
 * @param tmuxPath - tmux 실행 파일 경로
 * @param sessionName - tmux 세션명
 */
export function setAutoBreakPaneHook(tmuxPath: string, sessionName: string): void {
  if (execTmux(tmuxPath, ['set-hook', '-t', sessionName, 'after-split-window', 'break-pane -d']) === null) {
    console.warn(`[tmux-utils] setAutoBreakPaneHook failed for ${sessionName}`)
  }
}

/* ═══════ Pane 스트리밍 ═══════ */

/**
 * pipe-pane 시작: pane 출력을 파일로 스트리밍합니다.
 * pane ID(%XX)로 타겟팅하여 break-pane 후 별도 window에 있어도 동작합니다.
 *
 * @param tmuxPath - tmux 실행 파일 경로
 * @param paneId - tmux pane ID (%XX 형식)
 * @param outputPath - 출력 파일 경로
 */
export function startPipePane(
  tmuxPath: string,
  paneId: string,
  outputPath: string
): void {
  // dd는 cat과 달리 stdio full buffering 없이 즉시 쓰기
  if (execTmux(tmuxPath, ['pipe-pane', '-t', paneId, `dd bs=4096 >> '${outputPath}' 2>/dev/null`]) === null) {
    console.warn(`[tmux-utils] startPipePane failed for ${paneId}`)
  }
}

/**
 * pipe-pane 중지 (인자 없이 호출하면 중지됩니다).
 *
 * @param tmuxPath - tmux 실행 파일 경로
 * @param paneId - tmux pane ID (%XX 형식)
 */
export function stopPipePane(
  tmuxPath: string,
  paneId: string
): void {
  execTmux(tmuxPath, ['pipe-pane', '-t', paneId])
}

/**
 * tmux pane에 raw 바이트를 전송합니다.
 * pane ID(%XX)로 타겟팅합니다.
 *
 * @param tmuxPath - tmux 실행 파일 경로
 * @param paneId - tmux pane ID (%XX 형식)
 * @param data - 전송할 데이터 문자열
 */
export function sendKeysToPane(
  tmuxPath: string,
  paneId: string,
  data: string
): void {
  const hexBytes = Buffer.from(data, 'utf-8')
    .toString('hex')
    .match(/.{1,2}/g)
  if (!hexBytes || hexBytes.length === 0) return
  execTmux(tmuxPath, ['send-keys', '-t', paneId, '-H', ...hexBytes])
}

/**
 * pane의 TTY 디바이스 경로를 조회합니다.
 *
 * @param tmuxPath - tmux 실행 파일 경로
 * @param paneId - tmux pane ID (%XX 형식)
 * @returns TTY 경로 문자열 (예: "/dev/ttys001") 또는 null
 */
export function getPaneTty(
  tmuxPath: string,
  paneId: string
): string | null {
  return execTmux(tmuxPath, ['display-message', '-t', paneId, '-p', '#{pane_tty}']) || null
}

/* ═══════ 프로세스 감지 ═══════ */

/**
 * tmux 세션의 메인 pane(window 0, pane 0)에서 실행 중인 프로세스명을 반환합니다.
 *
 * Claude CLI가 종료되어 셸로 돌아갔는지 감지하는 데 사용합니다.
 * 예: 'claude' → Claude 실행 중, 'zsh' → 셸 모드
 *
 * @param tmuxPath - tmux 실행 파일 경로
 * @param sessionName - tmux 세션명
 * @returns 현재 프로세스명 (예: "claude", "zsh") 또는 null
 */
export function getPaneCurrentCommand(
  tmuxPath: string,
  sessionName: string
): string | null {
  return execTmux(tmuxPath, ['display-message', '-t', `${sessionName}:0.0`, '-p', '#{pane_current_command}'])
}

/**
 * tmux pane ID로 현재 실행 중인 프로세스명을 반환합니다.
 * 에이전트 pane의 프로세스 종료 감지에 사용합니다.
 *
 * @param tmuxPath - tmux 실행 파일 경로
 * @param paneId - tmux pane ID (%XX 형식)
 * @returns 현재 프로세스명 (예: "claude", "zsh") 또는 null (pane 없음)
 */
export function getPaneCommand(tmuxPath: string, paneId: string): string | null {
  return execTmux(tmuxPath, ['display-message', '-t', paneId, '-p', '#{pane_current_command}'])
}

/**
 * ANSI 이스케이프 시퀀스를 포함하여 pane 전체 화면을 캡처합니다.
 * pane ID(%XX)로 타겟팅합니다.
 *
 * @param tmuxPath - tmux 실행 파일 경로
 * @param paneId - tmux pane ID (%XX 형식)
 * @returns 캡처된 ANSI 문자열
 */
export function captureTmuxPaneWithAnsi(
  tmuxPath: string,
  paneId: string
): string {
  return execTmux(tmuxPath, ['capture-pane', '-t', paneId, '-e', '-p']) ?? ''
}

/* ═══════ 비동기 폴링용 함수 ═══════ */

/** listTmuxPanes의 비동기 버전 */
export async function listTmuxPanesAsync(
  tmuxPath: string,
  sessionName: string
): Promise<{ index: number; title: string }[]> {
  const output = await execTmuxAsync(tmuxPath, ['list-panes', '-t', sessionName, '-F', '#{pane_index}\t#{pane_title}'])
  if (!output) return []
  return output.split('\n').map((line) => {
    const [idx, ...rest] = line.split('\t')
    return { index: parseInt(idx, 10), title: rest.join('\t') }
  })
}

/** listTmuxPanesWithIds의 비동기 버전 */
export async function listTmuxPanesWithIdsAsync(
  tmuxPath: string,
  sessionName: string
): Promise<{ windowIndex: number; paneIndex: number; title: string; paneId: string }[]> {
  const output = await execTmuxAsync(
    tmuxPath,
    ['list-panes', '-s', '-t', sessionName, '-F', '#{window_index}\t#{pane_index}\t#{pane_title}\t#{pane_id}']
  )
  if (!output) return []
  return output.split('\n').map((line) => {
    const [winIdx, paneIdx, title, paneId] = line.split('\t')
    return {
      windowIndex: parseInt(winIdx, 10),
      paneIndex: parseInt(paneIdx, 10),
      title: title || '',
      paneId: paneId || ''
    }
  })
}

/** captureTmuxPane의 비동기 버전 */
export async function captureTmuxPaneAsync(
  tmuxPath: string,
  sessionName: string,
  paneIndex: number,
  lines: number,
  /** ANSI 이스케이프 시퀀스 포함 여부 (-e 플래그) */
  escape?: boolean
): Promise<string> {
  const args = ['capture-pane', '-t', `${sessionName}.${paneIndex}`, '-p', '-S', `-${lines}`]
  if (escape) args.push('-e')
  return (await execTmuxAsync(tmuxPath, args)) ?? ''
}

/**
 * tmux pane의 전체 스크롤백 + 현재 화면을 ANSI 이스케이프 포함하여 캡처합니다.
 * `-S -` 로 스크롤백 시작점부터 전체를 가져옵니다.
 */
export async function captureFullScrollbackAsync(
  tmuxPath: string,
  sessionName: string,
  paneIndex: number
): Promise<string> {
  return (await execTmuxAsync(tmuxPath, ['capture-pane', '-t', `${sessionName}.${paneIndex}`, '-e', '-p', '-S', '-'])) ?? ''
}

/** getPaneCurrentCommand의 비동기 버전 */
export async function getPaneCurrentCommandAsync(
  tmuxPath: string,
  sessionName: string
): Promise<string | null> {
  return execTmuxAsync(tmuxPath, ['display-message', '-t', `${sessionName}:0.0`, '-p', '#{pane_current_command}'])
}

/** getPaneCommand의 비동기 버전 */
export async function getPaneCommandAsync(tmuxPath: string, paneId: string): Promise<string | null> {
  return execTmuxAsync(tmuxPath, ['display-message', '-t', paneId, '-p', '#{pane_current_command}'])
}

/** resizeTmuxWindow의 비동기 fire-and-forget 버전 */
export async function resizeTmuxWindowAsync(
  tmuxPath: string,
  name: string,
  cols: number,
  rows: number
): Promise<void> {
  await execTmuxAsync(tmuxPath, ['resize-window', '-t', name, '-x', String(cols), '-y', String(rows)])
  try {
    await execFileAsync(tmuxPath, ['-u', 'refresh-client', '-t', name], { timeout: TMUX_EXEC_TIMEOUT })
  } catch { /* 무시 */ }
}
