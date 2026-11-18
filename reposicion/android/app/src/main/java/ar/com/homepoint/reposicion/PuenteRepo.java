package ar.com.homepoint.reposicion;

import android.webkit.JavascriptInterface;

/**
 * Lo que la pagina puede pedirle a Android. En JavaScript aparece como
 * window.AppRepo y lo usa reposicion/index.html cuando corre adentro de la app.
 */
public class PuenteRepo {

    /** Nombre con el que aparece el puente en JavaScript. */
    public static final String NOMBRE = "AppRepo";

    private final MainActivity app;

    PuenteRepo(MainActivity app) {
        this.app = app;
    }

    /** Version del APK instalado (versionCode). */
    @JavascriptInterface
    public int version() {
        return BuildConfig.VERSION_CODE;
    }

    /** Imprime bytes TSPL en base64 por Bluetooth; responde en window.__repoImpreso(id, ok, mensaje). */
    @JavascriptInterface
    public void imprimirTspl(String id, String base64) {
        if (id == null || base64 == null) return;
        app.imprimirTspl(id, base64);
    }

    /** Abre la lista de impresoras emparejadas para elegir o cambiar la guardada. */
    @JavascriptInterface
    public void elegirImpresora() {
        app.elegirImpresora();
    }

    /** Recarga la pagina (cuando hay una version nueva publicada). */
    @JavascriptInterface
    public void recargar() {
        app.recargarPagina();
    }
}
