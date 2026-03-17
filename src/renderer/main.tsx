import React, { useState, useEffect, Component, type ReactNode, type ErrorInfo } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import NativeApp from './native/NativeApp'
import type { AppMode } from '../shared/types'
import './App.css'

// 렌더러 크래시 디버깅용 ErrorBoundary
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: '#f38ba8', background: '#1e1e2e', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
          <h2>Renderer Crash</h2>
          <p>{this.state.error.message}</p>
          <pre>{this.state.error.stack}</pre>
        </div>
      )
    }
    return this.props.children
  }
}

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
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
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
