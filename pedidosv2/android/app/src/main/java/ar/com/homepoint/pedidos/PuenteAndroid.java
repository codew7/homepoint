package ar.com.homepoint.pedidos;

import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Lo que la pagina puede pedirle a Android. Se expone en JavaScript como
 * window.AppPedidos y lo usa el shim assets/puente.js.
 *
 * Los archivos (PDF de facturas y rotulos) llegan en pedazos de base64: mandar
 * un PDF entero en una sola llamada al puente revienta el limite de transaccion
 * del WebView y la llamada se pierde sin dar error.
 */
public class PuenteAndroid {

    /** Nombre con el que aparece el puente en JavaScript. */
    public static final String NOMBRE = "AppPedidos";

    /** Tope de seguridad por archivo (base64 incluido), para no quedarse sin memoria. */
    private static final int TOPE_BYTES = 24 * 1024 * 1024;

    private final MainActivity app;
    private final Map<String, StringBuilder> enArmado = new HashMap<>();

    PuenteAndroid(MainActivity app) {
        this.app = app;
    }

    // ------------------------------------------------------------ impresion

    @JavascriptInterface
    public void imprimirHtml(String html, String titulo) {
        if (html == null) return;
        app.imprimirHtml(html, titulo);
    }

    @JavascriptInterface
    public void imprimirPantalla(String titulo) {
        app.imprimirPantalla(titulo);
    }

    // ------------------------------------------------------------ archivos

    @JavascriptInterface
    public void agregarTrozo(String id, String base64) {
        if (id == null || base64 == null) return;
        synchronized (enArmado) {
            StringBuilder sb = enArmado.get(id);
            if (sb == null) {
                sb = new StringBuilder();
                enArmado.put(id, sb);
            }
            if (sb.length() + base64.length() > TOPE_BYTES) {
                enArmado.remove(id);
                aviso("El archivo es demasiado grande");
                return;
            }
            sb.append(base64);
        }
    }

    /** accion: "guardar" deja el archivo en Descargas; "compartir" abre el menu de compartir. */
    @JavascriptInterface
    public void terminarArchivo(String id, String nombre, String mime, String accion) {
        StringBuilder sb;
        synchronized (enArmado) {
            sb = enArmado.remove(id);
        }
        if (sb == null) {
            aviso(app.getString(R.string.guardado_error));
            return;
        }
        byte[] datos;
        try {
            datos = Base64.decode(sb.toString(), Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            aviso(app.getString(R.string.guardado_error));
            return;
        }
        String nombreFinal = limpiarNombre(nombre);
        String tipo = (mime == null || mime.isEmpty()) ? "application/octet-stream" : mime;
        if ("compartir".equals(accion)) {
            compartir(datos, nombreFinal, tipo);
        } else {
            guardarEnDescargas(datos, nombreFinal, tipo);
        }
    }

    private void guardarEnDescargas(byte[] datos, String nombre, String mime) {
        try {
            Uri destino;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // Android 10+: la carpeta Descargas se escribe por MediaStore y
                // no hace falta ningun permiso.
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.DISPLAY_NAME, nombre);
                v.put(MediaStore.Downloads.MIME_TYPE, mime);
                v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                destino = app.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (destino == null) throw new IllegalStateException("sin destino");
                try (OutputStream out = app.getContentResolver().openOutputStream(destino)) {
                    if (out == null) throw new IllegalStateException("sin stream");
                    out.write(datos);
                }
            } else {
                // Android 7 a 9: se guarda en la carpeta propia de la app, que
                // tampoco pide permisos, y se abre en el acto con el visor.
                File carpeta = app.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                File archivo = new File(carpeta, nombre);
                try (FileOutputStream out = new FileOutputStream(archivo)) {
                    out.write(datos);
                }
                destino = FileProvider.getUriForFile(app, app.getPackageName() + ".fileprovider", archivo);
            }
            aviso(app.getString(R.string.guardado_ok, nombre));
            abrirArchivo(destino, mime);
        } catch (Exception e) {
            aviso(app.getString(R.string.guardado_error));
        }
    }

    private void compartir(byte[] datos, String nombre, String mime) {
        try {
            File carpeta = new File(app.getCacheDir(), "compartidos");
            if (!carpeta.exists() && !carpeta.mkdirs()) throw new IllegalStateException("sin carpeta");
            File archivo = new File(carpeta, nombre);
            try (FileOutputStream out = new FileOutputStream(archivo)) {
                out.write(datos);
            }
            Uri uri = FileProvider.getUriForFile(app, app.getPackageName() + ".fileprovider", archivo);
            final Intent enviar = new Intent(Intent.ACTION_SEND);
            enviar.setType(mime);
            enviar.putExtra(Intent.EXTRA_STREAM, uri);
            enviar.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            // El puente corre en su propio hilo; abrir pantallas es cosa del hilo principal.
            app.runOnUiThread(() ->
                    app.startActivity(Intent.createChooser(enviar, app.getString(R.string.compartir_titulo))));
        } catch (Exception e) {
            aviso(app.getString(R.string.guardado_error));
        }
    }

    private void abrirArchivo(final Uri uri, final String mime) {
        app.runOnUiThread(() -> {
            try {
                Intent ver = new Intent(Intent.ACTION_VIEW);
                ver.setDataAndType(uri, mime);
                ver.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                app.startActivity(ver);
            } catch (Exception e) {
                // Sin visor instalado el archivo igual quedo guardado: no es un error.
            }
        });
    }

    // ------------------------------------------------------------ varios

    @JavascriptInterface
    public void copiar(String texto) {
        if (texto == null) return;
        android.content.ClipboardManager cb =
                (android.content.ClipboardManager) app.getSystemService(Context.CLIPBOARD_SERVICE);
        if (cb == null) return;
        cb.setPrimaryClip(android.content.ClipData.newPlainText("Pedidos", texto));
    }

    @JavascriptInterface
    public void abrirExterno(String url) {
        if (url == null || url.isEmpty()) return;
        app.runOnUiThread(() -> app.abrirAfuera(Uri.parse(url)));
    }

    @JavascriptInterface
    public void aviso(String mensaje) {
        if (mensaje == null) return;
        app.runOnUiThread(() -> Toast.makeText(app, mensaje, Toast.LENGTH_SHORT).show());
    }

    /** Nombre de archivo sin separadores ni caracteres que rompan el sistema de archivos. */
    private String limpiarNombre(String nombre) {
        if (nombre == null || nombre.trim().isEmpty()) return "documento.pdf";
        String limpio = nombre.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
        return limpio.isEmpty() ? "documento.pdf" : limpio;
    }
}
