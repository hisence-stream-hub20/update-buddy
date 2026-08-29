package app.lovable.universalmediaserver;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/**
 * Second launcher icon on the phone's home screen ("کنترل‌پنل").
 * It is an independent task (taskAffinity in the manifest), so opening it does
 * NOT close the main app: both icons can be used at the same time, and this one
 * starts directly on the /panel screen (player controls, device + phone volume,
 * and Wi-Fi sharing of the VPN internet).
 */
public class PanelActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(UmsNativePlugin.class);
        super.onCreate(savedInstanceState);
        // Capacitor loads the bundled index; jump straight to the panel route.
        this.getBridge().getWebView().post(() ->
            this.getBridge().getWebView().evaluateJavascript(
                "window.location.hash='';window.location.pathname='/panel';", null));
    }
}
