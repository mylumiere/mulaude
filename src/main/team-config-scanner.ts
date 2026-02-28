/**
 * team-config-scanner — ~/.claude/teams/ 디렉토리의 팀 config 스캔
 *
 * mtime 캐싱으로 불필요한 파일 읽기를 방지합니다.
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

/** team config mtime 캐시 (경로 -> { mtime, members }) */
export interface TeamConfigCache {
  mtime: number
  members: { name: string; agentType?: string; tmuxPaneId?: string; isActive?: boolean }[]
}

const teamConfigCaches = new Map<string, TeamConfigCache>()

/**
 * ~/.claude/teams/{name}/config.json 스캔 -> 팀 멤버 목록 반환
 * mtime 캐싱으로 불필요한 파일 읽기 방지
 */
export function scanTeamConfigs(): { teamName: string; members: TeamConfigCache['members'] }[] {
  const teamsDir = join(homedir(), '.claude', 'teams')
  let teamDirs: string[]
  try {
    teamDirs = readdirSync(teamsDir)
  } catch {
    return []
  }

  const results: { teamName: string; members: TeamConfigCache['members'] }[] = []
  const validPaths = new Set<string>()

  for (const teamName of teamDirs) {
    const configPath = join(teamsDir, teamName, 'config.json')
    try {
      const stat = statSync(configPath)
      const mtime = stat.mtimeMs
      const cached = teamConfigCaches.get(configPath)

      if (cached && cached.mtime === mtime) {
        validPaths.add(configPath)
        results.push({ teamName, members: cached.members })
        continue
      }

      const raw = readFileSync(configPath, 'utf-8')
      const config = JSON.parse(raw)
      const members = Array.isArray(config.members) ? config.members : []
      teamConfigCaches.set(configPath, { mtime, members })
      validPaths.add(configPath)
      results.push({ teamName, members })
    } catch {
      // config.json 없거나 파싱 실패 -> 무시
    }
  }

  // 삭제된 팀의 캐시 정리
  for (const key of teamConfigCaches.keys()) {
    if (!validPaths.has(key)) teamConfigCaches.delete(key)
  }

  return results
}
