export interface Env {
  apiUrl: string;
  siteUrl: string;
  firebase: {
    apiKey?: string;
    authDomain?: string;
    projectId?: string;
    appId?: string;
    authEmulator?: string;
  };
}

function url(name: string, value: string): string {
  try {
    return new URL(value).toString().replace(/\/+$/, '');
  } catch {
    throw new Error(`${name} must be an absolute URL, got "${value}"`);
  }
}

const optional = (v: string | undefined) => (v && v.trim() !== '' ? v.trim() : undefined);

/**
 * Typed public env. Each NEXT_PUBLIC_ variable is referenced literally so Next
 * inlines it into the client bundle. (Plain code rather than zod: this module is
 * on every page, and zod is only loaded once the API is first called.)
 */
export const env: Env = {
  apiUrl: url('NEXT_PUBLIC_API_URL', process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'),
  siteUrl: url('NEXT_PUBLIC_SITE_URL', process.env.NEXT_PUBLIC_SITE_URL || 'https://boringtalks.lol'),
  firebase: {
    apiKey: optional(process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
    authDomain: optional(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN),
    projectId: optional(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID),
    appId: optional(process.env.NEXT_PUBLIC_FIREBASE_APP_ID),
    authEmulator: optional(process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR),
  },
};
