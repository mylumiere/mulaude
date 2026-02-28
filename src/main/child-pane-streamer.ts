/**
 * ChildPaneStreamer — team config 기반 자식 pane 스트리밍 관리
 *
 * team config에서 확정된 에이전트의 tmuxPaneId를 기반으로
 * pane 출력을 실시간 캡처하여 렌더러로 전달합니다.
 *
 * 핵심: paneId(%XX)를 모든 tmux 명령의 타겟으로 사용.
 * break-pane으로 별도 window에 분리된 pane도 paneId로 직접 접근 가능.
 *
 * 동작 원리:
 *   1. syncWithAgents() — team config에서 확정된 paneId 목록을 받아
 *      새 pane은 스트리밍 시작, 사라진 pane은 정리
 *   2. startPaneStream():
 *      - captureTmuxPaneWithAnsi(%XX) → 초기 화면 캡처
 *      - startPipePane(%XX) → pane 출력을 임시 파일로 스트리밍
 *      - getPaneTty(%XX) → TTY 경로 저장 (입력용)
 *      - 50ms setInterval → 파일에서 새 바이트 읽기 → onData 콜백
 *   3. writeToPane() → tmux send-keys -H %XX 로 입력 전달
 */

import * as fs from 'fs'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  startPipePane,
  stopPipePane,
  getPaneTty,
  captureTmuxPaneWithAnsi,
  sendKeysToPane
} from './tmux-utils'

/** team config에서 확정된 에이전트 pane 정보 */
export interface AgentPaneInfo {
  paneId: string     // tmux pane ID (%XX) — 안정적 키 & tmux 명령 타겟
  paneIndex: number  // 렌더러 식별용 (AgentInfo.paneIndex와 매칭)
}

/** 개별 pane 스트림의 내부 상태 */
interface PaneStream {
  /** tmux pane ID (%XX) — 모든 tmux 명령의 타겟 */
  paneId: string
  /** 렌더러 식별용 pane index */
  paneIndex: number
  /** pipe-pane 출력 파일 경로 */
  pipePath: string
  /** pane의 TTY 디바이스 경로 (입력용) */
  ttyPath: string | null
  /** 파일 읽기 오프셋 */
  readOffset: number
  /** 파일 디스크립터 (읽기 전용) */
  fd: number | null
  /** 파일 폴링 타이머 */
  pollTimer: ReturnType<typeof setInterval>
}

type DataCallback = (sessionId: string, paneIndex: number, data: string) => void
type PaneDiscoveredCallback = (sessionId: string, paneIndex: number, initialContent: string) => void
type PaneRemovedCallback = (sessionId: string, paneIndex: number) => void

export class ChildPaneStreamer {
  /** sessionId → (paneId → PaneStream) */
  private streams: Map<string, Map<string, PaneStream>> = new Map()
  private tmuxPath: string
  private dataCallbacks: DataCallback[] = []
  private paneDiscoveredCallbacks: PaneDiscoveredCallback[] = []
  private paneRemovedCallbacks: PaneRemovedCallback[] = []

  constructor(tmuxPath: string) {
    this.tmuxPath = tmuxPath
  }

  /**
   * team config에서 확정된 에이전트 목록과 동기화합니다.
   * 새 에이전트는 스트리밍 시작, 사라진 에이전트는 정리.
   *
   * @param sessionId - Mulaude 세션 ID
   * @param agentPanes - team config에서 확정된 에이전트 pane 목록
   */
  syncWithAgents(
    sessionId: string,
    agentPanes: AgentPaneInfo[]
  ): void {
    const sessionStreams = this.streams.get(sessionId)
    const activePaneIds = new Set(agentPanes.map((a) => a.paneId))

    // 새 에이전트 → 스트리밍 시작
    for (const agent of agentPanes) {
      const existing = sessionStreams?.get(agent.paneId)
      if (existing) {
        // paneIndex 갱신
        existing.paneIndex = agent.paneIndex
      } else {
        this.startPaneStream(sessionId, agent.paneId, agent.paneIndex)
      }
    }

    // 사라진 에이전트 → 스트리밍 정리
    if (sessionStreams) {
      for (const [paneId] of sessionStreams) {
        if (!activePaneIds.has(paneId)) {
          this.stopPaneStream(sessionId, paneId)
        }
      }
    }
  }

  /**
   * 새 pane 스트림을 시작합니다.
   * 모든 tmux 명령은 paneId(%XX)로 타겟팅합니다.
   */
  private startPaneStream(
    sessionId: string,
    paneId: string,
    paneIndex: number
  ): void {
    // 1) 초기 화면 캡처 (paneId로 직접 타겟)
    const initialContent = captureTmuxPaneWithAnsi(this.tmuxPath, paneId)

    // 2) pipe-pane 출력 파일 준비
    const safePaneId = paneId.replace(/[^a-zA-Z0-9]/g, '')
    const pipePath = join(tmpdir(), `mulaude-pipe-${sessionId.replace(/[^a-zA-Z0-9-]/g, '')}-${safePaneId}`)
    try {
      fs.writeFileSync(pipePath, '')
    } catch {
      console.warn(`[ChildPaneStreamer] Failed to create pipe file: ${pipePath}`)
      return
    }

    // 3) pipe-pane 시작 (paneId로 직접 타겟)
    startPipePane(this.tmuxPath, paneId, pipePath)

    // 4) TTY 경로 취득 (paneId로 직접 타겟)
    const ttyPath = getPaneTty(this.tmuxPath, paneId)

    // 5) 파일 디스크립터 열기
    let fd: number | null = null
    try {
      fd = fs.openSync(pipePath, 'r')
    } catch {
      console.warn(`[ChildPaneStreamer] Failed to open pipe file: ${pipePath}`)
      // fd를 열지 못하면 pipe-pane 정리 후 early return
      stopPipePane(this.tmuxPath, paneId)
      try { fs.unlinkSync(pipePath) } catch { /* ignore */ }
      return
    }

    // 6) 50ms 폴링으로 새 바이트 읽기
    const stream: PaneStream = {
      paneId,
      paneIndex,
      pipePath,
      ttyPath,
      readOffset: 0,
      fd,
      pollTimer: null!
    }

    stream.pollTimer = setInterval(() => {
      this.pollPipeFile(sessionId, stream)
    }, 50)

    // streams에 등록
    if (!this.streams.has(sessionId)) {
      this.streams.set(sessionId, new Map())
    }
    this.streams.get(sessionId)!.set(paneId, stream)

    // 콜백 호출
    for (const cb of this.paneDiscoveredCallbacks) {
      cb(sessionId, paneIndex, initialContent)
    }
  }

  /**
   * pipe 파일에서 새 바이트를 읽어 onData 콜백으로 전달합니다.
   */
  private pollPipeFile(sessionId: string, stream: PaneStream): void {
    if (stream.fd === null) return

    try {
      const stats = fs.fstatSync(stream.fd)
      const newBytes = stats.size - stream.readOffset
      if (newBytes <= 0) return

      const buf = Buffer.alloc(newBytes)
      const bytesRead = fs.readSync(stream.fd, buf, 0, newBytes, stream.readOffset)
      if (bytesRead > 0) {
        stream.readOffset += bytesRead
        const data = buf.toString('utf-8', 0, bytesRead)
        for (const cb of this.dataCallbacks) {
          cb(sessionId, stream.paneIndex, data)
        }
      }
    } catch {
      // 파일이 삭제되었거나 접근 불가 → 무시
    }
  }

  /**
   * pane 스트림을 중지하고 리소스를 정리합니다.
   */
  private stopPaneStream(sessionId: string, paneId: string): void {
    const sessionStreams = this.streams.get(sessionId)
    if (!sessionStreams) return

    const stream = sessionStreams.get(paneId)
    if (!stream) return

    // 1) pipe-pane 중지 (paneId로 직접 타겟)
    stopPipePane(this.tmuxPath, stream.paneId)

    // 2) 폴링 타이머 정리
    clearInterval(stream.pollTimer)

    // 3) 파일 디스크립터 닫기
    if (stream.fd !== null) {
      try {
        fs.closeSync(stream.fd)
      } catch { /* ignore */ }
    }

    // 4) 임시 파일 삭제
    try {
      fs.unlinkSync(stream.pipePath)
    } catch { /* ignore */ }

    // 5) Map에서 제거
    sessionStreams.delete(paneId)
    if (sessionStreams.size === 0) {
      this.streams.delete(sessionId)
    }

    // 콜백 호출
    for (const cb of this.paneRemovedCallbacks) {
      cb(sessionId, stream.paneIndex)
    }
  }

  /**
   * pane에 데이터를 입력합니다 (tmux send-keys -H).
   * paneIndex로 검색 후 paneId로 tmux 명령 실행.
   */
  writeToPane(sessionId: string, paneIndex: number, data: string): void {
    const sessionStreams = this.streams.get(sessionId)
    if (!sessionStreams) return

    for (const stream of sessionStreams.values()) {
      if (stream.paneIndex === paneIndex) {
        sendKeysToPane(this.tmuxPath, stream.paneId, data)
        return
      }
    }
  }

  /**
   * 자식 pane의 PTY 크기를 변경합니다.
   */
  resizePane(sessionId: string, paneIndex: number, cols: number, rows: number): void {
    const sessionStreams = this.streams.get(sessionId)
    if (!sessionStreams) return

    for (const stream of sessionStreams.values()) {
      if (stream.paneIndex === paneIndex && stream.ttyPath) {
        try {
          execFileSync('stty', ['-f', stream.ttyPath, 'cols', String(cols), 'rows', String(rows)], {
            encoding: 'utf-8',
            timeout: 3000
          })
        } catch {
          // pane이 이미 사라졌을 수 있음
        }
        return
      }
    }
  }

  /**
   * 특정 세션의 모든 pane 스트림을 정리합니다.
   */
  cleanupSession(sessionId: string): void {
    const sessionStreams = this.streams.get(sessionId)
    if (!sessionStreams) return

    for (const [paneId] of sessionStreams) {
      this.stopPaneStream(sessionId, paneId)
    }
    this.streams.delete(sessionId)
  }

  /**
   * 모든 세션의 스트림을 정리합니다.
   */
  cleanupAll(): void {
    for (const [sessionId] of this.streams) {
      this.cleanupSession(sessionId)
    }
  }

  /** pane 출력 데이터 콜백 등록 */
  onData(callback: DataCallback): void {
    this.dataCallbacks.push(callback)
  }

  /** 새 pane 발견 콜백 등록 */
  onPaneDiscovered(callback: PaneDiscoveredCallback): void {
    this.paneDiscoveredCallbacks.push(callback)
  }

  /** pane 제거 콜백 등록 */
  onPaneRemoved(callback: PaneRemovedCallback): void {
    this.paneRemovedCallbacks.push(callback)
  }
}
