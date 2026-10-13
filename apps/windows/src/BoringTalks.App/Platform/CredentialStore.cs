using System.ComponentModel;
using System.Runtime.InteropServices;
using BoringTalks.Core.Auth;

namespace BoringTalks.App.Platform;

/// <summary>
/// Windows Credential Manager (generic credentials, this user only), where the device token lives:
/// <c>BoringTalks:&lt;account&gt;</c>, visible under Control Panel › Credential Manager › Windows Credentials.
/// </summary>
public sealed class CredentialStore(string prefix = "BoringTalks") : ISecretStore
{
    private const int GenericType = 1;
    private const int PersistLocalMachine = 2;
    private const int NotFound = 1168;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Credential
    {
        public int Flags;
        public int Type;
        public string TargetName;
        public string? Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public int CredentialBlobSize;
        public IntPtr CredentialBlob;
        public int Persist;
        public int AttributeCount;
        public IntPtr Attributes;
        public string? TargetAlias;
        public string? UserName;
    }

    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWrite(ref Credential credential, int flags);

    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, int type, int flags, out IntPtr credential);

    [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredDelete(string target, int type, int flags);

    [DllImport("advapi32.dll")]
    private static extern void CredFree(IntPtr buffer);

    private string Target(string account) => $"{prefix}:{account}";

    public byte[]? Read(string account)
    {
        if (!CredRead(Target(account), GenericType, 0, out var pointer))
        {
            var error = Marshal.GetLastWin32Error();
            return error == NotFound ? null : throw new IOException("Couldn't read the sign-in from Credential Manager.", new Win32Exception(error));
        }
        try
        {
            var credential = Marshal.PtrToStructure<Credential>(pointer);
            var data = new byte[credential.CredentialBlobSize];
            if (data.Length > 0) Marshal.Copy(credential.CredentialBlob, data, 0, data.Length);
            return data;
        }
        finally
        {
            CredFree(pointer);
        }
    }

    public void Write(string account, byte[] data)
    {
        var blob = Marshal.AllocHGlobal(data.Length);
        try
        {
            Marshal.Copy(data, 0, blob, data.Length);
            var credential = new Credential
            {
                Type = GenericType,
                TargetName = Target(account),
                Comment = "BoringTalks device sign-in",
                CredentialBlobSize = data.Length,
                CredentialBlob = blob,
                Persist = PersistLocalMachine,
                UserName = Environment.UserName,
            };
            if (!CredWrite(ref credential, 0)) throw new IOException("Couldn't save the sign-in to Credential Manager.", new Win32Exception(Marshal.GetLastWin32Error()));
        }
        finally
        {
            Marshal.FreeHGlobal(blob);
        }
    }

    public void Delete(string account)
    {
        if (!CredDelete(Target(account), GenericType, 0) && Marshal.GetLastWin32Error() is var error and not NotFound)
        {
            throw new IOException("Couldn't remove the sign-in from Credential Manager.", new Win32Exception(error));
        }
    }
}
