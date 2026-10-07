import { chainPrompt, FakeChainLinker, GatewayChainLinker, toLink, type ChainMeeting } from './chain-linker';

const generateText = vi.hoisted(() => vi.fn());
vi.mock('ai', async (original) => ({ ...(await original<typeof import('ai')>()), generateText }));

const m = (id: string, title: string, speakers: string[], topics: string[], day = '2026-10-01'): ChainMeeting => ({
  id,
  title,
  description: `About ${title}`,
  startedAt: new Date(`${day}T10:00:00Z`),
  speakers,
  topics,
});
const plan = m('a', 'Admin page plan', ['Gat', 'Speaker 2'], ['Launch Planning']);
const hiring = m('b', 'Hiring loop', ['Dana'], ['Hiring'], '2026-10-02');
const now = { ...m('c', 'Admin page delivery', ['Gat'], ['Launch Planning'], '2026-10-06'), summary: 'The admin page ships Friday.' };

describe('chain linker', () => {
  it('shows the model this meeting and numbered neighbours with their people and topics', () => {
    const text = chainPrompt({ meeting: now, candidates: [plan, hiring] });
    expect(text).toContain('[2026-10-06] Admin page delivery — About Admin page delivery — people: Gat — topics: Launch Planning');
    expect(text).toContain('Summary: The admin page ships Friday.');
    expect(text).toContain('1. [2026-10-01] Admin page plan');
    expect(text).toContain('2. [2026-10-02] Hiring loop');
    expect(text).toContain('Sharing only a broad topic');
  });

  it('turns the answer into a link, ignoring numbers off the list', () => {
    expect(toLink({ related: 1, reason: '  Picks up   the admin page plan. ' }, [plan, hiring])).toEqual({ meetingId: 'a', reason: 'Picks up the admin page plan.' });
    expect(toLink({ related: null, reason: 'none' }, [plan])).toBeNull();
    expect(toLink({ related: 7, reason: 'x' }, [plan])).toBeNull();
    expect(toLink({ related: 1, reason: ' ' }, [plan])?.reason).toBe('Related meeting');
  });

  it('asks the summary model, and not at all without neighbours', async () => {
    generateText.mockResolvedValueOnce({ output: { related: 1, reason: 'Same admin page work' } });
    const linker = new GatewayChainLinker('anthropic/claude-haiku-4.5' as never);
    await expect(linker.link({ meeting: now, candidates: [plan] })).resolves.toEqual({ meetingId: 'a', reason: 'Same admin page work' });
    expect(generateText.mock.lastCall?.[0]).toMatchObject({ model: 'anthropic/claude-haiku-4.5', temperature: 0 });
    await expect(linker.link({ meeting: now, candidates: [] })).resolves.toBeNull();
    expect(generateText).toHaveBeenCalledTimes(1);
  });

  it('fake: links to the nearest meeting sharing a person and a topic', async () => {
    const fake = new FakeChainLinker();
    await expect(fake.link({ meeting: now, candidates: [hiring, plan] })).resolves.toEqual({ meetingId: 'a', reason: 'Same people and topic as “Admin page plan”' });
    await expect(fake.link({ meeting: now, candidates: [hiring] })).resolves.toBeNull();
  });
});
