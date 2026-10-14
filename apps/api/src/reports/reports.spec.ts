import { ProblemReportRequest } from '@boringtalks/shared';
import type { Database } from '../db/db.module';
import { formatReport, formatReportLine, parseReportsArgs, runReports } from '../reports';
import { createTestDb } from '../testing/pglite';
import { testConfig, user } from '../testing/fixtures';
import { DevicesRepository } from '../devices/devices.repository';
import { UsersRepository } from '../users/users.repository';
import { decodeCursor, encodeCursor } from '../common/cursor';
import { AdminReportsController, ReportsController } from './reports.controller';
import { ReportsRepository, type ReportListItem } from './reports.repository';
import { ReportsService } from './reports.service';

const body = (over: Record<string, unknown> = {}) =>
  ProblemReportRequest.parse({
    message: 'The menu froze after I unplugged my headphones',
    app: { version: '0.4.0', build: '1', flavor: 'release' },
    system: { os: 'macOS 26.2 (25C56)', model: 'Mac15,3' },
    diagnostics: { 'recorder.phase': 'recording' },
    log: 'line 1\nline 2',
    ...over,
  });

describe('ReportsRepository', () => {
  let db: Database;
  let close: () => Promise<void>;
  let repo: ReportsRepository;
  let ann: string;
  let bob: string;
  let device: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    const users = new UsersRepository(db);
    ann = (await users.insertIfAbsent({ firebaseUid: 'fb-ann', email: 'Ann@Example.com', name: 'Ann' }))!.id;
    bob = (await users.insertIfAbsent({ firebaseUid: 'fb-bob', email: 'bob@example.com', name: 'Bob' }))!.id;
    device = (await new DevicesRepository(db).insertDevice({ userId: ann, name: 'MacBook', tokenHash: 'h' })).id;
    repo = new ReportsRepository(db);
  }, 30_000);

  afterAll(() => close());

  it('stores reports and lists them newest first, without their logs', async () => {
    const first = await repo.insert({ userId: ann, deviceId: device, kind: 'hang', appVersion: '0.4.0', flavor: 'release', os: 'macOS', log: 'héllo' });
    await repo.insert({ userId: bob, kind: 'user', message: 'Bob here', appVersion: '0.4.0', flavor: 'dev', os: 'macOS' });
    expect(first).toMatchObject({ message: '', appBuild: '', model: '', diagnostics: {}, deviceId: device });

    const all = await repo.list();
    expect(all.map((r) => r.email)).toEqual(['bob@example.com', 'Ann@Example.com']);
    expect(all[1]).toMatchObject({ logBytes: 6 });
    expect(all[1]).not.toHaveProperty('log');

    expect((await repo.list({ user: 'ann@example.com' })).map((r) => r.userId)).toEqual([ann]);
    expect((await repo.list({ user: bob })).map((r) => r.userId)).toEqual([bob]);
    expect(await repo.list({ limit: 1 })).toHaveLength(1);

    expect(await repo.findById(first.id)).toMatchObject({ email: 'Ann@Example.com', report: { log: 'héllo' } });
    expect(await repo.findById('00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('narrows to a kind and continues after a report', async () => {
    expect((await repo.list({ kind: 'hang' })).map((r) => r.kind)).toEqual(['hang']);
    const [newest, ...older] = await repo.list();
    const after = await repo.list({ before: { startedAt: newest.createdAt, id: newest.id } });
    expect(after.map((r) => r.id)).toEqual(older.map((r) => r.id));
    expect(await repo.list({ before: { startedAt: new Date('2000-01-01T00:00:00Z'), id: newest.id } })).toEqual([]);
  });
});

describe('ReportsService', () => {
  const stored = { id: '33333333-3333-4333-8333-333333333333', kind: 'user', appVersion: '0.4.0', flavor: 'release', log: 'x', createdAt: new Date('2026-10-08T18:00:00Z') };

  function setup(env: Record<string, string> = {}) {
    const reports = { insert: vi.fn().mockResolvedValue(stored) };
    const jobs = { email: vi.fn() };
    return { reports, jobs, service: new ReportsService(testConfig(env), reports as never, jobs as never) };
  }

  it('keeps the report and answers with its id', async () => {
    const t = setup();
    await expect(t.service.create(user(), 'd-1', body())).resolves.toEqual({ id: stored.id, receivedAt: '2026-10-08T18:00:00.000Z' });
    expect(t.reports.insert).toHaveBeenCalledWith({
      userId: user().id,
      deviceId: 'd-1',
      kind: 'user',
      message: 'The menu froze after I unplugged my headphones',
      appVersion: '0.4.0',
      appBuild: '1',
      flavor: 'release',
      os: 'macOS 26.2 (25C56)',
      model: 'Mac15,3',
      diagnostics: { 'recorder.phase': 'recording' },
      log: 'line 1\nline 2',
    });
    expect(t.jobs.email).not.toHaveBeenCalled();
  });

  it('tells the operator only when REPORTS_NOTIFY_EMAIL is set', async () => {
    const t = setup({ REPORTS_NOTIFY_EMAIL: 'ops@example.com' });
    await t.service.create(user(), null, body());
    expect(t.jobs.email).toHaveBeenCalledWith({ type: 'problem-report', userId: user().id, reportId: stored.id });
    expect(testConfig({ REPORTS_NOTIFY_EMAIL: '' }).env.REPORTS_NOTIFY_EMAIL).toBeUndefined();
  });

  it('pages every report for admins, newest first', async () => {
    const t = setup();
    const row = (id: string, at: string): ReportListItem => ({
      id,
      userId: user().id,
      deviceId: null,
      kind: 'hang',
      message: 'Froze',
      appVersion: '0.5.0',
      appBuild: '3',
      flavor: 'release',
      os: 'Windows 11',
      model: '',
      createdAt: new Date(at),
      email: 'ann@example.com',
      logBytes: 4,
    });
    const list = vi.fn().mockResolvedValue([row('33333333-3333-4333-8333-333333333331', '2026-10-09T10:00:00Z'), row('33333333-3333-4333-8333-333333333332', '2026-10-08T10:00:00Z')]);
    const service = new ReportsService(testConfig(), { list } as never, t.jobs as never);

    const page = await service.list({ kind: 'hang', user: 'ann@example.com', limit: 1 });
    expect(list).toHaveBeenCalledWith({ user: 'ann@example.com', kind: 'hang', before: null, limit: 2 });
    expect(page.items).toEqual([
      {
        id: '33333333-3333-4333-8333-333333333331',
        kind: 'hang',
        message: 'Froze',
        user: { id: user().id, email: 'ann@example.com' },
        deviceId: null,
        app: { version: '0.5.0', build: '3', flavor: 'release' },
        system: { os: 'Windows 11', model: '' },
        logBytes: 4,
        createdAt: '2026-10-09T10:00:00.000Z',
      },
    ]);
    expect(decodeCursor(page.nextCursor!)).toEqual({ startedAt: new Date('2026-10-09T10:00:00Z'), id: '33333333-3333-4333-8333-333333333331' });

    const cursor = encodeCursor({ startedAt: new Date('2026-10-09T10:00:00Z'), id: '33333333-3333-4333-8333-333333333331' });
    await expect(service.list({ cursor, limit: 2 })).resolves.toMatchObject({ nextCursor: null });
    expect(list).toHaveBeenLastCalledWith({ before: { startedAt: new Date('2026-10-09T10:00:00Z'), id: '33333333-3333-4333-8333-333333333331' }, limit: 3 });
    await expect(service.list({ cursor: 'nope', limit: 2 })).rejects.toThrow();
  });

  it('shows one report in full, or 404', async () => {
    const t = setup();
    const findById = vi.fn().mockResolvedValue(null);
    const service = new ReportsService(testConfig(), { findById } as never, t.jobs as never);
    await expect(service.get(stored.id)).rejects.toThrow('Report not found');
    findById.mockResolvedValue({
      email: null,
      report: { ...stored, userId: user().id, deviceId: 'd-1', message: '', appBuild: '', os: 'macOS', model: '', diagnostics: { a: 'b' }, log: 'héllo' },
    });
    await expect(service.get(stored.id)).resolves.toMatchObject({
      id: stored.id,
      user: { id: user().id, email: null },
      deviceId: 'd-1',
      diagnostics: { a: 'b' },
      log: 'héllo',
      logBytes: 6,
      createdAt: '2026-10-08T18:00:00.000Z',
    });
  });

  it('is what the admin controller calls', async () => {
    const service = { list: vi.fn().mockResolvedValue({ items: [], nextCursor: null }), get: vi.fn().mockResolvedValue({ id: 'r' }) };
    const controller = new AdminReportsController(service as never);
    await expect(controller.list({ limit: 50 })).resolves.toEqual({ items: [], nextCursor: null });
    await expect(controller.get('r')).resolves.toEqual({ id: 'r' });
    expect(service.get).toHaveBeenCalledWith('r');
  });

  it('is what the controller calls', async () => {
    const service = { create: vi.fn().mockResolvedValue({ id: 'r' }) };
    await expect(new ReportsController(service as never).create(user(), 'd', body())).resolves.toEqual({ id: 'r' });
    expect(service.create).toHaveBeenCalledWith(user(), 'd', body());
  });
});

describe('reports CLI', () => {
  const item = (over: Partial<ReportListItem> = {}): ReportListItem => ({
    id: '33333333-3333-4333-8333-333333333333',
    userId: user().id,
    deviceId: null,
    kind: 'hang',
    message: '',
    appVersion: '0.4.0',
    appBuild: '7',
    flavor: 'dev',
    os: 'macOS 26.2',
    model: 'Mac15,3',
    createdAt: new Date('2026-10-08T18:19:05Z'),
    email: 'ann@example.com',
    logBytes: 10,
    ...over,
  });

  it('reads its arguments', () => {
    expect(parseReportsArgs([])).toEqual({ limit: 20 });
    expect(parseReportsArgs(['--user', 'ann@example.com', '--limit', '5'])).toEqual({ user: 'ann@example.com', limit: 5 });
    expect(parseReportsArgs(['--limit', 'x', 'abc'])).toEqual({ limit: 20, id: 'abc' });
  });

  it('lists one line per report', () => {
    expect(formatReportLine(item())).toBe('33333333-3333-4333-8333-333333333333  2026-10-08 18:19  ann@example.com  hang  0.4.0 dev  (no message)');
    const long = formatReportLine(item({ email: null, flavor: 'release', kind: 'user', message: `${'a'.repeat(100)}\nsecond line` }));
    expect(long).toContain(`${user().id}  user  0.4.0  ${'a'.repeat(79)}…`);
  });

  it('prints one report in full', () => {
    const out = formatReport({
      email: null,
      report: { ...item({ deviceId: 'd-1', message: 'It froze' }), diagnostics: { 'mic.device': 'AirPods' }, log: 'last line' },
    });
    expect(out).toContain('From     (no email) (user 11111111-1111-4111-8111-111111111111, device d-1)');
    expect(out).toContain('App      BoringTalks 0.4.0 dev (7)');
    expect(out).toContain('System   macOS 26.2, Mac15,3');
    expect(out).toContain('It froze');
    expect(out).toContain('mic.device: AirPods');
    expect(out).toMatch(/── Log\nlast line\n$/);
    const bare = formatReport({ email: 'a@b.c', report: { ...item({ appBuild: '', flavor: 'release', model: '' }), diagnostics: {}, log: '' } });
    expect(bare).toContain('App      BoringTalks 0.4.0\n');
    expect(bare).toContain('(no message)');
    expect(bare).toContain('(empty)');
  });

  it('lists, shows one, or says what is wrong', async () => {
    const repo = { list: vi.fn().mockResolvedValue([item()]), findById: vi.fn().mockResolvedValue(null) };
    expect(await runReports(repo, { limit: 20, user: 'ann@example.com' })).toContain('ann@example.com  hang');
    expect(repo.list).toHaveBeenCalledWith({ user: 'ann@example.com', limit: 20 });
    repo.list.mockResolvedValue([]);
    expect(await runReports(repo, { limit: 20 })).toBe('No reports\n');
    await expect(runReports(repo, { limit: 20, id: 'nope' })).rejects.toThrow('Not a report id: nope');
    await expect(runReports(repo, { limit: 20, id: item().id })).rejects.toThrow(`No report ${item().id}`);
    repo.findById.mockResolvedValue({ email: 'a@b.c', report: { ...item(), diagnostics: {}, log: '' } });
    expect(await runReports(repo, { limit: 20, id: item().id })).toContain(`Report   ${item().id}`);
  });
});
