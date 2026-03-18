/**
 * SessionStore — 세션 메타데이터 영속 저장소
 *
 * `~/.mulaude/sessions.json` 파일을 통해 세션 정보를 디스크에 저장합니다.
 * 앱 종료 후 재시작 시 이전 세션 목록을 복원하는 데 사용됩니다.
 *
 * 저장 항목:
 *   - 세션 ID, 표시 이름, 작업 디렉토리
 *   - tmux 세션명 (tmux 재연결에 필요)
 *   - 생성/마지막 접근 시각
 *
 * 에러 처리:
 *   - 파일이 없거나 손상된 경우 빈 목록으로 초기화
 *   - 쓰기 실패 시 에러를 로깅하되 앱 동작에 영향을 주지 않음
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { SESSION_STORE_SAVE_DEBOUNCE } from '../shared/constants'

/**
 * 영속화되는 세션 정보
 *
 * 런타임 SessionInfo와 달리 tmux 세션명, 타임스탬프 등 영속화에 필요한 필드를 포함합니다.
 */
export interface PersistedSession {
  /** Mulaude 내부 세션 ID (예: "session-1") */
  id: string
  /** 사용자 표시 이름 (예: "세션 1") */
  name: string
  /** 자동 감지된 작업명 (PTY 파싱, hooks 등) */
  subtitle?: string
  /** 세션 작업 디렉토리 절대 경로 */
  workingDir: string
  /** tmux 세션명 (예: "mulaude-session-1") — terminal 모드 전용 */
  tmuxSessionName: string
  /** 세션 최초 생성 시각 (ISO 8601) */
  createdAt: string
  /** 세션 마지막 접근 시각 (ISO 8601) */
  lastAccessedAt: string
  /** 앱 모드: 'terminal' (기본) | 'native' */
  mode?: 'terminal' | 'native'
  /** Claude 세션 ID (--resume에 사용, native 모드 전용) */
  claudeSessionId?: string
}

/**
 * SessionStore — 세션 메타데이터를 `~/.mulaude/sessions.json`에 영속 저장
 *
 * 사용 패턴:
 * ```typescript
 * const store = new SessionStore()
 * store.addSession({ id, name, workingDir, tmuxSessionName, ... })
 * const sessions = store.getAllSessions()
 * store.removeSession('session-1')
 * ```
 */
export class SessionStore {
  /** ~/.mulaude 디렉토리 경로 */
  private dirPath: string
  /** sessions.json 파일 경로 */
  private filePath: string
  /** 메모리 캐시 — 디스크 읽기 최소화 */
  private sessions: PersistedSession[] = []
  /** 디바운스 타이머 */
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    this.dirPath = join(homedir(), '.mulaude')
    this.filePath = join(this.dirPath, 'sessions.json')
    this.load()
  }

  /**
   * 디스크에서 세션 목록을 로드합니다.
   *
   * 파일이 없거나 JSON 파싱에 실패하면 빈 목록으로 초기화합니다.
   */
  load(): void {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8')
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          this.sessions = parsed
          return
        }
        console.warn('[SessionStore] sessions.json is not an array, trying .tmp recovery')
      }
    } catch (err) {
      console.warn('[SessionStore] Failed to load sessions.json, trying .tmp recovery:', err)
    }

    // .tmp 파일에서 복구 시도 (atomic write 중 크래시 시)
    const tmpPath = this.filePath + '.tmp'
    try {
      if (existsSync(tmpPath)) {
        const raw = readFileSync(tmpPath, 'utf-8')
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          this.sessions = parsed
          // 복구 성공 시 .tmp → 본 파일로 승격
          try { renameSync(tmpPath, this.filePath) } catch { /* ignore */ }
          console.warn('[SessionStore] Recovered from .tmp file')
          return
        }
      }
    } catch {
      // .tmp 파일도 실패 → 빈 상태로 시작
    }

    this.sessions = []
  }

  /**
   * 현재 세션 목록을 디스크에 저장합니다 (500ms 디바운스).
   *
   * 빈번한 호출 시 디스크 I/O를 줄이기 위해 디바운싱합니다.
   */
  save(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveImmediate()
    }, SESSION_STORE_SAVE_DEBOUNCE)
  }

  /**
   * 현재 세션 목록을 즉시 디스크에 저장합니다 (앱 종료 시 사용).
   *
   * ~/.mulaude 디렉토리가 없으면 자동 생성합니다.
   * 쓰기 실패 시 에러를 로깅하되 예외를 던지지 않습니다.
   */
  saveImmediate(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    try {
      if (!existsSync(this.dirPath)) {
        mkdirSync(this.dirPath, { recursive: true })
      }
      // Atomic write: .tmp에 먼저 쓰고 renameSync로 교체 (POSIX atomic rename)
      const tmpPath = this.filePath + '.tmp'
      writeFileSync(tmpPath, JSON.stringify(this.sessions, null, 2), 'utf-8')
      renameSync(tmpPath, this.filePath)
    } catch (err) {
      console.error('[SessionStore] Failed to save sessions.json:', err)
    }
  }

  /**
   * 새 세션을 저장소에 추가합니다.
   *
   * @param session - 영속화할 세션 정보
   */
  addSession(session: PersistedSession): void {
    // 중복 방지
    this.sessions = this.sessions.filter((s) => s.id !== session.id)
    this.sessions.push(session)
    this.save()
  }

  /**
   * 세션을 저장소에서 제거합니다.
   *
   * @param id - 제거할 세션 ID
   */
  removeSession(id: string): void {
    this.sessions = this.sessions.filter((s) => s.id !== id)
    this.save()
  }

  /**
   * 세션의 표시 이름을 갱신합니다.
   *
   * Claude 프롬프트에서 세션명이 감지되면 호출됩니다.
   *
   * @param id - 세션 ID
   * @param name - 새 표시 이름
   */
  updateSessionName(id: string, name: string): void {
    const session = this.sessions.find((s) => s.id === id)
    if (session) {
      session.name = name
      session.lastAccessedAt = new Date().toISOString()
      this.save()
    }
  }

  /**
   * 세션의 자동 감지 부제목(subtitle)을 갱신합니다.
   *
   * PTY 파싱이나 hooks에서 감지된 작업명을 subtitle로 저장합니다.
   *
   * @param id - 세션 ID
   * @param subtitle - 자동 감지된 작업명
   */
  updateSessionSubtitle(id: string, subtitle: string): void {
    const session = this.sessions.find((s) => s.id === id)
    if (session) {
      session.subtitle = subtitle
      session.lastAccessedAt = new Date().toISOString()
      this.save()
    }
  }

  /**
   * 세션의 Claude 세션 ID를 갱신합니다.
   *
   * hooks에서 감지한 Claude session_id를 저장하여
   * 재부팅 후 `claude --resume <id>`로 대화를 이어갈 수 있게 합니다.
   *
   * @param id - Mulaude 세션 ID
   * @param claudeSessionId - Claude Code 세션 ID
   */
  updateClaudeSessionId(id: string, claudeSessionId: string): void {
    const session = this.sessions.find((s) => s.id === id)
    if (session && session.claudeSessionId !== claudeSessionId) {
      session.claudeSessionId = claudeSessionId
      this.save()
    }
  }

  /**
   * 세션의 마지막 접근 시각을 갱신합니다.
   *
   * @param id - 세션 ID
   */
  touchSession(id: string): void {
    const session = this.sessions.find((s) => s.id === id)
    if (session) {
      session.lastAccessedAt = new Date().toISOString()
      this.save()
    }
  }

  /**
   * 저장된 모든 세션 목록을 반환합니다.
   *
   * @returns 영속화된 세션 배열 (마지막 접근 시각 역순)
   */
  getAllSessions(): PersistedSession[] {
    return [...this.sessions]
  }
}
