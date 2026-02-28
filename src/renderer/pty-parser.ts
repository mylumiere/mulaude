/**
 * PTY 파서 유틸리티
 *
 * PTY 출력 데이터에서 세션 상태를 판별하는 순수 함수들을 제공합니다.
 * 상태 관리 로직 없이 데이터 파싱/분류만 담당합니다.
 */

import type { SessionStatus } from '../shared/types'

/** ANSI 이스케이프 시퀀스 + 제어 문자 + 잔여 시퀀스 조각 제거 */
export function stripAnsi(str: string): string {
  return str
    .replace(/\x1B(?:\[[0-?]*[ -/]*[@-~]|\].*?(?:\x07|\x1B\\)|[()][AB012]|[>=<]|[78DEHM])/g, '')
    .replace(/[\x00-\x09\x0B-\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/\[\?[0-9;]*[a-zA-Z]/g, '')
    .replace(/\[=[0-9;]*[a-zA-Z]/g, '')
}

export const SPINNER_RE = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷◐◓◑◒]/

export function stripSpinners(str: string): string {
  return str.replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷◐◓◑◒⠁⠂⠄⡀⢀⠠⠐⠈]/g, '').trim()
}

export const TOOL_PATTERNS: [RegExp, string][] = [
  [/\bRead\b/i, 'Read'], [/\bEdit\b/i, 'Edit'], [/\bWrite\b/i, 'Write'],
  [/\bBash\b/i, 'Bash'], [/\bGlob\b/i, 'Glob'], [/\bGrep\b/i, 'Grep'],
  [/\bWebFetch\b/i, 'WebFetch'], [/\bWebSearch\b/i, 'WebSearch'],
  [/\bTask\b/i, 'Task'], [/\bNotebookEdit\b/i, 'Notebook']
]

/** HUD 출력에서 컨텍스트 퍼센테이지 추출 (예: "██░░ 45%") */
export function extractContextPercent(raw: string): number | null {
  const cleaned = stripAnsi(raw)
  const match = cleaned.match(/[█░▓▒]{2,}\s*(\d{1,3})%/)
  return match ? parseInt(match[1], 10) : null
}

/**
 * idle 상태 중 축적된 PTY 데이터에서 사용자 입력을 추출하여 세션명으로 사용합니다.
 * 백스페이스 처리, ANSI/스피너 제거 후 4자 이상의 첫 줄을 반환합니다.
 */
export function extractSessionName(captured: string): string | null {
  const chars: string[] = []
  for (const ch of captured) {
    if (ch === '\b' || ch === '\x7F') chars.pop()
    else chars.push(ch)
  }
  const cleaned = stripAnsi(chars.join(''))
  const lines = cleaned.split(/[\r\n]+/)
    .map((l) => l.replace(/^[>❯]\s*/, '').trim())
    .filter((l) =>
      l.length >= 4 &&
      !SPINNER_RE.test(l) &&
      !/[░█▓▒]/.test(l) &&
      !/^\[[\?=]/.test(l) &&
      !/^[0-9;]+[a-zA-Z]$/.test(l) &&
      /[가-힣a-zA-Z]/.test(l)
    )
  if (lines.length === 0) return null
  const input = lines[0]
  return input.length > 40 ? input.slice(0, 37) + '...' : input
}

/**
 * PTY 출력 → 세션 상태 판별
 *
 * 감지 우선순위:
 *   1. 프롬프트 (promptBuf) → idle / shell / permission
 *   2. 에러 (newData)
 *   3. 에이전트 (newData)
 *   4. 스피너 (newData) → thinking / tool
 *   5. null (판별 불가 — 호출자가 fallback 처리)
 */
export function classifyChunk(newData: string, promptBuf: string): SessionStatus | null {
  // 커서 위치 지정 시퀀스(ESC[row;colH)를 줄바꿈으로 변환
  // tmux 화면 재그리기 시 줄 구조를 보존하여 프롬프트 감지 정확도를 높임
  const fresh = stripAnsi(newData.replace(/\x1B\[\d+(?:;\d*)?H/g, '\n'))
  const prompt = stripAnsi(promptBuf.replace(/\x1B\[\d+(?:;\d*)?H/g, '\n'))

  // ── 1. 프롬프트 / 퍼미션 / 셸 (promptBuf 기반) ──

  // ─ 1a. permission 감지 ─
  if (/(?:to select|to navigate|Esc to cancel)/i.test(prompt)) {
    return { state: 'permission', label: 'Response needed' }
  }
  if (/\(Recommended\)/i.test(prompt)) {
    return { state: 'permission', label: 'Response needed' }
  }
  if (/\b(?:allow|deny|approve|reject|yes\/no|y\/n)\b/i.test(prompt)) {
    return { state: 'permission', label: 'Permission required' }
  }
  if (/\b(?:Do you want|Would you like|Shall I|May I)\b/i.test(prompt) && /\?/.test(prompt)) {
    return { state: 'permission', label: 'Permission required' }
  }
  if (/[►▸●○❯]\s/.test(prompt) && /\b(?:Other|Select|Choose|Pick)\b/i.test(prompt)) {
    return { state: 'permission', label: 'Response needed' }
  }

  // ─ 1b. idle / shell 프롬프트 (줄 기반, HUD 줄 제외) ─
  const pLines = prompt.split(/[\r\n]+/).map((l) => l.trim()).filter((l) => l.length > 0 && !/[░█▓▒]/.test(l))
  for (let i = pLines.length - 1; i >= Math.max(0, pLines.length - 3); i--) {
    const line = pLines[i]
    if (/^[>❯]\s*$/.test(line)) return { state: 'idle', label: '' }
    if (line.length <= 80 && /[$%]\s*$/.test(line)) {
      if (/\w+@[\w.-]+/.test(line) || /^[$%]\s*$/.test(line) ||
          /^\([\w.-]+\)/.test(line) || /^[\w~\/].*[$%]\s*$/.test(line)) {
        return { state: 'shell', label: '' }
      }
    }
  }

  // ── 2-4. 활동 감지 (newData 기반) ──
  const fLines = fresh.split(/[\r\n]+/).map((l) => l.trim()).filter((l) => l.length > 0 && !/[░█▓▒]/.test(l))
  if (fLines.length === 0) return null

  // 에러
  for (const line of fLines) {
    if (/(?:Error:|error:|ENOENT|EPERM|failed|FATAL|panic)/i.test(line))
      return { state: 'error', label: stripSpinners(line).slice(0, 50) }
  }

  // 에이전트
  const agentMatch = fresh.match(/(\d+)\s*\/\s*(\d+)\s*(?:agent|task|teammate)/i)
  if (agentMatch) return { state: 'agent', label: `Agent ${agentMatch[1]}/${agentMatch[2]}` }
  if (/(?:spawning|launching)\s+(?:agent|team)/i.test(fresh))
    return { state: 'agent', label: 'Starting agents...' }

  // 스피너 → thinking / tool
  if (SPINNER_RE.test(fresh)) {
    const spinnerLine = fLines.findLast((l) => SPINNER_RE.test(l))
    if (spinnerLine) {
      const detail = stripSpinners(spinnerLine)
      for (const [pattern, name] of TOOL_PATTERNS) {
        if (pattern.test(detail)) {
          const pathMatch = detail.match(/(?:\/[\w./-]+|[\w.-]+\.\w{1,6})/)
          return { state: 'tool', label: (pathMatch ? `${name} ${pathMatch[0]}` : name).slice(0, 50) }
        }
      }
      if (/think/i.test(detail) || detail.length < 3) return { state: 'thinking', label: '' }
      return { state: 'thinking', label: detail.slice(0, 50) }
    }
  }

  return null
}

/**
 * 에이전트 pane 캡처 내용에서 현재 활동을 추출합니다.
 *
 * classifyChunk와 달리 프롬프트 버퍼/newData 분리가 불가능한
 * 캡처된 마지막 N줄에서 직접 활동을 탐색합니다.
 *
 * 탐색 순서: 스피너(도구/thinking) → `>` 프롬프트(idle) → null
 */
export function extractPaneActivity(content: string): string | undefined {
  const cleaned = stripAnsi(content)
  const lines = cleaned
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/[░█▓▒]/.test(l))

  // 마지막 줄부터 역순으로 탐색
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 6); i--) {
    const line = lines[i]

    // 스피너 감지 → 도구명 또는 thinking
    if (SPINNER_RE.test(line)) {
      const detail = stripSpinners(line)
      for (const [pattern, name] of TOOL_PATTERNS) {
        if (pattern.test(detail)) {
          const pathMatch = detail.match(/(?:\/[\w./-]+|[\w.-]+\.\w{1,6})/)
          return (pathMatch ? `${name} ${pathMatch[0]}` : name).slice(0, 50)
        }
      }
      if (detail.length >= 3) return detail.slice(0, 50)
      return 'Thinking...'
    }

    // `>` 프롬프트 = idle
    if (/^[>❯]\s*$/.test(line)) return 'Idle'
  }

  return undefined
}
