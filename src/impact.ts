// impact.ts — Cross-repo impact analysis and diff-based doc generation

import fs from 'fs';
import path from 'path';
import { execFileSync, execSync } from 'child_process';

// ─── Dependency Graph ──────────────────────────────────────────────
// Maps each repo to the repos it EXPORTS to (downstream consumers).
// When repo X changes, all repos in DEPENDS_ON[X] are affected.
const DEPENDS_ON: Record<string, string[]> = {
  an5Schema:     ['an5Orm', 'an5Agent', 'an5OrmVScode'],
  an5Orm:        ['an5Client', 'an5Adapters', 'an5Agent', 'an5Cli'],
  an5Client:     ['an5Adapters', 'an5Agent'],
  an5Adapters:   ['an5Agent'],
  an5Agent:      ['an5Cli'],
  an5Tasks:      ['an5Cli'],
  an5Cli:        [],
  an5OrmVScode:  [],
};

// What type of impact each changed component triggers
const COMPONENT_IMPACT: Record<string, string[]> = {
  'generator':  ['regenerate-client', 'rebuild-adapters', 'rebuild-agent'],
  'client':     ['regenerate-client', 'rebuild-adapters', 'rebuild-agent'],
  'schema':     ['update-docs', 'rebuild-orm', 'rebuild-agent'],
  'build':      ['rebuild-all'],
  'docs':       ['update-docs'],
  'misc':       ['update-docs'],
  'ci':         [],
};

export interface ImpactResult {
  sourceRepo: string;
  changedFiles: string[];
  components: string[];
  affectedRepos: {
    name: string;
    reason: string;
    actions: string[];
  }[];
}

export interface DocUpdate {
  repo: string;
  file: string;
  action: 'improve' | 'generate';
  reason: string;
}

// ─── Helpers ───────────────────────────────────────────────────────
function git(args: string[], cwd: string, allowFail = false): string {
  try {
    return execFileSync('git', args, { encoding: 'utf8', cwd }).trim();
  } catch (error: any) {
    if (allowFail) return error.stdout?.toString()?.trim() || '';
    throw error;
  }
}

function inferComponent(file: string): string {
  const normalized = file.replace(/\\/g, '/').toLowerCase();
  if (normalized.includes('/generator/')) return 'generator';
  if (normalized.includes('/an5client/')) return 'client';
  if (normalized.includes('/an5schema/')) return 'schema';
  if (normalized.includes('/.github/')) return 'ci';
  if (normalized.includes('package.json') || normalized.includes('tsconfig')) return 'build';
  if (normalized.includes('.md')) return 'docs';
  return 'misc';
}

function getChangedFiles(repoPath: string): string[] {
  git(['update-index', '--refresh'], repoPath, true);
  const status = git(['status', '--porcelain'], repoPath);
  const files: string[] = [];
  for (const line of status.split('\n')) {
    const match = line.match(/^([ MADRCU?!]{1,2})\s+(.*)$/);
    if (match) files.push(match[2].trim());
  }
  return files;
}

function getDiffFiles(repoPath: string): string[] {
  const diff = git(['diff', '--name-only', 'HEAD'], repoPath, true);
  return diff ? diff.split('\n').filter(Boolean) : [];
}

// ─── Core Impact Analysis ──────────────────────────────────────────
export function analyzeImpact(sourceRepoPath: string): ImpactResult {
  const repoName = path.basename(sourceRepoPath);
  const changedFiles = [
    ...getChangedFiles(sourceRepoPath),
    ...getDiffFiles(sourceRepoPath),
  ];

  // Deduplicate
  const uniqueFiles = [...new Set(changedFiles)];

  // Determine which components changed
  const components = [...new Set(uniqueFiles.map(inferComponent))];

  // Find affected repos
  const affectedRepos: ImpactResult['affectedRepos'] = [];
  const directDownstream = DEPENDS_ON[repoName] || [];

  for (const downstream of directDownstream) {
    const reasons: string[] = [];
    const actions: string[] = [];

    for (const component of components) {
      const componentActions = COMPONENT_IMPACT[component] || [];
      if (componentActions.length > 0) {
        reasons.push(`${component} changed`);
        actions.push(...componentActions);
      }
    }

    if (reasons.length === 0) {
      reasons.push('direct dependency');
      actions.push('rebuild');
    }

    affectedRepos.push({
      name: downstream,
      reason: reasons.join(', '),
      actions: [...new Set(actions)],
    });
  }

  return {
    sourceRepo: repoName,
    changedFiles: uniqueFiles,
    components,
    affectedRepos,
  };
}

// ─── Diff-Based Documentation Updates ──────────────────────────────
export function analyzeDocUpdates(repoPath: string): DocUpdate[] {
  const repoName = path.basename(repoPath);
  const changedFiles = [
    ...getChangedFiles(repoPath),
    ...getDiffFiles(repoPath),
  ];
  const uniqueFiles = [...new Set(changedFiles)];
  const updates: DocUpdate[] = [];

  for (const file of uniqueFiles) {
    const ext = path.extname(file).toLowerCase();
    const basename = path.basename(file);
    const dirname = path.dirname(file);

    if (ext === '.md') {
      // Markdown files — improve existing
      updates.push({
        repo: repoName,
        file,
        action: 'improve',
        reason: 'Documentation file changed',
      });
    } else if (ext === '.ts' || ext === '.js' || ext === '.py' || ext === '.cs') {
      // Source files — check if docs exist nearby
      const docName = basename.replace(/\.[^.]+$/, '.md');
      const docPath = path.join(repoPath, dirname, docName);
      const readmePath = path.join(repoPath, dirname, 'README.md');

      if (fs.existsSync(docPath)) {
        updates.push({
          repo: repoName,
          file: path.join(dirname, docName),
          action: 'improve',
          reason: `Source ${basename} was modified`,
        });
      } else if (fs.existsSync(readmePath)) {
        updates.push({
          repo: repoName,
          file: path.join(dirname, 'README.md'),
          action: 'improve',
          reason: `Source ${basename} was modified`,
        });
      } else {
        updates.push({
          repo: repoName,
          file: path.join(dirname, docName),
          action: 'generate',
          reason: `New documentation for modified ${basename}`,
        });
      }
    }
  }

  // Always check if repo-level docs need updating
  const hasSourceChanges = uniqueFiles.some(f => {
    const ext = path.extname(f).toLowerCase();
    return ext === '.ts' || ext === '.js' || ext === '.py' || ext === '.cs';
  });

  if (hasSourceChanges) {
    const readmePath = 'README.md';
    if (fs.existsSync(path.join(repoPath, readmePath))) {
      const existing = updates.find(u => u.file === readmePath);
      if (!existing) {
        updates.push({
          repo: repoName,
          file: readmePath,
          action: 'improve',
          reason: 'Source code changed — review repo docs',
        });
      }
    }
  }

  return updates;
}

// ─── Full Sync Plan ────────────────────────────────────────────────
export interface SyncPlan {
  impact: ImpactResult;
  docUpdates: DocUpdate[];
  buildOrder: string[];
  estimatedSteps: number;
}

export function buildSyncPlan(sourceRepoPath: string): SyncPlan {
  const impact = analyzeImpact(sourceRepoPath);
  const docUpdates = analyzeDocUpdates(sourceRepoPath);

  // Topological sort for build order
  const visited = new Set<string>();
  const order: string[] = [];
  const repoName = path.basename(sourceRepoPath);

  function visit(name: string) {
    if (visited.has(name)) return;
    visited.add(name);
    const downstream = DEPENDS_ON[name] || [];
    for (const d of downstream) visit(d);
    order.push(name);
  }

  visit(repoName);

  return {
    impact,
    docUpdates,
    buildOrder: order,
    estimatedSteps: order.length + docUpdates.length,
  };
}

// ─── Execute Sync ──────────────────────────────────────────────────
export interface SyncResult {
  repo: string;
  step: string;
  success: boolean;
  output: string;
}

export async function executeSync(
  sourceRepoPath: string,
  options: { dryRun?: boolean; skipDocs?: boolean; skipBuild?: boolean; skipPrompt?: boolean } = {},
): Promise<SyncResult[]> {
  const plan = buildSyncPlan(sourceRepoPath);
  const results: SyncResult[] = [];
  const workspaceDir = path.resolve(sourceRepoPath, '..');

  console.log(`\n📊 Impact Analysis for ${plan.impact.sourceRepo}`);
  console.log(`  Changed files: ${plan.impact.changedFiles.length}`);
  console.log(`  Components: ${plan.impact.components.join(', ')}`);
  console.log(`  Affected repos: ${plan.impact.affectedRepos.length}`);
  for (const affected of plan.impact.affectedRepos) {
    console.log(`    → ${affected.name}: ${affected.reason}`);
  }

  if (!options.skipDocs && plan.docUpdates.length > 0) {
    console.log(`\n📝 Documentation updates: ${plan.docUpdates.length}`);
    for (const update of plan.docUpdates) {
      console.log(`    ${update.action === 'improve' ? '✏️' : '🆕'} ${update.repo}/${update.file} (${update.reason})`);
    }
  }

  if (options.dryRun) {
    console.log(`\n[DRY RUN] Would execute ${plan.estimatedSteps} steps`);
    console.log(`  Build order: ${plan.buildOrder.join(' → ')}`);
    return results;
  }

  // 1. Build affected repos in topological order
  if (!options.skipBuild) {
    console.log(`\n🔨 Building affected repos...`);
    for (const repoName of plan.buildOrder) {
      if (repoName === plan.impact.sourceRepo) continue; // skip source
      const repoPath = repoName === 'an5-workspace'
        ? workspaceDir
        : path.join(workspaceDir, repoName);

      if (!fs.existsSync(path.join(repoPath, 'package.json'))) continue;

      console.log(`\n  📦 ${repoName}`);
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(repoPath, 'package.json'), 'utf8'));
        const scripts = pkg.scripts || {};

        if (scripts.build) {
          console.log(`    ↳ npm run build...`);
          execSync('npm run build', { cwd: repoPath, stdio: 'pipe' });
          console.log(`    ✓ Build passed`);
          results.push({ repo: repoName, step: 'build', success: true, output: 'Build passed' });
        }

        if (scripts.test) {
          console.log(`    ↳ npm test...`);
          execSync('npm test', { cwd: repoPath, stdio: 'pipe' });
          console.log(`    ✓ Tests passed`);
          results.push({ repo: repoName, step: 'test', success: true, output: 'Tests passed' });
        }
      } catch (err: any) {
        const output = err.stdout?.toString() || err.message;
        console.error(`    ❌ Failed: ${output.slice(0, 200)}`);
        results.push({ repo: repoName, step: 'build/test', success: false, output });
      }
    }
  }

  // 2. Update documentation
  if (!options.skipDocs) {
    console.log(`\n📝 Updating documentation...`);
    const { generateDocumentation, improveDocumentation } = require('./llm');

    for (const update of plan.docUpdates) {
      const filePath = path.join(workspaceDir, update.repo, update.file);
      if (!fs.existsSync(filePath)) continue;

      console.log(`  ${update.action === 'improve' ? '✏️' : '🆕'} ${update.repo}/${update.file}`);

      try {
        const content = fs.readFileSync(filePath, 'utf8');
        let result: string | null = null;

        if (update.action === 'improve' && content.trim()) {
          result = await improveDocumentation(content, path.basename(filePath));
        } else if (update.action === 'generate') {
          result = await generateDocumentation(content, path.basename(filePath));
        }

        if (result) {
          fs.writeFileSync(filePath, result);
          console.log(`    ✓ Updated`);
          results.push({ repo: update.repo, step: `doc:${update.file}`, success: true, output: 'Updated' });
        }
      } catch (err: any) {
        console.error(`    ❌ Failed: ${err.message}`);
        results.push({ repo: update.repo, step: `doc:${update.file}`, success: false, output: err.message });
      }
    }
  }

  return results;
}
