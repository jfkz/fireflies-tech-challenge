/** Which build of the web app this is, and how to tell that a newer one is live. */
export interface BuildInfo {
  version: string;
  /** Short commit SHA, or "dev" for a local build. */
  commit: string;
}

/** Baked in at build time by next.config.ts (package.json version, GITHUB_SHA). */
export const BUILD: BuildInfo = {
  version: process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0',
  commit: process.env.NEXT_PUBLIC_BUILD_COMMIT || 'dev',
};

/** Served by every deployment with its own build info (app/version.json/route.ts). */
export const VERSION_PATH = '/version.json';

export function versionLabel(build: BuildInfo): string {
  return build.commit === 'dev' ? `v${build.version} · dev` : `v${build.version} · ${build.commit}`;
}

/** The live deployment is a different build. Local builds never ask to reload. */
export function isNewBuild(live: BuildInfo, current: BuildInfo = BUILD): boolean {
  return current.commit !== 'dev' && live.commit !== 'dev' && live.commit !== current.commit;
}

export function parseBuildInfo(value: unknown): BuildInfo | null {
  if (!value || typeof value !== 'object') return null;
  const { version, commit } = value as Record<string, unknown>;
  return typeof version === 'string' && typeof commit === 'string' && commit !== '' ? { version, commit } : null;
}

// Shared by the poller (UpdatePrompt) and the footers (VersionTag).
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function subscribeToVersion(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let live: BuildInfo | null = null;

/** A newer deployment than this tab's, once one has been seen. */
export function liveBuild(): BuildInfo | null {
  return live;
}

export function setLiveBuild(build: BuildInfo | null): void {
  if (build?.commit === live?.commit) return;
  live = build;
  emit();
}

// Work that a reload would throw away (a recording in progress) holds the update prompt back.
const holds = new Set<symbol>();

/** Returns the release function. */
export function holdUpdates(): () => void {
  const token = Symbol('hold');
  holds.add(token);
  emit();
  return () => {
    if (holds.delete(token)) emit();
  };
}

export function updatesHeld(): boolean {
  return holds.size > 0;
}
