# Copilot Guard

## Overview

A VS Code extension that shows you exactly what context GitHub Copilot has access to in real-time. Tracks which files are open, what's visible, recent edits, and flags sensitive files (.env, credentials, secrets). Provides a sidebar dashboard with a live "context exposure" view and lets you define a `.copilotignore` file to get warnings when sensitive files enter Copilot's context. Built in response to the March 2026 GitHub Copilot training data backlash (898 upvotes on r/programming).

## Scope

- **Timebox:** 1.5 days
- **Building:**
  - Sidebar panel showing real-time Copilot context: open files, active editor, visible ranges, recent edits
  - Sensitivity detector: flags .env, .pem, credentials, secrets, private keys when they're in Copilot's context
  - `.copilotignore` support: user-defined patterns for files that should trigger warnings
  - Session stats: files exposed, estimated tokens sent, time with sensitive files open
  - Quick actions: disable Copilot for current file, open Copilot settings
  - Status bar indicator: green (safe) / yellow (sensitive file open) / red (secrets in context)
- **Not building:**
  - Actual network interception (impossible from extension sandbox)
  - Blocking Copilot from reading files (can't enforce this)
  - Support for non-Copilot AI coding tools
  - Settings sync or cloud features
- **Ship target:** VS Code Marketplace + GitHub

## Project Type

**Pure code** (VS Code extension, TypeScript)

## Stack

- **Language:** TypeScript
- **Framework:** VS Code Extension API (`vscode` module)
- **View:** Webview panel for the dashboard (HTML/CSS/JS)
- **Why:** VS Code extensions must be TypeScript/JavaScript. Webview panel gives rich UI without framework overhead. This is a new project type for Jake's portfolio (first extension).

## Architecture

### Directory Structure

```
copilot-guard/
  src/
    extension.ts         # Activation, register commands/views
    tracker.ts           # Context tracking: file opens, edits, visible ranges
    sensitivity.ts       # Sensitive file detection + .copilotignore parsing
    dashboard.ts         # Webview provider for sidebar panel
    statusbar.ts         # Status bar indicator
    types.ts             # TypeScript types
  media/
    dashboard.html       # Webview HTML template
    dashboard.js         # Webview client-side JS
    dashboard.css        # Webview styles
  package.json           # Extension manifest + contributions
  tsconfig.json
  .vscodeignore
  README.md
```

### Data Types

```typescript
interface FileExposure {
  uri: string
  fileName: string
  language: string
  openedAt: number
  lastEditedAt: number | null
  visibleRanges: { start: number; end: number }[]
  lineCount: number
  sensitivityLevel: 'safe' | 'warning' | 'danger'
  sensitivityReason?: string
}

interface SessionStats {
  startTime: number
  filesExposed: number
  sensitiveFilesExposed: number
  estimatedTokens: number
  warnings: number
}

type SensitivityLevel = 'safe' | 'warning' | 'danger'
```

### VS Code API Usage

```typescript
// Track file context
vscode.workspace.onDidOpenTextDocument      // File opened
vscode.workspace.onDidCloseTextDocument     // File closed
vscode.workspace.onDidChangeTextDocument    // File edited
vscode.window.onDidChangeActiveTextEditor   // Editor focus changed
vscode.window.onDidChangeVisibleTextEditors // Visible editors changed
vscode.window.onDidChangeTextEditorVisibleRanges // Scroll/visible range changed

// Status bar
vscode.window.createStatusBarItem

// Sidebar panel
vscode.window.registerWebviewViewProvider

// Commands
vscode.commands.registerCommand('copilotGuard.toggleCopilot', ...)
vscode.commands.registerCommand('copilotGuard.showDashboard', ...)
```

### Sensitivity Detection Rules

Built-in patterns (always active):
- `.env`, `.env.*` files → danger
- `*.pem`, `*.key`, `*.p12`, `*.pfx` → danger
- `*credentials*`, `*secret*`, `*token*` in filename → danger
- `id_rsa`, `id_ed25519`, `known_hosts` → danger
- Files containing `API_KEY=`, `SECRET=`, `PASSWORD=` patterns → warning

`.copilotignore` patterns (user-defined):
- Same syntax as `.gitignore`
- Placed in workspace root
- Files matching patterns → warning level

### Dashboard Webview

The sidebar shows:
1. **Status badge:** "SAFE" / "CAUTION" / "DANGER" with color
2. **Active context:** List of currently open files with sensitivity badges
3. **Recent activity:** Timeline of file opens/edits in this session
4. **Session stats:** Files exposed, estimated tokens, warnings count
5. **Sensitive files:** Highlighted section for any flagged files with reason

Communication: extension ↔ webview via `postMessage` / `onDidReceiveMessage`.

## Task List

### Phase 1: Project Setup

#### Task 1.1: Scaffold VS Code Extension
**Files:** `package.json` (create), `tsconfig.json` (create), `src/types.ts` (create), `src/extension.ts` (create stub)
**Do:** Create package.json with VS Code extension manifest: name "copilot-guard", activationEvents (onStartupFinished), contributes (commands, views, viewsContainers). Add devDependencies: @types/vscode, typescript, @vscode/vsce. Create tsconfig targeting ES2022 with vscode types. Create types.ts with all interfaces. Create minimal extension.ts that logs "Copilot Guard activated" on activate.
**Validate:** `npm install && npm run build`

### Phase 2: Context Tracking

#### Task 2.1: File Context Tracker
**Files:** `src/tracker.ts` (create), `src/extension.ts` (modify)
**Do:** Create ContextTracker class. On activate, subscribe to all relevant VS Code events (onDidOpenTextDocument, onDidCloseTextDocument, onDidChangeTextDocument, onDidChangeActiveTextEditor, onDidChangeVisibleTextEditors). Maintain a Map<string, FileExposure> of currently exposed files. Track session stats (files exposed, edits). Emit events when exposure changes. Expose getCurrentExposures() and getSessionStats(). Estimate tokens as lineCount * 4 (rough approximation). Wire into extension.ts activation.
**Validate:** `npm run build`

#### Task 2.2: Sensitivity Detector
**Files:** `src/sensitivity.ts` (create)
**Do:** Create SensitivityDetector class. Built-in rules: check filename patterns (.env, .pem, etc.) and file content patterns (API_KEY=, SECRET=, etc.). Load .copilotignore from workspace root if it exists, parse as gitignore-style patterns using minimatch. Method: assess(uri, content?) -> { level: SensitivityLevel, reason?: string }. File content scanning is opt-in (only for open documents, not filesystem scan).
**Validate:** `npm run build && node -e "console.log('build ok')"`

### Phase 3: UI Components

#### Task 3.1: Status Bar Indicator
**Files:** `src/statusbar.ts` (create), `src/extension.ts` (modify)
**Do:** Create StatusBarManager. Shows an item in the status bar: shield icon + text. Green "$(shield) Safe" when no sensitive files open. Yellow "$(warning) Caution" when warning-level files open. Red "$(error) Danger" when danger-level files open. Clicking opens the dashboard. Updates whenever tracker emits a change. Wire into extension activation.
**Validate:** `npm run build`

#### Task 3.2: Dashboard Webview
**Files:** `src/dashboard.ts` (create), `media/dashboard.html` (create), `media/dashboard.js` (create), `media/dashboard.css` (create), `src/extension.ts` (modify)
**Do:** Create DashboardViewProvider implementing WebviewViewProvider. Renders the sidebar panel with: status badge, active file list with sensitivity indicators, session stats, recent activity timeline. The webview receives data via postMessage from the extension. Auto-updates when tracker state changes. Style with a dark theme matching VS Code. Register as a sidebar view in extension.ts.
**Validate:** `npm run build`

### Phase 4: Commands and Integration

#### Task 4.1: Commands and Packaging
**Files:** `src/extension.ts` (modify), `package.json` (modify), `.vscodeignore` (create)
**Do:** Register commands: copilotGuard.showDashboard (focus sidebar), copilotGuard.toggleCopilot (runs workbench.action.toggleInlineSuggest), copilotGuard.openCopilotSettings (opens GitHub Copilot settings). Add keybinding for toggle (Ctrl+Shift+G). Create .vscodeignore (exclude src/, node_modules/, tsconfig). Verify the full extension loads without errors.
**Validate:** `npm run build && npx @vscode/vsce package --no-dependencies 2>&1 | grep -q ".vsix" && echo "PASS"`

### Phase 5: End-to-End Integration Test

#### Task 5.1: Integration Test
**Files:** `tests/integration.js` (create)
**Do:** Write tests that: 1) Import and instantiate ContextTracker with mock VS Code events, feed mock file open/close/edit events, verify exposure tracking works. 2) Test SensitivityDetector with various filenames (.env, normal.ts, id_rsa) and verify correct levels. 3) Test .copilotignore parsing with sample patterns. 4) Verify VSIX package builds successfully.
**Validate:** `npm run build && node tests/integration.js`

### Phase 6: Ship

#### Task 6.1: README and Marketplace Config
**Files:** `README.md` (create), `.gitignore` (create), `CHANGELOG.md` (create)
**Do:** Portfolio-ready README with: problem (Copilot context exposure), screenshots placeholder, features list, install instructions, .copilotignore example, how it works, tech stack, the hard part, license. CHANGELOG with v0.1.0 entry. .gitignore for node_modules, out, *.vsix.
**Validate:** `npx @vscode/vsce package --no-dependencies 2>&1 | tail -5`

## The One Hard Thing

**Accurately estimating what Copilot "knows" without access to its internal state.**

Why it's hard: Copilot's context window is opaque. We can't see exactly what it sends to GitHub. We can only observe editor state (open files, visible ranges, recent edits) and infer what Copilot likely has access to. The challenge is making this inference useful without being misleading.

Proposed approach: Track all VS Code document events and editor state changes. Show the "maximum possible exposure" rather than guessing the exact context. This is honest and more useful for privacy-conscious users: "these files were in Copilot's potential context" is actionable even if Copilot didn't send all of them.

Fallback: If the inference model is too noisy (everything looks exposed), add configurable scope: only track files you've actively edited or focused, not just opened. Both approaches are viable.

## Risks

- **VS Code API limitations (medium):** Can't intercept actual network traffic. Mitigated by pivoting to context awareness (what Copilot could see) rather than traffic monitoring (what it actually sent).
- **False sense of security (medium):** Users might think blocking = safety. Mitigated by clear messaging: "This shows exposure, not a blocker."
- **Copilot internal changes (low):** Copilot may change how it gathers context. Our approach tracks VS Code editor state, not Copilot internals, so it's resilient.
- **Marketplace approval (low):** Extension is read-only, no security risks. Should pass review.
