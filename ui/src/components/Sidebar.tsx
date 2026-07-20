import React from 'react';

export interface Repository {
  name: string;
  path: string;
  description: string;
  modifiedFiles?: string[];
}

interface SidebarProps {
  repos: Repository[];
  selectedRepo: Repository | null;
  onSelectRepo: (repo: Repository) => void;
  onRefreshAll: () => void;
  isRefreshing: boolean;
  isOpen?: boolean;
  onClose?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  repos,
  selectedRepo,
  onSelectRepo,
  onRefreshAll,
  isRefreshing,
  isOpen = false,
  onClose: _onClose
}) => {
  return (
    <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
      <div className="brand">
        <span className="logo">⚡</span>
        <div className="brand-name">
          <h1>an5ORM</h1>
          <span>Workspace Manager</span>
        </div>
      </div>
      
      <div className="sidebar-menu">
        <div className="menu-label">REPOSITORIES</div>
        <ul className="repo-list">
          {repos.length === 0 ? (
            <li className="loading-placeholder">No repositories found</li>
          ) : (
            repos.map(repo => {
              const isDirty = repo.modifiedFiles && repo.modifiedFiles.length > 0;
              const statusText = isDirty ? `${repo.modifiedFiles?.length} changes` : 'clean';
              const statusClass = isDirty ? 'dirty' : 'clean';
              const isActive = selectedRepo?.name === repo.name;

              return (
                <li
                  key={repo.name}
                  className={`repo-item ${isActive ? 'active' : ''}`}
                  onClick={() => onSelectRepo(repo)}
                >
                  <div className="repo-item-meta">
                    <span className="repo-item-name">{repo.name}</span>
                    <span className={`badge ${statusClass}`}>{statusText}</span>
                  </div>
                  <span className="repo-item-desc">{repo.description || 'No description'}</span>
                </li>
              );
            })
          )}
        </ul>
      </div>

      <div className="sidebar-footer">
        <button
          className={`btn btn-secondary ${isRefreshing ? 'loading' : ''}`}
          onClick={onRefreshAll}
          disabled={isRefreshing}
        >
          {isRefreshing ? 'Refreshing...' : '↻ Refresh All'}
        </button>
      </div>
    </aside>
  );
};
