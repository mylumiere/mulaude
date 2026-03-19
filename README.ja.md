[English](README.md) | [한국어](README.ko.md) | **日本語** | [中文](README.zh.md)

# Mulaude

**マルチセッション Claude Code ターミナル** — 複数のClaude Codeセッションを同時に管理するmacOSデスクトップアプリ

## 主な機能

- **マルチセッション**: 複数プロジェクトで独立したClaude Codeセッションを同時実行
- **ターミナルグリッド分割**: 二分木ベースの水平/垂直自由分割（最大10ペイン）、ドラッグでペイン位置の交換/再配置
- **セッション永続化**: tmuxベース — アプリ終了後もセッションが維持され、再起動時に自動復元
- **エージェント/チームビュー**: Claudeのチームモード使用時、サブエージェントをスプリットペインでリアルタイム監視
- **Hook統合**: Claude Code Hooksシステムとの連携による正確な状態追跡（idle、thinking、tool、permissionなど）
- **インタラクティブチュートリアル**: 初回起動時の7ステップガイド（言語/テーマ設定→プロジェクト作成→分割→ショートカット）
- **6つのテーマ**: Void、Ocean、Ember、Forest、Arctic、Rosé
- **4言語対応**: English、한국어、日本語、中文
- **画像＆ファイル対応**: クリップボード画像ペースト（⌘V）+ Finderからファイルドラッグ＆ドロップ
- **使用量モニター**: Claudeプランの使用量をサイドバーでリアルタイム確認
- **Cowrk Agents**: 永続AIチームメイト — サイドバーからエージェントの作成・チャット・管理、ペルソナ＆メモリ維持
- **セッション再開**: 再起動後に`--resume`で前回のClaude会話を自動的に引き継ぎ
- **Webプレビュー**: devサーバー実行/プレビュー/プロセス管理統合パネル

## なぜMulaudeなのか？

Claude Codeは通常のターミナル、tmux、公式Claude Desktopアプリで使用できます。Mulaudeが提供する違い：

### vs. 通常のターミナル（iTerm2、Terminal.app）

| | 通常のターミナル | Mulaude |
|---|---|---|
| マルチセッション | タブを手動で開き、それぞれ`claude`を実行 | サイドバーでプロジェクト/セッション階層管理、ワンクリック切り替え |
| 同時監視 | 一度に1つしか見えない（タブ切り替えが必要） | グリッド分割で最大10セッションを同時観察 |
| セッション永続化 | ターミナルを閉じたら終了 | tmuxベース — アプリ終了後も維持、再起動時に自動復元 |
| 状態把握 | 画面を直接見る必要がある | サイドバーでidle/thinking/tool/permissionをリアルタイム表示 |
| チームエージェント | 別のターミナルで個別に確認 | 自動検出＋スプリットペインでリアルタイム監視 |
| 使用量追跡 | `claude`内部またはWebダッシュボードで確認 | サイドバーでリアルタイム使用量ゲージ |

### vs. tmux（手動管理）

| | tmux手動管理 | Mulaude |
|---|---|---|
| セットアップ | tmux設定、分割、セッション管理を自分で行う | ドラッグ＆ドロップで分割、自動セッション管理 |
| スクロールバック | 手動でcopy-mode進入（`Ctrl+B [`） | マウスホイールで自然にスクロール（IPC経由の自動copy-mode） |
| テキスト選択 | copy-modeでのみ可能（別操作） | 通常のドラッグで即座にテキスト選択＋コピー |
| 状態追跡 | なし — 画面を直接確認 | Hookシステムによる正確な自動状態追跡 |
| エージェント管理 | ペインを手動で探して切り替え | team config基準の自動検出＋サイドバーツリー |
| リサイズ | tmux reflowのみ | atomic resize+capture＋PTYバッファリングで破損なし |

### vs. Claude Desktopアプリ（公式）

| | Claude Desktop | Mulaude |
|---|---|---|
| 本質 | WebチャットUIをラップしたネイティブアプリ | Claude Code CLIをラップしたターミナルIDE |
| コード実行 | MCPサーバー経由の限定的アクセス | フルCLIアクセス — git、npm、ビルドツールなど全て |
| マルチセッション | 会話タブ切り替え | プロジェクト別独立セッション＋グリッド同時監視 |
| チーム/エージェント | 非対応 | 自動検出＋エージェントスプリットビュー |
| セッション永続化 | サーバーベースの会話履歴 | ローカルtmux永続化（オフラインでも維持） |
| カスタマイズ | ほぼなし | 6テーマ、4言語、自由分割、Hook統合 |

### 一言で

Mulaudeは**「Claude Code管制塔」** — 複数プロジェクトを一画面で監視し、コンテキスト切り替えなしにpermissionプロンプトをキャッチし、Claudeのチームエージェントの作業をリアルタイムで観察できます。ターミナルのフルパワーにGUIの利便性を加えたアプリです。

## インストール

### 方法1: DMGダウンロード（一般ユーザー）

1. [Releases](https://github.com/mylumiere/mulaude/releases)から最新の`.dmg`ファイルをダウンロード
2. DMGをマウント → MulaudeをApplicationsにドラッグ
3. 初回起動時に**「未確認の開発元」**の警告が表示される場合：

   **方法A** — `システム設定` > `プライバシーとセキュリティ` > **「このまま開く」**をクリック

   **方法B** — ターミナルで以下のコマンドを実行：
   ```bash
   find /Applications/Mulaude.app -exec xattr -d com.apple.quarantine {} + 2>/dev/null
   ```

   > Ad-hoc署名済みですが公証（Notarization）がないため、macOS Gatekeeperが初回起動をブロックします。上記いずれかの方法で以降は正常に実行できます。

### 方法2: ソースビルド（開発者）

```bash
git clone https://github.com/mylumiere/mulaude.git
cd mulaude
npm install
npm run dev
```

### 前提条件

| 要件 | インストール方法 | 必須 |
|------|---------------|------|
| **macOS** | — | ✅ |
| **Node.js** 18+ | [nodejs.org](https://nodejs.org) | ✅（ソースビルド時） |
| **tmux** | `brew install tmux` | ✅ |
| **Claude Code CLI** | `npm i -g @anthropic-ai/claude-code` | ✅ |

> Claude Code CLIが認証済みである必要があります（`claude`コマンドが動作するか確認してください）。

## 使い方

### 初回起動

1. アプリ起動 → 言語/テーマ選択 → チュートリアル開始
2. チュートリアルに従ってプロジェクト作成、セッション追加、分割などを体験
3. チュートリアルはスキップ可能で、サイドバー下部からいつでも再開可能

### 基本ワークフロー

1. `+`ボタンまたは`⌘N` → プロジェクトディレクトリを選択
2. セッションが自動作成され、選択したディレクトリで`claude` CLIが実行
3. 同じプロジェクトにセッションを追加、または別のプロジェクトを追加可能
4. サイドバーでセッション間の切り替え、状態確認

### グリッド分割

- サイドバーからセッションを**ドラッグ**してターミナル領域にドロップ → 自動分割
- ペインヘッダーをドラッグして位置交換/再配置
- `⌘W` — フォーカスされたペインを閉じる
- `⌘⇧↵` — フォーカスされたペインのズームトグル
- `⌘←→↑↓` — ペイン間のフォーカス移動

### ショートカット

| ショートカット | 動作 |
|-------------|------|
| `⌘,` | 設定 |
| `⌘/` | ショートカット一覧 |
| `⌘N` | 新規プロジェクト作成 |
| `⌘1~9` | 現在のプロジェクト内セッション切り替え |
| `⌥⌘1~9` | プロジェクト切り替え |
| `⌘↑↓` | 前/次のセッション |
| `⌘W` | ペインを閉じる |
| `⌘⇧↵` | ズームトグル |
| `⌘←→↑↓` | グリッドペインフォーカス移動 |
| `⌥⌘←→↑↓` | エージェントペインフォーカス移動 |

### チームモード

Claude Codeでチーム（TeamCreate）を使用すると：
- サブエージェントのtmuxペインが自動検出
- サイドバーにエージェントツリーを表示
- ターミナル領域がスプリットペインに分割され、エージェント出力をリアルタイム監視

## ビルド

```bash
# プロダクションビルド
npm run build

# macOS DMGパッケージング
npm run package:dmg

# macOS全体（DMG + ZIP）
npm run package:mac
```

ビルド成果物は`release/`ディレクトリに生成されます。

## 技術スタック

| 領域 | 技術 |
|------|------|
| フレームワーク | Electron 33 |
| UI | React 19 + TypeScript 5.9 |
| ターミナル | xterm.js 6 |
| PTY | node-pty 1.1（tmuxベース） |
| ビルド | electron-vite 5 |
| パッケージング | electron-builder 26 |

## プロジェクト構造

```
src/
├── main/                      # Electron Mainプロセス
│   ├── index.ts               # アプリエントリポイント
│   ├── ipc-handlers.ts        # IPCハンドラ登録
│   ├── session-manager.ts     # セッション作成/削除、PTY管理
│   ├── session-store.ts       # ~/.mulaude/sessions.json永続化
│   ├── session-forwarder.ts   # セッションデータバッチ転送
│   ├── env-resolver.ts        # シェル環境変数/Claudeパス探索
│   ├── pane-poller.ts         # エージェントペインポーリング
│   ├── team-config-scanner.ts # チームconfigスキャン/キャッシュ
│   ├── agent-matcher.ts       # エージェント-ペインマッチング
│   ├── close-handler.ts       # 終了ダイアログ
│   ├── hooks-manager.ts       # Claude Code Hooks監視
│   ├── child-pane-streamer.ts # 子ペインストリーミング
│   ├── tmux-utils.ts          # tmuxコマンドユーティリティ
│   ├── logger.ts              # ファイルロガー
│   ├── cowrk-manager.ts       # Cowrkエージェントオーケストレーター
│   └── cowrk/                 # Cowrkエージェント内部（store、manager、types）
├── preload/
│   └── index.ts               # contextBridge API
├── renderer/                  # Reactアプリ
│   ├── App.tsx                # ルートコンポーネント
│   ├── i18n.ts                # 多言語対応
│   ├── themes.ts              # 6つのテーマ
│   ├── roadmap.ts             # ロードマップデータ
│   ├── settings.ts            # 設定タイプ/ユーティリティ
│   ├── pty-parser.ts          # PTY出力パーサー
│   ├── hooks/                 # Reactカスタムフック（13個）
│   ├── utils/                 # 純粋ユーティリティ
│   │   ├── pane-tree.ts       # 二分木データ構造/演算
│   │   └── pane-storage.ts    # レイアウトlocalStorage永続化
│   └── components/            # Reactコンポーネント（18個）
│       └── cowrk/             # CowrkエージェントUI（Section、ChatPanel、CreateDialog）
└── shared/
    ├── types.ts               # 共有タイプ
    └── constants.ts           # 共有定数（37個）
```

## コントリビューション

バグ報告や機能提案は[Issues](https://github.com/mylumiere/mulaude/issues)にお願いします。

## ライセンス

MIT
