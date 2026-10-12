'use client';

import { useSyncExternalStore } from 'react';
import { detectPlatform, type NavigatorLike, type Platform } from '@/lib/platform';

const noop = () => () => {};

/** The visitor's platform; `unknown` while rendering on the server, so hydration matches. */
export function usePlatform(): Platform | 'unknown' {
  return useSyncExternalStore(noop, () => detectPlatform(navigator as NavigatorLike), () => 'unknown');
}
