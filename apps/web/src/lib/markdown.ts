import { formatDuration, type MeetingDetail } from '@boringtalks/shared';

/** The meeting's summary as Markdown, for the "Copy as Markdown" button. */
export function summaryToMarkdown(m: MeetingDetail): string {
  const lines: string[] = [`# ${m.title}`, ''];
  const date = new Date(m.startedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  lines.push(`*${date} UTC, ${formatDuration(m.durationSec)}${m.speakers.length ? `, ${m.speakers.join(', ')}` : ''}*`, '');
  if (m.description) lines.push(`> ${m.description}`, '');
  const s = m.summary;
  if (!s) return lines.join('\n').trimEnd() + '\n';
  lines.push('## Summary', '', s.summary.trim(), '');
  if (s.keyTopics.length) lines.push('## Key topics', '', ...s.keyTopics.map((t) => `- ${t}`), '');
  if (s.actionItems.length) {
    lines.push('## Action items', '');
    for (const a of s.actionItems) {
      const meta = [a.owner, a.due ? `due ${a.due}` : null].filter(Boolean).join(', ');
      lines.push(`- [${a.done ? 'x' : ' '}] ${a.text}${meta ? ` (${meta})` : ''}`);
    }
    lines.push('');
  }
  if (s.decisions.length) lines.push('## Decisions', '', ...s.decisions.map((d) => `- ${d}`), '');
  return lines.join('\n').trimEnd() + '\n';
}
