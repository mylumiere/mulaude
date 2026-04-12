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
import { readdir, readFile, stat, writeFile, unlink, mkdir } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'
import { homedir } from 'node:os'
import { NdjsonParser } from './ndjson-parser'
import { getShellEnv, findClaudePath } from './env-resolver'
import { logger } from './logger'
import * as agentManager from './cowrk/agent-manager'
import { loadRegistry } from './cowrk/agent-store'
import { loadTeamRegistry, addTeam, removeTeam, updateTeam, findTeam, removeAgentFromAllTeams } from './cowrk/team-store'
import { agentFiles, DEFAULTS, teamFiles, TEAM_PATHS, TEAM_DEFAULTS } from './cowrk/constants'
import { readLines, appendLine, writeText } from './cowrk/file-utils'
import type { CowrkAgentState, TeamState, AgentPermission } from '../shared/types'
import type { HistoryEntry, ProjectContext, TeamOrchestration, TeamEntry } from './cowrk/types'

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

/** 에이전트 생성 어시스턴트 시스템 프롬프트 */
const AGENT_WIZARD_SYSTEM_PROMPT = `You are an agent creation assistant. The user describes what kind of AI agent they want. Based on their description, generate a JSON config for the agent.

Rules:
- name: lowercase, alphanumeric + hyphens, max 30 chars, descriptive
- persona: detailed markdown persona (expertise, personality, focus areas). Write in the same language the user used.
- permission: "read" (advice only), "edit" (can modify files), or "full" (full access including bash)

Respond with ONLY a JSON object. Nothing else.
Example:
{"name":"security-reviewer","persona":"# Security Reviewer\\n## Expertise\\n- OWASP Top 10 vulnerabilities\\n- Authentication/authorization flows\\n- Input validation and sanitization\\n## Personality\\n- Thorough and cautious\\n- Always explains the 'why' behind findings\\n- Prioritizes critical issues first","permission":"read"}`

/** 팀 오케스트레이터 시스템 프롬프트 */
const ORCHESTRATOR_SYSTEM_PROMPT = `You are a message router for a team chat. Given a user message and a list of team members, decide WHO should respond and in WHAT ORDER.

Rules:
- If the user mentions a specific member by name, only that member should respond.
- If the user says "X first" or addresses someone first, reorder accordingly.
- If the user asks a general question, all members respond in default order.
- If only some members are relevant to the question, include only them.

Respond with ONLY a JSON array of member names in response order. Nothing else.
Example: ["kdp-pm", "reviewer"]
Example: ["reviewer"]
Example: ["architect", "frontend-lead", "reviewer"]`

export class CowrkManager {
  private shellEnv: Record<string, string>
  private claudePath: string
  /** agentName → 활성 프로세스 */
  private activeProcesses = new Map<string, ChildProcess>()
  /** teamName → 활성 오케스트레이션 */
  private teamOrchestrations = new Map<string, TeamOrchestration>()

  /** 스트림 텍스트 청크 콜백 (index.ts에서 IPC 연결) */
  onStreamChunk: (agentName: string, chunk: string) => void = () => {}
  /** 턴 완료 콜백 */
  onTurnComplete: (agentName: string, response: string) => void = () => {}
  /** 턴 에러 콜백 */
  onTurnError: (agentName: string, error: string) => void = () => {}

  /** ═══════ Team 콜백 ═══════ */
  onTeamAgentStart: (teamName: string, agentName: string, index: number, total: number) => void = () => {}
  onTeamStreamChunk: (teamName: string, agentName: string, chunk: string) => void = () => {}
  onTeamAgentComplete: (teamName: string, agentName: string, response: string) => void = () => {}
  onTeamSequenceComplete: (teamName: string) => void = () => {}
  onTeamError: (teamName: string, agentName: string, error: string) => void = () => {}

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
      let permission: AgentPermission = 'read'
      try {
        const meta = await agentManager.getAgentMeta(a.name)
        permission = meta.permission || 'read'
      } catch {}
      return {
        name: a.name,
        model: a.model,
        createdAt: a.createdAt,
        totalConversations: a.totalConversations,
        lastUsedAt: a.lastUsedAt,
        status: (this.activeProcesses.has(a.name) ? 'thinking' : 'idle') as CowrkAgentState['status'],
        avatarPath,
        permission,
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
      permission: 'read',
    }
  }

  /** 대화형 에이전트 생성: 사용자 설명 → config 생성 */
  async generateAgentConfig(description: string): Promise<{ name: string; persona: string; permission: string }> {
    const env: Record<string, string> = { ...this.shellEnv }
    delete env['CLAUDECODE']
    delete env['CLAUDE_CODE']

    const wrappedPrompt = `Create an AI agent based on this user request. Output ONLY a JSON object with "name", "persona", and "permission" fields. No other text.

User request: "${description}"

Remember: Output ONLY valid JSON. No explanations, no markdown fences.`

    return new Promise((resolve, reject) => {
      const args = [
        '-p', wrappedPrompt,
        '--output-format', 'stream-json', '--verbose',
        '--system-prompt', AGENT_WIZARD_SYSTEM_PROMPT,
        '--model', 'claude-sonnet-4-20250514',
      ]

      const child = spawn(this.claudePath, args, {
        cwd: process.cwd(),
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      child.stdin?.end()

      let text = ''
      const parser = new NdjsonParser()
      child.stdout?.pipe(parser)

      parser.on('data', (event: Record<string, unknown>) => {
        if (event.type === 'content_block_delta') {
          const delta = event.delta as { type?: string; text?: string } | undefined
          if (delta?.type === 'text_delta' && delta.text) text += delta.text
        }
        if (event.type === 'result') {
          const r = event.result as string | undefined
          if (r) text = r
        }
      })

      child.on('close', (code) => {
        if (code !== 0 && code !== null) {
          reject(new Error(`Agent wizard exited ${code}`))
          return
        }
        try {
          logger.info('CowrkManager', `wizard raw response: ${text.slice(0, 200)}`)
          const jsonMatch = text.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            const config = JSON.parse(jsonMatch[0])
            resolve({
              name: config.name || 'new-agent',
              persona: (config.persona || '').replace(/\\n/g, '\n'),
              permission: config.permission || 'read',
            })
          } else {
            reject(new Error(`No JSON found. Response: ${text.slice(0, 100)}`))
          }
        } catch (err) {
          reject(err)
        }
      })

      child.on('error', reject)

      setTimeout(() => {
        try { child.kill('SIGTERM') } catch {}
        reject(new Error('Wizard timeout'))
      }, 60000)
    })
  }

  /** 에이전트 권한 변경 */
  async setPermission(name: string, permission: AgentPermission): Promise<void> {
    const meta = await agentManager.getAgentMeta(name)
    meta.permission = permission
    const files = agentFiles(name)
    const { writeJsonAtomic } = await import('./cowrk/file-utils')
    await writeJsonAtomic(files.meta, meta)
    logger.info('CowrkManager', `permission changed: "${name}" → ${permission}`)
  }

  async deleteAgent(name: string): Promise<void> {
    this.cancelAgent(name)
    await agentManager.deleteAgent(name)
    // 해당 에이전트를 모든 팀에서 제거 (2명 미만 시 팀 삭제)
    await removeAgentFromAllTeams(name).catch(() => {})
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

  /** 에이전트 채팅 히스토리 로드 */
  async loadAgentHistory(name: string): Promise<Array<{ role: string; content: string; ts: string }>> {
    const files = agentFiles(name)
    const lines = await readLines(files.history, DEFAULTS.maxHistoryTurns * 2)
    return lines
      .map(line => { try { return JSON.parse(line) } catch { return null } })
      .filter(Boolean) as Array<{ role: string; content: string; ts: string }>
  }

  /** 팀 채팅 히스토리 로드 */
  async loadTeamHistory(name: string): Promise<Array<{ role: string; agentName?: string; content: string; ts: string }>> {
    const tFiles = teamFiles(name)
    const lines = await readLines(tFiles.history, TEAM_DEFAULTS.maxTeamHistoryTurns * (2 + 3)) // 멤버 수 고려
    return lines
      .map(line => { try { return JSON.parse(line) } catch { return null } })
      .filter(Boolean) as Array<{ role: string; agentName?: string; content: string; ts: string }>
  }

  /** 모든 활성 프로세스 종료 */
  destroyAll(): void {
    for (const [name] of this.activeProcesses) {
      this.cancelAgent(name)
    }
    for (const [name] of this.teamOrchestrations) {
      this.cancelTeam(name)
    }
  }

  /** 권한 수준 → --allowedTools 플래그 값 */
  private permissionToTools(permission: AgentPermission): string | null {
    switch (permission) {
      case 'read': return null // 기본: 도구 제한 없이 claude -p가 알아서 (읽기 모드)
      case 'edit': return 'Read,Edit,Write,Grep,Glob'
      case 'full': return 'Read,Edit,Write,Bash,Grep,Glob'
      default: return null
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

    // 6. claude -p 프로세스 spawn (권한에 따라 --allowedTools 추가)
    const args = ['-p', fullMessage, '--output-format', 'stream-json', '--verbose']
    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt)
    }

    // 에이전트 권한 적용
    try {
      const meta = await agentManager.getAgentMeta(name)
      const tools = this.permissionToTools(meta.permission || 'read')
      if (tools) {
        args.push('--allowedTools', tools)
      }
    } catch {}

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

  /* ═══════════════════════════════════════════════
     Team Chat — 그룹 채팅방 오케스트레이션
     ═══════════════════════════════════════════════ */

  /* ═══════ Team CRUD ═══════ */

  async listTeams(): Promise<TeamState[]> {
    const registry = await loadTeamRegistry()
    return registry.teams.map(t => ({
      ...t,
      status: (this.teamOrchestrations.has(t.name) ? 'running' : 'idle') as TeamState['status'],
      currentAgent: this.teamOrchestrations.get(t.name)?.members[
        this.teamOrchestrations.get(t.name)!.currentIndex
      ],
      completedCount: this.teamOrchestrations.get(t.name)?.responses.length,
    }))
  }

  async createTeam(name: string, members: string[]): Promise<TeamState> {
    if (!/^[a-zA-Z0-9-]{1,30}$/.test(name)) {
      throw new Error('Team name must be 1-30 alphanumeric characters or hyphens.')
    }
    if (members.length < 2) {
      throw new Error('Team must have at least 2 members.')
    }

    // 멤버 존재 여부 검증
    const registry = await loadRegistry()
    for (const m of members) {
      if (!registry.agents.some(a => a.name === m)) {
        throw new Error(`Agent "${m}" not found.`)
      }
    }

    const entry: TeamEntry = {
      name,
      members,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    }

    await addTeam(entry)
    const tFiles = teamFiles(name)
    await mkdir(tFiles.dir, { recursive: true })

    logger.info('CowrkManager', `team created: "${name}" with members [${members.join(', ')}]`)

    return { ...entry, status: 'idle' }
  }

  async deleteTeam(name: string): Promise<void> {
    this.cancelTeam(name)
    await removeTeam(name)
    // 팀 디렉토리 삭제 (history.jsonl 포함)
    const tFiles = teamFiles(name)
    const { rm } = await import('node:fs/promises')
    await rm(tFiles.dir, { recursive: true, force: true }).catch(() => {})
    logger.info('CowrkManager', `team deleted: "${name}"`)
  }

  /* ═══════ Team 대화 ═══════ */

  /** 팀에게 질문합니다. 멤버가 순차적으로 응답합니다. */
  askTeam(teamName: string, message: string, projectDir?: string): void {
    this.cancelTeam(teamName)
    this._runTeamSequence(teamName, message, projectDir).catch(err => {
      this.onTeamError(teamName, '', (err as Error).message)
    })
  }

  /** 진행 중인 팀 오케스트레이션 취소 */
  cancelTeam(teamName: string): void {
    const orch = this.teamOrchestrations.get(teamName)
    if (orch) {
      orch.cancelled = true
      // 현재 활성 에이전트 프로세스도 종료
      const currentAgent = orch.members[orch.currentIndex]
      if (currentAgent) {
        const procKey = `team:${teamName}:${currentAgent}`
        const proc = this.activeProcesses.get(procKey)
        if (proc) {
          try { proc.kill('SIGTERM') } catch {}
          this.activeProcesses.delete(procKey)
        }
      }
      this.teamOrchestrations.delete(teamName)
    }
  }

  /* ═══════ 시퀀셜 오케스트레이션 ═══════ */

  private async _runTeamSequence(
    teamName: string,
    message: string,
    projectDir?: string,
  ): Promise<void> {
    const team = await findTeam(teamName)
    if (!team) throw new Error(`Team "${teamName}" not found.`)

    // 멤버 전부 존재하는지 검증
    const agentRegistry = await loadRegistry()
    for (const name of team.members) {
      if (!agentRegistry.agents.some(a => a.name === name)) {
        this.onTeamError(teamName, name, `Agent "${name}" no longer exists`)
        return
      }
    }

    // 프리프로세싱: 메시지 분석 → 응답할 멤버 + 순서 결정
    const orderedMembers = await this._preprocessTeamMessage(message, team.members)

    const orchestration: TeamOrchestration = {
      teamName,
      members: orderedMembers,
      currentIndex: 0,
      cancelled: false,
      responses: [],
    }
    this.teamOrchestrations.set(teamName, orchestration)

    // user 메시지를 팀 히스토리에 저장
    const tFiles = teamFiles(teamName)
    await mkdir(tFiles.dir, { recursive: true })
    const now = new Date().toISOString()
    await appendLine(tFiles.history, JSON.stringify({ ts: now, role: 'user', content: message }))

    logger.info('CowrkManager', `team sequence started: "${teamName}" — routed to [${orderedMembers.join(', ')}]`)

    // 순차 실행 (오케스트레이터가 결정한 순서)
    for (let i = 0; i < orderedMembers.length; i++) {
      if (orchestration.cancelled) break

      orchestration.currentIndex = i
      const agentName = orderedMembers[i]!

      // 에이전트 컨텍스트 로드
      const persona = await agentManager.getAgentPersona(agentName)
      const memory = await agentManager.getAgentMemory(agentName)

      let project: ProjectContext | null = null
      if (projectDir) {
        project = await this.resolveProject(projectDir)
      }

      // 팀 시스템 프롬프트 구축
      const systemPrompt = this.buildTeamSystemPrompt(
        persona, memory, project,
        teamName, orderedMembers, i,
      )

      // 팀 메시지 구축 (원래 질문 + 이전 에이전트 응답)
      const teamMessage = this.buildTeamMessage(message, orchestration.responses)

      try {
        // 에이전트 권한 읽기
        let agentPermission: AgentPermission = 'read'
        try {
          const meta = await agentManager.getAgentMeta(agentName)
          agentPermission = meta.permission || 'read'
        } catch {}

        // 에이전트 턴 시작 알림 (composing 인디케이터용)
        this.onTeamAgentStart(teamName, agentName, i, orderedMembers.length)

        const response = await this._runTeamAgentTurn(
          teamName, agentName, systemPrompt, teamMessage, projectDir, agentPermission,
        )

        if (orchestration.cancelled) break

        orchestration.responses.push({ agentName, response })

        // 팀 히스토리에 저장
        await appendLine(tFiles.history, JSON.stringify({
          ts: new Date().toISOString(),
          role: 'agent',
          agentName,
          content: response,
        }))

        this.onTeamAgentComplete(teamName, agentName, response)

        // 개별 에이전트 통계 업데이트
        await agentManager.updateAgentStats(agentName, 0).catch(() => {})
      } catch (err) {
        if (!orchestration.cancelled) {
          this.onTeamError(teamName, agentName, (err as Error).message)
        }
        break
      }
    }

    this.teamOrchestrations.delete(teamName)
    if (!orchestration.cancelled) {
      // lastUsedAt 업데이트
      await updateTeam(teamName, { lastUsedAt: new Date().toISOString() }).catch(() => {})
      this.onTeamSequenceComplete(teamName)
      logger.info('CowrkManager', `team sequence complete: "${teamName}"`)
    }
  }

  /** 팀 시퀀스에서 개별 에이전트 턴 실행 (Promise 반환) */
  private _runTeamAgentTurn(
    teamName: string,
    agentName: string,
    systemPrompt: string,
    fullMessage: string,
    projectDir?: string,
    permission?: AgentPermission,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const env: Record<string, string> = { ...this.shellEnv }
      delete env['CLAUDECODE']
      delete env['CLAUDE_CODE']

      const args = ['-p', fullMessage, '--output-format', 'stream-json', '--verbose']
      if (systemPrompt) {
        args.push('--system-prompt', systemPrompt)
      }

      // 에이전트 권한 적용
      const tools = this.permissionToTools(permission || 'read')
      if (tools) {
        args.push('--allowedTools', tools)
      }

      let child: ChildProcess
      try {
        child = spawn(this.claudePath, args, {
          cwd: projectDir || process.cwd(),
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      } catch (err) {
        reject(new Error(`Failed to start claude for "${agentName}": ${err}`))
        return
      }

      const procKey = `team:${teamName}:${agentName}`
      this.activeProcesses.set(procKey, child)
      child.stdin?.end()

      const parser = new NdjsonParser()
      child.stdout?.pipe(parser)

      let fullResponse = ''
      let resultText = ''

      parser.on('data', (event: Record<string, unknown>) => {
        const type = event.type as string
        if (type === 'content_block_delta') {
          const delta = event.delta as { type?: string; text?: string } | undefined
          if (delta?.type === 'text_delta' && delta.text) {
            fullResponse += delta.text
            this.onTeamStreamChunk(teamName, agentName, delta.text)
          }
        }
        if (type === 'result') {
          const r = event.result as string | undefined
          if (r) resultText = r
        }
      })

      let stderrData = ''
      child.stderr?.on('data', (chunk: Buffer) => {
        stderrData += chunk.toString()
      })

      child.on('close', (code) => {
        this.activeProcesses.delete(procKey)

        if (code !== 0 && code !== null) {
          reject(new Error(stderrData || `Agent "${agentName}" exited with code ${code}`))
          return
        }

        const responseText = resultText || fullResponse.trim()
        resolve(responseText)
      })

      child.on('error', (err) => {
        this.activeProcesses.delete(procKey)
        reject(err)
      })
    })
  }

  /* ═══════ Team 시스템 프롬프트 ═══════ */

  private buildTeamSystemPrompt(
    persona: string,
    memory: string,
    project: ProjectContext | null,
    teamName: string,
    members: string[],
    myIndex: number,
  ): string {
    const sections: string[] = []

    const memberList = members.map((m, i) =>
      i === myIndex ? `**${m} (you)**` : m
    ).join(', ')

    sections.push(`[TEAM CONTEXT]
You are "${members[myIndex]}", a member of team "${teamName}".
Team members (response order): ${memberList}
You are the ${myIndex === 0 ? 'first' : `#${myIndex + 1}`} to respond.
Build on your teammates' responses — don't repeat what they already said.
Focus on your unique expertise and perspective.
Be concise.`)

    sections.push(`[PERSONA]\n${persona}`)
    sections.push(`[MEMORY]\n${memory || 'No accumulated memory yet.'}`)

    if (project) {
      let ps = `[PROJECT CONTEXT]\nWorking directory: ${project.cwd}`
      if (project.claudeMd) ps += `\n${project.claudeMd}`
      ps += `\n\nDirectory structure:\n${project.tree}`
      sections.push(ps)
    }

    return sections.join('\n\n')
  }

  /* ═══════ 프리프로세싱 오케스트레이터 ═══════ */

  /** 사용자 메시지를 분석해서 응답할 멤버와 순서를 결정 (haiku) */
  private async _preprocessTeamMessage(
    message: string,
    members: string[],
  ): Promise<string[]> {
    try {
      const env: Record<string, string> = { ...this.shellEnv }
      delete env['CLAUDECODE']
      delete env['CLAUDE_CODE']

      const prompt = `Team members: ${JSON.stringify(members)}\nUser message: ${message}`

      const result = await new Promise<string>((resolve, reject) => {
        const args = [
          '-p', prompt,
          '--output-format', 'stream-json', '--verbose',
          '--system-prompt', ORCHESTRATOR_SYSTEM_PROMPT,
          '--model', 'claude-haiku-4-5-20251001',
        ]

        const child = spawn(this.claudePath, args, {
          cwd: process.cwd(),
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        })

        child.stdin?.end()

        let text = ''
        const parser = new NdjsonParser()
        child.stdout?.pipe(parser)

        parser.on('data', (event: Record<string, unknown>) => {
          if (event.type === 'content_block_delta') {
            const delta = event.delta as { type?: string; text?: string } | undefined
            if (delta?.type === 'text_delta' && delta.text) text += delta.text
          }
          if (event.type === 'result') {
            const r = event.result as string | undefined
            if (r) text = r
          }
        })

        child.on('close', (code) => {
          if (code !== 0 && code !== null) reject(new Error(`Orchestrator exited ${code}`))
          else resolve(text.trim())
        })
        child.on('error', reject)

        // 타임아웃: 10초
        setTimeout(() => {
          try { child.kill('SIGTERM') } catch {}
          reject(new Error('Orchestrator timeout'))
        }, 10000)
      })

      // JSON 배열 파싱
      const jsonMatch = result.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as string[]
        // 유효한 멤버만 필터링
        const valid = parsed.filter(name => members.includes(name))
        if (valid.length > 0) {
          logger.info('CowrkManager', `orchestrator routed to: [${valid.join(', ')}]`)
          return valid
        }
      }
    } catch (err) {
      logger.info('CowrkManager', `orchestrator fallback (${(err as Error).message}), using default order`)
    }

    // 실패 시 기본 순서
    return members
  }

  /* ═══════ Team 메시지 구축 ═══════ */

  private buildTeamMessage(
    userMessage: string,
    previousResponses: Array<{ agentName: string; response: string }>,
  ): string {
    if (previousResponses.length === 0) return userMessage

    const parts = [`User's question:\n${userMessage}\n`]
    for (const { agentName, response } of previousResponses) {
      parts.push(`[${agentName}'s response]:\n${response}\n`)
    }
    parts.push('Now provide your response, building on the above.')
    return parts.join('\n')
  }
}
