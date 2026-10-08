import { describe, expect, it } from 'vitest';
import { PROBLEM_REPORT_LOG_LIMIT, ProblemReportRequest, ProblemReportResponse } from './report';

const minimal = { app: { version: '0.4.0', flavor: 'release' }, system: { os: 'macOS 26.2' } };

describe('ProblemReportRequest', () => {
  it('fills in what the app left out', () => {
    expect(ProblemReportRequest.parse(minimal)).toEqual({
      kind: 'user',
      message: '',
      app: { version: '0.4.0', build: '', flavor: 'release' },
      system: { os: 'macOS 26.2', model: '' },
      diagnostics: {},
      log: '',
    });
  });

  it('keeps a full report, trimming the message', () => {
    const full = ProblemReportRequest.parse({
      kind: 'hang',
      message: '  It froze  ',
      app: { version: '0.4.0', build: '12', flavor: 'dev' },
      system: { os: 'macOS 26.2 (25C56)', model: 'Mac15,3' },
      diagnostics: { 'recorder.phase': 'recording' },
      log: 'a\nb',
    });
    expect(full.message).toBe('It froze');
    expect(full.kind).toBe('hang');
  });

  it('rejects what is too long or unknown', () => {
    const bad = (over: Record<string, unknown>) => ProblemReportRequest.safeParse({ ...minimal, ...over }).success;
    expect(bad({ message: 'x'.repeat(4001) })).toBe(false);
    expect(bad({ log: 'x'.repeat(PROBLEM_REPORT_LOG_LIMIT + 1) })).toBe(false);
    expect(bad({ log: 'x'.repeat(PROBLEM_REPORT_LOG_LIMIT) })).toBe(true);
    expect(bad({ kind: 'crash' })).toBe(false);
    expect(bad({ app: { version: '', flavor: 'release' } })).toBe(false);
    expect(bad({ app: { version: '1', flavor: 'beta' } })).toBe(false);
    expect(bad({ diagnostics: { k: 'x'.repeat(2001) } })).toBe(false);
  });

  it('takes at most 100 diagnostics', () => {
    const many = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, 'v']));
    expect(ProblemReportRequest.safeParse({ ...minimal, diagnostics: many(100) }).success).toBe(true);
    const over = ProblemReportRequest.safeParse({ ...minimal, diagnostics: many(101) });
    expect(over.success).toBe(false);
    expect(over.error?.issues[0].message).toBe('At most 100 diagnostics');
  });
});

describe('ProblemReportResponse', () => {
  it('is an id and a time', () => {
    expect(ProblemReportResponse.safeParse({ id: '33333333-3333-4333-8333-333333333333', receivedAt: '2026-10-08T18:00:00.000Z' }).success).toBe(true);
    expect(ProblemReportResponse.safeParse({ id: 'x', receivedAt: 'now' }).success).toBe(false);
  });
});
