import * as vscode from 'vscode';
import type { DashboardData } from './types';

export class DashboardViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'copilotGuard.dashboard';
  private view: vscode.WebviewView | undefined;
  private extensionUri: vscode.Uri;

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
  }

  private latestData: DashboardData | undefined;

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    // Clear view reference when sidebar is hidden
    webviewView.onDidDispose(() => {
      this.view = undefined;
    });

    // Re-send latest data whenever the webview is (re)opened
    if (this.latestData) {
      setTimeout(() => {
        webviewView.webview.postMessage({ type: 'update', data: this.latestData });
      }, 100);
    }
  }

  update(data: DashboardData): void {
    this.latestData = data;
    if (this.view) {
      this.view.webview.postMessage({ type: 'update', data });
    }
  }

  private getNonce(): string {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
  }

  private getHtml(webview: vscode.Webview): string {
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'dashboard.css'));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'dashboard.js'));
    const nonce = this.getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${cssUri}">
</head>
<body>
  <div id="status-badge" class="status-badge safe">SAFE</div>

  <div class="section">
    <h2>Session Stats</h2>
    <div class="stats-grid">
      <div class="stat"><span class="stat-value" id="stat-files">0</span><span class="stat-label">Files exposed</span></div>
      <div class="stat"><span class="stat-value" id="stat-sensitive">0</span><span class="stat-label">Sensitive</span></div>
      <div class="stat"><span class="stat-value" id="stat-tokens">0</span><span class="stat-label">Est. tokens</span></div>
      <div class="stat"><span class="stat-value" id="stat-warnings">0</span><span class="stat-label">Warnings</span></div>
    </div>
  </div>

  <div class="section">
    <h2>Active Context</h2>
    <div id="file-list"><p class="empty">No files open</p></div>
  </div>

  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }
}
