package com.whiteboardtv.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.net.http.SslError;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

public final class MainActivity extends Activity {
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private SharedPreferences preferences;
    private FrameLayout root;
    private WebView web;
    private View overlay;
    private String origin;
    private int requestVersion;
    private AlertDialog menu;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        preferences = getSharedPreferences("whiteboard_tv", MODE_PRIVATE);
        origin = preferences.getString("origin", "");
        root = new FrameLayout(this); root.setBackgroundColor(Color.rgb(247, 248, 250)); setContentView(root);
        immersive();
        if (origin.isEmpty()) showSettings();
        else openBoard(ServerAddress.resumeUrl(origin, preferences.getString("roomUrl", "")));
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private void immersive() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }
    @Override public void onWindowFocusChanged(boolean focused) { super.onWindowFocusChanged(focused); if (focused) immersive(); }
    private TextView text(String value, int size, int color) {
        TextView view = new TextView(this); view.setText(value); view.setTextSize(size); view.setTextColor(color); view.setPadding(0, dp(6), 0, dp(6)); return view;
    }
    private void focusStyle(View view) {
        view.setOnFocusChangeListener((v, focused) -> {
            GradientDrawable background = new GradientDrawable(); background.setCornerRadius(dp(10));
            background.setColor(focused ? Color.rgb(233,238,255) : Color.WHITE);
            background.setStroke(dp(focused ? 3 : 1), focused ? Color.rgb(49,94,251) : Color.rgb(205,213,225));
            v.setBackground(background); v.setPadding(dp(18), dp(10), dp(18), dp(10));
        });
    }
    private Button button(String title, Runnable action) {
        Button b = new Button(this); b.setText(title); b.setTextSize(19); b.setAllCaps(false); b.setTextColor(Color.rgb(23,32,51));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(58)); params.topMargin = dp(12); b.setLayoutParams(params);
        focusStyle(b); b.setOnClickListener(v -> action.run()); return b;
    }
    private LinearLayout panel() {
        if (overlay != null) root.removeView(overlay);
        LinearLayout panel = new LinearLayout(this); panel.setOrientation(LinearLayout.VERTICAL); panel.setGravity(Gravity.CENTER_VERTICAL);
        panel.setPadding(dp(48),dp(24),dp(48),dp(24)); panel.setBackgroundColor(Color.rgb(247,248,250));
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(-1,-1); root.addView(panel,params); overlay = panel; return panel;
    }
    private void showSettings() {
        requestVersion++;
        if (web != null) web.onPause();
        LinearLayout panel = panel();
        panel.addView(text("共创白板 · 连接服务", 30, Color.rgb(23,32,51)));
        panel.addView(text("输入手机和电视都能访问的白板服务地址",18,Color.rgb(89,101,121)));
        EditText address = new EditText(this); address.setSingleLine(true); address.setTextSize(22); address.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        address.setHint("例如 http://192.168.1.20:8787"); address.setText(origin); address.setSelectAllOnFocus(true); focusStyle(address);
        panel.addView(address,new LinearLayout.LayoutParams(-1,dp(62)));
        TextView hint = text("局域网可使用 HTTP，跨网络请使用 HTTPS。方向键选择，确认键进入。",16,Color.rgb(89,101,121)); panel.addView(hint);
        Button connect = button("连接并打开白板", () -> {}); panel.addView(connect);
        connect.setOnClickListener(v -> {
            final String candidate;
            try { candidate = ServerAddress.normalize(address.getText().toString()); } catch (IllegalArgumentException error) { hint.setText(error.getMessage()); address.requestFocus(); return; }
            int version = ++requestVersion; connect.setEnabled(false); hint.setText("正在检查白板服务…");
            network.execute(() -> {
                String problem = null; HttpURLConnection connection = null;
                try {
                    connection = (HttpURLConnection)new URL(candidate + "/api/health").openConnection();
                    connection.setConnectTimeout(8000); connection.setReadTimeout(8000); connection.setInstanceFollowRedirects(false);
                    if (connection.getResponseCode() != 200) throw new Exception();
                    java.io.ByteArrayOutputStream response = new java.io.ByteArrayOutputStream();
                    try (java.io.InputStream input = connection.getInputStream()) {
                        byte[] chunk = new byte[1024]; int length;
                        while ((length = input.read(chunk)) != -1) { if (response.size() + length > 4096) throw new Exception(); response.write(chunk,0,length); }
                    }
                    if (!new JSONObject(response.toString("UTF-8")).optBoolean("ok")) throw new Exception();
                } catch (Exception e) { problem = "无法连接白板服务。请检查地址、服务是否启动，以及电视和手机的网络。"; }
                finally { if (connection != null) connection.disconnect(); }
                final String error = problem;
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed() || requestVersion != version) return;
                    connect.setEnabled(true);
                    if (error != null) { hint.setText(error); connect.requestFocus(); return; }
                    boolean changed = !candidate.equals(origin); origin = candidate;
                    preferences.edit().putString("origin",origin).apply();
                    if (changed) preferences.edit().remove("roomUrl").apply();
                    openBoard(ServerAddress.resumeUrl(origin,preferences.getString("roomUrl","")));
                });
            });
        });
        if (web != null) panel.addView(button("返回当前白板", () -> { requestVersion++; root.removeView(overlay); overlay = null; web.onResume(); web.requestFocus(); }));
        if (origin.isEmpty()) address.requestFocus(); else connect.requestFocus();
    }
    @SuppressLint("SetJavaScriptEnabled")
    private void openBoard(String url) {
        requestVersion++;
        if (web != null) { root.removeView(web); web.destroy(); }
        if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);
        web = new WebView(this); root.addView(web,0,new FrameLayout.LayoutParams(-1,-1));
        WebSettings settings = web.getSettings(); settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false); settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false); settings.setJavaScriptCanOpenWindowsAutomatically(false); settings.setMediaPlaybackRequiresUserGesture(true);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                boolean blocked = !ServerAddress.sameOrigin(origin,request.getUrl().toString());
                if (blocked && request.isForMainFrame()) Toast.makeText(MainActivity.this,"请在手机上打开外部链接",Toast.LENGTH_SHORT).show();
                return blocked;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String scheme = request.getUrl().getScheme();
                if ("data".equals(scheme) || ServerAddress.sameOrigin(origin,request.getUrl().toString())) return null;
                return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) { handler.cancel(); showFailure("服务证书无效，请修复 HTTPS 证书后重试。"); }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) { if (request.isForMainFrame()) showFailure("白板暂时无法加载，请检查网络和服务地址。"); }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) { if (request.isForMainFrame()) showFailure("服务返回错误 " + response.getStatusCode() + "，请检查服务地址。"); }
            @Override public void doUpdateVisitedHistory(WebView view, String url, boolean reload) { remember(url); }
            @Override public void onPageFinished(WebView view, String url) {
                remember(url);
                if (overlay != null && "loading".equals(overlay.getTag())) { root.removeView(overlay); overlay = null; }
                if (overlay == null && web != null) web.requestFocus();
            }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                root.removeView(view); view.destroy(); web = null; showFailure("电视释放了白板页面，重新打开即可恢复已保存内容。"); return true;
            }
        });
        web.setDownloadListener((a,b,c,d,e) -> Toast.makeText(this,"请在手机或 Pad 导出白板副本",Toast.LENGTH_LONG).show());
        PackageInfo info = WebView.getCurrentWebViewPackage();
        if (info != null) {
            try {
                int major = Integer.parseInt(info.versionName.split("\\.")[0]);
                if (major < 66) { showFailure("电视浏览组件版本过旧，请更新 Android System WebView 后重试。"); return; }
                if (major < 110) url = ServerAddress.legacyUrl(origin, url);
            } catch (NumberFormatException ignored) { }
        }
        LinearLayout loading = panel(); loading.setTag("loading"); loading.addView(text("正在打开共创白板…",28,Color.rgb(23,32,51)));
        loading.addView(button("服务地址设置",this::showSettings));
        web.loadUrl(url);
    }
    private void remember(String url) {
        if (ServerAddress.sameOrigin(origin,url)) preferences.edit().putString("roomUrl",ServerAddress.resumeUrl(origin,url)).apply();
    }
    private void showFailure(String message) {
        LinearLayout panel = panel(); panel.addView(text(message,24,Color.rgb(23,32,51)));
        Button retry = button("重新打开白板", () -> openBoard(ServerAddress.resumeUrl(origin,preferences.getString("roomUrl","")))); panel.addView(retry);
        panel.addView(button("修改服务地址",this::showSettings)); retry.requestFocus();
    }
    private void showMenu() {
        if (menu != null && menu.isShowing()) return;
        if (origin.isEmpty()) {
            menu = new AlertDialog.Builder(this).setTitle("共创白板")
                .setItems(new String[]{"继续设置", "退出应用"}, (dialog, which) -> { if (which == 1) finish(); }).create();
            menu.show(); return;
        }
        menu = new AlertDialog.Builder(this).setTitle("电视白板")
            .setItems(new String[]{overlay == null ? "继续展示" : "返回当前页面", "重新加载", "新建白板", "服务地址设置", "退出应用"}, (dialog, which) -> {
                if (which == 1) openBoard(ServerAddress.resumeUrl(origin,preferences.getString("roomUrl","")));
                if (which == 2) new AlertDialog.Builder(this).setTitle("新建白板？").setMessage("当前白板仍保留在服务中，手机成员可以继续使用。电视将进入新白板创建页。")
                    .setNegativeButton("取消",null).setPositiveButton("新建",(d,w) -> { preferences.edit().remove("roomUrl").apply(); openBoard(ServerAddress.startUrl(origin)); }).show();
                if (which == 3) showSettings();
                if (which == 4) finish();
            }).create();
        menu.show();
    }
    @Override public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getKeyCode() == KeyEvent.KEYCODE_MENU) { if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) showMenu(); return true; }
        if (web != null && overlay == null) {
            String key = switch (event.getKeyCode()) { case KeyEvent.KEYCODE_DPAD_UP -> "ArrowUp"; case KeyEvent.KEYCODE_DPAD_DOWN -> "ArrowDown"; case KeyEvent.KEYCODE_DPAD_LEFT -> "ArrowLeft"; case KeyEvent.KEYCODE_DPAD_RIGHT -> "ArrowRight"; case KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> "Enter"; default -> null; };
            if (key != null) { if (event.getAction() == KeyEvent.ACTION_DOWN) web.evaluateJavascript("window.WhiteboardTV && window.WhiteboardTV.key('" + key + "')",null); return true; }
        }
        return super.dispatchKeyEvent(event);
    }
    @Override public void onBackPressed() {
        if (web != null && overlay == null) web.evaluateJavascript("!!(window.WhiteboardTV && window.WhiteboardTV.back())", handled -> { if (!"true".equals(handled) && !isFinishing()) showMenu(); });
        else showMenu();
    }
    @Override protected void onPause() { if (web != null) { remember(web.getUrl()); web.onPause(); } super.onPause(); }
    @Override protected void onResume() { super.onResume(); if (web != null && overlay == null) web.onResume(); immersive(); }
    @Override protected void onDestroy() { requestVersion++; network.shutdownNow(); if (web != null) { root.removeView(web); web.destroy(); web = null; } super.onDestroy(); }
}
