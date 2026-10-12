using System.Runtime.InteropServices;

namespace BoringTalks.App.Audio;

/// <summary>
/// Captures everything the PC plays except this process: Windows' process loopback (build
/// 19041+), activated on the virtual <c>VAD\Process_Loopback</c> device with
/// <c>PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE</c>. Unlike loopback on one output device
/// it doesn't care which device the call plays through (speakers, headset, or both).
/// <para>
/// NAudio has no API for it, and .NET's COM wrappers can't hold the client it returns (its
/// identity <c>IUnknown</c> doesn't answer for <c>IAudioClient</c>), so this calls the two
/// interfaces through their vtables.
/// </para>
/// </summary>
internal sealed class ProcessLoopback : IDisposable
{
    private const string VirtualDevice = "VAD\\Process_Loopback";
    private const ushort VtBlob = 65;
    private static readonly Guid IidAudioClient = new("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2");
    private static readonly Guid IidAudioCaptureClient = new("C8ADBD64-E71E-48a0-A4DE-185C395CD317");

    public const int SampleRate = 48000;
    public const int Channels = 2;
    private const uint StreamFlags = 0x00020000 /* LOOPBACK */ | 0x00040000 /* EVENTCALLBACK */ | 0x80000000 /* AUTOCONVERTPCM */ | 0x08000000 /* SRC_DEFAULT_QUALITY */;

    private IntPtr client;
    private IntPtr capture;

    [StructLayout(LayoutKind.Sequential)]
    private struct ActivationParams
    {
        public int ActivationType;      // AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK = 1
        public uint TargetProcessId;
        public int ProcessLoopbackMode; // PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE = 1
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PropVariantBlob
    {
        public ushort Type;
        public ushort Reserved1, Reserved2, Reserved3;
        public uint Size;
        public IntPtr Data;
    }

    [StructLayout(LayoutKind.Sequential, Pack = 2)]
    private struct WaveFormatEx
    {
        public ushort FormatTag;
        public ushort Channels;
        public uint SamplesPerSec;
        public uint AvgBytesPerSec;
        public ushort BlockAlign;
        public ushort BitsPerSample;
        public ushort Size;
    }

    [ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IActivateAudioInterfaceCompletionHandler
    {
        void ActivateCompleted(IActivateAudioInterfaceAsyncOperation operation);
    }

    [ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IActivateAudioInterfaceAsyncOperation
    {
        void GetActivateResult(out int activateResult, out IntPtr activatedInterface);
    }

    /// <summary>Marks the handler as free-threaded, as ActivateAudioInterfaceAsync requires.</summary>
    [ComImport, Guid("94ea2b94-e9cc-49e0-c0ff-ee64ca8f5b90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAgileObject;

    [DllImport("Mmdevapi.dll", ExactSpelling = true, PreserveSig = false)]
    private static extern void ActivateAudioInterfaceAsync(
        [MarshalAs(UnmanagedType.LPWStr)] string deviceInterfacePath,
        [MarshalAs(UnmanagedType.LPStruct)] Guid riid,
        IntPtr activationParams,
        IActivateAudioInterfaceCompletionHandler completionHandler,
        out IActivateAudioInterfaceAsyncOperation activationOperation);

    [ClassInterface(ClassInterfaceType.None)]
    private sealed class Completion : IActivateAudioInterfaceCompletionHandler, IAgileObject
    {
        public TaskCompletionSource<IntPtr> Result { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public void ActivateCompleted(IActivateAudioInterfaceAsyncOperation operation)
        {
            try
            {
                operation.GetActivateResult(out var hr, out var unknown);
                if (hr < 0)
                {
                    Result.TrySetException(Marshal.GetExceptionForHR(hr) ?? new InvalidOperationException($"Activation failed: 0x{hr:X8}"));
                    return;
                }
                var qi = Marshal.QueryInterface(unknown, in IidAudioClient, out var audioClient);
                Marshal.Release(unknown);
                if (qi < 0) Result.TrySetException(Marshal.GetExceptionForHR(qi) ?? new InvalidOperationException($"No IAudioClient: 0x{qi:X8}"));
                else Result.TrySetResult(audioClient);
            }
            catch (Exception error)
            {
                Result.TrySetException(error);
            }
        }
    }

    /// <summary>Process loopback needs Windows 10 version 2004 (build 19041) or later.</summary>
    public static bool IsSupported => OperatingSystem.IsWindowsVersionAtLeast(10, 0, 19041);

    private ProcessLoopback(IntPtr client) => this.client = client;

    /// <summary>A started capture of everything except <paramref name="excludedProcessId"/> and its children, as 48 kHz stereo float.</summary>
    public static async Task<ProcessLoopback> StartAsync(int excludedProcessId, IntPtr readyEvent, CancellationToken cancellation = default)
    {
        var client = await ActivateAsync(excludedProcessId, cancellation).ConfigureAwait(false);
        var loopback = new ProcessLoopback(client);
        try
        {
            loopback.Initialize(readyEvent);
            return loopback;
        }
        catch
        {
            loopback.Dispose();
            throw;
        }
    }

    private static async Task<IntPtr> ActivateAsync(int excludedProcessId, CancellationToken cancellation)
    {
        var parameters = new ActivationParams { ActivationType = 1, TargetProcessId = (uint)excludedProcessId, ProcessLoopbackMode = 1 };
        var paramsPtr = Marshal.AllocHGlobal(Marshal.SizeOf<ActivationParams>());
        var variantPtr = Marshal.AllocHGlobal(Marshal.SizeOf<PropVariantBlob>());
        try
        {
            Marshal.StructureToPtr(parameters, paramsPtr, false);
            Marshal.StructureToPtr(new PropVariantBlob { Type = VtBlob, Size = (uint)Marshal.SizeOf<ActivationParams>(), Data = paramsPtr }, variantPtr, false);
            var completion = new Completion();
            ActivateAudioInterfaceAsync(VirtualDevice, IidAudioClient, variantPtr, completion, out _);
            return await completion.Result.Task.WaitAsync(TimeSpan.FromSeconds(10), cancellation).ConfigureAwait(false);
        }
        finally
        {
            Marshal.FreeHGlobal(variantPtr);
            Marshal.FreeHGlobal(paramsPtr);
        }
    }

    private static void Check(int hr, string what)
    {
        if (hr < 0) throw new InvalidOperationException($"{what} failed: 0x{hr:X8}", Marshal.GetExceptionForHR(hr)) { HResult = hr };
    }

    private static unsafe void* Method(IntPtr obj, int slot) => (*(void***)obj)[slot];

    private unsafe void Initialize(IntPtr readyEvent)
    {
        var format = new WaveFormatEx
        {
            FormatTag = 3, // WAVE_FORMAT_IEEE_FLOAT
            Channels = Channels,
            SamplesPerSec = SampleRate,
            BitsPerSample = 32,
            BlockAlign = Channels * 4,
            AvgBytesPerSec = SampleRate * Channels * 4,
        };
        // IAudioClient::Initialize (slot 3): shared mode, 200 ms buffer.
        var initialize = (delegate* unmanaged[Stdcall]<IntPtr, int, uint, long, long, WaveFormatEx*, Guid*, int>)Method(client, 3);
        Check(initialize(client, 0, StreamFlags, 2_000_000, 0, &format, null), "IAudioClient.Initialize");
        // SetEventHandle (slot 13).
        var setEvent = (delegate* unmanaged[Stdcall]<IntPtr, IntPtr, int>)Method(client, 13);
        Check(setEvent(client, readyEvent), "IAudioClient.SetEventHandle");
        // GetService(IAudioCaptureClient) (slot 14).
        var getService = (delegate* unmanaged[Stdcall]<IntPtr, Guid*, IntPtr*, int>)Method(client, 14);
        var iid = IidAudioCaptureClient;
        IntPtr service;
        Check(getService(client, &iid, &service), "IAudioClient.GetService");
        capture = service;
        // Start (slot 10).
        Check(((delegate* unmanaged[Stdcall]<IntPtr, int>)Method(client, 10))(client), "IAudioClient.Start");
    }

    public unsafe int NextPacketSize()
    {
        uint frames;
        Check(((delegate* unmanaged[Stdcall]<IntPtr, uint*, int>)Method(capture, 5))(capture, &frames), "IAudioCaptureClient.GetNextPacketSize");
        return (int)frames;
    }

    /// <summary>Copies the next packet into <paramref name="buffer"/> (growing it if needed) and returns its byte count.</summary>
    public unsafe int Read(ref byte[] buffer)
    {
        byte* data;
        uint frames, flags;
        var getBuffer = (delegate* unmanaged[Stdcall]<IntPtr, byte**, uint*, uint*, ulong*, ulong*, int>)Method(capture, 3);
        Check(getBuffer(capture, &data, &frames, &flags, null, null), "IAudioCaptureClient.GetBuffer");
        var bytes = (int)frames * Channels * 4;
        if (buffer.Length < bytes) buffer = new byte[bytes];
        if ((flags & 0x2) != 0) Array.Clear(buffer, 0, bytes); // AUDCLNT_BUFFERFLAGS_SILENT
        else new ReadOnlySpan<byte>(data, bytes).CopyTo(buffer);
        Check(((delegate* unmanaged[Stdcall]<IntPtr, uint, int>)Method(capture, 4))(capture, frames), "IAudioCaptureClient.ReleaseBuffer");
        return bytes;
    }

    public unsafe void Dispose()
    {
        if (client != IntPtr.Zero)
        {
            ((delegate* unmanaged[Stdcall]<IntPtr, int>)Method(client, 11))(client); // Stop
            Marshal.Release(client);
            client = IntPtr.Zero;
        }
        if (capture != IntPtr.Zero)
        {
            Marshal.Release(capture);
            capture = IntPtr.Zero;
        }
    }
}
