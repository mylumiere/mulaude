# Changelog

## [1.0.0] - 2026-02-27

### 코드 리팩토링

#### Main 프로세스 분할
- `index.ts` (618줄) → 5개 모듈로 분할
  - `index.ts` — 앱 진입점 (~116줄)
  - `ipc-handlers.ts` — IPC 핸들러 등록 (~167줄)
  - `session-forwarder.ts` — 배치 데이터 포워딩 (~95줄)
  - `pane-poller.ts` — pane 폴링 + 팀 config (~221줄)
  - `close-handler.ts` — 닫기 다이얼로그 (~196줄)
- `tmux-utils.ts` — `execTmux()` 공통 래퍼로 반복 try-catch 제거 (485줄 → 382줄)

#### Renderer 리팩토링
- `useSessionStatus.ts` (476줄) → 3개 훅 + 래퍼로 분할
  - `useSessionPtyState.ts` — PTY 출력 파싱
  - `useSessionHooks.ts` — Hook 이벤트 처리
  - `useSessionAgents.ts` — 에이전트 관리
- `Sidebar.tsx` (383줄) → 컨테이너 + 5개 하위 컴포넌트
  - `ProjectHeader`, `SessionRow`, `AgentTree`, `UsageGauge`, `StatusLegend`
- `useChildPaneManager.ts` — App.tsx에서 child pane 상태 관리 추출
- `useXtermTerminal.ts` — TerminalView/AgentTerminal 공통 xterm 훅 추출
  - TerminalView: 139줄 → 55줄
  - AgentTerminal: 151줄 → 70줄

#### 공유 모듈
- `src/shared/constants.ts` — 17개 매직 넘버 상수화

### 버그 수정
- `hooks-manager.ts`: processedFiles Set 메모리 누수 — cleanup()에서 clear() 호출
- `hooks-manager.ts`: 콜백 참조 누수 — cleanup()에서 callbacks 해제
- `session-forwarder.ts`: watchFile 리스너 누수 — cleanup 함수 반환 패턴으로 수정
- `pane-poller.ts`: 타이머 정리 보장 — cleanup 함수 반환

### 패키징
- `electron-builder` 설치 및 설정
- macOS entitlements.mac.plist 추가 (node-pty JIT 권한)
- `npm run package:dmg` 스크립트 추가

### 문서
- `README.md` — 프로젝트 소개, 설치, 사용법
- `ARCHITECTURE.md` — 아키텍처, 데이터 흐름, IPC 채널
- `CHANGELOG.md` — 릴리즈 노트
