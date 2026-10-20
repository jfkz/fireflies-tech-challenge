# Contract fixtures

Example API bodies that the desktop apps' tests decode. `src/fixtures.test.ts` parses every file here
with its zod schema, so a contract change that breaks a fixture fails `pnpm test` before it can break a
client. The Windows tests (`apps/windows/tests`) read these files directly.

| File | Schema |
|---|---|
| `created-meeting.json` | `MeetingDetail` (`POST /meetings`) |
| `device-token-response.json` | `DeviceTokenResponse` (`POST /devices/token`) |
| `error-400.json` | `ApiError` |
| `latest-windows.json` | `LatestDownload` (`latest-windows.json` on the download host) |
| `me.json` | `Me` (`GET /me`) |
| `meeting-page.json` | `MeetingPage` (`GET /meetings`) |
| `problem-report-request.json` | `ProblemReportRequest` (`POST /reports`) |
| `problem-report-response.json` | `ProblemReportResponse` (`POST /reports`) |
| `transcript-upload.json` | `TranscriptUpload` (`PUT /meetings/:id/transcript`) |
| `upload-url-response.json` | `UploadUrlResponse` (`POST /meetings/:id/upload-url`) |
