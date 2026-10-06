'use client';

import { useCallback, useEffect, useState } from 'react';

export interface Microphone {
  id: string;
  label: string;
}

const STORAGE_KEY = 'bt.micId';

function readSaved(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

async function listMicrophones(): Promise<Microphone[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.label)
    .map((d) => ({ id: d.deviceId, label: d.label }));
}

/**
 * The microphones the browser can record from, and the one picked for /record
 * (remembered in this browser). Labels only appear once the site has microphone
 * permission, so the list is refreshed when devices change and after recording.
 * An empty `selected` means the system default.
 */
export function useMicrophones() {
  const [microphones, setMicrophones] = useState<Microphone[]>([]);
  const [selected, setSelected] = useState('');

  const apply = useCallback((mics: Microphone[]) => {
    setMicrophones(mics);
    setSelected((current) => {
      const wanted = current || readSaved();
      return mics.some((m) => m.id === wanted) ? wanted : '';
    });
  }, []);

  const refresh = useCallback(() => listMicrophones().then(apply), [apply]);

  useEffect(() => {
    let alive = true;
    const load = () => {
      void listMicrophones().then((mics) => {
        if (alive) apply(mics);
      });
    };
    load();
    const md = navigator.mediaDevices;
    md?.addEventListener?.('devicechange', load);
    return () => {
      alive = false;
      md?.removeEventListener?.('devicechange', load);
    };
  }, [apply]);

  const choose = useCallback((id: string) => {
    setSelected(id);
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Private mode: the choice just isn't remembered.
    }
  }, []);

  return { microphones, selected, choose, refresh };
}
