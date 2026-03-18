/**
 * CowrkManager — 영속 AI 팀원 오케스트레이터
 *
 * cowrk의 conversation + memory-manager + context-builder + project-resolver를 통합합니다.
 * NativeChatManager의 spawnTurn 패턴을 따릅니다:
 *   - env에서 CLAUDECODE 제거
 *   - `claude -p --output-format stream-json` subprocess
 *   - NdjsonParser로 stdout 파싱
 *
 * 데이터 흐름:
 *   askAgent() → persona/memory/project 로드 → systemPrompt 구축
 *   → claude -p spawn → NdjsonParser → onStreamChunk/onTurnComplete/onTurnError
 *   → history 추가 + stats 업데이트 + fire-and-forget 메모리 갱신
 */

import { spawn, type ChildProcess } from 'child_process'
import { readdir, readFile, stat, writeFile, unlink } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'
import { homedir } from 'node:os'
import { NdjsonParser } from './ndjson-parser'
import { getShellEnv, findClaudePath } from './env-resolver'
import { logger } from './logger'
import * as agentManager from './cowrk/agent-manager'
import { loadRegistry } from './cowrk/agent-store'
import { agentFiles, DEFAULTS } from './cowrk/constants'
import { readLines, appendLine, writeText } from './cowrk/file-utils'
import type { CowrkAgentState } from '../shared/types'
import type { HistoryEntry, ProjectContext } from './cowrk/types'

/** 디렉토리 트리 생성 시 건너뛸 폴더 */
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  '.output', '__pycache__', '.venv', 'venv', '.cache', 'coverage',
  '.turbo', '.vercel', '.svelte-kit',
])

/** 메모리 갱신용 시스템 프롬프트 */
const MEMORY_SYSTEM_PROMPT = `You are a memory manager. Given the current memory and a new conversation, produce an updated memory document.
Keep it concise, organized by date and topics.
Preserve important persistent notes.
Write in the same language the user used.
Output ONLY the updated memory content — no explanations or markdown fences.`

export class CowrkManager {
  private shellEnv: Record<string, string>
  private claudePath: string
  /** agentName → 활성 프로세스 */
  private activeProcesses = new Map<string, ChildProcess>()

  /** 스트림 텍스트 청크 콜백 (index.ts에서 IPC 연결) */
  onStreamChunk: (agentName: string, chunk: string) => void = () => {}
  /** 턴 완료 콜백 */
  onTurnComplete: (agentName: string, response: string) => void = () => {}
  /** 턴 에러 콜백 */
  onTurnError: (agentName: string, error: string) => void = () => {}

  constructor() {
    this.shellEnv = getShellEnv()
    this.claudePath = findClaudePath(this.shellEnv)
    logger.info('CowrkManager', `claude path: ${this.claudePath}`)
  }

  /* ═══════ CRUD ═══════ */

  async listAgents(): Promise<CowrkAgentState[]> {
    const registry = await loadRegistry()
    return Promise.all(registry.agents.map(async a => {
      const files = agentFiles(a.name)
      let avatarPath: string | undefined
      try {
        await stat(files.avatar)
        avatarPath = files.avatar
      } catch {
        // avatar 파일 없음
      }
      return {
        name: a.name,
        model: a.model,
        createdAt: a.createdAt,
        totalConversations: a.totalConversations,
        lastUsedAt: a.lastUsedAt,
        status: (this.activeProcesses.has(a.name) ? 'thinking' : 'idle') as CowrkAgentState['status'],
        avatarPath,
      }
    }))
  }

  async createAgent(name: string, persona?: string): Promise<CowrkAgentState> {
    await agentManager.createAgent(name, persona)
    const meta = await agentManager.getAgentMeta(name)
    return {
      name: meta.name,
      model: meta.model,
      createdAt: meta.createdAt,
      totalConversations: 0,
      lastUsedAt: null,
      status: 'idle',
    }
  }

  async deleteAgent(name: string): Promise<void> {
    this.cancelAgent(name)
    await agentManager.deleteAgent(name)
  }

  /* ═══════ Avatar ═══════ */

  /** 에이전트 프로필 이미지를 저장합니다 (base64 → avatar.png, 최대 5MB) */
  async setAvatar(name: string, base64: string): Promise<string> {
    const files = agentFiles(name)
    const buf = Buffer.from(base64, 'base64')
    if (buf.length === 0) throw new Error('Invalid avatar data')
    if (buf.length > 5 * 1024 * 1024) throw new Error('Avatar too large (max 5MB)')
    await writeFile(files.avatar, buf)
    return files.avatar
  }

  /** 에이전트 프로필 이미지를 삭제합니다 */
  async removeAvatar(name: string): Promise<void> {
    const files = agentFiles(name)
    try { await unlink(files.avatar) } catch {}
  }

  /* ═══════ 대화 ═══════ */

  /**
   * 에이전트에게 질문합니다.
   * 비동기로 컨텍스트 로드 → claude -p 프로세스 spawn → 스트리밍 시작
   */
  askAgent(name: string, message: string, projectDir?: string): void {
    this.cancelAgent(name)
    this._runTurn(name, message, projectDir).catch(err => {
      this.onTurnError(name, (err as Error).message)
    })
  }

  /** 진행 중인 에이전트 프로세스 취소 */
  cancelAgent(name: string): void {
    const proc = this.activeProcesses.get(name)
    if (proc) {
      try { proc.kill('SIGTERM') } catch {}
      this.activeProcesses.delete(name)
    }
  }

  /** 모든 활성 프로세스 종료 */
  destroyAll(): void {
    for (const [name] of this.activeProcesses) {
      this.cancelAgent(name)
    }
  }

  /* ═══════ 턴 실행 ═══════ */

  private async _runTurn(name: string, message: string, projectDir?: string): Promise<void> {
    // 1. 컨텍스트 로드
    const persona = await agentManager.getAgentPersona(name)
    const memory = await agentManager.getAgentMemory(name)

    let project: ProjectContext | null = null
    if (projectDir) {
      project = await this.resolveProject(projectDir)
    }

    // 2. 시스템 프롬프트 구축
    const systemPrompt = this.buildSystemPrompt(persona, memory, project)

    // 3. 히스토리 로드 (최근 N턴)
    const files = agentFiles(name)
    const historyLines = await readLines(files.history, DEFAULTS.maxHistoryTurns * 2)
    const history = historyLines
      .map(line => { try { return JSON.parse(line) as HistoryEntry } catch { return null } })
      .filter(Boolean) as HistoryEntry[]

    // 4. 메시지 구축 (히스토리 포함)
    const fullMessage = this.buildCliMessage(history, message)

    // 5. 환경 변수 준비 (CLAUDECODE 제거)
    const env: Record<string, string> = { ...this.shellEnv }
    delete env['CLAUDECODE']
    delete env['CLAUDE_CODE']

    // 6. claude -p 프로세스 spawn
    const args = ['-p', fullMessage, '--output-format', 'stream-json', '--verbose']
    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt)
    }

    logger.info('CowrkManager', `spawning turn for agent "${name}", history: ${history.length} entries`)

    let child: ChildProcess
    try {
      child = spawn(this.claudePath, args, {
        cwd: projectDir || process.cwd(),
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (err) {
      this.onTurnError(name, `Failed to start claude: ${err}`)
      return
    }

    this.activeProcesses.set(name, child)
    child.stdin?.end()

    // 7. stdout → NdjsonParser → 이벤트 처리
    const parser = new NdjsonParser()
    child.stdout?.pipe(parser)

    let fullResponse = ''
    let resultText = ''

    parser.on('data', (event: Record<string, unknown>) => {
      const type = event.type as string

      // 스트리밍 텍스트 청크
      if (type === 'content_block_delta') {
        const delta = event.delta as { type?: string; text?: string } | undefined
        if (delta?.type === 'text_delta' && delta.text) {
          fullResponse += delta.text
          this.onStreamChunk(name, delta.text)
        }
      }

      // 결과 이벤트 (최종 텍스트 포함)
      if (type === 'result') {
        const r = event.result as string | undefined
        if (r) resultText = r
      }
    })

    let stderrData = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrData += chunk.toString()
    })

    // 8. 프로세스 종료 → 턴 완료 처리
    child.on('close', async (code) => {
      this.activeProcesses.delete(name)

      if (code !== 0 && code !== null) {
        this.onTurnError(name, stderrData || `Process exited with code ${code}`)
        return
      }

      const responseText = resultText || fullResponse.trim()

      if (responseText) {
        // 히스토리 저장
        const now = new Date().toISOString()
        await appendLine(files.history, JSON.stringify({ ts: now, role: 'user', content: message }))
        await appendLine(files.history, JSON.stringify({ ts: now, role: 'assistant', content: responseText }))

        // 통계 업데이트
        await agentManager.updateAgentStats(name, 0).catch(() => {})

        // Fire-and-forget: 메모리 갱신
        if (DEFAULTS.memoryAutoUpdate) {
          this.updateMemory(name, message, responseText, projectDir).catch(() => {})
        }
      }

      this.onTurnComplete(name, responseText)
    })

    child.on('error', (err) => {
      this.activeProcesses.delete(name)
      this.onTurnError(name, err.message)
    })
  }

  /* ═══════ 시스템 프롬프트 구축 ═══════ */

  private buildSystemPrompt(persona: string, memory: string, project: ProjectContext | null): string {
    const sections: string[] = []

    sections.push(`[PERSONA]\n${persona}`)
    sections.push(`[MEMORY]\n${memory || '아직 축적된 메모리가 없습니다.'}`)

    if (project) {
      let ps = `[PROJECT CONTEXT]\nWorking directory: ${project.cwd}`
      if (project.claudeMd) ps += `\n${project.claudeMd}`
      ps += `\n\nDirectory structure:\n${project.tree}`
      sections.push(ps)
    }

    return sections.join('\n\n')
  }

  /* ═══════ 히스토리 → 메시지 변환 ═══════ */

  private buildCliMessage(history: HistoryEntry[], currentMessage: string): string {
    if (history.length === 0) return currentMessage

    const lines = history.map(h =>
      `[${h.role === 'user' ? 'User' : 'Assistant'}]: ${h.content}`
    )
    return `Previous conversation:\n${lines.join('\n')}\n\nCurrent message:\n${currentMessage}`
  }

  /* ═══════ 프로젝트 컨텍스트 해석 ═══════ */

  private async resolveProject(cwd: string): Promise<ProjectContext> {
    const [claudeMd, tree] = await Promise.all([
      this.findClaudeMd(cwd),
      this.buildTree(cwd),
    ])
    return { cwd, claudeMd, tree }
  }

  /** CLAUDE.md 탐색 (cwd → 홈 디렉토리 방향) */
  private async findClaudeMd(cwd: string): Promise<string | null> {
    const home = homedir()
    let dir = cwd

    while (true) {
      const candidate = join(dir, 'CLAUDE.md')
      try {
        return await readFile(candidate, 'utf-8')
      } catch {
        // not found, walk up
      }
      const parent = dirname(dir)
      if (dir === parent || dir === home) break
      dir = parent
    }
    return null
  }

  /** 디렉토리 트리 문자열 생성 */
  private async buildTree(
    root: string,
    depth: number = DEFAULTS.treeDepth,
    maxEntries: number = DEFAULTS.treeMaxEntries,
  ): Promise<string> {
    const lines: string[] = []
    let count = 0

    const walk = async (dir: string, prefix: string, currentDepth: number): Promise<void> => {
      if (currentDepth > depth || count >= maxEntries) return

      let entries: string[]
      try {
        entries = await readdir(dir)
      } catch {
        return
      }

      const sorted: Array<{ name: string; isDir: boolean }> = []
      for (const name of entries) {
        if (name.startsWith('.') && name !== '.env.example') continue
        try {
          const s = await stat(join(dir, name))
          sorted.push({ name, isDir: s.isDirectory() })
        } catch {
          sorted.push({ name, isDir: false })
        }
      }
      sorted.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
        return a.name.localeCompare(b.name)
      })

      for (let i = 0; i < sorted.length; i++) {
        if (count >= maxEntries) {
          lines.push(`${prefix}... (truncated)`)
          break
        }
        const entry = sorted[i]!
        const { name, isDir } = entry
        const isLast = i === sorted.length - 1
        const connector = isLast ? '└── ' : '├── '
        const childPrefix = isLast ? '    ' : '│   '

        lines.push(`${prefix}${connector}${name}${isDir ? '/' : ''}`)
        count++

        if (isDir && !SKIP_DIRS.has(name)) {
          await walk(join(dir, name), prefix + childPrefix, currentDepth + 1)
        }
      }
    }

    lines.push(basename(root) + '/')
    count++
    await walk(root, '', 1)

    return lines.join('\n')
  }

  /* ═══════ 메모리 갱신 (fire-and-forget) ═══════ */

  private async updateMemory(
    agentName: string,
    userMsg: string,
    response: string,
    projectDir?: string,
  ): Promise<void> {
    try {
      const currentMemory = await agentManager.getAgentMemory(agentName)
      const files = agentFiles(agentName)

      const memoryPrompt = [
        `## Current Memory\n${currentMemory || '(empty)'}`,
        `## New Conversation${projectDir ? ` (project: ${projectDir})` : ''}`,
        `User: ${userMsg}`,
        `Assistant: ${response}`,
        `\nProduce the updated memory document.`,
      ].join('\n\n')

      // 환경 변수 준비
      const env: Record<string, string> = { ...this.shellEnv }
      delete env['CLAUDECODE']
      delete env['CLAUDE_CODE']

      const args = [
        '-p', memoryPrompt,
        '--output-format', 'stream-json', '--verbose',
        '--system-prompt', MEMORY_SYSTEM_PROMPT,
        '--model', 'claude-haiku-4-5-20251001',
      ]

      const child = spawn(this.claudePath, args, {
        cwd: process.cwd(),
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      child.stdin?.end()

      let memoryText = ''
      const parser = new NdjsonParser()
      child.stdout?.pipe(parser)

      parser.on('data', (event: Record<string, unknown>) => {
        const type = event.type as string
        if (type === 'content_block_delta') {
          const delta = event.delta as { type?: string; text?: string } | undefined
          if (delta?.type === 'text_delta' && delta.text) {
            memoryText += delta.text
          }
        }
        if (type === 'result') {
          const r = event.result as string | undefined
          if (r) memoryText = r
        }
      })

      child.on('close', async () => {
        if (memoryText.trim()) {
          await writeText(files.memory, memoryText.trim())
          logger.info('CowrkManager', `memory updated for agent "${agentName}"`)
        }
      })
    } catch {
      // 메모리 갱신은 best-effort — 실패 시 무시
    }
  }
}
