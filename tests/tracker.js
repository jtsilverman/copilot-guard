// Tests for ContextTracker (compiled output) with mocked vscode API
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

let failures = 0;

function assert(cond, msg) {
  if (!cond) { console.error(`  FAIL: ${msg}`); failures++; }
}

// --- vscode mock ---
// Minimal mock that satisfies ContextTracker's needs
function makeVscodeMock() {
  const openHandlers = [];
  const closeHandlers = [];
  const changeHandlers = [];
  const editorChangeHandlers = [];
  const visibleRangesHandlers = [];

  const disposable = { dispose() {} };

  return {
    mock: {
      workspace: {
        onDidOpenTextDocument: (fn) => { openHandlers.push(fn); return disposable; },
        onDidCloseTextDocument: (fn) => { closeHandlers.push(fn); return disposable; },
        onDidChangeTextDocument: (fn) => { changeHandlers.push(fn); return disposable; },
        textDocuments: [],
        asRelativePath: (uri) => typeof uri === 'string' ? uri : uri.fsPath,
      },
      window: {
        onDidChangeActiveTextEditor: (fn) => { editorChangeHandlers.push(fn); return disposable; },
        onDidChangeTextEditorVisibleRanges: (fn) => { visibleRangesHandlers.push(fn); return disposable; },
      },
      Disposable: { from() { return disposable; } },
    },
    fire: {
      open(doc) { openHandlers.forEach(fn => fn(doc)); },
      close(doc) { closeHandlers.forEach(fn => fn(doc)); },
      change(event) { changeHandlers.forEach(fn => fn(event)); },
      editorChange(editor) { editorChangeHandlers.forEach(fn => fn(editor)); },
      visibleRanges(event) { visibleRangesHandlers.forEach(fn => fn(event)); },
    },
  };
}

function makeDoc(fsPath, content = '', lineCount = 10, languageId = 'typescript') {
  const uriStr = `file://${fsPath}`;
  return {
    uri: { scheme: 'file', fsPath, toString: () => uriStr },
    getText: () => content,
    lineCount,
    languageId,
  };
}

// --- Load compiled ContextTracker with mocked vscode ---
// We inject the mock by patching Module._resolveFilename
import Module from 'module';

const { mock: vscodeMock, fire } = makeVscodeMock();

const originalResolve = Module._resolveFilename;
const fakeVscodeId = join(rootDir, '__fake_vscode__.js');

// Intercept require('vscode') to return our mock
Module._resolveFilename = function(request, parent, isMain, options) {
  if (request === 'vscode') return fakeVscodeId;
  return originalResolve.call(this, request, parent, isMain, options);
};

// Pre-populate the require cache with our mock
const require_ = createRequire(import.meta.url);
require_.cache[fakeVscodeId] = {
  id: fakeVscodeId,
  filename: fakeVscodeId,
  loaded: true,
  exports: vscodeMock,
};

const { ContextTracker } = require_(join(rootDir, 'out', 'tracker.js'));

// Restore original resolve
Module._resolveFilename = originalResolve;

// ============================================================
// Test 1: Track document open
// ============================================================
console.log('Test 1: Track document open');
{
  const assessFn = (uri) => ({ level: 'safe' });
  const tracker = new ContextTracker(assessFn);
  const context = { subscriptions: [] };
  tracker.activate(context);

  const doc = makeDoc('/project/app.ts', 'const x = 1;', 5);
  fire.open(doc);

  const exposures = tracker.getCurrentExposures();
  assert(exposures.length === 1, `Expected 1 exposure, got ${exposures.length}`);
  assert(exposures[0].fileName === '/project/app.ts', 'Correct fileName');
  assert(exposures[0].sensitivityLevel === 'safe', 'Level is safe');
  assert(exposures[0].lineCount === 5, 'Line count is 5');
  assert(exposures[0].language === 'typescript', 'Language is typescript');
  assert(exposures[0].lastEditedAt === null, 'Not edited yet');
  console.log('  PASS: 6 assertions');
}

// ============================================================
// Test 2: Track document close removes exposure
// ============================================================
console.log('Test 2: Track document close');
{
  const assessFn = () => ({ level: 'safe' });
  const tracker = new ContextTracker(assessFn);
  const context = { subscriptions: [] };
  tracker.activate(context);

  const doc = makeDoc('/project/app.ts');
  fire.open(doc);
  assert(tracker.getCurrentExposures().length === 1, 'Has 1 exposure after open');

  fire.close(doc);
  assert(tracker.getCurrentExposures().length === 0, 'Has 0 exposures after close');
  console.log('  PASS: 2 assertions');
}

// ============================================================
// Test 3: Non-file schemes are ignored
// ============================================================
console.log('Test 3: Non-file schemes ignored');
{
  const assessFn = () => ({ level: 'safe' });
  const tracker = new ContextTracker(assessFn);
  const context = { subscriptions: [] };
  tracker.activate(context);

  const doc = {
    uri: { scheme: 'untitled', fsPath: '/tmp/untitled', toString: () => 'untitled:///tmp/untitled' },
    getText: () => '',
    lineCount: 1,
    languageId: 'plaintext',
  };
  fire.open(doc);
  assert(tracker.getCurrentExposures().length === 0, 'Untitled doc not tracked');
  console.log('  PASS: 1 assertion');
}

// ============================================================
// Test 4: Document change updates exposure
// ============================================================
console.log('Test 4: Document change updates exposure');
{
  const assessFn = (uri, content) => {
    if (content && content.includes('SECRET')) return { level: 'warning', reason: 'Has secret' };
    return { level: 'safe' };
  };
  const tracker = new ContextTracker(assessFn);
  const context = { subscriptions: [] };
  tracker.activate(context);

  const doc = makeDoc('/project/config.ts', 'const x = 1;', 5);
  fire.open(doc);
  assert(tracker.getCurrentExposures()[0].sensitivityLevel === 'safe', 'Initially safe');

  // Simulate content change with secret
  const changedDoc = makeDoc('/project/config.ts', 'const SECRET = "hunter2"', 6);
  fire.change({ document: changedDoc });

  const exposure = tracker.getCurrentExposures()[0];
  assert(exposure.sensitivityLevel === 'warning', 'Now warning after change');
  assert(exposure.sensitivityReason === 'Has secret', 'Correct reason');
  assert(exposure.lineCount === 6, 'Line count updated');
  assert(exposure.lastEditedAt !== null, 'lastEditedAt set');
  console.log('  PASS: 4 assertions');
}

// ============================================================
// Test 5: getOverallStatus returns correct level
// ============================================================
console.log('Test 5: getOverallStatus');
{
  // All safe
  const assessFn = () => ({ level: 'safe' });
  const tracker = new ContextTracker(assessFn);
  const context = { subscriptions: [] };
  tracker.activate(context);

  assert(tracker.getOverallStatus() === 'safe', 'Empty is safe');

  fire.open(makeDoc('/project/app.ts', '', 10));
  assert(tracker.getOverallStatus() === 'safe', 'One safe file is safe');

  // With warning
  const assessFn2 = (uri) => {
    if (uri.fsPath.includes('secret')) return { level: 'warning', reason: 'Warning' };
    if (uri.fsPath.includes('.env')) return { level: 'danger', reason: 'Danger' };
    return { level: 'safe' };
  };
  const tracker2 = new ContextTracker(assessFn2);
  const ctx2 = { subscriptions: [] };
  tracker2.activate(ctx2);

  fire.open(makeDoc('/project/safe.ts', '', 5));
  fire.open(makeDoc('/project/secret.ts', '', 5));
  assert(tracker2.getOverallStatus() === 'warning', 'Warning when warning file present');

  fire.open(makeDoc('/project/.env', '', 3));
  assert(tracker2.getOverallStatus() === 'danger', 'Danger when danger file present');
  console.log('  PASS: 4 assertions');
}

// ============================================================
// Test 6: getSessionStats returns correct counts
// ============================================================
console.log('Test 6: getSessionStats');
{
  const assessFn = (uri) => {
    if (uri.fsPath.includes('.env')) return { level: 'danger', reason: 'Env file' };
    if (uri.fsPath.includes('secret')) return { level: 'warning', reason: 'Secret' };
    return { level: 'safe' };
  };
  const tracker = new ContextTracker(assessFn);
  const context = { subscriptions: [] };
  tracker.activate(context);

  fire.open(makeDoc('/project/app.ts', '', 100));
  fire.open(makeDoc('/project/.env', '', 10));
  fire.open(makeDoc('/project/secret.ts', '', 50));

  const stats = tracker.getSessionStats();
  assert(stats.filesExposed === 3, `filesExposed: ${stats.filesExposed}`);
  assert(stats.sensitiveFilesExposed === 2, `sensitiveFilesExposed: ${stats.sensitiveFilesExposed}`);
  assert(stats.estimatedTokens === 640, `estimatedTokens: ${stats.estimatedTokens} (expected 640 = 160 lines * 4)`);
  assert(stats.warnings === 2, `warnings: ${stats.warnings}`);
  assert(typeof stats.startTime === 'number', 'startTime is number');
  console.log('  PASS: 5 assertions');
}

// ============================================================
// Test 7: getCurrentExposures sorting (danger > warning > safe)
// ============================================================
console.log('Test 7: getCurrentExposures sorting');
{
  const assessFn = (uri) => {
    if (uri.fsPath.includes('danger')) return { level: 'danger', reason: 'Danger' };
    if (uri.fsPath.includes('warn')) return { level: 'warning', reason: 'Warning' };
    return { level: 'safe' };
  };
  const tracker = new ContextTracker(assessFn);
  const context = { subscriptions: [] };
  tracker.activate(context);

  // Open in safe > warning > danger order
  fire.open(makeDoc('/project/safe.ts', '', 10));
  fire.open(makeDoc('/project/warn.ts', '', 10));
  fire.open(makeDoc('/project/danger.ts', '', 10));

  const exposures = tracker.getCurrentExposures();
  assert(exposures[0].sensitivityLevel === 'danger', 'First is danger');
  assert(exposures[1].sensitivityLevel === 'warning', 'Second is warning');
  assert(exposures[2].sensitivityLevel === 'safe', 'Third is safe');
  console.log('  PASS: 3 assertions');
}

// ============================================================
// Test 8: Duplicate opens are ignored
// ============================================================
console.log('Test 8: Duplicate opens ignored');
{
  const assessFn = () => ({ level: 'safe' });
  const tracker = new ContextTracker(assessFn);
  const context = { subscriptions: [] };
  tracker.activate(context);

  const doc = makeDoc('/project/app.ts');
  fire.open(doc);
  fire.open(doc);

  assert(tracker.getCurrentExposures().length === 1, 'Only 1 exposure despite 2 opens');
  console.log('  PASS: 1 assertion');
}

// ============================================================
// Test 9: Change emits 'change' event
// ============================================================
console.log('Test 9: Change event emission');
{
  const assessFn = () => ({ level: 'safe' });
  const tracker = new ContextTracker(assessFn);
  const context = { subscriptions: [] };
  tracker.activate(context);

  let changeCount = 0;
  tracker.on('change', () => changeCount++);

  fire.open(makeDoc('/project/app.ts'));
  assert(changeCount === 1, `1 change on open, got ${changeCount}`);

  fire.close(makeDoc('/project/app.ts'));
  assert(changeCount === 2, `2 changes after close, got ${changeCount}`);
  console.log('  PASS: 2 assertions');
}

// ============================================================
// Test 10: Warning counter increments correctly
// ============================================================
console.log('Test 10: Warning counter');
{
  let callCount = 0;
  const assessFn = (uri, content) => {
    callCount++;
    if (uri.fsPath.includes('.env')) return { level: 'danger', reason: 'Env' };
    return { level: 'safe' };
  };
  const tracker = new ContextTracker(assessFn);
  const context = { subscriptions: [] };
  tracker.activate(context);

  fire.open(makeDoc('/project/safe.ts'));
  assert(tracker.getSessionStats().warnings === 0, '0 warnings for safe file');

  fire.open(makeDoc('/project/.env', '', 3));
  assert(tracker.getSessionStats().warnings === 1, '1 warning for danger file');

  fire.open(makeDoc('/project/.env.local', '', 2));
  assert(tracker.getSessionStats().warnings === 2, '2 warnings for 2 danger files');
  console.log('  PASS: 3 assertions');
}

// ============================================================
// Summary
// ============================================================
if (failures > 0) {
  console.error(`\nFAILED: ${failures} test(s)`);
  process.exit(1);
} else {
  console.log('\nPASS: all tracker tests (31 assertions)');
}
