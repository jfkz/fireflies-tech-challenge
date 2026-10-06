import { describe, expect, it } from 'vitest';
import { env } from './env';
import { ownAuthDomain } from './firebase';

describe('ownAuthDomain', () => {
  const site = new URL(env.siteUrl);
  it('signs in through the site itself on its own domain', () => {
    expect(ownAuthDomain('demo.firebaseapp.com', { host: site.host, hostname: site.hostname })).toBe(site.host);
  });
  it('keeps the configured domain elsewhere, and for custom auth domains', () => {
    expect(ownAuthDomain('demo.firebaseapp.com', { host: 'preview-123.vercel.app', hostname: 'preview-123.vercel.app' })).toBe('demo.firebaseapp.com');
    expect(ownAuthDomain('auth.example.com', { host: site.host, hostname: site.hostname })).toBe('auth.example.com');
    expect(ownAuthDomain(undefined, { host: site.host, hostname: site.hostname })).toBeUndefined();
    expect(ownAuthDomain('demo.firebaseapp.com', undefined)).toBe('demo.firebaseapp.com');
  });
});
