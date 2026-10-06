import { vi } from 'vitest';

/** Just enough of Web Audio for the head voices: records what gets scheduled. */
export class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state: AudioContextState = 'suspended';
  currentTime = 0;
  destination = {};
  oscillators: FakeNode[] = [];
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  createGain = () => new FakeNode();
  createBiquadFilter = () => new FakeNode();
  createOscillator = () => {
    const osc = new FakeNode();
    this.oscillators.push(osc);
    return osc;
  };
}

const param = () => ({ value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), setTargetAtTime: vi.fn() });

export class FakeNode {
  type = '';
  gain = param();
  frequency = param();
  Q = param();
  onended: (() => void) | null = null;
  connect = vi.fn((next: FakeNode) => next);
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

export function installFakeAudio() {
  FakeAudioContext.instances = [];
  vi.stubGlobal('AudioContext', FakeAudioContext);
  return FakeAudioContext;
}
