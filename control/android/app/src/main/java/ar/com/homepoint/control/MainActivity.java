package ar.com.homepoint.control;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

/**
 * App "Control": solo Buscar articulo y Control de pedido.
 *
 * La pagina (control/control.html) se abre DESDE EL SITIO, asi que cualquier
 * cambio en ella llega solo, sin reinstalar el APK. Lo unico que agrega Android
 * es el lector incorporado de los colectores (LectorColector) y el permiso de
 * camara para los celulares comunes.
 */
public class MainActivity extends AppCompatActivity {

    private static final String URL_APP = "https://home-point-admin.dev.ar/control/control.html";
    private static final String HOST_APP = "home-point-admin.dev.ar";

    private WebView web;
    private View panelCarga;
    private View panelError;

    private PermissionRequest permisoWebPendiente;
    private boolean falloLaCarga;
    private boolean webMuerto;
    private long ultimoBack;

    private ActivityResultLauncher<String> pedirCamara;
    private LectorColector lector;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        web = findViewById(R.id.web);
        panelCarga = findViewById(R.id.panelCarga);
        panelError = findViewById(R.id.panelError);
        findViewById(R.id.botonReintentar).setOnClickListener(v -> recargar());

        pedirCamara = registerForActivityResult(new ActivityResultContracts.RequestPermission(), concedido -> {
            if (permisoWebPendiente == null) return;
            if (concedido) {
                permisoWebPendiente.grant(permisoWebPendiente.getResources());
            } else {
                permisoWebPendiente.deny();
                Toast.makeText(this, R.string.permiso_camara, Toast.LENGTH_LONG).show();
            }
            permisoWebPendiente = null;
        });

        lector = new LectorColector(this, this::entregarLectura);
        lector.configurar();

        configurarWebView();

        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) {
            web.loadUrl(URL_APP);
        }

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webMuerto || falloLaCarga) { finish(); return; }
                // Primero la pagina: si tiene una pantalla abierta, vuelve atras ella.
                web.evaluateJavascript("window.__volverControl ? window.__volverControl() : false", r -> {
                    if ("true".equals(r)) return;
                    long ahora = System.currentTimeMillis();
                    if (ahora - ultimoBack < 2000) {
                        finish();
                    } else {
                        ultimoBack = ahora;
                        Toast.makeText(MainActivity.this, R.string.salir, Toast.LENGTH_SHORT).show();
                    }
                });
            }
        });
    }

    private void configurarWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportMultipleWindows(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        // Avisa a la pagina, desde el primer script, que corre dentro de la app.
        s.setUserAgentString(s.getUserAgentString() + " ControlHomePointApp");

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        web.setBackgroundColor(ContextCompat.getColor(this, R.color.fondo_app));
        web.addJavascriptInterface(new Puente(), "AppControl");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                return manejarNavegacion(req.getUrl());
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                inyectarPuente(v);
                if (!falloLaCarga) mostrarWeb();
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) mostrarError();
            }

            @Override
            public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail detalle) {
                webMuerto = true;
                if (v.getParent() instanceof android.view.ViewGroup) {
                    ((android.view.ViewGroup) v.getParent()).removeView(v);
                }
                v.destroy();
                recreate();
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> resolverPermisoWeb(request));
            }

            @Override
            public void onProgressChanged(WebView v, int progreso) {
                if (progreso >= 100 && !falloLaCarga) mostrarWeb();
            }
        });
    }

    // ---------------------------------------------------------------- navegacion

    private boolean manejarNavegacion(Uri url) {
        String host = url.getHost();
        String esquema = url.getScheme();
        if (host != null && host.equalsIgnoreCase(HOST_APP)) return false;
        if ("about".equals(esquema) || "javascript".equals(esquema)) return false;
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, url);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No hay ninguna app para abrir esto", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    private void recargar() {
        falloLaCarga = false;
        panelError.setVisibility(View.GONE);
        panelCarga.setVisibility(View.VISIBLE);
        web.setVisibility(View.INVISIBLE);
        web.loadUrl(URL_APP);
    }

    private void mostrarWeb() {
        panelCarga.setVisibility(View.GONE);
        panelError.setVisibility(View.GONE);
        web.setVisibility(View.VISIBLE);
    }

    private void mostrarError() {
        falloLaCarga = true;
        panelCarga.setVisibility(View.GONE);
        web.setVisibility(View.INVISIBLE);
        panelError.setVisibility(View.VISIBLE);
    }

    // ---------------------------------------------------------------- lector

    private void entregarLectura(String texto, String tipo) {
        if (web == null || webMuerto) return;
        String js = "window.__lecturaColector && window.__lecturaColector("
                + jsonString(texto) + "," + jsonString(tipo) + ")";
        web.evaluateJavascript(js, null);
    }

    /** Lo que la pagina puede pedirle a Android (window.AppControl). */
    private class Puente {
        /** Gatillo por software. False si el equipo no lo permite. */
        @JavascriptInterface
        public boolean dispararLector() {
            if (!lector.puedeDisparar()) return false;
            runOnUiThread(() -> lector.disparar());
            return true;
        }

        /** True en equipos Zebra (DataWedge), donde el gatillo por software anda. */
        @JavascriptInterface
        public boolean tieneLector() {
            return lector.puedeDisparar();
        }
    }

    // ---------------------------------------------------------------- camara

    private void resolverPermisoWeb(PermissionRequest request) {
        boolean quiereCamara = false;
        for (String r : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) quiereCamara = true;
        }
        if (!quiereCamara) {
            request.deny();
            return;
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            return;
        }
        permisoWebPendiente = request;
        pedirCamara.launch(Manifest.permission.CAMERA);
    }

    // ---------------------------------------------------------------- puente JS

    private void inyectarPuente(WebView v) {
        try (BufferedReader r = new BufferedReader(
                new InputStreamReader(getAssets().open("puente.js"), StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            String linea;
            while ((linea = r.readLine()) != null) sb.append(linea).append('\n');
            v.evaluateJavascript(sb.toString(), null);
        } catch (Exception ignorado) {
            // Sin puente la pagina sigue andando con la camara.
        }
    }

    private String jsonString(String s) {
        if (s == null) return "null";
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\n", "\\n").replace("\r", "") + "\"";
    }

    // ---------------------------------------------------------------- ciclo de vida

    @Override
    protected void onSaveInstanceState(@NonNull Bundle out) {
        super.onSaveInstanceState(out);
        if (!webMuerto) web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        lector.dejarDeEscuchar();
        if (!webMuerto) web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (!webMuerto) web.onResume();
        lector.escuchar();
    }
}
