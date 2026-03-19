[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | **中文**

# Mulaude

**多会话 Claude Code 终端** — 同时管理多个 Claude Code 会话的 macOS 桌面应用

## 主要功能

- **多会话**: 在多个项目中同时运行独立的 Claude Code 会话
- **终端网格分割**: 基于二叉树的水平/垂直自由分割（最多10个面板），拖拽交换/重新排列面板位置
- **会话持久化**: 基于 tmux — 关闭应用后会话仍然保持，重启时自动恢复
- **代理/团队视图**: 当 Claude 的团队模式激活时，通过分割面板实时监控子代理
- **Hook 集成**: 通过 Claude Code Hooks 系统实现精确的状态追踪（idle、thinking、tool、permission 等）
- **交互式教程**: 首次启动时的7步引导（语言/主题设置→项目创建→分割→快捷键）
- **6种主题**: Void、Ocean、Ember、Forest、Arctic、Rosé
- **4种语言**: English、한국어、日本語、中文
- **图片和文件支持**: 剪贴板图片粘贴（⌘V）+ 从 Finder 拖放文件
- **用量监控**: 在侧边栏实时查看 Claude 计划用量
- **Cowrk Agents**: 持久化 AI 队友 — 从侧边栏创建、聊天、管理代理，保持人设和记忆
- **会话恢复**: 重启后通过 `--resume` 自动继续之前的 Claude 对话
- **Web 预览**: 集成 dev 服务器预览面板，自动 URL 检测

## 为什么选择 Mulaude？

Claude Code 可以在普通终端、tmux 或官方 Claude Desktop 应用中使用。以下是 Mulaude 的差异化优势：

### vs. 普通终端（iTerm2、Terminal.app）

| | 普通终端 | Mulaude |
|---|---|---|
| 多会话 | 手动打开标签页，分别运行 `claude` | 侧边栏项目/会话层级管理，一键切换 |
| 同时监控 | 一次只能看一个（需要切换标签） | 网格分割，最多10个会话同时观察 |
| 会话持久化 | 关闭终端就没了 | 基于 tmux — 应用退出后仍保持，重启时自动恢复 |
| 状态感知 | 需要直接看屏幕 | 侧边栏实时显示 idle/thinking/tool/permission 状态 |
| 团队代理 | 需要在各个终端中分别查看 | 自动检测 + 分割面板实时监控 |
| 用量追踪 | 在 `claude` 内部或网页仪表盘查看 | 侧边栏实时用量仪表 |

### vs. tmux（手动管理）

| | tmux 手动管理 | Mulaude |
|---|---|---|
| 配置 | 需要自己配置 tmux、管理分割和会话 | 拖放分割，自动会话管理 |
| 回滚查看 | 手动进入 copy-mode（`Ctrl+B [`） | 鼠标滚轮自然滚动（IPC 自动 copy-mode） |
| 文本选择 | 仅在 copy-mode 中可用（需额外操作） | 直接拖拽选择文本 + 复制 |
| 状态追踪 | 无 — 需要直接看屏幕 | Hook 系统实现精确的自动状态追踪 |
| 代理管理 | 手动查找和切换面板 | 基于 team config 的自动检测 + 侧边栏树 |
| 调整大小 | 仅依赖 tmux reflow | 原子级 resize+capture + PTY 缓冲，无损坏 |

### vs. Claude Desktop 应用（官方）

| | Claude Desktop | Mulaude |
|---|---|---|
| 本质 | 包装 Web 聊天 UI 的原生应用 | 包装 Claude Code CLI 的终端 IDE |
| 代码执行 | 通过 MCP 服务器的有限访问 | 完整 CLI 访问 — git、npm、构建工具等一切 |
| 多会话 | 对话标签切换 | 项目级独立会话 + 网格同时监控 |
| 团队/代理 | 不支持 | 自动检测 + 代理分割视图 |
| 会话持久化 | 服务端对话历史 | 本地 tmux 持久化（离线也可用） |
| 自定义 | 几乎没有 | 6种主题、4种语言、自由分割、Hook 集成 |

### 一句话总结

Mulaude 是 **"Claude Code 控制塔"** — 在一个屏幕上监控多个项目，无需切换上下文即可捕获 permission 提示，在 Claude 的团队代理工作时实时观察一切。终端的完整能力加上 GUI 的便捷性。

## 安装

### 方法1: DMG 下载（普通用户）

1. 从 [Releases](https://github.com/mylumiere/mulaude/releases) 下载最新的 `.dmg` 文件
2. 挂载 DMG → 将 Mulaude 拖入 Applications
3. 首次启动时可能出现**"未验证的开发者"**警告：

   **方法A** — 前往 `系统设置` > `隐私与安全` > 点击**「仍然打开」**

   **方法B** — 在终端中运行以下命令：
   ```bash
   find /Applications/Mulaude.app -exec xattr -d com.apple.quarantine {} + 2>/dev/null
   ```

   > 应用已进行 Ad-hoc 签名但未经公证（Notarization），因此 macOS Gatekeeper 会阻止首次启动。使用以上任一方法后即可正常运行。

### 方法2: 源码构建（开发者）

```bash
git clone https://github.com/mylumiere/mulaude.git
cd mulaude
npm install
npm run dev
```

### 前置要求

| 要求 | 安装方式 | 必需 |
|------|---------|------|
| **macOS** | — | ✅ |
| **Node.js** 18+ | [nodejs.org](https://nodejs.org) | ✅（源码构建时） |
| **tmux** | `brew install tmux` | ✅ |
| **Claude Code CLI** | `npm i -g @anthropic-ai/claude-code` | ✅ |

> Claude Code CLI 必须已完成认证（确认 `claude` 命令可正常运行）。

## 使用方法

### 首次启动

1. 启动应用 → 选择语言/主题 → 开始教程
2. 按照教程体验项目创建、会话添加、分割等操作
3. 教程可跳过，随时从侧边栏底部重新开始

### 基本工作流

1. 点击 `+` 按钮或 `⌘N` → 选择项目目录
2. 自动创建会话，在所选目录中运行 `claude` CLI
3. 可在同一项目中添加更多会话，或添加其他项目
4. 通过侧边栏切换会话、查看状态

### 网格分割

- 从侧边栏**拖拽**会话到终端区域 → 自动分割
- 拖拽面板标题栏交换/重新排列位置
- `⌘W` — 关闭当前聚焦的面板
- `⌘⇧↵` — 切换聚焦面板的缩放
- `⌘←→↑↓` — 在面板间移动焦点

### 快捷键

| 快捷键 | 操作 |
|--------|------|
| `⌘,` | 设置 |
| `⌘/` | 快捷键列表 |
| `⌘N` | 新建项目 |
| `⌘1~9` | 切换当前项目内的会话 |
| `⌥⌘1~9` | 切换项目 |
| `⌘↑↓` | 上一个/下一个会话 |
| `⌘W` | 关闭面板 |
| `⌘⇧↵` | 缩放切换 |
| `⌘←→↑↓` | 网格面板焦点移动 |
| `⌥⌘←→↑↓` | 代理面板焦点移动 |

### 团队模式

在 Claude Code 中使用团队模式（TeamCreate）时：
- 自动检测子代理的 tmux 面板
- 在侧边栏显示代理树
- 终端区域分割为多个面板，实时监控代理输出

## 构建

```bash
# 生产构建
npm run build

# macOS DMG 打包
npm run package:dmg

# macOS 全量（DMG + ZIP）
npm run package:mac
```

构建产物位于 `release/` 目录。

## 技术栈

| 领域 | 技术 |
|------|------|
| 框架 | Electron 33 |
| UI | React 19 + TypeScript 5.9 |
| 终端 | xterm.js 6 |
| PTY | node-pty 1.1（基于 tmux） |
| 构建 | electron-vite 5 |
| 打包 | electron-builder 26 |

## 项目结构

```
src/
├── main/                      # Electron Main 进程
│   ├── index.ts               # 应用入口
│   ├── ipc-handlers.ts        # IPC 处理器注册
│   ├── session-manager.ts     # 会话创建/销毁、PTY 管理
│   ├── session-store.ts       # ~/.mulaude/sessions.json 持久化
│   ├── session-forwarder.ts   # 会话数据批量转发
│   ├── env-resolver.ts        # Shell 环境变量/Claude 路径探测
│   ├── pane-poller.ts         # 代理面板轮询
│   ├── team-config-scanner.ts # 团队 config 扫描/缓存
│   ├── agent-matcher.ts       # 代理-面板匹配
│   ├── close-handler.ts       # 关闭对话框
│   ├── hooks-manager.ts       # Claude Code Hooks 监听
│   ├── child-pane-streamer.ts # 子面板流式传输
│   ├── tmux-utils.ts          # tmux 命令工具
│   ├── logger.ts              # 文件日志
│   ├── cowrk-manager.ts       # Cowrk 代理编排器
│   └── cowrk/                 # Cowrk 代理内部（store、manager、types）
├── preload/
│   └── index.ts               # contextBridge API
├── renderer/                  # React 应用
│   ├── App.tsx                # 根组件
│   ├── i18n.ts                # 国际化
│   ├── themes.ts              # 6种主题
│   ├── roadmap.ts             # 路线图数据
│   ├── settings.ts            # 设置类型/工具
│   ├── pty-parser.ts          # PTY 输出解析器
│   ├── hooks/                 # React 自定义 hooks（13个）
│   ├── utils/                 # 纯工具函数
│   │   ├── pane-tree.ts       # 二叉树数据结构/运算
│   │   └── pane-storage.ts    # 布局 localStorage 持久化
│   └── components/            # React 组件（18个）
│       └── cowrk/             # Cowrk 代理 UI（Section、ChatPanel、CreateDialog）
└── shared/
    ├── types.ts               # 共享类型
    └── constants.ts           # 共享常量（37个）
```

## 贡献

欢迎在 [Issues](https://github.com/mylumiere/mulaude/issues) 提交 Bug 报告和功能建议。

## 许可证

MIT
