/**
 * Gibberish voices for the landing page's talking heads ("animalese"): every
 * letter of a speech bubble becomes a short pitched blip, timed to match the
 * bubble's typing speed so sound, mouth and text move together.
 *
 * The schedule is pure data (unit tested); `VoiceEngine` turns it into Web Audio.
 */

/** Characters per second, the same pace `TypeLine` types at. */
export const SPEECH_CPS = 32;

export interface Voice {
  /** Base pitch in Hz. */
  pitch: number;
  wave: OscillatorType;
  /** Centre of the band-pass "mouth" filter, as a multiple of the pitch. */
  formant: number;
}

export interface Blip {
  /** Seconds from the start of the line. */
  at: number;
  dur: number;
  freq: number;
  /** 0…1, how loud and how wide the mouth opens. */
  level: number;
}

const VOICES: readonly Voice[] = [
  { pitch: 250, wave: 'triangle', formant: 4.2 },
  { pitch: 150, wave: 'sawtooth', formant: 3.2 },
  { pitch: 118, wave: 'square', formant: 3.6 },
  { pitch: 290, wave: 'square', formant: 3.4 },
  { pitch: 200, wave: 'triangle', formant: 4.8 },
  { pitch: 175, wave: 'sawtooth', formant: 2.8 },
];

/** A stable voice per head, picked from its seed. */
export function voiceFor(seed: number): Voice {
  return VOICES[Math.abs(Math.round(seed)) % VOICES.length];
}

const VOWELS = new Set('aeiouy');
// Letters spread over about half an octave, so words get a melody of their own.
const STEPS = [0, 2, 4, 5, 7, 9, 3, 6];

/**
 * The blips for one line. Each character takes 1/`cps` seconds: letters blip,
 * spaces rest, punctuation pauses a bit longer, and a question rises at the end.
 */
export function blipSchedule(text: string, voice: Voice, cps = SPEECH_CPS): Blip[] {
  const step = 1 / cps;
  const blips: Blip[] = [];
  const question = text.trim().endsWith('?');
  const letters = [...text.toLowerCase()].filter((c) => /\p{L}|\d/u.test(c)).length;
  let seen = 0;
  [...text.toLowerCase()].forEach((c, i) => {
    if (!/\p{L}|\d/u.test(c)) return;
    seen++;
    const vowel = VOWELS.has(c);
    const semis = STEPS[(c.codePointAt(0) ?? 0) % STEPS.length];
    // The last few letters of a question go up; of a statement, settle down.
    const tail = Math.max(0, seen - (letters - 4)) / 4;
    const bend = question ? 1 + tail * 0.35 : 1 - tail * 0.08;
    blips.push({
      at: i * step,
      dur: step * (vowel ? 0.95 : 0.6),
      freq: voice.pitch * Math.pow(2, semis / 12) * bend,
      level: vowel ? 1 : 0.55,
    });
  });
  return blips;
}

/** How long a line lasts, in seconds. */
export function lineDuration(text: string, cps = SPEECH_CPS): number {
  return text.length / cps;
}

/**
 * Mouth opening `t` seconds into a schedule. A letter holds the mouth for its
 * whole character slot (the head animates at ~30 fps, slower than the blips),
 * so it only closes on spaces, punctuation and after the end.
 */
export function mouthAt(blips: readonly Blip[], t: number, cps = SPEECH_CPS): number {
  const slot = 1 / cps;
  for (const b of blips) {
    if (t < b.at) return 0;
    if (t < b.at + slot) return b.level;
  }
  return 0;
}

/** A line being spoken: when it started (performance.now() ms) and its blips. */
export interface Utterance {
  startedAt: number;
  blips: readonly Blip[];
  end: number;
  stop: () => void;
}

/** At most this many heads speak at once; the oldest is cut off. */
export const MAX_VOICES = 2;

/**
 * Plays schedules through one shared AudioContext. The context is only created
 * from a user gesture (turning sound on), as browsers require.
 */
export class VoiceEngine {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private playing: Utterance[] = [];

  /** Creates or resumes the audio context. Call from a click or key handler. */
  unlock(): boolean {
    const Ctor = typeof window === 'undefined' ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!Ctor) return false;
    if (!this.ctx) {
      this.ctx = new Ctor();
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.18;
      this.out.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return true;
  }

  get ready(): boolean {
    return this.ctx?.state === 'running';
  }

  /** Schedules `blips` now. Returns null when audio isn't available. */
  speak(blips: readonly Blip[], voice: Voice): Utterance | null {
    const ctx = this.ctx;
    const out = this.out;
    if (!ctx || !out || ctx.state !== 'running' || blips.length === 0) return null;
    while (this.playing.length >= MAX_VOICES) this.playing.shift()?.stop();

    const t0 = ctx.currentTime + 0.02;
    const bus = ctx.createGain();
    bus.connect(out);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.4;
    filter.frequency.value = voice.pitch * voice.formant;
    filter.connect(bus);

    const oscs: OscillatorNode[] = [];
    for (const b of blips) {
      const osc = ctx.createOscillator();
      osc.type = voice.wave;
      osc.frequency.setValueAtTime(b.freq, t0 + b.at);
      osc.frequency.linearRampToValueAtTime(b.freq * 0.94, t0 + b.at + b.dur);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t0 + b.at);
      env.gain.linearRampToValueAtTime(b.level, t0 + b.at + 0.006);
      env.gain.exponentialRampToValueAtTime(0.001, t0 + b.at + b.dur);
      osc.connect(env).connect(filter);
      osc.start(t0 + b.at);
      osc.stop(t0 + b.at + b.dur + 0.02);
      oscs.push(osc);
    }

    const last = blips[blips.length - 1];
    const utterance: Utterance = {
      startedAt: performance.now() + 20,
      blips,
      end: last.at + last.dur,
      stop: () => {
        bus.gain.setTargetAtTime(0, ctx.currentTime, 0.015);
        for (const o of oscs) {
          try {
            o.stop(ctx.currentTime + 0.06);
          } catch {
            // Already stopped.
          }
        }
        this.playing = this.playing.filter((u) => u !== utterance);
      },
    };
    this.playing.push(utterance);
    oscs[oscs.length - 1].onended = () => {
      this.playing = this.playing.filter((u) => u !== utterance);
      bus.disconnect();
    };
    return utterance;
  }

  /** Silences everyone, e.g. when sound is switched off. */
  hush(): void {
    for (const u of [...this.playing]) u.stop();
    this.playing = [];
  }
}
