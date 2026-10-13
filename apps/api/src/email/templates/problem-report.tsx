import { Text } from '@react-email/components';
import { Layout, styles } from './layout';

/** To the operator: someone sent a report from the Mac app. The log stays in the database. */
export function ProblemReportEmail(props: {
  reportId: string;
  kind: 'user' | 'hang';
  from: string;
  app: string;
  system: string;
  message: string;
  logBytes: number;
}) {
  const heading = props.kind === 'hang' ? 'The Mac app was stuck' : 'New problem report';
  return (
    <Layout preview={`${props.from} · ${props.app}`}>
      <Text style={styles.h1}>{heading}</Text>
      <Text style={styles.p}>
        <strong>From:</strong> {props.from}
        <br />
        <strong>App:</strong> {props.app}
        <br />
        <strong>Mac:</strong> {props.system || 'unknown'}
      </Text>
      <Text style={{ ...styles.p, whiteSpace: 'pre-wrap' }}>{props.message || '(no message)'}</Text>
      <Text style={styles.muted}>
        Report {props.reportId} · log {Math.ceil(props.logBytes / 1024)} KB. Read it with: node dist/reports.js {props.reportId}
      </Text>
    </Layout>
  );
}
