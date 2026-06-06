package com.nardeen.caffe;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.core.app.NotificationCompat;

/**
 * خدمة أمامية (Foreground Service) تُبقي خادم المزامنة المحلي حيًّا
 * حتى لو انتقل التطبيق للخلفية أو أُطفئت الشاشة.
 */
public class LanSyncService extends Service {
    private static final String TAG = "LanSyncService";
    private static final String CHANNEL_ID = "nardeen_lan_sync";
    private static final int NOTIF_ID = 4271;
    public static final int PORT = 8787;
    private LanSyncServer server;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        startForeground(NOTIF_ID, buildNotification());
        try {
            server = new LanSyncServer(PORT, getFilesDir());
            server.start(NanoTimeout.SOCKET_READ_TIMEOUT, false);
            Log.i(TAG, "LAN server started on " + LanSyncServer.getLocalIp() + ":" + PORT);
        } catch (Exception e) {
            Log.e(TAG, "failed to start LAN server", e);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (server != null) { try { server.stop(); } catch (Exception ignored) {} }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID, "مزامنة ناردين المحلية", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("إبقاء المزامنة المحلية بين الأجهزة فعّالة");
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    private Notification buildNotification() {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("ناردين كافيه")
                .setContentText("المزامنة المحلية فعّالة — " + LanSyncServer.getLocalIp())
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }

    /** ثابت مهلة قراءة المقبس لـ NanoHTTPD (نفس الافتراضي). */
    static final class NanoTimeout { static final int SOCKET_READ_TIMEOUT = 5000; }
}
