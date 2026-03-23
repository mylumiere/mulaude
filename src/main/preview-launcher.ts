/**
 * PreviewLauncher — .claude/launch.json 기반 dev 서버 실행/관리
 *
 * Claude Code의 preview_start 방식을 따릅니다:
 *   1. .claude/launch.json에 정의된 configurations 읽기
 *   2. child_process.spawn으로 dev 서버 실행
 *   3. 세션/앱 종료 시 프로세스 정리
 *
 * launch.json 형식:
 * {
 *   "version": "0.0.1",
 *   "configurations": [
 *     {
 *       "name": "dev",
 *       "runtimeExecutable": "npm",
 *       "runtimeArgs": ["run", "dev"],
 *       "port": 5173
 *     }
 *   ]
 * }
 */

import { spawn, exec, execSync, type ChildProcess } from 'child_process'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { createConnection } from 'net'
import { BrowserWindow } from 'electron'
import { PREVIEW_SIGTERM_GRACE } from '../shared/constants'
import { getShellEnv } from './env-resolver'

/** 로그인 셸 환경변수 캐시 (Finder 실행 시 PATH 누락 방지) */
let shellEnvCache: Record<string, string> | null = null
function getCachedShellEnv(): Record<string, string> {
  if (!shellEnvCache) shellEnvCache = getShellEnv()
  return shellEnvCache
}

/* ─── Types ─── */

export interface LaunchConfiguration {
  /** 표시 이름 */
  name: string
  /** 실행 파일 (npm, npx, node 등) */
  runtimeExecutable: string
  /** 실행 인자 */
  runtimeArgs?: string[]
  /** 포트 번호 */
  port?: number
  /** 작업 디렉토리 (상대경로: 프로젝트 루트 기준) */
  cwd?: string
}

export interface LaunchConfig {
  version?: string
  configurations: LaunchConfiguration[]
}

export interface LaunchResult {
  config: LaunchConfig
  /** 미리보기 URL */
  previewUrl: string
  /** 새로 감지된 설정인지 */
  created: boolean
  /** launch.json에 정의된 프로세스 이름 순서 */
  processOrder: string[]
}

/* ─── launch.json 읽기/쓰기 ─── */

const LAUNCH_FILE = '.claude/launch.json'

export async function readLaunchConfig(workingDir: string): Promise<LaunchConfig | null> {
  try {
    const raw = await readFile(join(workingDir, LAUNCH_FILE), 'utf-8')
    const parsed = JSON.parse(raw)

    if (parsed.configurations && Array.isArray(parsed.configurations)) {
      return parsed as LaunchConfig
    }

    return null
  } catch {
    return null
  }
}

export async function writeLaunchConfig(workingDir: string, config: LaunchConfig): Promise<void> {
  const dir = join(workingDir, '.claude')
  await mkdir(dir, { recursive: true })
  await writeFile(join(workingDir, LAUNCH_FILE), JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

/* ─── 프로젝트 자동 감지 ─── */

/** 프레임워크별 기본 포트 */
function guessPort(script: string): number {
  const portMatch = script.match(/(?:--port|PORT=|-p)\s*(\d{3,5})/)
  if (portMatch) return parseInt(portMatch[1], 10)
  if (script.includes('vite')) return 5173
  if (script.includes('next')) return 3000
  if (script.includes('nuxt')) return 3000
  if (script.includes('gatsby')) return 8000
  if (script.includes('webpack-dev-server') || script.includes('webpack serve')) return 8080
  if (script.includes('parcel')) return 1234
  return 3000
}

/** package.json에서 dev script 감지 → LaunchConfiguration 생성 */
async function detectFromPackageJson(dir: string): Promise<LaunchConfiguration | null> {
  try {
    const raw = await readFile(join(dir, 'package.json'), 'utf-8')
    const pkg = JSON.parse(raw) as { name?: string; scripts?: Record<string, string>; devDependencies?: Record<string, string>; dependencies?: Record<string, string> }
    if (!pkg.scripts) return null

    // Electron/Tauri 프로젝트는 웹 미리보기 대상이 아님
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
    if (allDeps['electron'] || allDeps['electron-builder'] || allDeps['@electron-toolkit/utils'] || allDeps['@tauri-apps/cli']) {
      return null
    }

    const candidates = ['dev', 'start', 'serve']
    for (const name of candidates) {
      const script = pkg.scripts[name]
      if (!script) continue
      if (/electron|tauri/i.test(script)) continue
      return {
        name,
        runtimeExecutable: 'npm',
        runtimeArgs: ['run', name],
        port: guessPort(script)
      }
    }
    return null
  } catch {
    return null
  }
}

/** 디렉토리에서 프로젝트 감지 → LaunchConfig 생성 */
export async function detectProject(workingDir: string): Promise<LaunchConfig | null> {
  const config = await detectFromPackageJson(workingDir)
  if (!config) return null

  return {
    version: '0.0.1',
    configurations: [config]
  }
}

/** configuration에서 previewUrl 추출 */
function getPreviewUrl(config: LaunchConfig): string {
  const first = config.configurations[0]
  return `http://localhost:${first?.port || 3000}`
}

/* ─── 프로세스 실행/관리 ─── */

/** 세션별 실행 중인 프로세스 + 포트 추적 */
interface RunningProcess {
  child: ChildProcess
  port?: number
}
const runningProcesses = new Map<string, RunningProcess[]>()

export async function launchPreview(sessionId: string, workingDir: string): Promise<LaunchResult | null> {
  // 이미 실행 중이면 설정만 반환
  if (runningProcesses.has(sessionId)) {
    const config = await readLaunchConfig(workingDir) || await detectProject(workingDir)
    if (config) return { config, previewUrl: getPreviewUrl(config), created: false }
    return null
  }

  // 1. .claude/launch.json 읽기
  let config = await readLaunchConfig(workingDir)
  let created = false

  // 2. 없으면 자동 감지
  if (!config) {
    config = await detectProject(workingDir)
    if (!config) return null
    created = true
  }

  // 3. 프로세스 실행
  const children: RunningProcess[] = []
  const win = BrowserWindow.getAllWindows()[0] ?? null

  for (const cfg of config.configurations) {
    const cwd = cfg.cwd ? join(workingDir, cfg.cwd) : workingDir

    // 포트 충돌 감지 → 대체 포트 자동 할당
    let actualPort = cfg.port
    let args = [...(cfg.runtimeArgs || [])]
    if (actualPort) {
      const inUse = await isPortInUse(actualPort)
      if (inUse) {
        const altPort = await findAvailablePort(actualPort + 1)
        if (altPort) {
          console.log(`[PreviewLauncher] port ${actualPort} occupied, using ${altPort} for ${cfg.name}`)
          args = replacePortInArgs(args, actualPort, altPort)
          actualPort = altPort
          // config 객체도 업데이트 (previewUrl 반환에 반영)
          cfg.port = altPort
        } else {
          console.warn(`[PreviewLauncher] no available port near ${actualPort}, skipping ${cfg.name}`)
          continue
        }
      }
    }

    const cmd = cfg.runtimeExecutable

    try {
      const child = spawn(cmd, args, {
        cwd,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...getCachedShellEnv(), FORCE_COLOR: '0' }
      })

      // stdout/stderr → 렌더러로 전송
      const sendLog = (stream: 'stdout' | 'stderr', data: Buffer): void => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('preview:process-log', sessionId, cfg.name, stream, data.toString('utf-8'))
        }
      }
      child.stdout?.on('data', (data: Buffer) => sendLog('stdout', data))
      child.stderr?.on('data', (data: Buffer) => sendLog('stderr', data))

      child.on('error', (err) => {
        console.error(`[PreviewLauncher] ${cfg.name} error:`, err.message)
        if (win && !win.isDestroyed()) {
          win.webContents.send('preview:process-log', sessionId, cfg.name, 'stderr', `[error] ${err.message}\n`)
        }
      })

      child.on('exit', (code) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('preview:process-log', sessionId, cfg.name, 'stderr', `[process exited with code ${code}]\n`)
        }
      })

      children.push({ child, port: actualPort })
      console.log(`[PreviewLauncher] started ${cfg.name} (pid=${child.pid}, port=${actualPort}): ${cmd} ${args.join(' ')} in ${cwd}`)
    } catch (err) {
      console.error(`[PreviewLauncher] failed to start ${cfg.name}:`, err)
    }
  }

  if (children.length > 0) {
    runningProcesses.set(sessionId, children)
  }

  return { config, previewUrl: getPreviewUrl(config), created, processOrder: config.configurations.map(c => c.name) }
}

/** 포트를 LISTEN하는 프로세스만 찾아서 강제 종료 (mulaude 자체 프로세스 제외) */
function killByPort(port: number, excludePids: Set<number>): void {
  // -sTCP:LISTEN → LISTEN 상태만 매칭 (Electron iframe의 ESTABLISHED 연결 제외)
  exec(`lsof -ti :${port} -sTCP:LISTEN`, (err, stdout) => {
    if (err || !stdout.trim()) return
    const pids = stdout.trim().split('\n').map(Number).filter((p) => p > 0 && !excludePids.has(p))
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGKILL')
        console.log(`[PreviewLauncher] killed port ${port} listener pid=${pid}`)
      } catch { /* 이미 종료됨 */ }
    }
  })
}

/** mulaude 프로세스 PID 집합 (killByPort에서 제외용) */
function getOwnPids(): Set<number> {
  const pids = new Set<number>()
  pids.add(process.pid)       // main process
  pids.add(process.ppid ?? 0) // parent (Electron shell)
  // Electron renderer/GPU helper 등은 ppid가 main process이므로
  // pgrep -P로 자식 PID도 수집
  try {
    const children = execSync(`pgrep -P ${process.pid}`, { encoding: 'utf-8' }).trim()
    if (children) children.split('\n').forEach((p: string) => pids.add(Number(p)))
  } catch { /* pgrep 실패 무시 */ }
  pids.delete(0)
  return pids
}

/** 세션의 프로세스 종료 */
export function stopPreview(sessionId: string): void {
  const entries = runningProcesses.get(sessionId)
  if (!entries) return

  const ports: number[] = []

  for (const { child, port } of entries) {
    if (port) ports.push(port)
    // 직접 자식(shell/npm)에 SIGTERM
    try { child.kill('SIGTERM') } catch { /* 이미 종료됨 */ }
  }

  // shell이 죽어도 남는 자식(vite 등)을 포트 기반으로 확실히 정리
  // mulaude 자체 프로세스(dev 서버 등)는 절대 죽이지 않음
  if (ports.length > 0) {
    const ownPids = getOwnPids()
    // SIGTERM 후 대기 시간 — 자식 프로세스 정리 후 포트 kill
    setTimeout(() => {
      for (const port of ports) {
        killByPort(port, ownPids)
      }
    }, PREVIEW_SIGTERM_GRACE)
  }

  runningProcesses.delete(sessionId)
  console.log(`[PreviewLauncher] stopped processes for session ${sessionId}`)
}

/** 모든 프로세스 종료 (앱 종료 시) */
export function stopAllPreviews(): void {
  for (const sessionId of runningProcesses.keys()) {
    stopPreview(sessionId)
  }
}

/** 사용 가능한 포트 찾기 (startPort부터 20개 범위 탐색) */
async function findAvailablePort(startPort: number): Promise<number | null> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (!(await isPortInUse(port))) return port
  }
  return null
}

/**
 * 실행 인자에서 포트 번호를 교체
 * "--port 5173" → "--port 5174", "-p 5173" → "-p 5174" 등
 * 포트 인자가 없으면 "--port newPort"를 추가
 */
function replacePortInArgs(args: string[], oldPort: number, newPort: number): string[] {
  const result = [...args]
  let replaced = false

  for (let i = 0; i < result.length; i++) {
    // "--port 5173" 또는 "-p 5173" (분리된 형태)
    if (/^(--port|-p)$/.test(result[i]) && result[i + 1] === String(oldPort)) {
      result[i + 1] = String(newPort)
      replaced = true
      break
    }
    // "--port=5173" (합쳐진 형태)
    if (result[i] === `--port=${oldPort}`) {
      result[i] = `--port=${newPort}`
      replaced = true
      break
    }
    // "PORT=5173" (환경변수 형태)
    if (result[i] === `PORT=${oldPort}`) {
      result[i] = `PORT=${newPort}`
      replaced = true
      break
    }
  }

  // 포트 인자가 없으면 추가
  if (!replaced) {
    result.push('--port', String(newPort))
  }

  return result
}

/** 포트 사용 중 확인 */
function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => {
      resolve(false)
    })
    socket.setTimeout(500, () => {
      socket.destroy()
      resolve(false)
    })
  })
}
