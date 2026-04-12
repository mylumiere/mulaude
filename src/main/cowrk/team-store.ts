/**
 * 팀 레지스트리 관리
 *
 * teams.json을 SSOT로 팀 목록을 관리합니다.
 * agent-store.ts와 동일한 CRUD + 원자적 쓰기 패턴.
 */

import type { TeamEntry, TeamRegistry } from './types'
import { TEAM_PATHS } from './constants'
import { readJson, writeJsonAtomic } from './file-utils'

const DEFAULT_REGISTRY: TeamRegistry = {
  version: 1,
  teams: [],
}

/** 레지스트리 로드 (파일 없으면 기본값 생성) */
export async function loadTeamRegistry(): Promise<TeamRegistry> {
  const registry = await readJson<TeamRegistry>(TEAM_PATHS.teams, DEFAULT_REGISTRY)
  if (registry === DEFAULT_REGISTRY) {
    await saveTeamRegistry(DEFAULT_REGISTRY)
  }
  return registry
}

/** 레지스트리 원자적 저장 */
export async function saveTeamRegistry(registry: TeamRegistry): Promise<void> {
  await writeJsonAtomic(TEAM_PATHS.teams, registry)
}

/** 이름으로 팀 검색 */
export async function findTeam(name: string): Promise<TeamEntry | undefined> {
  const { teams } = await loadTeamRegistry()
  return teams.find((t) => t.name === name)
}

/** 팀 추가 (이름 중복 시 에러) */
export async function addTeam(entry: TeamEntry): Promise<void> {
  const registry = await loadTeamRegistry()
  if (registry.teams.some((t) => t.name === entry.name)) {
    throw new Error(`Team "${entry.name}" already exists.`)
  }
  registry.teams.push(entry)
  await saveTeamRegistry(registry)
}

/** 팀 제거 (미발견 시 에러) */
export async function removeTeam(name: string): Promise<void> {
  const registry = await loadTeamRegistry()
  const idx = registry.teams.findIndex((t) => t.name === name)
  if (idx === -1) {
    throw new Error(`Team "${name}" not found.`)
  }
  registry.teams.splice(idx, 1)
  await saveTeamRegistry(registry)
}

/** 팀 부분 업데이트 */
export async function updateTeam(name: string, patch: Partial<TeamEntry>): Promise<void> {
  const registry = await loadTeamRegistry()
  const team = registry.teams.find((t) => t.name === name)
  if (!team) {
    throw new Error(`Team "${name}" not found.`)
  }
  Object.assign(team, patch)
  await saveTeamRegistry(registry)
}

/** 특정 에이전트를 모든 팀에서 제거 (에이전트 삭제 시 호출) */
export async function removeAgentFromAllTeams(agentName: string): Promise<string[]> {
  const registry = await loadTeamRegistry()
  const removedTeams: string[] = []

  registry.teams = registry.teams.filter((team) => {
    team.members = team.members.filter((m) => m !== agentName)
    if (team.members.length < 2) {
      removedTeams.push(team.name)
      return false // 2명 미만이면 팀 삭제
    }
    return true
  })

  await saveTeamRegistry(registry)
  return removedTeams // 삭제된 팀 이름 반환
}
