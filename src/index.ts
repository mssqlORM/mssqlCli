#!/usr/bin/env node
import { execFileSync, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { generateCommitMessage, generateChangelogContent, getGitDiff, getGitLog, generateCodeReview } from './llm';
import { analyzeImpact, analyzeDocUpdates, buildSyncPlan, executeSync } from './impact';

function loadTasksModule() {
  try {
    return require('../../mssqlTasks/dist/index');
  } catch {
    return null;
  }
}

interface TunnelConfig {
  subdomain?: string;
  port?: number;
}

interface Config {
  defaultTarget?: string;
  defaultBranch?: string;
  dryRun?: boolean;
  push?: boolean;
  skipPrompt?: boolean;
  tunnel?: TunnelConfig;
}

interface ChangeGroup {
  component: string;
  files: string[];
}

type Command = 'release' | 'ws' | 'run' | 'login' | 'help' | 'ui' | 'config' | 'doc' | 'format' | 'impact' | 'doc:diff' | 'sync' | 'tasks' | 'tunnel';

interface Options {
  command: Command;
  targetDir: string;
  dryRun: boolean;
  push: boolean;
  pull: boolean;
  tag?: string;
  message?: string;
  branch?: string;
  all?: boolean;
  skipLlm?: boolean;
  skipPrompt?: boolean;
  noVerify?: boolean;
  skipDocs?: boolean;
  skipBuild?: boolean;
  taskAction?: string;
  taskId?: string;
  taskStatus?: string;
  taskPriority?: string;
  tunnelAction?: string;
  tunnelPort?: number;
  tunnelSubdomain?: string;
}

function git(args: string[], allowFail = false): string {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch (error: any) {
    if (allowFail) return error.stdout?.toString()?.trim() || '';
    throw error;
  }
}

function printHelp() {
  console.log(`mssql-cli — Release & Workspace Automation

Commands:
  ui                         Launch the premium Web UI Dashboard for workspace management
  tunnel [action]            Manage localtunnel (start, stop, status; default: start)
  config                     Interactive setup for LLM provider and credentials (.env)
  doc [path]                 Generate or improve documentation for code files or README using LLM
  doc:diff [path]            Auto-update docs based on changed files (diff-aware)
  format [path]              Auto-format .mssql files using alignment rules
  impact [path]              Analyze cross-repo impact from changes in a repo
  sync [path]                Update affected repos: rebuild, test, update docs
  tasks [action] [path]      Manage tasks (list, update, delete)
  release [path] [options]   Generate changelog, commit, push for a single repo
  ws [path] [options]        Run release across all repos in a workspace (submodules)
  run <script>               Run a script from workspace.json
  login [username] [token]   Store GitHub credentials and update all remote URLs
  --help, -h                 Show this help

Options:
  --dry-run                  Generate changelog without committing
  --push                     Push commits after creating them
  --pull                     Pull latest before processing
  --tag <name>               Create and push a git tag
  --message <text>           Override LLM-generated commit message
  --branch <name>            Specify branch (default: main or master detection)
  --all                      Include unchanged repos (status check only)
  --skip-llm                 Skip LLM commit message generation, use default
  --skip-prompt              Skip interactive confirmations (non-interactive mode)
  --no-verify                Bypass code quality checks (build, test)
  --skip-docs                Skip documentation updates (sync command)
  --skip-build               Skip build/test steps (sync command)
  --tunnel                   Expose UI dashboard via localtunnel (for mobile access)
  --subdomain <name>         Custom subdomain for tunnel (e.g., my-mssql)
  --tunnel-port <port>       Port for tunnel (default: 5070)
  --status <status>          Filter tasks by status (todo, in-progress, done)
  --priority <priority>      Filter tasks by priority (low, medium, high)
  --id <taskId>              Task ID for update/delete operations

Environment Variables (for LLM commit messages):
  LLM_PROVIDER               openai (default), gemini, or custom
  LLM_API_KEY                API key for the LLM provider
  OPENAI_API_KEY             Alternative for OpenAI
  GEMINI_API_KEY             Alternative for Gemini
  LLM_MODEL                  Model name (e.g., gpt-4o-mini, gemini-2.5-flash)
  LLM_ENDPOINT               Custom endpoint URL (for custom provider)

Config (.mssqlcli.json):
  {
    "defaultTarget": "../mssqlOrm",
    "defaultBranch": "main",
    "dryRun": false,
    "push": false,
    "skipPrompt": false,
    "tunnel": {
      "subdomain": "my-mssql",
      "port": 5070
    }
  }

Examples:
  mssql-cli tasks list                       List all tasks
  mssql-cli tasks list --status todo         List only todo tasks
  mssql-cli tasks list --priority high       List only high priority tasks
  mssql-cli tasks update --id TASK-123 --status done
  mssql-cli tasks delete --id TASK-123
  mssql-cli impact                           Analyze impact from current repo changes
  mssql-cli sync ../mssqlOrm                 Rebuild + test all affected repos
  mssql-cli release                          Release current/default repo
  mssql-cli ws                               Release all repos in workspace
  mssql-cli ui                               Launch the Web UI Dashboard
  mssql-cli ui --tunnel                      Launch UI with localtunnel
  mssql-cli ui --tunnel --subdomain my-app   Launch UI with custom tunnel subdomain
  mssql-cli tunnel                           Start tunnel on port 5070
  mssql-cli tunnel --subdomain my-app        Start tunnel with custom subdomain
  mssql-cli tunnel stop                      Stop running tunnel
  mssql-cli tunnel status                    Show tunnel status`);
}

function parseArgs(argv: string[]): Options {
  const options: Options = { command: 'release', targetDir: process.cwd(), dryRun: false, push: false, pull: false, skipLlm: false, all: false };
  let scriptName = '';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === 'tasks') {
      options.command = 'tasks';
      const next = argv[i + 1];
      if (next && !next.startsWith('-') && ['list', 'update', 'delete'].includes(next)) {
        options.taskAction = next;
        i++;
      } else {
        options.taskAction = 'list';
      }
    }
    else if (arg === 'tunnel') {
      options.command = 'tunnel';
      const next = argv[i + 1];
      if (next && !next.startsWith('-') && ['start', 'stop', 'status'].includes(next)) {
        options.tunnelAction = next;
        i++;
      } else {
        options.tunnelAction = 'start';
      }
    }
    else if (arg === 'release' || arg === 'ws' || arg === 'ui' || arg === 'config' || arg === 'doc' || arg === 'format' || arg === 'impact' || arg === 'doc:diff' || arg === 'sync') { options.command = arg as Command; }
    else if (arg === 'login') { options.command = 'login'; }
    else if (arg === 'run') { options.command = 'run'; scriptName = argv[++i] || ''; }
    else if (arg === '--dry-run') { options.dryRun = true; }
    else if (arg === '--push') { options.push = true; }
    else if (arg === '--pull') { options.pull = true; }
    else if (arg === '--tag') { options.tag = argv[++i]; }
    else if (arg === '--message') { options.message = argv[++i]; }
    else if (arg === '--branch') { options.branch = argv[++i]; }
    else if (arg === '--all') { options.all = true; }
    else if (arg === '--skip-llm') { options.skipLlm = true; }
    else if (arg === '--skip-prompt') { options.skipPrompt = true; }
    else if (arg === '--no-verify') { options.noVerify = true; }
    else if (arg === '--skip-docs') { options.skipDocs = true; }
    else if (arg === '--skip-build') { options.skipBuild = true; }
    else if (arg === '--status') { options.taskStatus = argv[++i]; }
    else if (arg === '--priority') { options.taskPriority = argv[++i]; }
    else if (arg === '--id') { options.taskId = argv[++i]; }
    else if (arg === '--subdomain') { options.tunnelSubdomain = argv[++i]; }
    else if (arg === '--tunnel-port') { options.tunnelPort = parseInt(argv[++i], 10); }
    else if (arg === '--help' || arg === '-h') { printHelp(); process.exit(0); }
    else if (arg.startsWith('--')) { throw new Error(`Unknown option: ${arg}`); }
    else if (arg !== 'release' && arg !== 'ws' && options.command !== 'tasks') { options.targetDir = path.resolve(arg); }
  }
  (options as any).scriptName = scriptName;
  return options;
}

function inferComponent(file: string): string {
  const normalized = file.replace(/\\/g, '/').toLowerCase();
  if (normalized.includes('/generator/')) return 'generator';
  if (normalized.includes('/mssqlclient/')) return 'client';
  if (normalized.includes('/mssqlschema/')) return 'schema';
  if (normalized.includes('/.github/')) return 'ci';
  if (normalized.includes('package.json') || normalized.includes('tsconfig')) return 'build';
  if (normalized.includes('.md')) return 'docs';
  return 'misc';
}

function collectChanges(cwd: string): ChangeGroup[] {
  git(['-C', cwd, 'update-index', '--refresh'], true);
  const status = git(['-C', cwd, 'status', '--porcelain']);
  const files: string[] = [];
  for (const line of status.split('\n')) {
    const match = line.match(/^([ MADRCU?!]{1,2})\s+(.*)$/);
    if (match) {
      files.push(match[2].trim());
    }
  }
  const groups = new Map<string, ChangeGroup>();
  for (const file of files) {
    const component = inferComponent(file);
    if (!groups.has(component)) groups.set(component, { component, files: [] });
    groups.get(component)!.files.push(file);
  }
  return Array.from(groups.values());
}

function detectVersion(cwd: string, tag?: string): string {
  if (tag) return tag.replace(/^v/, '');
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
    if (pkg.version) {
      const parts = pkg.version.split('.').map(Number);
      parts[parts.length - 1] = (parts[parts.length - 1] || 0) + 1;
      return parts.join('.');
    }
  } catch { /* fall through */ }
  return '0.0.1';
}

function formatCommitMessageForChangelog(commitMessage: string): string {
  const lines = commitMessage.trim().split('\n').map(l => l.trimEnd());
  if (lines.length === 0) return '';
  const subject = lines[0].trim();
  const bodyLines = lines.slice(1).map(l => l.trim());
  const result: string[] = [];
  result.push(`- ${subject}`);
  for (const line of bodyLines) {
    if (!line) continue;
    if (line.startsWith('- ') || line.startsWith('* ')) {
      result.push(`  - ${line.slice(2)}`);
    } else {
      result.push(`  - ${line}`);
    }
  }
  return result.join('\n');
}

function removeVersionSection(content: string, version: string): string {
  const lines = content.split('\n');
  const resultLines: string[] = [];
  let skipping = false;
  const escVersion = version.replace(/\./g, '\\.');
  const versionHeaderRegex = new RegExp(`^##\\s+\\[?v?${escVersion}\\]?(?![0-9.])`, 'i');
  for (const line of lines) {
    if (versionHeaderRegex.test(line.trim())) {
      skipping = true;
      continue;
    }
    if (skipping) {
      if (line.trim().startsWith('## ')) {
        skipping = false;
      } else {
        continue;
      }
    }
    resultLines.push(line);
  }
  return resultLines.join('\n');
}

async function generateChangelog(cwd: string, groups: ChangeGroup[], tag: string | undefined, commitMessage: string): Promise<string> {
  if (groups.length === 0) return '';
  const version = detectVersion(cwd, tag);
  const date = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];

  // New release header
  lines.push(`## [${version}] - ${date}`, '');

  // Add formatted commit message as changelog content
  const formattedContent = formatCommitMessageForChangelog(commitMessage);
  lines.push(formattedContent);
  lines.push('');

  // Preserve existing changelog
  const changelogPath = path.join(cwd, 'CHANGELOG.md');
  if (fs.existsSync(changelogPath)) {
    const existing = fs.readFileSync(changelogPath, 'utf8').trim();
    if (existing) {
      const content = existing.replace(/^#\s+Changelog\s*\n*/i, '');
      const cleanedContent = removeVersionSection(content, version);
      lines.push(cleanedContent);
    }
  }

  const full = lines.join('\n').trim();
  return `# Changelog\n\n${full}\n`;
}

function detectBranch(cwd: string): string {
  try {
    const branch = git(['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD']);
    if (branch && branch !== 'HEAD') return branch;
    // Detached HEAD — try to determine from remote HEAD or config
    try {
      const remoteHead = git(['-C', cwd, 'symbolic-ref', 'refs/remotes/origin/HEAD']);
      if (remoteHead) return remoteHead.replace('refs/remotes/origin/', '');
    } catch { /* fall through */ }
    try {
      const config = JSON.parse(fs.readFileSync(path.join(cwd, '.mssqlcli.json'), 'utf8'));
      if (config.defaultBranch) return config.defaultBranch;
    } catch { /* fall through */ }
    return 'main';
  } catch {
    return 'main';
  }
}

function loadConfig(cwd: string): Config {
  const configPath = path.join(cwd, '.mssqlcli.json');
  if (!fs.existsSync(configPath)) return {};
  return JSON.parse(fs.readFileSync(configPath, 'utf8')) as Config;
}

function updateRemoteUrl(cwd: string, username: string, token?: string): string {
  const remote = git(['-C', cwd, 'remote', 'get-url', 'origin'], true);
  if (!remote) return '';
  const credPart = token ? `${username}:${token}` : username;
  const newUrl = remote.replace(/^https:\/\/([^@]+@)?github\.com\//, `https://${credPart}@github.com/`);
  if (newUrl === remote) return remote;
  git(['-C', cwd, 'remote', 'set-url', 'origin', newUrl]);
  // Enable useHttpPath so GCM picks credential per-repo path, not by host
  git(['-C', cwd, 'config', 'credential.useHttpPath', 'true'], true);
  return remote;
}

function storeCredentialForRepo(cwd: string, username: string, token: string) {
  const remote = git(['-C', cwd, 'remote', 'get-url', 'origin'], true);
  if (!remote) return;
  const path = remote.replace(/^https:\/\/([^@]+@)?github\.com\//, '').replace(/\.git$/, '');
  // GCM with useHttpPath matches by path=something/something
  const input = `protocol=https\nhost=github.com\npath=${path}\nusername=${username}\npassword=${token}\n`;
  try {
    execFileSync('git', ['-C', cwd, 'credential', 'approve'], {
      encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch { /* fall through */ }
}

function storeCredential(username: string, token: string) {
  try {
    const input = `protocol=https\nhost=github.com\nusername=${username}\npassword=${token}\n`;
    execFileSync('git', ['credential', 'approve'], { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] });
    console.log('  Credential stored in Git Credential Manager.');
  } catch {
    console.log('  Note: Could not store credential in GCM. Token may need to be embedded in remote URL.');
  }
}

function ghAuthAvailable(): boolean {
  try {
    execFileSync('gh', ['--version'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

function ghLoginViaBrowser(cwd: string) {
  console.log('\n🌐 Opening browser for GitHub login...\n');
  try {
    execSync('gh auth login --web --git-protocol https', { cwd, stdio: 'inherit' });
    const user = execFileSync('gh', ['api', 'user', '--jq', '.login'], { encoding: 'utf8', cwd }).trim();
    const token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', cwd }).trim();
    console.log(`\n  Logged in as ${user}`);

    // Configure git credential helper for all github.com repos
    try {
      execFileSync('gh', ['auth', 'setup-git'], { encoding: 'utf8', cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      console.log('  Configured git credential helper (gh as credential helper for github.com).');
    } catch {
      console.log('  Note: Could not run gh auth setup-git. Git operations may still prompt.');
    }

    console.log('  Updating all submodule remote URLs...\n');

    const oldParent = updateRemoteUrl(cwd, user);
    if (oldParent) {
      storeCredentialForRepo(cwd, user, token);
      console.log(`  ✓ mssql: -> https://${user}@github.com/...`);
    }

    const subs = getSubmodules(cwd);
    for (const sub of subs) {
      const subPath = path.join(cwd, sub);
      const old = updateRemoteUrl(subPath, user);
      if (old) {
        storeCredentialForRepo(subPath, user, token);
        console.log(`  ✓ ${sub}: -> https://${user}@github.com/...`);
      }
    }
    console.log(`\n✅ Login complete. ${subs.length + 1} repo(s) updated.`);
    console.log(`  All git push/pull in this workspace now use ${user} (no account picker prompt).\n`);
  } catch (err: any) {
    console.error(`\nBrowser login failed: ${err.message || err}`);
    console.error('Falling back to manual PAT login.');
    cmdLoginManual(cwd);
  }
}

function cmdLoginManual(cwd: string): void {
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('GitHub username: ', (u: string) => {
    rl.question('Personal Access Token: ', (t: string) => {
      rl.close();
      doLogin(cwd, u.trim(), t.trim());
    });
  });
}

function cmdLogin(cwd: string, username?: string, token?: string): Promise<void> {
  // No args → try browser login via gh CLI
  if (!username && !token) {
    if (ghAuthAvailable()) {
      ghLoginViaBrowser(cwd);
      return Promise.resolve();
    }
    console.log('GitHub CLI (gh) not found. Install from https://cli.github.com');
    console.log('Or use: mssql-cli login <username> <token>\n');
    cmdLoginManual(cwd);
    return Promise.resolve();
  }
  doLogin(cwd, username || '', token || '');
  return Promise.resolve();
}

function doLogin(cwd: string, username: string, token: string) {
  if (!username || !token) { console.error('Error: username and token are required.'); process.exit(1); }

  console.log(`\n🔑 Setting up GitHub authentication for ${username}...\n`);

  // Update parent repo remote + store credential for this repo path
  const oldParent = updateRemoteUrl(cwd, username, token);
  if (oldParent) {
    storeCredentialForRepo(cwd, username, token);
    console.log(`  ✓ mssql: ${oldParent.replace(/^https:\/\/([^@]+@)?/, 'https://')} -> https://${username}@github.com/...`);
  }

  // Update submodule remotes
  const subs = getSubmodules(cwd);
  for (const sub of subs) {
    const subPath = path.join(cwd, sub);
    const old = updateRemoteUrl(subPath, username, token);
    if (old) {
      storeCredentialForRepo(subPath, username, token);
      console.log(`  ✓ ${sub}: ${old.replace(/^https:\/\/([^@]+@)?/, 'https://')} -> https://${username}@github.com/...`);
    }
  }

  console.log(`\n✅ Login complete. ${subs.length + 1} repo(s) updated.`);
  console.log(`  All git push/pull in this workspace now use ${username} (no account picker prompt).\n`);
}


function getRepoName(cwd: string): string {
  try {
    return path.basename(git(['-C', cwd, 'rev-parse', '--show-toplevel']));
  } catch {
    return path.basename(cwd);
  }
}

function askQuestion(query: string): Promise<string> {
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(query, (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function runQualityChecks(cwd: string, options: Options): boolean {
  if (options.noVerify || process.env.MSSQL_CLI_CHECKS_RUNNING) {
    if (process.env.MSSQL_CLI_CHECKS_RUNNING) {
      // Prevent infinite recursion in tests calling the CLI
      return true;
    }
    console.log(`  ⚠️ Skipping code quality checks (--no-verify)`);
    return true;
  }

  const repoName = getRepoName(cwd);
  const packageJsonPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return true;
  }

  console.log(`\n🔍 [${repoName}] Running code quality checks...`);

  // Set the environment variable to avoid infinite recursion
  process.env.MSSQL_CLI_CHECKS_RUNNING = 'true';

  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const scripts = pkg.scripts || {};

    if (scripts.build) {
      console.log(`  ↳ Running build: npm run build...`);
      execSync('npm run build', { cwd, stdio: 'pipe' });
      console.log(`  ✓ Build passed`);
    }

    if (scripts.compile) {
      console.log(`  ↳ Running compilation: npm run compile...`);
      execSync('npm run compile', { cwd, stdio: 'pipe' });
      console.log(`  ✓ Compile passed`);
    }

    const hasTestScript = scripts.test && scripts.test !== 'echo "Error: no test specified" && exit 1';
    if (hasTestScript) {
      console.log(`  ↳ Running tests: npm test...`);
      execSync('npm test', { cwd, stdio: 'pipe' });
      console.log(`  ✓ Tests passed`);
    }

    console.log(`  ✨ Code quality checks passed successfully!\n`);
    // Reset it
    delete process.env.MSSQL_CLI_CHECKS_RUNNING;
    return true;
  } catch (err: any) {
    console.error(`\n❌ Code quality checks FAILED in ${repoName}:`);
    console.error(err.stdout?.toString() || err.message);
    delete process.env.MSSQL_CLI_CHECKS_RUNNING;
    return false;
  }
}

async function releaseRepo(targetDir: string, options: Options, config: Config): Promise<boolean> {
  const resolvedDir = path.resolve(targetDir);
  if (!fs.existsSync(resolvedDir)) { console.error(`Directory not found: ${resolvedDir}`); return false; }
  if (!fs.existsSync(path.join(resolvedDir, '.git'))) { console.log(`Skipping ${resolvedDir} (not a git repo)`); return false; }

  const repoName = getRepoName(resolvedDir);
  const branch = options.branch || config.defaultBranch || detectBranch(resolvedDir);

  if (options.pull) {
    console.log(`  Pulling ${repoName}...`);
    git(['-C', resolvedDir, 'pull', 'origin', branch], true);
  }

  const groups = collectChanges(resolvedDir);
  if (groups.length === 0) {
    if (options.all) console.log(`  ${repoName}: no changes`);
    return false;
  }

  for (const group of groups) {
    console.log(`  ${repoName}: [${group.component}] ${group.files.length} file(s)`);
    for (const file of group.files) console.log(`    - ${file}`);
  }

  // 1. Run code quality checks
  if (!runQualityChecks(resolvedDir, options)) {
    console.error(`❌ Aborting release for ${repoName} due to quality check failures.`);
    return false;
  }

  const fullDiff = git(['-C', resolvedDir, 'diff', 'HEAD'], true);

  // 2. LLM Preview & Review
  const skipPrompt = options.skipPrompt || config.skipPrompt || !process.stdin.isTTY;
  if (!skipPrompt && fullDiff) {
    console.log(`\n🔎 [${repoName}] Requesting LLM Code Review...`);
    const codeReview = await generateCodeReview(fullDiff, repoName);
    if (codeReview) {
      console.log(`\n================== LLM CODE REVIEW & PREVIEW ==================`);
      console.log(codeReview);
      console.log(`================================================================`);
      
      // Automatically generate Genkit tasks from the review
      try {
        const { createTasksFromReview } = require('../../mssqlTasks/dist/index');
        const workspaceRoot = path.resolve(resolvedDir, '..');
        await createTasksFromReview(codeReview, workspaceRoot);
      } catch (taskErr: any) {
        // Silently catch if not built
      }
    } else {
      console.log(`\n⚠️ Could not generate LLM Code Review.`);
    }
  }

  // 3. Resolve commit message (including LLM generation on unstaged diff)
  let commitMessage = options.message;
  if (!commitMessage && !options.skipLlm) {
    const recentLog = getGitLog(resolvedDir, 3);
    const llmContext = `Recent commits:\n${recentLog}\n\nChanges in this commit:\n${fullDiff}`;
    const llmMessage = await generateCommitMessage(llmContext, repoName);
    if (llmMessage) {
      commitMessage = llmMessage;
    }
  }

  if (!commitMessage) {
    const components = groups.map(g => g.component).join(', ');
    commitMessage = `chore: update ${components}`;
  }

  // 4. Interactive Confirmation & Loop
  if (!skipPrompt) {
    console.log(`\n📝 Proposed commit message:\n"${commitMessage}"\n`);
    let approved = false;
    while (!approved) {
      const choice = await askQuestion(`Do you want to proceed? [y/e/n] (y: Yes, e: Edit commit message, n: Cancel): `);
      const lower = choice.toLowerCase();
      if (lower === 'y' || lower === 'yes' || lower === '') {
        approved = true;
      } else if (lower === 'e' || lower === 'edit') {
        const customMsg = await askQuestion(`Enter new commit message: `);
        if (customMsg) {
          commitMessage = customMsg;
          console.log(`\n📝 Updated commit message:\n"${commitMessage}"\n`);
        }
      } else {
        console.log(`\n❌ Release aborted by user.`);
        return false;
      }
    }
  } else {
    if (!options.dryRun) {
      console.log(`  Commit message: "${commitMessage}"`);
    }
  }

  // 5. Generate changelog using the resolved commit message
  const changelog = await generateChangelog(resolvedDir, groups, options.tag, commitMessage);
  const changelogPath = path.join(resolvedDir, 'CHANGELOG.md');

  if (options.dryRun) {
    console.log(`  [DRY RUN] Would commit: "${commitMessage}"`);
    console.log(`  [DRY RUN] Changelog preview:\n${changelog.slice(0, 800)}`);
    return true;
  }

  fs.writeFileSync(changelogPath, changelog + '\n');

  git(['-C', resolvedDir, 'add', '-A']);
  git(['-C', resolvedDir, 'commit', '-m', commitMessage], true);
  git(['-C', resolvedDir, 'update-index', '--refresh'], true);

  if (options.push) {
    git(['-C', resolvedDir, 'push', 'origin', branch], true);
    console.log(`  Pushed ${repoName}/${branch}`);
  }

  if (options.tag) {
    git(['-C', resolvedDir, 'tag', options.tag], true);
    if (options.push) git(['-C', resolvedDir, 'push', 'origin', options.tag], true);
  }

  console.log(`  ✅ ${repoName}: committed${options.push ? ' + pushed' : ''}`);
  return true;
}

function getSubmodules(cwd: string): string[] {
  const gitmodulesPath = path.join(cwd, '.gitmodules');
  if (!fs.existsSync(gitmodulesPath)) {
    const entries = fs.readdirSync(cwd, { withFileTypes: true });
    return entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && fs.existsSync(path.join(cwd, e.name, '.git'))).map(e => e.name);
  }
  const content = fs.readFileSync(gitmodulesPath, 'utf8');
  const paths: string[] = [];
  const regex = /path\s*=\s*(\S+)/g;
  let match;
  while ((match = regex.exec(content)) !== null) paths.push(match[1]);
  return paths.length > 0 ? paths : fs.readdirSync(cwd).filter(d => !d.startsWith('.') && fs.existsSync(path.join(cwd, d, '.git')));
}

async function cmdConfig(cwd: string): Promise<void> {
  console.log(`\n⚙️  Setting up LLM API configuration...\n`);
  
  const provider = await askQuestion(`Select LLM Provider (openai / gemini / custom) [openai]: `);
  const selectedProvider = provider || 'openai';
  
  const apiKey = await askQuestion(`Enter API Key for ${selectedProvider}: `);
  if (!apiKey) {
    console.error(`❌ Error: API Key is required.`);
    process.exit(1);
  }
  
  const model = await askQuestion(`Enter Model Name (optional, press Enter to default): `);
  const endpoint = await askQuestion(`Enter Endpoint URL (optional, press Enter to default): `);
  
  const envPath = path.join(cwd, '.env');
  let envContent = '';
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }
  
  function setEnvVar(content: string, key: string, value: string): string {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    const newLine = `${key}=${value}`;
    if (regex.test(content)) {
      return content.replace(regex, newLine);
    } else {
      return content.trim() + (content ? '\n' : '') + newLine + '\n';
    }
  }
  
  envContent = setEnvVar(envContent, 'LLM_PROVIDER', selectedProvider);
  envContent = setEnvVar(envContent, 'LLM_API_KEY', apiKey);
  if (model) envContent = setEnvVar(envContent, 'LLM_MODEL', model);
  if (endpoint) envContent = setEnvVar(envContent, 'LLM_ENDPOINT', endpoint);
  
  fs.writeFileSync(envPath, envContent);
  console.log(`\n✅ Configuration saved successfully to ${envPath}!\n`);
}

async function cmdDoc(targetPath: string): Promise<void> {
  const resolvedPath = path.resolve(targetPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`❌ Error: Path "${resolvedPath}" does not exist.`);
    process.exit(1);
  }

  const stat = fs.statSync(resolvedPath);
  const { generateDocumentation, improveDocumentation } = require('./llm');

  if (stat.isFile()) {
    const ext = path.extname(resolvedPath).toLowerCase();
    const content = fs.readFileSync(resolvedPath, 'utf8');
    const baseName = path.basename(resolvedPath);

    if (ext === '.md') {
      console.log(`📝 Improving markdown documentation for "${baseName}"...`);
      const improved = await improveDocumentation(content, baseName);
      if (improved) {
        fs.writeFileSync(resolvedPath, improved);
        console.log(`✅ Improved documentation saved to ${resolvedPath}`);
      } else {
        console.error(`❌ Error: LLM returned empty content or failed.`);
      }
    } else {
      console.log(`⚙️ Generating documentation for code file "${baseName}"...`);
      const doc = await generateDocumentation(content, baseName);
      if (doc) {
        const outPath = path.join(path.dirname(resolvedPath), path.basename(resolvedPath, ext) + '.md');
        fs.writeFileSync(outPath, doc);
        console.log(`✅ Documentation generated and saved to ${outPath}`);
      } else {
        console.error(`❌ Error: LLM returned empty content or failed.`);
      }
    }
  } else {
    const readmePath = path.join(resolvedPath, 'README.md');
    if (fs.existsSync(readmePath)) {
      console.log(`📝 Improving repository README.md...`);
      const content = fs.readFileSync(readmePath, 'utf8');
      const improved = await improveDocumentation(content, 'README.md');
      if (improved) {
        fs.writeFileSync(readmePath, improved);
        console.log(`✅ Improved README.md saved to ${readmePath}`);
      } else {
        console.error(`❌ Error: LLM returned empty content or failed.`);
      }
    } else {
      console.log(`⚙️ Generating new README.md for directory "${path.basename(resolvedPath)}"...`);
      const files = fs.readdirSync(resolvedPath).filter(f => !f.startsWith('.') && f !== 'node_modules' && f !== 'dist');
      
      let context = `Directory contents: ${files.join(', ')}\n\n`;
      const pkgPath = path.join(resolvedPath, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        context += `Package Name: ${pkg.name}\nDescription: ${pkg.description || ''}\nDependencies: ${Object.keys(pkg.dependencies || {}).join(', ')}\n`;
      }
      
      const doc = await generateDocumentation(context, 'README.md');
      if (doc) {
        fs.writeFileSync(readmePath, doc);
        console.log(`✅ Generated README.md saved to ${readmePath}`);
      } else {
        console.error(`❌ Error: LLM returned empty content or failed.`);
      }
    }
  }
}

async function cmdFormat(targetPath: string): Promise<void> {
  const resolvedPath = path.resolve(targetPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`❌ Error: Path "${resolvedPath}" does not exist.`);
    process.exit(1);
  }

  const stat = fs.statSync(resolvedPath);

  function formatFile(filePath: string) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== '.mssql') return;
    const content = fs.readFileSync(filePath, 'utf8');

    const lines = content.split(/\r?\n/);
    const formattedLines: string[] = [];
    let inModel = false;
    let modelLines: { name: string; type: string; attributes: string }[] = [];
    let modelMetaLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed.startsWith('model ') && trimmed.endsWith('{')) {
        inModel = true;
        formattedLines.push(line);
        modelLines = [];
        modelMetaLines = [];
        continue;
      }

      if (inModel) {
        if (trimmed === '}') {
          inModel = false;
          let maxNameLen = 0;
          let maxTypeLen = 0;

          for (const field of modelLines) {
            if (field.name.length > maxNameLen) maxNameLen = field.name.length;
            if (field.type.length > maxTypeLen) maxTypeLen = field.type.length;
          }

          let maxFieldTextLen = 0;
          for (const field of modelLines) {
            const paddedName = field.name.padEnd(maxNameLen, ' ');
            const paddedType = field.type.padEnd(maxTypeLen, ' ');
            const fieldText = `${paddedName} ${paddedType}`;
            if (field.attributes && fieldText.length > maxFieldTextLen) {
              maxFieldTextLen = fieldText.length;
            }
          }

          for (const field of modelLines) {
            const paddedName = field.name.padEnd(maxNameLen, ' ');
            const paddedType = field.type.padEnd(maxTypeLen, ' ');
            const fieldText = `${paddedName} ${paddedType}`;
            if (field.attributes) {
              const paddedFieldText = fieldText.padEnd(maxFieldTextLen, ' ');
              formattedLines.push(`  ${paddedFieldText} ${field.attributes}`);
            } else {
              formattedLines.push(`  ${fieldText}`);
            }
          }

          for (const meta of modelMetaLines) {
            formattedLines.push(`  ${meta}`);
          }

          formattedLines.push('}');
          continue;
        }

        if (!trimmed) {
          continue;
        }

        if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('@@')) {
          modelMetaLines.push(trimmed);
          continue;
        }

        const parts = trimmed.split(/\s+/);
        const name = parts[0];
        const type = parts[1];
        if (name && type) {
          const attributes = parts.slice(2).join(' ');
          modelLines.push({ name, type, attributes });
        } else {
          modelMetaLines.push(trimmed);
        }
        continue;
      }

      formattedLines.push(line);
    }

    fs.writeFileSync(filePath, formattedLines.join('\n'));
    console.log(`✅ Formatted: ${filePath}`);
  }

  if (stat.isFile()) {
    formatFile(resolvedPath);
  } else {
    const files = fs.readdirSync(resolvedPath);
    for (const file of files) {
      const fullPath = path.join(resolvedPath, file);
      if (fs.statSync(fullPath).isFile() && file.endsWith('.mssql')) {
        formatFile(fullPath);
      }
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = loadConfig(options.targetDir);
  const targetDir = options.command === 'ws'
    ? options.targetDir
    : path.resolve(options.targetDir === '.' ? (config.defaultTarget || '.') : options.targetDir);

  if (options.command === 'config') {
    const resolvedDir = path.resolve(targetDir);
    await cmdConfig(resolvedDir);
    return;
  }

  if (options.command === 'doc') {
    const resolvedDir = path.resolve(targetDir);
    await cmdDoc(resolvedDir);
    return;
  }

  if (options.command === 'format') {
    const resolvedDir = path.resolve(targetDir);
    await cmdFormat(resolvedDir);
    return;
  }

  if (options.command === 'impact') {
    const resolvedDir = path.resolve(targetDir);
    console.log(`\n🔍 Impact Analysis: ${resolvedDir}\n`);
    const result = analyzeImpact(resolvedDir);
    console.log(`Source: ${result.sourceRepo}`);
    console.log(`Changed files: ${result.changedFiles.length}`);
    console.log(`Components: ${result.components.join(', ') || 'none'}`);
    console.log(`\nAffected repos:`);
    if (result.affectedRepos.length === 0) {
      console.log(`  (none — no downstream consumers)`);
    } else {
      for (const affected of result.affectedRepos) {
        console.log(`  → ${affected.name}`);
        console.log(`    Reason: ${affected.reason}`);
        console.log(`    Actions: ${affected.actions.join(', ')}`);
      }
    }
    return;
  }

  if (options.command === 'doc:diff') {
    const resolvedDir = path.resolve(targetDir);
    console.log(`\n📝 Diff-based Documentation Update: ${resolvedDir}\n`);
    const updates = analyzeDocUpdates(resolvedDir);
    if (updates.length === 0) {
      console.log(`No documentation updates needed.`);
      return;
    }
    console.log(`Found ${updates.length} documentation update(s):\n`);
    for (const update of updates) {
      const icon = update.action === 'improve' ? '✏️' : '🆕';
      console.log(`  ${icon} ${update.repo}/${update.file}`);
      console.log(`    Action: ${update.action}`);
      console.log(`    Reason: ${update.reason}`);
    }
    // Execute the updates
    console.log(`\nUpdating documentation...`);
    const { improveDocumentation, generateDocumentation } = require('./llm');
    for (const update of updates) {
      const filePath = path.join(path.dirname(resolvedDir), update.repo, update.file);
      if (!fs.existsSync(filePath)) continue;
      const content = fs.readFileSync(filePath, 'utf8');
      try {
        let result: string | null = null;
        if (update.action === 'improve' && content.trim()) {
          result = await improveDocumentation(content, path.basename(filePath));
        } else if (update.action === 'generate') {
          result = await generateDocumentation(content, path.basename(filePath));
        }
        if (result) {
          fs.writeFileSync(filePath, result);
          console.log(`  ✓ ${update.repo}/${update.file}`);
        }
      } catch (err: any) {
        console.error(`  ❌ ${update.repo}/${update.file}: ${err.message}`);
      }
    }
    console.log(`\n✅ Documentation updates complete.`);
    return;
  }

  if (options.command === 'sync') {
    const resolvedDir = path.resolve(targetDir);
    console.log(`\n🔄 Sync: ${resolvedDir}\n`);
    const results = await executeSync(resolvedDir, {
      dryRun: options.dryRun,
      skipDocs: options.skipDocs,
      skipBuild: options.skipBuild,
      skipPrompt: options.skipPrompt,
    });
    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    console.log(`\n📊 Sync complete: ${succeeded} succeeded, ${failed} failed`);
    return;
  }

  if (options.command === 'tasks') {
    const resolvedDir = path.resolve(targetDir);
    const action = options.taskAction || 'list';
    const workspaceDir = resolvedDir;

    const tasksModule = loadTasksModule();
    if (!tasksModule) {
      console.error('Error: mssqlTasks module not found. Run: cd mssqlTasks && npm run build');
      process.exit(1);
    }

    if (action === 'list') {
      console.log(`\n📋 Tasks in ${workspaceDir}\n`);
      const filters: any = {};
      if (options.taskStatus) filters.status = options.taskStatus;
      if (options.taskPriority) filters.priority = options.taskPriority;
      const tasks = await tasksModule.getTasks(workspaceDir, filters);
      if (tasks.length === 0) {
        console.log('  No tasks found.');
      } else {
        for (const task of tasks) {
          const priorityIcon = task.priority === 'high' ? '🔴' : task.priority === 'medium' ? '🟡' : '🟢';
          const statusIcon = task.status === 'done' ? '✅' : task.status === 'in-progress' ? '🔄' : '⬜';
          console.log(`  ${statusIcon} ${priorityIcon} ${task.id}`);
          console.log(`     ${task.title}`);
          if (task.file) console.log(`     📁 ${task.file}`);
          console.log(`     Created: ${task.createdAt}`);
          console.log('');
        }
        console.log(`  Total: ${tasks.length} task(s)`);
      }
    } else if (action === 'update') {
      if (!options.taskId) {
        console.error('Error: --id <taskId> is required for update');
        process.exit(1);
      }
      const updates: any = {};
      if (options.taskStatus) updates.status = options.taskStatus;
      if (options.taskPriority) updates.priority = options.taskPriority;
      if (Object.keys(updates).length === 0) {
        console.error('Error: --status or --priority is required for update');
        process.exit(1);
      }
      const updated = await tasksModule.updateTask(workspaceDir, options.taskId, updates);
      if (updated) {
        console.log(`\n✅ Updated task ${options.taskId}:`);
        console.log(`   Status: ${updated.status}`);
        console.log(`   Priority: ${updated.priority}`);
      } else {
        console.error(`\n❌ Task ${options.taskId} not found.`);
      }
    } else if (action === 'delete') {
      if (!options.taskId) {
        console.error('Error: --id <taskId> is required for delete');
        process.exit(1);
      }
      const deleted = await tasksModule.deleteTask(workspaceDir, options.taskId);
      if (deleted) {
        console.log(`\n✅ Deleted task ${options.taskId}`);
      } else {
        console.error(`\n❌ Task ${options.taskId} not found.`);
      }
    } else {
      console.error(`Unknown task action: ${action}. Use: list, update, delete`);
    }
    return;
  }

  if (options.command === 'ws') {
    console.log(`\n🚀 Workspace release: ${targetDir}\n`);
    console.log(`  Initializing and updating git submodules...`);
    git(['-C', targetDir, 'submodule', 'update', '--init', '--recursive'], true);
    git(['-C', targetDir, 'submodule', 'update', '--remote', '--merge'], true);
    const submodules = getSubmodules(targetDir);
    if (submodules.length === 0) {
      console.log('No submodules or git repos found in this directory.');
      return;
    }
    let changed = 0;
    for (const sub of submodules) {
      const subPath = path.join(targetDir, sub);
      console.log(`\n📦 ${sub}`);
      const didChange = await releaseRepo(subPath, { ...options, targetDir: subPath }, config);
      if (didChange) changed++;
    }
    console.log(`\n📊 ${changed}/${submodules.length} repo(s) updated.`);
    const parentGroups = collectChanges(targetDir);
    if (parentGroups.length > 0) {
      console.log(`\n📦 Updating parent repo submodule references...`);
      await releaseRepo(targetDir, options, config);
    }
    return;
  }

  if (options.command === 'ui') {
    const resolvedDir = path.resolve(targetDir);
    const { startUiServer } = require('./ui');
    const tunnel = process.argv.includes('--tunnel');
    startUiServer(resolvedDir, {
      tunnel,
      subdomain: options.tunnelSubdomain || config.tunnel?.subdomain,
    });
    return;
  }

  if (options.command === 'tunnel') {
    const { startTunnel, stopTunnel, getTunnelStatus } = require('./tunnel');
    const action = options.tunnelAction || 'start';
    const port = options.tunnelPort || config.tunnel?.port || 5070;
    const subdomain = options.tunnelSubdomain || config.tunnel?.subdomain;

    if (action === 'start') {
      startTunnel({ port, subdomain });
    } else if (action === 'stop') {
      stopTunnel();
    } else if (action === 'status') {
      getTunnelStatus();
    }
    return;
  }

  if (options.command === 'release') {
    const resolvedDir = path.resolve(targetDir);
    console.log(`\n🚀 Release: ${resolvedDir}\n`);
    await releaseRepo(resolvedDir, options, config);
    return;
  }

  if (options.command === 'login') {
    const [username, token] = process.argv.slice(3);
    await cmdLogin(targetDir, username, token);
    return;
  }

  if (options.command === 'run') {
    const scriptName = (options as any).scriptName;
    if (!scriptName) { console.error('Usage: mssql-cli run <script-name> [workspace-path]'); process.exit(1); }
    // Look for workspace.json in targetDir or parent
    let wsDir = options.targetDir;
    let workspacePath = path.join(wsDir, 'workspace.json');
    while (!fs.existsSync(workspacePath) && wsDir !== path.dirname(wsDir)) {
      wsDir = path.dirname(wsDir);
      workspacePath = path.join(wsDir, 'workspace.json');
    }
    if (!fs.existsSync(workspacePath)) { console.error('workspace.json not found in current or parent directories'); process.exit(1); }
    const workspace = JSON.parse(fs.readFileSync(workspacePath, 'utf8'));
    const scriptCmd = workspace.scripts?.[scriptName];
    if (!scriptCmd) { console.error(`Script "${scriptName}" not found in workspace.json. Available: ${Object.keys(workspace.scripts || {}).join(', ')}`); process.exit(1); }
    console.log(`\n🚀 Running script "${scriptName}": ${scriptCmd}\n`);
    const { execSync } = require('child_process');
    execSync(scriptCmd, { cwd: wsDir, stdio: 'inherit', shell: true });
    return;
  }

  printHelp();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
