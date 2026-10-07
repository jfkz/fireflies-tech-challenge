import { meeting, user } from '../testing/fixtures';
import { byTimeTogether, groupPeople, personName, toSummary, type SpeakerTimeRow } from './people';
import { PeopleService, topicCounts } from './people.service';

const row = (meetingId: string, day: string, label: string, talkSec: number, extra: Partial<SpeakerTimeRow> = {}): SpeakerTimeRow => ({
  meetingId,
  title: `Meeting ${meetingId}`,
  startedAt: new Date(`2026-10-${day}T10:00:00Z`),
  durationSec: 1800,
  topics: ['Launch'],
  speakerNames: {},
  label,
  talkMs: talkSec * 1000,
  ...extra,
});

describe('personName', () => {
  it('is the display name of a real person', () => {
    expect(personName('Speaker 1', { 'Speaker 1': { name: 'Maya', by: 'ai' } }, 'Ann Lee')).toBe('Maya');
    expect(personName('Dana', {}, null)).toBe('Dana');
  });

  it('is nobody for the account holder, unnamed voices and roles', () => {
    expect(personName('You', { You: { name: 'Ann', by: 'ai' } }, 'Ann Lee')).toBeNull();
    expect(personName('Speaker 2', { 'Speaker 2': { name: 'Ann', by: 'ai' } }, 'Ann Lee')).toBeNull();
    expect(personName('Speaker 2', { 'Speaker 2': { name: 'ann lee', by: 'user' } }, 'Ann Lee')).toBeNull();
    expect(personName('Speaker 3', {}, null)).toBeNull();
    expect(personName('Others', {}, null)).toBeNull();
    expect(personName('Speaker 1', { 'Speaker 1': { name: 'Recruiter', by: 'ai', role: true } }, null)).toBeNull();
  });
});

describe('groupPeople', () => {
  const names = (n: string) => ({ speakerNames: { 'Speaker 1': { name: n, by: 'user' as const } } });
  const rows = [
    row('a', '01', 'Speaker 1', 600, names('maya')),
    row('a', '01', 'You', 300),
    row('b', '05', 'Speaker 1', 120, { ...names('Maya'), durationSec: 900, topics: ['Launch', 'Pricing'] }),
    // One voice split in two labels, both named Maya.
    row('b', '05', 'Speaker 2', 30, { speakerNames: { 'Speaker 1': { name: 'Maya', by: 'user' }, 'Speaker 2': { name: 'Maya', by: 'user' } } }),
    row('c', '03', 'Leo', 900, { durationSec: null }),
  ];

  it('links one name across meetings, in any case, spelled as in the latest meeting', () => {
    const people = groupPeople(rows, 'Ann');
    expect([...people.keys()]).toEqual(['maya', 'leo']);
    const maya = people.get('maya')!;
    expect(maya.name).toBe('Maya');
    expect(maya.meetings.map((m) => [m.id, m.talkMs])).toEqual([
      ['b', 150_000],
      ['a', 600_000],
    ]);
  });

  it('adds up time together and talk time, most time together first', () => {
    const people = groupPeople(rows, 'Ann');
    const maya = toSummary(people.get('maya')!, 2);
    const leo = toSummary(people.get('leo')!, 0);
    expect(maya).toEqual({ name: 'Maya', meetingCount: 2, togetherSec: 2700, talkSec: 750, lastMetAt: '2026-10-05T10:00:00.000Z', openTasks: 2 });
    expect(leo).toMatchObject({ meetingCount: 1, togetherSec: 0, talkSec: 900 });
    expect([leo, maya].sort(byTimeTogether).map((p) => p.name)).toEqual(['Maya', 'Leo']);
    expect(topicCounts(people.get('maya')!)).toEqual([
      { value: 'Launch', count: 2 },
      { value: 'Pricing', count: 1 },
    ]);
  });
});

describe('PeopleService', () => {
  function setup(rows: SpeakerTimeRow[]) {
    const repo = {
      speakerTime: vi.fn().mockResolvedValue(rows),
      meetingSeconds: vi.fn().mockResolvedValue(7200),
      openTasksByOwner: vi.fn().mockResolvedValue(new Map([['maya', 1]])),
      tasksOf: vi.fn().mockResolvedValue([
        { id: 't1', text: 'Send the deck', owner: 'Maya', due: null, dueDate: null, done: false, idx: 0, meetingId: 'a', meetingTitle: 'Meeting a', startedAt: new Date('2026-10-01T10:00:00Z') },
      ]),
      renameOwner: vi.fn(),
    };
    const meetings = { findById: vi.fn(), speakerLabels: vi.fn(), saveSpeakerNames: vi.fn() };
    return { repo, meetings, service: new PeopleService(repo as never, meetings as never) };
  }
  const maya = { speakerNames: { 'Speaker 1': { name: 'Maya', by: 'ai' as const } } };

  it('lists people for a period with their open tasks', async () => {
    const t = setup([row('a', '01', 'Speaker 1', 60, maya)]);
    const list = await t.service.list(user(), 30);
    expect(t.repo.speakerTime.mock.calls[0][1]).toBeInstanceOf(Date);
    expect(list).toMatchObject({ meetingSec: 7200, people: [{ name: 'Maya', openTasks: 1, togetherSec: 1800 }] });
    expect((await t.service.list(user())).since).toBeNull();
  });

  it('shows one person with meetings, topics and tasks, or 404', async () => {
    const t = setup([row('a', '01', 'Speaker 1', 60, maya)]);
    const detail = await t.service.get(user(), 'MAYA');
    expect(detail).toMatchObject({ name: 'Maya', openTasks: 1, topics: [{ value: 'Launch', count: 1 }], meetings: [{ id: 'a', talkSec: 60 }] });
    expect(detail.tasks[0]).toMatchObject({ text: 'Send the deck', meeting: { id: 'a' } });
    await expect(t.service.get(user(), 'Nobody')).rejects.toThrow('Person not found');
  });

  it('renames a person in every meeting and their tasks; a rename can merge two people', async () => {
    const t = setup([row('a', '01', 'Speaker 1', 60, maya), row('a', '01', 'You', 60, maya)]);
    t.meetings.findById.mockResolvedValue(meeting({ id: 'a', speakerNames: maya.speakerNames }));
    t.meetings.speakerLabels.mockResolvedValue(['You', 'Speaker 1']);
    // After the rename the repository sees the new name.
    t.repo.speakerTime.mockResolvedValueOnce([row('a', '01', 'Speaker 1', 60, maya)]).mockResolvedValue([row('a', '01', 'Speaker 1', 60, { speakerNames: { 'Speaker 1': { name: 'Maya Lin', by: 'user' } } })]);
    const detail = await t.service.rename(user(), 'maya', ' Maya Lin ');
    expect(t.meetings.saveSpeakerNames).toHaveBeenCalledWith('a', { 'Speaker 1': { name: 'Maya Lin', by: 'user' } }, ['You', 'Maya Lin'], [['Maya', 'Maya Lin']]);
    expect(t.repo.renameOwner).toHaveBeenCalledWith(user().id, 'maya', 'Maya Lin');
    expect(detail.name).toBe('Maya Lin');
  });
});
