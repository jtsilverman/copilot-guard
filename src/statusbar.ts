import * as vscode from 'vscode';
import type { SensitivityLevel } from './types';

const STATUS_CONFIG: Record<SensitivityLevel, { icon: string; text: string; color: string }> = {
  safe: { icon: '$(shield)', text: 'Safe', color: '' },
  warning: { icon: '$(warning)', text: 'Caution', color: 'statusBarItem.warningBackground' },
  danger: { icon: '$(error)', text: 'DANGER', color: 'statusBarItem.errorBackground' },
};

export class StatusBarManager {
  private item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'copilotGuard.showDashboard';
    this.item.tooltip = 'Copilot Guard: Click to open dashboard';
    this.update('safe');
    this.item.show();
  }

  update(level: SensitivityLevel): void {
    const config = STATUS_CONFIG[level];
    this.item.text = `${config.icon} ${config.text}`;
    this.item.backgroundColor = config.color
      ? new vscode.ThemeColor(config.color)
      : undefined;
  }

  dispose(): void {
    this.item.dispose();
  }
}
