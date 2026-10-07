import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../config/config.module';

/** The parts of a Recall.ai bot we read (GET /api/v1/bot/{id}/). */
export interface RecallBot {
  id: string;
  recordings?: {
    id: string;
    started_at?: string | null;
    completed_at?: string | null;
    media_shortcuts?: {
      transcript?: { status?: { code?: string }; data?: { download_url?: string | null } } | null;
      audio_mixed?: { status?: { code?: string }; data?: { download_url?: string | null } } | null;
    } | null;
  }[];
}

/** One block of the transcript download: a participant and the words they said. */
export interface RecallTranscriptEntry {
  participant: { id: number; name: string | null; is_host?: boolean | null };
  language_code?: string | null;
  words: { text: string; start_timestamp: { relative: number }; end_timestamp: { relative: number } | null }[];
}

export class RecallError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Recall.ai's meeting bot API: a bot joins the call as a participant, records it, and gives us
 * its transcript (with participant names) and mixed audio when it's done.
 */
@Injectable()
export class RecallClient {
  private readonly logger = new Logger(RecallClient.name);

  constructor(private readonly config: AppConfig) {}

  get enabled(): boolean {
    return !!this.config.env.RECALL_API_KEY;
  }

  /** Sends a bot to `meetingUrl` (now, or at `joinAt`). `metadata` comes back in webhooks. */
  createBot(input: { meetingUrl: string; joinAt?: Date; metadata: Record<string, string> }): Promise<{ id: string }> {
    return this.request('POST', '/api/v1/bot/', {
      meeting_url: input.meetingUrl,
      bot_name: this.config.env.RECALL_BOT_NAME,
      ...(input.joinAt ? { join_at: input.joinAt.toISOString() } : {}),
      metadata: input.metadata,
      recording_config: {
        // Accuracy over latency: we only need the transcript once the call is over.
        transcript: { provider: { recallai_streaming: { mode: 'prioritize_accuracy' } } },
        audio_mixed_mp3: {},
      },
    });
  }

  getBot(id: string): Promise<RecallBot> {
    return this.request('GET', `/api/v1/bot/${encodeURIComponent(id)}/`);
  }

  /** Asks the bot to leave the call now; the recording so far is kept. */
  async leaveCall(id: string): Promise<void> {
    await this.request('POST', `/api/v1/bot/${encodeURIComponent(id)}/leave_call/`, {});
  }

  /** Download URL of the recording's mixed audio (MP3), or null while there is none. */
  async audioMixedUrl(recordingId: string): Promise<string | null> {
    const page = await this.request<{ results?: { data?: { download_url?: string | null } }[] }>(
      'GET',
      `/api/v1/audio_mixed/?recording_id=${encodeURIComponent(recordingId)}`,
    );
    return page.results?.find((r) => r.data?.download_url)?.data?.download_url ?? null;
  }

  /** Download URLs are pre-signed; no API key goes with them. */
  async download(url: string): Promise<Uint8Array> {
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new RecallError(`Download failed with ${res.status}`, res.status);
    return new Uint8Array(await res.arrayBuffer());
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const key = this.config.env.RECALL_API_KEY;
    if (!key) throw new RecallError('Meeting bots are not set up on this server', 503);
    const res = await fetch(`${this.config.env.RECALL_BASE_URL.replace(/\/+$/, '')}${path}`, {
      method,
      headers: { Authorization: `Token ${key}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    if (!res.ok) {
      this.logger.warn({ method, path, status: res.status, body: text.slice(0, 500) }, 'Recall request failed');
      throw new RecallError(recallMessage(text) ?? `Recall answered ${res.status}`, res.status);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }
}

/** Recall's error bodies vary ({"detail": …}, {"meeting_url": ["…"]}); find something readable. */
export function recallMessage(text: string): string | null {
  try {
    const body: unknown = JSON.parse(text);
    if (body && typeof body === 'object') {
      for (const value of Object.values(body)) {
        if (typeof value === 'string') return value;
        if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
      }
    }
  } catch {
    // Not JSON.
  }
  return null;
}
