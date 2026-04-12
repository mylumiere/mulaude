/**
 * Cowrk 상수 정의
 *
 * 에이전트 저장소 경로 및 기본값을 정의합니다.
 * 저장소: ~/.mulaude/cowrk/
 */

import { join } from 'node:path'
import { homedir } from 'node:os'

/** ~/.mulaude/cowrk 루트 */
export const COWRK_HOME = join(homedir(), '.mulaude', 'cowrk')

/** 파일 경로 */
export const PATHS = {
  agents: join(COWRK_HOME, 'agents.json'),
  agentsDir: join(COWRK_HOME, 'agents'),
} as const

/** 에이전트 서브 파일 경로 */
export const agentFiles = (name: string) => {
  const dir = join(PATHS.agentsDir, name)
  return {
    dir,
    persona: join(dir, 'persona.md'),
    memory: join(dir, 'memory.md'),
    history: join(dir, 'history.jsonl'),
    meta: join(dir, 'meta.json'),
    avatar: join(dir, 'avatar.png'),
  }
}

/** 기본값 */
export const DEFAULTS = {
  model: 'claude-sonnet-4-20250514',
  maxHistoryTurns: 20,
  memoryAutoUpdate: true,
  treeDepth: 3,
  treeMaxEntries: 200,
} as const

/** ═══════ Team Chat 경로 ═══════ */

export const TEAM_PATHS = {
  teams: join(COWRK_HOME, 'teams.json'),
  teamsDir: join(COWRK_HOME, 'teams'),
} as const

/** 팀 서브 파일 경로 */
export const teamFiles = (name: string) => {
  const dir = join(TEAM_PATHS.teamsDir, name)
  return {
    dir,
    history: join(dir, 'history.jsonl'),
  }
}

/** 팀 기본값 */
export const TEAM_DEFAULTS = {
  maxTeamHistoryTurns: 30,
  maxKbSnippetChars: 8000,
  maxKbResults: 5,
} as const

/** 기본 페르소나 (미지정 시) */
export const DEFAULT_PERSONA = `# AI Assistant
## Expertise
- General software engineering
- Code review, debugging, architecture
## Personality
- Helpful and concise
- Provides concrete examples
`
