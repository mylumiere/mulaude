import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import NativeApp from './native/NativeApp'
import type { AppMode } from '../shared/types'
import './App.css'

/**
 * Root 컴포넌트 — 앱 모드에 따라 Terminal UI 또는 Native UI를 렌더링합니다.
 * 모드 조회 중에는 스플래시가 로딩을 커버합니다.
 */
function Root(): React.ReactElement | null {
  const [mode, setMode] = useState<AppMode | null>(null)

  useEffect(() => {
    window.api.getAppMode().then(setMode)
  }, [])

  // 모드 로딩 중 — 스플래시가 커버
  if (!mode) return null

  return mode === 'native' ? <NativeApp /> : <App />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)

// 스플래시 fade-out
requestAnimationFrame(() => {
  const splash = document.getElementById('splash')
  if (splash) {
    splash.classList.add('fade-out')
    setTimeout(() => splash.remove(), 400)
  }
})
