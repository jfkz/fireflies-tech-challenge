/**
 * Renders the AppIcon React component to src/app/icon.svg: the favicon, also
 * embedded in the Open Graph image. Run after changing the heads: `pnpm icon`.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppIcon } from '../src/components/brand/AppIcon';

const svg = renderToStaticMarkup(<AppIcon />)
  .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
  .replace(/ aria-hidden="true"/g, '')
  // Nested head SVGs need the namespace too when the file stands alone.
  .replace(/<svg viewBox="0 0 200 200"/g, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"');
writeFileSync(join(import.meta.dirname, '../src/app/icon.svg'), svg + '\n');
console.log(`icon.svg: ${svg.length} bytes`);
