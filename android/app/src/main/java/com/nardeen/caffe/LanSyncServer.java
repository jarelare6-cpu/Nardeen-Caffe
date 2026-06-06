package com.nardeen.caffe;

import android.util.Log;
import fi.iki.elonen.NanoHTTPD;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * خادم مزامنة محلي بسيط (LAN) — يعمل على جهاز الكاشير.
 * يخزّن الصفوف لكل جدول مع طابع زمني (_ut) ويحلّ التعارض بأحدث طابع (LWW).
 * يوزّع أرقام الطلبات تسلسليًّا (المُوزِّع الوحيد) مع إمكانية التصفير.
 */
public class LanSyncServer extends NanoHTTPD {
    private static final String TAG = "LanSyncServer";
    private final ConcurrentHashMap<String, JSONObject> store = new ConcurrentHashMap<>();
    private long counter = 0;
    private final File persistFile;

    public LanSyncServer(int port, File dir) {
        super(port);
        this.persistFile = new File(dir, "lan_store.json");
        load();
    }

    private static String key(String table, String id) { return table + ":" + id; }

    @Override
    public Response serve(IHTTPSession session) {
        String uri = session.getUri();
        Method method = session.getMethod();
        try {
            if (Method.OPTIONS.equals(method)) return cors(newFixedLengthResponse(Response.Status.OK, "text/plain", ""));

            if (uri.endsWith("/ping")) {
                JSONObject o = new JSONObject();
                o.put("ok", true); o.put("ip", getLocalIp()); o.put("ts", System.currentTimeMillis()); o.put("counter", counter);
                return json(o.toString());
            }
            if (uri.endsWith("/ip")) {
                JSONObject o = new JSONObject(); o.put("ip", getLocalIp());
                return json(o.toString());
            }
            if (uri.endsWith("/changes")) {
                long since = 0;
                Map<String, java.util.List<String>> p = session.getParameters();
                if (p.containsKey("since") && !p.get("since").isEmpty()) {
                    try { since = Long.parseLong(p.get("since").get(0)); } catch (Exception ignored) {}
                }
                JSONArray rows = new JSONArray();
                for (JSONObject row : store.values()) {
                    if (row.optLong("_ut", 0) > since) rows.put(row);
                }
                JSONObject o = new JSONObject();
                o.put("ts", System.currentTimeMillis()); o.put("counter", counter); o.put("rows", rows);
                return json(o.toString());
            }
            if (uri.endsWith("/push") && Method.POST.equals(method)) {
                Map<String, String> files = new HashMap<>();
                session.parseBody(files);
                String body = files.get("postData");
                JSONObject in = new JSONObject(body == null ? "{}" : body);
                String table = in.optString("table", "");
                JSONObject row = in.optJSONObject("row");
                if (table.isEmpty() || row == null || !row.has("id")) {
                    return json("{\"ok\":false,\"error\":\"bad row\"}");
                }
                row.put("_ut", System.currentTimeMillis());
                row.put("_table", table);
                // ترقيم الطلبات: المُوزِّع الوحيد
                if ("orders".equals(table)) {
                    long num = row.optLong("number", 0);
                    if (num <= 0) { num = ++counter; row.put("number", num); }
                    else if (num > counter) { counter = num; }
                }
                String k = key(table, row.getString("id"));
                JSONObject ex = store.get(k);
                if (ex == null || row.optLong("_ut", 0) >= ex.optLong("_ut", 0)) store.put(k, row);
                persist();
                JSONObject o = new JSONObject(); o.put("ok", true);
                if (row.has("number")) o.put("number", row.getLong("number"));
                return json(o.toString());
            }
            if (uri.endsWith("/reset") && Method.POST.equals(method)) {
                counter = 0; persist();
                return json("{\"ok\":true}");
            }
            return cors(newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "not found"));
        } catch (Exception e) {
            Log.e(TAG, "serve error", e);
            return json("{\"ok\":false,\"error\":\"server\"}");
        }
    }

    private Response json(String s) {
        return cors(newFixedLengthResponse(Response.Status.OK, "application/json", s));
    }

    private Response cors(Response r) {
        r.addHeader("Access-Control-Allow-Origin", "*");
        r.addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        r.addHeader("Access-Control-Allow-Headers", "Content-Type");
        return r;
    }

    private synchronized void persist() {
        try {
            JSONObject root = new JSONObject();
            root.put("counter", counter);
            JSONArray rows = new JSONArray();
            for (JSONObject row : store.values()) rows.put(row);
            root.put("rows", rows);
            byte[] data = root.toString().getBytes("UTF-8");
            FileOutputStream fos = new FileOutputStream(persistFile);
            fos.write(data); fos.close();
        } catch (Exception e) { Log.e(TAG, "persist error", e); }
    }

    private void load() {
        try {
            if (!persistFile.exists()) return;
            FileInputStream fis = new FileInputStream(persistFile);
            byte[] data = new byte[(int) persistFile.length()];
            int read = fis.read(data); fis.close();
            if (read <= 0) return;
            JSONObject root = new JSONObject(new String(data, "UTF-8"));
            counter = root.optLong("counter", 0);
            JSONArray rows = root.optJSONArray("rows");
            if (rows != null) {
                for (int i = 0; i < rows.length(); i++) {
                    JSONObject row = rows.optJSONObject(i);
                    if (row != null && row.has("_table") && row.has("id")) {
                        store.put(key(row.getString("_table"), row.getString("id")), row);
                    }
                }
            }
        } catch (Exception e) { Log.e(TAG, "load error", e); }
    }

    public static String getLocalIp() {
        try {
            Enumeration<NetworkInterface> ifaces = NetworkInterface.getNetworkInterfaces();
            while (ifaces.hasMoreElements()) {
                NetworkInterface ni = ifaces.nextElement();
                if (!ni.isUp() || ni.isLoopback()) continue;
                Enumeration<InetAddress> addrs = ni.getInetAddresses();
                while (addrs.hasMoreElements()) {
                    InetAddress a = addrs.nextElement();
                    if (!a.isLoopbackAddress() && a.isSiteLocalAddress() && a.getHostAddress().indexOf(':') < 0) {
                        return a.getHostAddress();
                    }
                }
            }
        } catch (Exception ignored) {}
        return "127.0.0.1";
    }
}
