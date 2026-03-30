/**
 * useGuardrails - Guard Rail 규칙 관리 + 위반 실시간 수신
 *
 * 규칙 CRUD와 세션별 위반 이벤트를 관리합니다.
 */

import { useState, useEffect, useCallback } from 'react'
import type { GuardRail, GuardRailViolation } from '../../shared/types'

interface UseGuardrailsReturn {
  rules: GuardRail[]
  violations: Record<string, GuardRailViolation[]>
  addRule: (rule: GuardRail) => Promise<void>
  updateRule: (id: string, updates: Partial<GuardRail>) => void
  deleteRule: (id: string) => void
  reloadRules: () => Promise<void>
}

export function useGuardrails(): UseGuardrailsReturn {
  const [rules, setRules] = useState<GuardRail[]>([])
  const [violations, setViolations] = useState<Record<string, GuardRailViolation[]>>({})

  // 초기 규칙 로드
  const reloadRules = useCallback(async () => {
    try {
      const r = await window.api.getGuardrailRules()
      setRules(r)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    reloadRules()

    // 초기 위반 로드
    window.api.getAllGuardrailViolations().then(v => {
      setViolations(v)
    }).catch(() => {})
  }, [reloadRules])

  // 실시간 위반 수신
  useEffect(() => {
    const cleanup = window.api.onGuardrailViolation((sessionId, violation) => {
      setViolations(prev => {
        const list = [...(prev[sessionId] || []), violation]
        // 최대 50개 유지
        if (list.length > 50) list.splice(0, list.length - 50)
        return { ...prev, [sessionId]: list }
      })
    })
    return cleanup
  }, [])

  const addRule = useCallback(async (rule: GuardRail) => {
    await window.api.addGuardrailRule(rule)
    setRules(prev => [...prev, rule])
  }, [])

  const updateRule = useCallback((id: string, updates: Partial<GuardRail>) => {
    window.api.updateGuardrailRule(id, updates)
    setRules(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r))
  }, [])

  const deleteRule = useCallback((id: string) => {
    window.api.deleteGuardrailRule(id)
    setRules(prev => prev.filter(r => r.id !== id))
  }, [])

  return { rules, violations, addRule, updateRule, deleteRule, reloadRules }
}
