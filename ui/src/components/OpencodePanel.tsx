import { useState, useEffect } from 'react';
import { OperationStep } from './OperationStep';

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) || '';
function api(path: string) { return `${API_BASE}${path}`; }

interface OpencodeSession {
  name: string;
  pid: string;
  memory?: string;
  url?: string;
}

interface OpencodePanelProps {
  workspace: string;
  onToast?: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export function OpencodePanel({ workspace, onToast }: OpencodePanelProps) {
  const [sessions, setSessions] = useState<OpencodeSession[]>([]);
  const [starting, setStarting] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [showPrompt, setShowPrompt] = useState(false);

  const loadSessions = async () => {
    try {
      const res = await fetch(api('/api/opencode/sessions'));
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch {
      // silent
    }
  };

  useEffect(() => {
    loadSessions();
    const t = setInterval(loadSessions, 5000);
    return () => clearInterval(t);
  }, []);

  const handleStart = async (customPrompt?: string) => {
    setStarting(true);
    try {
      const body: any = { workspace };
      if (customPrompt) body.prompt = customPrompt;
      const res = await fetch(api('/api/opencode/start'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success && data.url) {
        onToast?.('Opencode started!', 'success');
        window.open(data.url, '_blank');
        setPrompt('');
        setShowPrompt(false);
        setTimeout(loadSessions, 2000);
      } else {
        onToast?.(data.error || 'Failed to start opencode', 'error');
      }
    } catch {
      onToast?.('Connection error', 'error');
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async (pid: string) => {
    try {
      const res = await fetch(api('/api/opencode/stop'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pid }),
      });
      const data = await res.json();
      if (data.success) {
        onToast?.('Session stopped', 'info');
        setTimeout(loadSessions, 1000);
      } else {
        onToast?.(data.error || 'Failed to stop', 'error');
      }
    } catch {
      onToast?.('Connection error', 'error');
    }
  };

  const quickActions = [
    { label: 'Review Code', prompt: 'Review the code changes in this repository. Look for bugs, security issues, and improvements.' },
    { label: 'Fix Issues', prompt: 'Find and fix all issues in the codebase. Check for type errors, lint issues, and potential bugs.' },
    { label: 'Generate Tests', prompt: 'Generate comprehensive tests for the code in this repository.' },
    { label: 'Refactor', prompt: 'Analyze the codebase and suggest refactoring opportunities to improve code quality.' },
  ];

  return (
    <OperationStep stepNumber={0} title="Opencode" subtitle={sessions.length > 0 ? `${sessions.length} active` : 'AI assistant'} defaultOpen={true} badge={sessions.length > 0 ? String(sessions.length) : undefined}>
      {/* Quick Actions */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
        {quickActions.map(action => (
          <button
            key={action.label}
            className="btn btn-secondary"
            style={{ fontSize: '11px', padding: '6px 12px' }}
            onClick={() => handleStart(action.prompt)}
            disabled={starting}
          >
            🤖 {action.label}
          </button>
        ))}
        <button
          className="btn btn-accent"
          style={{ fontSize: '11px', padding: '6px 12px' }}
          onClick={() => setShowPrompt(!showPrompt)}
        >
          {showPrompt ? '✕ Cancel' : '✏️ Custom'}
        </button>
      </div>

      {/* Custom Prompt */}
      {showPrompt && (
        <div style={{ marginBottom: '12px' }}>
          <textarea
            style={{
              width: '100%', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)',
              borderRadius: '8px', padding: '10px', color: 'var(--color-text-main)',
              fontSize: '12px', fontFamily: 'var(--font-mono)', resize: 'vertical', minHeight: '60px'
            }}
            placeholder="Enter custom instructions for opencode..."
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
          />
          <button
            className="btn btn-accent"
            style={{ fontSize: '12px', padding: '6px 16px', marginTop: '8px' }}
            onClick={() => handleStart(prompt)}
            disabled={starting || !prompt.trim()}
          >
            {starting ? '⏳ Starting...' : '🚀 Launch Opencode'}
          </button>
        </div>
      )}

      {/* Start Button (default) */}
      {!showPrompt && (
        <button
          className="btn btn-accent"
          style={{ fontSize: '12px', padding: '6px 16px', marginBottom: '12px' }}
          onClick={() => handleStart()}
          disabled={starting}
        >
          {starting ? '⏳ Starting...' : '🤖 Open Opencode'}
        </button>
      )}

      {/* Active Sessions */}
      {sessions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)' }}>Active Sessions</div>
          {sessions.map(s => (
            <div key={s.pid} style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)',
              borderRadius: '8px', padding: '10px 14px'
            }}>
              <span className="spinner" style={{ width: '10px', height: '10px', flexShrink: 0 }} />
              <span style={{ fontSize: '12px', flex: 1 }}>
                opencode (PID: {s.pid})
              </span>
              <button
                className="btn btn-secondary"
                style={{ fontSize: '10px', padding: '4px 8px' }}
                onClick={() => handleStop(s.pid)}
              >
                ✕ Stop
              </button>
            </div>
          ))}
        </div>
      )}
    </OperationStep>
  );
}
