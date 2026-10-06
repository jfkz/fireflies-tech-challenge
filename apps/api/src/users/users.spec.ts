import { MeController } from './me.controller';
import { toMe, UsersService } from './users.service';
import { user } from '../testing/fixtures';

function setup() {
  const repo = {
    findByFirebaseUid: vi.fn(),
    insertIfAbsent: vi.fn(),
    updateProfile: vi.fn(),
    updateSettings: vi.fn(),
    findById: vi.fn(),
  };
  const demo = { seed: vi.fn() };
  const jobs = { email: vi.fn() };
  return { repo, demo, jobs, service: new UsersService(repo as never, demo as never, jobs as never) };
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
    expect(demo.seed).toHaveBeenCalledWith(user().id);
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
    expect(controller.me(user())).toEqual(toMe(user()));
    expect(toMe(user()).createdAt).toBe('2026-10-01T10:00:00.000Z');
    await expect(controller.updateSettings(user(), { emailOnReady: false })).resolves.toMatchObject({ emailOnReady: false });
    await expect(service.findById(user().id)).resolves.toEqual(user());
  });
});
