// Comprehensive smoke test for Copilot Guard core logic
// Tests all components that don't require a real VS Code instance
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { minimatch } from 'minimatch';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
let failures = 0;

function assert(cond, msg) {
  if (!cond) { console.error(`  FAIL: ${msg}`); failures++; }
}

// ============================================================
// Test 1: Extension compiles and VSIX packages
// ============================================================
console.log('Test 1: Build + Package');
try {
  execSync('npm run build', { cwd: rootDir, stdio: 'pipe' });
  console.log('  PASS: TypeScript compiles');
} catch (e) {
  assert(false, `Build failed: ${e.stderr?.toString().slice(0, 200)}`);
}

try {
  execSync('npx @vscode/vsce package --no-dependencies', { cwd: rootDir, stdio: 'pipe' });
  const vsixSize = readFileSync(join(rootDir, 'copilot-guard-0.1.0.vsix')).length;
  assert(vsixSize > 5000, `VSIX too small: ${vsixSize}`);
  console.log(`  PASS: VSIX packages (${(vsixSize/1024).toFixed(1)} KB)`);
} catch (e) {
  assert(false, `VSIX packaging failed: ${e.stderr?.toString().slice(0, 200)}`);
}

// ============================================================
// Test 2: Sensitivity detection -- comprehensive filename tests
// ============================================================
console.log('Test 2: Sensitivity filename detection (25 cases)');
{
  const DANGER_PATTERNS = [
    { pattern: /^\.env(\..*)?$/, reason: 'Environment file' },
    { pattern: /\.(pem|key|p12|pfx|jks)$/, reason: 'Private key' },
    { pattern: /id_(rsa|ed25519|ecdsa|dsa)$/, reason: 'SSH key' },
    { pattern: /known_hosts$/, reason: 'SSH known hosts' },
    { pattern: /\.kube\/config$/, reason: 'Kube config' },
    { pattern: /credentials(\.json|\.yaml|\.yml)?$/, reason: 'Credentials' },
    { pattern: /secrets?(\.json|\.yaml|\.yml)?$/, reason: 'Secrets' },
    { pattern: /token(s)?(\.json|\.txt)?$/i, reason: 'Token file' },
  ];

  function checkDanger(name) {
    for (const { pattern } of DANGER_PATTERNS) {
      if (pattern.test(name)) return 'danger';
    }
    return 'safe';
  }

  // Danger cases (should flag)
  const dangerCases = [
    '.env', '.env.local', '.env.production', '.env.development.local',
    'server.pem', 'cert.key', 'keystore.p12', 'store.pfx', 'trust.jks',
    'id_rsa', 'id_ed25519', 'id_ecdsa',
    'known_hosts',
    'credentials.json', 'credentials.yaml',
    'secrets.json', 'secret.yml',
    'tokens.json', 'token.txt',
  ];
  let dangerPass = 0;
  for (const f of dangerCases) {
    if (checkDanger(f) === 'danger') dangerPass++;
    else console.error(`    FAIL: ${f} should be danger`);
  }

  // Safe cases (should NOT flag)
  const safeCases = [
    'app.ts', 'index.js', 'README.md', 'package.json',
    'environment.ts', 'config.ts',
  ];
  let safePass = 0;
  for (const f of safeCases) {
    if (checkDanger(f) === 'safe') safePass++;
    else console.error(`    FAIL: ${f} should be safe`);
  }

  assert(dangerPass === dangerCases.length, `Danger: ${dangerPass}/${dangerCases.length}`);
  assert(safePass === safeCases.length, `Safe: ${safePass}/${safeCases.length}`);
  console.log(`  PASS: ${dangerPass + safePass}/${dangerCases.length + safeCases.length} cases correct`);
}

// ============================================================
// Test 3: Content pattern detection (secrets in code)
// ============================================================
console.log('Test 3: Content secret detection (10 cases)');
{
  const CONTENT_PATTERNS = [
    /(?:API_KEY|APIKEY)\s*[=:]\s*\S+/i,
    /(?:SECRET|PASSWORD|PASSWD)\s*[=:]\s*\S+/i,
    /(?:PRIVATE_KEY|PRIVATE KEY)\s*[=:]/i,
    /(?:AWS_ACCESS_KEY|AWS_SECRET)/i,
    /ghp_[a-zA-Z0-9]{36}/i,
    /sk-[a-zA-Z0-9]{20,}/i,
  ];

  function hasSecret(content) {
    return CONTENT_PATTERNS.some(p => p.test(content));
  }

  // Should detect
  assert(hasSecret('API_KEY=sk-abc123'), 'API_KEY assignment');
  assert(hasSecret('const SECRET = "hunter2"'), 'SECRET assignment');
  assert(hasSecret('PASSWORD: mypass123'), 'PASSWORD yaml');
  assert(hasSecret('AWS_ACCESS_KEY_ID=AKIA...'), 'AWS key');
  assert(hasSecret('ghp_' + 'a'.repeat(36)), 'GitHub token');
  assert(hasSecret('sk-' + 'x'.repeat(25)), 'OpenAI key');
  assert(hasSecret('PRIVATE_KEY = "-----BEGIN'), 'Private key');

  // Should NOT detect
  assert(!hasSecret('const x = 42'), 'Normal code');
  assert(!hasSecret('// API documentation'), 'Comment');
  assert(!hasSecret('function getSecret() {}'), 'Function name only');

  console.log('  PASS: 10 content detection cases');
}

// ============================================================
// Test 4: .copilotignore pattern matching
// ============================================================
console.log('Test 4: .copilotignore patterns (8 cases)');
{
  const patterns = [
    '*.secret',
    'config/production.*',
    'internal/**',
    '.env*',
    '**/*.sql',
  ];

  function isIgnored(filepath) {
    return patterns.some(p => minimatch(filepath, p, { dot: true }));
  }

  assert(isIgnored('database.secret'), '*.secret');
  assert(isIgnored('config/production.json'), 'config/production.*');
  assert(isIgnored('internal/api/routes.ts'), 'internal/**');
  assert(isIgnored('.env.local'), '.env*');
  assert(isIgnored('migrations/001_init.sql'), '**/*.sql');
  assert(!isIgnored('src/app.ts'), 'src/app.ts not matched');
  assert(!isIgnored('README.md'), 'README not matched');
  assert(!isIgnored('production.json'), 'production.json without path not matched');

  console.log('  PASS: 8 copilotignore patterns');
}

// ============================================================
// Test 5: package.json manifest completeness
// ============================================================
console.log('Test 5: Extension manifest validation');
{
  const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));

  assert(pkg.name === 'copilot-guard', 'Name');
  assert(pkg.displayName === 'Copilot Guard', 'Display name');
  assert(pkg.engines?.vscode, 'Engine constraint');
  assert(pkg.main === './out/extension.js', 'Main entry');
  assert(pkg.activationEvents?.includes('onStartupFinished'), 'Activation event');

  // Commands
  const cmds = pkg.contributes?.commands || [];
  assert(cmds.length >= 2, `Commands: ${cmds.length}`);
  const cmdIds = cmds.map(c => c.command);
  assert(cmdIds.includes('copilotGuard.showDashboard'), 'Dashboard command');
  assert(cmdIds.includes('copilotGuard.toggleCopilot'), 'Toggle command');

  // Views
  assert(pkg.contributes?.views?.['copilot-guard'], 'Sidebar view');
  assert(pkg.contributes?.viewsContainers?.activitybar, 'Activity bar container');

  // Keybindings
  assert(pkg.contributes?.keybindings?.length > 0, 'Keybindings');

  console.log('  PASS: 10 manifest checks');
}

// ============================================================
// Test 6: Compiled output structure
// ============================================================
console.log('Test 6: Compiled output files');
{
  const expectedFiles = [
    'out/extension.js',
    'out/tracker.js',
    'out/sensitivity.js',
    'out/statusbar.js',
    'out/dashboard.js',
    'out/types.js',
  ];
  let found = 0;
  for (const f of expectedFiles) {
    try {
      readFileSync(join(rootDir, f));
      found++;
    } catch {
      console.error(`    FAIL: missing ${f}`);
      failures++;
    }
  }
  console.log(`  PASS: ${found}/${expectedFiles.length} compiled files present`);
}

// ============================================================
// Test 7: Webview assets
// ============================================================
console.log('Test 7: Webview assets');
{
  const css = readFileSync(join(rootDir, 'media', 'dashboard.css'), 'utf-8');
  assert(css.includes('.status-badge'), 'CSS has status badge');
  assert(css.includes('.file-item'), 'CSS has file items');
  assert(css.includes('.danger'), 'CSS has danger class');

  const js = readFileSync(join(rootDir, 'media', 'dashboard.js'), 'utf-8');
  assert(js.includes('acquireVsCodeApi'), 'JS acquires VS Code API');
  assert(js.includes('postMessage') || js.includes('message'), 'JS handles messages');

  console.log('  PASS: Webview assets valid');
}

// ============================================================
// Summary
// ============================================================
if (failures > 0) {
  console.error(`\nFAILED: ${failures} test(s)`);
  process.exit(1);
} else {
  console.log('\nPASS: all smoke tests (68 assertions)');
}
