/**
 * PlanWatcher — .claude/plans/*.md 파일 감시 + IPC 전송
 *
 * 세션별로 특정 플랜 파일을 fs.watch로 감시하고,
 * 변경 시 내용을 렌더러로 전송합니다.
 * Claude가 플랜 파일을 작성하는 동안 실시간으로 업데이트됩니다.
 */

import { watch, readFile, type FSWatcher } from 'fs'
import { readdir, stat } from 'fs/promises'
import { join, basename } from 'path'
import { app, BrowserWindow } from 'electron'
import { PLAN_WATCHER_DEBOUNCE } from '../shared/constants'

/* ─── Types ─── */

export interface PlanFileInfo {
  name: string
  path: string
  mtime: number
}

interface WatcherEntry {
  watcher: FSWatcher
  filePath: string
  /** 디렉토리 watch 모드 (파일이 아직 없을 때) */
  dirMode: boolean
}

/* ─── State ─── */

const watchers = new Map<string, WatcherEntry>()

/* ─── 디바운스 유틸 ─── */

const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

function debouncedReadAndSend(sessionId: string, filePath: string): void {
  const existing = debounceTimers.get(sessionId)
  if (existing) clearTimeout(existing)

  debounceTimers.set(sessionId, setTimeout(() => {
    debounceTimers.delete(sessionId)
    readFile(filePath, 'utf-8', (err, content) => {
      if (err) return
      const win = BrowserWindow.getAllWindows()[0]
      if (win && !win.isDestroyed()) {
        win.webContents.send('plan:content-update', sessionId, filePath, content)
      }
    })
  }, PLAN_WATCHER_DEBOUNCE))
}

/* ─── Public API ─── */

/**
 * 특정 플랜 파일 감시 시작
 * 파일이 아직 없으면 디렉토리를 감시하다가 파일 생성 시 자동 전환
 */
export function watchPlanFile(sessionId: string, filePath: string): void {
  // 이미 같은 파일을 감시 중이면 스킵
  const existing = watchers.get(sessionId)
  if (existing && existing.filePath === filePath) return

  // 기존 watcher 정리
  unwatchPlanFile(sessionId)

  try {
    // 먼저 파일 존재 여부 확인
    const watcher = watch(filePath, { persistent: false }, (eventType) => {
      if (eventType === 'change' || eventType === 'rename') {
        debouncedReadAndSend(sessionId, filePath)
      }
    })

    watcher.on('error', () => {
      // 파일이 없으면 디렉토리 모드로 전환
      watcher.close()
      watchDirectory(sessionId, filePath)
    })

    watchers.set(sessionId, { watcher, filePath, dirMode: false })

    // 초기 내용 전송
    debouncedReadAndSend(sessionId, filePath)
  } catch {
    // 파일 없음 → 디렉토리 감시 모드
    watchDirectory(sessionId, filePath)
  }
}

/**
 * 디렉토리 감시 모드: 파일이 아직 없을 때 .claude/plans/ 디렉토리를 감시
 */
function watchDirectory(sessionId: string, targetFilePath: string): void {
  const dir = join(targetFilePath, '..')
  const targetName = basename(targetFilePath)

  try {
    const watcher = watch(dir, { persistent: false }, (_eventType, filename) => {
      if (filename === targetName) {
        // 파일이 생성됨 → 파일 감시 모드로 전환
        watcher.close()
        watchers.delete(sessionId)
        watchPlanFile(sessionId, targetFilePath)
      }
    })

    watcher.on('error', () => {
      // 디렉토리도 없음 → 무시
    })

    watchers.set(sessionId, { watcher, filePath: targetFilePath, dirMode: true })
  } catch {
    // 디렉토리 접근 불가 → 무시
  }
}

/** 세션의 파일 감시 해제 */
export function unwatchPlanFile(sessionId: string): void {
  const entry = watchers.get(sessionId)
  if (!entry) return

  try { entry.watcher.close() } catch { /* 이미 닫힘 */ }
  watchers.delete(sessionId)

  const timer = debounceTimers.get(sessionId)
  if (timer) {
    clearTimeout(timer)
    debounceTimers.delete(sessionId)
  }
}

/** 모든 watcher 정리 (앱 종료 시) */
export function unwatchAllPlans(): void {
  for (const sessionId of watchers.keys()) {
    unwatchPlanFile(sessionId)
  }
}

/**
 * 프로젝트 내 .md 파일 목록 반환
 * 검색 경로: {workingDir}/.claude/plans/ → {workingDir}/.claude/ → {workingDir}/
 * 동일 파일명은 먼저 발견된 쪽 우선
 */
export async function listPlanFiles(workingDir: string): Promise<PlanFileInfo[]> {
  const dirs = [
    join(workingDir, '.claude', 'plans'),
    join(workingDir, '.claude'),
    workingDir
  ]

  const seen = new Set<string>()
  const results: PlanFileInfo[] = []

  for (const dir of dirs) {
    try {
      const files = await readdir(dir)
      const mdFiles = files.filter(f => f.endsWith('.md'))

      for (const file of mdFiles) {
        if (seen.has(file)) continue
        seen.add(file)

        const filePath = join(dir, file)
        try {
          const stats = await stat(filePath)
          results.push({
            name: file,
            path: filePath,
            mtime: stats.mtimeMs
          })
        } catch {
          // 파일 접근 불가 → 스킵
        }
      }
    } catch {
      // 디렉토리 없음 → 다음
    }
  }

  // 수정일 역순 정렬
  results.sort((a, b) => b.mtime - a.mtime)
  return results
}

/**
 * 플랜 파일명으로 실제 경로를 찾아 반환
 * 홈 디렉토리 → 프로젝트 디렉토리 순서로 검색
 * 어디에도 없으면 홈 디렉토리 경로 반환 (watcher가 생성 대기)
 */
export async function resolvePlanPath(workingDir: string, fileName: string): Promise<string> {
  const homeDir = app.getPath('home')
  const homePath = join(homeDir, '.claude', 'plans', fileName)
  const projectPath = join(workingDir, '.claude', 'plans', fileName)

  // 홈 디렉토리 먼저 확인 (Claude Code 기본 저장 위치)
  try {
    await stat(homePath)
    return homePath
  } catch { /* 없음 */ }

  // 프로젝트 디렉토리 확인
  try {
    await stat(projectPath)
    return projectPath
  } catch { /* 없음 */ }

  // 기본: 홈 디렉토리 경로 반환 (watcher가 파일 생성 대기)
  return homePath
}
