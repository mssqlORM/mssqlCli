import React from 'react';
import type { Repository } from './Sidebar';

interface TopbarProps {
  selectedRepo: Repository | null;
  onPull: () => void;
  onOpenSettings: () => void;
  isPulling: boolean;
}

export const Topbar: React.FC<TopbarProps> = ({
  selectedRepo,
  onPull,
  onOpenSettings,
  isPulling
}) => {
  const isDirty = selectedRepo?.modifiedFiles && selectedRepo.modifiedFiles.length > 0;

  return (
    <header className="topbar">
      <div className="repo-info-header">
        <h2>{selectedRepo ? selectedRepo.name : 'Select a Repository'}</h2>
        <span className="repo-path">
          {selectedRepo ? selectedRepo.path : 'No repository selected'}
        </span>
      </div>
      <div className="topbar-actions">
        {selectedRepo && (
          <button
            className={`btn btn-secondary ${isPulling ? 'loading' : ''}`}
            onClick={onPull}
            disabled={isPulling}
            title="Pull Latest Changes"
            style={{ padding: '6px 12px', fontSize: '12px', borderRadius: '8px' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 5v14M19 12l-7 7-7-7" />
            </svg>
            Pull
          </button>
        )}
        {selectedRepo && (
          <span className={`badge ${isDirty ? 'dirty' : 'clean'}`}>
            {isDirty ? 'Modified' : 'Clean'}
          </span>
        )}
        <button
          className="btn btn-icon"
          onClick={onOpenSettings}
          title="LLM Configuration"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </header>
  );
};
