// Master (speaker) volume of the computer the app is installed on.
//
// The screen-share pipeline already has "mute the PC speakers" (screen-cast),
// but the control panel also needs a *separate* slider for this machine's own
// sound, next to the TV volume. Windows exposes the master volume only through
// the CoreAudio COM interface, so a tiny inline C# helper is compiled by
// PowerShell on demand (no extra binaries to ship).

const { spawn } = require("node:child_process");

const WIN = process.platform === "win32";
const NOT_WINDOWS = "کنترل صدای این دستگاه فقط در ویندوز فعال است.";

const CSHARP = `
Add-Type -Language CSharp @'
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int NotImpl1(); int NotImpl2();
  int GetChannelCount(out uint c);
  int SetMasterVolumeLevel(float l, Guid g);
  int SetMasterVolumeLevelScalar(float l, Guid g);
  int GetMasterVolumeLevel(out float l);
  int GetMasterVolumeLevelScalar(out float l);
  int SetChannelVolumeLevel(uint i, float l, Guid g);
  int SetChannelVolumeLevelScalar(uint i, float l, Guid g);
  int GetChannelVolumeLevel(uint i, out float l);
  int GetChannelVolumeLevelScalar(uint i, out float l);
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, Guid g);
  int GetMute([MarshalAs(UnmanagedType.Bool)] out bool m);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid id, int clsCtx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int NotImpl(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice dev); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }
public static class Audio {
  static IAudioEndpointVolume Vol() {
    var en = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
    IMMDevice dev; en.GetDefaultAudioEndpoint(0, 1, out dev);
    var iid = typeof(IAudioEndpointVolume).GUID; object o;
    dev.Activate(ref iid, 0, IntPtr.Zero, out o);
    return (IAudioEndpointVolume)o;
  }
  public static float Get() { float v; Vol().GetMasterVolumeLevelScalar(out v); return v; }
  public static void Set(float v) { Vol().SetMasterVolumeLevelScalar(v, Guid.Empty); }
  public static bool GetMute() { bool m; Vol().GetMute(out m); return m; }
  public static void SetMute(bool m) { Vol().SetMute(m, Guid.Empty); }
}
'@
`;

function ps(script, timeoutMs = 20000) {
  return new Promise((resolve) => {
    if (!WIN) return resolve({ ok: false, error: NOT_WINDOWS, out: "" });
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true },
    );
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }, timeoutMs);
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: e.message, out: "" });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        error: code === 0 ? "" : err.trim() || `کد خطا ${code}`,
        out: out.trim(),
      });
    });
  });
}

function parse(out) {
  try {
    const o = JSON.parse(out);
    return {
      ok: true,
      volume: Math.round(Number(o.volume) * 100),
      muted: o.muted === true || o.muted === "True",
    };
  } catch {
    return { ok: false, error: "خواندن صدای سیستم انجام نشد." };
  }
}

const REPORT = `[pscustomobject]@{ volume = [Audio]::Get(); muted = [Audio]::GetMute() } | ConvertTo-Json -Compress`;

/** Current master volume (0..100) and mute state of this computer. */
async function get() {
  if (!WIN) return { ok: false, error: NOT_WINDOWS };
  const res = await ps(`${CSHARP}\n${REPORT}`);
  if (!res.ok && !res.out) return { ok: false, error: res.error || NOT_WINDOWS };
  return parse(res.out);
}

/** Sets the master volume of this computer. volume: 0..100 */
async function set(volume) {
  if (!WIN) return { ok: false, error: NOT_WINDOWS };
  const clamped = Math.max(0, Math.min(100, Math.round(Number(volume) || 0)));
  const res = await ps(`${CSHARP}\n[Audio]::Set(${(clamped / 100).toFixed(3)})\n${REPORT}`);
  if (!res.ok && !res.out) return { ok: false, error: res.error || NOT_WINDOWS };
  return parse(res.out);
}

/** Mutes/unmutes this computer's speakers (independent of the TV volume). */
async function mute(on) {
  if (!WIN) return { ok: false, error: NOT_WINDOWS };
  const res = await ps(`${CSHARP}\n[Audio]::SetMute($${on ? "true" : "false"})\n${REPORT}`);
  if (!res.ok && !res.out) return { ok: false, error: res.error || NOT_WINDOWS };
  return parse(res.out);
}

module.exports = { get, set, mute };
