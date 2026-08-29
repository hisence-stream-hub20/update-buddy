// «انتقال اینترنت VPN به تلویزیون» — one big button plus the editable Wi-Fi
// name/password, the adapter pickers and the live client counter.
// Used both on the /internet page and (compact) inside the controller panel.

import { useState } from "react";
import { Eye, EyeOff, Loader2, RefreshCw, Save, ShieldAlert, Wifi, WifiOff } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useNetShare } from "@/lib/net-share";

export function InternetSharePanel({ compact = false }: { compact?: boolean }) {
  const share = useNetShare();
  const [showPassword, setShowPassword] = useState(false);
  const [publicAdapter, setPublicAdapter] = useState("");
  const [privateAdapter, setPrivateAdapter] = useState("");

  const running = share.status?.running === true;
  const clients = share.status?.clients ?? 0;
  const vpnList = share.adapters.filter((a) => a.vpn);
  const wifiList = share.adapters.filter((a) => a.wireless || /local area connection\*/i.test(a.name));

  return (
    <section className="rounded-2xl border border-primary/40 bg-card/70 p-4 text-right">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-lg bg-primary/15 text-primary">
            <Wifi className="size-5" />
          </span>
          <div>
            <h2 className="text-sm font-bold text-primary text-glow">اشتراک اینترنت VPN با وای‌فای</h2>
            <p className="text-xs text-muted-foreground">
              {running
                ? `روشن · ${clients} دستگاه متصل`
                : "خاموش — با یک دکمه، اینترنت این دستگاه به تلویزیون می‌رسد"}
            </p>
          </div>
        </div>
        <Badge variant={running ? "default" : "secondary"}>{running ? "فعال" : "غیرفعال"}</Badge>
      </header>

      {/* one-press action */}
      <div className="grid gap-2">
        {running ? (
          <Button variant="destructive" className="h-14 text-base" disabled={share.busy} onClick={() => void share.stop()}>
            {share.busy ? <Loader2 className="size-5 animate-spin" /> : <WifiOff className="size-5" />}
            خاموش‌کردن اشتراک اینترنت
          </Button>
        ) : (
          <Button
            className="h-14 text-base font-bold"
            disabled={share.busy}
            onClick={() => void share.start({ publicAdapter, privateAdapter })}
          >
            {share.busy ? <Loader2 className="size-5 animate-spin" /> : <Wifi className="size-5" />}
            انتقال اینترنت VPN به تلویزیون
          </Button>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" disabled={share.busy} onClick={() => void share.route({ publicAdapter, privateAdapter })}>
            <RefreshCw className="size-4" />
            اتصال دوباره به VPN
          </Button>
          <Button variant="outline" size="sm" onClick={() => void share.refresh()}>
            <RefreshCw className="size-4" />
            بروزرسانی وضعیت
          </Button>
        </div>
      </div>

      {/* editable network name + password */}
      <Separator className="my-4" />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="hotspot-ssid" className="text-xs">نام شبکه وای‌فای (SSID)</Label>
          <Input
            id="hotspot-ssid"
            dir="ltr"
            value={share.ssid}
            maxLength={32}
            onChange={(e) => share.setSsid(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="hotspot-pass" className="text-xs">رمز وای‌فای (حداقل ۸ نویسه)</Label>
          <div className="flex gap-1">
            <Input
              id="hotspot-pass"
              dir="ltr"
              type={showPassword ? "text" : "password"}
              value={share.password}
              maxLength={63}
              onChange={(e) => share.setPassword(e.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={showPassword ? "پنهان‌کردن رمز" : "نمایش رمز"}
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </Button>
          </div>
        </div>
      </div>
      <Button className="mt-3 w-full" variant="secondary" disabled={share.busy} onClick={() => void share.save()}>
        {share.busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
        ذخیره و اعمال نام/رمز جدید
      </Button>

      {/* adapters (advanced, hidden in the compact panel) */}
      {!compact && (
        <>
          <Separator className="my-4" />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label className="text-xs">کارت شبکه اینترنت/VPN (سمت عمومی)</Label>
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={publicAdapter}
                onChange={(e) => setPublicAdapter(e.target.value)}
              >
                <option value="">تشخیص خودکار</option>
                {(vpnList.length ? vpnList : share.adapters).map((a) => (
                  <option key={a.name} value={a.name}>
                    {a.name} {a.up ? "" : "(خاموش)"}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">کارت هات‌اسپات (سمت خصوصی)</Label>
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={privateAdapter}
                onChange={(e) => setPrivateAdapter(e.target.value)}
              >
                <option value="">تشخیص خودکار</option>
                {(wifiList.length ? wifiList : share.adapters).map((a) => (
                  <option key={a.name} value={a.name}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => void share.loadAdapters()}>
            <RefreshCw className="size-4" />
            بارگیری دوباره کارت‌های شبکه
          </Button>
        </>
      )}

      {/* guidance + result messages */}
      {share.status?.elevated === false && (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          برنامه بدون دسترسی مدیر اجرا شده است. روی آیکن برنامه راست‌کلیک کنید و «Run as administrator» را بزنید تا
          اشتراک اینترنت کار کند.
        </p>
      )}
      {share.mobile && (
        <p className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-2 text-xs text-muted-foreground">
          در گوشی، این دکمه صفحه هات‌اسپات اندروید را باز می‌کند؛ اول VPN را وصل کنید و بعد هات‌اسپات را روشن کنید.
          <Button variant="link" size="sm" className="px-1" onClick={() => void share.openVpnSettings()}>
            باز کردن تنظیمات VPN
          </Button>
        </p>
      )}
      {share.message && (
        <p className="mt-3 rounded-lg border border-primary/30 bg-primary/10 p-2 text-xs text-primary">{share.message}</p>
      )}
      {share.error && (
        <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {share.error}
        </p>
      )}
      {!compact && (
        <ol className="mt-4 grid gap-1 text-xs text-muted-foreground">
          <li>۱. VPN رایانه را وصل کنید.</li>
          <li>۲. همین دکمه بزرگ را بزنید (برنامه باید با Run as administrator اجرا شده باشد).</li>
          <li>۳. در تلویزیون یا گوشی، به وای‌فای «{share.ssid}» با همین رمز وصل شوید.</li>
          <li>۴. حالا همه ترافیک آن دستگاه از تونل VPN رایانه بیرون می‌رود.</li>
        </ol>
      )}
    </section>
  );
}
