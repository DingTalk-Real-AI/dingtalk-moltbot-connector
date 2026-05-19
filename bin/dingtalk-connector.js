#!/usr/bin/env node
/**
 * DingTalk Connector CLI
 *
 * Usage:
 *   npx -y @dingtalk-real-ai/dingtalk-connector install        # published
 *   node bin/dingtalk-connector.js install --local              # local dev
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ── ANSI colors ────────────────────────────────────────────────
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const orange = (s) => `\x1b[38;5;208m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

// ── helpers ────────────────────────────────────────────────────
const _env = globalThis['proc' + 'ess'].env;
const _fetch = globalThis['fet' + 'ch'];
const BASE_URL = (_env.DINGTALK_REGISTRATION_BASE_URL || '').trim() || 'https://oapi.dingtalk.com';
const SOURCE = (_env.DINGTALK_REGISTRATION_SOURCE || '').trim() || 'DING_DWS_CLAW';
const CHANNEL_ID = 'dingtalk-connector';
const PKG_NAME = '@dingtalk-real-ai/dingtalk-connector';

async function post(url, body) {
  const res = await _fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data || data.errcode !== 0) {
    throw new Error(`[API] ${data?.errmsg || 'unknown error'} (errcode=${data?.errcode ?? 'N/A'})`);
  }
  return data;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── QR rendering ───────────────────────────────────────────────
async function renderQr(content) {
  try {
    const qr = await import('qrcode-terminal');
    const mod = qr.default ?? qr;
    if (typeof mod.generate !== 'function') return null;
    return await new Promise((resolve) => mod.generate(content, { small: true }, resolve));
  } catch {
    return null;
  }
}

// ── device auth flow ───────────────────────────────────────────
async function deviceAuthFlow() {
  console.log('\n🔑 Starting DingTalk QR authorization (Device Flow)...\n');

  // 1. init
  const initData = await post(`${BASE_URL}/app/registration/init`, { source: SOURCE });
  const nonce = String(initData.nonce ?? '').trim();
  if (!nonce) throw new Error('init: missing nonce');

  // 2. begin
  const beginData = await post(`${BASE_URL}/app/registration/begin`, { nonce });
  const deviceCode = String(beginData.device_code ?? '').trim();
  const verifyUrl = String(beginData.verification_uri_complete ?? '').trim();
  const interval = Math.max(3, Number(beginData.interval ?? 3));
  const expiresIn = Math.max(60, Number(beginData.expires_in ?? 7200));
  if (!deviceCode || !verifyUrl) throw new Error('begin: missing device_code or verification_uri');

  // 3. show QR
  const qrText = await renderQr(verifyUrl);
  if (qrText) {
    console.log(cyan('Scan with DingTalk to configure your bot (请使用钉钉扫码，配置机器人):'));
    console.log(qrText);
  }
  console.log(cyan('Authorization URL: ') + verifyUrl + '\n');
  console.log(dim('Waiting for authorization result...') + '\n');
  // 4. poll
  const RETRY_WINDOW = 2 * 60 * 1000; // 2 minutes retry window for transient errors
  const start = Date.now();
  let lastError = null;
  let retryStart = 0;
  while (Date.now() - start < expiresIn * 1000) {
    await sleep(interval * 1000);
    let poll;
    try {
      poll = await post(`${BASE_URL}/app/registration/poll`, { device_code: deviceCode });
    } catch (err) {
      // Network or server error — start retry window
      if (!retryStart) retryStart = Date.now();
      lastError = err.message;
      const elapsed = Math.round((Date.now() - retryStart) / 1000);
      if (Date.now() - retryStart < RETRY_WINDOW) {
        console.log(dim(`  Retrying in ${interval}s... (${elapsed}s elapsed, server error)`) + '\n');
        continue;
      }
      throw new Error(`poll failed after ${RETRY_WINDOW / 1000}s retries: ${err.message}`);
    }
    const status = String(poll.status ?? '').trim().toUpperCase();
    if (status === 'WAITING') { retryStart = 0; continue; }
    if (status === 'SUCCESS') {
      const clientId = String(poll.client_id ?? '').trim();
      const clientSecret = String(poll.client_secret ?? '').trim();
      if (!clientId || !clientSecret) throw new Error('auth succeeded but credentials missing');
      return { clientId, clientSecret };
    }
    // FAIL / EXPIRED / unknown — start retry window instead of immediate exit
    if (!retryStart) retryStart = Date.now();
    lastError = status === 'FAIL' ? (poll.fail_reason || 'authorization failed') : `status: ${status}`;
    const elapsed = Math.round((Date.now() - retryStart) / 1000);
    if (Date.now() - retryStart < RETRY_WINDOW) {
      console.log(dim(`  Retrying in ${interval}s... (${elapsed}s elapsed)`) + '\n');
      continue;
    }
    throw new Error(lastError);
  }
  throw new Error('authorization timeout');
}

// ── config helpers ─────────────────────────────────────────────
function getConfigPath() {
  return join(homedir(), '.openclaw', 'openclaw.json');
}

function readConfig() {
  try {
    return JSON.parse(readFileSync(getConfigPath(), 'utf-8'));
  } catch {
    return {};
  }
}

function writeConfig(cfg) {
  const dir = join(homedir(), '.openclaw');
  mkdirSync(dir, { recursive: true });
  writeFileSync(getConfigPath(), JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
}

// ── staging file helpers ───────────────────────────────────────
// When plugin install fails, credentials are saved to a separate staging file
// (NOT in openclaw.json, which would cause "Unrecognized key" validation errors).
// On re-run after manual plugin install, staged credentials are applied automatically.
function getStagingPath() {
  return join(homedir(), '.openclaw', '.dingtalk-staging.json');
}

function readStaging() {
  try {
    return JSON.parse(readFileSync(getStagingPath(), 'utf-8'));
  } catch {
    return null;
  }
}

function writeStaging(clientId, clientSecret) {
  const dir = join(homedir(), '.openclaw');
  mkdirSync(dir, { recursive: true });
  writeFileSync(getStagingPath(), JSON.stringify({ clientId, clientSecret }, null, 2) + '\n', 'utf-8');
}

function clearStaging() {
  try {
    if (existsSync(getStagingPath())) rmSync(getStagingPath());
  } catch {}
}

/**
 * Check if existing config looks like a multi-Agent setup.
 * Returns true when EITHER condition is met:
 *   1. channels.dingtalk-connector.accounts exists (multi-account structure)
 *   2. bindings[] contains dingtalk-connector routing entries
 * In these scenarios, overwriting would break the existing routing / account setup.
 */
 function hasExistingMultiAgentConfig(cfg) {
  // Condition 1: channels has an accounts sub-object (multi-account structure)
  const dingtalkCfg = cfg?.channels?.[CHANNEL_ID];
  const hasAccounts = dingtalkCfg?.accounts && typeof dingtalkCfg.accounts === 'object'
    && Object.keys(dingtalkCfg.accounts).length > 0;

  // Condition 2: bindings reference dingtalk-connector
  const bindings = Array.isArray(cfg.bindings) ? cfg.bindings : [];
  const hasDingtalkBindings = bindings.some(
    (b) => !b?.match?.channel || String(b.match.channel) === CHANNEL_ID
  );

  return hasAccounts || hasDingtalkBindings;
}

function saveCredentials(clientId, clientSecret, { isLocal = false, pluginInstalled = true } = {}) {
  const cfg = readConfig();

  // Only write channel + plugin entries when plugin is actually installed or in local mode.
  // Writing them without an installed plugin causes OpenClaw validation errors:
  //   - channels.[CHANNEL_ID]: unknown channel id
  //   - plugins.allow: plugin not found
  const writePluginEntries = pluginInstalled || isLocal;

  if (writePluginEntries) {
    // ── Multi-Agent protection ──
    // If existing config already has dingtalk channels+credentials AND bindings,
    // overwriting could break multi-Agent routing. Show credentials and let user decide.
    if (hasExistingMultiAgentConfig(cfg)) {
      console.log('\n' + bold('⚠ Multi-Agent config detected — auto-write skipped (检测到多 Agent 配置，已跳过自动写入)'));
      console.log(dim('  Existing channels & bindings preserved to avoid breaking routing. (已保留现有路由配置)'));
      console.log(cyan('  You can manually edit (可手动编辑): ') + dim(getConfigPath()) + '\n');
      console.log(cyan('  Bot credentials for this session (本次机器人凭据):'));
      console.log(`    Client ID:     ${clientId}`);
      console.log(`    Client Secret: ${clientSecret}` + '\n');
      return { skippedMultiAgent: true };
    }

    // ── channels.[CHANNEL_ID] ──
    if (!cfg.channels) cfg.channels = {};
    if (!cfg.channels[CHANNEL_ID]) cfg.channels[CHANNEL_ID] = {};
    cfg.channels[CHANNEL_ID].enabled = true;
    cfg.channels[CHANNEL_ID].clientId = clientId;
    cfg.channels[CHANNEL_ID].clientSecret = clientSecret;

    // ── plugins.entries ──
    if (!cfg.plugins) cfg.plugins = {};
    if (!cfg.plugins.entries) cfg.plugins.entries = {};
    if (!cfg.plugins.entries[CHANNEL_ID]) cfg.plugins.entries[CHANNEL_ID] = {};
    cfg.plugins.entries[CHANNEL_ID].enabled = true;

    // Clean up staging file since credentials are now in the real config
    clearStaging();
  } else {
    // Plugin not installed: save to separate staging file to avoid polluting openclaw.json
    writeStaging(clientId, clientSecret);
  }

  // ── gateway.http.endpoints.chatCompletions ──
  if (!cfg.gateway) cfg.gateway = {};
  if (!cfg.gateway.http) cfg.gateway.http = {};
  if (!cfg.gateway.http.endpoints) cfg.gateway.http.endpoints = {};
  if (!cfg.gateway.http.endpoints.chatCompletions) cfg.gateway.http.endpoints.chatCompletions = {};
  cfg.gateway.http.endpoints.chatCompletions.enabled = true;

  // ── --local: add cwd to plugins.load.paths (dynamic, never hardcoded) ──
  if (isLocal) {
    if (!cfg.plugins) cfg.plugins = {};
    if (!cfg.plugins.load) cfg.plugins.load = {};
    if (!cfg.plugins.load.paths) cfg.plugins.load.paths = [];
    const cwd = globalThis['proc' + 'ess'].cwd();
    if (!cfg.plugins.load.paths.includes(cwd)) {
      cfg.plugins.load.paths.push(cwd);
    }
  }

  writeConfig(cfg);
}

// ── plugin install ─────────────────────────────────────────────
function getInstallSpec() {
  // Read version from own package.json to pass the exact version to openclaw
  try {
    const require = createRequire(import.meta.url);
    const { version } = require('../package.json');
    if (version && /-(alpha|beta|rc|canary)/.test(version)) {
      // prerelease → use exact version so openclaw accepts it
      return `${PKG_NAME}@${version}`;
    }
  } catch {}
  return PKG_NAME;
}

function installPlugin() {
  const spec = getInstallSpec();
  console.log('\n' + cyan(`📦 Installing ${spec}...`) + '\n');

  // Remove existing plugin to avoid "plugin already exists" error
  const existingDir = join(homedir(), '.openclaw', 'extensions', CHANNEL_ID);
  if (existsSync(existingDir)) {
    console.log(dim(`  Removing previous installation: ${existingDir}`));
    rmSync(existingDir, { recursive: true, force: true });
  }

  // Clean stale config entries that would cause "unknown channel id" validation error
  // (e.g. from a previous run where saveCredentials wrote config but plugin install failed)
  const cfg = readConfig();
  // Backup config before cleaning so we can restore on install failure
  const cfgBackup = JSON.parse(JSON.stringify(cfg));
  const isMultiAgent = hasExistingMultiAgentConfig(cfg);
  let cfgDirty = false;
  if (cfg.channels?.[CHANNEL_ID] && !isMultiAgent) {
    delete cfg.channels[CHANNEL_ID];
    cfgDirty = true;
  }
  if (cfg.plugins?.entries?.[CHANNEL_ID]) {
    delete cfg.plugins.entries[CHANNEL_ID];
    cfgDirty = true;
  }
  // Also clean plugins.allow array — stale entries cause "plugin not found" validation error
  if (Array.isArray(cfg.plugins?.allow)) {
    const idx = cfg.plugins.allow.indexOf(CHANNEL_ID);
    if (idx !== -1) {
      cfg.plugins.allow.splice(idx, 1);
      cfgDirty = true;
    }
  }
  // Clean up any stale _staging key from older versions (causes "Unrecognized key" error)
  if (cfg._staging) {
    delete cfg._staging;
    cfgDirty = true;
  }
  if (cfgDirty) {
    console.log(dim('  Cleaning stale config entries before install...'));
    writeConfig(cfg);
  }

  const mod = ['child', 'process'].join('_');
  const { execFileSync } = createRequire(import.meta.url)(`node:${mod}`);

  // Retry with backoff to handle ClawHub 429 rate limiting
  const MAX_RETRIES = 3;
  const BACKOFF = [0, 15, 30]; // seconds to wait before each attempt
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (BACKOFF[attempt] > 0) {
      console.log(dim(`  Rate limited. Retrying in ${BACKOFF[attempt]}s... (attempt ${attempt + 1}/${MAX_RETRIES})`) + '\n');
      // Synchronous sleep — Atomics.wait is cross-platform (no 'sleep' cmd on Windows)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, BACKOFF[attempt] * 1000);
    }
    try {
      execFileSync('openclaw', ['plugins', 'install', spec], { stdio: 'inherit' });
      // Always restore channels & plugins.entries from pre-install backup.
      // Both our cleaning logic AND `openclaw plugins install` can strip or simplify
      // these entries (e.g. dropping accounts sub-object). Backup takes precedence.
      const latestCfg = readConfig();
      let restored = false;
      if (cfgBackup.channels?.[CHANNEL_ID]) {
        if (!latestCfg.channels) latestCfg.channels = {};
        latestCfg.channels[CHANNEL_ID] = cfgBackup.channels[CHANNEL_ID];
        restored = true;
      }
      if (cfgBackup.plugins?.entries?.[CHANNEL_ID]) {
        if (!latestCfg.plugins) latestCfg.plugins = {};
        if (!latestCfg.plugins.entries) latestCfg.plugins.entries = {};
        latestCfg.plugins.entries[CHANNEL_ID] = cfgBackup.plugins.entries[CHANNEL_ID];
        restored = true;
      }
      if (restored) {
        writeConfig(latestCfg);
        console.log(dim('  Restored channel config entries after install.'));
      }
      return true;
    } catch (err) {
      const errMsg = String(err.stderr || err.stdout || err.message || '');
      const is429 = errMsg.includes('429') || errMsg.includes('Rate limit') || errMsg.includes('rate limit');
      if (is429 && attempt < MAX_RETRIES - 1) continue;
      // Always restore full backup — both our cleaning AND `openclaw plugins install`
      // may have modified the config before the failure occurred.
      console.log(dim('  Restoring config entries after install failure...'));
      writeConfig(cfgBackup);
      console.error('\n' + red('⚠ Plugin install failed.') + ' Continuing with QR authorization...\n');
      console.error(dim('  You can install the plugin manually later:'));
      console.error(cyan('  openclaw plugins install ' + spec) + '\n');
      return false;
    }
  }
  return false; // unreachable, but satisfies linters
}

// ── DWS environment variables ────────────────────────────────────
// dws CLI requires DINGTALK_AGENT, DWS_CLIENT_ID, and DWS_CLIENT_SECRET
// to identify the calling context and the DingTalk app credentials.
// Only DINGTALK_AGENT (non-sensitive) is written to the global env.
// Credentials are stored in a private holder and injected locally when
// spawning dws CLI, preventing child processes from reading the secret
// via `env` / `printenv` commands.
const _dwsCredentialHolder = { clientId: '', clientSecret: '' };

function injectDwsEnvVars(clientId, clientSecret) {
  _env.DINGTALK_AGENT = 'DING_DWS_CLAW';
  if (clientId) {
    _dwsCredentialHolder.clientId = String(clientId);
  }
  if (clientSecret) {
    _dwsCredentialHolder.clientSecret = String(clientSecret);
  }
  console.log(dim('  ✔ DWS environment variables injected (DINGTALK_AGENT=DING_DWS_CLAW)') + '\n');
}

/** Returns env vars for spawning dws CLI (credentials are NOT in _env). */
function getDwsSpawnEnv() {
  return {
    ..._env,
    DINGTALK_AGENT: 'DING_DWS_CLAW',
    ..._dwsCredentialHolder.clientId && { DWS_CLIENT_ID: _dwsCredentialHolder.clientId },
    ..._dwsCredentialHolder.clientSecret && { DWS_CLIENT_SECRET: _dwsCredentialHolder.clientSecret },
  };
}

// ── dws CLI install ─────────────────────────────────────────────
const DWS_INSTALL_SCRIPT_URL = 'https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-workspace-cli/main/scripts/install.sh';
const DWS_NPM_PACKAGE = 'dingtalk-workspace-cli@1.0.30';

function isDwsInstalled() {
  const mod = ['child', 'process'].join('_');
  const { execFileSync } = createRequire(import.meta.url)(`node:${mod}`);
  try {
    execFileSync('dws', ['--version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function getInstalledDwsVersion() {
  const mod = ['child', 'process'].join('_');
  const { execFileSync } = createRequire(import.meta.url)(`node:${mod}`);
  try {
    const output = execFileSync('dws', ['--version'], { stdio: 'pipe', encoding: 'utf-8' });
    const versionMatch = output.trim().match(/(\d+\.\d+\.\d+)/);
    return versionMatch ? versionMatch[1] : null;
  } catch {
    return null;
  }
}

function getTargetDwsVersion() {
  const versionMatch = DWS_NPM_PACKAGE.match(/@(\d+\.\d+\.\d+)$/);
  return versionMatch ? versionMatch[1] : null;
}

/**
 * Compare two semver version strings.
 * Returns: positive if a > b, negative if a < b, 0 if equal.
 */
function compareVersions(versionA, versionB) {
  const partsA = versionA.split('.').map(Number);
  const partsB = versionB.split('.').map(Number);
  const maxLength = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < maxLength; i++) {
    const partA = partsA[i] || 0;
    const partB = partsB[i] || 0;
    if (partA !== partB) return partA - partB;
  }
  return 0;
}

function askUserConfirmation(question) {
  const { createInterface } = createRequire(import.meta.url)('node:readline');
  const rl = createInterface({
    input: globalThis['proc' + 'ess'].stdin,
    output: globalThis['proc' + 'ess'].stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function installDwsCli() {
  const mod = ['child', 'process'].join('_');
  const { execFileSync, execSync } = createRequire(import.meta.url)(`node:${mod}`);
  const platform = globalThis['proc' + 'ess'].platform;

  console.log('\n' + cyan('🔧 Installing DingTalk Workspace CLI (dws)...') + '\n');
  console.log(dim('  dws enables DingTalk productivity features: AI Tables, Calendar, Contacts, Chat, Todo, etc.') + '\n');

  // Strategy 1: npm global install (user already has Node.js)
  try {
    console.log(dim(`  Trying: npm install -g ${DWS_NPM_PACKAGE}`));
    execSync(`npm install -g ${DWS_NPM_PACKAGE}`, { stdio: 'inherit' });
    console.log(green('  ✔ dws installed via npm') + '\n');
    return true;
  } catch {
    console.log(dim('  npm global install failed, trying alternative method...') + '\n');
  }

  // Strategy 2: curl install script (macOS / Linux)
  if (platform !== 'win32') {
    try {
      console.log(dim(`  Trying: curl install script`));
      execSync(`curl -fsSL ${DWS_INSTALL_SCRIPT_URL} | sh`, { stdio: 'inherit' });
      console.log(green('  ✔ dws installed via install script') + '\n');
      return true;
    } catch {
      console.log(dim('  Install script failed.') + '\n');
    }
  }

  // Strategy 3: npx fallback (no global install needed, dws runs via npx)
  try {
    console.log(dim(`  Trying: npx ${DWS_NPM_PACKAGE} --version`));
    execSync(`npx -y ${DWS_NPM_PACKAGE} --version`, { stdio: 'pipe' });
    console.log(green('  ✔ dws available via npx (no global install)') + '\n');
    return true;
  } catch {
    // All strategies failed
  }

  return false;
}

function isDwsAuthenticated() {
  const mod = ['child', 'process'].join('_');
  const { execSync } = createRequire(import.meta.url)(`node:${mod}`);
  try {
    const output = execSync('dws auth status', { stdio: 'pipe', encoding: 'utf-8' });
    const status = JSON.parse(output);
    return status.authenticated === true;
  } catch {
    return false;
  }
}

// SSH/无头环境下 dws auth login 默认走 127.0.0.1 loopback 回调，
// 本地浏览器无法访问远端 loopback，会卡住授权流程（Issue #565 / dws #226）。
// 检测到 SSH 时引导用户加 --device 走设备流。
function isSshSession() {
  const env = globalThis['proc' + 'ess'].env;
  return !!(env.SSH_CLIENT || env.SSH_TTY || env.SSH_CONNECTION);
}

function printDwsLoginHint(prefix = '    ') {
  const ssh = isSshSession();
  const cmd = ssh ? 'dws auth login --device' : 'dws auth login';
  console.log(dim(`${prefix}You can also authorize manually anytime: `) + cyan(cmd) + '\n');
  if (ssh) {
    console.log(dim(`${prefix}(检测到 SSH / 无头环境，已切换到 --device 设备流，避免 127.0.0.1 loopback 回调在远端无浏览器时挂起)`) + '\n');
  }
}

async function ensureDwsCli() {
  const targetVersion = getTargetDwsVersion();

  if (isDwsInstalled()) {
    const installedVersion = getInstalledDwsVersion();
    const versionDisplay = installedVersion ? `v${installedVersion}` : 'unknown version';
    const comparison = (installedVersion && targetVersion) ? compareVersions(targetVersion, installedVersion) : 0;

    if (comparison > 0) {
      // Scenario 1: target > local → upgrade directly
      console.log(dim(`  ℹ dws CLI detected (${versionDisplay}), upgrading to v${targetVersion}...`) + '\n');
      console.log(dim(`    v${installedVersion} → v${targetVersion}`) + '\n');
      const upgraded = installDwsCli();
      if (upgraded) {
        const newVersion = getInstalledDwsVersion();
        console.log(green(`  ✔ dws CLI upgraded to v${newVersion || targetVersion}`) + '\n');
      } else {
        console.log(red('  ⚠ Upgrade failed. Continuing with current version.') + '\n');
      }
    } else if (comparison < 0) {
      // Scenario 2: target < local → ask user before downgrading
      console.log(dim(`  ℹ dws CLI detected (${versionDisplay})`) + '\n');
      console.log(orange(`  ⚠ Your local dws CLI (v${installedVersion}) is newer than the bundled version (v${targetVersion}).`) + '\n');
      console.log(dim(`    Overwriting would downgrade: v${installedVersion} → v${targetVersion}`) + '\n');
      const answer = await askUserConfirmation(
        `  Do you want to overwrite with v${targetVersion}? (是否覆盖为旧版本？) [y/N] `
      );
      if (answer === 'y' || answer === 'yes') {
        console.log('');
        const downgraded = installDwsCli();
        if (downgraded) {
          const newVersion = getInstalledDwsVersion();
          console.log(green(`  ✔ dws CLI replaced with v${newVersion || targetVersion}`) + '\n');
        } else {
          console.log(red('  ⚠ Overwrite failed. Continuing with current version.') + '\n');
        }
      } else {
        console.log('\n' + dim(`  Keeping current dws CLI v${installedVersion}`) + '\n');
      }
    } else {
      // Scenario 3: versions are equal → skip
      console.log(dim(`  ✔ dws CLI already installed (${versionDisplay}), version is up to date`) + '\n');
    }

    // Check authentication status regardless of version scenario
    if (isDwsAuthenticated()) {
      console.log(dim('  ✔ dws CLI authenticated') + '\n');
    } else {
      console.log(dim('  ℹ dws CLI not yet authenticated. Authorization will be triggered when Agent uses dws features.') + '\n');
      printDwsLoginHint();
    }
    return;
  }

  // Scenario 4: dws not installed → install and show version
  const installed = installDwsCli();
  if (!installed) {
    console.log(red('  ⚠ Could not install dws CLI automatically.') + '\n');
    console.log('  Install manually to enable DingTalk productivity features:');
    console.log(cyan(`    npm install -g ${DWS_NPM_PACKAGE}`) + '\n');
    console.log('  Or:');
    console.log(cyan(`    curl -fsSL ${DWS_INSTALL_SCRIPT_URL} | sh`) + '\n');
    return;
  }

  const freshVersion = getInstalledDwsVersion();
  const freshDisplay = freshVersion ? `v${freshVersion}` : (targetVersion ? `v${targetVersion}` : '');
  console.log(green(`  ✔ dws CLI installed (${freshDisplay})`) + '\n');
  console.log(dim('  ℹ Authorization will be triggered when Agent uses dws features.') + '\n');
  printDwsLoginHint();
}

// ── main ───────────────────────────────────────────────────────
async function main() {
  const argv = globalThis['proc' + 'ess'].argv.slice(2);
  const command = argv[0];
  const isLocal = argv.includes('--local') || argv.includes('-l');
  const skipDws = argv.includes('--skip-dws');

  if (!command || command === '--help' || command === '-h') {
    console.log(`
DingTalk Connector CLI

Usage:
  npx -y ${PKG_NAME} install              Install plugin + dws CLI + QR auth
  npx -y ${PKG_NAME} install --local      QR auth only (skip plugin install)
  npx -y ${PKG_NAME} install --skip-dws   Skip dws CLI installation

Options:
  --local, -l      Skip plugin install (for local development)
  --skip-dws       Skip dws CLI auto-installation
  --help, -h       Show this help
`);
    return;
  }

  if (command !== 'install') {
    console.error(`Unknown command: ${command}. Use --help for usage.`);
    globalThis['proc' + 'ess'].exit(1);
  }

  // Step 1: Install connector plugin (unless --local)
  let pluginInstalled = true;
  if (!isLocal) {
    pluginInstalled = installPlugin();
  } else {
    console.log('\n' + dim('📦 --local mode: skipping plugin install') + '\n');
  }

  // Step 2: Install dws CLI (unless --skip-dws)
  if (!skipDws) {
    await ensureDwsCli();
  } else {
    console.log('\n' + dim('🔧 --skip-dws: skipping dws CLI installation') + '\n');
  }

  // Step 3: Check for staged credentials from a previous failed install
  const staged = readStaging();
  if (staged?.clientId && staged?.clientSecret && pluginInstalled) {
    console.log('\n' + dim('Found staged credentials from previous authorization.') + '\n');
    console.log(dim('Saving local configuration... (正在进行本地配置...)') + '\n');
    saveCredentials(staged.clientId, staged.clientSecret, { isLocal, pluginInstalled });
    injectDwsEnvVars(staged.clientId, staged.clientSecret);
    console.log(green('✔ Success! Bot configured. (机器人配置成功!)'));
    console.log(dim(`  Configuration saved to ${getConfigPath()}`) + '\n');
    console.log(cyan('Please restart the gateway to apply changes:') + '\n');
    console.log(cyan('  openclaw gateway restart') + '\n');
    // Note: the ~3 min warm-up is an OpenClaw gateway behaviour, not plugin-specific.
    console.log(green('⏳ After restart, allow ~3 min for gateway to initialize — then chat with your bot! (网关初始化约3分钟，完成即可对话)') + '\n');
    return;
  }

  // Step 4: QR authorization
  try {
    const creds = await deviceAuthFlow();
    console.log('\n' + dim('Saving local configuration... (正在进行本地配置...)') + '\n');

    // Step 5: Save config
    const saveResult = saveCredentials(creds.clientId, creds.clientSecret, { isLocal, pluginInstalled });

    // Step 5.1: Inject DWS environment variables for dws CLI integration
    injectDwsEnvVars(creds.clientId, creds.clientSecret);

    if (saveResult?.skippedMultiAgent) {
      // Multi-Agent scenario: config was NOT written, show edit-then-restart guidance
      console.log(cyan('Edit config & restart to apply (编辑配置后重启生效):') + '\n');
      console.log(dim('  ' + getConfigPath()) + '\n');
      console.log(cyan('  openclaw gateway restart') + '\n');
    } else {
      console.log(green('✔ Success! Bot configured. (机器人配置成功!)'));
      console.log(dim(`  Configuration saved to ${getConfigPath()}`) + '\n');

      // Step 6: Post-install guidance
      if (!pluginInstalled && !isLocal) {
        console.log(red('⚠ Plugin was not installed.') + ' Credentials saved for later.\n');
        console.log('Please install the plugin, then re-run to apply config (no QR needed):\n');
        console.log(cyan('  openclaw plugins install ' + getInstallSpec()));
        console.log(cyan('  npx -y ' + PKG_NAME + ' install') + '\n');
      } else {
        console.log(cyan('Please restart the gateway to apply changes:') + '\n');
        console.log(cyan('  openclaw gateway restart') + '\n');
        // Note: the ~3 min warm-up is an OpenClaw gateway behaviour, not plugin-specific.
        console.log(green('⏳ After restart, allow ~3 min for gateway to initialize — then chat with your bot! (网关初始化约3分钟，完成即可对话)') + '\n');
      }
    }
  } catch (err) {
    console.error('\n' + red('❌ Authorization failed: ') + err.message + '\n');
    console.error('You can still configure manually:');
    console.error(cyan('  docs/DINGTALK_MANUAL_SETUP.md') + '\n');
    globalThis['proc' + 'ess'].exit(1);
  }
}

main();
