'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  busy?: boolean;
  error?: string | null;
  onConfirm(): void;
  onCancel(): void;
}

/** An in-page modal built on <dialog>: focus trap, Escape and backdrop come from the browser. */
export function ConfirmDialog({ open, title, children, confirmLabel, cancelLabel = 'Cancel', tone = 'danger', busy, error, onConfirm, onCancel }: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    } else if (!open && d.open) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      onClick={(e) => {
        // A click on the backdrop lands on the <dialog> itself.
        if (e.target === ref.current && !busy) onCancel();
      }}
      className="m-auto w-[min(92vw,440px)] rounded-[24px] border-[2.5px] border-ink bg-white p-0 text-ink shadow-[6px_7px_0_0_var(--color-ink)] backdrop:bg-dusk-deep/60"
    >
      <div className="p-6">
        <h2 id={titleId} className="font-display text-2xl leading-tight">
          {title}
        </h2>
        {children && <div className="mt-3 leading-relaxed font-semibold text-ink-soft">{children}</div>}
        {error && (
          <p role="alert" className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm font-bold text-danger">
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button type="button" className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy} autoFocus>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
