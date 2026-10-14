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
/// Every Media Foundation object is created on the encoder's own thread (multithreaded apartment):
/// one made on the UI thread would route the encoder's calls through the UI thread's messages, and
/// the two deadlock (the app froze on "Yes, record" with an empty file).
/// </summary>
public sealed class RecordingWriter : IDisposable
{
    public const int EncoderRate = 48000;
    public const int BitRate = 96000;
    public const int StereoBitRate = 128000;
    /// <summary>Audio the encoder may fall behind by before newer audio is dropped rather than kept in memory.</summary>
    public static readonly TimeSpan MaxEncoderBacklog = TimeSpan.FromSeconds(30);

    private readonly BlockingCollection<Action> work = new();
    private readonly Thread worker;
    private readonly AudioMixer mixer;
    private readonly Resampler[] upsamplers;
    private readonly FeedProvider feed;
    private readonly Thread encoder;
    private readonly Action<string>? log;
    private long framesWritten;
    private volatile Exception? encoderError;
    private bool reportedPadding;
    private bool reportedDropping;

    public RecordingWriter(string path, Action<string>? log = null, bool stereo = false)
    {
        Path = path;
        this.log = log;
        // Each side levelled first: a quiet headset microphone sounds as loud as the call.
        mixer = new AudioMixer(stereo: stereo, level: true);
        upsamplers = [.. Enumerable.Range(0, mixer.Channels).Select(_ => new Resampler(16000, EncoderRate))];
        var format = new WaveFormat(EncoderRate, 16, mixer.Channels);
        feed = new FeedProvider(format, (long)(format.AverageBytesPerSecond * MaxEncoderBacklog.TotalSeconds));
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(path)!);
        worker = new Thread(() => { foreach (var job in work.GetConsumingEnumerable()) job(); }) { IsBackground = true, Name = "BoringTalks writer" };
        worker.Start();
        var bitRate = stereo ? StereoBitRate : BitRate;
        encoder = new Thread(() => Encode(path, bitRate)) { IsBackground = true, Name = "BoringTalks encoder" };
        encoder.SetApartmentState(ApartmentState.MTA);
        encoder.Start();
    }

    /// <summary>On the encoder thread: everything Media Foundation is made and used here, and only here.</summary>
    private void Encode(string path, int bitRate)
    {
        try
        {
            MediaFoundationApi.Startup();
            var mediaType = MediaFoundationEncoder.SelectMediaType(AudioSubtypes.MFAudioFormat_AAC, feed.WaveFormat, bitRate)
                ?? throw new NotSupportedException("This Windows has no AAC encoder (an N edition without the Media Feature Pack?).");
            using var mf = new MediaFoundationEncoder(mediaType);
            mf.Encode(path, feed);
        }
        catch (Exception error)
        {
            encoderError = error;
            // Nobody reads the feed any more: stop queueing audio for it.
            feed.Complete();
            log?.Invoke(error is NotSupportedException or System.Runtime.InteropServices.COMException or DllNotFoundException
                ? $"recording without an audio file: {error.Message}"
                : $"couldn't encode the recording: {error.Message}");
        }
    }

    public string Path { get; }

    /// <summary>False when Windows can't encode AAC here; the meeting then uploads its transcript only.</summary>
    public bool HasFile => encoderError is null;

    public void Append(float[] samples, AudioChannel channel) => Post(() =>
    {
        mixer.Append(samples, channel);
        Write(mixer.Drain());
        if (mixer.PaddedSamples > 0 && !reportedPadding)
        {
            reportedPadding = true;
            log?.Invoke($"a side fell more than {AudioMixer.DefaultMaxLag / 16000} s behind; recording it as silence");
        }
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
        await Task.Run(() => encoder.Join(TimeSpan.FromSeconds(30)));
        return framesWritten / 16000.0;
    }

    private void Post(Action job)
    {
        try
        {
            work.Add(job);
        }
        catch (InvalidOperationException)
        {
            // Finished: audio that arrives after the end isn't part of the recording.
        }
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
        if (!feed.Add(bytes) && !reportedDropping)
        {
            reportedDropping = true;
            log?.Invoke($"the encoder is more than {MaxEncoderBacklog.TotalSeconds:0} s behind; dropping audio");
        }
    }

    public void Dispose()
    {
        work.CompleteAdding();
        feed.Complete();
        worker.Join(TimeSpan.FromSeconds(2));
        work.Dispose();
    }

    /// <summary>
    /// PCM the encoder pulls; blocks until there is more, and ends when completed. Holds at most
    /// <paramref name="maxBytes"/>: an encoder that stops pulling must not fill the memory.
    /// </summary>
    internal sealed class FeedProvider(WaveFormat format, long maxBytes) : IWaveProvider
    {
        private readonly BlockingCollection<byte[]> chunks = new();
        private byte[] current = [];
        private int offset;
        private long queued;

        public WaveFormat WaveFormat { get; } = format;

        public long QueuedBytes => Interlocked.Read(ref queued);

        /// <summary>False when it was dropped: completed, or the encoder is too far behind.</summary>
        public bool Add(byte[] bytes)
        {
            if (Interlocked.Read(ref queued) + bytes.Length > maxBytes) return false;
            try
            {
                Interlocked.Add(ref queued, bytes.Length);
                chunks.Add(bytes);
                return true;
            }
            catch (InvalidOperationException)
            {
                // Completed: the encoder stopped (or the recording ended) while this was on its way.
                Interlocked.Add(ref queued, -bytes.Length);
                return false;
            }
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
                    Interlocked.Add(ref queued, -next.Length);
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
