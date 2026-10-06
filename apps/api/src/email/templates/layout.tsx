import { Body, Container, Head, Hr, Html, Preview, Section, Text } from '@react-email/components';
import type { ReactNode } from 'react';

export const colors = { ink: '#1d1b16', muted: '#6b665c', accent: '#e8590c', paper: '#fbf8f1', card: '#ffffff', line: '#e9e3d6' };

export const styles = {
  h1: { fontSize: '22px', lineHeight: '28px', fontWeight: 700, margin: '0 0 12px', color: colors.ink },
  p: { fontSize: '15px', lineHeight: '23px', margin: '0 0 14px', color: colors.ink },
  muted: { fontSize: '13px', lineHeight: '20px', color: colors.muted, margin: '0 0 8px' },
  button: {
    backgroundColor: colors.accent,
    color: '#ffffff',
    borderRadius: '8px',
    padding: '12px 20px',
    fontSize: '15px',
    fontWeight: 600,
    textDecoration: 'none',
    display: 'inline-block',
  },
} as const;

export function Layout({ preview, children }: { preview: string; children: ReactNode }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: colors.paper, fontFamily: '-apple-system, Segoe UI, Helvetica, Arial, sans-serif', margin: 0 }}>
        <Container style={{ maxWidth: '560px', margin: '0 auto', padding: '32px 16px' }}>
          <Text style={{ fontSize: '16px', fontWeight: 800, color: colors.accent, margin: '0 0 16px' }}>BoringTalks</Text>
          <Section style={{ backgroundColor: colors.card, border: `1px solid ${colors.line}`, borderRadius: '12px', padding: '28px' }}>
            {children}
          </Section>
          <Hr style={{ borderColor: colors.line, margin: '24px 0 12px' }} />
          <Text style={styles.muted}>BoringTalks takes notes so you don't have to.</Text>
        </Container>
      </Body>
    </Html>
  );
}
