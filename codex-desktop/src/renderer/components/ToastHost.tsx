import React from 'react';

export type ToastKind = 'info' | 'success' | 'error';

export type Toast = {
  id: string;
  message: string;
  kind: ToastKind;
  actionLabel?: string;
  onAction?: () => void;
};

type Props = {
  toasts: Toast[];
  onDismiss: (id: string) => void;
};

export function ToastHost({ toasts, onDismiss }: Props) {
  return (
    <div className="toastHost" aria-live="polite" aria-relevant="additions removals">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role="status">
          <div className="toastMessage">{t.message}</div>
          <div className="toastActions">
            {t.actionLabel && t.onAction ? (
              <button
                className="toastButton"
                onClick={() => {
                  try {
                    t.onAction?.();
                  } finally {
                    onDismiss(t.id);
                  }
                }}
              >
                {t.actionLabel}
              </button>
            ) : null}
            <button className="toastClose" onClick={() => onDismiss(t.id)} aria-label="Dismiss">
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

