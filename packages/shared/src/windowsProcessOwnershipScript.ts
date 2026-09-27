/**
 * Fixed Windows-only implementation, not a template containing user data. All
 * paths, identities and private record bytes arrive over the private stdin pipe.
 * The process holding the OS guard also performs every protected file mutation;
 * a dead helper can therefore never leave Node writing under a released lock.
 *
 * Win32 identity and termination contracts:
 * https://learn.microsoft.com/windows/win32/procthread/process-handles-and-identifiers
 * https://learn.microsoft.com/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes
 * https://learn.microsoft.com/windows/win32/api/processthreadsapi/nf-processthreadsapi-terminateprocess
 */
export const WINDOWS_PROCESS_OWNERSHIP_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
[Console]::Out.WriteLine('{"id":0,"ok":true,"phase":"source"}')
[Console]::Out.Flush()
# Resolve only the inbox Utility manifest, never ambient module discovery.
Import-Module -Name ($PSHOME + '\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
Microsoft.PowerShell.Utility\Add-Type -ReferencedAssemblies System.Web.Extensions -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

public static class CafeWindowsOwnership {
  const uint Query = 0x1000, Synchronize = 0x100000, Terminate = 1;
  const uint Read = 0x80000000, Write = 0x40000000, OpenExisting = 3, OpenAlways = 4;
  const uint Reparse = 0x400, Directory = 0x10, OpenReparse = 0x200000, Backup = 0x2000000;
  const uint WaitObject = 0, WaitTimeout = 258;
  static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
  static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 16384, RecursionLimit = 16 };
  static readonly List<SafeFileHandle> Directories = new List<SafeFileHandle>();
  static FileStream Guard;
  static string Marker, Credential, Role;
  static bool Opened;
  static readonly Timer Deadline = new Timer(delegate { Environment.Exit(72); }, null, 120000, Timeout.Infinite);

  [StructLayout(LayoutKind.Sequential)] struct FileTime { public uint Low; public uint High; }
  [StructLayout(LayoutKind.Sequential)] struct FileInfo {
    public uint Attributes; public FileTime Creation; public FileTime Access; public FileTime Write;
    public uint Volume; public uint SizeHigh; public uint SizeLow; public uint Links; public uint IndexHigh; public uint IndexLow;
  }
  [DllImport("kernel32.dll", SetLastError=true)] static extern SafeFileHandle OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(SafeFileHandle process, out FileTime creation, out FileTime exit, out FileTime kernel, out FileTime user);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(SafeFileHandle handle, uint milliseconds);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(SafeFileHandle handle, uint code);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInfo info);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool MoveFileEx(string existing, string target, uint flags);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool DeleteFile(string path);

  sealed class SafeFailure : Exception { public readonly string Reason; public SafeFailure(string reason) { Reason = reason; } }
  static void Fail(string reason) { throw new SafeFailure(reason); }
  static Dictionary<string,object> Object(params object[] pairs) {
    var result = new Dictionary<string,object>();
    for (int i=0; i<pairs.Length; i+=2) result.Add((string)pairs[i], pairs[i+1]);
    return result;
  }
  static object Get(Dictionary<string,object> obj, string key) { object value; return obj.TryGetValue(key, out value) ? value : null; }
  static string Text(Dictionary<string,object> obj, string key) { return Get(obj,key) as string; }
  static Dictionary<string,object> Map(object value) { var result = value as Dictionary<string,object>; if (result == null) Fail("invalid-request"); return result; }
  static uint Pid(object value) {
    // JavaScriptSerializer uses Int32/Int64 for integral JSON. Reject strings,
    // fractions and booleans instead of silently coercing request authority.
    if (!(value is int) && !(value is long)) Fail("invalid-request");
    long parsed = Convert.ToInt64(value);
    if (parsed < 1 || parsed > uint.MaxValue) Fail("invalid-request");
    return (uint)parsed;
  }
  static string Birth(object value) {
    string text = value as string; ulong parsed;
    if (text == null || text.Length == 0 || text.Length > 20 || text[0] == '0' || !ulong.TryParse(text, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out parsed) || parsed == 0 || parsed.ToString(System.Globalization.CultureInfo.InvariantCulture) != text) Fail("invalid-request");
    return text;
  }
  static object Unknown(string reason) { return Object("status", "unknown", "reason", reason); }
  static object ProcessOperation(Dictionary<string,object> request, string operation) {
    var identity = operation == "capture" ? null : Map(Get(request, "identity"));
    uint pid = Pid(identity == null ? Get(request,"pid") : Get(identity,"pid"));
    string expected = identity == null ? null : Birth(Get(identity,"creationTime100ns"));
    uint rights = Query | Synchronize | (operation == "terminate" ? Terminate : 0);
    // Open exactly once. Reading FILETIME, signalling and waiting all use this
    // same retained kernel object even if its numeric PID is subsequently reused.
    using (SafeFileHandle handle = OpenProcess(rights, false, pid)) {
      if (handle.IsInvalid) {
        int error = Marshal.GetLastWin32Error();
        if (error == 87) return Object("status", "exited"); // ERROR_INVALID_PARAMETER: no such PID.
        return Unknown(error == 5 ? "access-denied" : "native-failure");
      }
      FileTime creation, exit, kernel, user;
      if (!GetProcessTimes(handle, out creation, out exit, out kernel, out user)) return Unknown("native-failure");
      string actual = (((ulong)creation.High << 32) | creation.Low).ToString(System.Globalization.CultureInfo.InvariantCulture);
      if (actual == "0") return Unknown("invalid-response");
      // Mismatch never grants permission to signal this handle.
      if (expected != null && expected != actual) return Object("status", "different-process");
      uint observed = WaitForSingleObject(handle, 0);
      if (observed == WaitObject) return Object("status", "exited");
      if (observed != WaitTimeout) return Unknown("native-failure");
      if (operation == "capture") return Object("status", "present", "identity", Object("pid", pid, "creationTime100ns", actual));
      if (operation == "observe") return Object("status", "same-process");
      if (!TerminateProcess(handle, 1)) {
        // An exit concurrent with our request is conclusive only after waiting
        // on the same handle; ERROR_ACCESS_DENIED alone is not proof of exit.
        return WaitForSingleObject(handle, 0) == WaitObject ? Object("status", "exited") : Unknown("termination-denied");
      }
      return WaitForSingleObject(handle, 3000) == WaitObject ? Object("status", "exited") : Unknown("termination-unconfirmed");
    }
  }

  static void RequirePathSpelling(string path) {
    // Forward slashes are also Win32 separators. Reject them before the
    // backslash component scan so normalization cannot erase slash-based '..'.
    if (path == null || path.Length > 1024 || path.Length < 4 || !char.IsLetter(path[0]) || path[1] != ':' || path[2] != '\\' || path.IndexOf(':', 2) >= 0 || path.IndexOf('/') >= 0 || path.IndexOf('\0') >= 0) Fail("unsafe-path");
    foreach (string part in path.Substring(3).Split('\\')) {
      if (part.Length == 0 || part.EndsWith(".") || part.EndsWith(" ")) Fail("unsafe-path");
    }
  }
  static string FullPath(string path) {
    RequirePathSpelling(path);
    string full = Path.GetFullPath(path);
    RequirePathSpelling(full);
    // .NET Framework expands existing 8.3 aliases (including Windows TEMP's
    // RUNNER~1 spelling). Canonicalize rather than confusing a safe OS alias
    // with traversal. Both spellings reject dot/empty/trailing-dot components;
    // every canonical ancestor is still opened and checked for reparse points.
    return full;
  }
  static void HoldDirectory(string path) {
    string parent = Path.GetDirectoryName(path.TrimEnd('\\'));
    if (!String.IsNullOrEmpty(parent)) HoldDirectory(parent);
    // OPEN_REPARSE_POINT plus handle attribute validation prevents following
    // junctions/symlinks. Omitting FILE_SHARE_DELETE pins each ancestor against
    // rename/replacement for the complete ownership transaction.
    SafeFileHandle handle = CreateFile(path, 0, 3, IntPtr.Zero, OpenExisting, Backup | OpenReparse, IntPtr.Zero);
    if (handle.IsInvalid) { handle.Dispose(); Fail("unsafe-directory-open"); }
    FileInfo info;
    if (!GetFileInformationByHandle(handle, out info) || (info.Attributes & Directory) == 0) { handle.Dispose(); Fail("unsafe-directory-metadata"); }
    if ((info.Attributes & Reparse) != 0) { handle.Dispose(); Fail("unsafe-directory-reparse"); }
    Directories.Add(handle);
  }
  static SafeFileHandle OpenRecord(string path, uint access, uint share, uint disposition) {
    SafeFileHandle handle = CreateFile(path, access, share, IntPtr.Zero, disposition, OpenReparse, IntPtr.Zero);
    if (handle.IsInvalid) {
      int error = Marshal.GetLastWin32Error(); handle.Dispose();
      if (error == 2 && disposition == OpenExisting) return null;
      Fail(error == 32 ? "lock-busy" : error == 5 ? "access-denied" : "record-unreadable");
    }
    FileInfo info;
    if (!GetFileInformationByHandle(handle, out info) || (info.Attributes & (Reparse | Directory)) != 0 || info.Links != 1) { handle.Dispose(); Fail("unsafe-path"); }
    return handle;
  }
  static byte[] ReadRecord(string path, int maximum) {
    using (SafeFileHandle handle = OpenRecord(path, Read, 1, OpenExisting)) {
      if (handle == null) return null;
      using (var file = new FileStream(handle, FileAccess.Read)) {
        if (file.Length < 1 || file.Length > maximum) Fail("record-invalid");
        byte[] result = new byte[(int)file.Length]; int position = 0;
        while (position < result.Length) { int count = file.Read(result, position, result.Length-position); if (count == 0) Fail("record-unreadable"); position += count; }
        return result;
      }
    }
  }
  static string Revision(byte[] bytes) {
    if (bytes == null) return null;
    using (var hash = SHA256.Create()) { return BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant(); }
  }
  static bool IsGeneration(string value) {
    Guid parsed;
    return value != null && Guid.TryParseExact(value, "D", out parsed) && parsed.ToString("D") == value && parsed != Guid.Empty;
  }
  static string CredentialFor(Dictionary<string,object> marker) {
    string path = FullPath(Text(marker,"credentialPath") ?? Credential);
    string generation = Text(marker,"windowsOwnershipId");
    // Comparison may accept a legacy alias/casing spelling, but authority is
    // always the configured path whose ancestors we pinned. Returning the
    // candidate would escape that authority in a case-sensitive NTFS directory.
    if (String.Equals(path, Credential, StringComparison.OrdinalIgnoreCase)) return Credential;
    string derived = Credential + "." + generation;
    if (IsGeneration(generation) && String.Equals(path, derived, StringComparison.OrdinalIgnoreCase)) return derived;
    Fail("unsafe-path"); return null;
  }
  static Dictionary<string,object> MarkerObject(string source) {
    if (source == null || Utf8.GetByteCount(source) > 4096) Fail("record-invalid");
    var marker = Map(Json.DeserializeObject(source));
    object generation = Get(marker,"windowsOwnershipId");
    if (generation != null && !IsGeneration(generation as string)) Fail("record-invalid");
    CredentialFor(marker);
    return marker;
  }
  static object Open(Dictionary<string,object> request) {
    if (Opened) Fail("invalid-request");
    Marker = FullPath(Text(request,"markerPath")); Credential = FullPath(Text(request,"legacyCredentialPath")); Role = Text(request,"role");
    if ((Role != "daemon" && Role != "supervisor") || Path.GetFileName(Marker) != "provider-" + Role + ".json" || Path.GetFileName(Credential) != (Role == "daemon" ? "provider-daemon-token.bin" : "provider-supervisor-token")) Fail("unsafe-path");
    HoldDirectory(Path.GetDirectoryName(Marker));
    // NTFS can enable case sensitivity per directory. Skip the second pin only
    // for exactly identical canonical spellings, never case-folded equality.
    if (!String.Equals(Path.GetDirectoryName(Marker),Path.GetDirectoryName(Credential),StringComparison.Ordinal)) HoldDirectory(Path.GetDirectoryName(Credential));
    string guardPath = Marker + ".ownership.lock";
    if (String.Equals(Credential,guardPath,StringComparison.OrdinalIgnoreCase)) Fail("unsafe-path");
    DateTime until = DateTime.UtcNow.AddSeconds(5);
    while (true) {
      try { Guard = new FileStream(OpenRecord(guardPath, Read | Write, 0, OpenAlways), FileAccess.ReadWrite); break; }
      catch (SafeFailure error) { if (error.Reason != "lock-busy" || DateTime.UtcNow >= until) throw; Thread.Sleep(50); }
    }
    Opened = true;
    return Object("opened", true);
  }
  static object ReadOwnership() {
    byte[] markerBytes = ReadRecord(Marker,4096);
    if (markerBytes == null) return Object("markerJson", null, "revision", null);
    string source = Utf8.GetString(markerBytes);
    var marker = MarkerObject(source);
    var result = Object("markerJson", source, "revision", Revision(markerBytes));
    // Credential unreadability does not turn the marker into absence. The
    // caller can still inspect proven stale identity; missing bytes are not auth.
    try { byte[] bytes = ReadRecord(CredentialFor(marker),1024); if (bytes != null) result.Add("credentialBase64", Convert.ToBase64String(bytes)); }
    catch (SafeFailure error) { if (error.Reason == "unsafe-path") throw; }
    return result;
  }
  static void CheckRevision(string expected) {
    if (expected != null) {
      if (expected.Length != 64) Fail("invalid-request");
      foreach (char character in expected) if (!((character >= '0' && character <= '9') || (character >= 'a' && character <= 'f'))) Fail("invalid-request");
    }
    string actual = Revision(ReadRecord(Marker,4096));
    if (actual != expected) Fail("ownership-changed");
  }
  static void WriteAtomic(string path, byte[] bytes) {
    string temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
    try {
      using (var file = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough)) { file.Write(bytes,0,bytes.Length); file.Flush(true); }
      // Destination redirection cannot make MoveFileEx follow a reparse point;
      // it replaces the directory entry. The pinned parent cannot be swapped.
      using (SafeFileHandle existing = OpenRecord(path, Read, 1, OpenExisting)) { }
      if (!MoveFileEx(temporary,path,9)) Fail("mutation-unconfirmed");
    } finally { DeleteFile(temporary); }
  }
  static object Publish(Dictionary<string,object> request) {
    string expected = Text(request,"expectedRevision"); CheckRevision(expected);
    string source = Text(request,"markerJson"); var marker = MarkerObject(source);
    string credentialPath = CredentialFor(marker), encoded = Text(request,"credentialBase64");
    if (encoded != null) {
      byte[] bytes = Convert.FromBase64String(encoded);
      if (bytes.Length < 1 || bytes.Length > 1024 || Convert.ToBase64String(bytes) != encoded) Fail("invalid-request");
      // Never replace a generation credential with different bytes. Legacy
      // upgrades retain their original private credential without rotation.
      byte[] existing = ReadRecord(credentialPath,1024);
      if (existing != null && Convert.ToBase64String(existing) != encoded) Fail("ownership-changed");
      if (existing == null) WriteAtomic(credentialPath,bytes);
    } else if (ReadRecord(credentialPath,1024) == null) Fail("credential-unavailable");
    CheckRevision(expected);
    byte[] markerBytes = Utf8.GetBytes(source); WriteAtomic(Marker,markerBytes);
    return Object("revision",Revision(markerBytes));
  }
  static object Retire(Dictionary<string,object> request) {
    string expected = Text(request,"expectedRevision");
    if (expected == null) Fail("invalid-request");
    CheckRevision(expected);
    byte[] bytes = ReadRecord(Marker,4096);
    if (bytes == null) Fail("ownership-changed");
    string credentialPath = CredentialFor(MarkerObject(Utf8.GetString(bytes)));
    // Validate the credential boundary before either destructive mutation.
    using (SafeFileHandle credential = OpenRecord(credentialPath,Read,1,OpenExisting)) { }
    CheckRevision(expected);
    if (!DeleteFile(Marker)) Fail("mutation-unconfirmed");
    if (!DeleteFile(credentialPath) && Marshal.GetLastWin32Error() != 2) Fail("mutation-unconfirmed");
    return Object("retired",true);
  }
  static string ReadBoundedLine() {
    var line = new StringBuilder();
    while (true) { int value = Console.In.Read(); if (value < 0) return line.Length == 0 ? null : line.ToString(); if (value == 10) return line.ToString(); if (line.Length >= 16384) Fail("invalid-request"); if (value != 13) line.Append((char)value); }
  }
  public static void Main() {
    try {
      // Node waits for this fixed readiness record before sending any JSON.
      // Initialization cannot prefetch and discard the first ownership request.
      Console.Out.WriteLine("{\"id\":0,\"ok\":true,\"phase\":\"ready\"}"); Console.Out.Flush();
      while (true) {
        string line = ReadBoundedLine(); if (line == null) break;
        long id = 0; bool closing = false; Dictionary<string,object> response;
        try {
          var request = Map(Json.DeserializeObject(line)); id = Convert.ToInt64(Get(request,"id"));
          if (id < 1 || id > 9007199254740991L) Fail("invalid-request");
          string operation = Text(request,"op"); object result;
          if (operation == "open") result = Open(request);
          else if (operation == "capture" || operation == "observe" || operation == "terminate") result = ProcessOperation(request,operation);
          else {
            if (!Opened) Fail("invalid-request");
            if (operation == "read") result = ReadOwnership();
            else if (operation == "publish") result = Publish(request);
            else if (operation == "retire") result = Retire(request);
            else if (operation == "close") { result = Object("closed",true); closing = true; }
            else { Fail("invalid-request"); result = null; }
          }
          response = Object("id",id,"ok",true,"result",result);
        } catch (SafeFailure error) { response = Object("id",id,"ok",false,"reason",error.Reason); }
          catch { response = Object("id",id,"ok",false,"reason","native-failure"); }
        string output = Json.Serialize(response);
        if (Utf8.GetByteCount(output) > 8192) output = Json.Serialize(Object("id",id,"ok",false,"reason","invalid-response"));
        Console.Out.WriteLine(output); Console.Out.Flush();
        if (closing) break;
      }
    } finally {
      if (Guard != null) Guard.Dispose();
      for (int i=Directories.Count-1;i>=0;i--) Directories[i].Dispose();
      Deadline.Dispose();
    }
  }
}
'@
[CafeWindowsOwnership]::Main()
} catch {
  # Never echo native/PowerShell exceptions: they can include paths or input.
  [Console]::Out.WriteLine('{"id":0,"ok":false,"reason":"helper-unavailable"}')
}
`;
