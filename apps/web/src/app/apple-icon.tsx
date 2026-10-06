import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/** Home-screen icon: the app icon on an opaque background (iOS ignores transparency). */
export default async function AppleIcon() {
  const icon = await readFile(join(process.cwd(), 'src/app/icon.svg'));
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: '#4a57e8' }}>
        <img src={`data:image/svg+xml;base64,${icon.toString('base64')}`} width={180} height={180} alt="" />
      </div>
    ),
    size,
  );
}
