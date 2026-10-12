using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BoringTalks.Core.Api;

/// <summary>
/// JSON the way the API speaks it: camelCase names, enums as lower-case strings, and
/// dates as ISO 8601 in UTC with milliseconds ("2026-10-06T09:30:00.000Z"), which zod's
/// <c>datetime()</c> accepts (it refuses offsets like "+00:00").
/// </summary>
public static class ApiJson
{
    public static readonly JsonSerializerOptions Options = Create();

    private static JsonSerializerOptions Create()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web)
        {
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            WriteIndented = false,
        };
        options.Converters.Add(new UtcDateConverter());
        options.Converters.Add(new NullableUtcDateConverter());
        options.MakeReadOnly(populateMissingResolver: true);
        return options;
    }

    public static string Format(DateTimeOffset date) =>
        date.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    public static DateTimeOffset? Parse(string text) =>
        DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var date)
            ? date
            : null;

    private sealed class UtcDateConverter : JsonConverter<DateTimeOffset>
    {
        public override DateTimeOffset Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
            Parse(reader.GetString() ?? "") ?? throw new JsonException($"Not an ISO 8601 date: {reader.GetString()}");

        public override void Write(Utf8JsonWriter writer, DateTimeOffset value, JsonSerializerOptions options) =>
            writer.WriteStringValue(Format(value));
    }

    private sealed class NullableUtcDateConverter : JsonConverter<DateTimeOffset?>
    {
        public override DateTimeOffset? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
            reader.TokenType == JsonTokenType.Null ? null : Parse(reader.GetString() ?? "") ?? throw new JsonException($"Not an ISO 8601 date: {reader.GetString()}");

        public override void Write(Utf8JsonWriter writer, DateTimeOffset? value, JsonSerializerOptions options)
        {
            if (value is { } date) writer.WriteStringValue(Format(date));
            else writer.WriteNullValue();
        }
    }
}

/// <summary>
/// An enum as its lower-case name. A value this version doesn't know reads as the
/// enum's fallback (<see cref="MeetingStatus.Summarizing"/>, <see cref="MeetingSource.Unknown"/>)
/// instead of failing the whole response.
/// </summary>
public sealed class LenientEnumConverter<T> : JsonConverter<T> where T : struct, Enum
{
    private static readonly T Fallback = typeof(T) == typeof(MeetingStatus) ? (T)(object)MeetingStatus.Summarizing : default;

    public override T Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        Enum.TryParse<T>(reader.GetString(), ignoreCase: true, out var value) && Enum.IsDefined(value) ? value : Fallback;

    public override void Write(Utf8JsonWriter writer, T value, JsonSerializerOptions options) =>
        writer.WriteStringValue(value.ToString().ToLowerInvariant());
}
