package com.whiteboardtv.app;

import android.app.Service;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.*;
import android.util.AtomicFile;
import java.io.*;
import java.net.*;
import java.security.SecureRandom;
import java.util.concurrent.CopyOnWriteArrayList;
import org.json.JSONObject;

/** Private process: Node may exit without terminating the TV UI. No network control intent. */
public final class LocalServerService extends Service {
    public static final String ORIGIN = "http://127.0.0.1:8787";
    public static final int WATCH = 1, READY = 2, ERROR = 3;
    private static boolean started;
    private volatile boolean destroyed;
    private volatile int status;
    private volatile String problem = "";
    private final CopyOnWriteArrayList<android.os.Messenger> listeners = new CopyOnWriteArrayList<>();
    private File statusFile, networkFile;
    private String secret;
    private ConnectivityManager connectivity;
    private final ConnectivityManager.NetworkCallback callback = new ConnectivityManager.NetworkCallback() {
        @Override public void onAvailable(Network n) { updateNetwork(); }
        @Override public void onLost(Network n) { updateNetwork(); }
        @Override public void onLinkPropertiesChanged(Network n, LinkProperties p) { updateNetwork(); }
        @Override public void onCapabilitiesChanged(Network n, NetworkCapabilities c) { updateNetwork(); }
    };
    private final Messenger messenger = new Messenger(new Handler(Looper.getMainLooper(), message -> {
        if (message.what == WATCH && message.replyTo != null) {
            listeners.addIfAbsent(message.replyTo); if (status != 0) notifyListener(message.replyTo);
        }
        return true;
    }));
    private static native int startNode(String[] arguments);
    @Override public android.os.IBinder onBind(Intent intent) { return messenger.getBinder(); }
    @Override public void onCreate() {
        super.onCreate();
        statusFile = new File(getFilesDir(), "local-status.json");
        networkFile = new File(getFilesDir(), "local-network.json");
        byte[] random = new byte[32]; new SecureRandom().nextBytes(random);
        StringBuilder hex = new StringBuilder(); for (byte b : random) hex.append(String.format(java.util.Locale.ROOT, "%02x", b & 255)); secret = hex.toString();
        connectivity = (ConnectivityManager)getSystemService(CONNECTIVITY_SERVICE);
        updateNetwork();
        connectivity.registerDefaultNetworkCallback(callback);
        new Thread(this::boot, "whiteboard-local-boot").start();
    }
    private void notifyListener(Messenger target) {
        try { Message value = Message.obtain(null, status); Bundle data = new Bundle(); data.putString("error", problem); value.setData(data); target.send(value); }
        catch (RemoteException ignored) { listeners.remove(target); }
    }
    private void publish(int state, String error) { status = state; problem = error; for (Messenger target : listeners) notifyListener(target); }
    private void boot() {
        try {
            if (started) throw new IOException("本地服务正在关闭，请稍后重新打开应用");
            String runtimeId;
            try (BufferedReader input = new BufferedReader(new InputStreamReader(getAssets().open("local-runtime/id.txt"), java.nio.charset.StandardCharsets.UTF_8))) { runtimeId = input.readLine(); }
            if (runtimeId == null || !runtimeId.matches("[a-f0-9]{64}")) throw new IOException("安装包资源不完整，请重新安装");
            File runtime = new File(getFilesDir(), "runtime-" + runtimeId);
            if (!new File(runtime, ".ready").isFile()) {
                copyAssets("local-runtime", runtime);
                try (FileOutputStream out = new FileOutputStream(new File(runtime, ".ready"))) { out.write(1); out.getFD().sync(); }
            }
            if (destroyed) return;
            if (statusFile.exists() && !statusFile.delete()) throw new IOException("无法初始化本地服务状态");
            System.loadLibrary("c++_shared"); System.loadLibrary("node"); System.loadLibrary("whiteboard-node");
            started = true;
            new Thread(() -> {
                int code = startNode(new String[]{"node", new File(runtime, "server.cjs").getAbsolutePath(), runtime.getAbsolutePath(), new File(getFilesDir(), "boards").getAbsolutePath(), statusFile.getAbsolutePath(), networkFile.getAbsolutePath(), secret});
                if (!destroyed) publish(ERROR, "本地服务已停止，请退出后重新打开应用（" + code + "）");
            }, "whiteboard-node").start();
            for (int i = 0; i < 300 && !destroyed; i++) {
                if (statusFile.isFile()) {
                    JSONObject value = new JSONObject(read(statusFile));
                    if (value.optBoolean("ready")) { publish(READY, ""); return; }
                    throw new IOException(value.optString("error", "本地服务启动失败"));
                }
                Thread.sleep(100);
            }
            if (!destroyed) throw new IOException("本地服务启动超时，请退出后重新打开应用");
        } catch (Throwable error) { if (!destroyed) publish(ERROR, error.getMessage() == null ? "本地服务启动失败" : error.getMessage()); }
    }
    private static String read(File file) throws IOException {
        try (InputStream input = new FileInputStream(file); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096]; int n; while ((n = input.read(buffer)) != -1) { if (out.size() + n > 8192) throw new IOException("本地状态文件异常"); out.write(buffer, 0, n); }
            return out.toString("UTF-8");
        }
    }
    private void copyAssets(String path, File destination) throws IOException {
        String[] children = getAssets().list(path);
        if (children != null && children.length > 0) {
            if (!destination.isDirectory() && !destination.mkdirs()) throw new IOException("电视存储空间不足");
            for (String child : children) copyAssets(path + "/" + child, new File(destination, child));
        } else {
            try (InputStream input = getAssets().open(path); FileOutputStream out = new FileOutputStream(destination)) {
                byte[] buffer = new byte[32768]; int n; while ((n = input.read(buffer)) != -1) out.write(buffer, 0, n); out.getFD().sync();
            }
        }
    }
    private synchronized void updateNetwork() {
        if (destroyed) return;
        String address = null;
        try {
            // Default transport only: never advertise VPN, cellular or a stale saved IP.
            Network network = connectivity.getActiveNetwork();
            NetworkCapabilities capabilities = connectivity.getNetworkCapabilities(network);
            LinkProperties links = connectivity.getLinkProperties(network);
            if (capabilities != null && !capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
                && (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) && links != null) {
                for (LinkAddress link : links.getLinkAddresses()) {
                    InetAddress ip = link.getAddress();
                    if (ip instanceof Inet4Address && !ip.isLoopbackAddress() && !ip.isLinkLocalAddress() && !ip.isAnyLocalAddress()) { address = ip.getHostAddress(); break; }
                }
            }
            JSONObject data = new JSONObject(); data.put("address", address == null ? JSONObject.NULL : address);
            AtomicFile file = new AtomicFile(networkFile); FileOutputStream output = file.startWrite();
            try { output.write(data.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)); file.finishWrite(output); }
            catch (Exception error) { file.failWrite(output); }
        } catch (Exception ignored) { if (networkFile != null) networkFile.delete(); }
    }
    @Override public void onDestroy() {
        destroyed = true; listeners.clear();
        try { connectivity.unregisterNetworkCallback(callback); } catch (Exception ignored) { }
        // Drain durable mutations before exiting this separate process. A bounded fallback
        // handles a hung native runtime; already acknowledged mutations were fsynced.
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection)new URL(ORIGIN + "/api/local-stop").openConnection();
                connection.setConnectTimeout(1000); connection.setReadTimeout(1000);
                connection.setRequestMethod("POST"); connection.setRequestProperty("X-Local-Control", secret);
                connection.getResponseCode();
                connection.disconnect();
                Thread.sleep(30000);
            } catch (Exception ignored) { }
            finally { if (connection != null) connection.disconnect(); android.os.Process.killProcess(android.os.Process.myPid()); }
        }, "whiteboard-local-stop").start();
        super.onDestroy();
    }
}
