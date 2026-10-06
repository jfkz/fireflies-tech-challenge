'use client';

export function Switch({ checked, onChange, label, disabled, id }: { checked: boolean; onChange(next: boolean): void; label: string; disabled?: boolean; id?: string }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border-[2.5px] border-ink transition-colors disabled:opacity-50 ${checked ? 'bg-mint' : 'bg-paper'}`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full border-2 border-ink bg-white shadow-[1px_2px_0_0_var(--color-ink)] transition-transform ${checked ? 'translate-x-7' : 'translate-x-1'}`}
      />
    </button>
  );
}
