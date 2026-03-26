import * as vscode from 'vscode';
import { ContextTracker } from './tracker';
import { SensitivityDetector } from './sensitivity';
import { StatusBarManager } from './statusbar';
import { DashboardViewProvider } from './dashboard';

export function activate(context: vscode.ExtensionContext) {
  const detector = new SensitivityDetector();
  const tracker = new ContextTracker((uri, content) => detector.assess(uri, content));
  const statusBar = new StatusBarManager();
  const dashboardProvider = new DashboardViewProvider(context.extensionUri);

  // Register sidebar webview
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      DashboardViewProvider.viewType,
      dashboardProvider
    )
  );

  // Start tracking
  tracker.activate(context);

  // Update UI on changes
  tracker.on('change', () => {
    const status = tracker.getOverallStatus();
    statusBar.update(status);
    dashboardProvider.update({
      status,
      exposures: tracker.getCurrentExposures(),
      stats: tracker.getSessionStats(),
    });
  });

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('copilotGuard.showDashboard', () => {
      vscode.commands.executeCommand('copilotGuard.dashboard.focus');
    }),
    vscode.commands.registerCommand('copilotGuard.toggleCopilot', () => {
      vscode.commands.executeCommand('editor.action.inlineSuggest.toggle');
      vscode.window.showInformationMessage('Copilot Guard: Toggled inline suggestions');
    }),
  );

  context.subscriptions.push({ dispose: () => statusBar.dispose() });

  // Initial dashboard update
  setTimeout(() => {
    dashboardProvider.update({
      status: tracker.getOverallStatus(),
      exposures: tracker.getCurrentExposures(),
      stats: tracker.getSessionStats(),
    });
  }, 500);

  console.log('Copilot Guard activated');
}

export function deactivate() {}
