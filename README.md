[English](README.en.md) | **한국어** | [日本語](README.ja.md) | [中文](README.zh.md)

# Mulaude

**Multi-session Claude Code Terminal** — 여러 Claude Code 세션을 동시에 관리하는 macOS 데스크톱 앱

## 주요 기능

- **멀티 세션**: 여러 프로젝트에서 독립 Claude Code 세션을 동시 실행
- **터미널 그리드 분할**: 이진 트리 기반 수평/수직 자유 분할 (최대 6패인), 드래그로 패인 위치 교환/재배치
- **세션 영속화**: tmux 기반 — 앱을 종료해도 세션이 유지되고, 재시작 시 자동 복원
- **에이전트/팀 뷰**: Claude의 팀 모드 활성화 시 하위 에이전트를 split pane으로 실시간 모니터링
- **Hook 통합**: Claude Code Hooks 시스템과 연동하여 정확한 상태 추적 (idle, thinking, tool, permission 등)
- **인터랙티브 튜토리얼**: 첫 실행 시 7단계 가이드 (언어/테마 설정 → 프로젝트 생성 → 분할 → 단축키)
- **6가지 테마**: Void, Ocean, Ember, Forest, Arctic, Rosé
- **4개 언어**: English, 한국어, 日本語, 中文
- **사용량 모니터**: Claude 플랜 사용량을 사이드바에서 실시간 확인

## 설치

### 방법 1: DMG 다운로드 (일반 사용자)

1. [Releases](https://github.com/mylumiere/mulaude/releases) 에서 최신 `.dmg` 파일 다운로드
2. DMG 마운트 → Mulaude를 Applications로 드래그
3. 첫 실행 시 "손상되었기 때문에 열 수 없습니다" 또는 "확인되지 않은 개발자" 경고가 나타남:

   **터미널에서 아래 명령어를 실행하세요:**
   ```bash
   xattr -cr /Applications/Mulaude.app
   ```
   또는 `시스템 설정` > `개인정보 보호 및 보안` > `확인 없이 열기` 클릭

   > 코드 서명이 되어있지 않아 macOS Gatekeeper가 차단합니다. 위 명령어로 quarantine 속성을 제거하면 정상 실행됩니다.

### 방법 2: 소스 빌드 (개발자)

```bash
git clone https://github.com/mylumiere/mulaude.git
cd mulaude
npm install
npm run dev
```

### 사전 요구사항

| 요구사항 | 설치 방법 | 필수 |
|---------|----------|------|
| **macOS** | — | ✅ |
| **Node.js** 18+ | [nodejs.org](https://nodejs.org) | ✅ (소스 빌드 시) |
| **tmux** | `brew install tmux` | ✅ |
| **Claude Code CLI** | `npm i -g @anthropic-ai/claude-code` | ✅ |

> Claude Code CLI가 인증 완료 상태여야 합니다 (`claude` 명령어가 동작하는지 확인).

## 사용법

### 첫 실행

1. 앱 실행 → 언어/테마 선택 → 튜토리얼 시작
2. 튜토리얼을 따라 프로젝트 생성, 세션 추가, 분할 등을 체험
3. 튜토리얼은 스킵 가능하며, 사이드바 하단에서 언제든 재시작 가능

### 기본 워크플로우

1. `+` 버튼 또는 `⌘N` → 프로젝트 디렉토리 선택
2. 세션이 자동 생성되며 선택한 디렉토리에서 `claude` CLI 실행
3. 같은 프로젝트에 세션을 추가하거나, 다른 프로젝트를 추가 가능
4. 사이드바에서 세션 간 전환, 상태 확인

### 그리드 분할

- 사이드바에서 세션을 **드래그**하여 터미널 영역에 드롭 → 자동 분할
- 패인 헤더를 드래그하여 위치 교환/재배치
- `⌘W` — 포커스된 패인 닫기
- `⌘⇧↵` — 포커스된 패인 줌 토글
- `⌘←→↑↓` — 패인 간 포커스 이동

### 단축키

| 단축키 | 동작 |
|--------|------|
| `⌘,` | 설정 |
| `⌘/` | 단축키 목록 |
| `⌘N` | 새 프로젝트 생성 |
| `⌘1~9` | 현재 프로젝트 내 세션 전환 |
| `⌥⌘1~9` | 프로젝트 전환 |
| `⌘↑↓` | 이전/다음 세션 |
| `⌘W` | 패인 닫기 |
| `⌘⇧↵` | 줌 토글 |
| `⌘←→↑↓` | 그리드 패인 포커스 이동 |
| `⌥⌘←→↑↓` | 에이전트 패인 포커스 이동 |

### 팀 모드

Claude Code에서 팀(TeamCreate)을 사용하면:
- 하위 에이전트의 tmux pane이 자동 감지됨
- 사이드바에 에이전트 트리 표시
- 터미널 영역이 split pane으로 분할되어 에이전트 출력을 실시간 모니터링

## 빌드

```bash
# 프로덕션 빌드
npm run build

# macOS DMG 패키징
npm run package:dmg

# macOS 전체 (DMG + ZIP)
npm run package:mac
```

빌드 결과물은 `release/` 디렉토리에 생성됩니다.

## 기술 스택

| 영역 | 기술 |
|------|------|
| 프레임워크 | Electron 33 |
| UI | React 19 + TypeScript 5.9 |
| 터미널 | xterm.js 6 |
| PTY | node-pty 1.1 (tmux 기반) |
| 빌드 | electron-vite 5 |
| 패키징 | electron-builder 26 |

## 프로젝트 구조

```
src/
├── main/                      # Electron Main 프로세스
│   ├── index.ts               # 앱 진입점
│   ├── ipc-handlers.ts        # IPC 핸들러 등록
│   ├── session-manager.ts     # 세션 생성/삭제, PTY 관리
│   ├── session-store.ts       # ~/.mulaude/sessions.json 영속화
│   ├── session-forwarder.ts   # 세션 데이터 배치 포워딩
│   ├── env-resolver.ts        # 셸 환경변수/Claude 경로 탐색
│   ├── pane-poller.ts         # 에이전트 pane 폴링
│   ├── team-config-scanner.ts # 팀 config 스캔/캐싱
│   ├── agent-matcher.ts       # 에이전트-pane 매칭
│   ├── close-handler.ts       # 닫기 다이얼로그
│   ├── hooks-manager.ts       # Claude Code Hooks 감시
│   ├── child-pane-streamer.ts # 자식 pane 스트리밍
│   └── tmux-utils.ts          # tmux 명령어 유틸
├── preload/
│   └── index.ts               # contextBridge API
├── renderer/                  # React 앱
│   ├── App.tsx                # 루트 컴포넌트
│   ├── i18n.ts                # 다국어
│   ├── themes.ts              # 6가지 테마
│   ├── roadmap.ts             # 로드맵 데이터
│   ├── settings.ts            # 설정 타입/유틸
│   ├── pty-parser.ts          # PTY 출력 파서
│   ├── hooks/                 # React 커스텀 훅 (11개)
│   ├── utils/                 # 순수 유틸리티
│   │   ├── pane-tree.ts       # 이진 트리 자료구조/연산
│   │   └── pane-storage.ts    # 레이아웃 localStorage 영속화
│   └── components/            # React 컴포넌트 (15개)
└── shared/
    ├── types.ts               # 공유 타입
    └── constants.ts           # 공유 상수 (41개)
```

## 기여

버그 리포트, 기능 제안은 [Issues](https://github.com/mylumiere/mulaude/issues)에 남겨주세요.

## 라이선스

MIT
