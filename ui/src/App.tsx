import { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import type { Repository } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { DiffViewer } from './components/DiffViewer';
import { SettingsModal } from './components/SettingsModal';
import { ToastContainer, useToast } from './components/Toast';
import { RepoDashboard } from './components/RepoDashboard';

const API_BASE = import.meta.env.VITE_API_URL || '';

function api(path: string) {
  return `${API_BASE}${path}`;
}

interface TabState {
  repo: Repository;
  selectedFile: string | null;
  diff: string;
}

function createEmptyTab(repo: Repository): TabState {
  return {
    repo,
    selectedFile: null,
    diff: '',
  };
}

export default function App() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [openTabs, setOpenTabs] = useState<TabState[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState<number>(-1);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { toasts, addToast } = useToast();

  const activeTab = activeTabIndex >= 0 ? openTabs[activeTabIndex] : null;

  useEffect(() => { loadStatus(); }, []);

  // Close sidebar when selecting a repo on mobile
  const handleSelectRepo = (repo: Repository) => {
    setSidebarOpen(false);
    const existing = openTabs.findIndex(t => t.repo.name === repo.name);
    if (existing >= 0) {
      setActiveTabIndex(existing);
      return;
    }
    const tab = createEmptyTab(repo);
    setOpenTabs(prev => {
      const newTabs = [...prev, tab];
      const newIndex = newTabs.length - 1;
      setActiveTabIndex(newIndex);
      loadDiff(newIndex, repo.name, null);
      return newTabs;
    });
  };

  const loadStatus = async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch(api('/api/status'));
      const data = await res.json();
      const list = data.repos || [];
      setRepos(list);
      // Update open tabs with fresh repo data
      setOpenTabs(prev => prev.map(tab => {
        const updated = list.find((r: Repository) => r.name === tab.repo.name);
        return updated ? { ...tab, repo: updated } : tab;
      }));
    } catch (e) {
      console.error('Failed to load status:', e);
    } finally {
      setIsRefreshing(false);
    }
  };

  const updateTab = useCallback((index: number, patch: Partial<TabState>) => {
    setOpenTabs(prev => prev.map((tab, i) => i === index ? { ...tab, ...patch } : tab));
  }, []);

  const loadDiff = async (tabIndex: number, repoName: string, file: string | null) => {
    updateTab(tabIndex, { diff: 'Loading git diff...' });
    try {
      const res = await fetch(api(`/api/diff?repo=${encodeURIComponent(repoName)}` + (file ? `&file=${encodeURIComponent(file)}` : '')));
      const data = await res.json();
      updateTab(tabIndex, { diff: data.diff || 'No diff output or clean workspace.' });
    } catch {
      updateTab(tabIndex, { diff: 'Error loading git diff.' });
    }
  };

  const handleCloseTab = (index: number) => {
    setOpenTabs(prev => prev.filter((_, i) => i !== index));
    if (activeTabIndex >= openTabs.length - 1) {
      setActiveTabIndex(Math.min(activeTabIndex, openTabs.length - 2));
    } else if (index < activeTabIndex) {
      setActiveTabIndex(activeTabIndex - 1);
    } else if (index === activeTabIndex) {
      setActiveTabIndex(Math.min(index, openTabs.length - 2));
    }
  };

  const handleSelectFile = (file: string | null) => {
    if (!activeTab || activeTabIndex < 0) return;
    updateTab(activeTabIndex, { selectedFile: file });
    loadDiff(activeTabIndex, activeTab.repo.name, file);
  };

  const handlePull = async () => {
    if (!activeTab || activeTabIndex < 0) return;
    setIsPulling(true);
    try {
      const res = await fetch(api('/api/pull'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: activeTab.repo.name })
      });
      const data = await res.json();
      if (data.success) {
        addToast('Pull completed!', 'success');
        setTimeout(loadStatus, 1500);
      } else {
        addToast('Pull failed!', 'error');
      }
    } catch {
      addToast('Connection error', 'error');
    } finally {
      setIsPulling(false);
    }
  };

  const handleCopyDiff = () => {
    if (!activeTab) return;
    navigator.clipboard.writeText(activeTab.diff).then(() => addToast('Diff copied to clipboard!', 'success')).catch(() => addToast('Failed to copy', 'error'));
  };

  const t = activeTab; // shorthand

  return (
    <div className="app-container">
      {/* Mobile Header */}
      <div className="mobile-header" style={{ display: 'none' }}>
        <button className="mobile-menu-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>
          {sidebarOpen ? '✕' : '☰'}
        </button>
        <span className="mobile-title">an5ORM</span>
        <div className="mobile-header-actions">
          <button className="btn-icon" onClick={() => setIsSettingsOpen(true)} title="Settings">⚙️</button>
        </div>
      </div>

      {/* Sidebar backdrop for mobile */}
      <div 
        className={`sidebar-backdrop ${sidebarOpen ? 'visible' : ''}`} 
        onClick={() => setSidebarOpen(false)}
      />

      <Sidebar
        repos={repos}
        selectedRepo={activeTab?.repo || null}
        onSelectRepo={handleSelectRepo}
        onRefreshAll={loadStatus}
        isRefreshing={isRefreshing}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="main-content">
        {/* Tab Bar */}
        {openTabs.length > 0 && (
          <div className="tab-bar">
            {openTabs.map((tab, idx) => {
              const isDirty = tab.repo.modifiedFiles && tab.repo.modifiedFiles.length > 0;
              return (
                <div
                  key={tab.repo.name}
                  className={`tab-item ${idx === activeTabIndex ? 'active' : ''}`}
                  onClick={() => setActiveTabIndex(idx)}
                >
                  <span className="tab-name">{tab.repo.name}</span>
                  {isDirty && <span className="tab-dirty" />}
                  <button
                    className="tab-close"
                    onClick={(e) => { e.stopPropagation(); handleCloseTab(idx); }}
                    title="Close tab"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <Topbar
          selectedRepo={activeTab?.repo || null}
          onPull={handlePull}
          onOpenSettings={() => setIsSettingsOpen(true)}
          isPulling={isPulling}
        />

        {t ? (
          <div className="dashboard-grid">
            <DiffViewer
              repo={t.repo}
              selectedFile={t.selectedFile}
              onSelectFile={handleSelectFile}
              diff={t.diff}
              onCopy={handleCopyDiff}
            />

            <section className="panel right-panel">
              <RepoDashboard repo={t.repo} onToast={addToast} />
            </section>
          </div>
        ) : (
          <div className="welcome-view">
            <div className="welcome-card">
              <div className="welcome-icon">🚀</div>
              <h2>Welcome to Workspace Manager</h2>
              <p>Click a repository in the sidebar to open it as a tab. You can open multiple repos simultaneously.</p>
            </div>
          </div>
        )}
      </main>

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} onToast={addToast} />
      <ToastContainer toasts={toasts} />
    </div>
  );
}
