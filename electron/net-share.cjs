// Share the PC's internet (including a VPN tunnel) with the TV over Wi-Fi.
//
// The TV is not Android TV and cannot install a VPN client, so the only way to
// give it the tunnelled connection is to make this computer the TV's router:
//
//   1. Windows Mobile Hotspot (WinRT NetworkOperatorTetheringManager) creates a
//      real Wi-Fi access point on this machine.
//   2. Internet Connection Sharing (HNetCfg COM) is bound so that the *VPN*
//      adapter is the "public" side and the hotspot adapter is the "private"
//      side. Everything the TV requests then leaves through the VPN.
//
// Both steps are driven through short PowerShell scripts, because those APIs
// are only reachable from WinRT/COM and not from Node. ICS binding needs an
// elevated process, so the errors are reported back verbatim to the UI.

const { spawn } = require("node:child_process");

const state = {
  running: false,
  ssid: "",
  password: "",
  publicAdapter: "", // VPN / internet side
  privateAdapter: "", // hotspot side
  note: "",
};

const WIN = process.platform === "win32";
const NOT_WINDOWS = "اشتراک اینترنت با وای‌فای فقط در ویندوز کار می‌کند.";

function ps(script, timeoutMs = 45000) {
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
      resolve({ ok: code === 0, error: code === 0 ? "" : err.trim() || `کد خطا ${code}`, out: out.trim() });
    });
  });
}

function json(out) {
  try {
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- adapters

const LIST_SCRIPT = `
$a = Get-NetAdapter -IncludeHidden:$false | Where-Object { $_.Status -ne 'Not Present' } |
  Select-Object Name, InterfaceDescription, Status, MediaType,
    @{n='Up';e={ $_.Status -eq 'Up' }}
$a | ConvertTo-Json -Compress -Depth 3
`;

/** All network adapters on this machine, marking the likely VPN ones. */
async function adapters() {
  const res = await ps(LIST_SCRIPT, 20000);
  if (!res.ok) return { ok: false, error: res.error, adapters: [] };
  const list = json(res.out).map((a) => {
    const text = `${a.Name || ""} ${a.InterfaceDescription || ""}`.toLowerCase();
    return {
      name: String(a.Name || ""),
      description: String(a.InterfaceDescription || ""),
      up: a.Up === true,
      vpn: /vpn|tap|tun|wintun|wireguard|openvpn|nord|express|proton|cisco|anyconnect|ppp|l2tp|sstp|softether|outline|v2ray|xray|hysteria|singbox/.test(
        text,
      ),
      wireless: /wi-?fi|wireless|802\.11/.test(text),
    };
  });
  return { ok: true, adapters: list };
}

/** Best guess for the tunnel that carries international traffic. */
function pickVpn(list) {
  return list.find((a) => a.vpn && a.up) || list.find((a) => a.vpn) || null;
}

// ---------------------------------------------------------------- hotspot

const AWAIT_HELPER = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, $type) {
  $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $t.Wait(30000) | Out-Null
  $t.Result
}
`;

function hotspotStartScript(ssid, password) {
  const s = String(ssid).replace(/'/g, "''");
  const p = String(password).replace(/'/g, "''");
  return `${AWAIT_HELPER}
try {
  $profile = [Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime]::GetInternetConnectionProfile()
  if ($null -eq $profile) { Write-Output 'ERR:no-internet-profile'; exit 1 }
  $mgr = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,Windows.Networking.NetworkOperators,ContentType=WindowsRuntime]::CreateFromConnectionProfile($profile)
  $cfg = $mgr.GetCurrentAccessPointConfiguration()
  $cfg.Ssid = '${s}'
  $cfg.Passphrase = '${p}'
  $mgr.ConfigureAccessPointAsync($cfg).AsTask().Wait(20000) | Out-Null
  if ($mgr.TetheringOperationalState -ne 1) {
    $r = Await ($mgr.StartTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
    Write-Output ("STATUS:" + $r.Status + ":" + $r.AdditionalErrorMessage)
  } else { Write-Output 'STATUS:AlreadyOn' }
  Write-Output ("SSID:" + $cfg.Ssid)
} catch { Write-Output ('ERR:' + $_.Exception.Message); exit 1 }`;
}

const HOTSPOT_STOP_SCRIPT = `${AWAIT_HELPER}
try {
  $profile = [Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime]::GetInternetConnectionProfile()
  $mgr = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,Windows.Networking.NetworkOperators,ContentType=WindowsRuntime]::CreateFromConnectionProfile($profile)
  $r = Await ($mgr.StopTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
  Write-Output ("STATUS:" + $r.Status)
} catch { Write-Output ('ERR:' + $_.Exception.Message); exit 1 }`;

const HOTSPOT_STATE_SCRIPT = `${AWAIT_HELPER}
try {
  $profile = [Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime]::GetInternetConnectionProfile()
  $mgr = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,Windows.Networking.NetworkOperators,ContentType=WindowsRuntime]::CreateFromConnectionProfile($profile)
  $cfg = $mgr.GetCurrentAccessPointConfiguration()
  [pscustomobject]@{ on = ($mgr.TetheringOperationalState -eq 1); ssid = $cfg.Ssid; clients = $mgr.ClientCount } | ConvertTo-Json -Compress
} catch { '{}' }`;

// ---------------------------------------------------------------- ICS binding

function icsScript(publicName, privateName) {
  const pub = String(publicName).replace(/'/g, "''");
  const priv = String(privateName).replace(/'/g, "''");
  return `
try {
  $share = New-Object -ComObject HNetCfg.HNetShare
  $pub = $null; $priv = $null
  foreach ($c in $share.EnumEveryConnection) {
    $p = $share.NetConnectionProps($c)
    if ($p.Name -eq '${pub}') { $pub = $c }
    if ($p.Name -eq '${priv}') { $priv = $c }
  }
  if ($null -eq $pub) { Write-Output 'ERR:public-adapter-not-found'; exit 1 }
  if ($null -eq $priv) { Write-Output 'ERR:private-adapter-not-found'; exit 1 }
  foreach ($c in $share.EnumEveryConnection) {
    $cfg = $share.INetSharingConfigurationForINetConnection($c)
    if ($cfg.SharingEnabled) { $cfg.DisableSharing() }
  }
  $share.INetSharingConfigurationForINetConnection($pub).EnableSharing(0)
  $share.INetSharingConfigurationForINetConnection($priv).EnableSharing(1)
  Write-Output 'ICS:ok'
} catch { Write-Output ('ERR:' + $_.Exception.Message); exit 1 }`;
}

const ICS_OFF_SCRIPT = `
try {
  $share = New-Object -ComObject HNetCfg.HNetShare
  foreach ($c in $share.EnumEveryConnection) {
    $cfg = $share.INetSharingConfigurationForINetConnection($c)
    if ($cfg.SharingEnabled) { $cfg.DisableSharing() }
  }
  Write-Output 'ICS:off'
} catch { Write-Output ('ERR:' + $_.Exception.Message); exit 1 }`;

function friendly(out, fallback) {
  if (/no-internet-profile/.test(out)) return "این رایانه به اینترنت وصل نیست؛ اول VPN را وصل کنید.";
  if (/public-adapter-not-found/.test(out)) return "کارت شبکه VPN پیدا نشد؛ از فهرست، آداپتور درست را انتخاب کنید.";
  if (/private-adapter-not-found/.test(out))
    return "آداپتور هات‌اسپات پیدا نشد؛ ابتدا هات‌اسپات را روشن کنید و چند ثانیه صبر کنید.";
  if (/0x80070005|Access is denied|E_ACCESSDENIED/i.test(out))
    return "برای اشتراک اینترنت باید برنامه را با «Run as administrator» اجرا کنید.";
  if (/no wireless|WiFiDeviceNotAvailable|NotAllowed/i.test(out))
    return "کارت وای‌فای این رایانه از هات‌اسپات پشتیبانی نمی‌کند یا خاموش است.";
  const m = out.match(/ERR:(.+)/);
  return (m && m[1].trim()) || fallback;
}

// ---------------------------------------------------------------- public API

/** Live state: hotspot on/off, SSID, connected clients and chosen adapters. */
async function status() {
  if (!WIN) return { ok: false, running: false, error: NOT_WINDOWS, ...state };
  const res = await ps(HOTSPOT_STATE_SCRIPT, 20000);
  const info = json(res.out)[0] || {};
  state.running = info.on === true;
  if (info.ssid) state.ssid = String(info.ssid);
  return {
    ok: true,
    running: state.running,
    ssid: state.ssid,
    password: state.password,
    clients: Number(info.clients || 0),
    publicAdapter: state.publicAdapter,
    privateAdapter: state.privateAdapter,
    note: state.note,
  };
}

/**
 * Turns the hotspot on and routes it through the VPN adapter.
 * options: { ssid, password, publicAdapter?, privateAdapter? }
 */
async function start(options = {}) {
  if (!WIN) return { ok: false, error: NOT_WINDOWS };
  const ssid = String(options.ssid || "UMS-TV").slice(0, 32);
  const password = String(options.password || "");
  if (password.length < 8) return { ok: false, error: "رمز وای‌فای باید حداقل ۸ نویسه باشد." };

  const hs = await ps(hotspotStartScript(ssid, password), 60000);
  if (!hs.ok || /ERR:/.test(hs.out) || /STATUS:(Fail|Unknown)/.test(hs.out)) {
    return { ok: false, error: friendly(`${hs.out}\n${hs.error}`, "روشن‌کردن هات‌اسپات ناموفق بود.") };
  }
  state.ssid = ssid;
  state.password = password;
  state.running = true;

  // Find the VPN side and the hotspot side, then bind ICS between them.
  const list = (await adapters()).adapters;
  const pub =
    String(options.publicAdapter || "") ||
    (pickVpn(list)?.name ?? "");
  const priv =
    String(options.privateAdapter || "") ||
    (list.find((a) => /local area connection\*|microsoft wi-fi direct|hosted network/i.test(`${a.name} ${a.description}`))?.name ??
      "");

  if (!pub) {
    state.note = "هات‌اسپات روشن شد، اما آداپتور VPN شناسایی نشد؛ اینترنت معمولی به تلویزیون می‌رسد.";
    return { ok: true, running: true, ssid, note: state.note };
  }
  if (!priv) {
    state.note = "هات‌اسپات روشن شد؛ چند ثانیه بعد دکمه «اتصال به VPN» را بزنید تا مسیر VPN ست شود.";
    return { ok: true, running: true, ssid, note: state.note };
  }

  const ics = await ps(icsScript(pub, priv), 45000);
  if (!ics.ok || /ERR:/.test(ics.out)) {
    state.note = friendly(`${ics.out}\n${ics.error}`, "اتصال مسیر VPN به هات‌اسپات انجام نشد.");
    return { ok: true, running: true, ssid, note: state.note };
  }
  state.publicAdapter = pub;
  state.privateAdapter = priv;
  state.note = `اینترنت «${pub}» از طریق وای‌فای «${ssid}» به تلویزیون داده می‌شود.`;
  return { ok: true, running: true, ssid, publicAdapter: pub, privateAdapter: priv, note: state.note };
}

/** Re-binds ICS only (used after the hotspot adapter appears, or on VPN switch). */
async function route(options = {}) {
  if (!WIN) return { ok: false, error: NOT_WINDOWS };
  const list = (await adapters()).adapters;
  const pub = String(options.publicAdapter || "") || (pickVpn(list)?.name ?? "");
  const priv =
    String(options.privateAdapter || "") ||
    (list.find((a) => /local area connection\*|microsoft wi-fi direct|hosted network/i.test(`${a.name} ${a.description}`))?.name ??
      "");
  if (!pub || !priv) {
    return { ok: false, error: "آداپتور VPN یا هات‌اسپات پیدا نشد؛ آن‌ها را دستی انتخاب کنید." };
  }
  const ics = await ps(icsScript(pub, priv), 45000);
  if (!ics.ok || /ERR:/.test(ics.out)) {
    return { ok: false, error: friendly(`${ics.out}\n${ics.error}`, "تنظیم مسیر VPN انجام نشد.") };
  }
  state.publicAdapter = pub;
  state.privateAdapter = priv;
  state.note = `اینترنت «${pub}» روی هات‌اسپات «${priv}» تنظیم شد.`;
  return { ok: true, publicAdapter: pub, privateAdapter: priv, note: state.note };
}

/** Turns sharing and the hotspot off again. */
async function stop() {
  if (!WIN) return { ok: false, error: NOT_WINDOWS };
  await ps(ICS_OFF_SCRIPT, 30000);
  const res = await ps(HOTSPOT_STOP_SCRIPT, 40000);
  state.running = false;
  state.note = "";
  if (!res.ok || /ERR:/.test(res.out)) {
    return { ok: false, running: false, error: friendly(`${res.out}\n${res.error}`, "خاموش‌کردن هات‌اسپات ناموفق بود.") };
  }
  return { ok: true, running: false };
}

module.exports = { adapters, status, start, route, stop };
