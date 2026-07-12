import React from 'react';
import type { Repository } from './Sidebar';

interface DiffViewerProps {
  repo: Repository;
  selectedFile: string | null;
  onSelectFile: (file: string | null) => void;
  diff: string;
  onCopy: () => void;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({
  repo,
  selectedFile,
  onSelectFile,
  diff,
  onCopy
}) => {
  const renderLines = () => {
    if (!diff) return <code>Select a repository with changes to view the git diff.</code>;
    const lines = diff.split('\n');
    return lines.map((line, idx) => {
      let className = '';
      if (line.startsWith('+') && !line.startsWith('+++')) {
        className = 'diff-add';
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        className = 'diff-remove';
      } else if (line.startsWith('@@') || line.startsWith('diff --git')) {
        className = 'diff-header-line';
      }
      return (
        <span key={idx} className={className} style={{ display: 'block' }}>
          {line + '\n'}
        </span>
      );
    });
  };

  return (
    <section className="panel left-panel">
      <div className="panel-header">
        <h3>Modified Files</h3>
        <span className="count-badge">{repo.modifiedFiles?.length || 0}</span>
      </div>
      <div className="panel-body">
        <ul className="files-list">
          <li
            className={`file-tag ${selectedFile === null ? 'active' : ''}`}
            onClick={() => onSelectFile(null)}
          >
            <span>All Changes</span>
          </li>
          {repo.modifiedFiles?.map(file => {
            let statusClass = 'modified';
            if (file.startsWith('A ')) statusClass = 'added';
            if (file.startsWith('D ')) statusClass = 'deleted';
            const fileName = file.replace(/^[MADRU?\s]{1,2}\s+/, '');
            const isActive = selectedFile === fileName;

            return (
              <li
                key={file}
                className={`file-tag ${isActive ? 'active' : ''}`}
                onClick={() => onSelectFile(fileName)}
              >
                <span className={`file-status ${statusClass}`}></span>
                <span>{fileName}</span>
              </li>
            );
          })}
        </ul>

        <div className="diff-viewer-container">
          <div className="diff-header">
            <h4>Git Diff Preview</h4>
            <button className="btn btn-icon" onClick={onCopy} title="Copy Diff">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
          </div>
          <pre className="diff-view">
            <code>{renderLines()}</code>
          </pre>
        </div>
      </div>
    </section>
  );
};
