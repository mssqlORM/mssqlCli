// ui.ts - Backend HTTP server for an5-cli Web UI Dashboard

import http from 'http';
import fs from 'fs';
import path from 'path';
import { exec, execSync, execFileSync } from 'child_process';
import { generateCommitMessage, generateCodeReview } from './llm';
import { analyzeImpact, analyzeDocUpdates, executeSync } from './impact';

function loadTasksModule() {
  try {
    return require('../../an5Tasks/dist/index');
  } catch {
    return null;
  }
}

// Helper to run git commands
function git(args: string[], cwd: string): string {
  try {
    return execFileSync('git', args, { encoding: 'utf8', cwd }).trim();
  } catch {
    return '';
  }
}

// Find repository absolute paths based on root package.json
function getRepositories(workspaceDir: string) {
  const list: { name: string; path: string; description: string; modifiedFiles: string[] }[] = [];
  
  // 1. Add parent workspace repository
  try {
    const parentPkg = JSON.parse(fs.readFileSync(path.join(workspaceDir, 'package.json'), 'utf8'));
    list.push({
      name: parentPkg.name || 'an5-workspace (parent)',
      path: workspaceDir,
      description: parentPkg.description || 'Parent workspace repository managing submodules',
      modifiedFiles: []
    });

    // 2. Add submodules from package.json repos array
    if (parentPkg.repos && Array.isArray(parentPkg.repos)) {
      for (const repo of parentPkg.repos) {
        const repoPath = path.join(workspaceDir, repo.path);
        if (fs.existsSync(repoPath)) {
          list.push({
            name: repo.name,
            path: repoPath,
            description: repo.description || '',
            modifiedFiles: []
          });
        }
      }
    }
  } catch (err) {
    console.error('Error parsing package.json:', err);
  }

  // Populate git status modified files
  for (const repo of list) {
    try {
      if (fs.existsSync(path.join(repo.path, '.git'))) {
        // Refresh index
        execSync('git update-index --refresh', { cwd: repo.path, stdio: 'ignore' });
      }
    } catch {}

    const status = git(['status', '--porcelain'], repo.path);
    if (status) {
      repo.modifiedFiles = status.split('\n').map(line => line.trim()).filter(Boolean);
    } else {
      repo.modifiedFiles = [];
    }
  }

  return list;
}

export function startUiServer(workspaceDir: string, options?: { tunnel?: boolean; subdomain?: string }) {
  const PORT = 5070;
  const publicDir = path.join(__dirname, '..', 'public');
  const cliPath = path.join(__dirname, 'index.js');

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const pathname = url.pathname;

    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    console.log(`[UI] ${req.method} ${pathname}`);

    // Serve Static Files
    if (req.method === 'GET' && !pathname.startsWith('/api/')) {
      const filename = pathname === '/' ? 'index.html' : pathname.slice(1);
      
      const distDir = path.join(__dirname, '..', 'ui', 'dist');
      const activeDir = fs.existsSync(distDir) ? distDir : publicDir;
      const filePath = path.resolve(activeDir, filename);

      if (filePath.startsWith(path.resolve(activeDir)) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filename).toLowerCase();
        let contentType = 'text/html';
        if (ext === '.css') contentType = 'text/css';
        else if (ext === '.js') contentType = 'application/javascript';
        else if (ext === '.svg') contentType = 'image/svg+xml';
        else if (ext === '.png') contentType = 'image/png';
        else if (ext === '.ico') contentType = 'image/x-icon';

        res.writeHead(200, { 'Content-Type': contentType });
        res.end(fs.readFileSync(filePath));
        return;
      }
    }

    // GET /api/status - Get all repositories and their modified files
    if (req.method === 'GET' && pathname === '/api/status') {
      const repos = getRepositories(workspaceDir);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ repos }));
      return;
    }

    // GET /api/diff?repo=name - Get git diff of a repository
    if (req.method === 'GET' && pathname === '/api/diff') {
      const repoName = url.searchParams.get('repo');
      const repos = getRepositories(workspaceDir);
      const repo = repos.find(r => r.name === repoName);

      if (!repo) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Repository not found' }));
        return;
      }

      const file = url.searchParams.get('file');
      const diffArgs = file ? ['diff', 'HEAD', '--', file] : ['diff', 'HEAD'];
      const diff = git(diffArgs, repo.path);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ diff }));
      return;
    }

    // GET /api/config - Get current LLM credentials (masked API key)
    if (req.method === 'GET' && pathname === '/api/config') {
      const provider = process.env.LLM_PROVIDER || 'openai';
      const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || '';
      const maskedKey = apiKey ? `${apiKey.slice(0, 4)}••••${apiKey.slice(-4)}` : '';
      const model = process.env.LLM_MODEL || '';
      const endpoint = process.env.LLM_ENDPOINT || '';

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ provider, apiKey: maskedKey, model, endpoint }));
      return;
    }

    // POST /api/config - Update LLM credentials
    if (req.method === 'POST' && pathname === '/api/config') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { provider, apiKey, model, endpoint } = JSON.parse(body);
          const envPath = path.join(workspaceDir, '.env');
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

          if (provider) envContent = setEnvVar(envContent, 'LLM_PROVIDER', provider);
          if (apiKey && !apiKey.includes('••••')) {
            envContent = setEnvVar(envContent, 'LLM_API_KEY', apiKey);
            process.env.LLM_API_KEY = apiKey;
          }
          if (provider) process.env.LLM_PROVIDER = provider;
          if (model) {
            envContent = setEnvVar(envContent, 'LLM_MODEL', model);
            process.env.LLM_MODEL = model;
          }
          if (endpoint) {
            envContent = setEnvVar(envContent, 'LLM_ENDPOINT', endpoint);
            process.env.LLM_ENDPOINT = endpoint;
          }

          fs.writeFileSync(envPath, envContent);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // POST /api/pull - Pull latest code for repository
    if (req.method === 'POST' && pathname === '/api/pull') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { repo: repoName } = JSON.parse(body);
          const repos = getRepositories(workspaceDir);
          const repo = repos.find(r => r.name === repoName);

          if (!repo) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Repository not found' }));
            return;
          }

          let logs = '';
          let success = true;
          try {
            const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], repo.path) || 'main';
            logs += `↳ Pulling latest from origin/${branch}...\n`;
            const out = execSync(`git pull origin ${branch}`, { cwd: repo.path, stdio: 'pipe' }).toString();
            logs += out + `✓ Pull complete\n`;
          } catch (err: any) {
            success = false;
            logs += `❌ Git pull failed:\n` + (err.stdout?.toString() || err.message) + '\n';
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success, logs }));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // POST /api/checks - Run quality checks
    if (req.method === 'POST' && pathname === '/api/checks') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { repo: repoName, noVerify } = JSON.parse(body);
          const repos = getRepositories(workspaceDir);
          const repo = repos.find(r => r.name === repoName);

          if (!repo) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Repository not found' }));
            return;
          }

          if (noVerify) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, logs: 'Skipped checks (--no-verify)' }));
            return;
          }

          const pkgPath = path.join(repo.path, 'package.json');
          let logs = '';
          let success = true;

          if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            const scripts = pkg.scripts || {};

            // Prevent infinite recursion in case tests trigger CLI release again
            process.env.AN5_CLI_CHECKS_RUNNING = 'true';

            try {
              if (scripts.build) {
                logs += `↳ Running build: npm run build...\n`;
                const out = execSync('npm run build', { cwd: repo.path, stdio: 'pipe' }).toString();
                logs += out + `✓ Build passed\n\n`;
              }

              if (scripts.compile) {
                logs += `↳ Running compilation: npm run compile...\n`;
                const out = execSync('npm run compile', { cwd: repo.path, stdio: 'pipe' }).toString();
                logs += out + `✓ Compile passed\n\n`;
              }

              const hasTestScript = scripts.test && scripts.test !== 'echo "Error: no test specified" && exit 1';
              if (hasTestScript) {
                logs += `↳ Running tests: npm test...\n`;
                const out = execSync('npm test', { cwd: repo.path, stdio: 'pipe' }).toString();
                logs += out + `✓ Tests passed\n\n`;
              }
            } catch (err: any) {
              success = false;
              logs += `❌ Command failed:\n` + (err.stdout?.toString() || err.message) + '\n';
            } finally {
              delete process.env.AN5_CLI_CHECKS_RUNNING;
            }
          } else {
            logs += `No package.json found. Skipping checks.\n`;
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success, logs }));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // POST /api/review - Get LLM Code Review
    if (req.method === 'POST' && pathname === '/api/review') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { repo: repoName } = JSON.parse(body);
          const repos = getRepositories(workspaceDir);
          const repo = repos.find(r => r.name === repoName);

          if (!repo) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Repository not found' }));
            return;
          }

          const diff = git(['diff', 'HEAD'], repo.path);
          if (!diff) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, review: 'No changes detected. Code review is clean!' }));
            return;
          }

          const review = await generateCodeReview(diff, repoName);
          
          if (review) {
            try {
              const { createTasksFromReview } = require('../../an5Tasks/dist/index');
              await createTasksFromReview(review, workspaceDir);
            } catch (taskErr: any) {
              console.error(`Failed to create tasks from review: ${taskErr.message}`);
            }
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: !!review, review }));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // POST /api/commit-msg - Generate LLM Commit Message
    if (req.method === 'POST' && pathname === '/api/commit-msg') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { repo: repoName } = JSON.parse(body);
          const repos = getRepositories(workspaceDir);
          const repo = repos.find(r => r.name === repoName);

          if (!repo) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Repository not found' }));
            return;
          }

          const diff = git(['diff', 'HEAD'], repo.path);
          const log = git(['log', '--oneline', '-3'], repo.path);
          const llmContext = `Recent commits:\n${log}\n\nChanges in this commit:\n${diff}`;
          const message = await generateCommitMessage(llmContext, repoName);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: !!message, message }));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // POST /api/release - Publish release (commit + push)
    if (req.method === 'POST' && pathname === '/api/release') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { repo: repoName, message, push, noVerify } = JSON.parse(body);
          const repos = getRepositories(workspaceDir);
          const repo = repos.find(r => r.name === repoName);

          if (!repo) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Repository not found' }));
            return;
          }

          // Build CLI command string. If the repo is the parent workspace itself, path is E:/git/an5
          const isParent = repo.path === workspaceDir;
          const cmdArgs = [
            `"${cliPath}"`,
            isParent ? 'release' : `release "${repo.path}"`,
            `--message "${message.replace(/"/g, '\\"')}"`,
            '--skip-prompt'
          ];
          if (push) cmdArgs.push('--push');
          if (noVerify) cmdArgs.push('--no-verify');

          const command = `node ${cmdArgs.join(' ')}`;
          let logs = `Executing CLI release:\n> ${command}\n\n`;
          let success = true;

          try {
            // Run the CLI process to execute the release logic
            const out = execSync(command, { cwd: workspaceDir, stdio: 'pipe' }).toString();
            logs += out;
          } catch (err: any) {
            success = false;
            logs += `❌ CLI execution failed:\n` + (err.stdout?.toString() || err.message) + '\n';
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success, logs }));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // GET /api/impact?repo=name - Analyze cross-repo impact
    if (req.method === 'GET' && pathname === '/api/impact') {
      const repoName = url.searchParams.get('repo');
      const repos = getRepositories(workspaceDir);
      const repo = repos.find(r => r.name === repoName);

      if (!repo) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Repository not found' }));
        return;
      }

      try {
        const impact = analyzeImpact(repo.path);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ impact }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // GET /api/doc:diff?repo=name - Get diff-based doc update plan
    if (req.method === 'GET' && pathname === '/api/doc:diff') {
      const repoName = url.searchParams.get('repo');
      const repos = getRepositories(workspaceDir);
      const repo = repos.find(r => r.name === repoName);

      if (!repo) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Repository not found' }));
        return;
      }

      try {
        const updates = analyzeDocUpdates(repo.path);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ updates }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // POST /api/sync - Execute sync (rebuild affected repos + update docs)
    if (req.method === 'POST' && pathname === '/api/sync') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { repo: repoName, dryRun, skipDocs, skipBuild } = JSON.parse(body);
          const repos = getRepositories(workspaceDir);
          const repo = repos.find(r => r.name === repoName);

          if (!repo) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Repository not found' }));
            return;
          }

          const results = await executeSync(repo.path, { dryRun, skipDocs, skipBuild, skipPrompt: true });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, results }));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // POST /api/doc:diff - Execute diff-based doc updates
    if (req.method === 'POST' && pathname === '/api/doc:diff') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { repo: repoName } = JSON.parse(body);
          const repos = getRepositories(workspaceDir);
          const repo = repos.find(r => r.name === repoName);

          if (!repo) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Repository not found' }));
            return;
          }

          const updates = analyzeDocUpdates(repo.path);
          let logs = `Found ${updates.length} documentation update(s)\n\n`;
          let success = true;

          for (const update of updates) {
            const filePath = path.join(repo.path, update.file);
            if (!fs.existsSync(filePath)) continue;

            logs += `${update.action === 'improve' ? '✏️' : '🆕'} ${update.repo}/${update.file}\n`;
            try {
              const content = fs.readFileSync(filePath, 'utf8');
              let result: string | null = null;
              if (update.action === 'improve' && content.trim()) {
                const { improveDocumentation } = require('./llm');
                result = await improveDocumentation(content, path.basename(filePath));
              } else if (update.action === 'generate') {
                const { generateDocumentation } = require('./llm');
                result = await generateDocumentation(content, path.basename(filePath));
              }
              if (result) {
                fs.writeFileSync(filePath, result);
                logs += `  ✓ Updated\n`;
              }
            } catch (err: any) {
              success = false;
              logs += `  ❌ Failed: ${err.message}\n`;
            }
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success, logs }));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // GET /api/tasks?workspace=path&status=X&priority=X - List tasks
    if (req.method === 'GET' && pathname === '/api/tasks') {
      const wsDir = url.searchParams.get('workspace') || workspaceDir;
      const status = url.searchParams.get('status') || undefined;
      const priority = url.searchParams.get('priority') || undefined;

      const tasksModule = loadTasksModule();
      if (!tasksModule) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'an5Tasks module not built' }));
        return;
      }

      try {
        const tasks = await tasksModule.getTasks(wsDir, { status, priority });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ tasks }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // POST /api/tasks/update - Update task status/priority
    if (req.method === 'POST' && pathname === '/api/tasks/update') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        const tasksModule = loadTasksModule();
        if (!tasksModule) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'an5Tasks module not built' }));
          return;
        }

        try {
          const { workspace, taskId, status, priority } = JSON.parse(body);
          const wsDir = workspace || workspaceDir;
          const updated = await tasksModule.updateTask(wsDir, taskId, { status, priority });
          if (updated) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, task: updated }));
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Task not found' }));
          }
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // POST /api/tasks/delete - Delete task
    if (req.method === 'POST' && pathname === '/api/tasks/delete') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        const tasksModule = loadTasksModule();
        if (!tasksModule) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'an5Tasks module not built' }));
          return;
        }

        try {
          const { workspace, taskId } = JSON.parse(body);
          const wsDir = workspace || workspaceDir;
          const deleted = await tasksModule.deleteTask(wsDir, taskId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: deleted }));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // POST /api/repo/build - Build a repo
    if (req.method === 'POST' && pathname === '/api/repo/build') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { repo: repoName } = JSON.parse(body);
          const repos = getRepositories(workspaceDir);
          const repo = repos.find(r => r.name === repoName);
          if (!repo) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Repository not found' }));
            return;
          }
          const pkgPath = path.join(repo.path, 'package.json');
          if (!fs.existsSync(pkgPath)) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, logs: 'No package.json found, skipping build.' }));
            return;
          }
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          if (!pkg.scripts?.build) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, logs: 'No build script found.' }));
            return;
          }
          try {
            const out = execSync('npm run build', { cwd: repo.path, stdio: 'pipe', timeout: 120000 }).toString();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, logs: out }));
          } catch (err: any) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, logs: err.stdout?.toString() || err.message }));
          }
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // POST /api/repo/test - Test a repo
    if (req.method === 'POST' && pathname === '/api/repo/test') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { repo: repoName } = JSON.parse(body);
          const repos = getRepositories(workspaceDir);
          const repo = repos.find(r => r.name === repoName);
          if (!repo) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Repository not found' }));
            return;
          }
          const pkgPath = path.join(repo.path, 'package.json');
          if (!fs.existsSync(pkgPath)) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, logs: 'No package.json found, skipping tests.' }));
            return;
          }
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          const hasTest = pkg.scripts?.test && !pkg.scripts.test.includes('echo "Error');
          if (!hasTest) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, logs: 'No test script found.' }));
            return;
          }
          try {
            const out = execSync('npm test', { cwd: repo.path, stdio: 'pipe', timeout: 120000 }).toString();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, logs: out }));
          } catch (err: any) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, logs: err.stdout?.toString() || err.message }));
          }
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // POST /api/repo/run - Run a specific script in a repo
    if (req.method === 'POST' && pathname === '/api/repo/run') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { repo: repoName, script } = JSON.parse(body);
          const repos = getRepositories(workspaceDir);
          const repo = repos.find(r => r.name === repoName);
          if (!repo) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Repository not found' }));
            return;
          }
          if (!script) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing script parameter' }));
            return;
          }
          // Sanitize script name to prevent command injection
          if (!/^[\w:.-]+$/.test(script)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid script name' }));
            return;
          }
          const pkgPath = path.join(repo.path, 'package.json');
          if (!fs.existsSync(pkgPath)) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, logs: 'No package.json found.' }));
            return;
          }
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          if (!pkg.scripts?.[script]) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, logs: `Script "${script}" not found in ${repo.name}. Available: ${Object.keys(pkg.scripts || {}).join(', ')}` }));
            return;
          }
          try {
            const out = execSync(`npm run ${script}`, { cwd: repo.path, stdio: 'pipe', timeout: 120000 }).toString();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, logs: out }));
          } catch (err: any) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, logs: err.stdout?.toString() || err.message }));
          }
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // POST /api/opencode/start - Start opencode web for a workspace/repo
    if (req.method === 'POST' && pathname === '/api/opencode/start') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { workspace, prompt } = JSON.parse(body);
          const wsDir = workspace || workspaceDir;
          const { spawn } = require('child_process');
          const port = 4096 + Math.floor(Math.random() * 1000);
          const args = ['web', '--port', String(port), '--hostname', '127.0.0.1'];
          if (prompt) {
            args.push('--title', prompt.slice(0, 80));
          }
          const proc = spawn('opencode', args, {
            cwd: wsDir,
            detached: true,
            stdio: 'ignore',
          });
          proc.unref();
          await new Promise(r => setTimeout(r, 1500));
          const url = `http://127.0.0.1:${port}`;
          console.log(`[UI] Started opencode web on ${url} for workspace ${wsDir}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, url, message: `Opencode started on port ${port}` }));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // POST /api/opencode/stop - Stop an opencode session by PID
    if (req.method === 'POST' && pathname === '/api/opencode/stop') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { pid } = JSON.parse(body);
          const { execSync } = require('child_process');
          if (process.platform === 'win32') {
            execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
          } else {
            execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
          }
          console.log(`[UI] Stopped opencode session PID: ${pid}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // GET /api/opencode/sessions - Check for running opencode processes
    if (req.method === 'GET' && pathname === '/api/opencode/sessions') {
      try {
        const { execSync } = require('child_process');
        let sessions: any[] = [];
        try {
          if (process.platform === 'win32') {
            const output = execSync('tasklist /FI "IMAGENAME eq opencode.exe" /FO CSV /NH 2>nul || echo ""', { encoding: 'utf8' });
            const lines = output.split('\n').filter((l: string) => l.includes('opencode'));
            sessions = lines.map((line: string) => {
              const parts = line.split(',').map((p: string) => p.replace(/"/g, '').trim());
              return { name: parts[0], pid: parts[1], memory: parts[4] };
            });
          } else {
            const output = execSync('pgrep -f opencode 2>/dev/null || echo ""', { encoding: 'utf8' });
            const pids = output.trim().split('\n').filter(Boolean);
            sessions = pids.map((pid: string) => ({ name: 'opencode', pid: pid.trim(), memory: 'N/A' }));
          }
        } catch { /* no sessions */ }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sessions, count: sessions.length }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // Default Fallback
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
  });

  // Auto-kill any process on this port before starting
  try {
    const { execSync } = require('child_process');
    if (process.platform === 'win32') {
      const result = execSync(`netstat -ano | findstr ":${PORT}" | findstr "LISTENING"`, { encoding: 'utf8' }).trim();
      if (result) {
        const lines = result.split('\n');
        const pids = new Set<string>();
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid) pids.add(pid);
        }
        for (const pid of pids) {
          console.log(`[UI] Killing old process on port ${PORT} (PID: ${pid})`);
          execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
        }
      }
    } else {
      execSync(`lsof -ti:${PORT} | xargs kill -9 2>/dev/null || true`, { stdio: 'ignore' });
    }
  } catch {}

  server.listen(PORT, async () => {
    const url = `http://localhost:${PORT}`;
    console.log(`\n⚡ an5ORM Workspace Manager Dashboard running at ${url}`);
    console.log(`Press Ctrl+C to terminate the UI server.\n`);

    // Create tunnel if requested
    if (options?.tunnel) {
      try {
        const { startTunnel } = require('./tunnel');
        await startTunnel({
          port: PORT + 1,
          subdomain: options.subdomain,
        });
      } catch (err: any) {
        console.error(`\n❌ Failed to create Vercel tunnel: ${err.message}`);
        console.log('   Install Vercel CLI: npm i -g vercel\n');
      }
    }

    // Automatically open browser on startup
    const startCmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    exec(`${startCmd} ${url}`, (err) => {
      // Ignore opening errors in headless environments
    });
  });
}
