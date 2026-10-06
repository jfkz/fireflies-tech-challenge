import { Button, Section, Text } from '@react-email/components';
import type { ActionItem } from '@boringtalks/shared';
import { colors, Layout, styles } from './layout';

export interface MeetingReadyProps {
  title: string;
  description: string | null;
  summary: string;
  actionItems: ActionItem[];
  url: string;
}

/** Owners the recording user is called in transcripts. */
const isYou = (owner: string | null) => owner?.trim().toLowerCase() === 'you';

export function MeetingReadyEmail({ title, description, summary, actionItems, url }: MeetingReadyProps) {
  const mine = actionItems.filter((a) => isYou(a.owner));
  const others = actionItems.filter((a) => !isYou(a.owner));
  return (
    <Layout preview={description ?? title}>
      <Text style={styles.muted}>Your meeting notes are ready</Text>
      <Text style={styles.h1}>{title}</Text>
      {description ? <Text style={{ ...styles.p, color: colors.muted }}>{description}</Text> : null}
      <Text style={styles.p}>{summary}</Text>
      {actionItems.length > 0 ? (
        <Section style={{ margin: '8px 0 18px' }}>
          <Text style={{ ...styles.p, fontWeight: 700, margin: '0 0 8px' }}>Action items</Text>
          {[...mine, ...others].map((a) => (
            <Text
              key={a.id}
              style={{
                ...styles.p,
                margin: '0 0 6px',
                padding: isYou(a.owner) ? '6px 10px' : '0 10px',
                backgroundColor: isYou(a.owner) ? '#fff1e6' : 'transparent',
                borderRadius: '6px',
              }}
            >
              {a.done ? '☑' : '☐'} {a.text}
              {a.owner ? <strong style={{ color: isYou(a.owner) ? colors.accent : colors.muted }}> — {a.owner}</strong> : null}
              {a.due ? <span style={{ color: colors.muted }}> · due {a.due}</span> : null}
            </Text>
          ))}
        </Section>
      ) : null}
      <Button href={url} style={styles.button}>
        Open the meeting
      </Button>
    </Layout>
  );
}
