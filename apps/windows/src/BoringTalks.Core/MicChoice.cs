namespace BoringTalks.Core;

/// <summary>
/// Which microphone records "You".
/// <para>
/// Opening a Bluetooth headset's microphone switches the headset from its stereo
/// music profile to the hands-free call profile: 16 kHz mono, so everything the
/// person hears gets worse for as long as the meeting records. When the default
/// microphone is such a headset and the PC has a microphone of its own, use that
/// one instead and the headset keeps sounding as before.
/// </para>
/// </summary>
public static class MicChoice
{
    public sealed record Device(string Id, string Name, bool IsBluetooth, bool IsBuiltIn);

    /// <summary>
    /// The microphone picked in Settings while it's connected; otherwise (System default, or it's
    /// unplugged) the default rule below. Null means the default as it is.
    /// </summary>
    public static Device? Pick(string? chosenId, Device? defaultInput, IReadOnlyList<Device> inputs, bool avoidBluetooth) =>
        !string.IsNullOrEmpty(chosenId) && inputs.FirstOrDefault(d => d.Id == chosenId) is { } chosen ? chosen : Pick(defaultInput, inputs, avoidBluetooth);

    /// <summary>The device to record from; null means the default as it is.</summary>
    public static Device? Pick(Device? defaultInput, IReadOnlyList<Device> inputs, bool avoidBluetooth)
    {
        if (!avoidBluetooth || defaultInput is not { IsBluetooth: true }) return null;
        return inputs.FirstOrDefault(d => d.IsBuiltIn) ?? inputs.FirstOrDefault(d => !d.IsBluetooth);
    }

    /// <summary>
    /// What a Windows audio endpoint's enumerator (the bus it hangs off) says about it:
    /// <c>BTHENUM</c>/<c>BTHHFENUM</c>/<c>BTHLEDEVICE</c> are Bluetooth; the onboard audio
    /// buses (HD Audio, Intel SST, AMD ACP) are the PC's own microphone.
    /// </summary>
    public static (bool IsBluetooth, bool IsBuiltIn) Classify(string? enumerator, string? name)
    {
        var bus = (enumerator ?? "").ToUpperInvariant();
        var isBluetooth = bus.StartsWith("BTH", StringComparison.Ordinal) || (name ?? "").Contains("Hands-Free", StringComparison.OrdinalIgnoreCase);
        var isBuiltIn = !isBluetooth && bus is "HDAUDIO" or "INTELAUDIO" or "ACP" or "SST";
        return (isBluetooth, isBuiltIn);
    }
}
