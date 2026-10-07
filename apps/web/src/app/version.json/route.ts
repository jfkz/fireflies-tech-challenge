import { BUILD } from '@/lib/version';

// Each deployment answers with its own build, so an open tab can tell a newer one is live.
// Uncached: a CDN or browser copy would hide the new deployment.
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(BUILD, { headers: { 'Cache-Control': 'no-store' } });
}
