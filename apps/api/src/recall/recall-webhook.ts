import { createHmac, timingSafeEqual } from 'node:crypto';
import type { BotStatus } from '@boringtalks/shared';

/** Webhooks older or newer than this are refused (replays). */
const TOLERANCE_SEC = 5 * 60;

type Headers = Record<string, string | string[] | undefined>;

const header = (h: Headers, name: string): string | undefined => {
  const v = h[name];
  return Array.isArray(v) ? v[0] : v;
};

/**
 * Checks a Recall.ai webhook (Svix-style): HMAC-SHA256 over "<id>.<timestamp>.<body>" with the
 * workspace secret ("whsec_<base64>"). Newer accounts send webhook-* headers, older svix-*.
 */
export function verifyRecallWebhook(secret: string, headers: Headers, rawBody: string, nowSec = Math.floor(Date.now() / 1000)): boolean {
  const id = header(headers, 'webhook-id') ?? header(headers, 'svix-id');
  const timestamp = header(headers, 'webhook-timestamp') ?? header(headers, 'svix-timestamp');
  const signatures = header(headers, 'webhook-signature') ?? header(headers, 'svix-signature');
  if (!id || !timestamp || !signatures || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(nowSec - Number(timestamp)) > TOLERANCE_SEC) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest();
  return signatures.split(' ').some((entry) => {
    const [version, sig] = entry.split(',');
    if (version !== 'v1' || !sig) return false;
    const given = Buffer.from(sig, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** What a bot status webhook means for the meeting. */
export function botStatusFor(event: string): BotStatus | null {
  switch (event) {
    case 'bot.joining_call':
      return 'joining';
    case 'bot.in_waiting_room':
      return 'waiting_room';
    case 'bot.in_call_not_recording':
    case 'bot.recording_permission_allowed':
      return 'in_call';
    case 'bot.in_call_recording':
      return 'recording';
    case 'bot.call_ended':
      return 'left';
    case 'bot.done':
      return 'done';
    case 'bot.fatal':
    case 'bot.recording_permission_denied':
      return 'failed';
    default:
      return null;
  }
}

/** Why a bot gave up, in words (Recall's sub codes, e.g. "meeting_not_found"). */
export function botFailureMessage(event: string, subCode: string | null | undefined): string {
  if (event === 'bot.recording_permission_denied') return 'The host didn’t allow the bot to record.';
  const reasons: Record<string, string> = {
    meeting_not_found: 'The meeting link didn’t lead to a meeting.',
    meeting_requires_registration: 'The meeting needs a registration the bot can’t do.',
    meeting_password_incorrect: 'The meeting password in the link is wrong.',
    bot_kicked_from_waiting_room: 'Nobody let the bot in from the waiting room.',
    timeout_exceeded_waiting_room: 'Nobody let the bot in from the waiting room.',
    bot_kicked_from_call: 'Someone removed the bot from the call.',
    meeting_not_started: 'The meeting never started.',
  };
  return (subCode && reasons[subCode]) ?? `The bot couldn’t record the meeting${subCode ? ` (${subCode.replace(/_/g, ' ')})` : ''}.`;
}
