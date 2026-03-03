**English** | [한국어](README.ko.md) | [日本語](README.ja.md) | [中文](README.zh.md)

# Mulaude

**Multi-session Claude Code Terminal** — A macOS desktop app for managing multiple Claude Code sessions simultaneously

## Key Features

- **Multi-session**: Run independent Claude Code sessions across multiple projects simultaneously
- **Terminal Grid Split**: Binary tree-based horizontal/vertical free splitting (up to 10 panes), drag to swap/reorder panes
- **Session Persistence**: tmux-based — sessions survive app exit and auto-restore on restart
- **Agent/Team View**: When Claude's team mode is active, monitor sub-agents in real-time via split panes
- **Hook Integration**: Accurate state tracking (idle, thinking, tool, permission, etc.) via Claude Code Hooks system
- **Interactive Tutorial**: 7-step guide on first launch (language/theme setup → project creation → splitting → shortcuts)
- **6 Themes**: Void, Ocean, Ember, Forest, Arctic, Rosé
- **4 Languages**: English, 한국어, 日本語, 中文
- **Image & File Support**: Clipboard image paste (⌘V) + drag-and-drop files from Finder
- **Usage Monitor**: View Claude plan usage in real-time from the sidebar

## Why Mulaude?

Claude Code can be used in a regular terminal, tmux, or the official Claude Desktop app. Here's what Mulaude brings to the table:

### vs. Regular Terminal (iTerm2, Terminal.app)

| | Regular Terminal | Mulaude |
|---|---|---|
| Multi-session | Open tabs manually, run `claude` in each | Sidebar with project/session hierarchy, one-click switching |
| Simultaneous monitoring | One session visible at a time | Grid split — up to 6 sessions side by side |
| Session persistence | Close terminal = gone | tmux-based — survives app exit, auto-restores on restart |
| Status awareness | Have to look at the screen | Sidebar shows idle/thinking/tool/permission in real-time |
| Team agents | Check each terminal separately | Auto-detected + split pane monitoring |
| Usage tracking | Check inside `claude` or web dashboard | Real-time usage gauge in sidebar |

### vs. tmux (Manual Setup)

| | tmux Manual | Mulaude |
|---|---|---|
| Setup | Configure tmux, manage splits/sessions yourself | Drag-and-drop splitting, automatic session management |
| Scrollback | Manual copy-mode entry (`Ctrl+B [`) | Mouse wheel scrolls naturally (auto copy-mode via IPC) |
| Text selection | Only in copy-mode (separate workflow) | Native drag-to-select + copy, anytime |
| State tracking | None — watch the screen | Hooks system for accurate automatic state tracking |
| Agent management | Find and switch panes manually | Auto-detection via team config + sidebar tree |
| Resize handling | tmux reflow only | Atomic resize+capture with PTY buffering — no corruption |

### vs. Claude Desktop App

| | Claude Desktop | Mulaude |
|---|---|---|
| Nature | Web chat UI in a native wrapper | Terminal IDE wrapping Claude Code CLI |
| Code execution | Limited via MCP servers | Full CLI access — git, npm, build tools, everything |
| Multi-session | Conversation tabs | Project-based sessions + grid for simultaneous monitoring |
| Team/Agents | Not supported | Auto-detection + agent split view |
| Session persistence | Server-side chat history | Local tmux persistence (works offline) |
| Customization | Minimal | 6 themes, 4 languages, free-form grid, Hook integration |

### In short

Mulaude is a **"Claude Code control tower"** — monitor multiple projects at a glance, catch permission prompts without context-switching, and let Claude's team agents work while you watch everything in real-time. Full terminal power with GUI convenience.

## Installation

### Option 1: DMG Download (General Users)

1. Download the latest `.dmg` from [Releases](https://github.com/mylumiere/mulaude/releases)
2. Mount the DMG → Drag Mulaude to Applications
3. On first launch, you may see "damaged and can't be opened" or "unidentified developer" warning:

   **Run this command in Terminal:**
   ```bash
   xattr -cr /Applications/Mulaude.app
   ```
   Or go to `System Settings` > `Privacy & Security` > `Open Anyway`

   > The app is not code-signed, so macOS Gatekeeper blocks it. The command above removes the quarantine attribute to allow normal execution.

### Option 2: Build from Source (Developers)

```bash
git clone https://github.com/mylumiere/mulaude.git
cd mulaude
npm install
npm run dev
```

### Prerequisites

| Requirement | Installation | Required |
|------------|-------------|----------|
| **macOS** | — | ✅ |
| **Node.js** 18+ | [nodejs.org](https://nodejs.org) | ✅ (for source build) |
| **tmux** | `brew install tmux` | ✅ |
| **Claude Code CLI** | `npm i -g @anthropic-ai/claude-code` | ✅ |

> Claude Code CLI must be authenticated (`claude` command should work).

## Usage

### First Launch

1. Launch app → Select language/theme → Start tutorial
2. Follow the tutorial to create a project, add sessions, split panes, etc.
3. Tutorial can be skipped and restarted anytime from the sidebar bottom

### Basic Workflow

1. `+` button or `⌘N` → Select project directory
2. A session is auto-created, running `claude` CLI in the selected directory
3. Add more sessions to the same project, or add different projects
4. Switch between sessions and check status from the sidebar

### Grid Split

- **Drag** a session from the sidebar and drop onto the terminal area → auto-split
- Drag pane headers to swap/reorder positions
- `⌘W` — Close focused pane
- `⌘⇧↵` — Toggle zoom on focused pane
- `⌘←→↑↓` — Move focus between panes

### Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘,` | Settings |
| `⌘/` | Shortcut list |
| `⌘N` | New project |
| `⌘1~9` | Switch session within current project |
| `⌥⌘1~9` | Switch project |
| `⌘↑↓` | Previous/next session |
| `⌘W` | Close pane |
| `⌘⇧↵` | Toggle zoom |
| `⌘←→↑↓` | Grid pane focus |
| `⌥⌘←→↑↓` | Agent pane focus |

### Team Mode

When using Claude Code's team mode (TeamCreate):
- Sub-agent tmux panes are auto-detected
- Agent tree is displayed in the sidebar
- Terminal area splits into panes for real-time agent output monitoring

## Build

```bash
# Production build
npm run build

# macOS DMG packaging
npm run package:dmg

# macOS full (DMG + ZIP)
npm run package:mac
```

Build output goes to the `release/` directory.

## Tech Stack

| Area | Technology |
|------|-----------|
| Framework | Electron 33 |
| UI | React 19 + TypeScript 5.9 |
| Terminal | xterm.js 6 |
| PTY | node-pty 1.1 (tmux-based) |
| Build | electron-vite 5 |
| Packaging | electron-builder 26 |

## Project Structure

```
src/
├── main/                      # Electron Main Process
│   ├── index.ts               # App entry point
│   ├── ipc-handlers.ts        # IPC handler registration
│   ├── session-manager.ts     # Session create/destroy, PTY management
│   ├── session-store.ts       # ~/.mulaude/sessions.json persistence
│   ├── session-forwarder.ts   # Session data batch forwarding
│   ├── env-resolver.ts        # Shell env / Claude path resolution
│   ├── pane-poller.ts         # Agent pane polling
│   ├── team-config-scanner.ts # Team config scanning/caching
│   ├── agent-matcher.ts       # Agent-pane matching
│   ├── close-handler.ts       # Close dialog
│   ├── hooks-manager.ts       # Claude Code Hooks watcher
│   ├── child-pane-streamer.ts # Child pane streaming
│   ├── tmux-utils.ts          # tmux command utilities
│   └── logger.ts              # File logger
├── preload/
│   └── index.ts               # contextBridge API
├── renderer/                  # React App
│   ├── App.tsx                # Root component
│   ├── i18n.ts                # Internationalization
│   ├── themes.ts              # 6 themes
│   ├── roadmap.ts             # Roadmap data
│   ├── settings.ts            # Settings types/utils
│   ├── pty-parser.ts          # PTY output parser
│   ├── hooks/                 # React custom hooks (12)
│   ├── utils/                 # Pure utilities
│   │   ├── pane-tree.ts       # Binary tree data structure/operations
│   │   └── pane-storage.ts    # Layout localStorage persistence
│   └── components/            # React components (15)
└── shared/
    ├── types.ts               # Shared types
    └── constants.ts           # Shared constants (37)
```

## Contributing

Bug reports and feature requests are welcome at [Issues](https://github.com/mylumiere/mulaude/issues).

## License

MIT
