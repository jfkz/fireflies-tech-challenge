import { JobsService } from './jobs.service';
import { emailJobId, meetingJobId } from './queues';

describe('JobsService', () => {
  it('uses deterministic job ids so duplicates collapse', async () => {
    const queue = () => ({ add: vi.fn() });
    const [t, s, e, b] = [queue(), queue(), queue(), queue()];
    const jobs = new JobsService(t as never, s as never, e as never, b as never);
    await jobs.importBot('m1', 0);
    expect(b.add).toHaveBeenCalledWith('bot-import', { meetingId: 'm1', run: 0 }, expect.objectContaining({ jobId: 'm1_bot-import_0', attempts: 20 }));
    await jobs.transcribe('m1', 1);
    await jobs.summarize('m1', 2);
    await jobs.email({ type: 'meeting-ready', userId: 'u', meetingId: 'm1', run: 2 });
    await jobs.email({ type: 'welcome', userId: 'u' });
    await jobs.email({ type: 'device-connected', userId: 'u', deviceId: 'd' });
    expect(t.add).toHaveBeenCalledWith('transcribe', { meetingId: 'm1', run: 1 }, { jobId: 'm1_transcribe_1' });
    expect(s.add).toHaveBeenCalledWith('summarize', { meetingId: 'm1', run: 2 }, { jobId: 'm1_summarize_2' });
    expect(e.add.mock.calls.map((c) => c[2].jobId)).toEqual(['meeting-ready_m1_2', 'welcome_u', 'device-connected_d']);
    expect(meetingJobId('a', 'b', 3)).not.toContain(':');
    expect(emailJobId({ type: 'welcome', userId: 'x' })).toBe('welcome_x');
  });
});
