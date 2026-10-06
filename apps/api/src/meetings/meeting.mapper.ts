import type { MeetingDetail, MeetingListItem, Segment } from '@boringtalks/shared';
import type { MeetingRow, SummaryRow } from '../db/schema';

export function toListItem(row: MeetingRow, actionItemCount: number): MeetingListItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    source: row.source,
    startedAt: row.startedAt.toISOString(),
    durationSec: row.durationSec,
    speakers: row.speakers,
    actionItemCount,
    hasAudio: row.hasAudio,
  };
}

export function toDetail(
  row: MeetingRow,
  summary: SummaryRow | null,
  segments: Segment[],
  audioUrl: string | null,
): MeetingDetail {
  return {
    ...toListItem(row, summary?.actionItems.length ?? 0),
    language: row.language,
    error: row.error,
    summary: summary
      ? {
          summary: summary.summary,
          keyTopics: summary.keyTopics,
          actionItems: summary.actionItems,
          decisions: summary.decisions,
          model: summary.model,
        }
      : null,
    segments,
    audioUrl,
  };
}

const titleFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'UTC',
});

/** Placeholder until the summarizer names the meeting: "Meeting on Oct 6, 14:05" (UTC). */
export function defaultTitle(startedAt: Date): string {
  return `Meeting on ${titleFormat.format(startedAt)}`;
}
