import { useState, useCallback, useEffect } from 'react';

export interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

let toastId = 0;

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = ++toastId;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }, []);

  return { toasts, addToast };
}

export function ToastContainer({ toasts }: { toasts: Toast[] }) {
  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      top: '16px',
      right: '16px',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      pointerEvents: 'none',
    }}>
      {toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const t = setTimeout(() => setVisible(false), 2700);
    return () => clearTimeout(t);
  }, []);

  const bg = toast.type === 'success' ? 'rgba(34,197,94,0.9)' : toast.type === 'error' ? 'rgba(239,68,68,0.9)' : 'rgba(59,130,246,0.9)';
  const icon = toast.type === 'success' ? '✓' : toast.type === 'error' ? '✕' : 'ℹ';

  return (
    <div style={{
      background: bg,
      color: '#fff',
      padding: '10px 16px',
      borderRadius: '8px',
      fontSize: '13px',
      fontWeight: 500,
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      transform: visible ? 'translateX(0)' : 'translateX(120%)',
      opacity: visible ? 1 : 0,
      transition: 'all 0.3s cubic-bezier(0.4,0,0.2,1)',
      pointerEvents: 'auto',
      minWidth: '200px',
      maxWidth: '400px',
    }}>
      <span style={{ fontWeight: 700, fontSize: '14px' }}>{icon}</span>
      <span>{toast.message}</span>
    </div>
  );
}
