import { Resend } from 'resend';
import { meeting, testConfig, user } from '../testing/fixtures';
import { EmailComposer, renderEmail } from './email-composer';
import { EmailProcessor } from './email.processor';
import { EmailService } from './email.service';
import { FakeMailSender, LogMailSender, ResendMailSender } from './mail-sender';
import { DeviceConnectedEmail } from './templates/device-connected';
import { MeetingReadyEmail } from './templates/meeting-ready';
import { WelcomeEmail } from './templates/welcome';

const actionItems = [
  { id: 'a1', text: 'Send the contract', owner: 'Dana', due: 'Friday', dueDate: null, done: false },
  { id: 'a2', text: 'Book the venue', owner: 'You', due: null, dueDate: null, done: false },
];

describe('templates', () => {
  it('welcome links to the download', async () => {
    const { html, text } = await renderEmail('s', <WelcomeEmail name="Ann" dashboardUrl="https://app/meetings" />);
    expect(html).toContain('Welcome, Ann!');
    expect(html).toContain('https://boringtalks.lol/#download');
    expect(text).toContain('Download BoringTalks for Mac');
    expect((await renderEmail('s', <WelcomeEmail name={null} dashboardUrl="x" />)).html).toContain('Welcome!');
  });

  it('meeting ready lists "You" items first and highlighted, with a button to the meeting', async () => {
    const { html, text } = await renderEmail(
      's',
      <MeetingReadyEmail title="Venue decided" description="We chose the hall." summary="Long summary." actionItems={actionItems} url="https://app/meetings/1" />,
    );
    expect(html).toContain('Venue decided');
    expect(html).toContain('https://app/meetings/1');
    expect(html).toContain('#fff1e6');
    expect(text.indexOf('Book the venue')).toBeLessThan(text.indexOf('Send the contract'));
    expect(text).toContain('due Friday');
    const bare = await renderEmail('s', <MeetingReadyEmail title="T" description={null} summary="S" actionItems={[]} url="u" />);
    expect(bare.text).not.toContain('Action items');
  });

  it('device notice names the Mac', async () => {
    const { text } = await renderEmail('s', <DeviceConnectedEmail deviceName="Ann's MacBook" connectedAt="Tue" settingsUrl="https://app/settings" />);
    expect(text).toContain("Ann's MacBook");
    expect(text).toContain('Review connected Macs');
  });
});

describe('EmailComposer', () => {
  const meetings = { findById: vi.fn(), getSummary: vi.fn() };
  const devices = { findById: vi.fn() };
  const reports = { findById: vi.fn() };
  const composer = new EmailComposer(testConfig({ WEB_URL: 'https://boringtalks.lol/' }), meetings as never, devices as never, reports as never);

  it('composes each type from current data', async () => {
    expect((await composer.compose({ type: 'welcome', userId: 'u' }, user()))?.subject).toBe('Welcome to BoringTalks');

    meetings.findById.mockResolvedValue(meeting({ title: 'Budget cut by 10%' }));
    meetings.getSummary.mockResolvedValue({ summary: 'S', actionItems });
    const ready = await composer.compose({ type: 'meeting-ready', userId: 'u', meetingId: meeting().id, run: 1 }, user());
    expect(ready?.subject).toBe('Ready: Budget cut by 10%');
    expect(ready?.html).toContain(`https://boringtalks.lol/meetings/${meeting().id}`);

    devices.findById.mockResolvedValue({ name: 'Mac mini', createdAt: new Date('2026-10-06T10:00:00Z') });
    const dev = await composer.compose({ type: 'device-connected', userId: 'u', deviceId: 'd' }, user());
    expect(dev?.subject).toBe('New Mac connected: Mac mini');
    expect(dev?.text).toContain('06 Oct 2026 10:00:00 UTC');

    const report = { id: 'r-1', kind: 'hang', appVersion: '0.4.0', appBuild: '3', flavor: 'dev', os: 'macOS 26.2', model: 'Mac15,3', message: '', log: 'x'.repeat(3000) };
    reports.findById.mockResolvedValue({ report, email: 'ann@example.com' });
    const hang = await composer.compose({ type: 'problem-report', userId: 'u', reportId: 'r-1' }, user());
    expect(hang?.subject).toBe('Hang: BoringTalks 0.4.0 (Dev) from ann@example.com');
    expect(hang?.text).toContain('The Mac app was stuck');
    expect(hang?.text).toContain('BoringTalks Dev 0.4.0 (3)');
    expect(hang?.text).toContain('macOS 26.2, Mac15,3');
    expect(hang?.text).toContain('(no message)');
    expect(hang?.text).toContain('node dist/reports.js r-1');

    reports.findById.mockResolvedValue({ report: { ...report, kind: 'user', flavor: 'release', appBuild: '', model: '', os: '', message: 'It froze' }, email: null });
    const sent = await composer.compose({ type: 'problem-report', userId: 'u', reportId: 'r-1' }, user({ email: null }));
    expect(sent?.subject).toBe(`Problem report: BoringTalks 0.4.0 from ${user().id}`);
    expect(sent?.text).toContain('New problem report');
    expect(sent?.text).toContain('It froze');
    expect(sent?.text).toContain('unknown');
  });

  it('returns null when the subject is gone', async () => {
    meetings.findById.mockResolvedValue(null);
    devices.findById.mockResolvedValue(null);
    expect(await composer.compose({ type: 'meeting-ready', userId: 'u', meetingId: 'm', run: 1 }, user())).toBeNull();
    expect(await composer.compose({ type: 'device-connected', userId: 'u', deviceId: 'd' }, user())).toBeNull();
    reports.findById.mockResolvedValue(null);
    expect(await composer.compose({ type: 'problem-report', userId: 'u', reportId: 'r' }, user())).toBeNull();
  });
});

describe('EmailService', () => {
  function setup(env: Record<string, string> = {}) {
    const users = { findById: vi.fn().mockResolvedValue(user()) };
    const composer = { compose: vi.fn().mockResolvedValue({ subject: 'S', html: '<p>h</p>', text: 't' }) };
    const claimed = new Set<string>();
    const log = {
      claim: vi.fn((k: string) => Promise.resolve(!claimed.has(k) && Boolean(claimed.add(k)))),
      release: vi.fn((k: string) => Promise.resolve(void claimed.delete(k))),
    };
    const sender = new FakeMailSender();
    const service = new EmailService(testConfig(env), users as never, composer as never, log as never, sender);
    return { users, composer, log, sender, service };
  }

  it('sends once per idempotency key, passing the key on to the provider', async () => {
    const { sender, service } = setup();
    const job = { type: 'welcome', userId: user().id } as const;
    await expect(service.send(job)).resolves.toBe('sent');
    await expect(service.send(job)).resolves.toBe('duplicate');
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]).toMatchObject({
      to: 'ann@example.com',
      from: 'BoringTalks <hello@send.boringtalks.lol>',
      idempotencyKey: `welcome_${user().id}`,
    });
  });

  it('releases the key when sending fails so a retry can send', async () => {
    const { sender, log, service } = setup();
    vi.spyOn(sender, 'send').mockRejectedValueOnce(new Error('resend down'));
    const job = { type: 'welcome', userId: user().id } as const;
    await expect(service.send(job)).rejects.toThrow('resend down');
    expect(log.release).toHaveBeenCalled();
    await expect(service.send(job)).resolves.toBe('sent');
  });

  it('only mails allow-listed addresses when an allowlist is set', async () => {
    const blocked = setup({ EMAIL_ALLOWLIST: 'boss@example.com' });
    await expect(blocked.service.send({ type: 'welcome', userId: 'u' })).resolves.toBe('not-allowed');
    expect(blocked.sender.sent).toHaveLength(0);
    const allowed = setup({ EMAIL_ALLOWLIST: 'ANN@example.com, boss@example.com' });
    await expect(allowed.service.send({ type: 'welcome', userId: 'u' })).resolves.toBe('sent');
  });

  it('skips users without email, opted-out ready emails and vanished subjects', async () => {
    const t = setup();
    t.users.findById.mockResolvedValueOnce(user({ email: null }));
    await expect(t.service.send({ type: 'welcome', userId: 'u' })).resolves.toBe('skipped');
    t.users.findById.mockResolvedValueOnce(user({ emailOnReady: false }));
    await expect(t.service.send({ type: 'meeting-ready', userId: 'u', meetingId: 'm', run: 1 })).resolves.toBe('skipped');
    t.composer.compose.mockResolvedValueOnce(null);
    await expect(t.service.send({ type: 'device-connected', userId: 'u', deviceId: 'd' })).resolves.toBe('skipped');
    expect(t.sender.sent).toHaveLength(0);
  });

  it('sends problem reports to the operator, not the user, and only when an address is set', async () => {
    const off = setup();
    await expect(off.service.send({ type: 'problem-report', userId: 'u', reportId: 'r' })).resolves.toBe('skipped');
    const on = setup({ REPORTS_NOTIFY_EMAIL: 'ops@example.com' });
    on.users.findById.mockResolvedValueOnce(user({ email: null }));
    await expect(on.service.send({ type: 'problem-report', userId: 'u', reportId: 'r' })).resolves.toBe('sent');
    expect(on.sender.sent[0]).toMatchObject({ to: 'ops@example.com', idempotencyKey: 'problem-report_r' });
    on.users.findById.mockResolvedValueOnce(null);
    await expect(on.service.send({ type: 'problem-report', userId: 'u', reportId: 'r2' })).resolves.toBe('skipped');
  });

  it('is driven by the email queue processor', async () => {
    const service = { send: vi.fn().mockResolvedValue('sent') };
    await expect(new EmailProcessor(service as never).process({ data: { type: 'welcome', userId: 'u' } } as never)).resolves.toBe('sent');
  });
});

describe('mail senders', () => {
  const email = { from: 'f', to: 't@x.y', subject: 's', html: 'h', text: 't', idempotencyKey: 'k' };

  it('Resend gets the idempotency key as a request option', async () => {
    const send = vi.fn().mockResolvedValue({ data: { id: '1' }, error: null });
    const resend = { emails: { send } } as unknown as Resend;
    await new ResendMailSender(resend).send(email);
    expect(send).toHaveBeenCalledWith({ from: 'f', to: 't@x.y', subject: 's', html: 'h', text: 't' }, { idempotencyKey: 'k' });
    send.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'bad from' } });
    await expect(new ResendMailSender(resend).send(email)).rejects.toThrow('bad from');
  });

  it('the log sender sends nothing', async () => {
    await expect(new LogMailSender().send(email)).resolves.toBeUndefined();
  });
});
