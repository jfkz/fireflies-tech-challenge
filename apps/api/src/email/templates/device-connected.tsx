import { Button, Text } from '@react-email/components';
import { Layout, styles } from './layout';

export function DeviceConnectedEmail({ deviceName, connectedAt, settingsUrl }: { deviceName: string; connectedAt: string; settingsUrl: string }) {
  return (
    <Layout preview={`${deviceName} can now upload meetings to your account.`}>
      <Text style={styles.h1}>New Mac connected</Text>
      <Text style={styles.p}>
        <strong>{deviceName}</strong> was connected to your BoringTalks account on {connectedAt} and can now upload meetings.
      </Text>
      <Text style={styles.p}>If this wasn't you, disconnect it right away.</Text>
      <Button href={settingsUrl} style={styles.button}>
        Review connected Macs
      </Button>
    </Layout>
  );
}
