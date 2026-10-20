using System.ComponentModel;
using System.Windows;
using BoringTalks.App.ViewModels;

namespace BoringTalks.App.Views;

/// <summary>Report a Problem…, opened from the menu, the tray or a hang banner. Hides instead of closing, keeping the draft.</summary>
public partial class ReportWindow : Window
{
    private readonly AppModel app;

    public ReportWindow(AppModel app)
    {
        InitializeComponent();
        this.app = app;
        DataContext = app;
    }

    public void ShowReport()
    {
        Show();
        Activate();
        if (!app.Reporter.IsDone) MessageBox.Focus();
    }

    private async void Send_Click(object sender, RoutedEventArgs e) => await app.Reporter.SendAsync();

    private async void Save_Click(object sender, RoutedEventArgs e) => await app.Reporter.SaveToFileAsync();

    private void Close_Click(object sender, RoutedEventArgs e) => Hide();

    protected override void OnClosing(CancelEventArgs e)
    {
        e.Cancel = true;
        Hide();
        base.OnClosing(e);
    }
}
