# Copilot Guard

VS Code extension that shows you exactly what context GitHub Copilot has access to in real-time. Flags sensitive files, supports `.copilotignore`, and tracks your code exposure.

## Demo

[Marketplace link] | [Screenshot placeholder]

## The Problem

On March 25, 2026, GitHub announced that Copilot interaction data from all user tiers would be used for AI model training, with automatic opt-in. The backlash was immediate (900+ upvotes on r/programming). But even after opting out of training, most developers have no visibility into what context Copilot accesses during normal use. Your `.env` files, credentials, private keys, and proprietary code are all in Copilot's potential context whenever they're open in your editor.

## How It Works

Copilot Guard monitors VS Code editor state in real-time using the Extension API:

- **File tracking:** Detects when files are opened, closed, edited, and scrolled. Maintains a live map of everything in Copilot's potential context.
- **Sensitivity detection:** Built-in rules flag dangerous files (`.env`, `.pem`, `id_rsa`, credentials) and scan content for secrets (`API_KEY=`, `sk-...`, GitHub tokens).
- **`.copilotignore`:** Drop a `.copilotignore` file in your workspace root (same syntax as `.gitignore`) to mark files that should trigger warnings.
- **Status bar:** Green shield (safe), yellow warning (caution), red alert (secrets in context).
- **Sidebar dashboard:** Real-time view of all exposed files with sensitivity badges, session stats (files exposed, estimated tokens, warnings), and quick actions.

**What it can't do:** VS Code extensions can't intercept other extensions' network requests due to process sandboxing. Copilot Guard shows maximum possible exposure, not actual bytes sent. This is still valuable: knowing which files are in Copilot's context lets you close sensitive files before they're processed.

## Features

- Real-time file exposure tracking
- Sensitive file detection (`.env`, `.pem`, credentials, API keys, tokens)
- Content scanning for secrets (API_KEY=, PASSWORD=, sk-..., ghp_...)
- `.copilotignore` support (gitignore syntax)
- Status bar indicator (green/yellow/red)
- Sidebar dashboard with session stats
- One-key Copilot toggle (Cmd+Shift+G / Ctrl+Shift+G)
- Zero configuration required

## Install

From VS Code:
1. Open Extensions (Cmd+Shift+X)
2. Search "Copilot Guard"
3. Install

Or from CLI:
```bash
code --install-extension copilot-guard-0.1.0.vsix
```

## `.copilotignore` Example

```
# Flag these files when they're in Copilot's context
*.secret
config/production.*
internal/**
migrations/**
*.sql
```

## Tech Stack

- TypeScript, VS Code Extension API
- Webview panel for the sidebar dashboard
- minimatch for `.copilotignore` pattern matching
- Zero external runtime dependencies (minimatch is the only dep)

## The Hard Part

Accurately estimating what Copilot "knows" without access to its internal state. Copilot's context window is opaque, so the extension tracks all editor state changes (file opens, edits, visible ranges) and reports the maximum possible exposure. This is honest and actionable: "these files were in Copilot's potential context" lets users make informed decisions about what to keep open.

## License

MIT
