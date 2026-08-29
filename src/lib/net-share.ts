// Renderer-side logic for "send my VPN internet to the TV over Wi-Fi".
//
// Desktop: drives the Windows hotspot + Internet Connection Sharing backend.
// Android: opens the phone's own tethering page (the phone shares its data/VPN).
// Browser preview: everything reports the demo-mode message instead of failing.

import { useCallback, useEffect, useState } from "react";

import { getUms, WEB_MODE_MESSAGE, type NetAdapter, type NetShareStatus } from "./ums-bridge";

const SSID_KEY = "ums.hotspot.ssid";
const PASS_KEY = "ums.hotspot.password";

export const DEFAULT_SSID = "UMS-TV";
export const DEFAULT_PASSWORD = "12345678";

function readLocal(key: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  try {
    return window.localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

export function validatePassword(password: string) {
  if (password.length < 8) return "رمز وای‌فای باید حداقل ۸ نویسه باشد.";
  if (password.length > 63) return "رمز وای‌فای طولانی‌تر از حد مجاز است (حداکثر ۶۳ نویسه).";
  if (/[^\x20-\x7E]/.test(password)) return "رمز فقط با حروف و عددهای انگلیسی نوشته شود.";
  return "";
}

export function validateSsid(ssid: string) {
  if (ssid.trim().length < 2) return "نام شبکه باید حداقل ۲ نویسه باشد.";
  if (ssid.length > 32) return "نام شبکه حداکثر ۳۲ نویسه است.";
  return "";
}

/** One place for the hotspot state, the adapter list and every action. */
export function useNetShare(pollMs = 4000) {
  const [available, setAvailable] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [status, setStatus] = useState<NetShareStatus | null>(null);
  const [adapters, setAdapters] = useState<NetAdapter[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [ssid, setSsid] = useState(() => readLocal(SSID_KEY, DEFAULT_SSID));
  const [password, setPassword] = useState(() => readLocal(PASS_KEY, DEFAULT_PASSWORD));

  const refresh = useCallback(async () => {
    const api = getUms();
    if (!api?.netShareStatus) return null;
    try {
      const next = await api.netShareStatus();
      setStatus(next);
      if (next.ssid) setSsid((prev) => (prev === DEFAULT_SSID ? next.ssid! : prev));
      return next;
    } catch {
      return null;
    }
  }, []);

  const loadAdapters = useCallback(async () => {
    const api = getUms();
    if (!api?.netShareAdapters) return;
    try {
      const res = await api.netShareAdapters();
      setAdapters(res.adapters ?? []);
      if (!res.ok && res.error) setError(res.error);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const api = getUms();
    setAvailable(Boolean(api?.netShareStart));
    setMobile(Boolean(api && !api.isDesktop));
    if (!api?.netShareStatus) return;
    void refresh();
    void loadAdapters();
    const timer = window.setInterval(() => void refresh(), pollMs);
    return () => window.clearInterval(timer);
  }, [refresh, loadAdapters, pollMs]);

  const remember = useCallback((nextSsid: string, nextPassword: string) => {
    writeLocal(SSID_KEY, nextSsid);
    writeLocal(PASS_KEY, nextPassword);
  }, []);

  /** The single big button: turn the shared Wi-Fi on. */
  const start = useCallback(
    async (options?: { publicAdapter?: string; privateAdapter?: string }) => {
      setError("");
      setMessage("");
      const api = getUms();
      // On the phone Android itself owns the hotspot: open its page.
      if (api && !api.isDesktop) {
        const res = (await api.openTethering?.()) ?? { ok: false, error: WEB_MODE_MESSAGE };
        if (res.ok) setMessage("صفحه هات‌اسپات گوشی باز شد؛ آن را روشن کنید تا تلویزیون وصل شود.");
        else setError(res.error || WEB_MODE_MESSAGE);
        return res;
      }
      if (!api?.netShareStart) {
        setError(WEB_MODE_MESSAGE);
        return { ok: false, error: WEB_MODE_MESSAGE };
      }
      const ssidError = validateSsid(ssid) || validatePassword(password);
      if (ssidError) {
        setError(ssidError);
        return { ok: false, error: ssidError };
      }
      setBusy(true);
      try {
        const res = await api.netShareStart({ ssid, password, ...(options ?? {}) });
        if (res.ok) {
          remember(ssid, password);
          setMessage(res.note || `وای‌فای «${ssid}» روشن شد؛ روی تلویزیون به آن وصل شوید.`);
        } else {
          setError(res.error || "روشن‌کردن اشتراک اینترنت انجام نشد.");
        }
        await refresh();
        return res;
      } finally {
        setBusy(false);
      }
    },
    [ssid, password, refresh, remember],
  );

  /** Applies a new network name / password (restarts the hotspot when needed). */
  const save = useCallback(async () => {
    setError("");
    setMessage("");
    const invalid = validateSsid(ssid) || validatePassword(password);
    if (invalid) {
      setError(invalid);
      return { ok: false, error: invalid };
    }
    remember(ssid, password);
    const api = getUms();
    if (!api?.netShareUpdate) {
      setMessage("نام و رمز ذخیره شد؛ در نسخه نصب‌شده روی وای‌فای اعمال می‌شود.");
      return { ok: true };
    }
    setBusy(true);
    try {
      const res = await api.netShareUpdate({ ssid, password });
      if (res.ok) setMessage(res.note || "نام و رمز وای‌فای تغییر کرد.");
      else setError(res.error || "تغییر رمز انجام نشد.");
      await refresh();
      return res;
    } finally {
      setBusy(false);
    }
  }, [ssid, password, refresh, remember]);

  /** Re-binds the VPN adapter to the hotspot (used after the VPN reconnects). */
  const route = useCallback(
    async (options?: { publicAdapter?: string; privateAdapter?: string }) => {
      setError("");
      setMessage("");
      const api = getUms();
      if (!api?.netShareRoute) {
        setError(WEB_MODE_MESSAGE);
        return { ok: false, error: WEB_MODE_MESSAGE };
      }
      setBusy(true);
      try {
        const res = await api.netShareRoute(options ?? {});
        if (res.ok) setMessage(res.note || "مسیر اینترنت VPN روی وای‌فای تنظیم شد.");
        else setError(res.error || "تنظیم مسیر VPN انجام نشد.");
        await refresh();
        return res;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const stop = useCallback(async () => {
    setError("");
    setMessage("");
    const api = getUms();
    if (!api?.netShareStop) {
      setError(WEB_MODE_MESSAGE);
      return { ok: false, error: WEB_MODE_MESSAGE };
    }
    setBusy(true);
    try {
      const res = await api.netShareStop();
      if (res.ok) setMessage("اشتراک اینترنت خاموش شد.");
      else setError(res.error || "خاموش‌کردن انجام نشد.");
      await refresh();
      return res;
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const openVpnSettings = useCallback(async () => {
    const api = getUms();
    if (api?.openVpnSettings) return api.openVpnSettings();
    return { ok: false, error: WEB_MODE_MESSAGE };
  }, []);

  return {
    available,
    mobile,
    status,
    adapters,
    busy,
    message,
    error,
    ssid,
    password,
    setSsid,
    setPassword,
    setError,
    setMessage,
    refresh,
    loadAdapters,
    start,
    save,
    route,
    stop,
    openVpnSettings,
  };
}

/** Volume of the machine the app itself runs on (PC speakers / phone speaker). */
export function useLocalVolume(pollMs = 5000) {
  const [available, setAvailable] = useState(false);
  const [volume, setVolume] = useState(50);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const api = getUms();
    if (!api?.localVolume) return;
    try {
      const res = await api.localVolume();
      if (res.ok) {
        if (typeof res.volume === "number") setVolume(res.volume);
        setMuted(res.muted === true);
        setError("");
      } else if (res.error) {
        setError(res.error);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const api = getUms();
    setAvailable(Boolean(api?.setLocalVolume));
    if (!api?.localVolume) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), pollMs);
    return () => window.clearInterval(timer);
  }, [refresh, pollMs]);

  const apply = useCallback(async (next: number) => {
    setVolume(next);
    const api = getUms();
    if (!api?.setLocalVolume) {
      setError(WEB_MODE_MESSAGE);
      return;
    }
    const res = await api.setLocalVolume(next);
    if (res.ok) {
      setMuted(res.muted === true);
      setError("");
    } else if (res.error) {
      setError(res.error);
    }
  }, []);

  const toggleMute = useCallback(async () => {
    const api = getUms();
    const next = !muted;
    setMuted(next);
    if (!api?.setLocalMute) {
      setError(WEB_MODE_MESSAGE);
      return;
    }
    const res = await api.setLocalMute(next);
    if (res.ok) {
      setMuted(res.muted === true);
      if (typeof res.volume === "number") setVolume(res.volume);
      setError("");
    } else if (res.error) {
      setError(res.error);
    }
  }, [muted]);

  return { available, volume, muted, error, apply, toggleMute, refresh };
}
