import { describe, expect, it } from 'vitest';
import {
  AdminSettings,
  effectiveRecordingLimit,
  ListAdminUsersQuery,
  MAX_RECORDING_LIMIT_MINUTES,
  UpdateAdminSettingsRequest,
  UpdateAdminUserRequest,
} from './admin';
import { parseDeviceUserAgent } from './device';
import { Me } from './user';

describe('recording limits', () => {
  it('uses the user’s own limit, else the global one; 0 is none', () => {
    expect(effectiveRecordingLimit(null, 120)).toBe(120);
    expect(effectiveRecordingLimit(30, 120)).toBe(30);
    expect(effectiveRecordingLimit(0, 120)).toBeNull();
    expect(effectiveRecordingLimit(null, 0)).toBeNull();
  });

  it('takes 0 to a day, whole minutes', () => {
    expect(UpdateAdminSettingsRequest.safeParse({ recordingLimitMinutes: 0 }).success).toBe(true);
    expect(UpdateAdminSettingsRequest.safeParse({ recordingLimitMinutes: MAX_RECORDING_LIMIT_MINUTES + 1 }).success).toBe(false);
    expect(UpdateAdminSettingsRequest.safeParse({ recordingLimitMinutes: 1.5 }).success).toBe(false);
    expect(AdminSettings.parse({ recordingLimitMinutes: 120, updatedAt: null, updatedBy: null }).recordingLimitMinutes).toBe(120);
  });

  it('updates a user’s admin rights or limit, not nothing', () => {
    expect(UpdateAdminUserRequest.parse({ recordingLimitMinutes: null })).toEqual({ recordingLimitMinutes: null });
    expect(UpdateAdminUserRequest.parse({ isAdmin: true })).toEqual({ isAdmin: true });
    expect(UpdateAdminUserRequest.safeParse({}).success).toBe(false);
  });

  it('is in /me, and older APIs without it still parse', () => {
    const me = { id: '11111111-1111-4111-8111-111111111111', email: null, name: null, emailOnReady: true, createdAt: '2026-10-01T10:00:00.000Z' };
    expect(Me.parse({ ...me, recordingLimitSec: 7200, isOwner: true }).recordingLimitSec).toBe(7200);
    expect(Me.parse({ ...me, recordingLimitSec: null }).recordingLimitSec).toBeNull();
    expect(Me.parse(me).recordingLimitSec).toBeUndefined();
  });
});

describe('admin user list', () => {
  it('reads its query', () => {
    expect(ListAdminUsersQuery.parse({})).toEqual({ limit: 50 });
    expect(ListAdminUsersQuery.parse({ q: ' ann ', limit: '10' })).toEqual({ q: 'ann', limit: 10 });
  });
});

describe('parseDeviceUserAgent', () => {
  it('reads the desktop apps’ user agents', () => {
    expect(parseDeviceUserAgent('BoringTalks-Windows/0.6.0')).toEqual({ platform: 'windows', version: '0.6.0' });
    expect(parseDeviceUserAgent('BoringTalks-macOS/0.5.0 CFNetwork/1.0')).toEqual({ platform: 'macos', version: '0.5.0' });
    expect(parseDeviceUserAgent('Mozilla/5.0')).toBeNull();
    expect(parseDeviceUserAgent(undefined)).toBeNull();
    expect(parseDeviceUserAgent('BoringTalks-Windows')).toBeNull();
  });
});
