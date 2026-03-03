/**
 * SessionManager — node-pty + tmux 기반 Claude CLI 세션 관리자
 *
 * tmux가 설치된 환경에서는 tmux 세션을 통해 Claude CLI를 실행합니다:
 *   - 앱 종료 시에도 tmux 세션이 백그라운드에서 유지됨
 *   - 앱 재시작 시 기존 tmux 세션에 재연결하여 이전 출력 복원
 *   - tmux가 스크롤백 버퍼를 관리하므로 재연결 시 이전 출력이 자동 복원됨
 *
 * tmux가 없는 환경에서는 기존 로직(직접 PTY 실행)으로 폴백합니다.
 *
 * 세션 라이프사이클:
 *   createSession()  → tmux 세션 생성 + PTY attach + 메타데이터 저장
 *   reattachSession() → 기존 tmux 세션에 PTY 재연결
 *   destroySession()  → PTY kill + tmux kill + 메타데이터 제거
 *   detachAll()        → PTY만 kill (앱 종료 시, tmux 세션은 보존)
 */

import * as pty from 'node-pty'
import { basename } from 'path'
import type { SessionInfo, TmuxPaneInfo } from '../shared/types'
import { DEFAULT_COLS, DEFAULT_ROWS, LEGACY_SHELL_INIT_DELAY, PANE_CAPTURE_LINES } from '../shared/constants'
import { getShellEnv, findClaudePath } from './env-resolver'
import { SessionStore, type PersistedSession } from './session-store'
import {
  execTmux,
  findTmuxPath,
  getTmuxVersion,
  isTmuxSessionAlive,
  createTmuxSession,
  killTmuxSession,
  sendKeysToTmux,
  resizeTmuxWindowAsync,
  updateTmuxEnvironment,
  unsetTmuxEnvironment,
  toTmuxSessionName,
  listTmuxPanesAsync,
  captureTmuxPaneAsync,
  captureFullScrollbackAsync,
  setAutoBreakPaneHook,
  scrollTmuxPaneAsync
} from './tmux-utils'
import { ChildPaneStreamer } from './child-pane-streamer'
import { cleanupAgentState } from './agent-matcher'

/**
 * 관리 중인 세션의 내부 표현
 *
 * tmux 모드에서는 ptyProcess가 `tmux attach-session`을 실행하는 프로세스를 가리킵니다.
 * legacy 모드에서는 직접 실행된 셸 프로세스를 가리킵니다.
 */
interface ManagedSession {
  id: string
  name: string
  workingDir: string
  ptyProcess: pty.IPty
  /** tmux 세션명 (tmux 모드에서만 존재) */
  tmuxSessionName?: string
}

type DataCallback = (id: string, data: string) => void
type ExitCallback = (id: string, exitCode: number) => void

/**
 * SessionManager - node-pty + tmux 기반 Claude CLI 세션 관리자
 *
 * tmux 모드 (tmux 설치됨):
 *   1. tmux new-session -d → 백그라운드 세션 생성
 *   2. tmux send-keys 'unset CLAUDECODE CLAUDE_CODE; claude' → 중첩 방지 + CLI 실행
 *   3. pty.spawn(tmux, ['attach-session']) → PTY로 attach
 *   4. 앱 종료 시: PTY만 kill, tmux 세션은 보존
 *   5. 앱 재시작 시: 살아있는 tmux 세션에 reattach
 *
 * legacy 모드 (tmux 미설치):
 *   기존과 동일 — pty.spawn(shell) + claude 명령 실행
 */
export class SessionManager {
  private sessions: Map<string, ManagedSession> = new Map()
  private nextId = 1
  private dataCallbacks: DataCallback[] = []
  private exitCallbacks: ExitCallback[] = []
  private shellEnv: Record<string, string>
  private claudePath: string
  /** Mulaude hooks IPC 디렉토리 (HooksManager에서 설정) */
  private ipcDir = ''

  /** tmux 실행 파일 경로 (null이면 legacy 모드) */
  private tmuxPath: string | null
  /** 세션 영속 저장소 */
  private sessionStore: SessionStore
  /** 자식 pane 스트리밍 관리자 */
  private childPaneStreamer: ChildPaneStreamer | null = null

  constructor() {
    this.shellEnv = getShellEnv()
    this.claudePath = findClaudePath(this.shellEnv)
    this.tmuxPath = findTmuxPath(this.shellEnv)
    this.sessionStore = new SessionStore()

    console.log('[SessionManager] claude path:', this.claudePath)
    if (this.tmuxPath) {
      const version = getTmuxVersion(this.tmuxPath)
      console.log(`[SessionManager] tmux found: ${this.tmuxPath} (${version})`)
      this.childPaneStreamer = new ChildPaneStreamer(this.tmuxPath)
    } else {
      console.log('[SessionManager] tmux not found, using legacy mode')
    }
  }

  /** hooks IPC 디렉토리 설정 (세션 환경변수에 전달됨) */
  setIpcDir(dir: string): void {
    this.ipcDir = dir
  }

  /** tmux 사용 가능 여부 및 버전 반환 */
  checkTmux(): { available: boolean; version: string | null } {
    if (!this.tmuxPath) return { available: false, version: null }
    const version = getTmuxVersion(this.tmuxPath)
    return { available: true, version }
  }

  /** 세션 영속 저장소 접근자 */
  getSessionStore(): SessionStore {
    return this.sessionStore
  }

  /** tmux 경로 접근자 */
  getTmuxPath(): string | null {
    return this.tmuxPath
  }

  /** 자식 pane 스트리머 접근자 */
  getChildPaneStreamer(): ChildPaneStreamer | null {
    return this.childPaneStreamer
  }

  /**
   * 새 Claude CLI 세션을 생성합니다.
   *
   * tmux 모드:
   *   1. tmux new-session -d → 백그라운드 세션 생성
   *   2. tmux send-keys → claude CLI 실행
   *   3. pty.spawn(tmux, ['attach-session']) → PTY로 attach
   *   4. sessionStore에 메타데이터 저장
   *
   * legacy 모드:
   *   기존 방식 — pty.spawn(shell) + setTimeout → claude 실행
   *
   * @param workingDir - claude CLI를 실행할 작업 디렉토리
   * @returns 생성된 세션 정보
   */
  createSession(workingDir: string): SessionInfo {
    const id = `session-${this.nextId++}`
    const name = basename(workingDir)
    const now = new Date().toISOString()

    console.log(`[SessionManager] creating session ${id} in ${workingDir}`)

    // CLAUDECODE 환경변수를 제거해야 중첩 세션 에러가 발생하지 않음
    const cleanEnv = { ...this.shellEnv }
    delete cleanEnv['CLAUDECODE']
    delete cleanEnv['CLAUDE_CODE']

    if (this.tmuxPath) {
      return this.createTmuxSession(id, name, workingDir, cleanEnv, now)
    } else {
      return this.createLegacySession(id, name, workingDir, cleanEnv)
    }
  }

  /**
   * tmux 모드 세션 생성
   */
  private createTmuxSession(
    id: string,
    name: string,
    workingDir: string,
    cleanEnv: Record<string, string>,
    now: string
  ): SessionInfo {
    const tmuxPath = this.tmuxPath!
    const tmuxName = toTmuxSessionName(id)

    // 1) tmux 백그라운드 세션 생성
    const envVars: Record<string, string> = {
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      LANG: cleanEnv['LANG'] || 'en_US.UTF-8',
      LC_ALL: cleanEnv['LC_ALL'] || cleanEnv['LANG'] || 'en_US.UTF-8'
    }
    if (this.ipcDir) {
      envVars['MULAUDE_SESSION_ID'] = id
      envVars['MULAUDE_IPC_DIR'] = this.ipcDir
    }

    try {
      createTmuxSession(tmuxPath, tmuxName, workingDir, DEFAULT_COLS, DEFAULT_ROWS, envVars)
    } catch (err) {
      console.error(`[SessionManager] tmux session creation failed:`, err)
      throw err
    }

    // 1.5) auto-break hook 설정: 자식 pane 생성 시 즉시 별도 window로 분리
    setAutoBreakPaneHook(tmuxPath, tmuxName)

    // 2) tmux 세션 안에서 중첩 방지 unset + 환경변수 export + claude 실행
    //    tmux set-environment는 새 pane에만 적용되므로,
    //    초기 셸에는 send-keys로 직접 export해야 합니다.
    try {
      const unsetNested = 'unset CLAUDECODE CLAUDE_CODE; '
      const envExport = this.ipcDir
        ? `export MULAUDE_SESSION_ID='${id}' MULAUDE_IPC_DIR='${this.ipcDir}'; `
        : ''
      sendKeysToTmux(tmuxPath, tmuxName, unsetNested + envExport + this.claudePath)
    } catch (err) {
      console.error(`[SessionManager] tmux send-keys failed:`, err)
      killTmuxSession(tmuxPath, tmuxName)
      throw err
    }

    // 3) PTY로 tmux 세션에 attach
    let ptyProcess: pty.IPty
    try {
      ptyProcess = pty.spawn(tmuxPath, ['-u', 'attach-session', '-t', tmuxName], {
        name: 'xterm-256color',
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        cwd: workingDir,
        env: { ...cleanEnv, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
      })
      console.log(`[SessionManager] PTY attached to tmux ${tmuxName}, pid: ${ptyProcess.pid}`)
    } catch (err) {
      console.error(`[SessionManager] PTY attach failed:`, err)
      killTmuxSession(tmuxPath, tmuxName)
      throw err
    }

    const session: ManagedSession = { id, name, workingDir, ptyProcess, tmuxSessionName: tmuxName }
    this.sessions.set(id, session)
    this.bindPtyEvents(id, ptyProcess)

    // 4) 메타데이터 영속화
    this.sessionStore.addSession({
      id,
      name,
      workingDir,
      tmuxSessionName: tmuxName,
      createdAt: now,
      lastAccessedAt: now
    })

    return { id, name, workingDir, tmuxSessionName: tmuxName, createdAt: now }
  }

  /**
   * legacy 모드 세션 생성 (tmux 미설치 시)
   */
  private createLegacySession(
    id: string,
    name: string,
    workingDir: string,
    cleanEnv: Record<string, string>
  ): SessionInfo {
    const shell = process.env.SHELL || '/bin/zsh'

    let ptyProcess: pty.IPty
    try {
      ptyProcess = pty.spawn(shell, ['-l'], {
        name: 'xterm-256color',
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        cwd: workingDir,
        env: {
          ...cleanEnv,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
          ...(this.ipcDir ? { MULAUDE_SESSION_ID: id, MULAUDE_IPC_DIR: this.ipcDir } : {})
        }
      })
      console.log(`[SessionManager] PTY spawned (legacy), pid: ${ptyProcess.pid}`)

      // 셸 초기화 후 claude 실행 (전체 경로 사용)
      setTimeout(() => {
        ptyProcess.write(this.claudePath + '\r')
      }, LEGACY_SHELL_INIT_DELAY)
    } catch (err) {
      console.error(`[SessionManager] PTY spawn failed:`, err)
      throw err
    }

    const session: ManagedSession = { id, name, workingDir, ptyProcess }
    this.sessions.set(id, session)
    this.bindPtyEvents(id, ptyProcess)

    return { id, name, workingDir }
  }

  /**
   * 저장된 세션에 다시 연결합니다 (앱 재시작 시 호출).
   *
   * 동작 순서:
   *   1. tmux 세션이 살아있는지 확인 → 죽었으면 메타데이터 정리 후 null 반환
   *   2. tmux set-environment -u → CLAUDECODE/CLAUDE_CODE 제거 (중첩 세션 방지)
   *   3. tmux set-environment → MULAUDE_IPC_DIR 갱신 (새 앱 PID에 맞게)
   *   4. pty.spawn(tmux, ['attach-session']) → PTY attach
   *   5. 이벤트 바인딩 (onData, onExit)
   *
   * @param persisted - 영속 저장소에서 로드된 세션 정보
   * @returns 복원된 세션 정보 또는 null (tmux 세션이 죽은 경우)
   */
  reattachSession(persisted: PersistedSession): SessionInfo | null {
    if (!this.tmuxPath) return null

    const tmuxPath = this.tmuxPath

    // 1) tmux 세션 생존 확인
    if (!isTmuxSessionAlive(tmuxPath, persisted.tmuxSessionName)) {
      console.log(`[SessionManager] tmux session ${persisted.tmuxSessionName} is dead, skipping`)
      this.sessionStore.removeSession(persisted.id)
      return null
    }

    // 2) 중첩 세션 방지: CLAUDECODE 환경변수 제거
    unsetTmuxEnvironment(tmuxPath, persisted.tmuxSessionName, ['CLAUDECODE', 'CLAUDE_CODE'])

    // 3) MULAUDE_IPC_DIR 갱신 (새 앱 인스턴스의 IPC 디렉토리)
    if (this.ipcDir) {
      updateTmuxEnvironment(tmuxPath, persisted.tmuxSessionName, {
        MULAUDE_SESSION_ID: persisted.id,
        MULAUDE_IPC_DIR: this.ipcDir
      })
    }

    // extended-keys 보장 (이전 버전에서 생성된 세션에도 적용)
    execTmux(tmuxPath, ['set-option', '-t', persisted.tmuxSessionName, 'extended-keys', 'on'])

    // nextId 갱신 (복원 세션 ID와 충돌 방지)
    const match = persisted.id.match(/session-(\d+)/)
    if (match) {
      const num = parseInt(match[1], 10)
      if (num >= this.nextId) {
        this.nextId = num + 1
      }
    }

    // 4) PTY로 tmux 세션에 attach
    const cleanEnv = { ...this.shellEnv }
    delete cleanEnv['CLAUDECODE']
    delete cleanEnv['CLAUDE_CODE']

    let ptyProcess: pty.IPty
    try {
      ptyProcess = pty.spawn(tmuxPath, ['-u', 'attach-session', '-d', '-t', persisted.tmuxSessionName], {
        name: 'xterm-256color',
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        cwd: persisted.workingDir,
        env: { ...cleanEnv, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
      })
      console.log(
        `[SessionManager] reattached to tmux ${persisted.tmuxSessionName}, pid: ${ptyProcess.pid}`
      )
    } catch (err) {
      console.error(`[SessionManager] reattach failed for ${persisted.tmuxSessionName}:`, err)
      this.sessionStore.removeSession(persisted.id)
      return null
    }

    // 5) 이벤트 바인딩
    const session: ManagedSession = {
      id: persisted.id,
      name: persisted.name,
      workingDir: persisted.workingDir,
      ptyProcess,
      tmuxSessionName: persisted.tmuxSessionName
    }
    this.sessions.set(persisted.id, session)
    this.bindPtyEvents(persisted.id, ptyProcess)

    // auto-break hook 설정 (복원 세션에서도 자식 pane 생성 시 별도 window로 분리)
    setAutoBreakPaneHook(tmuxPath, persisted.tmuxSessionName)

    // 마지막 접근 시각 갱신
    this.sessionStore.touchSession(persisted.id)

    return {
      id: persisted.id,
      name: persisted.name,
      workingDir: persisted.workingDir,
      tmuxSessionName: persisted.tmuxSessionName,
      createdAt: persisted.createdAt,
      restored: true
    }
  }

  /**
   * 저장된 모든 세션 복원을 시도합니다.
   *
   * @returns 성공적으로 복원된 세션 목록
   */
  restoreAllSessions(): SessionInfo[] {
    const persisted = this.sessionStore.getAllSessions()
    const restored: SessionInfo[] = []

    for (const p of persisted) {
      const session = this.reattachSession(p)
      if (session) {
        restored.push(session)
      }
    }

    console.log(
      `[SessionManager] restored ${restored.length}/${persisted.length} sessions`
    )
    return restored
  }

  /**
   * 특정 세션을 완전히 종료합니다.
   *
   * tmux 모드: PTY kill + tmux kill-session + 메타데이터 제거
   * legacy 모드: PTY kill
   */
  destroySession(id: string): void {
    const session = this.sessions.get(id)
    if (session) {
      // PTY 종료
      try {
        session.ptyProcess.kill()
      } catch {
        // 이미 종료된 프로세스 무시
      }

      // tmux 세션 종료
      if (session.tmuxSessionName && this.tmuxPath) {
        killTmuxSession(this.tmuxPath, session.tmuxSessionName)
      }

      // 자식 pane 스트리밍 정리
      this.childPaneStreamer?.cleanupSession(id)

      // 에이전트 상태 + team config 정리
      cleanupAgentState(id)

      // 메타데이터 제거
      this.sessionStore.removeSession(id)

      this.sessions.delete(id)
    }
  }

  /**
   * 모든 세션을 완전히 종료합니다 (legacy 모드 앱 종료 시).
   *
   * tmux 세션도 함께 kill합니다.
   */
  destroyAll(): void {
    for (const [id] of this.sessions) {
      this.destroySession(id)
    }
  }

  /**
   * 모든 PTY만 종료합니다 (tmux 모드 앱 종료 시).
   *
   * tmux 세션은 백그라운드에서 유지되므로 앱 재시작 시 reattach 가능합니다.
   * `destroyAll()`과의 차이: tmux kill-session을 호출하지 않음.
   */
  detachAll(): void {
    this.childPaneStreamer?.cleanupAll()
    for (const [, session] of this.sessions) {
      try {
        session.ptyProcess.kill()
      } catch {
        // 이미 종료된 프로세스 무시
      }
    }
    this.sessions.clear()
  }

  /**
   * 현재 활성 세션 목록을 반환합니다.
   */
  getSessionList(): SessionInfo[] {
    return Array.from(this.sessions.values()).map(
      ({ id, name, workingDir, tmuxSessionName }) => ({
        id,
        name,
        workingDir,
        tmuxSessionName
      })
    )
  }

  /**
   * 특정 세션의 에이전트 pane 내용을 캡처합니다.
   *
   * pane이 2개 이상인 경우 (pane 0 = 메인, 나머지 = 에이전트),
   * 각 에이전트 pane의 마지막 8줄을 캡처하여 반환합니다.
   *
   * @param id - 세션 ID
   * @returns 에이전트 pane 정보 배열 (메인 pane 제외). 에이전트 pane이 없으면 빈 배열
   */
  async getSessionPaneContents(id: string): Promise<TmuxPaneInfo[]> {
    if (!this.tmuxPath) return []

    const session = this.sessions.get(id)
    if (!session?.tmuxSessionName) return []

    const panes = await listTmuxPanesAsync(this.tmuxPath, session.tmuxSessionName)
    // pane 0 = 메인, 1+ = 에이전트. 에이전트 pane이 없으면 빈 배열
    if (panes.length < 2) return []

    const tmuxPath = this.tmuxPath
    const tmuxName = session.tmuxSessionName
    const result = await Promise.all(
      panes
        .filter((pane) => pane.index !== 0)
        .map(async (pane) => {
          const content = await captureTmuxPaneAsync(tmuxPath, tmuxName, pane.index, PANE_CAPTURE_LINES)
          return { index: pane.index, title: pane.title, content } as TmuxPaneInfo
        })
    )
    return result
  }

  /**
   * 세션의 현재 tmux 화면을 ANSI 이스케이프 포함하여 캡처합니다.
   * 세션 전환 시 xterm 재생성 후 즉시 화면을 복원하는 데 사용합니다.
   *
   * cols/rows가 제공되면 캡처 전에 tmux resize를 await하여
   * resize+capture를 원자적으로 실행합니다 (타이밍 레이스 방지).
   *
   * @param id - 세션 ID
   * @param cols - 리사이즈할 열 수 (선택)
   * @param rows - 리사이즈할 행 수 (선택)
   * @returns ANSI 포함 화면 문자열 또는 null
   */
  async captureScreen(id: string, cols?: number, rows?: number): Promise<string | null> {
    if (!this.tmuxPath) return null
    const session = this.sessions.get(id)
    if (!session?.tmuxSessionName) return null
    // cols/rows가 제공되면 tmux resize를 먼저 await (atomic resize+capture)
    if (cols !== undefined && rows !== undefined) {
      console.log(`[captureScreen] ${id}: resize ${cols}x${rows} before capture`)
      await resizeTmuxWindowAsync(this.tmuxPath, session.tmuxSessionName, cols, rows)
    }
    const result = await captureFullScrollbackAsync(this.tmuxPath, session.tmuxSessionName, 0)
    console.log(`[captureScreen] ${id}: captured ${result ? `${result.length} chars` : 'NULL'}`)
    return result
  }

  /**
   * 특정 세션의 터미널에 입력을 전송합니다.
   */
  write(id: string, data: string): void {
    const session = this.sessions.get(id)
    if (session) {
      session.ptyProcess.write(data)
    }
  }

  /**
   * 특정 세션의 터미널 크기를 변경합니다.
   *
   * tmux 모드에서는 PTY 리사이즈 + tmux resize-window를 함께 호출합니다.
   * tmux 내부 윈도우 크기도 맞춰야 레이아웃이 정상 반영됩니다.
   */
  resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id)
    if (session) {
      try {
        session.ptyProcess.resize(cols, rows)
      } catch {
        // 리사이즈 에러 무시
      }

      // tmux 내부 윈도우도 리사이즈 (fire-and-forget 비동기)
      if (session.tmuxSessionName && this.tmuxPath) {
        resizeTmuxWindowAsync(this.tmuxPath, session.tmuxSessionName, cols, rows).catch(() => {})
      }
    }
  }

  /**
   * tmux copy-mode 스크롤 (1줄 단위, fire-and-forget).
   */
  scroll(id: string, direction: 'up' | 'down', lines = 1): void {
    if (!this.tmuxPath) return
    const session = this.sessions.get(id)
    if (!session?.tmuxSessionName) return
    scrollTmuxPaneAsync(this.tmuxPath, session.tmuxSessionName, direction, lines).catch(() => {})
  }

  /**
   * 모든 세션의 데이터 이벤트를 수신합니다.
   */
  onAnyData(callback: DataCallback): void {
    this.dataCallbacks.push(callback)
  }

  /**
   * 모든 세션의 종료 이벤트를 수신합니다.
   */
  onAnyExit(callback: ExitCallback): void {
    this.exitCallbacks.push(callback)
  }

  /**
   * PTY 프로세스에 데이터/종료 이벤트 콜백을 바인딩합니다.
   */
  private bindPtyEvents(id: string, ptyProcess: pty.IPty): void {
    ptyProcess.onData((data: string) => {
      for (const cb of this.dataCallbacks) {
        cb(id, data)
      }
    })

    ptyProcess.onExit(({ exitCode }) => {
      for (const cb of this.exitCallbacks) {
        cb(id, exitCode)
      }
    })
  }
}
