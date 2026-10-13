#!/usr/bin/env node
// The version a desktop release gets: one patch above the build that's live for that target, or
// the repo's version when that is higher already (a new minor). Installers and the Windows
// updater refuse anything that isn't newer than what's installed, so every release moves up.
//
//   node scripts/next-version.mjs <version in the repo> <manifest URL>
//   node scripts/next-version.mjs 0.5.0 https://download.boringtalks.lol/dev/latest-windows.json   # → 0.5.1
//
// The manifest is latest.json (Mac) or latest-windows.json, prod or dev/; a missing one (404)
// means nothing is out yet. Prints the version and nothing else.
import { pathToFileURL } from 'node:url';

/** "0.5.3-dev.4+77" → [0, 5, 3]; null if it isn't a version. */
export function parse(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version ?? '').trim());
  return m ? m.slice(1, 4).map(Number) : null;
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

export function nextVersion(repo, live) {
  const mine = parse(repo);
  if (!mine) throw new Error(`not a version: ${repo}`);
  const out = parse(live);
  if (!out || compare(mine, out) > 0) return mine.join('.');
  return [out[0], out[1], out[2] + 1].join('.');
}

async function liveVersion(url) {
  const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()).version ?? null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [repo, url] = process.argv.slice(2);
  if (!repo || !url) {
    console.error('usage: next-version.mjs <version in the repo> <manifest URL>');
    process.exit(2);
  }
  console.log(nextVersion(repo, await liveVersion(url)));
}
