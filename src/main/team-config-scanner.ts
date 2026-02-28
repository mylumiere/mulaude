/**
 * team-config-scanner — ~/.claude/teams/ 디렉토리의 팀 config 스캔
 *
 * mtime 캐싱으로 불필요한 파일 읽기를 방지합니다.
 * fs/promises 기반 비동기 I/O로 이벤트 루프 블로킹을 방지합니다.
 */

import { readdir, stat, readFile } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'

/** team config mtime 캐시 (경로 -> { mtime, leadAgentId, members }) */
export interface TeamConfigCache {
  mtime: number
  leadAgentId?: string
  members: { name: string; agentId?: string; agentType?: string; tmuxPaneId?: string; isActive?: boolean; color?: string }[]
}

const teamConfigCaches = new Map<string, TeamConfigCache>()

/**
 * ~/.claude/teams/{name}/config.json 스캔 -> 팀 멤버 목록 반환
 * mtime 캐싱으로 불필요한 파일 읽기 방지
 * Promise.all로 팀 디렉토리 병렬 스캔
 */
export async function scanTeamConfigs(): Promise<{ teamName: string; members: TeamConfigCache['members'] }[]> {
  const teamsDir = join(homedir(), '.claude', 'teams')
  let teamDirs: string[]
  try {
    teamDirs = await readdir(teamsDir)
  } catch {
    return []
  }

  const validPaths = new Set<string>()

  const results = await Promise.all(
    teamDirs.map(async (teamName) => {
      const configPath = join(teamsDir, teamName, 'config.json')
      try {
        const st = await stat(configPath)
        const mtime = st.mtimeMs
        const cached = teamConfigCaches.get(configPath)

        if (cached && cached.mtime === mtime) {
          validPaths.add(configPath)
          return { teamName, leadAgentId: cached.leadAgentId, members: cached.members }
        }

        const raw = await readFile(configPath, 'utf-8')
        const config = JSON.parse(raw)
        const leadAgentId: string | undefined = config.leadAgentId
        const members = Array.isArray(config.members) ? config.members : []
        teamConfigCaches.set(configPath, { mtime, leadAgentId, members })
        validPaths.add(configPath)
        return { teamName, leadAgentId, members }
      } catch {
        // 파싱 실패 시 (파일 쓰기 중 등) 이전 캐시가 있으면 유지
        const cached = teamConfigCaches.get(configPath)
        if (cached) {
          validPaths.add(configPath)
          return { teamName, leadAgentId: cached.leadAgentId, members: cached.members }
        }
        return null
      }
    })
  )

  // 삭제된 팀의 캐시 정리
  for (const key of teamConfigCaches.keys()) {
    if (!validPaths.has(key)) teamConfigCaches.delete(key)
  }

  return results.filter((r): r is NonNullable<typeof r> => r !== null)
}
