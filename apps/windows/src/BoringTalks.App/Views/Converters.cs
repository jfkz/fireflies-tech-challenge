using System.Collections;
using System.Globalization;
using System.Windows;
using System.Windows.Data;

namespace BoringTalks.App.Views;

/// <summary>
/// Visible when the value is "there": true, a non-empty string or list, any other non-null object.
/// With a parameter, visible when the value's text equals it ("Recording", "SignedIn").
/// </summary>
public sealed class VisibleWhenConverter : IValueConverter
{
    public static bool Truthy(object? value, object? parameter) => parameter is string expected
        ? expected.Split('|').Contains(value?.ToString(), StringComparer.Ordinal)
        : value switch
        {
            null => false,
            bool b => b,
            string s => s.Length > 0,
            int i => i != 0,
            ICollection c => c.Count > 0,
            _ => true,
        };

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        Truthy(value, parameter) ? Visibility.Visible : Visibility.Collapsed;

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotSupportedException();
}

/// <summary>The opposite of <see cref="VisibleWhenConverter"/>.</summary>
public sealed class HiddenWhenConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        VisibleWhenConverter.Truthy(value, parameter) ? Visibility.Collapsed : Visibility.Visible;

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotSupportedException();
}

/// <summary>True when the value's text equals the parameter (for enabling buttons by phase).</summary>
public sealed class EqualsConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) => VisibleWhenConverter.Truthy(value, parameter ?? "");

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotSupportedException();
}
