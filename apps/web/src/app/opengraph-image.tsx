import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';

export const alt = 'BoringTalks: two cartoon heads in a call, and the line “Your meeting, minus the meeting.”';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpengraphImage() {
  const icon = await readFile(join(process.cwd(), 'src/app/icon.svg'));
  const src = `data:image/svg+xml;base64,${icon.toString('base64')}`;
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: '#5b67f5', padding: 70, alignItems: 'center', gap: 60 }}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <div style={{ fontSize: 34, fontWeight: 800, color: '#ffd140' }}>boringtalks.lol</div>
          <div style={{ fontSize: 92, fontWeight: 900, color: '#fff', lineHeight: 1, marginTop: 18, letterSpacing: -2 }}>Your meeting, minus the meeting.</div>
          <div style={{ fontSize: 32, color: 'rgba(255,255,255,0.9)', marginTop: 26, lineHeight: 1.3 }}>
            Recorded and transcribed on your Mac. Title, summary and action items written for you.
          </div>
        </div>
        <img src={src} width={360} height={360} alt="" />
      </div>
    ),
    size,
  );
}
