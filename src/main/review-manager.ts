/**
 * review-manager — Codex CLI 기반 코드 리뷰 실행기
 *
 * "Claude가 코드를 짜면 Codex가 리뷰한다"는 워크플로우를 위한 모듈.
 * 세션의 git diff HEAD를 캡처한 뒤, `codex exec --json`에 리뷰 프롬프트와
 * 함께 넘겨 비대화형으로 실행합니다. Codex가 내보내는 NDJSON 스트림에서
 * agent_message 텍스트를 누적해 렌더러로 전달합니다.
 *
 * diff-manager와 달리 auto-refresh가 없는 on-demand 방식입니다
 * (리뷰는 비용이 크고 사용자가 명시적으로 요청할 때만 의미가 있음).
 *
 * Codex exec 출력 형식 (developers.openai.com/codex/noninteractive):
 *   - --json → stdout이 JSON Lines 스트림
 *   - 최종 응답: { type: "item.completed", item: { type: "agent_message", text } }
 */

import { spawn, execFile, type ChildProcess } from 'child_process'
import { BrowserWindow } from 'electron'
import { NdjsonParser } from './ndjson-parser'
import { getShellEnv, findCodexPath } from './env-resolver'

/** 진행 중인 리뷰 프로세스 (세션당 하나) */
const activeProcesses = new Map<string, ChildProcess>()

/** codex 경로 (lazy 초기화) */
let codexPath: string | null = null
function getCodexPath(): string {
  if (codexPath === null) {
    codexPath = findCodexPath(getShellEnv())
  }
  return codexPath
}

/** 렌더러로 이벤트 전송 */
function send(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args)
    }
  }
}

/** git diff HEAD를 텍스트로 캡처 */
function captureDiff(workingDir: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['diff', 'HEAD', '--no-color'],
      { cwd: workingDir, maxBuffer: 10 * 1024 * 1024, timeout: 10000 },
      (err, stdout) => {
        resolve(err ? '' : stdout)
      }
    )
  })
}

/** Codex에 전달할 리뷰 프롬프트 구성 */
function buildReviewPrompt(diff: string): string {
  return [
    'You are a senior code reviewer. Review the following git diff and report:',
    '1. Correctness bugs and logic errors',
    '2. Security concerns',
    '3. Edge cases that may be missed',
    '4. Suggestions for improvement (only if meaningful)',
    '',
    'Be concise and specific. Reference file paths and line context. ' +
      'If the diff looks good, say so briefly. Respond in Markdown.',
    '',
    '--- BEGIN DIFF ---',
    diff,
    '--- END DIFF ---'
  ].join('\n')
}

/**
 * 리뷰를 실행합니다.
 *
 * 1) git diff HEAD 캡처 → 비어있으면 즉시 빈 결과 전송
 * 2) codex exec --json spawn + 리뷰 프롬프트 stdin 전달
 * 3) NDJSON 스트림에서 agent_message 누적 → review:chunk
 * 4) 종료 시 review:result (전체 텍스트) 또는 review:error
 */
export async function runReview(sessionId: string, workingDir: string): Promise<void> {
  // 기존 진행 중인 리뷰 취소
  cancelReview(sessionId)

  // codex 미설치 사전 체크 — findCodexPath는 탐색 실패 시 bare 'codex'를 반환
  if (getCodexPath() === 'codex') {
    codexPath = null // 캐시 초기화 (그 사이 설치했을 수 있으니 다음 실행 시 재탐색)
    send('review:error', sessionId, 'CODEX_NOT_FOUND')
    return
  }

  const diff = await captureDiff(workingDir)
  if (!diff.trim()) {
    send('review:result', sessionId, '')
    return
  }

  const env: Record<string, string> = { ...getShellEnv() }
  delete env['CLAUDECODE']
  delete env['CLAUDE_CODE']

  const prompt = buildReviewPrompt(diff)

  let child: ChildProcess
  try {
    // 프롬프트를 인자로 넘기면 매우 길어 ARG_MAX 위험 → stdin('-')으로 전달
    child = spawn(getCodexPath(), ['exec', '--json', '-'], {
      cwd: workingDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    })
  } catch (err) {
    send('review:error', sessionId, `Failed to start codex: ${err}`)
    return
  }

  activeProcesses.set(sessionId, child)

  child.stdin?.write(prompt)
  child.stdin?.end()

  let accumulated = ''
  const parser = new NdjsonParser()
  child.stdout?.pipe(parser)

  parser.on('data', (event: Record<string, unknown>) => {
    if (event.type !== 'item.completed') return
    const item = event.item as Record<string, unknown> | undefined
    if (item?.type === 'agent_message' && typeof item.text === 'string') {
      accumulated += (accumulated ? '\n\n' : '') + item.text
      send('review:chunk', sessionId, accumulated)
    }
  })

  let stderrData = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrData += chunk.toString()
  })

  child.on('close', (code) => {
    const wasActive = activeProcesses.get(sessionId) === child
    activeProcesses.delete(sessionId)
    if (!wasActive) return // 취소된 경우 결과 무시

    if (code !== 0 && !accumulated) {
      send('review:error', sessionId, stderrData.trim() || `codex exited with code ${code}`)
    } else {
      send('review:result', sessionId, accumulated)
    }
  })

  child.on('error', (err) => {
    if (activeProcesses.get(sessionId) === child) {
      activeProcesses.delete(sessionId)
      // 바이너리가 사라진 경우(ENOENT)도 미설치로 안내 + 경로 캐시 초기화
      const notFound = (err as NodeJS.ErrnoException).code === 'ENOENT'
      if (notFound) codexPath = null
      send('review:error', sessionId, notFound ? 'CODEX_NOT_FOUND' : err.message)
    }
  })
}

/** 진행 중인 리뷰 취소 */
export function cancelReview(sessionId: string): void {
  const child = activeProcesses.get(sessionId)
  if (child) {
    activeProcesses.delete(sessionId)
    try { child.kill('SIGTERM') } catch { /* ignore */ }
  }
}

/** 앱 종료 시 모든 리뷰 프로세스 정리 */
export function cleanupAllReviews(): void {
  for (const child of activeProcesses.values()) {
    try { child.kill('SIGTERM') } catch { /* ignore */ }
  }
  activeProcesses.clear()
}
