import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';
import { ErrorNote } from './ErrorNote';
import { RouteError } from './RouteError';
import { SpeakerChip, speakerColor } from './SpeakerChip';
import { StatusChip } from './StatusChip';
import { Switch } from './Switch';

describe('StatusChip', () => {
  it.each([
    ['transcribing', 'Transcribing'],
    ['ready', 'Ready'],
    ['failed', 'Failed'],
  ] as const)('%s', (status, label) => {
    const { container } = render(<StatusChip status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute('data-status', status);
  });
});

describe('Switch', () => {
  it('is a switch that flips', () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Email me" />);
    const sw = screen.getByRole('switch', { name: 'Email me' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('ConfirmDialog', () => {
  it('opens in the page, confirms and cancels', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(
      <ConfirmDialog open title="Delete it?" confirmLabel="Delete" onConfirm={onConfirm} onCancel={onCancel} error="Nope">
        Gone for good.
      </ConfirmDialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Delete it?' });
    expect(dialog).toHaveAttribute('open');
    expect(screen.getByRole('alert')).toHaveTextContent('Nope');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent(dialog, new Event('cancel'));
    fireEvent.click(dialog);
    expect(onCancel).toHaveBeenCalledTimes(3);
    rerender(<ConfirmDialog open={false} title="Delete it?" confirmLabel="Delete" onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByRole('dialog', { hidden: true })).not.toHaveAttribute('open');
  });

  it('blocks closing while busy', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog open busy title="t" confirmLabel="Go" onConfirm={vi.fn()} onCancel={onCancel} />);
    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled();
    fireEvent(screen.getByRole('dialog'), new Event('cancel'));
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe('small pieces', () => {
  it('ErrorNote offers a retry', () => {
    const retry = vi.fn();
    render(<ErrorNote onRetry={retry}>Broke</ErrorNote>);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
  });

  it('SpeakerChip shows the name and a stable colour', () => {
    render(<SpeakerChip name="Speaker 2" size="md" />);
    expect(screen.getByText('Speaker 2')).toBeInTheDocument();
    expect(speakerColor('You')).toBe('#ff853d');
  });

  it('RouteError logs and retries', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const retry = vi.fn();
    render(<RouteError error={new Error('kaput')} retry={retry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('kaput');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
    expect(err).toHaveBeenCalled();
  });
});
