import { MeController } from './me.controller';
import { toMe, UsersService } from './users.service';
import { testConfig, user } from '../testing/fixtures';

function setup() {
  const repo = {
    findByFirebaseUid: vi.fn(),
    insertIfAbsent: vi.fn(),
    updateProfile: vi.fn(),
    updateSettings: vi.fn(),
    findById: vi.fn(),
    touchActive: vi.fn(),
  };
  const demo = { seed: vi.fn() };
  const jobs = { email: vi.fn() };
  const meetings = { renameOwner: vi.fn() };
  const config = testConfig({ ADMIN_EMAILS: 'boss@example.com' });
  const settings = { recordingLimitMinutes: vi.fn().mockResolvedValue(120) };
  return {
    repo,
    demo,
    jobs,
    meetings,
    settings,
    service: new UsersService(config, repo as never, demo as never, jobs as never, meetings as never, settings as never),
  };
}

describe('UsersService.ensureUser', () => {
  it('returns a known user untouched', async () => {
    const { repo, demo, service } = setup();
    repo.findByFirebaseUid.mockResolvedValue(user());
    await expect(service.ensureUser({ uid: 'fb-1', email: 'ann@example.com', name: null })).resolves.toEqual(user());
    expect(repo.updateProfile).not.toHaveBeenCalled();
    expect(demo.seed).not.toHaveBeenCalled();
  });

  it('refreshes a changed email or name', async () => {
    const { repo, service } = setup();
    repo.findByFirebaseUid.mockResolvedValue(user());
    repo.updateProfile.mockResolvedValue(user({ name: 'Annie' }));
    await service.ensureUser({ uid: 'fb-1', email: null, name: 'Annie' });
    expect(repo.updateProfile).toHaveBeenCalledWith(user().id, { email: 'ann@example.com', name: 'Annie' });
  });

  it('creates a new user with a demo meeting and a welcome email', async () => {
    const { repo, demo, jobs, service } = setup();
    repo.findByFirebaseUid.mockResolvedValue(null);
    repo.insertIfAbsent.mockResolvedValue(user());
    await service.ensureUser({ uid: 'fb-1', email: 'ann@example.com', name: 'Ann' });
    expect(demo.seed).toHaveBeenCalledWith(user().id, expect.any(Date), 'Ann');
    expect(jobs.email).toHaveBeenCalledWith({ type: 'welcome', userId: user().id });
  });

  it('does not seed twice when a parallel request created the user', async () => {
    const { repo, demo, service } = setup();
    repo.findByFirebaseUid.mockResolvedValueOnce(null).mockResolvedValueOnce(user());
    repo.insertIfAbsent.mockResolvedValue(null);
    await expect(service.ensureUser({ uid: 'fb-1', email: null, name: null })).resolves.toEqual(user());
    expect(demo.seed).not.toHaveBeenCalled();
    repo.findByFirebaseUid.mockResolvedValue(null);
    await expect(service.ensureUser({ uid: 'fb-1', email: null, name: null })).rejects.toThrow('vanished');
  });
});

describe('MeController', () => {
  it('returns the profile and updates settings', async () => {
    const { repo, service } = setup();
    repo.updateSettings.mockResolvedValue(user({ emailOnReady: false }));
    repo.findById.mockResolvedValue(user());
    const controller = new MeController(service);
    await expect(controller.me(user())).resolves.toEqual({ ...toMe(user()), isOwner: false, recordingLimitSec: 7200 });
    expect(toMe(user()).createdAt).toBe('2026-10-01T10:00:00.000Z');
    await expect(controller.me(user())).resolves.toMatchObject({ isAdmin: false, isOwner: false });
    await expect(controller.me(user({ email: 'Boss@Example.com' }))).resolves.toMatchObject({ isAdmin: true, isOwner: true });
    await expect(controller.me(user({ isAdmin: true }))).resolves.toMatchObject({ isAdmin: true, isOwner: false });
    await expect(controller.updateSettings(user(), { emailOnReady: false })).resolves.toMatchObject({ emailOnReady: false });
    await expect(service.findById(user().id)).resolves.toEqual(user());
  });

  it('says the recording limit in force: theirs, else the global one, none for 0', async () => {
    const { service, settings } = setup();
    await expect(service.me(user({ recordingLimitMinutes: 30 }))).resolves.toMatchObject({ recordingLimitSec: 1800 });
    await expect(service.me(user({ recordingLimitMinutes: 0 }))).resolves.toMatchObject({ recordingLimitSec: null });
    settings.recordingLimitMinutes.mockResolvedValue(0);
    await expect(service.me(user())).resolves.toMatchObject({ recordingLimitSec: null });
  });

  it('keeps when the user was last active, at most once a minute', async () => {
    const { repo, service } = setup();
    await service.touch(user({ lastActiveAt: new Date() }));
    expect(repo.touchActive).not.toHaveBeenCalled();
    await service.touch(user({ lastActiveAt: new Date(Date.now() - 120_000) }));
    await service.touch(user());
    expect(repo.touchActive).toHaveBeenCalledTimes(2);
  });

  it('saves a typed name, locks it, and renames "You" in past meetings', async () => {
    const { repo, meetings, service } = setup();
    repo.updateSettings.mockResolvedValue(user({ name: 'Mikhail Pershin', nameLocked: true }));
    await service.updateSettings(user({ name: null }), { name: 'Mikhail Pershin' });
    expect(repo.updateSettings).toHaveBeenCalledWith(user().id, { emailOnReady: undefined, name: 'Mikhail Pershin', nameLocked: true });
    expect(meetings.renameOwner).toHaveBeenCalledWith(user().id, 'Mikhail');

    // Same first name: nothing to rename.
    meetings.renameOwner.mockClear();
    repo.updateSettings.mockResolvedValue(user({ name: 'Ann B' }));
    await service.updateSettings(user(), { name: 'Ann B' });
    expect(meetings.renameOwner).not.toHaveBeenCalled();
  });

  it('keeps a typed name when the sign-in provider sends another one', async () => {
    const { repo, service } = setup();
    repo.findByFirebaseUid.mockResolvedValue(user({ nameLocked: true }));
    await service.ensureUser({ uid: 'fb-1', email: 'ann@example.com', name: 'Google Name' });
    expect(repo.updateProfile).not.toHaveBeenCalled();
  });
});
