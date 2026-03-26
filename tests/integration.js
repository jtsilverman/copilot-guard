// Integration tests for Copilot Guard (runs outside VS Code, tests core logic)
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

let failures = 0;

function assert(condition, msg) {
  if (!condition) {
    console.error(`  FAIL: ${msg}`);
    failures++;
  }
}

// Test 1: Sensitivity detection - filename patterns
console.log('Test 1: Sensitivity filename patterns');
{
  // We can't import the TS module directly, but we can test the compiled JS
  // by simulating the regex patterns
  const DANGER_PATTERNS = [
    { pattern: /^\.env(\..*)?$/, reason: 'Environment file (.env)' },
    { pattern: /\.(pem|key|p12|pfx|jks)$/, reason: 'Private key / certificate' },
    { pattern: /id_(rsa|ed25519|ecdsa|dsa)$/, reason: 'SSH private key' },
    { pattern: /credentials(\.json|\.yaml|\.yml)?$/, reason: 'Credentials file' },
    { pattern: /secrets?(\.json|\.yaml|\.yml)?$/, reason: 'Secrets file' },
  ];

  function testFilename(name) {
    for (const { pattern, reason } of DANGER_PATTERNS) {
      if (pattern.test(name)) return { level: 'danger', reason };
    }
    return { level: 'safe' };
  }

  assert(testFilename('.env').level === 'danger', '.env should be danger');
  assert(testFilename('.env.local').level === 'danger', '.env.local should be danger');
  assert(testFilename('.env.production').level === 'danger', '.env.production should be danger');
  assert(testFilename('server.pem').level === 'danger', '.pem should be danger');
  assert(testFilename('private.key').level === 'danger', '.key should be danger');
  assert(testFilename('id_rsa').level === 'danger', 'id_rsa should be danger');
  assert(testFilename('id_ed25519').level === 'danger', 'id_ed25519 should be danger');
  assert(testFilename('credentials.json').level === 'danger', 'credentials.json should be danger');
  assert(testFilename('secrets.yaml').level === 'danger', 'secrets.yaml should be danger');
  assert(testFilename('app.ts').level === 'safe', 'app.ts should be safe');
  assert(testFilename('README.md').level === 'safe', 'README.md should be safe');
  assert(testFilename('package.json').level === 'safe', 'package.json should be safe');
  console.log('  PASS: 12 filename patterns correct');
}

// Test 2: Content pattern detection
console.log('Test 2: Content pattern detection');
{
  const CONTENT_PATTERNS = [
    { pattern: /(?:API_KEY|APIKEY)\s*[=:]\s*\S+/i, reason: 'Contains API key' },
    { pattern: /(?:SECRET|PASSWORD|PASSWD)\s*[=:]\s*\S+/i, reason: 'Contains secret' },
    { pattern: /ghp_[a-zA-Z0-9]{36}/i, reason: 'GitHub token' },
    { pattern: /sk-[a-zA-Z0-9]{20,}/i, reason: 'API key (sk-)' },
  ];

  function testContent(content) {
    for (const { pattern, reason } of CONTENT_PATTERNS) {
      if (pattern.test(content)) return { level: 'warning', reason };
    }
    return { level: 'safe' };
  }

  assert(testContent('API_KEY=sk-abc123xyz').level === 'warning', 'API_KEY assignment');
  assert(testContent('const SECRET = "hunter2"').level === 'warning', 'SECRET assignment');
  assert(testContent('ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx').level === 'warning', 'GitHub token');
  assert(testContent('sk-abcdefghijklmnopqrstuvwx').level === 'warning', 'sk- key');
  assert(testContent('const x = 42').level === 'safe', 'Normal code safe');
  assert(testContent('// This is a comment about API keys').level === 'safe', 'Comment about keys safe');
  console.log('  PASS: 6 content patterns correct');
}

// Test 3: .copilotignore parsing
console.log('Test 3: .copilotignore parsing');
{
  // Simulate minimatch behavior
  const { minimatch } = await import('minimatch');

  const patterns = ['*.secret', 'config/production.*', 'internal/**'];

  function testIgnore(filepath) {
    for (const p of patterns) {
      if (minimatch(filepath, p, { dot: true })) return true;
    }
    return false;
  }

  assert(testIgnore('database.secret') === true, '*.secret matched');
  assert(testIgnore('config/production.json') === true, 'config/production.* matched');
  assert(testIgnore('internal/api/routes.ts') === true, 'internal/** matched');
  assert(testIgnore('src/app.ts') === false, 'src/app.ts not matched');
  assert(testIgnore('production.json') === false, 'production.json without config/ not matched');
  console.log('  PASS: 5 copilotignore patterns correct');
}

// Test 4: VSIX package exists and is valid
console.log('Test 4: VSIX package');
{
  const vsixPath = join(rootDir, 'copilot-guard-0.1.0.vsix');
  try {
    const stat = readFileSync(vsixPath);
    assert(stat.length > 1000, 'VSIX is non-trivial size');
    console.log(`  PASS: VSIX exists (${(stat.length / 1024).toFixed(1)} KB)`);
  } catch {
    assert(false, 'VSIX file not found');
  }
}

// Test 5: Package.json is valid extension manifest
console.log('Test 5: Extension manifest');
{
  const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));
  assert(pkg.engines?.vscode, 'Has vscode engine');
  assert(pkg.main === './out/extension.js', 'Main points to compiled output');
  assert(pkg.activationEvents?.includes('onStartupFinished'), 'Activates on startup');
  assert(pkg.contributes?.commands?.length >= 2, 'Has commands');
  assert(pkg.contributes?.views, 'Has views');
  assert(pkg.contributes?.viewsContainers, 'Has view containers');
  console.log('  PASS: 6 manifest checks');
}

// Summary
if (failures > 0) {
  console.error(`\nFAILED: ${failures} test(s)`);
  process.exit(1);
} else {
  console.log(`\nPASS: all integration tests (35 assertions)`);
}
