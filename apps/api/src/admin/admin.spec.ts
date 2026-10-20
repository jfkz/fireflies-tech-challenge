import { ConflictException, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AppSettingsRepository } from '../app-settings/app-settings.repository';
import { AppSettingsService, minutesOf } from '../app-settings/app-settings.service';
import { decodeCursor } from '../common/cursor';
import type { Database } from '../db/db.module';
import { meetings as meetingsTable, users as usersTable, type UserRow } from '../db/schema';
import { DevicesRepository } from '../devices/devices.repository';
import { MeetingsRepository } from '../meetings/meetings.repository';
import { ReportsRepository } from '../reports/reports.repository';
import { testConfig } from '../testing/fixtures';
import { createTestDb } from '../testing/pglite';
import { UsersRepository } from '../users/users.repository';
import { AdminController } from './admin.controller';
import { AdminRepository } from './admin.repository';
import { addDays, AdminService, dailySeries, localDay } from './admin.service';

const NOW = new Date();
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe('AdminService on a database', () => {
  let db: Database;
  let close: () => Promise<void>;
  let service: AdminService;
  let settings: AppSettingsService;
  let boss: UserRow;
  let ann: UserRow;
  let bob: UserRow;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    const users = new UsersRepository(db);
    const meetings = new MeetingsRepository(db);
    const devices = new DevicesRepository(db);
    const reports = new ReportsRepository(db);
    boss = (await users.insertIfAbsent({ firebaseUid: 'fb-boss', email: 'Boss@Example.com', name: 'Boss' }))!;
    ann = (await users.insertIfAbsent({ firebaseUid: 'fb-ann', email: 'ann@example.com', name: 'Ann Lee' }))!;
    bob = (await users.insertIfAbsent({ firebaseUid: 'fb-bob', email: 'bob_1@example.com', name: 'Bob' }))!;
    // Ann joined 40 days ago and was active today; Bob joined today and never came back.
    await db.update(usersTable).set({ createdAt: daysAgo(40), lastActiveAt: NOW }).where(sql`${usersTable.id} = ${ann.id}`);
    await db.update(usersTable).set({ createdAt: daysAgo(60) }).where(sql`${usersTable.id} = ${boss.id}`);

    const win = await devices.insertDevice({ userId: ann.id, name: 'PC', tokenHash: 'a1' });
    await devices.touch(win.id, { platform: 'windows', version: '0.6.0' });
    const mac = await devices.insertDevice({ userId: ann.id, name: 'Mac', tokenHash: 'a2' });
    await devices.touch(mac.id, { platform: 'macos', version: '0.5.0' });
    const old = await devices.insertDevice({ userId: bob.id, name: 'Old PC', tokenHash: 'b1' });
    await devices.revoke(bob.id, old.id);

    const meeting = (userId: string, startedAt: Date, extra: Partial<typeof meetingsTable.$inferInsert> = {}) =>
      meetings.create({ userId, title: 'Secret title', status: 'ready', source: 'windows', startedAt, durationSec: 3600, ...extra });
    const m1 = await meeting(ann.id, daysAgo(1), { hasAudio: true, audioBytes: 2 * 1024 ** 3 });
    await meeting(ann.id, daysAgo(2), { source: 'browser', status: 'failed', durationSec: 1800, hasAudio: true, audioBytes: 1024 ** 3 });
    await meeting(ann.id, daysAgo(3), { source: 'macos', audioChannels: 'mic-system', hasAudio: true, durationSec: 1800 });
    await meeting(ann.id, daysAgo(90), { durationSec: 600 });
    await meeting(bob.id, daysAgo(1), { source: 'demo', durationSec: 900 });
    await meetings.saveSummary(m1.id, { summary: 's', keyTopics: [], decisions: [], model: 'm', inputTokens: 1_000_000, outputTokens: 200_000, actionItems: [] }, {});
    await reports.insert({ userId: ann.id, kind: 'hang', appVersion: '0.6.0', flavor: 'release', os: 'Windows 11' });
    await reports.insert({ userId: ann.id, kind: 'user', appVersion: '0.6.0', flavor: 'release', os: 'Windows 11' });

    settings = new AppSettingsService(new AppSettingsRepository(db));
    service = new AdminService(testConfig({ ADMIN_EMAILS: 'boss@example.com,ghost@example.com' }), new AdminRepository(db), settings, reports);
  }, 30_000);

  afterAll(() => close());

  it('sums usage across accounts, without demo meetings', async () => {
    const o = await service.overview({ days: 30, tz: 'UTC' }, NOW);
    expect(o.users).toEqual({ total: 3, new7d: 1, newInWindow: 1, active1d: 1, active7d: 1, active30d: 1, admins: 2 });
    expect(o.meetings).toMatchObject({ total: 4, totalHours: 2.2, inWindow: 3, hoursInWindow: 2, failureRate: 0.333 });
    expect(o.meetings.bySource).toEqual({ macos: 1, windows: 1, browser: 1, upload: 0, demo: 0 });
    expect(o.meetings.byStatus).toMatchObject({ ready: 2, failed: 1, recording: 0 });
    expect(o.devices.active30d).toBe(2);
    expect(o.devices.versions).toEqual(expect.arrayContaining([{ platform: 'windows', version: '0.6.0', count: 1 }, { platform: 'macos', version: '0.5.0', count: 1 }]));
    expect(o.reports).toEqual({ last7d: 2, hangs7d: 1 });
    // Browser: 0.5 h on one channel; Mac sent for online transcription: 0.5 h on two.
    expect(o.costs).toEqual({
      summaryInputTokens: 1_000_000,
      summaryOutputTokens: 200_000,
      summaryUsd: 2,
      serverTranscribedHours: 1.5,
      transcriptionUsd: 0.15,
      storageGb: 3,
      storageUsdPerMonth: 0.05,
    });
    expect(o.daily).toHaveLength(30);
    expect(o.daily.at(-1)?.date).toBe(localDay(NOW, 'UTC'));
    expect(o.daily.reduce((n, d) => n + d.meetings, 0)).toBe(3);
    expect(o.daily.reduce((n, d) => n + d.signups, 0)).toBe(1);
    await expect(service.overview({ days: 30, tz: 'Mars/Olympus' })).rejects.toThrow();
  });

  it('lists users newest first with their usage, finds them, and pages on', async () => {
    const page = await service.listUsers({ limit: 2 });
    expect(page.items.map((u) => u.email)).toEqual(['bob_1@example.com', 'ann@example.com']);
    const annRow = page.items[1];
    expect(annRow).toMatchObject({ meetingCount: 4, recordedMinutes: 130, isAdmin: false, isOwner: false, recordingLimitMinutes: null });
    expect(annRow.apps).toEqual(expect.arrayContaining([{ platform: 'windows', version: '0.6.0' }, { platform: 'macos', version: '0.5.0' }]));
    expect(page.items[0]).toMatchObject({ meetingCount: 0, lastMeetingAt: null, apps: [] });
    expect(decodeCursor(page.nextCursor!)?.id).toBe(ann.id);

    const next = await service.listUsers({ limit: 2, cursor: page.nextCursor! });
    expect(next).toMatchObject({ items: [{ email: 'Boss@Example.com', isOwner: true, isAdmin: true }], nextCursor: null });
    expect((await service.listUsers({ q: 'LEE', limit: 10 })).items.map((u) => u.id)).toEqual([ann.id]);
    // "_" is a letter here, not a wildcard.
    expect((await service.listUsers({ q: 'b_1', limit: 10 })).items.map((u) => u.id)).toEqual([bob.id]);
    expect((await service.listUsers({ q: 'bx1', limit: 10 })).items).toEqual([]);
    expect((await service.listUsers({ q: ann.id, limit: 10 })).items.map((u) => u.id)).toEqual([ann.id]);
    await expect(service.listUsers({ cursor: 'nope', limit: 10 })).rejects.toThrow();
  });

  it('shows one user: devices, meeting metadata without titles, reports, and the limit in force', async () => {
    const detail = await service.user(ann.id);
    expect(detail).toMatchObject({ effectiveRecordingLimitMinutes: 120, adminGrantedBy: null, last30d: { meetings: 3, recordedMinutes: 120, failed: 1 } });
    expect(detail.devices.map((d) => d.name).sort()).toEqual(['Mac', 'PC']);
    expect(detail.meetings).toHaveLength(4);
    expect(detail.meetings[0]).toEqual(expect.objectContaining({ source: 'windows', status: 'ready', durationSec: 3600, audioBytes: 2 * 1024 ** 3 }));
    expect(JSON.stringify(detail)).not.toContain('Secret title');
    expect(detail.reports.map((r) => r.kind).sort()).toEqual(['hang', 'user']);
    expect((await service.user(bob.id)).devices[0].revokedAt).not.toBeNull();
    await expect(service.user('00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('grants and removes admin rights, never an owner’s or your own', async () => {
    await expect(service.grantAdmin(boss, 'nobody@example.com')).rejects.toThrow('sign in to BoringTalks once first');
    const list = await service.grantAdmin(boss, 'ANN@example.com');
    expect(list.admins).toEqual([
      { id: boss.id, email: 'Boss@Example.com', name: 'Boss', isOwner: true },
      { id: null, email: 'ghost@example.com', name: null, isOwner: true },
      { id: ann.id, email: 'ann@example.com', name: 'Ann Lee', isOwner: false },
    ]);
    expect((await service.user(ann.id)).adminGrantedBy).toEqual({ id: boss.id, email: 'Boss@Example.com' });
    await service.grantAdmin(boss, 'ann@example.com');

    const annAdmin = { ...ann, isAdmin: true };
    await expect(service.updateUser(annAdmin, boss.id, { isAdmin: false })).rejects.toBeInstanceOf(ConflictException);
    await expect(service.updateUser(annAdmin, ann.id, { isAdmin: false })).rejects.toThrow('your own');
    await expect(service.updateUser(boss, '00000000-0000-4000-8000-000000000000', { isAdmin: true })).rejects.toBeInstanceOf(NotFoundException);
    expect(await service.updateUser(boss, ann.id, { isAdmin: false })).toMatchObject({ isAdmin: false });
    expect((await service.admins()).admins).toHaveLength(2);
  });

  it('sets a user’s own limit, and the global one', async () => {
    expect(await service.updateUser(boss, bob.id, { recordingLimitMinutes: 30 })).toMatchObject({ recordingLimitMinutes: 30, effectiveRecordingLimitMinutes: 30 });
    expect(await service.updateUser(boss, bob.id, { recordingLimitMinutes: 0 })).toMatchObject({ effectiveRecordingLimitMinutes: null });
    expect(await service.updateUser(boss, bob.id, { recordingLimitMinutes: null })).toMatchObject({ recordingLimitMinutes: null, effectiveRecordingLimitMinutes: 120 });

    expect(await service.getSettings()).toEqual({ recordingLimitMinutes: 120, updatedAt: null, updatedBy: null });
    expect(await service.updateSettings(boss, { recordingLimitMinutes: 90 })).toMatchObject({ recordingLimitMinutes: 90, updatedBy: 'Boss@Example.com' });
    expect((await service.user(bob.id)).effectiveRecordingLimitMinutes).toBe(90);
    // Another replica reads it from the database.
    expect(await new AppSettingsService(new AppSettingsRepository(db)).recordingLimitMinutes()).toBe(90);
  });
});

describe('AppSettingsService', () => {
  it('caches the value for a minute and falls back to the default', async () => {
    const repo = { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue({ key: 'k', value: 45, updatedAt: new Date(), updatedBy: 'u' }) };
    const service = new AppSettingsService(repo as never);
    expect(await service.recordingLimitMinutes()).toBe(120);
    expect(await service.recordingLimitMinutes()).toBe(120);
    expect(repo.get).toHaveBeenCalledTimes(1);
    await service.setRecordingLimitMinutes(45, 'u');
    expect(await service.recordingLimitMinutes()).toBe(45);
    expect(repo.get).toHaveBeenCalledTimes(1);
    expect([minutesOf(0), minutesOf(30), minutesOf('x'), minutesOf(-1), minutesOf(1.5)]).toEqual([0, 30, 120, 120, 120]);
  });
});

describe('admin days', () => {
  it('counts days in the time zone and fills the gaps', () => {
    expect(localDay(new Date('2026-10-20T23:30:00Z'), 'Europe/Berlin')).toBe('2026-10-21');
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
    expect(dailySeries('2026-10-01', 3, [{ date: '2026-10-02', count: 2, totalSec: 5400 }], [{ date: '2026-10-01', count: 1, totalSec: 0 }])).toEqual([
      { date: '2026-10-01', signups: 1, meetings: 0, hours: 0 },
      { date: '2026-10-02', signups: 0, meetings: 2, hours: 1.5 },
      { date: '2026-10-03', signups: 0, meetings: 0, hours: 0 },
    ]);
  });
});

describe('AdminController', () => {
  it('hands every route to the service', async () => {
    const service = {
      overview: vi.fn().mockResolvedValue('o'),
      listUsers: vi.fn().mockResolvedValue('l'),
      user: vi.fn().mockResolvedValue('u'),
      updateUser: vi.fn().mockResolvedValue('uu'),
      admins: vi.fn().mockResolvedValue('a'),
      grantAdmin: vi.fn().mockResolvedValue('g'),
      getSettings: vi.fn().mockResolvedValue('s'),
      updateSettings: vi.fn().mockResolvedValue('us'),
    };
    const c = new AdminController(service as never);
    const actor = { id: 'me' } as UserRow;
    expect(await c.overview({ days: 30, tz: 'UTC' })).toBe('o');
    expect(await c.users({ limit: 50 })).toBe('l');
    expect(await c.user('id')).toBe('u');
    expect(await c.updateUser(actor, 'id', { isAdmin: true })).toBe('uu');
    expect(service.updateUser).toHaveBeenCalledWith(actor, 'id', { isAdmin: true });
    expect(await c.admins()).toBe('a');
    expect(await c.grant(actor, { email: 'a@b.co' })).toBe('g');
    expect(service.grantAdmin).toHaveBeenCalledWith(actor, 'a@b.co');
    expect(await c.settings()).toBe('s');
    expect(await c.updateSettings(actor, { recordingLimitMinutes: 60 })).toBe('us');
  });
});
