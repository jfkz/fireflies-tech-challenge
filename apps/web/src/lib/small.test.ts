import { describe, expect, it, vi } from 'vitest';
import { authErrorMessage, safeNext } from './auth-errors';
import { declinedCallbackUrl, isAppCallback, parseConnectParams } from './connect';
import { formatBytes, formatClock, formatMeetingDate } from './format';
import { summaryToMarkdown } from './markdown';
import { lookTowards } from './pointer';
import { isProcessing, meetingPollInterval, STATUS_LABEL, STATUS_QUIP } from './status';
import { meeting } from '@/test/utils';

const params = (q: string) => new URLSearchParams(q);
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

describe('connect params', () => {
  it('accepts a PKCE challenge and cleans the device name', () => {
    expect(parseConnectParams(params(`challenge=${CHALLENGE}&device=${encodeURIComponent('  Mike’s\tMac\u0007 ')}`))).toEqual({
      ok: true,
      challenge: CHALLENGE,
      deviceName: 'Mike’s Mac',
      app: 'release',
    });
  });
  it('tells BoringTalks Dev apart by app=dev', () => {
    expect(parseConnectParams(params(`challenge=${CHALLENGE}&app=dev`))).toMatchObject({ app: 'dev' });
    expect(parseConnectParams(params(`challenge=${CHALLENGE}&app=other`))).toMatchObject({ app: 'release' });
    expect(declinedCallbackUrl('dev')).toBe('boringtalks-dev://callback?error=access_denied');
    expect(declinedCallbackUrl()).toBe('boringtalks://callback?error=access_denied');
  });
  it('defaults the device name and caps its length', () => {
    expect(parseConnectParams(params(`challenge=${CHALLENGE}`))).toMatchObject({ deviceName: 'your Mac' });
    const long = parseConnectParams(params(`challenge=${CHALLENGE}&device=${'x'.repeat(200)}`));
    expect(long.ok && long.deviceName.length).toBe(80);
  });
  it('rejects missing and malformed challenges', () => {
    expect(parseConnectParams(params(''))).toEqual({ ok: false, reason: 'missing' });
    expect(parseConnectParams(params('challenge=%20'))).toEqual({ ok: false, reason: 'missing' });
    expect(parseConnectParams(params('challenge=short'))).toEqual({ ok: false, reason: 'invalid' });
    expect(parseConnectParams(params(`challenge=${CHALLENGE.slice(0, 40)}!!!`))).toEqual({ ok: false, reason: 'invalid' });
    expect(parseConnectParams(params(`challenge=${'a'.repeat(129)}`))).toEqual({ ok: false, reason: 'invalid' });
  });
  it('only lets the app callback through as a redirect', () => {
    expect(isAppCallback('boringtalks://callback?code=abc')).toBe(true);
    expect(isAppCallback('boringtalks://callback')).toBe(true);
    expect(isAppCallback('boringtalks-dev://callback?code=abc')).toBe(true);
    expect(isAppCallback('boringtalks-dev://elsewhere?code=abc')).toBe(false);
    expect(isAppCallback('https://evil.test/?boringtalks://callback')).toBe(false);
    expect(isAppCallback('javascript:alert(1)')).toBe(false);
  });
});

describe('status', () => {
  it('polls every 3 s only while processing', () => {
    for (const s of ['recording', 'uploaded', 'transcribing', 'summarizing'] as const) {
      expect(isProcessing(s)).toBe(true);
      expect(meetingPollInterval(s)).toBe(3000);
    }
    expect(meetingPollInterval('ready')).toBe(false);
    expect(meetingPollInterval('failed')).toBe(false);
    expect(meetingPollInterval(undefined)).toBe(false);
    expect(Object.keys(STATUS_LABEL)).toEqual(Object.keys(STATUS_QUIP));
  });
});

describe('auth errors', () => {
  it('maps Firebase codes to instructions', () => {
    expect(authErrorMessage({ code: 'auth/invalid-credential' })).toBe('Wrong email or password.');
    expect(authErrorMessage({ code: 'auth/email-already-in-use' })).toMatch(/Sign in instead/);
    expect(authErrorMessage({ code: 'auth/popup-closed-by-user' })).toMatch(/Google window/);
    for (const code of ['auth/invalid-email', 'auth/missing-password', 'auth/weak-password', 'auth/too-many-requests', 'auth/popup-blocked', 'auth/network-request-failed', 'auth/unauthorized-domain']) {
      expect(authErrorMessage({ code })).not.toMatch(/Something went wrong/);
    }
    expect(authErrorMessage(new Error('custom'))).toBe('custom');
    expect(authErrorMessage(null)).toBe('Something went wrong. Try again.');
  });
  it('only allows same-site next paths', () => {
    expect(safeNext('/connect?challenge=x')).toBe('/connect?challenge=x');
    expect(safeNext('https://evil.test')).toBe('/meetings');
    expect(safeNext('//evil.test')).toBe('/meetings');
    expect(safeNext('/\\evil.test')).toBe('/meetings');
    expect(safeNext(null, '/x')).toBe('/x');
  });
});

describe('format', () => {
  const now = new Date(2026, 9, 6, 15, 0);
  it('says Today / Yesterday / a date', () => {
    expect(formatMeetingDate(new Date(2026, 9, 6, 9, 5).toISOString(), now)).toMatch(/^Today, /);
    expect(formatMeetingDate(new Date(2026, 9, 5, 9, 5).toISOString(), now)).toMatch(/^Yesterday, /);
    expect(formatMeetingDate(new Date(2026, 8, 1, 9, 5).toISOString(), now)).not.toMatch(/2026/);
    expect(formatMeetingDate(new Date(2025, 8, 1, 9, 5).toISOString(), now)).toMatch(/2025/);
  });
  it('formats bytes and clocks', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(14.2 * 1024 * 1024)).toBe('14.2 MB');
    expect(formatBytes(200 * 1024 * 1024)).toBe('200 MB');
    expect(formatBytes(3 * 1024 ** 4)).toBe('3072 GB');
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(187.9)).toBe('3:07');
    expect(formatClock(3725)).toBe('1:02:05');
    expect(formatClock(-4)).toBe('0:00');
  });
});

describe('summaryToMarkdown', () => {
  it('writes every section', () => {
    const md = summaryToMarkdown(meeting());
    expect(md).toContain('# Pricing review: Pro to $29, launch Nov 3');
    expect(md).toContain('*Oct 1, 2026, 10:00 AM UTC, 31 min, You, Speaker 1*');
    expect(md).toContain('> Pro goes to $29.');
    expect(md).toContain('## Summary\n\nWe raised the price.\n\nAnnual stays.');
    expect(md).toContain('## Key topics\n\n- Pricing\n- Launch');
    expect(md).toContain('- [ ] Write the launch email (Maya, due Oct 30)');
    expect(md).toContain('- [x] Update the pricing page\n');
    expect(md).toContain('## Decisions\n\n- Pro is $29');
    expect(md.endsWith('\n')).toBe(true);
  });
  it('handles a meeting without a summary', () => {
    const md = summaryToMarkdown(meeting({ summary: null, description: null, speakers: [] }));
    expect(md).toBe('# Pricing review: Pro to $29, launch Nov 3\n\n*Oct 1, 2026, 10:00 AM UTC, 31 min*\n');
  });
  it('skips empty lists', () => {
    const m = meeting();
    const md = summaryToMarkdown({ ...m, summary: { ...m.summary!, keyTopics: [], actionItems: [], decisions: [] } });
    expect(md).not.toContain('## Key topics');
    expect(md).not.toContain('## Action items');
    expect(md).not.toContain('## Decisions');
  });
});

describe('pointer', () => {
  it('looks towards the pointer, clamped', () => {
    expect(lookTowards(100, 100, 100, 100)).toEqual({ look: 0, lookY: 0 });
    expect(lookTowards(100, 100, 250, 40)).toEqual({ look: 0.5, lookY: -0.2 });
    expect(lookTowards(0, 0, -5000, 5000)).toEqual({ look: -1, lookY: 1 });
  });
});

describe('lazyApi', () => {
  it('loads the client once, on the first call', async () => {
    const { lazyApi } = await import('./lazy-api');
    const me = vi.fn(async () => 'me');
    const load = vi.fn(async () => ({ me }) as never);
    const api = lazyApi(load);
    expect(load).not.toHaveBeenCalled();
    await expect(api.me()).resolves.toBe('me');
    await api.me();
    expect(load).toHaveBeenCalledTimes(1);
    expect(me).toHaveBeenCalledTimes(2);
  });
});
