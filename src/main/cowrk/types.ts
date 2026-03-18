/**
 * Cowrk 내부 타입 정의
 *
 * cowrk 에이전트 저장소 및 대화 시스템에서 사용하는 타입입니다.
 * 렌더러에 노출되는 타입은 shared/types.ts에 정의됩니다.
 */

/** 에이전트 정의 (agents.json 에 저장) */
export interface AgentEntry {
  name: string
  createdAt: string
  model: string
  totalConversations: number
  totalTokensUsed: number
  lastUsedAt: string | null
}

/** agents.json 전체 구조 */
export interface AgentRegistry {
  version: 1
  agents: AgentEntry[]
}

/** 에이전트별 meta.json */
export interface AgentMeta {
  name: string
  createdAt: string
  model: string
  totalConversations: number
  totalTokensUsed: number
  lastUsedAt: string | null
  personaHash: string
}

/** 대화 히스토리 엔트리 (history.jsonl 한 줄) */
export interface HistoryEntry {
  ts: string
  role: 'user' | 'assistant'
  content: string
  tokens?: number
  project?: string
}

/** 프로젝트 컨텍스트 */
export interface ProjectContext {
  cwd: string
  claudeMd: string | null
  tree: string
}
