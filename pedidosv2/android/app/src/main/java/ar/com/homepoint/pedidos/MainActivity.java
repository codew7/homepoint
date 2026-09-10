package ar.com.homepoint.pedidos;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
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
 * Contenedor Android de la app web de pedidos.
 *
 * La pagina no vive adentro del APK: se carga desde el sitio publicado, asi que
 * cada cambio que se sube al repositorio llega a los telefonos sin reinstalar
 * nada. El service worker de la propia pagina sigue haciendo su cache, que es
 * lo que sostiene el arranque cuando la red esta lenta.
 *
 * Lo unico que agrega esta clase es lo que un WebView pelado no sabe hacer y la
 * pagina si necesita: imprimir, guardar y compartir PDF, y pedir la camara.
 */
public class MainActivity extends AppCompatActivity {

    /** Pagina que se abre al iniciar. */
    private static final String URL_APP = "https://homepoint-admin.dev.ar/pedidosv2/pedidosv2.html";
    /** Lo de este dominio se abre adentro; el resto va a la app que corresponda. */
    private static final String HOST_APP = "homepoint-admin.dev.ar";

    private WebView web;
    private View panelCarga;
    private View panelError;

    private PermissionRequest permisoWebPendiente;
    private boolean falloLaCarga;
    private boolean webMuerto;
    private long ultimoBack;

    private final Handler hilo = new Handler(Looper.getMainLooper());
    private ActivityResultLauncher<String> pedirCamara;

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

        configurarWebView();

        // Al volver de segundo plano Android puede haber matado la app: si no
        // quedo estado que restaurar, se abre la pagina de cero.
        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) {
            web.loadUrl(URL_APP);
        }

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (web.canGoBack()) {
                    web.goBack();
                    return;
                }
                // Dos toques para salir: en una app de mostrador, un back de mas
                // cerrando la app en medio de un pedido es peor que la molestia.
                long ahora = System.currentTimeMillis();
                if (ahora - ultimoBack < 2000) {
                    finish();
                } else {
                    ultimoBack = ahora;
                    Toast.makeText(MainActivity.this, R.string.salir, Toast.LENGTH_SHORT).show();
                }
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
        // El lector de QR arranca la camara sin que haya un click justo antes.
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        // Con multiples ventanas apagadas, window.open() navega en este mismo
        // WebView y cae en shouldOverrideUrlLoading, que lo manda a WhatsApp.
        s.setSupportMultipleWindows(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setUserAgentString(s.getUserAgentString() + " PedidosHomePointApp");

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        web.setBackgroundColor(ContextCompat.getColor(this, R.color.fondo_app));
        web.addJavascriptInterface(new PuenteAndroid(this), PuenteAndroid.NOMBRE);

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
                // Solo importa el documento principal: que falle una imagen de
                // producto no es motivo para tapar la app con la pantalla de error.
                if (req.isForMainFrame()) mostrarError();
            }

            @Override
            public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail detalle) {
                // Si el motor web se cae (memoria, sobre todo en tablets viejas)
                // hay que soltar el WebView muerto o la app se cierra sola.
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

        // Descargas normales (http/https). Los PDF que genera la pagina no pasan
        // por aca: son blob: y los resuelve el puente.
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
        // WhatsApp, telefono, mail, mapas: afuera.
        abrirAfuera(url);
        return true;
    }

    void abrirAfuera(Uri url) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, url);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No hay ninguna app para abrir esto", Toast.LENGTH_SHORT).show();
        }
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

    /**
     * Inyecta el shim que conecta la pagina con Android. Va despues de que
     * cargo la pagina a proposito: reemplaza funciones que define el propio
     * pedidosv2.html, asi que tienen que existir antes.
     */
    private void inyectarPuente(WebView v) {
        String js = leerAsset("puente.js");
        if (js != null) v.evaluateJavascript(js, null);
    }

    private String leerAsset(String nombre) {
        try (BufferedReader r = new BufferedReader(
                new InputStreamReader(getAssets().open(nombre), StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            String linea;
            while ((linea = r.readLine()) != null) sb.append(linea).append('\n');
            return sb.toString();
        } catch (Exception e) {
            return null;
        }
    }

    // ---------------------------------------------------------------- impresion

    /**
     * Imprime un documento HTML suelto (rotulos, facturas, recibos).
     *
     * La pagina los arma en memoria y los manda a un iframe con
     * window.onload -> window.print(). En un WebView window.print no existe, asi
     * que el HTML se carga en un WebView aparte y se le agrega al final un
     * window.print propio que avisa a Android. Se dispara en el load, o sea con
     * las imagenes (el QR del rotulo) ya descargadas.
     */
    void imprimirHtml(final String html, final String titulo) {
        runOnUiThread(() -> {
            final WebView oculto = new WebView(this);
            oculto.getSettings().setJavaScriptEnabled(true);
            oculto.getSettings().setLoadWithOverviewMode(true);
            final boolean[] yaImprimio = {false};

            final Runnable imprimir = () -> {
                if (yaImprimio[0]) return;
                yaImprimio[0] = true;
                lanzarDialogoImpresion(oculto, titulo);
            };

            oculto.addJavascriptInterface(new Object() {
                @JavascriptInterface
                public void listo() {
                    hilo.post(imprimir);
                }
            }, "AppImpresion");

            oculto.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageFinished(WebView v, String url) {
                    // Red de seguridad: si el window.print del documento no
                    // llega a correr, el dialogo sale igual unos segundos despues.
                    hilo.postDelayed(imprimir, 4000);
                }
            });

            String conShim = html
                    + "\n<script>window.print=function(){try{AppImpresion.listo();}catch(e){}};</script>";
            oculto.loadDataWithBaseURL("https://" + HOST_APP + "/pedidosv2/", conShim, "text/html", "UTF-8", null);
        });
    }

    /** Imprime lo que se ve en pantalla. */
    void imprimirPantalla(final String titulo) {
        runOnUiThread(() -> lanzarDialogoImpresion(web, titulo));
    }

    private void lanzarDialogoImpresion(WebView origen, String titulo) {
        PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
        if (pm == null) return;
        String nombre = (titulo == null || titulo.isEmpty()) ? getString(R.string.app_name) : titulo;
        PrintDocumentAdapter adaptador = origen.createPrintDocumentAdapter(nombre);
        pm.print(nombre, adaptador, new PrintAttributes.Builder().build());
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
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        hilo.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
