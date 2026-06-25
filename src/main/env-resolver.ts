/**
 * env-resolver — 셸 환경변수 및 Claude CLI 경로 탐색
 *
 * Electron 앱이 Finder에서 실행될 때 셸 PATH를 상속받지 못하는 문제를 해결하고,
 * claude CLI의 전체 경로를 탐색합니다.
 */

import { execSync, execFileSync } from 'child_process'
import { SHELL_ENV_TIMEOUT, CLAUDE_PATH_TIMEOUT } from '../shared/constants'

/**
 * 로그인 셸의 환경변수(PATH 등)를 가져옵니다.
 * Electron 앱이 Finder에서 실행될 때 셸 PATH를 상속받지 못하는 문제를 해결합니다.
 */
export function getShellEnv(): Record<string, string> {
  try {
    const shell = process.env.SHELL || '/bin/zsh'
    const output = execSync(`${shell} -ilc 'env'`, {
      encoding: 'utf-8',
      timeout: SHELL_ENV_TIMEOUT
    })
    const env: Record<string, string> = {}
    for (const line of output.split('\n')) {
      const idx = line.indexOf('=')
      if (idx > 0) {
        env[line.substring(0, idx)] = line.substring(idx + 1)
      }
    }
    return env
  } catch (err) {
    console.warn('[env-resolver] Failed to get shell env, using process.env:', (err as Error).message)
    return process.env as Record<string, string>
  }
}

/**
 * claude CLI의 전체 경로를 탐색합니다.
 *
 * 1차: 로그인 셸에서 `which claude`
 * 2차: 일반적인 설치 경로에서 직접 탐색
 *   - install.sh: ~/.claude/local/bin/claude
 *   - npm global: /usr/local/bin/claude, /opt/homebrew/bin/claude
 *   - npx cache 등
 */
export function findClaudePath(env: Record<string, string>): string {
  const home = env['HOME'] || process.env.HOME || ''
  return findCliPath(env, 'claude', [
    `${home}/.claude/local/bin/claude`,
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    `${home}/.npm-global/bin/claude`,
    '/usr/bin/claude'
  ])
}

/**
 * codex CLI(OpenAI Codex)의 전체 경로를 탐색합니다.
 * findClaudePath와 동일한 전략 (which → 일반 경로 → bare fallback).
 */
export function findCodexPath(env: Record<string, string>): string {
  const home = env['HOME'] || process.env.HOME || ''
  return findCliPath(env, 'codex', [
    `${home}/.codex/bin/codex`,
    '/usr/local/bin/codex',
    '/opt/homebrew/bin/codex',
    `${home}/.npm-global/bin/codex`,
    `${home}/.cargo/bin/codex`,
    '/usr/bin/codex'
  ])
}

/**
 * CLI 바이너리의 전체 경로를 탐색하는 공통 로직.
 *
 * 1차: 로그인 셸에서 `which <bin>`
 * 2차: commonPaths에서 직접 탐색 (--version 실행으로 검증)
 * 실패 시: bare 명령어 반환
 */
function findCliPath(env: Record<string, string>, bin: string, commonPaths: string[]): string {
  try {
    const shell = process.env.SHELL || '/bin/zsh'
    const result = execSync(`${shell} -ilc 'which ${bin}'`, {
      encoding: 'utf-8',
      timeout: SHELL_ENV_TIMEOUT,
      env
    }).trim()
    if (result) {
      // which 결과를 실제 실행하여 검증 (broken symlink/삭제된 바이너리 방지)
      try {
        execFileSync(result, ['--version'], { encoding: 'utf-8', timeout: CLAUDE_PATH_TIMEOUT })
        return result
      } catch {
        console.warn(`[env-resolver] "which ${bin}" returned ${result} but binary is not executable`)
      }
    }
  } catch (err) {
    console.warn(`[env-resolver] "which ${bin}" failed, trying common paths:`, (err as Error).message)
  }

  for (const p of commonPaths) {
    try {
      execFileSync(p, ['--version'], { encoding: 'utf-8', timeout: CLAUDE_PATH_TIMEOUT })
      return p
    } catch {
      // 다음 경로 시도
    }
  }

  console.warn(`[env-resolver] ${bin} CLI not found in any known path, falling back to bare "${bin}" command`)
  return bin
}
