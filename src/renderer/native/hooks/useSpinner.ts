/**
 * useSpinner — 스피너 문자 순환 훅
 *
 * Claude Code 터미널의 스피너를 재현합니다.
 * active=true일 때 setInterval로 문자 배열을 순환하며,
 * active=false면 첫 번째 문자에서 정지합니다.
 */

import { useState, useEffect, useRef } from 'react'

export function useSpinner(chars: string[], intervalMs: number, active: boolean): string {
  const [index, setIndex] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!active) {
      setIndex(0)
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    intervalRef.current = setInterval(() => {
      setIndex(prev => (prev + 1) % chars.length)
    }, intervalMs)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [active, chars.length, intervalMs])

  return chars[index] || chars[0]
}
