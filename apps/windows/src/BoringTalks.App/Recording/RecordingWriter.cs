using System.Collections.Concurrent;
using NAudio.MediaFoundation;
using NAudio.Wave;
using BoringTalks.Core.Audio;
using BoringTalks.Core.Transcript;

namespace BoringTalks.App.Recording;

/// <summary>
/// Writes the meeting as one AAC file (.m4a, 48 kHz): mono at 96 kbps (about 43 MB an hour), or,
/// for the server to transcribe, stereo at 128 kbps with the microphone left and the PC's sound right.
/// Mono:
/// both channels mixed on the meeting clock, then encoded by Windows' Media Foundation on a
/// thread of its own so the audio threads never wait for the encoder. Windows' AAC encoder only
/// takes 44.1 or 48 kHz and 96 kbps and up, so the 16 kHz mix is resampled on the way in.
/// </summary>
public sealed class RecordingWriter : IDisposable
{
    public const int EncoderRate = 48000;
    public const int BitRate = 96000;
    public const int StereoBitRate = 128000;

    private readonly BlockingCollection<Action> work = new();
    private readonly Thread worker;
    private readonly AudioMixer mixer;
    private readonly Resampler[] upsamplers;
    private readonly FeedProvider feed;
    private readonly Thread? encoder;
    private readonly Action<string>? log;
    private long framesWritten;
    private Exception? encoderError;

    public RecordingWriter(string path, Action<string>? log = null, bool stereo = false)
    {
        Path = path;
        this.log = log;
        mixer = new AudioMixer(stereo: stereo);
        upsamplers = [.. Enumerable.Range(0, mixer.Channels).Select(_ => new Resampler(16000, EncoderRate))];
        feed = new FeedProvider(new WaveFormat(EncoderRate, 16, mixer.Channels));
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(path)!);
        worker = new Thread(() => { foreach (var job in work.GetConsumingEnumerable()) job(); }) { IsBackground = true, Name = "BoringTalks writer" };
        worker.Start();
        try
        {
            MediaFoundationApi.Startup();
            var mediaType = MediaFoundationEncoder.SelectMediaType(AudioSubtypes.MFAudioFormat_AAC, feed.WaveFormat, stereo ? StereoBitRate : BitRate)
                ?? throw new NotSupportedException("This Windows has no AAC encoder (an N edition without the Media Feature Pack?).");
            encoder = new Thread(() =>
            {
                try
                {
                    using var mf = new MediaFoundationEncoder(mediaType);
                    mf.Encode(path, feed);
                }
                catch (Exception error)
                {
                    encoderError = error;
                    log?.Invoke($"couldn't encode the recording: {error.Message}");
                }
            }) { IsBackground = true, Name = "BoringTalks encoder" };
            encoder.Start();
        }
        catch (Exception error) when (error is NotSupportedException or System.Runtime.InteropServices.COMException or DllNotFoundException)
        {
            encoderError = error;
            log?.Invoke($"recording without an audio file: {error.Message}");
        }
    }

    public string Path { get; }

    /// <summary>False when Windows can't encode AAC here; the meeting then uploads its transcript only.</summary>
    public bool HasFile => encoderError is null;

    public void Append(float[] samples, AudioChannel channel) => Post(() =>
    {
        mixer.Append(samples, channel);
        Write(mixer.Drain());
    });

    /// <summary>A channel that couldn't start: mix without waiting for it.</summary>
    public void Remove(AudioChannel channel) => Post(() =>
    {
        mixer.Remove(channel);
        Write(mixer.Drain());
    });

    /// <summary>Writes what is left and closes the file. Returns the seconds written.</summary>
    public async Task<double> FinishAsync()
    {
        var done = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        Post(() =>
        {
            Write(mixer.Drain(flush: true));
            done.SetResult();
        });
        await done.Task;
        work.CompleteAdding();
        feed.Complete();
        await Task.Run(() => encoder?.Join(TimeSpan.FromSeconds(30)));
        return framesWritten / 16000.0;
    }

    private void Post(Action job)
    {
        if (!work.IsAddingCompleted) work.Add(job);
    }

    /// <summary><paramref name="samples"/>: 16 kHz frames, interleaved when stereo.</summary>
    private void Write(float[] samples)
    {
        if (samples.Length == 0) return;
        var channels = upsamplers.Length;
        framesWritten += samples.Length / channels;
        if (!HasFile) return;
        // Each side through its own resampler, then interleaved again.
        var sides = new float[channels][];
        for (var c = 0; c < channels; c++)
        {
            var side = new float[samples.Length / channels];
            for (var i = 0; i < side.Length; i++) side[i] = samples[i * channels + c];
            sides[c] = upsamplers[c].Process(side);
        }
        var frames = sides.Min(s => s.Length);
        var bytes = new byte[frames * channels * 2];
        for (var i = 0; i < frames; i++)
        {
            for (var c = 0; c < channels; c++)
            {
                var v = (short)Math.Clamp(sides[c][i] * 32767f, short.MinValue, short.MaxValue);
                var at = (i * channels + c) * 2;
                bytes[at] = (byte)v;
                bytes[at + 1] = (byte)(v >> 8);
            }
        }
        feed.Add(bytes);
    }

    public void Dispose()
    {
        work.CompleteAdding();
        feed.Complete();
        worker.Join(TimeSpan.FromSeconds(2));
        work.Dispose();
    }

    /// <summary>PCM the encoder pulls; blocks until there is more, and ends when completed.</summary>
    private sealed class FeedProvider(WaveFormat format) : IWaveProvider
    {
        private readonly BlockingCollection<byte[]> chunks = new();
        private byte[] current = [];
        private int offset;

        public WaveFormat WaveFormat { get; } = format;

        public void Add(byte[] bytes)
        {
            if (!chunks.IsAddingCompleted) chunks.Add(bytes);
        }

        public void Complete() => chunks.CompleteAdding();

        public int Read(byte[] buffer, int start, int count)
        {
            // Whole samples only (every chunk is whole samples too).
            count -= count % WaveFormat.BlockAlign;
            var written = 0;
            while (written < count)
            {
                if (offset >= current.Length)
                {
                    // Hand over what we have rather than wait for a full buffer, but never return 0 before the end.
                    if (written > 0 && chunks.Count == 0) break;
                    if (!chunks.TryTake(out var next, Timeout.Infinite)) break;
                    current = next;
                    offset = 0;
                }
                var n = Math.Min(count - written, current.Length - offset);
                Buffer.BlockCopy(current, offset, buffer, start + written, n);
                offset += n;
                written += n;
            }
            return written;
        }
    }
}
