import React from 'react';

interface ConsoleBoxProps {
  logs: string;
  isError?: boolean;
}

export const ConsoleBox: React.FC<ConsoleBoxProps> = ({ logs, isError = false }) => {
  if (!logs) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(logs).then(() => {
      alert('Logs copied to clipboard!');
    }).catch(err => {
      console.error('Failed to copy logs: ', err);
    });
  };

  return (
    <div className="console-box-wrapper" style={{ position: 'relative', marginTop: '8px' }}>
      <button 
        onClick={handleCopy}
        className="btn btn-icon btn-copy-console"
        style={{
          position: 'absolute',
          top: '8px',
          right: '8px',
          padding: '6px',
          background: 'rgba(255, 255, 255, 0.07)',
          borderRadius: '6px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          cursor: 'pointer',
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.2s ease'
        }}
        title="Copy Logs"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      </button>
      <pre className={`console-output ${isError ? 'error' : ''}`} style={{ paddingRight: '42px', margin: 0 }}>
        {logs}
      </pre>
    </div>
  );
};
