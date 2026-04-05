// Tests that the ACTUAL compiled sensitivity detection matches expected patterns.
// Imports from out/ instead of re-implementing regex.
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import Module from 'module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

let failures = 0;

function assert(cond, msg) {
  if (!cond) { console.error(`  FAIL: ${msg}`); failures++; }
}

// --- Mock vscode so SensitivityDetector constructor works ---
const disposable = { dispose() {} };
const watcher = {
  onDidChange() { return disposable; },
  onDidCreate() { return disposable; },
  onDidDelete() { return disposable; },
};

const vscodeMock = {
  workspace: {
    createFileSystemWatcher() { return watcher; },
    workspaceFolders: [{ uri: { fsPath: '/workspace' } }],
  },
};

// Inject mock vscode into require resolution
const fakeVscodeId = join(rootDir, '__fake_vscode_sens__.js');
const originalResolve = Module._resolveFilename;

Module._resolveFilename = function(request, parent, isMain, options) {
  if (request === 'vscode') return fakeVscodeId;
  return originalResolve.call(this, request, parent, isMain, options);
};

const require_ = createRequire(import.meta.url);
require_.cache[fakeVscodeId] = {
  id: fakeVscodeId,
  filename: fakeVscodeId,
  loaded: true,
  exports: vscodeMock,
};

const { SensitivityDetector } = require_(join(rootDir, 'out', 'sensitivity.js'));

Module._resolveFilename = originalResolve;

// Create detector instance (constructor calls loadCopilotignore which will
// fail to read .copilotignore from /workspace, falling back to empty patterns)
const detector = new SensitivityDetector();

// Helper: create a mock URI
function uri(fsPath) {
  return { fsPath };
}

// ============================================================
// Test 1: Filename danger patterns (compiled detector)
// ============================================================
console.log('Test 1: Filename danger detection (20 cases)');
{
  const dangerFiles = [
    ['.env', 'Environment file (.env)'],
    ['.env.local', 'Environment file (.env)'],
    ['.env.production', 'Environment file (.env)'],
    ['.env.development.local', 'Environment file (.env)'],
    ['server.pem', 'Private key / certificate'],
    ['cert.key', 'Private key / certificate'],
    ['keystore.p12', 'Private key / certificate'],
    ['store.pfx', 'Private key / certificate'],
    ['trust.jks', 'Private key / certificate'],
    ['id_rsa', 'SSH private key'],
    ['id_ed25519', 'SSH private key'],
    ['id_ecdsa', 'SSH private key'],
    ['id_dsa', 'SSH private key'],
    ['known_hosts', 'SSH known hosts'],
    ['credentials.json', 'Credentials file'],
    ['credentials.yaml', 'Credentials file'],
    ['credentials', 'Credentials file'],
    ['secrets.json', 'Secrets file'],
    ['secret.yml', 'Secrets file'],
    ['tokens.json', 'Token file'],
  ];

  for (const [filename, expectedReason] of dangerFiles) {
    const result = detector.assess(uri(`/workspace/${filename}`));
    assert(result.level === 'danger', `${filename} should be danger, got ${result.level}`);
    assert(result.reason === expectedReason, `${filename} reason: expected "${expectedReason}", got "${result.reason}"`);
  }
  console.log('  PASS: 20 danger filename cases');
}

// ============================================================
// Test 2: Safe filenames (compiled detector)
// ============================================================
console.log('Test 2: Safe filename detection (8 cases)');
{
  const safeFiles = [
    'app.ts', 'index.js', 'README.md', 'package.json',
    'environment.ts', 'config.ts', 'Dockerfile', 'main.go',
  ];

  for (const filename of safeFiles) {
    const result = detector.assess(uri(`/workspace/${filename}`));
    assert(result.level === 'safe', `${filename} should be safe, got ${result.level}`);
  }
  console.log('  PASS: 8 safe filename cases');
}

// ============================================================
// Test 3: Content secret detection (compiled detector)
// ============================================================
console.log('Test 3: Content secret detection (12 cases)');
{
  const secretContent = [
    ['API_KEY=sk-abc123', 'Contains API key assignment'],
    ['APIKEY: my-key-value', 'Contains API key assignment'],
    ['const SECRET = "hunter2"', 'Contains secret/password'],
    ['PASSWORD: mypass123', 'Contains secret/password'],
    ['PASSWD = letmein', 'Contains secret/password'],
    ['PRIVATE_KEY = "-----BEGIN', 'Contains private key'],
    ['PRIVATE KEY: data', 'Contains private key'],
    ['AWS_ACCESS_KEY_ID=AKIA1234', 'Contains AWS credentials'],
    ['AWS_SECRET_ACCESS_KEY=wJalr', 'Contains AWS credentials'],
    ['ghp_' + 'a'.repeat(36), 'Contains GitHub token'],
    ['sk-' + 'x'.repeat(25), 'Contains API key (sk-...)'],
    ['APIKEY = something_important', 'Contains API key assignment'],
  ];

  for (const [content, expectedReason] of secretContent) {
    const result = detector.assess(uri('/workspace/safe-name.ts'), content);
    assert(result.level === 'warning', `Content "${content.slice(0, 30)}..." should be warning, got ${result.level}`);
    assert(result.reason === expectedReason, `Content reason: expected "${expectedReason}", got "${result.reason}"`);
  }
  console.log('  PASS: 12 content secret cases');
}

// ============================================================
// Test 4: Safe content (compiled detector)
// ============================================================
console.log('Test 4: Safe content detection (5 cases)');
{
  const safeContent = [
    'const x = 42',
    '// API documentation',
    'function getSecret() { return db.query(); }',
    'import { ApiKey } from "./types"',
    'console.log("hello world")',
  ];

  for (const content of safeContent) {
    const result = detector.assess(uri('/workspace/app.ts'), content);
    assert(result.level === 'safe', `"${content.slice(0, 40)}" should be safe, got ${result.level}`);
  }
  console.log('  PASS: 5 safe content cases');
}

// ============================================================
// Test 5: Filename danger takes precedence over content
// ============================================================
console.log('Test 5: Filename danger precedence over content');
{
  // .env file with safe content should still be danger (filename match)
  const result = detector.assess(uri('/workspace/.env'), 'NODE_ENV=development');
  assert(result.level === 'danger', 'Filename danger overrides content check');
  assert(result.reason === 'Environment file (.env)', 'Danger reason from filename');
  console.log('  PASS: 2 assertions');
}

// ============================================================
// Test 6: Content truncation (only first 5000 chars scanned)
// ============================================================
console.log('Test 6: Content truncation at 5000 chars');
{
  // Secret at position 4990 (within range)
  const earlySecret = 'x'.repeat(4990) + 'API_KEY=leaked';
  const resultEarly = detector.assess(uri('/workspace/app.ts'), earlySecret);
  assert(resultEarly.level === 'warning', 'Secret within 5000 chars detected');

  // Secret at position 5010 (beyond range)
  const lateSecret = 'x'.repeat(5010) + 'API_KEY=leaked';
  const resultLate = detector.assess(uri('/workspace/app.ts'), lateSecret);
  assert(resultLate.level === 'safe', 'Secret beyond 5000 chars not detected');
  console.log('  PASS: 2 assertions');
}

// ============================================================
// Test 7: No content provided returns safe for safe filename
// ============================================================
console.log('Test 7: No content provided');
{
  const result = detector.assess(uri('/workspace/app.ts'));
  assert(result.level === 'safe', 'No content, safe filename is safe');

  const result2 = detector.assess(uri('/workspace/.env'));
  assert(result2.level === 'danger', 'No content, danger filename is still danger');
  console.log('  PASS: 2 assertions');
}

// ============================================================
// Summary
// ============================================================
if (failures > 0) {
  console.error(`\nFAILED: ${failures} test(s)`);
  process.exit(1);
} else {
  console.log('\nPASS: all compiled sensitivity tests (71 assertions)');
}
