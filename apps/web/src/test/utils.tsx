import type { MeetingDetail } from '@boringtalks/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, type RenderOptions } from '@testing-library/react';
import type { User } from 'firebase/auth';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { AuthContextProvider, type AuthContextValue } from '@/components/providers/AuthProvider';
import type { ApiClient } from '@/lib/api';

export function fakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  const notMocked = (name: string) => vi.fn(() => Promise.reject(new Error(`api.${name} not mocked`)));
  return {
    me: notMocked('me'),
    updateSettings: notMocked('updateSettings'),
    listMeetings: notMocked('listMeetings'),
    createMeeting: notMocked('createMeeting'),
    getMeeting: notMocked('getMeeting'),
    updateMeeting: notMocked('updateMeeting'),
    deleteMeeting: notMocked('deleteMeeting'),
    uploadUrl: notMocked('uploadUrl'),
    completeMeeting: notMocked('completeMeeting'),
    reprocessMeeting: notMocked('reprocessMeeting'),
    authorizeDevice: notMocked('authorizeDevice'),
    listDevices: notMocked('listDevices'),
    revokeDevice: notMocked('revokeDevice'),
    latestDownload: notMocked('latestDownload'),
    meetingFacets: vi.fn(() => Promise.resolve({ speakers: [], topics: [] })),
    ...overrides,
  } as ApiClient;
}

export const testUser = { uid: 'u1', email: 'me@example.com', providerData: [{ providerId: 'password' }] } as unknown as User;

export function authValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    user: testUser,
    loading: false,
    signedOutByUser: false,
    api: fakeApi(),
    start: () => {},
    signIn: vi.fn(() => Promise.resolve()),
    signUp: vi.fn(() => Promise.resolve()),
    signInWithGoogle: vi.fn(() => Promise.resolve()),
    resetPassword: vi.fn(() => Promise.resolve()),
    signOut: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

export function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
}

export function Providers({ children, auth, client }: { children: ReactNode; auth: AuthContextValue; client: QueryClient }) {
  return (
    <QueryClientProvider client={client}>
      <AuthContextProvider value={auth}>{children}</AuthContextProvider>
    </QueryClientProvider>
  );
}

export function renderWithProviders(ui: React.ReactElement, { auth = authValue(), client = makeClient(), ...opts }: { auth?: AuthContextValue; client?: QueryClient } & RenderOptions = {}) {
  return { auth, client, ...render(ui, { wrapper: ({ children }) => <Providers auth={auth} client={client}>{children}</Providers>, ...opts }) };
}

export function renderHookWithProviders<T>(hook: () => T, { auth = authValue(), client = makeClient() }: { auth?: AuthContextValue; client?: QueryClient } = {}) {
  return { auth, client, ...renderHook(hook, { wrapper: ({ children }) => <Providers auth={auth} client={client}>{children}</Providers> }) };
}

export function meeting(overrides: Partial<MeetingDetail> = {}): MeetingDetail {
  return {
    id: '7b0c4c9e-2c1f-4d8e-9a65-0f3f1c2a9b10',
    title: 'Pricing review: Pro to $29, launch Nov 3',
    description: 'Pro goes to $29.',
    status: 'ready',
    source: 'macos',
    startedAt: '2026-10-01T10:00:00.000Z',
    durationSec: 1830,
    speakers: ['You', 'Speaker 1'],
    topics: ['Pricing'],
    actionItemCount: 2,
    hasAudio: true,
    language: 'en',
    error: null,
    summary: {
      summary: 'We raised the price.\n\nAnnual stays.',
      keyTopics: ['Pricing', 'Launch'],
      actionItems: [
        { id: 'a1', text: 'Write the launch email', owner: 'Maya', due: 'Oct 30', done: false },
        { id: 'a2', text: 'Update the pricing page', owner: null, due: null, done: true },
      ],
      decisions: ['Pro is $29'],
      model: 'anthropic/claude-haiku-4.5',
    },
    segments: [
      { speaker: 'You', startMs: 0, endMs: 3000, text: 'Okay, pricing.' },
      { speaker: 'You', startMs: 3500, endMs: 6000, text: 'Pro goes to 29.' },
      { speaker: 'Speaker 1', startMs: 7000, endMs: 12000, text: 'Customers will riot.' },
      { speaker: 'You', startMs: 13000, endMs: 18000, text: 'Annual stays at 240.' },
    ],
    audioUrl: 'https://media.example.com/a.m4a',
    ...overrides,
  };
}
