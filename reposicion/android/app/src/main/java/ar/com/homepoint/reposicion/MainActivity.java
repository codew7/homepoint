package ar.com.homepoint.reposicion;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
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

/**
 * App Android de Reposicion del showroom.
 *
 * La pagina no vive adentro del APK: se carga desde el sitio publicado, asi que
 * cada cambio que se sube al repositorio llega a los telefonos sin reinstalar
 * nada (la propia pagina avisa "Hay una version nueva" si estaba abierta).
 *
 * Lo que agrega esta clase es lo que un WebView solo no sabe hacer:
 *  - imprimir etiquetas directo por Bluetooth clasico (ImpresoraBluetooth),
 *    que funciona aunque la impresora no tenga Bluetooth de bajo consumo;
 *  - pedir el permiso de camara para escanear;
 *  - dejar la pantalla siempre encendida, para no perderse los avisos;
 *  - dar el foco al WebView para que la pistola lectora escriba ahi.
 * Los cambios en esta carpeta si requieren un APK nuevo: de eso se encarga
 * ActualizadorApp, que lo baja de GitHub y lo instala encima.
 */
public class MainActivity extends AppCompatActivity {

    /** Pagina que se abre al iniciar. */
    private static final String URL_APP = "https://home-point-admin.dev.ar/reposicion/";
    /** Lo de este dominio se abre adentro; el resto va a la app que corresponda. */
    private static final String HOST_APP = "home-point-admin.dev.ar";
    /** Cada cuanto se busca un APK nuevo mientras la app queda abierta todo el dia. */
    private static final long CHEQUEO_PERIODICO_MS = 15L * 60 * 1000;

    private WebView web;
    private View panelCarga;
    private View panelError;

    private PermissionRequest permisoWebPendiente;
    private boolean falloLaCarga;
    private boolean webMuerto;
    private long ultimoBack;

    private final Handler hilo = new Handler(Looper.getMainLooper());
    private ActivityResultLauncher<String> pedirCamara;
    private ImpresoraBluetooth impresoraBt;
    private ActualizadorApp actualizador;

    private final Runnable chequeoPeriodico = new Runnable() {
        @Override
        public void run() {
            actualizador.chequear();
            hilo.postDelayed(this, CHEQUEO_PERIODICO_MS);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        // Depósito y salón se avisan entre sí: la pantalla no se apaga sola.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = findViewById(R.id.web);
        panelCarga = findViewById(R.id.panelCarga);
        panelError = findViewById(R.id.panelError);
        findViewById(R.id.botonReintentar).setOnClickListener(v -> recargar());

        pedirCamara = registerForActivityResult(new ActivityResultContracts.RequestPermission(), concedido -> {
            if (permisoWebPendiente == null) return;
            if (concedido) {
                permisoWebPendiente.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            } else {
                permisoWebPendiente.deny();
                Toast.makeText(this, R.string.permiso_camara, Toast.LENGTH_LONG).show();
            }
            permisoWebPendiente = null;
        });

        impresoraBt = new ImpresoraBluetooth(this);
        actualizador = new ActualizadorApp(this);

        configurarWebView();

        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) {
            web.loadUrl(URL_APP);
        }

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                // Primero se le da la chance a la pagina de cerrar una hoja abierta.
                web.evaluateJavascript("window.__repoAtras ? window.__repoAtras() : false", valor -> {
                    if ("true".equals(valor)) return;
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
        // Los avisos con sonido y la camara arrancan sin un toque justo antes.
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportMultipleWindows(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setUserAgentString(s.getUserAgentString() + " ReposicionHomePointApp/" + BuildConfig.VERSION_CODE);

        CookieManager.getInstance().setAcceptCookie(true);

        web.setBackgroundColor(ContextCompat.getColor(this, R.color.fondo_app));
        web.addJavascriptInterface(new PuenteRepo(this), PuenteRepo.NOMBRE);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                return manejarNavegacion(req.getUrl());
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                if (!falloLaCarga) mostrarWeb();
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
                // Solo importa la pagina: que falle una foto no tapa la app.
                if (req.isForMainFrame()) mostrarError();
            }

            @Override
            public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail detalle) {
                // Si el motor web se cae (falta de memoria) se suelta y se rearma.
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

        web.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> {
            if (url.startsWith("blob:") || url.startsWith("data:")) return;
            abrirAfuera(Uri.parse(url));
        });
    }

    // ---------------------------------------------------------------- navegacion

    private boolean manejarNavegacion(Uri url) {
        String host = url.getHost();
        String esquema = url.getScheme();
        if (host != null && host.equalsIgnoreCase(HOST_APP)) return false;
        if ("about".equals(esquema) || "javascript".equals(esquema)) return false;
        abrirAfuera(url);
        return true;
    }

    void abrirAfuera(Uri url) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, url);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, R.string.sin_app, Toast.LENGTH_SHORT).show();
        }
    }

    /** La pagina pide recargarse (aviso de version nueva). */
    void recargarPagina() {
        runOnUiThread(() -> web.reload());
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
        if (web.getVisibility() != View.VISIBLE) {
            web.setVisibility(View.VISIBLE);
            // Con el foco en el WebView, la pistola lectora escribe en la pagina.
            web.requestFocus();
        }
    }

    private void mostrarError() {
        falloLaCarga = true;
        panelCarga.setVisibility(View.GONE);
        web.setVisibility(View.INVISIBLE);
        panelError.setVisibility(View.VISIBLE);
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

    // ---------------------------------------------------------------- impresion

    /**
     * Imprime los bytes TSPL que arma la pagina (la etiqueta como imagen)
     * directo por Bluetooth. La respuesta vuelve a la pagina resolviendo la
     * promesa que quedo pendiente con ese mismo id.
     */
    void imprimirTspl(String id, String base64) {
        byte[] datos;
        try {
            datos = ImpresoraBluetooth.decodificar(base64);
        } catch (Exception e) {
            responderImpresion(id, false, "Datos inválidos");
            return;
        }
        if (datos.length == 0) {
            responderImpresion(id, false, "Nada para imprimir");
            return;
        }
        runOnUiThread(() -> impresoraBt.imprimir(datos, (ok, mensaje) -> responderImpresion(id, ok, mensaje)));
    }

    void elegirImpresora() {
        runOnUiThread(() -> impresoraBt.elegirImpresora());
    }

    private void responderImpresion(String id, boolean ok, String mensaje) {
        String js = "window.__repoImpreso && window.__repoImpreso(" + jsonString(id) + "," + ok + "," + jsonString(mensaje) + ")";
        runOnUiThread(() -> web.evaluateJavascript(js, null));
    }

    private static String jsonString(String s) {
        if (s == null) return "null";
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "") + "\"";
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
        hilo.removeCallbacks(chequeoPeriodico);
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        actualizador.alVolver();
        hilo.removeCallbacks(chequeoPeriodico);
        hilo.postDelayed(chequeoPeriodico, CHEQUEO_PERIODICO_MS);
    }

    @Override
    protected void onDestroy() {
        hilo.removeCallbacksAndMessages(null);
        actualizador.cerrar();
        super.onDestroy();
    }
}
