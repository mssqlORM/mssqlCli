import { useState, useEffect } from 'react';
import { OperationStep } from './OperationStep';
import { ConsoleBox } from './ConsoleBox';
import { OpencodePanel } from './OpencodePanel';
import type { Repository } from './Sidebar';

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) || '';

function api(path: string) {
  return `${API_BASE}${path}`;
}

interface Task {
  id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  status: 'todo' | 'in-progress' | 'done';
  file?: string;
  createdAt: string;
}

interface RepoAction {
  id: string;
  label: string;
  icon: string;
  variant: 'primary' | 'accent' | 'success' | 'danger';
  endpoint: string;
  confirm?: string;
}

interface RepoActionsConfig {
  [repoName: string]: RepoAction[];
}

const REPO_ACTIONS: RepoActionsConfig = {
  mssqlOrm: [
    { id: 'generate', label: 'Generate', icon: '⚙️', variant: 'accent', endpoint: '/api/repo/run', confirm: 'Run code generator?' },
    { id: 'db:push', label: 'DB Push', icon: '⬆️', variant: 'primary', endpoint: '/api/repo/run', confirm: 'Push schema to database?' },
    { id: 'db:pull', label: 'DB Pull', icon: '⬇️', variant: 'primary', endpoint: '/api/repo/run', confirm: 'Pull schema from database?' },
    { id: 'db:seed', label: 'DB Seed', icon: '🌱', variant: 'success', endpoint: '/api/repo/run', confirm: 'Seed database?' },
    { id: 'db:cleanup', label: 'DB Cleanup', icon: '🧹', variant: 'danger', endpoint: '/api/repo/run', confirm: 'Cleanup database?' },
    { id: 'db:migrate', label: 'DB Migrate', icon: '🔄', variant: 'accent', endpoint: '/api/repo/run', confirm: 'Run migration?' },
  ],
  mssqlAgent: [
    { id: 'rag:index', label: 'RAG Index', icon: '🔍', variant: 'accent', endpoint: '/api/repo/run' },
  ],
  mssqlSchema: [
    { id: 'validate', label: 'Validate Schemas', icon: '✅', variant: 'success', endpoint: '/api/repo/run' },
  ],
};

const COMMON_ACTIONS: RepoAction[] = [
  { id: 'build', label: 'Build', icon: '🔨', variant: 'primary', endpoint: '/api/repo/build' },
  { id: 'test', label: 'Test', icon: '🧪', variant: 'accent', endpoint: '/api/repo/test' },
];

interface RepoDashboardProps {
  repo: Repository;
  onToast?: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export function RepoDashboard({ repo, onToast }: RepoDashboardProps) {
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<{ id: string; success: boolean; output: string } | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [openingTask, setOpeningTask] = useState<string | null>(null);
  const [opencodeSessions, setOpencodeSessions] = useState<number>(0);

  // Pull state
  const [pullLoading, setPullLoading] = useState(false);

  // Review state
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewResult, setReviewResult] = useState('');
  const [reviewOutput, setReviewOutput] = useState('');

  // Release state
  const [commitMsg, setCommitMsg] = useState('');
  const [isMsgGenerating, setIsMsgGenerating] = useState(false);
  const [pushRemote, setPushRemote] = useState(false);
  const [releaseLoading, setReleaseLoading] = useState(false);
  const [releaseResult, setReleaseResult] = useState('');
  const [releaseConsole, setReleaseConsole] = useState('');
  const [releaseSuccess, setReleaseSuccess] = useState<boolean | null>(null);

  const repoActions = REPO_ACTIONS[repo.name] || [];
  const allActions = [...repoActions, ...COMMON_ACTIONS];

  const loadTasks = async () => {
    setTasksLoading(true);
    try {
      const res = await fetch(api(`/api/tasks?workspace=${encodeURIComponent(repo.path)}`));
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch {
      setTasks([]);
    } finally {
      setTasksLoading(false);
    }
  };

  const checkOpencodeSessions = async () => {
    try {
      const res = await fetch(api('/api/opencode/sessions'));
      const data = await res.json();
      setOpencodeSessions(data.count || 0);
    } catch {
      setOpencodeSessions(0);
    }
  };

  useEffect(() => { loadTasks(); checkOpencodeSessions(); }, [repo.path]);
  useEffect(() => { const t = setInterval(checkOpencodeSessions, 5000); return () => clearInterval(t); }, []);

  const handleRunAction = async (action: RepoAction) => {
    if (action.confirm && !confirm(action.confirm)) return;
    setRunningAction(action.id);
    setActionResult(null);
    try {
      const res = await fetch(api(action.endpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: repo.name, script: action.id }),
      });
      const data = await res.json();
      setActionResult({ id: action.id, success: data.success, output: data.logs || data.output || (data.success ? 'Done!' : 'Failed') });
      onToast?.(`${action.label}: ${data.success ? 'Success' : 'Failed'}`, data.success ? 'success' : 'error');
    } catch {
      setActionResult({ id: action.id, success: false, output: 'Connection error' });
      onToast?.(`${action.label}: Connection error`, 'error');
    } finally {
      setRunningAction(null);
    }
  };

  const handleOpenInOpencode = async (task: Task) => {
    setOpeningTask(task.id);
    try {
      const prompt = `Fix the following issue:\n\n**Task:** ${task.title}\n**Description:** ${task.description}\n${task.file ? `**File:** ${task.file}` : ''}\n\nAnalyze the codebase and fix this issue. When done, update tasks.json.`;
      const res = await fetch(api('/api/opencode/start'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace: repo.path, prompt }),
      });
      const data = await res.json();
      if (data.success && data.url) {
        onToast?.('Opencode started', 'success');
        window.open(data.url, '_blank');
      } else {
        onToast?.(data.error || 'Failed to start opencode', 'error');
      }
    } catch {
      onToast?.('Connection error', 'error');
    } finally {
      setOpeningTask(null);
    }
  };

  const handlePull = async () => {
    setPullLoading(true);
    try {
      const res = await fetch(api('/api/pull'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: repo.name }),
      });
      const data = await res.json();
      if (data.success) {
        onToast?.('Pull completed!', 'success');
      } else {
        onToast?.('Pull failed', 'error');
      }
    } catch {
      onToast?.('Connection error', 'error');
    } finally {
      setPullLoading(false);
    }
  };

  const handleRunReview = async () => {
    setReviewLoading(true);
    setReviewResult('Analyzing changes with LLM...');
    setReviewOutput('');
    try {
      const res = await fetch(api('/api/review'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: repo.name }),
      });
      const data = await res.json();
      if (data.success && data.review) {
        setReviewResult('Analysis complete!');
        setReviewOutput(data.review);
      } else {
        setReviewResult('Review failed.');
        setReviewOutput(data.error || 'Failed to communicate with LLM.');
      }
    } catch {
      setReviewResult('Request failed.');
    } finally {
      setReviewLoading(false);
    }
  };

  const handleGenerateMsg = async () => {
    setIsMsgGenerating(true);
    try {
      const res = await fetch(api('/api/commit-msg'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: repo.name }),
      });
      const data = await res.json();
      if (data.success && data.message) {
        setCommitMsg(data.message);
        onToast?.('Commit message generated!', 'success');
      } else {
        onToast?.('Failed to generate message', 'error');
      }
    } catch {
      onToast?.('Connection error', 'error');
    } finally {
      setIsMsgGenerating(false);
    }
  };

  const handleRelease = async () => {
    if (!commitMsg.trim()) {
      onToast?.('Enter a commit message first', 'info');
      return;
    }
    setReleaseLoading(true);
    setReleaseResult('Publishing release...');
    setReleaseConsole('');
    setReleaseSuccess(null);
    try {
      const res = await fetch(api('/api/release'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: repo.name, message: commitMsg, push: pushRemote }),
      });
      const data = await res.json();
      setReleaseConsole(data.logs || '');
      if (data.success) {
        setReleaseResult('Release published!');
        setReleaseSuccess(true);
        onToast?.('Release published!', 'success');
      } else {
        setReleaseResult('Release failed!');
        setReleaseSuccess(false);
      }
    } catch {
      setReleaseResult('Request failed.');
      setReleaseSuccess(false);
    } finally {
      setReleaseLoading(false);
    }
  };

  const stepOffset = allActions.length > 0 ? 1 : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Repo Info Card */}
      <div style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <span style={{ fontSize: '20px' }}>📦</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-text-main)' }}>{repo.name}</div>
            <div style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>{repo.description || 'No description'}</div>
          </div>
          <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
            <button className="btn btn-secondary" onClick={handlePull} disabled={pullLoading} style={{ fontSize: '11px', padding: '6px 12px' }}>
              {pullLoading ? '⏳' : '⬇️'} Pull
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '12px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
          <span>📁 {repo.path}</span>
          <span>•</span>
          <span style={{ color: repo.modifiedFiles?.length ? '#eab308' : '#22c55e' }}>
            {repo.modifiedFiles?.length ? `${repo.modifiedFiles.length} modified` : '✓ clean'}
          </span>
          {opencodeSessions > 0 && (
            <>
              <span>•</span>
              <span style={{ color: '#06b6d4', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span className="spinner" style={{ width: '10px', height: '10px' }} />
                opencode ({opencodeSessions})
              </span>
            </>
          )}
        </div>
      </div>

      {/* Opencode Panel */}
      <OpencodePanel workspace={repo.path} onToast={onToast} />

      {/* Actions Grid */}
      {allActions.length > 0 && (
        <OperationStep stepNumber={1} title="Actions" subtitle={`Run scripts for ${repo.name}`}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '8px' }}>
            {allActions.map(action => (
              <button
                key={action.id}
                className={`btn btn-${action.variant}`}
                onClick={() => handleRunAction(action)}
                disabled={runningAction !== null}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center', padding: '8px 10px', fontSize: '12px' }}
              >
                {runningAction === action.id ? <span className="spinner" style={{ width: '12px', height: '12px' }} /> : <span>{action.icon}</span>}
                <span>{action.label}</span>
              </button>
            ))}
          </div>
          {actionResult && (
            <div className="status-box" style={{ marginTop: '12px' }}>
              <div className="status-indicator">
                <span style={{ color: actionResult.success ? '#34d399' : '#ef4444' }}>
                  {actionResult.success ? '✓' : '✕'} {allActions.find(a => a.id === actionResult.id)?.label}
                </span>
              </div>
              <ConsoleBox logs={actionResult.output} isError={!actionResult.success} />
            </div>
          )}
        </OperationStep>
      )}

      {/* LLM Review */}
      <OperationStep stepNumber={stepOffset + 1} title="LLM Review" subtitle="AI code review" defaultOpen={false}>
        <button className={`btn btn-accent ${reviewLoading ? 'loading' : ''}`} onClick={handleRunReview} disabled={reviewLoading} style={{ marginBottom: '12px' }}>
          {reviewLoading ? 'Analyzing...' : '🔍 Generate Review'}
        </button>
        {reviewResult && (
          <div>
            <div style={{ fontSize: '12px', marginBottom: '8px', color: reviewOutput ? '#34d399' : '#ef4444' }}>{reviewResult}</div>
            {reviewOutput && (
              <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', overflowY: 'auto', maxHeight: '250px', fontSize: '12px', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
                {reviewOutput}
              </div>
            )}
          </div>
        )}
      </OperationStep>

      {/* Commit & Release */}
      <OperationStep stepNumber={stepOffset + 2} title="Commit & Release" subtitle="Commit and push changes" defaultOpen={!!repo.modifiedFiles && repo.modifiedFiles.length > 0}>
        <div style={{ marginBottom: '12px' }}>
          <label style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '4px', display: 'block' }}>Commit Message</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <textarea
              style={{ flex: 1, background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px 12px', color: 'var(--color-text-main)', fontSize: '12px', fontFamily: 'var(--font-mono)', resize: 'vertical', minHeight: '60px' }}
              placeholder="feat: add new feature"
              value={commitMsg}
              onChange={e => setCommitMsg(e.target.value)}
            />
            <button className="btn btn-secondary" onClick={handleGenerateMsg} disabled={isMsgGenerating} style={{ alignSelf: 'flex-start', padding: '8px' }} title="AI Generate">
              {isMsgGenerating ? '⏳' : '✨'}
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '12px' }}>
          <button className={`btn btn-success ${releaseLoading ? 'loading' : ''}`} onClick={handleRelease} disabled={releaseLoading}>
            🚀 Publish
          </button>
          <label style={{ fontSize: '12px', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <input type="checkbox" checked={pushRemote} onChange={e => setPushRemote(e.target.checked)} />
            Push to remote
          </label>
        </div>
        {releaseResult && (
          <div className="status-box">
            <div className="status-indicator">
              <span style={{ color: releaseSuccess === true ? '#34d399' : '#ef4444' }}>{releaseResult}</span>
            </div>
            <ConsoleBox logs={releaseConsole} isError={releaseSuccess === false} />
          </div>
        )}
      </OperationStep>

      {/* Tasks */}
      <OperationStep
        stepNumber={stepOffset + 3}
        title="Tasks"
        subtitle={tasksLoading ? 'Loading...' : `${tasks.length} task(s)`}
        badge={tasks.length > 0 ? `${tasks.length}` : undefined}
        defaultOpen={tasks.length > 0}
      >
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
          <button className="btn btn-secondary" onClick={loadTasks} disabled={tasksLoading} style={{ fontSize: '12px' }}>
            {tasksLoading ? 'Loading...' : '↻ Refresh'}
          </button>
          {tasks.filter(t => t.status !== 'done').length > 0 && (
            <button
              className="btn btn-accent"
              style={{ fontSize: '12px' }}
              onClick={async () => {
                for (const task of tasks.filter(t => t.status !== 'done')) {
                  await handleOpenInOpencode(task);
                }
              }}
              disabled={openingTask !== null}
            >
              🤖 Fix All ({tasks.filter(t => t.status !== 'done').length})
            </button>
          )}
        </div>
        {tasks.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {tasks.map(task => {
              const priorityColor = task.priority === 'high' ? '#ef4444' : task.priority === 'medium' ? '#eab308' : '#22c55e';
              const statusColor = task.status === 'done' ? '#22c55e' : task.status === 'in-progress' ? '#06b6d4' : '#6b7280';
              return (
                <div key={task.id} style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '10px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-main)', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</div>
                      <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.description}</div>
                      <div style={{ display: 'flex', gap: '8px', marginTop: '6px', alignItems: 'center' }}>
                        <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', background: `${priorityColor}20`, color: priorityColor, border: `1px solid ${priorityColor}40` }}>{task.priority}</span>
                        <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', background: `${statusColor}20`, color: statusColor, border: `1px solid ${statusColor}40` }}>{task.status}</span>
                        {task.file && <span style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>📁 {task.file}</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '4px', flexShrink: 0, alignItems: 'center' }}>
                      {task.status !== 'done' && (
                        <button
                          className={`btn ${openingTask === task.id ? 'btn-secondary' : 'btn-accent'}`}
                          style={{ fontSize: '11px', padding: '5px 10px', display: 'flex', alignItems: 'center', gap: '4px' }}
                          onClick={() => handleOpenInOpencode(task)}
                          disabled={openingTask === task.id}
                        >
                          {openingTask === task.id ? <><span className="spinner" style={{ width: '10px', height: '10px' }} /> Fixing...</> : <>🤖 Fix</>}
                        </button>
                      )}
                      {task.status === 'done' && <span style={{ fontSize: '11px', color: '#22c55e' }}>✓ Done</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', textAlign: 'center', padding: '16px' }}>No tasks for this repo.</div>
        )}
      </OperationStep>
    </div>
  );
}
