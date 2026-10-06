import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { user, testConfig } from '../testing/fixtures';
import { FirebaseOnly, Public, CurrentUser, type AuthedRequest } from './auth.decorators';
import { AuthGuard } from './auth.guard';
import { FirebaseVerifier, firebaseJwksProvider, InvalidTokenError } from './firebase-verifier';
import { UserThrottlerGuard } from './throttler.guard';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';

const PROJECT = 'bt-test';
const ISS = `https://securetoken.google.com/${PROJECT}`;

async function keys() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const sign = (claims: Record<string, unknown>, opts: { iss?: string; aud?: string; exp?: string } = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(opts.iss ?? ISS)
      .setAudience(opts.aud ?? PROJECT)
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? '1h')
      .sign(privateKey);
  return { jwks: createLocalJWKSet({ keys: [jwk] }), sign };
}

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const unsigned = (claims: Record<string, unknown>) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims)}.`;
const now = () => Math.floor(Date.now() / 1000);

describe('FirebaseVerifier', () => {
  it('accepts a token signed by a key in the JWKS', async () => {
    const { jwks, sign } = await keys();
    const v = new FirebaseVerifier(testConfig(), jwks);
    await expect(v.verify(await sign({ sub: 'uid-1', email: 'a@b.c', name: 'Ann' }))).resolves.toEqual({
      uid: 'uid-1',
      email: 'a@b.c',
      name: 'Ann',
    });
    await expect(v.verify(await sign({ sub: 'uid-2' }))).resolves.toEqual({ uid: 'uid-2', email: null, name: null });
  });

  it.each([
    ['another project', { aud: 'other' }],
    ['another issuer', { iss: 'https://evil.test' }],
    ['an expired token', { exp: '-1m' }],
  ])('rejects %s', async (_, opts) => {
    const { jwks, sign } = await keys();
    const v = new FirebaseVerifier(testConfig(), jwks);
    await expect(v.verify(await sign({ sub: 'u' }, opts))).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('rejects a key it does not know and tokens without a subject', async () => {
    const mine = await keys();
    const theirs = await keys();
    const v = new FirebaseVerifier(testConfig(), mine.jwks);
    await expect(v.verify(await theirs.sign({ sub: 'u' }))).rejects.toBeInstanceOf(InvalidTokenError);
    await expect(v.verify(await mine.sign({ sub: '' }))).rejects.toThrow('subject');
    await expect(v.verify('not-a-jwt')).rejects.toBeInstanceOf(InvalidTokenError);
  });

  describe('emulator tokens', () => {
    const emulator = testConfig({ FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' });
    const never = () => Promise.reject(new Error('JWKS must not be used'));
    const claims = { iss: ISS, aud: PROJECT, sub: 'emu-1', email: 'e@x.y', exp: now() + 60 };

    it('accepts unsigned tokens when the emulator is configured', async () => {
      const v = new FirebaseVerifier(emulator, never as never);
      await expect(v.verify(unsigned(claims))).resolves.toMatchObject({ uid: 'emu-1', email: 'e@x.y' });
    });

    it.each([
      ['audience', { aud: 'x' }],
      ['issuer', { iss: 'x' }],
      ['expiry', { exp: now() - 1 }],
      ['missing expiry', { exp: undefined }],
    ])('still checks the %s', async (_, patch) => {
      const v = new FirebaseVerifier(emulator, never as never);
      await expect(v.verify(unsigned({ ...claims, ...patch }))).rejects.toBeInstanceOf(InvalidTokenError);
    });

    it('refuses unsigned tokens without the emulator or in production', async () => {
      const { jwks } = await keys();
      await expect(new FirebaseVerifier(testConfig(), jwks).verify(unsigned(claims))).rejects.toBeInstanceOf(InvalidTokenError);
      const prod = testConfig({ NODE_ENV: 'production', FIREBASE_AUTH_EMULATOR_HOST: 'x' });
      await expect(new FirebaseVerifier(prod, jwks).verify(unsigned(claims))).rejects.toBeInstanceOf(InvalidTokenError);
    });
  });

  it('builds a remote JWKS for Google keys by default', () => {
    expect(typeof firebaseJwksProvider.useFactory()).toBe('function');
  });
});

describe('AuthGuard', () => {
  const reflector = new Reflector();
  const firebase = { verify: vi.fn() };
  const users = { ensureUser: vi.fn() };
  const deviceTokens = { authenticate: vi.fn() };
  const guard = new AuthGuard(reflector, firebase as never, users as never, deviceTokens as never);

  class Routes {
    @Public() open() {}
    @FirebaseOnly() dashboardOnly() {}
    normal() {}
  }

  function ctx(handler: keyof Routes, authorization?: string) {
    const req: AuthedRequest & { headers: Record<string, string | undefined> } = { headers: { authorization } };
    const context = {
      getHandler: () => Routes.prototype[handler],
      getClass: () => Routes,
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    return { context, req };
  }

  beforeEach(() => vi.resetAllMocks());

  it('lets public routes through without a token', async () => {
    await expect(guard.canActivate(ctx('open').context)).resolves.toBe(true);
  });

  it('requires a bearer token', async () => {
    await expect(guard.canActivate(ctx('normal').context)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard.canActivate(ctx('normal', 'Basic abc').context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('signs in Firebase users and upserts them', async () => {
    firebase.verify.mockResolvedValue({ uid: 'fb-1', email: 'a@b.c', name: null });
    users.ensureUser.mockResolvedValue(user());
    const { context, req } = ctx('dashboardOnly', 'Bearer eyJ.token');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.auth).toEqual({ user: user(), via: 'firebase', deviceId: null });
  });

  it('turns bad Firebase tokens into 401 but lets other errors through', async () => {
    firebase.verify.mockRejectedValueOnce(new InvalidTokenError('bad'));
    await expect(guard.canActivate(ctx('normal', 'Bearer x').context)).rejects.toBeInstanceOf(UnauthorizedException);
    firebase.verify.mockRejectedValueOnce(new Error('db down'));
    await expect(guard.canActivate(ctx('normal', 'Bearer x').context)).rejects.toThrow('db down');
  });

  it('accepts device tokens', async () => {
    deviceTokens.authenticate.mockResolvedValue({ user: user(), deviceId: 'd-1' });
    const { context, req } = ctx('normal', 'Bearer btd_abc');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.auth).toEqual({ user: user(), via: 'device', deviceId: 'd-1' });
  });

  it('rejects revoked or unknown device tokens', async () => {
    deviceTokens.authenticate.mockResolvedValue(null);
    await expect(guard.canActivate(ctx('normal', 'Bearer btd_gone').context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('keeps device tokens away from Firebase-only routes', async () => {
    await expect(guard.canActivate(ctx('dashboardOnly', 'Bearer btd_abc').context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(deviceTokens.authenticate).not.toHaveBeenCalled();
  });
});

describe('CurrentUser', () => {
  function factoryOf(decorator: ParameterDecorator) {
    class C {
      m(_u: unknown) {}
    }
    decorator(C.prototype, 'm', 0);
    const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, C, 'm') as Record<string, { factory: (d: unknown, c: unknown) => unknown }>;
    return Object.values(meta)[0].factory;
  }

  it('reads the authenticated user and fails loudly without one', () => {
    const factory = factoryOf(CurrentUser());
    const c = (auth?: unknown) => ({ switchToHttp: () => ({ getRequest: () => ({ auth }) }) });
    expect(factory(undefined, c({ user: user() }))).toEqual(user());
    expect(() => factory(undefined, c())).toThrow('without authentication');
  });
});

describe('UserThrottlerGuard', () => {
  it('keys on the user when signed in, else on the IP', async () => {
    const guard = Object.create(UserThrottlerGuard.prototype) as UserThrottlerGuard;
    const tracker = (req: object) => (guard as unknown as { getTracker(r: object): Promise<string> }).getTracker(req);
    await expect(tracker({ auth: { user: user() }, ip: '1.2.3.4' })).resolves.toBe(`user:${user().id}`);
    await expect(tracker({ ip: '1.2.3.4' })).resolves.toBe('ip:1.2.3.4');
  });
});
