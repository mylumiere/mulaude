# Mulaude 프로젝트 구조 분석

## 1. 디렉토리 구조

```
mulaude/
├── src/                          # 소스 코드
│   ├── main/                     # Electron 메인 프로세스 (5개 파일)
│   │   ├── index.ts              # 앱 초기화, 윈도우 생성
│   │   ├── session-manager.ts    # 세션 생성, 삭제, 관리
│   │   ├── session-store.ts      # 세션 상태 저장/로드 (파일 기반)
│   │   ├── hooks-manager.ts      # Claude Code Hooks 시스템
│   │   └── tmux-utils.ts         # tmux 유틸리티 함수
│   ├── preload/                  # Preload 스크립트
│   │   └── index.ts              # IPC 채널 및 API 노출
│   ├── renderer/                 # React UI (13개 파일)
│   │   ├── App.tsx               # 루트 컴포넌트
│   │   ├── main.tsx              # React 마운트
│   │   ├── env.d.ts              # TypeScript 타입 선언
│   │   ├── i18n.ts               # 다국어 지원 (en/ko/ja/zh)
│   │   ├── themes.ts             # 6개 테마 정의
│   │   ├── settings.ts           # 사용자 설정 관리
│   │   ├── pty-parser.ts         # PTY 데이터 파싱
│   │   ├── components/           # React 컴포넌트 (4개)
│   │   │   ├── Sidebar.tsx       # 왼쪽 사이드바 (프로젝트/세션)
│   │   │   ├── TerminalView.tsx  # 오른쪽 터미널 뷰
│   │   │   ├── SettingsModal.tsx # 설정 모달
│   │   │   └── TmuxMissingBanner.tsx # tmux 없음 경고
│   │   └── hooks/                # 커스텀 훅 (5개)
│   │       ├── useSessionManager.ts     # 세션 관리
│   │       ├── useSessionStatus.ts      # 세션 상태 추적
│   │       ├── useNotifications.ts      # 알림 시스템
│   │       ├── useSettings.ts           # 설정 관리
│   │       └── useKeyboardShortcuts.ts  # 키보드 단축키
│   └── shared/                   # 공유 타입 및 유틸
│       └── types.ts              # SessionInfo, HookEvent 등
├── docs/                         # 프로젝트 문서
│   └── DESIGN_SYSTEM.md          # 디자인 시스템 문서
├── out/                          # 빌드 출력 디렉토리
│   ├── main/                     # 컴파일된 메인 프로세스
│   ├── preload/                  # 컴파일된 프리로드
│   └── renderer/                 # 컴파일된 렌더러
├── resources/                    # 앱 리소스 (아이콘, 설정 등)
├── node_modules/                 # npm 패키지
└── 설정 파일들
    ├── package.json              # 프로젝트 메타데이터, 스크립트, 의존성
    ├── package-lock.json         # 의존성 잠금 파일
    ├── electron.vite.config.ts   # Electron + Vite 빌드 설정
    ├── tsconfig.json             # 기본 TypeScript 설정 (참고 파일)
    ├── tsconfig.node.json        # 메인/프리로드 TypeScript 설정
    ├── tsconfig.web.json         # 렌더러 TypeScript 설정
    ├── electron-builder.yml      # 앱 빌드 및 패키징 설정
    ├── IDEAS.md                  # 개발 아이디어 노트
    └── .claude/                  # Claude Code 프로젝트 설정

```

## 2. package.json 분석

### 프로젝트 메타데이터
- **이름**: mulaude (멀티 세션 Claude Code 터미널)
- **버전**: 1.0.0
- **진입점**: `./out/main/index.js` (컴파일된 메인 프로세스)
- **라이센스**: ISC

### 빌드 스크립트
```json
{
  "dev": "electron-vite dev",          // 개발 모드 실행
  "build": "electron-vite build",      // 프로덕션 빌드
  "preview": "electron-vite preview",  // 빌드 결과 미리보기
  "postinstall": "@electron/rebuild -f -w node-pty"  // node-pty 네이티브 바인딩 재빌드
}
```

### 의존성 (Runtime)
| 패키지 | 버전 | 용도 |
|--------|------|------|
| `react` | ^19.2.4 | React UI 프레임워크 |
| `react-dom` | ^19.2.4 | React DOM 렌더링 |
| `@xterm/xterm` | ^6.0.0 | 터미널 에뮬레이터 UI |
| `@xterm/addon-fit` | ^0.11.0 | xterm.js 자동 크기 조정 |
| `node-pty` | ^1.1.0 | 의사 터미널(PTY) 생성 |
| `@electron-toolkit/preload` | ^3.0.2 | Preload 유틸리티 |
| `@electron-toolkit/utils` | ^4.0.0 | Electron 유틸리티 |

### 개발 의존성 (DevDependencies)
| 패키지 | 버전 | 용도 |
|--------|------|------|
| `electron` | ^33.4.11 | Electron 프레임워크 |
| `electron-vite` | ^5.0.0 | Electron + Vite 빌드 도구 |
| `typescript` | ^5.9.3 | TypeScript 컴파일러 |
| `@vitejs/plugin-react` | ^5.1.4 | Vite React 플러그인 |
| `@types/react` | ^19.2.14 | React 타입 정의 |
| `@types/react-dom` | ^19.2.3 | React DOM 타입 정의 |
| `@electron/rebuild` | ^4.0.3 | 네이티브 모듈 재빌드 |
| `electron-rebuild` | ^3.2.9 | 일반 Electron 빌드 도구 |

## 3. electron-vite 설정 분석

```typescript
// electron.vite.config.ts
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]  // 메인: node_modules 외부화
  },
  preload: {
    plugins: [externalizeDepsPlugin()]  // 프리로드: node_modules 외부화
  },
  renderer: {
    plugins: [react()]                   // 렌더러: React JSX 변환
  }
})
```

### 특징
- **3가지 빌드 대상**: main, preload, renderer 각각 독립 빌드
- **externalizeDepsPlugin**: 메인/프리로드에서 node_modules 직접 참조
- **React 플러그인**: 렌더러에만 React JSX 변환 적용

## 4. TypeScript 설정 분석

### 기본 설정 (tsconfig.json)
```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.web.json" }
  ]
}
```
- **프로젝트 참조 기반**: 3개 빌드 대상별로 tsconfig 분리

### 메인/프리로드 설정 (tsconfig.node.json)
```json
{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "outDir": "./out",
    "rootDir": "./src",
    "strict": true,
    "skipLibCheck": true,
    "declaration": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": [
    "src/main/**/*",
    "src/preload/**/*",
    "src/shared/**/*",
    "electron.vite.config.ts"
  ]
}
```

### 렌더러 설정 (tsconfig.web.json)
```json
{
  "compilerOptions": {
    // ... 위와 동일하지만
    "jsx": "react-jsx"  // React 17+ JSX 변환
  },
  "include": ["src/renderer/**/*", "src/shared/**/*"]
}
```

### 공통 컴파일러 옵션
| 옵션 | 값 | 의도 |
|------|---|----|
| `module` | ESNext | 최신 ES 모듈 사용 |
| `moduleResolution` | bundler | Vite 번들러와 호환 |
| `strict` | true | 완전한 타입 안전성 |
| `declaration` | true | .d.ts 파일 생성 |
| `isolatedModules` | true | 각 모듈 독립 컴파일 |
| `composite` | true | 프로젝트 참조 지원 |

## 5. Electron Builder 설정 (electron-builder.yml)

### 메타데이터
```yaml
appId: com.mulaude.app          # macOS/Windows 번들 ID
productName: Mulaude            # 앱 표시 이름
directories:
  buildResources: resources      # 리소스 디렉토리
```

### 빌드 대상
| 플랫폼 | 대상 | 설명 |
|--------|------|------|
| macOS | dmg, zip | DMG 디스크 이미지 + ZIP 아카이브 |
| Windows | nsis | NSIS 설치 프로그램 |
| Linux | AppImage | 독립적 실행 가능 이미지 |

### 파일 제외 (빌드 시 제외됨)
- `.vscode/**/*` - VS Code 설정
- `src/**/*` - 소스 코드 (컴파일 후 제외)
- `electron.vite.config.*` - 빌드 설정
- `.eslintrc`, `.prettierrc` 등 - 린터/포매터 설정
- TypeScript 설정 파일들

### macOS 특화 설정
- **entitlements**: `resources/entitlements.mac.plist` 참조
- **artifactName**: 버전과 아키텍처 포함

## 6. 소스 코드 파일 트리 (총 23개 파일)

### 메인 프로세스 (5개)
```
src/main/
├── index.ts (메인)
├── session-manager.ts (세션 CRUD)
├── session-store.ts (상태 영속화)
├── hooks-manager.ts (Hook 시스템)
└── tmux-utils.ts (tmux 유틸)
```

### 프리로드 (1개)
```
src/preload/
└── index.ts (IPC 채널 노출)
```

### 렌더러 (13개)
```
src/renderer/
├── App.tsx (루트)
├── main.tsx (진입점)
├── env.d.ts (타입)
├── i18n.ts (다국어)
├── themes.ts (테마)
├── settings.ts (설정)
├── pty-parser.ts (파싱)
├── components/ (4개)
│   ├── Sidebar.tsx
│   ├── TerminalView.tsx
│   ├── SettingsModal.tsx
│   └── TmuxMissingBanner.tsx
└── hooks/ (5개)
    ├── useSessionManager.ts
    ├── useSessionStatus.ts
    ├── useNotifications.ts
    ├── useSettings.ts
    └── useKeyboardShortcuts.ts
```

### 공유 (1개)
```
src/shared/
└── types.ts (공유 타입)
```

## 7. 문서 구조

- `docs/DESIGN_SYSTEM.md` - 디자인 시스템 및 스타일 가이드
- `docs/PROJECT_STRUCTURE.md` - **본 파일** (프로젝트 구조 분석)
- `IDEAS.md` - 개발 아이디어 및 개선 사항 노트

## 8. 빌드 및 배포 흐름

```
개발 (dev)
  ↓
TypeScript 컴파일 (3가지 target)
  ├── src/main → out/main
  ├── src/preload → out/preload
  └── src/renderer → out/renderer
  ↓
Electron Vite 빌드 (build)
  ↓
Electron Builder로 패키징
  ├── macOS: DMG + ZIP
  ├── Windows: NSIS
  └── Linux: AppImage
  ↓
배포 가능 상태
```

## 9. 주요 기술 스택 요약

| 계층 | 기술 | 버전 |
|------|------|------|
| 데스크톱 프레임워크 | Electron | 33.4.11 |
| UI 프레임워크 | React | 19.2.4 |
| 언어 | TypeScript | 5.9.3 |
| 빌드 도구 | Vite + electron-vite | 5.0.0 |
| 터미널 UI | xterm.js | 6.0.0 |
| 의사 터미널 | node-pty | 1.1.0 |
| 세션 관리 | tmux | (네이티브) |

---

**분석 완료일**: 2026-02-26
**분석 범위**: 디렉토리 구조, 설정 파일, 의존성, 빌드 시스템
