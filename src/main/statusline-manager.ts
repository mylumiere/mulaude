/**
 * Statusline Manager - Context + Rate Limit 통합 관리
 *
 * Claude Code 네이티브 Statusline API로 Context %를 수집하고,
 * Rate Limit은 claude-hud 캐시 또는 Keychain OAuth API에서 가져옵니다.
 *
 * 구성:
 *   A. Statusline 스크립트 관리 (~/.mulaude/statusline.mjs)
 *      - stdin JSON → ~/.mulaude/ctx/{session_id}.json 기록
 *      - 프록시 모드: ~/.mulaude/proxy-cmd 파일이 존재하면 원래 statusline도 실행
 *   B. Context 데이터 감시 (3초 폴링)
 *      - context_window.used_percentage 추출
 *      - statusline:context-batch IPC
 *   C. Rate Limit 데이터 (60초 폴링)
 *      - 소스 1: claude-hud 캐시 (.usage-cache.json)
 *      - 소스 2: Keychain OAuth API (사용자 opt-in 필요)
 *      - usage:updated IPC
 *   D. Hide HUD 토글
 *      - ON: 빈 출력 (기본값) + 백그라운드 폴러로 claude-hud 캐시 갱신
 *      - OFF: 원래 statusline 프록시 (시각적 오버레이 표시)
 */

import type { BrowserWindow } from 'electron'
import {
  readFileSync, writeFileSync, readdirSync,
  mkdirSync, existsSync, unlinkSync
} from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import { logger } from './logger'
import { STATUSLINE_CTX_POLL_INTERVAL, USAGE_API_POLL_INTERVAL } from '../shared/constants'
import type { UsageData, ContextBudget } from '../shared/types'

const MULAUDE_DIR = join(homedir(), '.mulaude')
const CTX_DIR = join(MULAUDE_DIR, 'ctx')
const STATUSLINE_SCRIPT_PATH = join(MULAUDE_DIR, 'statusline.mjs')
const PROXY_CMD_PATH = join(MULAUDE_DIR, 'proxy-cmd')
const CLAUDE_SETTINGS_PATH = join(homedir(), '.claude', 'settings.json')
const PLUGINS_DIR = join(homedir(), '.claude', 'plugins')

const execFileAsync = promisify(execFile)

/** HUD 백그라운드 폴링 간격 (ms) — HUD 숨김 시 claude-hud 캐시 갱신용 */
const HUD_POLL_INTERVAL = 30000

/**
 * Statusline MJS 스크립트 — Claude Code가 실행하는 외부 커맨드
 *
 * 1. stdin JSON을 ctx 디렉토리에 파일로 기록 (context 데이터 수집)
 * 2. ~/.mulaude/proxy-cmd 파일이 존재하면 원래 statusline 커맨드를 실행하여
 *    그 출력을 stdout으로 전달 (HUD 표시 모드)
 * 3. proxy-cmd 없으면 빈 문자열 출력 (HUD 숨김 모드)
 */
const STATUSLINE_SCRIPT = `#!/usr/bin/env node
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

const CTX_DIR = join(homedir(), '.mulaude', 'ctx');
const PROXY_PATH = join(homedir(), '.mulaude', 'proxy-cmd');
mkdirSync(CTX_DIR, { recursive: true });

let input = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', d => input += d);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const sid = data.session_id;
    if (sid) writeFileSync(join(CTX_DIR, sid + '.json'), input);
  } catch {}

  // 프록시 모드: 원래 statusline 커맨드 실행
  try {
    const proxyCmd = readFileSync(PROXY_PATH, 'utf-8').trim();
    if (proxyCmd) {
      const out = execSync(proxyCmd, { input, timeout: 10000, encoding: 'utf-8' });
      process.stdout.write(out || '');
      return;
    }
  } catch {}

  process.stdout.write('');
});
`

/** Keychain의 subscriptionType/rateLimitTier 문자열에서 플랜 이름을 추출합니다 */
function derivePlanName(subscriptionType: string): string {
  const lower = subscriptionType.toLowerCase()
  if (lower.includes('max')) return 'Max'
  if (lower.includes('team')) return 'Team'
  if (lower.includes('pro')) return 'Pro'
  if (!subscriptionType) return 'Pro'
  return subscriptionType.charAt(0).toUpperCase() + subscriptionType.slice(1)
}

// ─── 상태 ───

let cachedUsageData: UsageData | null = null
let mainWindowRef: BrowserWindow | null = null
let ctxPollTimer: ReturnType<typeof setInterval> | null = null
let usagePollTimer: ReturnType<typeof setInterval> | null = null
let hudPollTimer: ReturnType<typeof setInterval> | null = null
let keychainEnabled = false

// ─── A. Statusline 스크립트 관리 ───

/** statusline 스크립트를 작성하고 settings.json에 등록합니다 */
function installStatusline(): void {
  try {
    mkdirSync(CTX_DIR, { recursive: true })
    writeFileSync(STATUSLINE_SCRIPT_PATH, STATUSLINE_SCRIPT, { mode: 0o755 })
    logger.info('Statusline', `Script written to ${STATUSLINE_SCRIPT_PATH}`)

    let settings: Record<string, unknown> = {}
    try {
      settings = JSON.parse(readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8'))
    } catch (err) {
      if (existsSync(CLAUDE_SETTINGS_PATH)) {
        logger.warn('Statusline', 'settings.json parse failed, skipping to avoid data loss', err)
        return
      }
      mkdirSync(join(homedir(), '.claude'), { recursive: true })
    }

    // 기존 statusLine 백업 (Mulaude 스크립트가 아닌 경우에만)
    const currentStatusLine = settings.statusLine as { command?: string } | undefined
    if (currentStatusLine?.command && !currentStatusLine.command.includes('mulaude')) {
      settings._mulaudeStatusLineBackup = currentStatusLine
      logger.info('Statusline', 'Backed up existing statusLine')
    }

    settings.statusLine = { type: 'command', command: `node ${STATUSLINE_SCRIPT_PATH}` }
    writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8')
    logger.info('Statusline', 'Registered statusLine in settings.json')
  } catch (err) {
    logger.error('Statusline', 'Failed to install statusline', err)
  }
}

/** 백업된 statusline 커맨드를 반환합니다 */
function getBackupCommand(): string | null {
  try {
    const settings = JSON.parse(readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8'))
    const backup = settings._mulaudeStatusLineBackup as { command?: string } | undefined
    return backup?.command || null
  } catch {
    return null
  }
}

/** 프록시 모드 전환 (Hide HUD 토글) */
function updateProxyMode(hideHud: boolean): void {
  try {
    if (hideHud) {
      // HUD 숨김: proxy-cmd 파일 삭제 → 빈 출력
      try { unlinkSync(PROXY_CMD_PATH) } catch {}
    } else {
      // HUD 표시: proxy-cmd 파일에 원래 커맨드 기록 → 프록시 출력
      const backupCmd = getBackupCommand()
      if (backupCmd) {
        writeFileSync(PROXY_CMD_PATH, backupCmd, 'utf-8')
      }
    }
  } catch (err) {
    logger.error('Statusline', 'Failed to update proxy mode', err)
  }
}

// ─── B. Context 데이터 감시 ───

/** ctx 디렉토리를 폴링하여 context % 데이터를 수집합니다 */
function pollContextData(mainWindow: BrowserWindow): void {
  try {
    if (!existsSync(CTX_DIR)) return

    const files = readdirSync(CTX_DIR).filter(f => f.endsWith('.json'))
    if (files.length === 0) return

    const batch: Record<string, number> = {}
    const budgetBatch: Record<string, ContextBudget> = {}
    for (const file of files) {
      try {
        const raw = readFileSync(join(CTX_DIR, file), 'utf-8')
        const data = JSON.parse(raw)
        const sessionId = data.session_id
        if (!sessionId) continue

        const ctx = data.context_window
        if (ctx) {
          let pct: number | null = null
          let usedTokens = 0
          let totalTokens = 0

          if (typeof ctx.used_percentage === 'number') {
            pct = ctx.used_percentage
          } else if (typeof ctx.percentage === 'number') {
            pct = ctx.percentage
          } else if (typeof ctx.used_tokens === 'number' && typeof ctx.total_tokens === 'number' && ctx.total_tokens > 0) {
            pct = Math.round((ctx.used_tokens / ctx.total_tokens) * 100)
          } else if (typeof ctx.used === 'number' && typeof ctx.total === 'number' && ctx.total > 0) {
            pct = Math.round((ctx.used / ctx.total) * 100)
          }

          // 토큰 수 추출 (다양한 필드명 대응)
          if (typeof ctx.used_tokens === 'number') usedTokens = ctx.used_tokens
          else if (typeof ctx.used === 'number') usedTokens = ctx.used
          if (typeof ctx.total_tokens === 'number') totalTokens = ctx.total_tokens
          else if (typeof ctx.total === 'number') totalTokens = ctx.total

          if (pct !== null) {
            batch[sessionId] = pct
            budgetBatch[sessionId] = {
              usedPct: pct,
              usedTokens,
              totalTokens,
              breakdown: { filesRead: 0, turnsConsumed: 0, agentsActive: 0 }
            }
          }
        }
      } catch {
        // 개별 파일 파싱 실패 무시
      }
    }

    if (Object.keys(batch).length > 0 && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('statusline:context-batch', batch)
      mainWindow.webContents.send('statusline:context-budget-batch', budgetBatch)
    }
  } catch {}
}

// ─── C. Rate Limit 데이터 ───

/**
 * ~/.claude/plugins/ 하위에서 .usage-cache.json 파일을 찾습니다.
 * claude-hud, oh-my-open-claude 등 다양한 플러그인 대응.
 */
function findHudCachePath(): string | null {
  try {
    if (!existsSync(PLUGINS_DIR)) return null
    const dirs = readdirSync(PLUGINS_DIR)
    for (const dir of dirs) {
      const cachePath = join(PLUGINS_DIR, dir, '.usage-cache.json')
      if (existsSync(cachePath)) return cachePath
    }
  } catch {}
  return null
}

/** HUD 플러그인 캐시에서 사용량 데이터를 읽습니다 */
function readHudCacheData(): UsageData | null {
  try {
    const cachePath = findHudCachePath()
    if (!cachePath) return null
    const raw = readFileSync(cachePath, 'utf-8')
    const parsed = JSON.parse(raw)
    const d = parsed.data
    if (!d) return null
    return {
      planName: d.planName || 'Pro',
      fiveHour: d.fiveHour ?? 0,
      sevenDay: d.sevenDay ?? 0,
      fiveHourResetAt: d.fiveHourResetAt || '',
      sevenDayResetAt: d.sevenDayResetAt || '',
      lastUpdated: typeof parsed.timestamp === 'number' ? parsed.timestamp : Date.now(),
      source: 'hud'
    }
  } catch {
    return null
  }
}

/**
 * macOS Keychain에서 OAuth 토큰을 읽어 Usage API를 호출합니다.
 *
 * 이 토큰은 사용량 조회(GET /api/oauth/usage)에만 사용되며,
 * 다른 목적으로 저장·전송되지 않습니다.
 *
 * API 응답 구조:
 *   { five_hour: { utilization: 19, resets_at: "ISO8601" },
 *     seven_day: { utilization: 43, resets_at: "ISO8601" }, ... }
 */
async function fetchUsageViaKeychain(): Promise<UsageData | null> {
  try {
    const { stdout: userOut } = await execFileAsync('whoami', [], { timeout: 2000, encoding: 'utf-8' })
    const user = userOut.trim()
    const { stdout: rawOut } = await execFileAsync(
      'security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-a', user, '-w'],
      { timeout: 5000, encoding: 'utf-8' }
    )
    const raw = rawOut.trim()
    if (!raw) return null

    const creds = JSON.parse(raw)
    const oauth = creds.claudeAiOauth
    const token = oauth?.accessToken
    if (!token) return null

    // subscriptionType / rateLimitTier에서 플랜 이름 추출
    const planName = derivePlanName(oauth?.subscriptionType || oauth?.rateLimitTier || '')

    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'claude-code/2.0.32',
        'Accept': 'application/json'
      }
    })
    if (!res.ok) {
      logger.info('Statusline', `Keychain API failed: ${res.status} ${res.statusText}`)
      return null
    }

    const data = await res.json() as Record<string, unknown>
    const fiveHour = data.five_hour as { utilization?: number; resets_at?: string } | null
    const sevenDay = data.seven_day as { utilization?: number; resets_at?: string } | null

    return {
      planName,
      fiveHour: fiveHour?.utilization ?? 0,
      sevenDay: sevenDay?.utilization ?? 0,
      fiveHourResetAt: fiveHour?.resets_at || '',
      sevenDayResetAt: sevenDay?.resets_at || '',
      lastUpdated: Date.now(),
      source: 'keychain'
    }
  } catch (err) {
    logger.error('Statusline', 'Keychain fetch failed', err)
    return null
  }
}

/**
 * Rate limit 데이터를 수집합니다.
 *
 * 우선순위:
 *   keychainEnabled → Keychain OAuth 우선 → HUD 캐시 fallback
 *   !keychainEnabled → HUD 캐시만
 *
 * 사용자가 명시적으로 Keychain을 허용했으면 항상 최신 API를 우선합니다.
 */
async function pollUsageData(mainWindow: BrowserWindow): Promise<void> {
  let data: UsageData | null = null

  if (keychainEnabled) {
    // 사용자가 Keychain 허용 → API 우선
    data = await fetchUsageViaKeychain()
    logger.info('Statusline', `Keychain API: ${data ? `${data.fiveHour}%/${data.sevenDay}%` : 'null'}`)
    // API 실패 시 HUD 캐시 fallback
    if (!data) {
      data = readHudCacheData()
      logger.info('Statusline', `HUD cache fallback: ${data ? `${data.fiveHour}%/${data.sevenDay}%` : 'null'}`)
    }
  } else {
    // Keychain 미허용 → HUD 캐시만
    data = readHudCacheData()
    logger.info('Statusline', `HUD cache: ${data ? `${data.fiveHour}%/${data.sevenDay}%` : 'null'}`)
  }

  cachedUsageData = data
  if (!mainWindow.isDestroyed()) {
    mainWindow.webContents.send('usage:updated', data)
  }
}

// ─── D. HUD 백그라운드 폴러 ───

/** HUD 숨김 시 claude-hud 캐시를 갱신하기 위해 원래 커맨드를 주기적으로 실행합니다 */
function startHudPoller(): void {
  stopHudPoller()
  const backupCmd = getBackupCommand()
  if (!backupCmd) return

  const run = (): void => { exec(backupCmd, { timeout: 10000 }, () => {}) }
  run()
  hudPollTimer = setInterval(run, HUD_POLL_INTERVAL)
  logger.info('Statusline', 'Started HUD background poller')
}

function stopHudPoller(): void {
  if (hudPollTimer) {
    clearInterval(hudPollTimer)
    hudPollTimer = null
  }
}

// ─── Public API ───

/** 모든 감시를 시작합니다 */
export function startWatching(mainWindow: BrowserWindow, hideHud: boolean, useKeychain: boolean): void {
  // 기존 타이머 정리 (중복 호출 방지)
  if (ctxPollTimer) { clearInterval(ctxPollTimer); ctxPollTimer = null }
  if (usagePollTimer) { clearInterval(usagePollTimer); usagePollTimer = null }

  mainWindowRef = mainWindow
  keychainEnabled = useKeychain

  installStatusline()
  updateProxyMode(hideHud)

  // 이전 실행에서 남은 ctx 파일 정리 (크래시 시 잔류 파일 제거)
  try {
    if (existsSync(CTX_DIR)) {
      for (const f of readdirSync(CTX_DIR).filter(f => f.endsWith('.json'))) {
        try { unlinkSync(join(CTX_DIR, f)) } catch {}
      }
    }
  } catch {}

  // HUD 숨김 시 백그라운드 폴러로 claude-hud 캐시 갱신
  if (hideHud) startHudPoller()

  // Context 폴링 (3초 간격)
  pollContextData(mainWindow)
  ctxPollTimer = setInterval(() => pollContextData(mainWindow), STATUSLINE_CTX_POLL_INTERVAL)

  // Usage 폴링 (60초 간격)
  pollUsageData(mainWindow)
  usagePollTimer = setInterval(() => pollUsageData(mainWindow), USAGE_API_POLL_INTERVAL)
}

/** Hide HUD 토글 시 호출 — 즉시 usage 재폴링 트리거 */
export function setHideHud(hide: boolean): void {
  updateProxyMode(hide)
  if (hide) {
    startHudPoller()
  } else {
    stopHudPoller()
  }
  // 토글 직후 즉시 usage 데이터 갱신
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    pollUsageData(mainWindowRef)
  }
}

/** Keychain 사용 여부 변경 시 호출 */
export function setKeychainAccess(enabled: boolean): void {
  keychainEnabled = enabled
  // 즉시 폴링 트리거
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    pollUsageData(mainWindowRef)
  }
}

/** 캐시된 usage 데이터를 반환합니다 (IPC usage:read 핸들러용) */
export function getCachedUsageData(): UsageData | null {
  return cachedUsageData
}

/** 모든 감시를 중지하고 statusLine을 원래대로 복원합니다 */
export function cleanup(): void {
  if (ctxPollTimer) { clearInterval(ctxPollTimer); ctxPollTimer = null }
  if (usagePollTimer) { clearInterval(usagePollTimer); usagePollTimer = null }
  stopHudPoller()

  // proxy-cmd 파일 삭제
  try { unlinkSync(PROXY_CMD_PATH) } catch {}

  // statusLine 복원
  try {
    const raw = readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8')
    const settings = JSON.parse(raw)

    const current = settings.statusLine as { command?: string } | undefined
    if (current?.command?.includes('mulaude')) {
      if (settings._mulaudeStatusLineBackup) {
        settings.statusLine = settings._mulaudeStatusLineBackup
        delete settings._mulaudeStatusLineBackup
        logger.info('Statusline', 'Restored original statusLine')
      } else {
        delete settings.statusLine
        logger.info('Statusline', 'Removed Mulaude statusLine (no backup)')
      }
      writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8')
    }
  } catch (err) {
    logger.warn('Statusline', 'Failed to restore statusLine during cleanup', err)
  }

  // ctx 디렉토리 정리
  try {
    if (existsSync(CTX_DIR)) {
      for (const f of readdirSync(CTX_DIR).filter(f => f.endsWith('.json'))) {
        try { unlinkSync(join(CTX_DIR, f)) } catch {}
      }
    }
  } catch {}
}
