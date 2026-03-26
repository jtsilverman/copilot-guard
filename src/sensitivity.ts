import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { minimatch } from 'minimatch';
import type { SensitivityLevel } from './types';

interface Assessment {
  level: SensitivityLevel;
  reason?: string;
}

// Filename patterns that indicate danger
const DANGER_PATTERNS = [
  { pattern: /^\.env(\..*)?$/, reason: 'Environment file (.env)' },
  { pattern: /\.(pem|key|p12|pfx|jks)$/, reason: 'Private key / certificate' },
  { pattern: /id_(rsa|ed25519|ecdsa|dsa)$/, reason: 'SSH private key' },
  { pattern: /known_hosts$/, reason: 'SSH known hosts' },
  { pattern: /\.kube\/config$/, reason: 'Kubernetes config' },
  { pattern: /credentials(\.json|\.yaml|\.yml)?$/, reason: 'Credentials file' },
  { pattern: /secrets?(\.json|\.yaml|\.yml)?$/, reason: 'Secrets file' },
  { pattern: /token(s)?(\.json|\.txt)?$/i, reason: 'Token file' },
];

// Content patterns that indicate warning (only checked for open documents)
const CONTENT_PATTERNS = [
  { pattern: /(?:API_KEY|APIKEY)\s*[=:]\s*\S+/i, reason: 'Contains API key assignment' },
  { pattern: /(?:SECRET|PASSWORD|PASSWD)\s*[=:]\s*\S+/i, reason: 'Contains secret/password' },
  { pattern: /(?:PRIVATE_KEY|PRIVATE KEY)\s*[=:]/i, reason: 'Contains private key' },
  { pattern: /(?:AWS_ACCESS_KEY|AWS_SECRET)/i, reason: 'Contains AWS credentials' },
  { pattern: /ghp_[a-zA-Z0-9]{36}/i, reason: 'Contains GitHub token' },
  { pattern: /sk-[a-zA-Z0-9]{20,}/i, reason: 'Contains API key (sk-...)' },
];

export class SensitivityDetector {
  private copilotignorePatterns: string[] = [];
  private workspaceRoot: string | null = null;

  constructor() {
    this.loadCopilotignore();

    // Watch for .copilotignore changes
    const watcher = vscode.workspace.createFileSystemWatcher('**/.copilotignore');
    watcher.onDidChange(() => this.loadCopilotignore());
    watcher.onDidCreate(() => this.loadCopilotignore());
    watcher.onDidDelete(() => { this.copilotignorePatterns = []; });
  }

  private loadCopilotignore(): void {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return;

    this.workspaceRoot = folders[0].uri.fsPath;
    const ignorePath = path.join(this.workspaceRoot, '.copilotignore');

    try {
      const content = fs.readFileSync(ignorePath, 'utf-8');
      this.copilotignorePatterns = content
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'));
    } catch {
      this.copilotignorePatterns = [];
    }
  }

  assess(uri: vscode.Uri, content?: string): Assessment {
    const fileName = path.basename(uri.fsPath);
    const relativePath = this.workspaceRoot
      ? path.relative(this.workspaceRoot, uri.fsPath)
      : fileName;

    // Check filename danger patterns
    for (const { pattern, reason } of DANGER_PATTERNS) {
      if (pattern.test(fileName) || pattern.test(relativePath)) {
        return { level: 'danger', reason };
      }
    }

    // Check .copilotignore patterns
    for (const ignorePattern of this.copilotignorePatterns) {
      if (minimatch(relativePath, ignorePattern, { dot: true })) {
        return { level: 'warning', reason: `Matched .copilotignore: ${ignorePattern}` };
      }
    }

    // Check content patterns (only if content provided)
    if (content) {
      // Only scan first 5000 chars for performance
      const sample = content.slice(0, 5000);
      for (const { pattern, reason } of CONTENT_PATTERNS) {
        if (pattern.test(sample)) {
          return { level: 'warning', reason };
        }
      }
    }

    return { level: 'safe' };
  }
}
