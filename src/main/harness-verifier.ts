/**
 * HarnessVerifier — Edit/Write 후 자동 검증 파이프라인
 *
 * HarnessTracker에서 파일 변경 이벤트를 수신하면 디바운스 후
 * 프로젝트 디렉토리에서 typecheck/lint/test 명령을 실행합니다.
 *
 * 동작:
 *   1. harnessTracker.onFileChange() → 파일 변경 알림 수신
 *   2. 디바운스(2초) 후 검증 명령 실행 (실행 중이면 취소 후 재시작)
 *   3. 결과를 harness:verification-result IPC로 렌더러에 push
 *
 * 검증 명령 자동 감지:
 *   - tsconfig.json 존재 → tsc --noEmit
 *   - package.json scripts.test → npm test (또는 pnpm/yarn)
 *   - package.json scripts.lint → npm run lint
 */

import type { BrowserWindow } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { exec, type ChildProcess } from 'child_process'
import { logger } from './logger'
import type { VerificationResult, VerificationConfig } from '../shared/types'
import { HARNESS_VERIFY_DEBOUNCE, HARNESS_VERIFY_TIMEOUT } from '../shared/constants'

const CONFIG_PATH = join(homedir(), '.mulaude', 'harness-config.json')

export class HarnessVerifier {
  private mainWindow: BrowserWindow | null = null
  /** 세션별 디바운스 타이머 */
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** 세션별 진행 중인 프로세스 */
  private runningProcesses = new Map<string, ChildProcess>()
  /** 세션별 작업 디렉토리 (프로젝트 루트) */
  private workingDirs = new Map<string, string>()
  /** 설정 */
  private config: VerificationConfig

  constructor() {
    this.config = this.loadConfig()
  }

  start(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
  }

  cleanup(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer)
    }
    this.debounceTimers.clear()

    for (const proc of this.runningProcesses.values()) {
      try { proc.kill('SIGTERM') } catch {}
    }
    this.runningProcesses.clear()
  }

  /** 세션의 작업 디렉토리 등록 */
  setWorkingDir(sessionId: string, workingDir: string): void {
    this.workingDirs.set(sessionId, workingDir)
  }

  /** 파일 변경 이벤트 핸들러 (HarnessTracker.onFileChange에서 호출) */
  handleFileChange(sessionId: string, _filePaths: string[]): void {
    if (!this.config.autoVerify) return

    // 기존 디바운스 취소
    const existing = this.debounceTimers.get(sessionId)
    if (existing) clearTimeout(existing)

    // 디바운스
    this.debounceTimers.set(sessionId, setTimeout(() => {
      this.debounceTimers.delete(sessionId)
      this.runVerifications(sessionId)
    }, this.config.debounceMs))
  }

  /** 수동 검증 실행 (렌더러에서 요청) */
  runManualVerification(sessionId: string, type: string): void {
    const workingDir = this.workingDirs.get(sessionId)
    if (!workingDir) return

    const verifier = this.config.verifiers[type]
    if (!verifier || !verifier.enabled) return

    this.executeVerification(sessionId, workingDir, type, verifier.command)
  }

  /** 설정 읽기 */
  getConfig(): VerificationConfig {
    return this.config
  }

  /** 설정 업데이트 */
  updateConfig(newConfig: Partial<VerificationConfig>): void {
    this.config = { ...this.config, ...newConfig }
    this.saveConfig()
  }

  /** 전체 검증 실행 */
  private runVerifications(sessionId: string): void {
    const workingDir = this.workingDirs.get(sessionId)
    if (!workingDir) return

    // 기존 프로세스 킬
    const existing = this.runningProcesses.get(sessionId)
    if (existing) {
      try { existing.kill('SIGTERM') } catch {}
      this.runningProcesses.delete(sessionId)
    }

    // 자동 감지된 검증기 구성
    const verifiers = this.detectVerifiers(workingDir)
    for (const [type, command] of Object.entries(verifiers)) {
      const userVerifier = this.config.verifiers[type]
      if (userVerifier && !userVerifier.enabled) continue

      const cmd = userVerifier?.command || command
      this.executeVerification(sessionId, workingDir, type, cmd)
    }
  }

  /** 단일 검증 실행 */
  private executeVerification(sessionId: string, workingDir: string, type: string, command: string): void {
    const startTime = Date.now()

    // running 상태 먼저 전송
    this.sendResult(sessionId, {
      type: type as VerificationResult['type'],
      status: 'running',
      output: '',
      exitCode: null,
      timestamp: startTime,
      durationMs: 0
    })

    const proc = exec(command, {
      cwd: workingDir,
      timeout: this.config.timeoutMs,
      maxBuffer: 1024 * 1024, // 1MB
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }
    }, (error, stdout, stderr) => {
      this.runningProcesses.delete(`${sessionId}:${type}`)

      const durationMs = Date.now() - startTime
      const output = (stdout + stderr).slice(0, 5000) // 출력 제한
      const exitCode = error ? (error as NodeJS.ErrnoException & { code?: number }).code ?? 1 : 0

      this.sendResult(sessionId, {
        type: type as VerificationResult['type'],
        status: exitCode === 0 ? 'pass' : 'fail',
        output,
        exitCode: typeof exitCode === 'number' ? exitCode : 1,
        timestamp: startTime,
        durationMs
      })
    })

    this.runningProcesses.set(`${sessionId}:${type}`, proc)
  }

  /** 결과를 렌더러에 전송 */
  private sendResult(sessionId: string, result: VerificationResult): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('harness:verification-result', sessionId, result)
    }
  }

  /** 프로젝트에서 사용 가능한 검증기 자동 감지 */
  private detectVerifiers(workingDir: string): Record<string, string> {
    const verifiers: Record<string, string> = {}

    // TypeScript
    if (existsSync(join(workingDir, 'tsconfig.json'))) {
      verifiers.typecheck = 'npx tsc --noEmit'
    }

    // package.json scripts
    try {
      const pkg = JSON.parse(readFileSync(join(workingDir, 'package.json'), 'utf-8'))
      if (pkg.scripts?.lint) verifiers.lint = 'npm run lint'
      if (pkg.scripts?.test) verifiers.test = 'npm test'
    } catch {}

    return verifiers
  }

  /** 설정 로드 */
  private loadConfig(): VerificationConfig {
    try {
      if (existsSync(CONFIG_PATH)) {
        return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
      }
    } catch {}

    return {
      autoVerify: true,
      verifiers: {},
      debounceMs: HARNESS_VERIFY_DEBOUNCE,
      timeoutMs: HARNESS_VERIFY_TIMEOUT
    }
  }

  /** 설정 저장 */
  private saveConfig(): void {
    try {
      mkdirSync(join(homedir(), '.mulaude'), { recursive: true })
      writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf-8')
    } catch (err) {
      logger.error('Verifier', 'Failed to save config', err)
    }
  }
}
