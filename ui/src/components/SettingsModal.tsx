import React, { useState, useEffect } from 'react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onToast?: (message: string, type: 'success' | 'error' | 'info') => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, onToast }) => {
  const [provider, setProvider] = useState('openai');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetch('/api/config')
        .then(res => res.json())
        .then(data => {
          setProvider(data.provider || 'openai');
          setApiKey('');
          setHasApiKey(!!data.apiKey);
          setModel(data.model || '');
          setEndpoint(data.endpoint || '');
        })
        .catch(err => console.error('Failed to load LLM config:', err));
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey: apiKey.trim(), model: model.trim(), endpoint: endpoint.trim() })
      });
      const data = await response.json();
      if (data.success) {
        onToast?.('LLM configuration saved!', 'success');
        onClose();
      } else {
        onToast?.('Failed to save: ' + (data.error || 'Unknown error'), 'error');
      }
    } catch (error) {
      onToast?.('Connection error', 'error');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>LLM Configuration</h3>
          <button className="btn-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="settings-provider">LLM Provider</label>
              <select
                id="settings-provider"
                className="form-control"
                value={provider}
                onChange={e => setProvider(e.target.value)}
              >
                <option value="openai">OpenAI</option>
                <option value="gemini">Gemini</option>
                <option value="custom">Custom (Local / Ollama)</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="settings-key">
                API Key
                {hasApiKey && <span style={{ color: '#34d399', marginLeft: '8px', fontSize: '11px' }}>✓ configured</span>}
              </label>
              <input
                type="password"
                id="settings-key"
                className="form-control"
                placeholder={hasApiKey ? '•••••••• (leave blank to keep)' : 'Enter API key'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label htmlFor="settings-model">Model Name</label>
              <input
                type="text"
                id="settings-model"
                className="form-control"
                placeholder="gpt-4o-mini / gemini-2.5-flash / llama3"
                value={model}
                onChange={e => setModel(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label htmlFor="settings-endpoint">Endpoint URL</label>
              <input
                type="text"
                id="settings-endpoint"
                className="form-control"
                placeholder="https://api.openai.com/v1 or http://localhost:11434/api/chat"
                value={endpoint}
                onChange={e => setEndpoint(e.target.value)}
              />
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save Settings</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
