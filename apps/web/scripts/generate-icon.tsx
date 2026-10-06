/**
 * Renders the AppIcon React component to src/app/icon.svg: the favicon, also
 * embedded in the Open Graph image, and src/app/og-heads.svg for the social preview.
 * Run after changing the heads: `pnpm icon`.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { Avatar } from '../src/components/avatar/Avatar';
import { AppIcon } from '../src/components/brand/AppIcon';
import { stillPose } from '../src/lib/avatar/pose';
import { MEN, WOMEN } from '../src/lib/avatar/styles';

const svg = renderToStaticMarkup(<AppIcon />)
  .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
  .replace(/ aria-hidden="true"/g, '')
  // Nested head SVGs need the namespace too when the file stands alone.
  .replace(/<svg viewBox="0 0 200 200"/g, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"');
writeFileSync(join(import.meta.dirname, '../src/app/icon.svg'), svg + '\n');
console.log(`icon.svg: ${svg.length} bytes`);

// The four people from the landing page's meeting, for the social preview image:
// one talking, one yawning, one asleep, one cheering.
const SEATS = [WOMEN[2], MEN[2], MEN[3], WOMEN[0]];
const POSES = [
  stillPose({ mouth: 0.45, emotion: 'happy' }),
  stillPose({ yawn: 1 }),
  stillPose({ sleep: 1, tilt: 0.16 }),
  stillPose({ joy: 1, emotion: 'happy' }),
];
const heads = renderToStaticMarkup(
  <svg viewBox="0 0 800 200" xmlns="http://www.w3.org/2000/svg">
    {SEATS.map((style, i) => (
      <Avatar key={style.name} style={style} pose={POSES[i]} x={i * 200} y={0} width={200} height={200} />
    ))}
  </svg>,
).replace(/<svg viewBox="0 0 200 200"/g, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"');
writeFileSync(join(import.meta.dirname, '../src/app/og-heads.svg'), heads + '\n');
console.log(`og-heads.svg: ${heads.length} bytes`);
