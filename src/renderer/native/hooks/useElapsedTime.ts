/**
 * useElapsedTime — 스트리밍 경과 시간 타이머
 *
 * active=true인 동안 1초마다 경과 시간을 갱신합니다.
 * Claude Code 터미널의 도구/에이전트 경과 시간 표시를 재현합니다.
 */

import { useState, useEffect, useRef } from 'react'

export function useElapsedTime(active: boolean): number {
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef(0)

  useEffect(() => {
    if (!active) {
      setElapsed(0)
      return
    }

    startRef.current = Date.now()
    setElapsed(0)

    const interval = setInterval(() => {
      setElapsed(Date.now() - startRef.current)
    }, 1000)

    return () => clearInterval(interval)
  }, [active])

  return elapsed
}

/** 경과 시간 포맷 (Claude Code 스타일: <1s, 5s, 1m 30s) */
export function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  if (totalSec < 1) return '<1s'
  if (totalSec < 60) return `${totalSec}s`
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  if (sec === 0) return `${min}m`
  return `${min}m ${sec}s`
}
