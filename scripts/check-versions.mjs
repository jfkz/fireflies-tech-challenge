#!/usr/bin/env node
// The Mac app, the API and the web app share a minor version: 0.4.x everywhere.
// Bump the minor on all three together; patch releases may differ.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

const versions = {
  'apps/api/package.json': JSON.parse(read('apps/api/package.json')).version,
  'apps/web/package.json': JSON.parse(read('apps/web/package.json')).version,
  'apps/macos/project.yml (MARKETING_VERSION)': read('apps/macos/project.yml').match(/MARKETING_VERSION:\s*"?([^"\s]+)"?/)?.[1],
};

const minor = (v) => v?.match(/^(\d+)\.(\d+)\.\d+/)?.slice(1, 3).join('.');
for (const [where, version] of Object.entries(versions)) console.log(`${version ?? '(missing)'}\t${where}`);

const minors = new Set(Object.values(versions).map(minor));
if (minors.has(undefined) || minors.size !== 1) {
  console.error('\nThe app and the backend must share major.minor (patch may differ). Bump the minor on all three together.');
  process.exit(1);
}
console.log(`\nAll on ${[...minors][0]}.x`);
