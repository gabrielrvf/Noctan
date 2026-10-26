package app.noctan.mobile;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.widget.Toast;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import android.speech.RecognizerIntent;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER = 2001;
    private static final int VOICE_REQUEST = 2002;
    private static final int AUDIO_PERMISSION = 2003;

    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " NoctanMobile/1.0.32");

        webView.addJavascriptInterface(new NativeBridge(), "NoctanNative");
        webView.setWebViewClient(new WebViewClient());

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView view,
                    ValueCallback<Uri[]> callback,
                    FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;

                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                startActivityForResult(intent, FILE_CHOOSER);
                return true;
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(request.getResources());
                    } else {
                        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, AUDIO_PERMISSION);
                    }
                });
            }
        });

        webView.loadUrl("file:///android_asset/index.html");
    }

    // Atualização do APK: ao abrir/voltar ao app (no máximo a cada 30 min) consulta a
    // última Release do GitHub; se for mais nova, oferece baixar e abre o instalador do
    // Android (ele sempre pede um toque em "Atualizar" para apps fora da Play Store).
    private static final String LATEST_RELEASE = "https://api.github.com/repos/yanoliveira16/Noctan/releases/latest";
    private static final String UPDATE_ACTION = "app.noctan.mobile.UPDATE_STATUS";
    private long lastUpdateCheck = 0;
    private String pendingApkUrl = null;
    private boolean updateBusy = false;

    @Override
    protected void onResume() {
        super.onResume();
        if (pendingApkUrl != null && getPackageManager().canRequestPackageInstalls()) {
            String url = pendingApkUrl;
            pendingApkUrl = null;
            downloadAndInstall(url);
            return;
        }
        if (System.currentTimeMillis() - lastUpdateCheck < 30 * 60_000L) return;
        lastUpdateCheck = System.currentTimeMillis();
        new Thread(this::checkForUpdate).start();
    }

    static boolean isNewerVersion(String remote, String local) {
        String[] a = remote.replaceFirst("^v", "").split("\\.");
        String[] b = local.replaceFirst("^v", "").split("\\.");
        for (int i = 0; i < Math.max(a.length, b.length); i++) {
            int x = i < a.length ? parseIntOrZero(a[i]) : 0;
            int y = i < b.length ? parseIntOrZero(b[i]) : 0;
            if (x != y) return x > y;
        }
        return false;
    }

    // InputStream.transferTo/readAllBytes só existem a partir do Android 13; minSdk é 26.
    private static void copy(InputStream in, OutputStream out) throws java.io.IOException {
        byte[] chunk = new byte[64 * 1024];
        for (int read; (read = in.read(chunk)) != -1; ) out.write(chunk, 0, read);
    }

    private static int parseIntOrZero(String value) {
        try { return Integer.parseInt(value.replaceAll("\\D.*$", "")); } catch (NumberFormatException error) { return 0; }
    }

    private void checkForUpdate() {
        try {
            HttpURLConnection connection = (HttpURLConnection) new URL(LATEST_RELEASE).openConnection();
            connection.setRequestProperty("Accept", "application/vnd.github+json");
            connection.setConnectTimeout(10_000);
            connection.setReadTimeout(15_000);
            if (connection.getResponseCode() != 200) return;
            String body;
            try (InputStream in = connection.getInputStream()) {
                java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
                copy(in, buffer);
                body = buffer.toString(StandardCharsets.UTF_8.name());
            }
            JSONObject release = new JSONObject(body);
            String version = release.optString("tag_name", "");
            if (!isNewerVersion(version, BuildConfig.VERSION_NAME)) return;
            JSONArray assets = release.optJSONArray("assets");
            String apkUrl = null;
            for (int i = 0; assets != null && i < assets.length(); i++) {
                JSONObject asset = assets.getJSONObject(i);
                if (asset.optString("name").endsWith(".apk")) apkUrl = asset.optString("browser_download_url");
            }
            if (apkUrl == null) return;
            String url = apkUrl;
            runOnUiThread(() -> {
                if (isFinishing() || updateBusy) return;
                new AlertDialog.Builder(this)
                        .setTitle("Atualização do Noctan")
                        .setMessage("Noctan " + version + " disponível (você está na v" + BuildConfig.VERSION_NAME + "). Atualizar agora?")
                        .setPositiveButton("Atualizar", (dialog, which) -> startUpdate(url))
                        .setNegativeButton("Depois", null)
                        .show();
            });
        } catch (Exception ignored) {
            // Sem rede ou GitHub fora: tenta de novo na próxima vez que o app abrir.
        }
    }

    private void startUpdate(String url) {
        if (!getPackageManager().canRequestPackageInstalls()) {
            // Uma vez só: o Android exige liberar "instalar apps desconhecidos" para o Noctan.
            pendingApkUrl = url;
            Toast.makeText(this, "Permita instalar atualizações do Noctan e volte ao app.", Toast.LENGTH_LONG).show();
            startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName())));
            return;
        }
        downloadAndInstall(url);
    }

    private void downloadAndInstall(String url) {
        updateBusy = true;
        Toast.makeText(this, "Baixando atualização do Noctan...", Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            try {
                PackageInstaller installer = getPackageManager().getPackageInstaller();
                PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                params.setAppPackageName(getPackageName());
                int sessionId = installer.createSession(params);
                try (PackageInstaller.Session session = installer.openSession(sessionId)) {
                    HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
                    connection.setInstanceFollowRedirects(true);
                    connection.setConnectTimeout(15_000);
                    connection.setReadTimeout(60_000);
                    try (InputStream in = connection.getInputStream();
                         OutputStream out = session.openWrite("noctan.apk", 0, -1)) {
                        copy(in, out);
                        session.fsync(out);
                    }
                    Intent status = new Intent(this, MainActivity.class).setAction(UPDATE_ACTION);
                    PendingIntent pending = PendingIntent.getActivity(this, sessionId, status,
                            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
                    session.commit(pending.getIntentSender());
                }
            } catch (Exception error) {
                runOnUiThread(() -> Toast.makeText(this, "Não foi possível atualizar agora.", Toast.LENGTH_LONG).show());
            } finally {
                updateBusy = false;
            }
        }).start();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (!UPDATE_ACTION.equals(intent.getAction())) return;
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm != null) startActivity(confirm);
        } else if (status != PackageInstaller.STATUS_SUCCESS) {
            Toast.makeText(this, "Atualização cancelada ou falhou.", Toast.LENGTH_LONG).show();
        }
    }

    public class NativeBridge {
        @JavascriptInterface
        public String getDefaultBase() { return BuildConfig.MOBILE_DEFAULT_BASE; }

        @JavascriptInterface
        public String getDefaultToken() { return BuildConfig.MOBILE_DEFAULT_TOKEN; }

        @JavascriptInterface
        public String getVersion() { return BuildConfig.VERSION_NAME; }

        @JavascriptInterface
        public void startVoice() {
            runOnUiThread(() -> {
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, AUDIO_PERMISSION);
                    return;
                }
                Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag());
                intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
                intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "Fale com o Noctan");
                try {
                    startActivityForResult(intent, VOICE_REQUEST);
                } catch (Exception error) {
                    sendVoiceError("Reconhecimento de voz indisponível");
                }
            });
        }

        @JavascriptInterface
        public void openAppSettings() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + getPackageName()));
                startActivity(intent);
            });
        }
    }

    private void sendVoiceError(String message) {
        if (webView == null) return;
        webView.post(() -> webView.evaluateJavascript(
                "window.NoctanVoiceError && window.NoctanVoiceError(" + JSONObject.quote(message) + ")",
                null
        ));
    }

    private void sendVoiceResult(String text) {
        if (webView == null) return;
        webView.post(() -> webView.evaluateJavascript(
                "window.NoctanVoiceResult && window.NoctanVoiceResult(" + JSONObject.quote(text) + ")",
                null
        ));
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == FILE_CHOOSER) {
            if (fileCallback == null) return;
            ArrayList<Uri> uris = new ArrayList<>();
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    for (int i = 0; i < data.getClipData().getItemCount(); i++) {
                        uris.add(data.getClipData().getItemAt(i).getUri());
                    }
                } else if (data.getData() != null) {
                    uris.add(data.getData());
                }
            }
            fileCallback.onReceiveValue(uris.isEmpty() ? null : uris.toArray(new Uri[0]));
            fileCallback = null;
            return;
        }

        if (requestCode == VOICE_REQUEST) {
            if (resultCode == RESULT_OK && data != null) {
                ArrayList<String> results = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
                if (results != null && !results.isEmpty()) sendVoiceResult(results.get(0));
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (webView == null) { super.onBackPressed(); return; }
        webView.evaluateJavascript("(window.NoctanHandleBack&&window.NoctanHandleBack())?true:false", value -> {
            if (!"true".equals(value)) {
                if (webView.canGoBack()) webView.goBack();
                else MainActivity.super.onBackPressed();
            }
        });
    }
}

