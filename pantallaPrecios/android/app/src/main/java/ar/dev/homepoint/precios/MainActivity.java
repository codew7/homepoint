package ar.dev.homepoint.precios;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Kiosco de precios: muestra la página publicada a pantalla completa.
 * El contenido se actualiza solo (se carga desde la web) y el APK se actualiza con {@link Updater}.
 */
public class MainActivity extends Activity {

    private static final long REINTENTO_MS = 15_000;
    private static final long CHEQUEO_APK_MS = 6 * 60 * 60 * 1000L; // cada 6 horas

    private WebView web;
    private boolean sinConexion = false;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private Updater updater;

    private static final long VOLVER_ONLINE_MS = 60_000;
    private boolean usandoCache = false;

    private final Runnable reintentar = () -> {
        if (!sinConexion) return;
        if (hayInternet()) {
            usandoCache = false;
            web.getSettings().setCacheMode(WebSettings.LOAD_DEFAULT);
        }
        web.loadUrl(BuildConfig.KIOSK_URL);
    };
    // Mientras se usa la copia guardada, vuelve a la página en línea apenas haya internet
    private final Runnable volverAOnline = new Runnable() {
        @Override public void run() {
            if (!usandoCache) return;
            if (hayInternet()) {
                usandoCache = false;
                sinConexion = false;
                web.getSettings().setCacheMode(WebSettings.LOAD_DEFAULT);
                web.loadUrl(BuildConfig.KIOSK_URL);
            } else {
                handler.postDelayed(this, VOLVER_ONLINE_MS);
            }
        }
    };

    @SuppressWarnings("deprecation")
    private boolean hayInternet() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        NetworkInfo ni = cm != null ? cm.getActiveNetworkInfo() : null;
        return ni != null && ni.isConnected();
    }
    private final Runnable chequearApk = new Runnable() {
        @Override public void run() {
            updater.chequear();
            handler.postDelayed(this, CHEQUEO_APK_MS);
        }
    };

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0A0A0C"));
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setLongClickable(false);
        web.setOnLongClickListener(v -> true);
        web.setHapticFeedbackEnabled(false);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100); // ignora el tamaño de letra del sistema: el diseño ya se adapta a la pantalla
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setAllowFileAccess(false);
        // La página detecta este sufijo para ocultar el botón de pantalla completa
        s.setUserAgentString(s.getUserAgentString() + " HomePointKiosco/" + BuildConfig.VERSION_NAME);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                // El kiosco no navega fuera de su página
                Uri u = req.getUrl();
                Uri base = Uri.parse(BuildConfig.KIOSK_URL);
                return !(base.getHost().equals(u.getHost()) && u.getPath() != null && u.getPath().startsWith(base.getPath()));
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (!req.isForMainFrame()) return;
                if (!usandoCache) {
                    // Sin internet: primero intenta abrir la última versión guardada de la página
                    // (la página guarda el catálogo y sigue funcionando con esos precios).
                    usandoCache = true;
                    view.getSettings().setCacheMode(WebSettings.LOAD_CACHE_ELSE_NETWORK);
                    view.loadUrl(BuildConfig.KIOSK_URL);
                    handler.removeCallbacks(volverAOnline);
                    handler.postDelayed(volverAOnline, VOLVER_ONLINE_MS);
                } else {
                    mostrarSinConexion();
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (url != null && url.startsWith("http")) {
                    sinConexion = false;
                }
            }
        });

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(BuildConfig.KIOSK_URL);

        updater = new Updater(this);
        handler.postDelayed(chequearApk, 20_000);
    }

    private void mostrarSinConexion() {
        sinConexion = true;
        String html = "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
                + "<style>html,body{height:100%;margin:0;background:#0a0a0c;color:#f5f5f7;font-family:system-ui,Roboto,sans-serif}"
                + "body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;text-align:center;padding:24px}"
                + "h1{font-size:34px;letter-spacing:-.02em;margin:0}p{color:#a1a1aa;font-size:19px;margin:0;max-width:28ch;line-height:1.4}"
                + ".s{width:34px;height:34px;border-radius:50%;border:3px solid #1f1f26;border-top-color:#f5f5f7;animation:r .9s linear infinite}"
                + "@keyframes r{to{transform:rotate(360deg)}}</style></head><body>"
                + "<div class='s'></div><h1>Sin conexión</h1><p>Estamos intentando reconectar. Esta pantalla vuelve sola en unos segundos.</p>"
                + "</body></html>";
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
        handler.removeCallbacks(reintentar);
        handler.postDelayed(reintentar, REINTENTO_MS);
    }

    @Override
    protected void onResume() {
        super.onResume();
        pantallaCompleta();
        web.onResume();
        updater.alVolver();
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) pantallaCompleta();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        // Modo kiosco: el botón Atrás no cierra la app
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        web.destroy();
        super.onDestroy();
    }

    @SuppressWarnings("deprecation")
    private void pantallaCompleta() {
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            w.setDecorFitsSystemWindows(false);
            WindowInsetsController c = w.getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            w.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_FULLSCREEN);
        }
    }
}
