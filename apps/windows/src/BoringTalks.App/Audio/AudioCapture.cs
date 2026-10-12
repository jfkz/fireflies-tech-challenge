using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;
using NAudio.Wave;
using BoringTalks.Core.Audio;

namespace BoringTalks.App.Audio;

/// <summary>A chunk of captured audio as mono float samples at its own rate.</summary>
public readonly record struct CapturedAudio(float[] Samples, int SampleRate);

/// <summary>Turns WASAPI buffers (float or 16/24/32-bit integer, any channel count) into mono float.</summary>
public static class AudioConversion
{
    /// <summary>KSDATAFORMAT_SUBTYPE_IEEE_FLOAT.</summary>
    private static readonly Guid FloatSubtype = new("00000003-0000-0010-8000-00aa00389b71");

    public static float[] ToMono(ReadOnlySpan<byte> bytes, WaveFormat format)
    {
        var channels = Math.Max(1, format.Channels);
        var isFloat = format.Encoding == WaveFormatEncoding.IeeeFloat
            || (format is WaveFormatExtensible extensible && extensible.SubFormat == FloatSubtype);
        var bytesPerSample = format.BitsPerSample / 8;
        var frames = bytes.Length / (bytesPerSample * channels);
        var mono = new float[frames];
        for (var f = 0; f < frames; f++)
        {
            float sum = 0;
            for (var c = 0; c < channels; c++)
            {
                var at = (f * channels + c) * bytesPerSample;
                sum += isFloat && bytesPerSample == 4 ? BitConverter.ToSingle(bytes.Slice(at, 4))
                    : bytesPerSample switch
                    {
                        2 => BitConverter.ToInt16(bytes.Slice(at, 2)) / 32768f,
                        3 => ((bytes[at] << 8 | bytes[at + 1] << 16 | bytes[at + 2] << 24) >> 8) / 8388608f,
                        4 => BitConverter.ToInt32(bytes.Slice(at, 4)) / 2147483648f,
                        _ => 0,
                    };
            }
            mono[f] = sum / channels;
        }
        return mono;
    }
}

public sealed class CaptureException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>One side of the meeting being captured.</summary>
public interface IAudioCapture : IDisposable
{
    /// <summary>Raised on the capture thread with each chunk.</summary>
    event Action<CapturedAudio>? Audio;
    /// <summary>The capture died (device unplugged, invalidated after sleep…); the recorder restarts it.</summary>
    event Action<Exception?>? Stopped;
    string? DeviceName { get; }
    void Start();
    void Stop();
}

/// <summary>
/// The microphone: "You". Shared-mode WASAPI on one device, so a Bluetooth headset that
/// isn't the chosen device is never forced into its call profile.
/// </summary>
public sealed class MicCapture(MMDevice device) : IAudioCapture
{
    private WasapiCapture? capture;

    public event Action<CapturedAudio>? Audio;
    public event Action<Exception?>? Stopped;
    public string? DeviceName { get; } = device.FriendlyName;

    public void Start()
    {
        try
        {
            capture = new WasapiCapture(device, useEventSync: true, audioBufferMillisecondsLength: 100);
            var format = capture.WaveFormat;
            capture.DataAvailable += (_, e) =>
            {
                if (e.BytesRecorded > 0) Audio?.Invoke(new CapturedAudio(AudioConversion.ToMono(e.Buffer.AsSpan(0, e.BytesRecorded), format), format.SampleRate));
            };
            capture.RecordingStopped += (_, e) => Stopped?.Invoke(e.Exception);
            capture.StartRecording();
        }
        catch (COMException error) when ((uint)error.HResult == 0x80070005)
        {
            throw new CaptureException("Microphone access is off. Turn on Settings › Privacy & security › Microphone › Let desktop apps access your microphone.", error);
        }
        catch (Exception error) when (error is COMException or InvalidOperationException)
        {
            throw new CaptureException($"The microphone couldn't start: {error.Message}", error);
        }
    }

    public void Stop()
    {
        try
        {
            capture?.StopRecording();
        }
        catch (Exception error) when (error is COMException or InvalidOperationException)
        {
        }
    }

    public void Dispose()
    {
        Stop();
        capture?.Dispose();
        capture = null;
    }
}

/// <summary>
/// What the PC plays: everyone else on the call. Process loopback of everything but this app
/// where Windows has it (10 version 2004+); otherwise loopback on the default output device.
/// </summary>
public sealed class SystemAudioCapture : IAudioCapture
{
    private static readonly WaveFormat LoopbackFormat = WaveFormat.CreateIeeeFloatWaveFormat(ProcessLoopback.SampleRate, ProcessLoopback.Channels);

    private readonly Action<string>? log;
    private WasapiLoopbackCapture? fallback;
    private Thread? thread;
    private volatile bool running;

    public SystemAudioCapture(Action<string>? log = null) => this.log = log;

    public event Action<CapturedAudio>? Audio;
    public event Action<Exception?>? Stopped;
    public string? DeviceName { get; private set; }
    /// <summary>True when it records every output device (process loopback), not just the default one.</summary>
    public bool AllDevices { get; private set; }

    public void Start()
    {
        if (ProcessLoopback.IsSupported)
        {
            try
            {
                StartProcessLoopback();
                return;
            }
            catch (Exception error) when (error is COMException or InvalidOperationException or TimeoutException or NotSupportedException)
            {
                log?.Invoke($"process loopback unavailable ({error.Message}); using the default output device");
            }
        }
        StartDeviceLoopback();
    }

    private void StartProcessLoopback()
    {
        var ready = new EventWaitHandle(false, EventResetMode.AutoReset);
        ProcessLoopback loopback;
        try
        {
            // Activated from the thread pool (the multithreaded apartment), never the UI thread.
            loopback = Task.Run(() => ProcessLoopback.StartAsync(Environment.ProcessId, ready.SafeWaitHandle.DangerousGetHandle())).GetAwaiter().GetResult();
        }
        catch
        {
            ready.Dispose();
            throw;
        }
        DeviceName = "everything this PC plays";
        AllDevices = true;
        running = true;
        thread = new Thread(() => CaptureLoop(loopback, ready)) { IsBackground = true, Name = "BoringTalks system audio", Priority = ThreadPriority.AboveNormal };
        thread.Start();
    }

    private void CaptureLoop(ProcessLoopback loopback, EventWaitHandle ready)
    {
        Exception? failure = null;
        var buffer = new byte[LoopbackFormat.AverageBytesPerSecond / 10];
        try
        {
            while (running)
            {
                // Process loopback delivers nothing while nothing plays; the recorder's timeline fills the silence.
                ready.WaitOne(200);
                while (running && loopback.NextPacketSize() > 0)
                {
                    var bytes = loopback.Read(ref buffer);
                    if (bytes > 0) Audio?.Invoke(new CapturedAudio(AudioConversion.ToMono(buffer.AsSpan(0, bytes), LoopbackFormat), LoopbackFormat.SampleRate));
                }
            }
        }
        catch (Exception error) when (error is COMException or InvalidOperationException)
        {
            failure = error;
        }
        finally
        {
            loopback.Dispose();
            ready.Dispose();
        }
        if (failure is not null) Stopped?.Invoke(failure);
    }

    private void StartDeviceLoopback()
    {
        try
        {
            fallback = new WasapiLoopbackCapture();
            var format = fallback.WaveFormat;
            DeviceName = WasapiLoopbackCapture.GetDefaultLoopbackCaptureDevice().FriendlyName;
            AllDevices = false;
            fallback.DataAvailable += (_, e) =>
            {
                if (e.BytesRecorded > 0) Audio?.Invoke(new CapturedAudio(AudioConversion.ToMono(e.Buffer.AsSpan(0, e.BytesRecorded), format), format.SampleRate));
            };
            fallback.RecordingStopped += (_, e) =>
            {
                if (e.Exception is not null) Stopped?.Invoke(e.Exception);
            };
            fallback.StartRecording();
        }
        catch (Exception error) when (error is COMException or InvalidOperationException)
        {
            throw new CaptureException($"There is no sound output to record (no speakers or headphones?): {error.Message}", error);
        }
    }

    public void Stop()
    {
        running = false;
        try
        {
            fallback?.StopRecording();
        }
        catch (Exception error) when (error is COMException or InvalidOperationException)
        {
        }
        thread?.Join(TimeSpan.FromSeconds(2));
        thread = null;
    }

    public void Dispose()
    {
        Stop();
        fallback?.Dispose();
        fallback = null;
    }
}

/// <summary>Resamples one capture's chunks to 16 kHz, whatever rate the device runs at (and if it changes).</summary>
public sealed class To16k
{
    private Resampler? resampler;

    public float[] Convert(CapturedAudio audio)
    {
        if (resampler is null || resampler.InputRate != audio.SampleRate) resampler = new Resampler(audio.SampleRate, 16000);
        return resampler.Process(audio.Samples);
    }
}
