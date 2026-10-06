/**
 * One shared, passive pointer listener for every head that follows the cursor,
 * instead of one listener per head.
 */
export interface PointerPosition {
  x: number;
  y: number;
  /** performance.now() of the last move; 0 before any. */
  at: number;
}

const position: PointerPosition = { x: 0, y: 0, at: 0 };
let subscribers = 0;

function onMove(e: PointerEvent) {
  position.x = e.clientX;
  position.y = e.clientY;
  position.at = performance.now();
}

/** Starts tracking while at least one subscriber exists. Returns the unsubscribe. */
export function trackPointer(): () => void {
  if (typeof window === 'undefined') return () => {};
  if (subscribers++ === 0) window.addEventListener('pointermove', onMove, { passive: true });
  return () => {
    if (--subscribers === 0) window.removeEventListener('pointermove', onMove);
  };
}

export function pointer(): Readonly<PointerPosition> {
  return position;
}

/** Where a head centred at (cx, cy) should look to see the pointer: -1…1 on each axis. */
export function lookTowards(cx: number, cy: number, px: number, py: number): { look: number; lookY: number } {
  const dx = px - cx;
  const dy = py - cy;
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  return { look: clamp(dx / 300), lookY: clamp(dy / 300) };
}
