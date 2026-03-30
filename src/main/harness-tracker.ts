/**
 * HarnessTracker — Hook 이벤트에서 세션별 메트릭을 수집
 *
 * HooksManager.onEvent()로부터 이벤트를 받아 세션별 HarnessMetrics를 축적하고,
 * 변경된 세션만 3초 간격으로 배치 IPC를 발송합니다.
 *
 * 데이터 흐름:
 *   HooksManager → processEvent() → metrics 축적 → 3초 setInterval → harness:metrics-batch IPC
 */

import type { BrowserWindow } from 'electron'
import type { HookEvent, HarnessMetrics, HarnessTimelineEntry, HarnessEventType } from '../shared/types'
import { HARNESS_METRICS_POLL_INTERVAL, HARNESS_MAX_TIMELINE } from '../shared/constants'

/** 파일 변경 이벤트 리스너 (Verifier 연결용) */
export type FileChangeListener = (sessionId: string, filePaths: string[]) => void

export class HarnessTracker {
  /** 세션별 메트릭 저장소 */
  private metrics = new Map<string, HarnessMetrics>()
  /** 배치 전송 주기에 변경된 세션 ID */
  private dirtySessions = new Set<string>()
  /** 배치 전송 타이머 */
  private timer: ReturnType<typeof setInterval> | null = null
  /** 메인 윈도우 참조 */
  private mainWindow: BrowserWindow | null = null
  /** 파일 변경 리스너 (Phase 4 Verifier 연결용) */
  private fileChangeListeners: FileChangeListener[] = []

  /** 메인 윈도우 설정 + 배치 전송 시작 */
  start(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
    this.timer = setInterval(() => this.flush(), HARNESS_METRICS_POLL_INTERVAL)
  }

  /** 정리 (앱 종료 시) */
  cleanup(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.metrics.clear()
    this.dirtySessions.clear()
    this.fileChangeListeners.length = 0
  }

  /** 파일 변경 리스너 등록 (Verifier용) */
  onFileChange(listener: FileChangeListener): void {
    this.fileChangeListeners.push(listener)
  }

  /** 특정 세션의 메트릭 읽기 */
  getMetrics(sessionId: string): HarnessMetrics | null {
    return this.metrics.get(sessionId) ?? null
  }

  /** 전체 세션 메트릭 읽기 */
  getAllMetrics(): Record<string, HarnessMetrics> {
    const result: Record<string, HarnessMetrics> = {}
    for (const [id, m] of this.metrics) {
      result[id] = m
    }
    return result
  }

  /**
   * Hook 이벤트를 처리하여 메트릭에 반영합니다.
   *
   * @param sessionId mulaude 세션 ID
   * @param event Hook 이벤트 (PreToolUse, PostToolUse, Stop 등)
   */
  processEvent(sessionId: string, event: HookEvent): void {
    const m = this.getOrCreate(sessionId)
    const now = Date.now()
    m.lastActivity = now

    switch (event.hook_event_name) {
      case 'PreToolUse': {
        const toolName = event.tool_name || 'Unknown'
        m.toolCounts[toolName] = (m.toolCounts[toolName] || 0) + 1

        this.pushTimeline(m, {
          timestamp: now,
          eventType: 'tool_use',
          toolName,
          detail: this.extractDetail(event)
        })

        // Task 도구 → 에이전트 스폰 카운트
        if (toolName === 'Task') {
          m.agentSpawnCount++
          this.pushTimeline(m, {
            timestamp: now,
            eventType: 'agent_spawn',
            toolName: 'Task',
            detail: (event.tool_input?.description as string) || undefined
          })
        }
        break
      }

      case 'PostToolUse': {
        const toolName = event.tool_name || 'Unknown'
        this.pushTimeline(m, {
          timestamp: now,
          eventType: 'tool_done',
          toolName,
          detail: this.extractDetail(event)
        })

        // 파일 추적
        const filePath = event.tool_input?.file_path as string | undefined
        if (filePath) {
          if (toolName === 'Edit' || toolName === 'Write' || toolName === 'NotebookEdit') {
            if (!m.filesModified.includes(filePath)) {
              m.filesModified.push(filePath)
            }
            // Phase 4: 파일 변경 알림
            for (const listener of this.fileChangeListeners) {
              listener(sessionId, [filePath])
            }
          } else if (toolName === 'Read') {
            if (!m.filesRead.includes(filePath)) {
              m.filesRead.push(filePath)
            }
          }
        }
        break
      }

      case 'Stop': {
        // 턴 종료
        m.turnCount++
        this.pushTimeline(m, {
          timestamp: now,
          eventType: 'turn_end'
        })
        break
      }

      case 'Notification': {
        if (event.notification_type === 'error') {
          this.pushTimeline(m, {
            timestamp: now,
            eventType: 'error',
            detail: (event.message as string) || 'Error'
          })
        }
        break
      }

      case 'UserPromptSubmit': {
        this.pushTimeline(m, {
          timestamp: now,
          eventType: 'turn_start'
        })
        break
      }
    }

    this.dirtySessions.add(sessionId)
  }

  /** 변경된 세션 메트릭을 배치로 렌더러에 전송 */
  private flush(): void {
    if (this.dirtySessions.size === 0 || !this.mainWindow || this.mainWindow.isDestroyed()) return

    const batch: Record<string, HarnessMetrics> = {}
    for (const id of this.dirtySessions) {
      const m = this.metrics.get(id)
      if (m) batch[id] = m
    }
    this.dirtySessions.clear()

    this.mainWindow.webContents.send('harness:metrics-batch', batch)
  }

  /** 세션 메트릭을 가져오거나 새로 생성 */
  private getOrCreate(sessionId: string): HarnessMetrics {
    let m = this.metrics.get(sessionId)
    if (!m) {
      m = {
        toolCounts: {},
        filesModified: [],
        filesRead: [],
        timeline: [],
        turnCount: 0,
        agentSpawnCount: 0,
        lastActivity: Date.now()
      }
      this.metrics.set(sessionId, m)
    }
    return m
  }

  /** 타임라인에 엔트리 추가 (최대 N개 유지) */
  private pushTimeline(m: HarnessMetrics, entry: HarnessTimelineEntry): void {
    m.timeline.push(entry)
    if (m.timeline.length > HARNESS_MAX_TIMELINE) {
      m.timeline.splice(0, m.timeline.length - HARNESS_MAX_TIMELINE)
    }
  }

  /** 이벤트에서 표시용 상세 정보 추출 */
  private extractDetail(event: HookEvent): string | undefined {
    const input = event.tool_input
    if (!input) return undefined

    // 파일 경로 우선
    if (input.file_path) return input.file_path as string
    if (input.file) return input.file as string

    // Bash 명령어
    if (input.command) {
      const cmd = input.command as string
      return cmd.length > 80 ? cmd.slice(0, 77) + '...' : cmd
    }

    // Grep/Glob 패턴
    if (input.pattern) return `pattern: ${input.pattern}`

    // Task 설명
    if (input.description) return input.description as string

    return undefined
  }
}
