/**
 * HooksManager - Claude Code hooks를 통한 세션 상태 감지
 *
 * Claude Code의 hooks 시스템을 활용하여 PTY 파싱 없이
 * 정확한 세션 상태(permission, idle, tool 등)를 감지합니다.
 *
 * 동작 흐름:
 *   1. ~/.claude/mulaude-hook.sh 스크립트 설치
 *   2. ~/.claude/settings.json에 hooks 등록 (기존 설정 병합)
 *   3. 세션 생성 시 MULAUDE_SESSION_ID, MULAUDE_IPC_DIR 환경변수 전달
 *   4. Claude Code가 hook 이벤트 발생 시 스크립트가 IPC 파일에 JSON 기록
 *   5. fs.watch로 IPC 파일 변경 감지 → 렌더러로 전달
 *
 * MULAUDE_IPC_DIR가 없으면 hook 스크립트는 아무것도 하지 않으므로
 * Mulaude 외부의 Claude Code 세션에 영향을 주지 않습니다.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, watch, rmSync, unlinkSync, chmodSync } from 'fs'
import { join } from 'path'
import { homedir, tmpdir } from 'os'
import type { HookEvent } from '../shared/types'
import { HOOK_DEDUP_EXPIRY, HOOK_FILE_READ_DELAY } from '../shared/constants'

type HookEventCallback = (mulaudeSessionId: string, event: HookEvent) => void

const HOOK_SCRIPT_NAME = 'mulaude-hook.sh'

/**
 * HooksManager
 *
 * Claude Code hooks → 파일 기반 IPC → Electron main process → renderer
 */
export class HooksManager {
  private ipcDir: string
  private watcher: ReturnType<typeof watch> | null = null
  private callbacks: HookEventCallback[] = []
  /** fs.watch 중복 fire 방지 (같은 파일에 대해 여러 번 콜백 호출 방지) */
  private processedFiles = new Set<string>()

  constructor() {
    this.ipcDir = join(tmpdir(), `mulaude-hooks-${process.pid}`)
    mkdirSync(this.ipcDir, { recursive: true })
  }

  /** IPC 디렉토리 경로 (세션 env에 전달용) */
  getIpcDir(): string {
    return this.ipcDir
  }

  /** hook 스크립트 설치 + settings.json에 hooks 등록 + 감시 시작 */
  install(): void {
    this.installHookScript()
    this.installHooksConfig()
    this.startWatching()
  }

  /** hook 이벤트 콜백 등록 */
  onEvent(callback: HookEventCallback): void {
    this.callbacks.push(callback)
  }

  /** 정리 (앱 종료 시 호출) */
  cleanup(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
    // processedFiles Set 메모리 누수 방지
    this.processedFiles.clear()
    this.callbacks.length = 0
    try {
      rmSync(this.ipcDir, { recursive: true, force: true })
    } catch {
      // 이미 삭제된 경우 무시
    }
  }

  /**
   * ~/.claude/mulaude-hook.sh 설치
   *
   * MULAUDE_IPC_DIR 환경변수가 없으면 즉시 종료 (Mulaude 외부에서 무해)
   * stdin에서 JSON 읽어 $MULAUDE_IPC_DIR/$MULAUDE_SESSION_ID.json에 기록
   */
  private installHookScript(): void {
    const claudeDir = join(homedir(), '.claude')
    mkdirSync(claudeDir, { recursive: true })

    const scriptPath = join(claudeDir, HOOK_SCRIPT_NAME)
    // 이벤트 유실 방지: 고유 파일명 사용 (PID + RANDOM)
    // 팀 모드에서 여러 에이전트가 동시에 hook을 트리거하면
    // 같은 파일에 덮어쓰기하여 이벤트가 소실되는 문제 해결
    const script = '#!/bin/bash\n'
      + '# Mulaude IPC hook - Claude Code 이벤트를 Mulaude로 전달\n'
      + '# MULAUDE_IPC_DIR 없으면 아무것도 하지 않음 (Mulaude 외부에서 무해)\n'
      + '[ -z "$MULAUDE_IPC_DIR" ] && exit 0\n'
      + 'INPUT=$(cat)\n'
      + 'mkdir -p "$MULAUDE_IPC_DIR"\n'
      + 'echo "$INPUT" > "$MULAUDE_IPC_DIR/${MULAUDE_SESSION_ID}_$$_${RANDOM}.json"\n'
      + 'exit 0\n'
    writeFileSync(scriptPath, script, 'utf-8')
    chmodSync(scriptPath, '755')
    console.log('[HooksManager] hook script installed:', scriptPath)
  }

  /**
   * ~/.claude/settings.json에 Mulaude hooks 등록
   *
   * 기존 설정과 병합하며, 이미 등록된 경우 건너뜁니다.
   * 등록하는 이벤트: Notification, PreToolUse, PostToolUse, Stop
   */
  private installHooksConfig(): void {
    const settingsPath = join(homedir(), '.claude', 'settings.json')
    let settings: Record<string, unknown> = {}

    if (existsSync(settingsPath)) {
      try {
        settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
      } catch {
        settings = {}
      }
    }

    const hookCommand = `bash ${join(homedir(), '.claude', HOOK_SCRIPT_NAME)}`
    const mulaudeHookGroup = {
      matcher: '',
      hooks: [{
        type: 'command',
        command: hookCommand,
        timeout: 5
      }]
    }

    const hooks = (settings.hooks || {}) as Record<string, unknown[]>
    const events = ['Notification', 'PreToolUse', 'PostToolUse', 'Stop', 'UserPromptSubmit']
    let modified = false

    for (const event of events) {
      if (!hooks[event]) hooks[event] = []
      const eventHooks = hooks[event] as Array<{ hooks?: Array<{ command?: string }> }>

      // 이미 Mulaude hook이 등록되어 있는지 확인
      const exists = eventHooks.some(h =>
        h.hooks?.some(hh => hh.command?.includes(HOOK_SCRIPT_NAME))
      )

      if (!exists) {
        eventHooks.push(mulaudeHookGroup)
        modified = true
      }
    }

    if (modified) {
      settings.hooks = hooks
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
      console.log('[HooksManager] hooks config installed in:', settingsPath)
    } else {
      console.log('[HooksManager] hooks already configured')
    }
  }

  /**
   * IPC 디렉토리 감시 시작
   *
   * fs.watch로 파일 변경을 감지하고, JSON 파싱 후 콜백 호출
   */
  /**
   * IPC 디렉토리 감시 시작
   *
   * 파일명 형식: {sessionId}_{pid}_{random}.json
   * 고유 파일명을 사용하여 동시 이벤트 유실을 방지합니다.
   * 읽은 후 파일을 삭제하여 디렉토리가 깨끗하게 유지됩니다.
   */
  private startWatching(): void {
    this.watcher = watch(this.ipcDir, (eventType, filename) => {
      if (!filename || !filename.endsWith('.json')) return

      // fs.watch 중복 fire 방지: macOS FSEvents는 같은 파일 생성에 여러 번 콜백 호출 가능
      if (this.processedFiles.has(filename)) return
      this.processedFiles.add(filename)
      setTimeout(() => this.processedFiles.delete(filename), HOOK_DEDUP_EXPIRY)

      // 세션 ID 추출: "session-1_12345_6789.json" → "session-1"
      // 하위 호환: "session-1.json" 도 지원
      const match = filename.match(/^(.+?)(?:_\d+_\d+)?\.json$/)
      if (!match) return
      const sessionId = match[1]
      const filePath = join(this.ipcDir, filename)

      // 파일 쓰기 완료 대기 (10ms)
      setTimeout(() => {
        try {
          const data = readFileSync(filePath, 'utf-8')
          const event = JSON.parse(data) as HookEvent
          console.log(
            `[HooksManager] ${sessionId} → ${event.hook_event_name}` +
            `${event.notification_type ? ` (${event.notification_type})` : ''}` +
            `${event.tool_name ? ` [${event.tool_name}]` : ''}`
          )
          for (const cb of this.callbacks) {
            cb(sessionId, event)
          }
          // 처리 후 파일 삭제
          try { unlinkSync(filePath) } catch { /* ignore */ }
        } catch {
          // JSON 파싱 실패 무시
        }
      }, HOOK_FILE_READ_DELAY)
    })

    console.log('[HooksManager] watching IPC dir:', this.ipcDir)
  }
}
