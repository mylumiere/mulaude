/**
 * HarnessGuardrails — 에이전트 행동 제약 규칙 관리 + 위반 감지
 *
 * Hook 이벤트를 수신하여 등록된 GuardRail 규칙과 매칭하고,
 * 위반 발생 시 렌더러에 알림 + 데스크톱 알림을 발송합니다.
 *
 * 규칙 유형:
 *   - protected_file: 보호 파일 패턴 (*.env, credentials*)
 *   - blocked_command: 차단 명령 패턴 (rm -rf /, git push --force)
 *   - approval_gate: 승인 필요 명령 (sudo *)
 *
 * 설정: ~/.mulaude/guardrails.json
 */

import type { BrowserWindow, Notification as ElectronNotification } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { Notification } from 'electron'
import { logger } from './logger'
import type { HookEvent, GuardRail, GuardRailViolation } from '../shared/types'

const GUARDRAILS_PATH = join(homedir(), '.mulaude', 'guardrails.json')

/** 기본 규칙 */
const DEFAULT_RULES: GuardRail[] = [
  { id: 'pf-env', type: 'protected_file', pattern: '*.env', action: 'alert', enabled: true },
  { id: 'pf-creds', type: 'protected_file', pattern: 'credentials*', action: 'alert', enabled: true },
  { id: 'pf-key', type: 'protected_file', pattern: '*.key', action: 'alert', enabled: true },
  { id: 'pf-pem', type: 'protected_file', pattern: '*.pem', action: 'alert', enabled: true },
  { id: 'bc-rmrf', type: 'blocked_command', pattern: 'rm -rf /', action: 'alert', enabled: true },
  { id: 'bc-force', type: 'blocked_command', pattern: 'git push --force', action: 'alert', enabled: true },
  { id: 'ag-sudo', type: 'approval_gate', pattern: 'sudo *', action: 'alert', enabled: true }
]

export class HarnessGuardrails {
  private mainWindow: BrowserWindow | null = null
  private rules: GuardRail[] = []
  /** 세션별 위반 이력 */
  private violations = new Map<string, GuardRailViolation[]>()

  constructor() {
    this.rules = this.loadRules()
  }

  start(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
  }

  cleanup(): void {
    this.violations.clear()
  }

  /** 규칙 목록 읽기 */
  getRules(): GuardRail[] {
    return this.rules
  }

  /** 규칙 추가 */
  addRule(rule: GuardRail): void {
    this.rules.push(rule)
    this.saveRules()
  }

  /** 규칙 업데이트 */
  updateRule(id: string, updates: Partial<GuardRail>): void {
    const idx = this.rules.findIndex(r => r.id === id)
    if (idx >= 0) {
      this.rules[idx] = { ...this.rules[idx], ...updates }
      this.saveRules()
    }
  }

  /** 규칙 삭제 */
  deleteRule(id: string): void {
    this.rules = this.rules.filter(r => r.id !== id)
    this.saveRules()
  }

  /** 세션별 위반 목록 */
  getViolations(sessionId: string): GuardRailViolation[] {
    return this.violations.get(sessionId) || []
  }

  /** 전체 위반 목록 */
  getAllViolations(): Record<string, GuardRailViolation[]> {
    const result: Record<string, GuardRailViolation[]> = {}
    for (const [id, v] of this.violations) {
      result[id] = v
    }
    return result
  }

  /**
   * Hook 이벤트를 검사하여 규칙 위반을 감지합니다.
   *
   * PreToolUse 시점에서 호출됩니다.
   */
  check(sessionId: string, event: HookEvent): void {
    if (event.hook_event_name !== 'PreToolUse') return

    const toolName = event.tool_name || ''
    const toolInput = event.tool_input || {}

    for (const rule of this.rules) {
      if (!rule.enabled) continue

      let matched = false
      let detail = ''

      switch (rule.type) {
        case 'protected_file': {
          const filePath = (toolInput.file_path as string) || ''
          if (filePath && this.matchGlob(filePath, rule.pattern)) {
            matched = true
            detail = filePath
          }
          break
        }

        case 'blocked_command': {
          const command = (toolInput.command as string) || ''
          if (command && this.matchPattern(command, rule.pattern)) {
            matched = true
            detail = command.length > 100 ? command.slice(0, 97) + '...' : command
          }
          break
        }

        case 'approval_gate': {
          const command = (toolInput.command as string) || ''
          if (command && this.matchPattern(command, rule.pattern)) {
            matched = true
            detail = command.length > 100 ? command.slice(0, 97) + '...' : command
          }
          break
        }
      }

      if (matched) {
        const violation: GuardRailViolation = {
          ruleId: rule.id,
          sessionId,
          toolName,
          detail,
          timestamp: Date.now(),
          action: rule.action === 'block' ? 'blocked' : 'alerted'
        }

        // 위반 이력 저장
        if (!this.violations.has(sessionId)) {
          this.violations.set(sessionId, [])
        }
        const sessionViolations = this.violations.get(sessionId)!
        sessionViolations.push(violation)
        // 최대 50개 유지
        if (sessionViolations.length > 50) {
          sessionViolations.splice(0, sessionViolations.length - 50)
        }

        // 렌더러에 위반 알림
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('harness:guardrail-violation', sessionId, violation)
        }

        // 데스크톱 알림
        if (Notification.isSupported()) {
          const notif = new Notification({
            title: `Guard Rail: ${rule.type}`,
            body: `${violation.action}: ${detail}`,
            silent: false
          })
          notif.show()
        }

        logger.info('GuardRails', `${violation.action}: ${rule.type} "${rule.pattern}" matched "${detail}" in session ${sessionId}`)
      }
    }
  }

  /** glob 패턴 매칭 (간단 구현) */
  private matchGlob(filePath: string, pattern: string): boolean {
    // 파일 이름만 추출
    const fileName = filePath.split('/').pop() || filePath

    // *.ext 패턴
    if (pattern.startsWith('*.')) {
      return fileName.endsWith(pattern.slice(1))
    }
    // name* 패턴
    if (pattern.endsWith('*')) {
      return fileName.startsWith(pattern.slice(0, -1))
    }
    // 정확한 매칭
    return fileName === pattern || filePath.includes(pattern)
  }

  /** 명령어 패턴 매칭 (간단 구현) */
  private matchPattern(command: string, pattern: string): boolean {
    // 와일드카드 * → .* 로 변환하여 regex 매칭
    const regexStr = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // 특수문자 이스케이프
      .replace(/\*/g, '.*')                   // * → .*
    try {
      return new RegExp(regexStr).test(command)
    } catch {
      return command.includes(pattern.replace(/\*/g, ''))
    }
  }

  /** 규칙 로드 */
  private loadRules(): GuardRail[] {
    try {
      if (existsSync(GUARDRAILS_PATH)) {
        return JSON.parse(readFileSync(GUARDRAILS_PATH, 'utf-8'))
      }
    } catch {}
    // 기본 규칙으로 초기화
    this.saveRulesToFile(DEFAULT_RULES)
    return [...DEFAULT_RULES]
  }

  /** 규칙 저장 */
  private saveRules(): void {
    this.saveRulesToFile(this.rules)
  }

  private saveRulesToFile(rules: GuardRail[]): void {
    try {
      mkdirSync(join(homedir(), '.mulaude'), { recursive: true })
      writeFileSync(GUARDRAILS_PATH, JSON.stringify(rules, null, 2), 'utf-8')
    } catch (err) {
      logger.error('GuardRails', 'Failed to save rules', err)
    }
  }
}
