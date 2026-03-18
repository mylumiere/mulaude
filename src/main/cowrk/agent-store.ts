/**
 * 에이전트 레지스트리 관리
 *
 * agents.json을 SSOT로 에이전트 목록을 관리합니다.
 * CRUD 연산 시 원자적 파일 쓰기를 사용합니다.
 */

import type { AgentEntry, AgentRegistry } from './types'
import { PATHS } from './constants'
import { readJson, writeJsonAtomic } from './file-utils'

const DEFAULT_REGISTRY: AgentRegistry = {
  version: 1,
  agents: [],
}

/** 레지스트리 로드 (파일 없으면 기본값 생성) */
export async function loadRegistry(): Promise<AgentRegistry> {
  const registry = await readJson<AgentRegistry>(PATHS.agents, DEFAULT_REGISTRY)
  if (registry === DEFAULT_REGISTRY) {
    await saveRegistry(DEFAULT_REGISTRY)
  }
  return registry
}

/** 레지스트리 원자적 저장 */
export async function saveRegistry(registry: AgentRegistry): Promise<void> {
  await writeJsonAtomic(PATHS.agents, registry)
}

/** 이름으로 에이전트 검색 */
export async function findAgent(name: string): Promise<AgentEntry | undefined> {
  const { agents } = await loadRegistry()
  return agents.find((a) => a.name === name)
}

/** 에이전트 추가 (이름 중복 시 에러) */
export async function addAgent(entry: AgentEntry): Promise<void> {
  const registry = await loadRegistry()
  if (registry.agents.some((a) => a.name === entry.name)) {
    throw new Error(`Agent "${entry.name}" already exists.`)
  }
  registry.agents.push(entry)
  await saveRegistry(registry)
}

/** 에이전트 제거 (미발견 시 에러) */
export async function removeAgent(name: string): Promise<void> {
  const registry = await loadRegistry()
  const idx = registry.agents.findIndex((a) => a.name === name)
  if (idx === -1) {
    throw new Error(`Agent "${name}" not found.`)
  }
  registry.agents.splice(idx, 1)
  await saveRegistry(registry)
}

/** 에이전트 부분 업데이트 */
export async function updateAgent(name: string, patch: Partial<AgentEntry>): Promise<void> {
  const registry = await loadRegistry()
  const agent = registry.agents.find((a) => a.name === name)
  if (!agent) {
    throw new Error(`Agent "${name}" not found.`)
  }
  Object.assign(agent, patch)
  await saveRegistry(registry)
}
