/* eslint-disable @next/next/no-img-element -- rendered by ImageResponse (Satori), not the browser: next/image does not apply. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';

export const SOCIAL_ALT = 'BoringTalks: four cartoon heads stuck in a meeting, and the line “Your meeting, minus the meeting.”';
export const SOCIAL_SIZE = { width: 1200, height: 630 };

const asset = async (name: string) => `data:image/svg+xml;base64,${(await readFile(join(process.cwd(), 'src/app', name))).toString('base64')}`;

/** The link preview: tagline over the meeting table, the four heads behind it. */
export async function socialImage() {
  const [icon, heads] = await Promise.all([asset('icon.svg'), asset('og-heads.svg')]);
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#5b67f5', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '48px 70px 0' }}>
          <img src={icon} width={64} height={64} alt="" />
          <div style={{ fontSize: 38, fontWeight: 900, color: '#fff' }}>BoringTalks</div>
          <div style={{ marginLeft: 'auto', fontSize: 28, fontWeight: 800, color: '#ffd140' }}>boringtalks.lol</div>
        </div>
        <div style={{ fontSize: 84, fontWeight: 900, color: '#fff', lineHeight: 1, letterSpacing: -2, padding: '34px 70px 0', maxWidth: 1000 }}>
          Your meeting, minus the meeting.
        </div>
        <div style={{ fontSize: 30, color: 'rgba(255,255,255,0.92)', padding: '20px 70px 0', lineHeight: 1.3, maxWidth: 1000 }}>
          Who said what, what was decided, and every task with a due date.
        </div>
        <img src={heads} width={720} height={180} alt="" style={{ position: 'absolute', right: 60, bottom: 52 }} />
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 74, background: '#3845db', borderTop: '6px solid #292133' }} />
      </div>
    ),
    SOCIAL_SIZE,
  );
}
