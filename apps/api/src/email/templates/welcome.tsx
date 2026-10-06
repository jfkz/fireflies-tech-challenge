import { Button, Text } from '@react-email/components';
import { Layout, styles } from './layout';

export const DOWNLOAD_URL = 'https://boringtalks.lol/#download';

export function WelcomeEmail({ name, dashboardUrl }: { name: string | null; dashboardUrl: string }) {
  return (
    <Layout preview="Your meetings are about to get a lot less boring.">
      <Text style={styles.h1}>{`Welcome${name ? `, ${name}` : ''}!`}</Text>
      <Text style={styles.p}>
        BoringTalks records your meetings, transcribes them on your Mac and writes the notes: a real title, a short summary,
        decisions and action items.
      </Text>
      <Text style={styles.p}>We added a demo meeting to your dashboard so you can see what a finished one looks like.</Text>
      <Button href={DOWNLOAD_URL} style={styles.button}>
        Download BoringTalks for Mac
      </Button>
      <Text style={{ ...styles.muted, marginTop: '18px' }}>
        No Mac at hand? Record or upload audio right in the <a href={dashboardUrl}>dashboard</a>.
      </Text>
    </Layout>
  );
}
