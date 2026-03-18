/**
 * 에이전트 라이프사이클 관리
 *
 * 에이전트 생성/삭제, 페르소나/메모리/메타 읽기, 통계 업데이트를 담당합니다.
 * 디렉토리 구조: ~/.mulaude/cowrk/agents/{name}/ 에 persona.md, memory.md, history.jsonl, meta.json
 */

import { createHash } from 'node:crypto'
import { rm, mkdir } from 'node:fs/promises'
import type { AgentEntry, AgentMeta } from './types'
import { agentFiles, DEFAULTS, DEFAULT_PERSONA } from './constants'
import { readText, writeText, readJson, writeJsonAtomic } from './file-utils'
import { addAgent, removeAgent, findAgent, updateAgent } from './agent-store'

/** 에이전트 이름 유효성 검사: 영문+숫자+하이픈, 1-30자 */
function validateName(name: string): void {
  if (!/^[a-zA-Z0-9-]{1,30}$/.test(name)) {
    throw new Error(
      `Invalid agent name "${name}". Use alphanumeric characters and hyphens, 1-30 chars.`,
    )
  }
}

/** 새 에이전트 생성 (디렉토리 + 레지스트리) */
export async function createAgent(
  name: string,
  persona?: string,
  model?: string,
): Promise<void> {
  validateName(name)

  const existing = await findAgent(name)
  if (existing) {
    throw new Error(`Agent "${name}" already exists.`)
  }

  const files = agentFiles(name)
  const now = new Date().toISOString()
  const personaContent = persona || DEFAULT_PERSONA
  const agentModel = model || DEFAULTS.model

  await mkdir(files.dir, { recursive: true })

  const meta: AgentMeta = {
    name,
    createdAt: now,
    model: agentModel,
    totalConversations: 0,
    totalTokensUsed: 0,
    lastUsedAt: null,
    personaHash: createHash('sha256').update(personaContent).digest('hex').slice(0, 12),
  }

  await Promise.all([
    writeText(files.persona, personaContent),
    writeText(files.memory, ''),
    writeText(files.history, ''),
    writeJsonAtomic(files.meta, meta),
  ])

  const entry: AgentEntry = {
    name,
    createdAt: now,
    model: agentModel,
    totalConversations: 0,
    totalTokensUsed: 0,
    lastUsedAt: null,
  }

  await addAgent(entry)
}

/** 에이전트 삭제 (디렉토리 + 레지스트리) */
export async function deleteAgent(name: string): Promise<void> {
  const files = agentFiles(name)
  await rm(files.dir, { recursive: true, force: true })
  await removeAgent(name)
}

/** 에이전트 persona.md 읽기 */
export async function getAgentPersona(name: string): Promise<string> {
  const files = agentFiles(name)
  const content = await readText(files.persona)
  return content || DEFAULT_PERSONA
}

/** 에이전트 memory.md 읽기 */
export async function getAgentMemory(name: string): Promise<string> {
  const files = agentFiles(name)
  return (await readText(files.memory)) || ''
}

/** 에이전트 meta.json 읽기 */
export async function getAgentMeta(name: string): Promise<AgentMeta> {
  const files = agentFiles(name)
  const meta = await readJson<AgentMeta | null>(files.meta, null)
  if (!meta) {
    throw new Error(`Agent "${name}" meta not found.`)
  }
  return meta
}

/** 대화 통계 업데이트 (meta.json + 레지스트리) */
export async function updateAgentStats(name: string, tokens: number): Promise<void> {
  const now = new Date().toISOString()
  const files = agentFiles(name)

  const meta = await getAgentMeta(name)
  meta.totalConversations += 1
  meta.totalTokensUsed += tokens
  meta.lastUsedAt = now
  await writeJsonAtomic(files.meta, meta)

  await updateAgent(name, {
    totalConversations: meta.totalConversations,
    totalTokensUsed: meta.totalTokensUsed,
    lastUsedAt: now,
  })
}
