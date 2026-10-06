/** Object layout in the private bucket: users/<userId>/meetings/<meetingId>/<file>. */
export const meetingPrefix = (userId: string, meetingId: string): string => `users/${userId}/meetings/${meetingId}/`;

const AUDIO_EXTENSIONS: Record<string, string> = {
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

export const audioExtension = (contentType: string): string => AUDIO_EXTENSIONS[contentType] ?? 'bin';

export const audioKey = (userId: string, meetingId: string, contentType: string): string =>
  `${meetingPrefix(userId, meetingId)}audio.${audioExtension(contentType)}`;

export const transcriptKey = (userId: string, meetingId: string): string =>
  `${meetingPrefix(userId, meetingId)}transcript.json`;

/** Each summary run is kept, so a reprocess never overwrites the previous result. */
export const summaryKey = (userId: string, meetingId: string, at: Date): string =>
  `${meetingPrefix(userId, meetingId)}summary-${at.toISOString().replace(/[:.]/g, '-')}.json`;
