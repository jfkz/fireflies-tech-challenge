import { BadRequestException, NotFoundException, HttpException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from './cursor';
import { randomToken, sha256Hex, verifyPkce } from './crypto';
import { ApiExceptionFilter, toApiError } from './http-exception.filter';
import { IdempotencyKey, parseIdempotencyKey } from './idempotency-key';
import { ZodPipe } from './zod.pipe';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';

describe('cursor', () => {
  it('round-trips', () => {
    const c = { startedAt: new Date('2026-10-06T14:05:00.123Z'), id: '22222222-2222-4222-8222-222222222222' };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });

  it.each([
    ['garbage', 'not base64 json'],
    ['wrong shape', Buffer.from('{"a":1}').toString('base64url')],
    ['bad date', Buffer.from('["nope","22222222-2222-4222-8222-222222222222"]').toString('base64url')],
    ['bad id', Buffer.from('["2026-10-06T00:00:00Z","x; drop table"]').toString('base64url')],
    ['wrong types', Buffer.from('[1,2]').toString('base64url')],
  ])('rejects %s', (_, raw) => expect(decodeCursor(raw)).toBeNull());
});

describe('PKCE', () => {
  const verifier = 'v'.repeat(64);
  const challenge = createHash('sha256').update(verifier).digest('base64url');

  it('accepts the matching verifier', () => expect(verifyPkce(verifier, challenge)).toBe(true));
  it('matches RFC 7636 Appendix B', () => {
    expect(verifyPkce('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')).toBe(true);
    expect(verifyPkce('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXK', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')).toBe(false);
  });
  it('rejects another verifier', () => expect(verifyPkce('w'.repeat(64), challenge)).toBe(false));
  it('rejects a challenge of another length', () => expect(verifyPkce(verifier, 'short')).toBe(false));
  it('makes url-safe tokens and hex hashes', () => {
    expect(randomToken(32)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sha256Hex('a')).toHaveLength(64);
  });
});

describe('ZodPipe', () => {
  const pipe = new ZodPipe(z.object({ name: z.string().min(2), age: z.number().optional() }));

  it('returns parsed data', () => expect(pipe.transform({ name: 'Ann' }, { type: 'body' })).toEqual({ name: 'Ann' }));

  it('treats a missing body as {}', () => {
    expect(new ZodPipe(z.object({ a: z.number().optional() })).transform(undefined, { type: 'body' })).toEqual({});
  });

  it('turns failures into a 400 ApiError with issue paths', () => {
    try {
      pipe.transform({ name: 'A', age: 'x' }, { type: 'body' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).getResponse()).toEqual({
        statusCode: 400,
        message: 'Validation failed',
        issues: [
          { path: 'name', message: expect.any(String) },
          { path: 'age', message: expect.any(String) },
        ],
      });
    }
  });
});

describe('Idempotency-Key', () => {
  it('accepts printable keys up to 200 characters', () => {
    expect(parseIdempotencyKey(undefined)).toBeUndefined();
    expect(parseIdempotencyKey('5f0c1a2e-upload/queue:1 retry')).toBe('5f0c1a2e-upload/queue:1 retry');
    expect(parseIdempotencyKey('k'.repeat(200))).toHaveLength(200);
  });

  it.each([
    ['too long', 'k'.repeat(201)],
    ['empty', ''],
    ['padded', ' key '],
    ['non-ASCII', 'ключ'],
    ['control characters', 'a\tb'],
  ])('rejects a %s key with a 400 ApiError', (_, raw) => {
    try {
      parseIdempotencyKey(raw);
      expect.unreachable();
    } catch (err) {
      expect((err as BadRequestException).getResponse()).toMatchObject({ statusCode: 400, issues: [{ path: 'Idempotency-Key' }] });
    }
  });

  it('is read from the request headers by the decorator', () => {
    class C {
      m(_k: unknown) {}
    }
    IdempotencyKey()(C.prototype, 'm', 0);
    const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, C, 'm') as Record<string, { factory: (d: unknown, c: unknown) => unknown }>;
    const ctx = { switchToHttp: () => ({ getRequest: () => ({ headers: { 'idempotency-key': 'abc' } }) }) };
    expect(Object.values(meta)[0].factory(undefined, ctx)).toBe('abc');
    expect(parseIdempotencyKey(['a', 'b'])).toBe('a,b');
  });
});

describe('ApiExceptionFilter', () => {
  it('maps Nest exceptions to ApiError', () => {
    expect(toApiError(new NotFoundException('Meeting not found'))).toEqual({ statusCode: 404, message: 'Meeting not found' });
    expect(toApiError(new HttpException('Too many', 429))).toEqual({ statusCode: 429, message: 'Too many' });
    expect(toApiError(new BadRequestException(['a', 'b']))).toEqual({ statusCode: 400, message: 'a; b' });
    expect(toApiError(new HttpException({ other: 1 }, 418))).toEqual({ statusCode: 418, message: 'Http Exception' });
  });

  it('hides unknown errors behind a 500', () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const host = { switchToHttp: () => ({ getResponse: () => ({ status }) }) };
    new ApiExceptionFilter().catch(new Error('db password is hunter2'), host as never);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ statusCode: 500, message: 'Internal server error' });
  });
});
