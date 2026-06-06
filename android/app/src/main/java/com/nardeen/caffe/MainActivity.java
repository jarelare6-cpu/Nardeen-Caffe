package com.nardeen.caffe;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // شغّل خادم LAN على الكاشير فقط وعند تفعيل المزامنة المحلية.
        // التطبيق يحفظ هذه القيم في تخزين Capacitor (SharedPreferences).
        try {
            SharedPreferences sp = getSharedPreferences("CapacitorStorage", MODE_PRIVATE);
            String enabled = pref(sp, "lan_enabled");
            String role = pref(sp, "lan_role");
            if ("true".equals(enabled) && "cashier".equals(role)) {
                Intent svc = new Intent(this, LanSyncService.class);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(svc);
                else startService(svc);
            }
        } catch (Exception ignored) {}
    }

    private static String pref(SharedPreferences sp, String key) {
        String v = sp.getString(key, null);
        if (v == null) v = sp.getString("_cap_" + key, null); // احتياط لاختلاف الإصدارات
        return v;
    }
}
