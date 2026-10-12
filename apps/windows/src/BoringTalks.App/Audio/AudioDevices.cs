using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;
using BoringTalks.Core;

namespace BoringTalks.App.Audio;

/// <summary>The PC's microphones, and notice of device changes.</summary>
public sealed class AudioDevices : IMMNotificationClient, IDisposable
{
    /// <summary>PKEY_Device_EnumeratorName: the bus a device hangs off ("BTHENUM", "USB", "HDAUDIO").</summary>
    private static readonly PropertyKey EnumeratorName = new(new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), 24);

    private readonly MMDeviceEnumerator enumerator = new();

    public AudioDevices() => enumerator.RegisterEndpointNotificationCallback(this);

    /// <summary>A default device changed, a device came or went (raised on a COM thread).</summary>
    public event Action<DataFlow>? Changed;

    /// <summary>The microphone call apps use (Communications role), else the default one.</summary>
    public MMDevice? DefaultInput()
    {
        foreach (var role in new[] { Role.Communications, Role.Console })
        {
            if (enumerator.HasDefaultAudioEndpoint(DataFlow.Capture, role)) return enumerator.GetDefaultAudioEndpoint(DataFlow.Capture, role);
        }
        return null;
    }

    public IReadOnlyList<MMDevice> Inputs() => [.. enumerator.EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active)];

    public MMDevice Get(string id) => enumerator.GetDevice(id);

    public bool HasOutput => enumerator.HasDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);

    public static MicChoice.Device Describe(MMDevice device)
    {
        string? bus = null;
        try
        {
            if (device.Properties.Contains(EnumeratorName)) bus = device.Properties[EnumeratorName].Value as string;
        }
        catch (System.Runtime.InteropServices.COMException)
        {
        }
        var (bluetooth, builtIn) = MicChoice.Classify(bus, device.FriendlyName);
        return new MicChoice.Device(device.ID, device.FriendlyName, bluetooth, builtIn);
    }

    void IMMNotificationClient.OnDeviceStateChanged(string deviceId, DeviceState newState) => Changed?.Invoke(DataFlow.All);
    void IMMNotificationClient.OnDeviceAdded(string pwstrDeviceId) => Changed?.Invoke(DataFlow.All);
    void IMMNotificationClient.OnDeviceRemoved(string deviceId) => Changed?.Invoke(DataFlow.All);
    void IMMNotificationClient.OnDefaultDeviceChanged(DataFlow flow, Role role, string defaultDeviceId) => Changed?.Invoke(flow);
    void IMMNotificationClient.OnPropertyValueChanged(string pwstrDeviceId, PropertyKey key) { }

    public void Dispose()
    {
        enumerator.UnregisterEndpointNotificationCallback(this);
        enumerator.Dispose();
    }
}
