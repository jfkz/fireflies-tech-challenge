import { describe, expect, it } from 'vitest';
import { detectPlatform, otherPlatform } from './platform';

const UA = {
  chromeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  edgeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  firefoxWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
};

describe('detectPlatform', () => {
  it.each([UA.chromeWindows, UA.edgeWindows, UA.firefoxWindows])('finds Windows in %s', (userAgent) => {
    expect(detectPlatform({ userAgent })).toBe('windows');
  });

  it.each([UA.safariMac, UA.chromeMac])('finds a Mac in %s', (userAgent) => {
    expect(detectPlatform({ userAgent, maxTouchPoints: 0 })).toBe('macos');
  });

  it('does not offer a desktop app to an iPad asking for the desktop site', () => {
    expect(detectPlatform({ userAgent: UA.safariMac, maxTouchPoints: 5 })).toBe('other');
  });

  it.each([UA.iphone, UA.android, UA.linux])('offers no desktop app to %s', (userAgent) => {
    expect(detectPlatform({ userAgent })).toBe('other');
  });

  it('trusts the mobile hint over the user agent', () => {
    expect(detectPlatform({ userAgent: UA.chromeWindows, userAgentData: { mobile: true } })).toBe('other');
  });

  it('falls back to the platform hint when the user agent says nothing', () => {
    expect(detectPlatform({ userAgent: 'Mozilla/5.0', userAgentData: { platform: 'Windows' } })).toBe('windows');
    expect(detectPlatform({ userAgent: 'Mozilla/5.0', userAgentData: { platform: 'macOS' } })).toBe('macos');
    expect(detectPlatform({ userAgent: 'Mozilla/5.0', userAgentData: { platform: 'Linux' } })).toBe('other');
  });
});

it('otherPlatform swaps Mac and Windows', () => {
  expect(otherPlatform('macos')).toBe('windows');
  expect(otherPlatform('windows')).toBe('macos');
});
