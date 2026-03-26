import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import type { FileExposure, SessionStats, SensitivityLevel } from './types';

export class ContextTracker extends EventEmitter {
  private exposures = new Map<string, FileExposure>();
  private startTime = Date.now();
  private totalWarnings = 0;
  private disposables: vscode.Disposable[] = [];
  private assessFn: (uri: vscode.Uri, content?: string) => { level: SensitivityLevel; reason?: string };

  constructor(assessFn: (uri: vscode.Uri, content?: string) => { level: SensitivityLevel; reason?: string }) {
    super();
    this.assessFn = assessFn;
  }

  activate(context: vscode.ExtensionContext): void {
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((doc) => this.onDocumentOpen(doc)),
      vscode.workspace.onDidCloseTextDocument((doc) => this.onDocumentClose(doc)),
      vscode.workspace.onDidChangeTextDocument((e) => this.onDocumentChange(e)),
      vscode.window.onDidChangeActiveTextEditor((e) => this.onEditorChange(e)),
      vscode.window.onDidChangeTextEditorVisibleRanges((e) => this.onVisibleRangesChange(e)),
    );

    // Track already-open documents
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.scheme === 'file') {
        this.trackDocument(doc);
      }
    }

    context.subscriptions.push(...this.disposables);
  }

  private onDocumentOpen(doc: vscode.TextDocument): void {
    if (doc.uri.scheme !== 'file') return;
    this.trackDocument(doc);
  }

  private onDocumentClose(doc: vscode.TextDocument): void {
    const key = doc.uri.toString();
    if (this.exposures.delete(key)) {
      this.emitChange();
    }
  }

  private onDocumentChange(e: vscode.TextDocumentChangeEvent): void {
    const key = e.document.uri.toString();
    const exposure = this.exposures.get(key);
    if (exposure) {
      exposure.lastEditedAt = Date.now();
      exposure.lineCount = e.document.lineCount;

      // Re-assess sensitivity on content change
      const assessment = this.assessFn(e.document.uri, e.document.getText());
      if (assessment.level !== exposure.sensitivityLevel) {
        exposure.sensitivityLevel = assessment.level;
        exposure.sensitivityReason = assessment.reason;
        if (assessment.level !== 'safe') {
          this.totalWarnings++;
        }
      }
      this.emitChange();
    }
  }

  private onEditorChange(editor: vscode.TextEditor | undefined): void {
    if (!editor || editor.document.uri.scheme !== 'file') return;
    this.trackDocument(editor.document);
    this.updateVisibleRanges(editor);
  }

  private onVisibleRangesChange(e: vscode.TextEditorVisibleRangesChangeEvent): void {
    this.updateVisibleRanges(e.textEditor);
  }

  private trackDocument(doc: vscode.TextDocument): void {
    const key = doc.uri.toString();
    if (this.exposures.has(key)) return;

    const assessment = this.assessFn(doc.uri, doc.getText());
    if (assessment.level !== 'safe') {
      this.totalWarnings++;
    }

    const exposure: FileExposure = {
      uri: key,
      fileName: vscode.workspace.asRelativePath(doc.uri),
      language: doc.languageId,
      openedAt: Date.now(),
      lastEditedAt: null,
      visibleRanges: [],
      lineCount: doc.lineCount,
      sensitivityLevel: assessment.level,
      sensitivityReason: assessment.reason,
    };

    this.exposures.set(key, exposure);
    this.emitChange();
  }

  private updateVisibleRanges(editor: vscode.TextEditor): void {
    const key = editor.document.uri.toString();
    const exposure = this.exposures.get(key);
    if (exposure) {
      exposure.visibleRanges = editor.visibleRanges.map((r) => ({
        start: r.start.line,
        end: r.end.line,
      }));
      this.emitChange();
    }
  }

  private emitChange(): void {
    this.emit('change');
  }

  getCurrentExposures(): FileExposure[] {
    return Array.from(this.exposures.values()).sort((a, b) => {
      // Danger first, then warning, then safe
      const order = { danger: 0, warning: 1, safe: 2 };
      return order[a.sensitivityLevel] - order[b.sensitivityLevel];
    });
  }

  getOverallStatus(): SensitivityLevel {
    const exposures = this.getCurrentExposures();
    if (exposures.some((e) => e.sensitivityLevel === 'danger')) return 'danger';
    if (exposures.some((e) => e.sensitivityLevel === 'warning')) return 'warning';
    return 'safe';
  }

  getSessionStats(): SessionStats {
    const exposures = this.getCurrentExposures();
    const sensitive = exposures.filter((e) => e.sensitivityLevel !== 'safe');
    const totalLines = exposures.reduce((sum, e) => sum + e.lineCount, 0);

    return {
      startTime: this.startTime,
      filesExposed: exposures.length,
      sensitiveFilesExposed: sensitive.length,
      estimatedTokens: totalLines * 4,
      warnings: this.totalWarnings,
    };
  }
}
