// Anyview Stream connect button.
//
// Sits next to every "share to TV" button in the app. It starts the desktop
// mirror over the Anyview Stream endpoint (Hisense / VIDAA), which has a much
// smaller pre-buffer than the plain DLNA path. The computer speakers are NOT
// silenced — the system sound keeps working while sharing.

import { useState } from "react";
import { MonitorUp } from "lucide-react";
import { toast } from "sonner";
import { WEB_MODE_MESSAGE, getUms, type DeviceTarget } from "@/lib/ums-bridge";
import { deviceLabel, type TvDevice } from "@/lib/ums-store";
import { openPlayer } from "@/lib/player-store";

function target(device: TvDevice): DeviceTarget {
  if (device.protocol === "Cast") {
    return { protocol: "Cast", ip: device.ip, port: device.port ?? 8009 };
  }
  return { protocol: device.protocol, controlUrl: device.avTransportUrl || "" };
}

export function AnyviewButton({
  device,
  compact = false,
  className = "",
}: {
  device?: TvDevice | undefined;
  compact?: boolean;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);

  const start = async () => {
    if (!device) {
      toast.error("تلویزیون مقصد انتخاب نشده است.");
      return;
    }
    const api = getUms();
    if (!api) {
      toast.error(WEB_MODE_MESSAGE);
      return;
    }
    if (device.protocol !== "Cast" && !device.avTransportUrl) {
      toast.error("این دستگاه سرویس AVTransport ندارد؛ دوباره جست‌وجو کنید.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.shareScreen({
        ...target(device),
        mode: "anyview",
        // System sound must stay on; the user controls it from the panel.
        muteLocal: false,
        panel: false,
      });
      if (!res.ok) {
        toast.error(res.error || "اتصال Anyview Stream برقرار نشد.");
        return;
      }
      openPlayer({ device, title: "Anyview Stream — صفحه دسکتاپ", live: true });
      toast.success(`Anyview Stream روی ${deviceLabel(device)} فعال شد.`);
      const note = (res as { note?: string }).note;
      if (note) toast.info(note);
    } catch {
      toast.error("اتصال Anyview Stream ناموفق بود؛ دوباره تلاش کنید.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void start()}
      disabled={busy}
      title="اتصال Anyview Stream (هایسنس/VIDAA) با تأخیر کمتر"
      aria-label="اتصال Anyview Stream"
      className={`inline-flex shrink-0 items-center gap-1 rounded-lg border border-primary/50 text-primary transition-colors hover:bg-primary/10 disabled:opacity-60 ${
        compact ? "p-1.5" : "px-3 py-2 text-xs font-semibold"
      } ${className}`}
    >
      <MonitorUp className="size-4" />
      {compact ? null : <span>{busy ? "در حال اتصال…" : "Anyview Stream"}</span>}
    </button>
  );
}
