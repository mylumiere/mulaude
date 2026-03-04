/**
 * NativeChatManager — Native Chat 모드 세션 관리자 (per-turn 방식)
 *
 * 턴마다 `claude -p "text" --output-format stream-json --verbose` 프로세스를 spawn합니다.
 * 세션 연속성은 `--resume <claudeSessionId>`로 유지합니다.
 *
 * 제한사항:
 *   - `-p` 모드는 non-interactive → AskUserQuestion/Permission 미지원
 *   - `--input-format stream-json`은 pipe stdout 버퍼링 이슈로 사용 불가
 *   - PTY에서는 stream-json 플래그가 무시됨
 *
 * 환경 변수:
 *   - CLAUDECODE, CLAUDE_CODE 제거 (중첩 세션 감지 방지)
 *   - MULAUDE_SESSION_ID, MULAUDE_IPC_DIR 추가 (hooks 연동)
 */

import { spawn, ChildProcess } from 'child_process'
import { basename } from 'path'
import { existsSync, statSync } from 'fs'
import { SessionStore } from './session-store'
import { NdjsonParser } from './ndjson-parser'
import { getShellEnv, findClaudePath } from './env-resolver'
import type { SessionInfo, NativeInputRequest } from '../shared/types'

/** 런타임 네이티브 세션 상태 */
interface NativeSession {
  id: string
  name: string
  workingDir: string
  claudeSessionId?: string
  /** 현재 턴의 프로세스 */
  process?: ChildProcess
  /** 현재 턴 진행 중 여부 */
  isBusy: boolean
  /** 사용자 취소 요청 여부 */
  isCancelling: boolean
}

type StreamEventCallback = (sessionId: string, event: Record<string, unknown>) => void
type TurnCompleteCallback = (sessionId: string, claudeSessionId: string) => void
type TurnErrorCallback = (sessionId: string, error: string) => void
type InputRequestCallback = (sessionId: string, request: NativeInputRequest) => void

export class NativeChatManager {
  private sessions = new Map<string, NativeSession>()
  private nextId = 1
  private sessionStore: SessionStore
  private shellEnv: Record<string, string>
  private claudePath: string
  private ipcDir: string
  /** 메시지 큐 (isBusy 중 전송 시 대기) */
  private messageQueue = new Map<string, string>()

  public onStreamEvent: StreamEventCallback = () => {}
  public onTurnComplete: TurnCompleteCallback = () => {}
  public onTurnError: TurnErrorCallback = () => {}
  public onInputRequest: InputRequestCallback = () => {}

  constructor(ipcDir: string) {
    this.ipcDir = ipcDir
    this.shellEnv = getShellEnv()
    this.claudePath = findClaudePath(this.shellEnv)
    this.sessionStore = new SessionStore()
    console.log('[NativeChatManager] claude path:', this.claudePath)
  }

  getSessionStore(): SessionStore {
    return this.sessionStore
  }

  createSession(workingDir: string): SessionInfo {
    // workingDir 유효성 검증
    if (!existsSync(workingDir) || !statSync(workingDir).isDirectory()) {
      throw new Error(`Invalid working directory: "${workingDir}" does not exist or is not a directory`)
    }

    const id = `session-${this.nextId++}`
    const name = basename(workingDir)
    const now = new Date().toISOString()

    const session: NativeSession = { id, name, workingDir, isBusy: false, isCancelling: false }
    this.sessions.set(id, session)

    this.sessionStore.addSession({
      id, name, workingDir,
      tmuxSessionName: '',
      createdAt: now,
      lastAccessedAt: now,
      mode: 'native'
    })

    console.log(`[NativeChatManager] created session ${id} in ${workingDir}`)
    return { id, name, workingDir, createdAt: now }
  }

  destroySession(id: string): void {
    const session = this.sessions.get(id)
    if (session) {
      this.killProcess(session)
      this.messageQueue.delete(id)
      this.sessionStore.removeSession(id)
      this.sessions.delete(id)
      console.log(`[NativeChatManager] destroyed session ${id}`)
    }
  }

  getSessionList(): SessionInfo[] {
    return Array.from(this.sessions.values()).map(({ id, name, workingDir }) => ({
      id, name, workingDir
    }))
  }

  restoreAllSessions(): SessionInfo[] {
    const persisted = this.sessionStore.getAllSessions()
    const restored: SessionInfo[] = []
    for (const p of persisted) {
      if (p.mode !== 'native') continue
      const match = p.id.match(/session-(\d+)/)
      if (match) {
        const num = parseInt(match[1], 10)
        if (num >= this.nextId) this.nextId = num + 1
      }
      const session: NativeSession = {
        id: p.id, name: p.name, workingDir: p.workingDir,
        claudeSessionId: p.claudeSessionId,
        isBusy: false, isCancelling: false
      }
      this.sessions.set(p.id, session)
      restored.push({
        id: p.id, name: p.name, workingDir: p.workingDir,
        createdAt: p.createdAt, restored: true
      })
    }
    console.log(`[NativeChatManager] restored ${restored.length}/${persisted.length} native sessions`)
    return restored
  }

  /**
   * 메시지를 전송합니다.
   * 턴마다 새 프로세스를 spawn합니다.
   */
  sendMessage(sessionId: string, text: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    if (session.isBusy) {
      this.messageQueue.set(sessionId, text)
      console.log(`[NativeChatManager] queued message for ${sessionId}`)
      return
    }

    this.spawnTurn(session, text)
  }

  /**
   * 턴 프로세스를 spawn합니다.
   */
  private spawnTurn(session: NativeSession, text: string): void {
    this.killProcess(session)

    const env: Record<string, string> = { ...this.shellEnv }
    delete env['CLAUDECODE']
    delete env['CLAUDE_CODE']
    if (this.ipcDir) {
      env['MULAUDE_SESSION_ID'] = session.id
      env['MULAUDE_IPC_DIR'] = this.ipcDir
    }

    const args = ['-p', text, '--output-format', 'stream-json', '--verbose']
    if (session.claudeSessionId) {
      args.push('--resume', session.claudeSessionId)
    }

    console.log(`[NativeChatManager] spawning turn for ${session.id}, resume: ${session.claudeSessionId || 'none'}, text: ${text.slice(0, 80)}`)

    let child: ChildProcess
    try {
      child = spawn(this.claudePath, args, {
        cwd: session.workingDir, env,
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (err) {
      console.error(`[NativeChatManager] spawn failed:`, err)
      this.onTurnError(session.id, `Failed to start claude: ${err}`)
      return
    }

    session.process = child
    session.isBusy = true
    session.isCancelling = false

    // -p 모드: stdin 즉시 닫기
    child.stdin?.end()

    // stdout → NdjsonParser
    const parser = new NdjsonParser()
    child.stdout?.pipe(parser)

    parser.on('data', (event: Record<string, unknown>) => {
      const type = event.type as string
      console.log(`[NativeChatManager] stream event: ${type}`)

      this.onStreamEvent(session.id, event)

      if (type === 'result') {
        const sid = event.session_id as string | undefined
        if (sid) {
          session.claudeSessionId = sid
          this.persistClaudeSessionId(session.id, sid)
        }
      }
    })

    // stderr
    let stderrData = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrData += chunk.toString()
    })

    // 프로세스 종료 = 턴 완료
    child.on('close', (code) => {
      const wasBusy = session.isBusy
      const wasCancelling = session.isCancelling
      session.process = undefined
      session.isBusy = false
      session.isCancelling = false

      console.log(`[NativeChatManager] turn ended for ${session.id}, code: ${code}, cancelled: ${wasCancelling}`)

      if (wasCancelling) {
        // 사용자 취소
      } else if (code !== 0 && wasBusy) {
        this.onTurnError(session.id, stderrData || `Process exited with code ${code}`)
      } else {
        this.onTurnComplete(session.id, session.claudeSessionId || '')
      }

      this.processQueue(session.id)
    })

    child.on('error', (err) => {
      session.process = undefined
      session.isBusy = false
      session.isCancelling = false
      this.onTurnError(session.id, err.message)
      this.processQueue(session.id)
    })
  }

  /**
   * Permission/Question 응답 (per-turn 모드에서는 미지원)
   */
  respondToPrompt(sessionId: string, _requestId: string, _response: Record<string, unknown>): void {
    console.warn(`[NativeChatManager] respondToPrompt not supported in per-turn mode (${sessionId})`)
  }

  cancelMessage(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session?.process) return
    session.isCancelling = true
    this.killProcess(session)
  }

  /** 큐 메시지 텍스트 업데이트 */
  updateQueue(sessionId: string, text: string): void {
    if (this.messageQueue.has(sessionId)) {
      this.messageQueue.set(sessionId, text)
    }
  }

  /** 큐 메시지 삭제 */
  clearQueue(sessionId: string): void {
    this.messageQueue.delete(sessionId)
  }

  destroyAll(): void {
    for (const [id] of this.sessions) {
      this.destroySession(id)
    }
  }

  private killProcess(session: NativeSession): void {
    if (session.process) {
      try { session.process.kill('SIGTERM') } catch (err) {
        console.warn(`[NativeChatManager] killProcess failed for ${session.id}:`, (err as Error).message)
      }
      session.process = undefined
    }
  }

  private persistClaudeSessionId(sessionId: string, claudeSessionId: string): void {
    const persisted = this.sessionStore.getAllSessions().find(s => s.id === sessionId)
    if (persisted) {
      persisted.claudeSessionId = claudeSessionId
      this.sessionStore.save()
    }
  }

  private processQueue(sessionId: string): void {
    const queued = this.messageQueue.get(sessionId)
    if (!queued) return
    this.messageQueue.delete(sessionId)
    const session = this.sessions.get(sessionId)
    if (session) {
      console.log(`[NativeChatManager] processing queued message for ${sessionId}`)
      setTimeout(() => this.sendMessage(sessionId, queued), 100)
    }
  }
}
