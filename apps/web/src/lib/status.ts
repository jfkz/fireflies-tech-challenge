import type { MeetingStatus } from '@boringtalks/shared';

const PROCESSING: ReadonlySet<MeetingStatus> = new Set(['recording', 'uploaded', 'transcribing', 'summarizing']);

export function isProcessing(status: MeetingStatus | undefined): boolean {
  return !!status && PROCESSING.has(status);
}

export const STATUS_LABEL: Record<MeetingStatus, string> = {
  recording: 'Recording',
  uploaded: 'Uploaded',
  transcribing: 'Transcribing',
  summarizing: 'Summarizing',
  ready: 'Ready',
  failed: 'Failed',
};

/** What the waiting head says while a meeting is being processed. */
export const STATUS_QUIP: Record<MeetingStatus, string> = {
  recording: 'Still recording. Somebody is probably sharing their screen.',
  uploaded: 'Got the audio. Finding someone to listen to it.',
  transcribing: 'Listening to the whole thing so you don’t have to.',
  summarizing: 'Reading the transcript and writing down who promised what.',
  ready: 'Done. Nobody had to stay awake.',
  failed: 'Something went wrong while processing this meeting.',
};

/** Poll the meeting every 3 s while it is processing; stop once it is ready or failed. */
export function meetingPollInterval(status: MeetingStatus | undefined): number | false {
  return isProcessing(status) ? 3000 : false;
}
