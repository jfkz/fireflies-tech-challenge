import { sql } from 'drizzle-orm';
import { decodeCursor, encodeCursor } from '../common/cursor';
import { DevicesRepository } from '../devices/devices.repository';
import { EmailLogRepository } from '../email/email-log.repository';
import { DemoService } from '../meetings/demo.service';
import { DEMO_MEETING, DEMO_SEGMENTS } from '../meetings/demo-meeting';
import { MeetingsRepository } from '../meetings/meetings.repository';
import { createTestDb } from '../testing/pglite';
import { seg } from '../testing/fixtures';
import { UsersRepository } from '../users/users.repository';
import type { Database } from './db.module';
import { devices } from './schema';

let db: Database;
let close: () => Promise<void>;
let users: UsersRepository;
let meetings: MeetingsRepository;
let devs: DevicesRepository;
let userId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  users = new UsersRepository(db);
  meetings = new MeetingsRepository(db);
  devs = new DevicesRepository(db);
  const u = await users.insertIfAbsent({ firebaseUid: 'fb-1', email: 'ann@example.com', name: 'Ann' });
  userId = u!.id;
}, 30_000);

afterAll(() => close());

describe('UsersRepository', () => {
  it('creates once per Firebase uid', async () => {
    expect(await users.insertIfAbsent({ firebaseUid: 'fb-1', email: null, name: null })).toBeNull();
    expect((await users.findByFirebaseUid('fb-1'))?.id).toBe(userId);
    expect(await users.findByFirebaseUid('nobody')).toBeNull();
    expect(await users.findById('00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('updates profile and settings', async () => {
    expect((await users.updateProfile(userId, { email: 'ann@new.example', name: 'Ann B' })).name).toBe('Ann B');
    expect((await users.updateSettings(userId, { emailOnReady: false })).emailOnReady).toBe(false);
    await users.updateSettings(userId, { emailOnReady: true });
  });
});

describe('MeetingsRepository', () => {
  const base = (title: string, startedAt: string) => ({
    userId,
    title,
    status: 'recording' as const,
    source: 'macos' as const,
    startedAt: new Date(startedAt),
  });

  it('pages newest first with a keyset cursor', async () => {
    const other = await users.insertIfAbsent({ firebaseUid: 'fb-2', email: null, name: null });
    await meetings.create({ ...base('Someone else', '2026-01-10T00:00:00Z'), userId: other!.id });
    for (let i = 1; i <= 5; i++) await meetings.create(base(`Page meeting ${i}`, `2026-01-0${i}T09:00:00Z`));

    const first = await meetings.list(userId, { cursor: null, limit: 2 });
    expect(first.map((m) => m.title)).toEqual(['Page meeting 5', 'Page meeting 4']);
    const cursor = decodeCursor(encodeCursor({ startedAt: first[1].startedAt, id: first[1].id }));
    const second = await meetings.list(userId, { cursor, limit: 10 });
    expect(second.map((m) => m.title)).toEqual(['Page meeting 3', 'Page meeting 2', 'Page meeting 1']);
    expect(second.every((m) => m.actionItemCount === 0)).toBe(true);
  });

  it('stores transcripts, summaries and finds them by full-text search', async () => {
    const m = await meetings.create(base('Roadmap planning', '2026-02-01T09:00:00Z'));
    expect(await meetings.hasSegments(m.id)).toBe(false);
    const updated = await meetings.replaceTranscript(m.id, [seg('You', 0, 1000, 'Kubernetes migration is blocked'), seg('Bo', 1500, 2000, 'Agreed')], {
      speakers: ['You', 'Bo'],
    });
    expect(updated.speakers).toEqual(['You', 'Bo']);
    expect(await meetings.hasSegments(m.id)).toBe(true);
    expect(await meetings.getSegments(m.id)).toEqual([seg('You', 0, 1000, 'Kubernetes migration is blocked'), seg('Bo', 1500, 2000, 'Agreed')]);

    await meetings.saveSummary(
      m.id,
      {
        summary: 's',
        keyTopics: ['k'],
        actionItems: [{ id: 'a1', text: 'Unblock it', owner: 'You', due: null, dueDate: null, done: false }],
        decisions: [],
        model: 'm',
        inputTokens: 1,
        outputTokens: 2,
      },
      { status: 'ready', description: 'Infra sync about the cluster' },
    );
    const bySegment = await meetings.list(userId, { cursor: null, limit: 10, q: 'kubernetes' });
    expect(bySegment.map((r) => r.id)).toEqual([m.id]);
    expect(bySegment[0].actionItemCount).toBe(1);
    expect((await meetings.list(userId, { cursor: null, limit: 10, q: 'roadmap' })).map((r) => r.id)).toEqual([m.id]);
    expect((await meetings.list(userId, { cursor: null, limit: 10, q: 'cluster' })).map((r) => r.id)).toEqual([m.id]);
    expect(await meetings.list(userId, { cursor: null, limit: 10, q: 'nonexistentword' })).toEqual([]);

    // Prefixes match while typing, and every result says where it matched.
    const typing = await meetings.list(userId, { cursor: null, limit: 10, q: 'kuber' });
    expect(typing.map((r) => r.id)).toEqual([m.id]);
    expect(typing[0].match).toEqual({ in: 'transcript', snippet: '⟦Kubernetes⟧ migration is blocked', speaker: 'You', startMs: 0, hits: 1 });
    // Action items (and the rest of the notes) are searchable too.
    expect((await meetings.list(userId, { cursor: null, limit: 10, q: 'unblock' }))[0].match).toMatchObject({ in: 'notes' });
    expect((await meetings.list(userId, { cursor: null, limit: 10, q: '"infra sync"' }))[0].match).toMatchObject({ in: 'title', snippet: expect.stringContaining('⟦Infra⟧ ⟦sync⟧') });
    expect((await meetings.list(userId, { cursor: null, limit: 10, q: 'Bo' }))[0].match).toMatchObject({ in: 'people', snippet: 'You, ⟦Bo⟧' });
    expect(await meetings.list(userId, { cursor: null, limit: 10, q: 'kubernetes -blocked' })).toEqual([]);
    expect(await meetings.list(userId, { cursor: null, limit: 10, q: '!!!' })).toEqual([]);
    expect((await meetings.list(userId, { cursor: null, limit: 10 }))[0].match).toBeNull();

    expect(await meetings.setActionItemDone(m.id, 'a1', true)).toBe(true);
    expect(await meetings.setActionItemDone(m.id, 'nope', true)).toBe(false);
    expect((await meetings.getSummary(m.id))?.actionItems[0].done).toBe(true);

    // Replacing keeps one row per meeting.
    await meetings.saveSummary(m.id, { summary: 's2', keyTopics: [], actionItems: [], decisions: [], model: 'm' }, {});
    expect((await meetings.getSummary(m.id))?.summary).toBe('s2');
  });

  it('starts runs and transitions with compare-and-set', async () => {
    const m = await meetings.create(base('Runs', '2026-03-01T09:00:00Z'));
    const run = await meetings.startRun(m.id, 'recording', 'summarizing', { hasAudio: true });
    expect(run).toMatchObject({ status: 'summarizing', attempts: 1, hasAudio: true, error: null });
    expect(await meetings.startRun(m.id, 'recording', 'summarizing')).toBeNull();
    expect(await meetings.transition(m.id, 'recording', { status: 'failed' })).toBeNull();
    expect((await meetings.transition(m.id, 'summarizing', { status: 'ready' }))?.status).toBe('ready');
    expect((await meetings.update(m.id, { title: 'Renamed' }))?.title).toBe('Renamed');
    expect((await meetings.findOwned(userId, m.id))?.title).toBe('Renamed');
    expect(await meetings.findOwned('00000000-0000-4000-8000-000000000000', m.id)).toBeNull();
    await meetings.delete(m.id);
    expect(await meetings.findById(m.id)).toBeNull();
    expect(await meetings.update(m.id, { title: 'x' })).toBeNull();
  });

  it('creates once per (user, client key)', async () => {
    const values = { ...base('Idempotent', '2026-05-01T09:00:00Z'), clientKey: 'upload-1' };
    const first = await meetings.createOnce(values);
    expect(first?.clientKey).toBe('upload-1');
    expect(await meetings.createOnce(values)).toBeNull();
    expect((await meetings.findByClientKey(userId, 'upload-1'))?.id).toBe(first?.id);
    const other = await users.insertIfAbsent({ firebaseUid: 'fb-3', email: null, name: null });
    expect(await meetings.createOnce({ ...values, userId: other!.id })).not.toBeNull();
    expect(await meetings.findByClientKey(userId, 'unknown')).toBeNull();
    // Meetings without a key never collide.
    await meetings.create(base('No key 1', '2026-05-02T09:00:00Z'));
    await meetings.create(base('No key 2', '2026-05-02T09:00:00Z'));
  });

  it('inserts long transcripts in batches', async () => {
    const m = await meetings.create(base('Long', '2026-04-01T09:00:00Z'));
    const many = Array.from({ length: 2_345 }, (_, i) => seg('You', i * 10, i * 10 + 5, `w${i}`));
    await meetings.replaceTranscript(m.id, many, {});
    const stored = await meetings.getSegments(m.id);
    expect(stored).toHaveLength(2_345);
    expect(stored[2_344].text).toBe('w2344');
  });

  it('seeds the demo meeting', async () => {
    const id = await new DemoService(meetings).seed(userId, new Date('2026-10-06T12:34:56Z'));
    const m = await meetings.findById(id);
    expect(m).toMatchObject({ title: DEMO_MEETING.title, status: 'ready', source: 'demo', speakers: ['You', 'Dana', 'Leo'], topics: DEMO_MEETING.topics });
    expect(m?.startedAt.toISOString()).toBe('2026-10-05T12:00:00.000Z');
    // Deadlines are days after the meeting, so the tasks page shows upcoming work.
    const items = (await meetings.getSummary(id))!.actionItems;
    expect(items.map((a) => [a.due, a.dueDate])).toEqual([
      ['Thu, Oct 8', '2026-10-08'],
      ['Wed, Oct 7', '2026-10-07'],
      ['Fri, Oct 9', '2026-10-09'],
      [null, null],
    ]);
    expect(await meetings.getSegments(id)).toHaveLength(DEMO_SEGMENTS.length);
    expect((await meetings.getSummary(id))?.actionItems).toHaveLength(4);
  });

  it('seeds the demo with the account holder’s first name for "You"', async () => {
    const id = await new DemoService(meetings).seed(userId, new Date('2026-10-06T12:34:56Z'), 'Ann Example');
    const m = (await meetings.findById(id))!;
    expect(m.speakers).toEqual(['Ann', 'Dana', 'Leo']);
    expect((await meetings.getSummary(id))?.actionItems.map((a) => a.owner)).toEqual(['Dana', 'Leo', 'Ann', 'Ann']);
    await meetings.delete(id);
  });

  describe('filters, facets and names', () => {
    let filterUser: string;
    beforeAll(async () => {
      filterUser = (await users.insertIfAbsent({ firebaseUid: 'fb-filters', email: null, name: null }))!.id;
      const add = async (title: string, day: string, speakers: string[], topics: string[]) => {
        const m = await meetings.create({ userId: filterUser, title, status: 'ready', source: 'macos', startedAt: new Date(`2026-03-${day}T10:00:00Z`), speakers, topics });
        await meetings.replaceTranscript(m.id, speakers.map((s, i) => seg(s === 'Maya' ? 'Speaker 1' : s, i * 1000, i * 1000 + 500, `line ${i}`)), {});
        if (speakers.includes('Maya')) await meetings.update(m.id, { speakerNames: { 'Speaker 1': { name: 'Maya', by: 'ai' } } });
        await meetings.saveSummary(m.id, { summary: 's', keyTopics: [], actionItems: [{ id: `${title}-1`, text: 't', owner: 'You', due: null, dueDate: null, done: false }], decisions: [], model: 'm' }, {});
        return m;
      };
      await add('Pricing with Maya', '01', ['You', 'Maya'], ['Pricing']);
      await add('Hiring with Maya', '02', ['You', 'Maya'], ['Hiring']);
      await add('Pricing solo', '03', ['You'], ['Pricing', 'Launch']);
    });
    const titles = async (o: Parameters<MeetingsRepository['list']>[1]) => (await meetings.list(filterUser, o)).map((m) => m.title);

    it('filters by speaker, topic and start time', async () => {
      expect(await titles({ cursor: null, limit: 10, speaker: 'Maya' })).toEqual(['Hiring with Maya', 'Pricing with Maya']);
      expect(await titles({ cursor: null, limit: 10, topic: 'Pricing' })).toEqual(['Pricing solo', 'Pricing with Maya']);
      expect(await titles({ cursor: null, limit: 10, topic: 'Pricing', speaker: 'Maya' })).toEqual(['Pricing with Maya']);
      expect(await titles({ cursor: null, limit: 10, from: new Date('2026-03-02T00:00:00Z'), to: new Date('2026-03-03T00:00:00Z') })).toEqual(['Hiring with Maya']);
    });

    it('counts speakers and topics, most frequent first', async () => {
      const f = await meetings.facets(filterUser, 10);
      expect(f.speakers).toEqual([
        { value: 'You', count: 3 },
        { value: 'Maya', count: 2 },
      ]);
      expect(f.topics[0]).toEqual({ value: 'Pricing', count: 2 });
      expect(await meetings.topTopics(filterUser, 1)).toEqual(['Pricing']);
    });

    it('lists raw speaker labels in order and saves renames with their owners', async () => {
      const [m] = await meetings.list(filterUser, { cursor: null, limit: 1, speaker: 'Maya' });
      expect(await meetings.speakerLabels(m.id)).toEqual(['You', 'Speaker 1']);
      const saved = await meetings.saveSpeakerNames(m.id, { You: { name: 'Me', by: 'user' } }, ['Me', 'Maya'], [['You', 'Me']]);
      expect(saved.speakers).toEqual(['Me', 'Maya']);
      expect((await meetings.getSummary(m.id))?.actionItems[0].owner).toBe('Me');
    });

    it('counts meetings and minutes per day in the user’s time zone', async () => {
      // The meetings start at 10:00Z on Mar 1, 2 and 3. In Pacific/Kiritimati (UTC+14) that is midnight of
      // the next day, so the Mar 1 meeting counts for Mar 2 there.
      expect(await meetings.dailyStats(filterUser, '2026-03-01', '2026-03-04', 'UTC')).toEqual([
        { date: '2026-03-01', count: 1, totalSec: 0 },
        { date: '2026-03-02', count: 1, totalSec: 0 },
        { date: '2026-03-03', count: 1, totalSec: 0 },
      ]);
      expect(await meetings.dailyStats(filterUser, '2026-03-02', '2026-03-04', 'Pacific/Kiritimati')).toEqual([
        { date: '2026-03-02', count: 1, totalSec: 0 },
        { date: '2026-03-03', count: 1, totalSec: 0 },
      ]);
      expect(await meetings.dailyStats(filterUser, '2026-04-01', '2026-05-01', 'UTC')).toEqual([]);
    });

    it('gives "You" a new name everywhere except where it was typed by hand', async () => {
      expect(await meetings.renameOwner(filterUser, 'Zoe')).toBe(2);
      const all = await meetings.list(filterUser, { cursor: null, limit: 10 });
      expect(all.map((m) => m.speakers[0])).toEqual(['Zoe', 'Me', 'Zoe']);
      const solo = all.find((m) => m.title === 'Pricing solo')!;
      expect(solo.speakerNames.You).toEqual({ name: 'Zoe', by: 'ai' });
      expect((await meetings.getSummary(solo.id))?.actionItems[0].owner).toBe('Zoe');
      // Running it again changes nothing.
      expect(await meetings.renameOwner(filterUser, 'Zoe')).toBe(0);
    });
  });
});

describe('DevicesRepository', () => {
  it('consumes a code exactly once and not after expiry', async () => {
    const future = new Date(Date.now() + 60_000);
    await devs.insertCode({ codeHash: 'h1', userId, codeChallenge: 'c', deviceName: 'Mac', expiresAt: future });
    await devs.insertCode({ codeHash: 'h2', userId, codeChallenge: 'c', deviceName: 'Mac', expiresAt: new Date(Date.now() - 1) });
    expect((await devs.consumeCode('h1'))?.deviceName).toBe('Mac');
    expect(await devs.consumeCode('h1')).toBeNull();
    expect(await devs.consumeCode('h2')).toBeNull();
  });

  it('finds active devices, touches them at most once a minute and revokes them', async () => {
    const d = await devs.insertDevice({ userId, name: 'MacBook', tokenHash: 'th1' });
    expect((await devs.findActiveByTokenHash('th1'))?.user.id).toBe(userId);
    await devs.touch(d.id);
    const firstSeen = (await devs.findById(d.id))?.lastSeenAt;
    expect(firstSeen).toBeInstanceOf(Date);
    await devs.touch(d.id);
    expect((await devs.findById(d.id))?.lastSeenAt).toEqual(firstSeen);
    await db.update(devices).set({ lastSeenAt: sql`now() - interval '2 minutes'` });
    await devs.touch(d.id);
    expect((await devs.findById(d.id))!.lastSeenAt!.getTime()).toBeGreaterThan(Date.now() - 30_000);

    expect((await devs.listActive(userId)).map((x) => x.id)).toContain(d.id);
    expect(await devs.revoke('00000000-0000-4000-8000-000000000000', d.id)).toBe(false);
    expect(await devs.revoke(userId, d.id)).toBe(true);
    expect(await devs.revoke(userId, d.id)).toBe(false);
    expect(await devs.findActiveByTokenHash('th1')).toBeNull();
    expect(await devs.listActive(userId)).toEqual([]);
    expect(await devs.findById('00000000-0000-4000-8000-000000000000')).toBeNull();
  });
});

describe('EmailLogRepository', () => {
  it('claims a key once and can release it', async () => {
    const log = new EmailLogRepository(db);
    expect(await log.claim('k1', userId, 'welcome')).toBe(true);
    expect(await log.claim('k1', userId, 'welcome')).toBe(false);
    await log.release('k1');
    expect(await log.claim('k1', userId, 'welcome')).toBe(true);
  });
});
