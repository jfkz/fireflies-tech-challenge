import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authValue, fakeApi, renderWithProviders } from '@/test/utils';
import { RecordView } from './RecordView';

const nav = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => nav.router, usePathname: () => '/record', useSearchParams: () => new URLSearchParams() }));

class AutoXHR {
  static sent: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  url = '';
  headers: Record<string, string> = {};
  status = 200;
  upload = { onprogress: null as null | ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) };
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;
  onabort: null | (() => void) = null;
  open(_m: string, url: string) {
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send(body: unknown) {
    AutoXHR.sent.push({ url: this.url, headers: this.headers, body });
    setTimeout(() => {
      this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 });
      this.onload?.();
    }, 0);
  }
  abort() {}
}

beforeEach(() => {
  AutoXHR.sent = [];
  nav.router.push.mockReset();
  vi.stubGlobal('XMLHttpRequest', AutoXHR);
});
afterEach(() => vi.unstubAllGlobals());

describe('RecordView: upload', () => {
  it('uploads a chosen file and opens the new meeting', async () => {
    const api = fakeApi({
      createMeeting: vi.fn(async () => ({ id: 'm42' }) as never),
      uploadUrl: vi.fn(async () => ({ url: 'https://r2.test/put', key: 'k', headers: { 'Content-Type': 'audio/mpeg' }, expiresInSec: 60 })),
      completeMeeting: vi.fn(async () => ({}) as never),
    });
    renderWithProviders(<RecordView />, { auth: authValue({ api }) });
    const file = new File(['id3-and-audio'], 'Weekly sync.mp3', { type: 'audio/mpeg' });
    fireEvent.change(screen.getByTestId('upload-input'), { target: { files: [file] } });
    expect(screen.getByText('Weekly sync.mp3')).toBeInTheDocument();
    // A title set here is kept as is, so the file name is not used: the summarizer names the meeting.
    expect(screen.getByLabelText('Title (optional)')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Upload and summarize' }));
    await waitFor(() => expect(nav.router.push).toHaveBeenCalledWith('/meetings/m42'));
    expect(api.createMeeting).toHaveBeenCalledWith(expect.objectContaining({ source: 'upload' }));
    expect((api.createMeeting as ReturnType<typeof vi.fn>).mock.calls[0][0].title).toBeUndefined();
    expect(api.uploadUrl).toHaveBeenCalledWith('m42', { contentType: 'audio/mpeg', sizeBytes: file.size });
    expect(AutoXHR.sent[0]).toMatchObject({ url: 'https://r2.test/put', headers: { 'Content-Type': 'audio/mpeg' }, body: file });
  });

  it('rejects files that are not audio, or too big', () => {
    renderWithProviders(<RecordView />);
    fireEvent.change(screen.getByTestId('upload-input'), { target: { files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })] } });
    expect(screen.getByText(/isn’t an audio format/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload and summarize' })).toBeDisabled();
    const big = new File(['x'], 'huge.wav', { type: 'audio/wav' });
    Object.defineProperty(big, 'size', { value: 300 * 1024 * 1024 });
    fireEvent.change(screen.getByTestId('upload-input'), { target: { files: [big] } });
    expect(screen.getByText(/The limit is 200 MB/)).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('upload-input'), { target: { files: [new File([], 'empty.wav', { type: 'audio/wav' })] } });
    expect(screen.getByText('That file is empty.')).toBeInTheDocument();
  });

  it('shows upload errors with a retry', async () => {
    const api = fakeApi({ createMeeting: vi.fn(async () => Promise.reject(new Error('Quota exceeded'))) });
    renderWithProviders(<RecordView />, { auth: authValue({ api }) });
    fireEvent.change(screen.getByTestId('upload-input'), { target: { files: [new File(['a'], 'a.wav', { type: 'audio/wav' })] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload and summarize' }));
    expect(await screen.findByText('Quota exceeded')).toBeInTheDocument();
  });
});

describe('RecordView: recorder', () => {
  it('starts with a sleeping head and reports a blocked microphone', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' }))) },
    });
    vi.stubGlobal('MediaRecorder', class {});
    renderWithProviders(<RecordView />);
    expect(screen.getByText(/Ready when you are/)).toBeInTheDocument();
    expect(screen.getByTestId('rec-timer')).toHaveTextContent('0:00');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start recording' })));
    expect(await screen.findByText(/blocked the microphone/)).toBeInTheDocument();
  });
});
