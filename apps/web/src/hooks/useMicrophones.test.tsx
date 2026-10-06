import { act, renderHook, waitFor } from '@testing-library/react';
import { useMicrophones } from './useMicrophones';

const device = (deviceId: string, label: string, kind: MediaDeviceKind = 'audioinput') =>
  ({ deviceId, label, kind, groupId: 'g', toJSON: () => ({}) }) as MediaDeviceInfo;

let devices: MediaDeviceInfo[] = [];
const listeners = new Set<() => void>();

beforeEach(() => {
  localStorage.clear();
  listeners.clear();
  devices = [
    device('default', 'Default - Headset'),
    device('built-in', 'MacBook Air Microphone'),
    device('headset', 'MAJOR IV (Bluetooth)'),
    device('speakers', 'MacBook Air Speakers', 'audiooutput'),
  ];
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      enumerateDevices: vi.fn(async () => devices),
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    },
  });
});

describe('useMicrophones', () => {
  it('lists named microphones, without the default alias or outputs', async () => {
    const { result } = renderHook(() => useMicrophones());
    await waitFor(() => expect(result.current.microphones).toHaveLength(2));
    expect(result.current.microphones).toEqual([
      { id: 'built-in', label: 'MacBook Air Microphone' },
      { id: 'headset', label: 'MAJOR IV (Bluetooth)' },
    ]);
    expect(result.current.selected).toBe('');
  });

  it('remembers the choice and forgets a microphone that went away', async () => {
    const { result, unmount } = renderHook(() => useMicrophones());
    await waitFor(() => expect(result.current.microphones).toHaveLength(2));
    act(() => result.current.choose('built-in'));
    expect(localStorage.getItem('bt.micId')).toBe('built-in');
    unmount();

    const again = renderHook(() => useMicrophones());
    await waitFor(() => expect(again.result.current.selected).toBe('built-in'));

    devices = devices.filter((d) => d.deviceId !== 'built-in');
    await act(async () => listeners.forEach((fn) => fn()));
    await waitFor(() => expect(again.result.current.selected).toBe(''));
    act(() => again.result.current.choose(''));
    expect(localStorage.getItem('bt.micId')).toBeNull();
  });

  it('shows nothing before permission (no labels)', async () => {
    devices = [device('a', ''), device('b', '')];
    const { result } = renderHook(() => useMicrophones());
    await waitFor(() => expect(navigator.mediaDevices.enumerateDevices).toHaveBeenCalled());
    expect(result.current.microphones).toEqual([]);
  });
});
