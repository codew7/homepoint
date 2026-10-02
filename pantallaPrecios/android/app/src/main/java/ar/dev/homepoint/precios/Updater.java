package ar.dev.homepoint.precios;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Actualización automática del APK.
 * Lee app/version.json en el sitio; si trae un versionCode mayor al instalado, descarga el APK
 * y lo instala con PackageInstaller. La primera vez Android pide permiso para "instalar apps
 * desconocidas" y confirmar; en Android 12+ las siguientes actualizaciones pueden ser silenciosas.
 */
class Updater {

    private static final String TAG = "Updater";
    private final Activity act;
    private volatile boolean trabajando = false;
    private File apkPendiente = null; // descargado, esperando el permiso de instalación

    Updater(Activity act) { this.act = act; }

    void chequear() {
        if (trabajando) return;
        trabajando = true;
        new Thread(() -> {
            try {
                JSONObject v = new JSONObject(descargarTexto(BuildConfig.VERSION_URL + "?t=" + System.currentTimeMillis()));
                int remoto = v.getInt("versionCode");
                if (remoto <= BuildConfig.VERSION_CODE) return;
                String apkUrl = v.getString("apk");
                File apk = new File(act.getCacheDir(), "actualizacion-" + remoto + ".apk");
                File[] viejos = act.getCacheDir().listFiles((d, n) -> n.startsWith("actualizacion-"));
                if (viejos != null) for (File f : viejos) if (!f.equals(apk)) f.delete();
                if (!apk.exists()) descargarArchivo(apkUrl, apk);
                act.runOnUiThread(() -> instalar(apk));
            } catch (Exception e) {
                Log.w(TAG, "No se pudo buscar actualización: " + e);
            } finally {
                trabajando = false;
            }
        }).start();
    }

    /** Al volver a la app (por ejemplo, desde la pantalla de permisos) reintenta la instalación pendiente. */
    void alVolver() {
        if (apkPendiente != null && puedeInstalar()) {
            File f = apkPendiente;
            apkPendiente = null;
            instalar(f);
        }
    }

    private boolean puedeInstalar() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O
                || act.getPackageManager().canRequestPackageInstalls();
    }

    private void instalar(File apk) {
        if (!puedeInstalar()) {
            apkPendiente = apk;
            Toast.makeText(act, "Hay una actualización. Permití que esta app instale actualizaciones.", Toast.LENGTH_LONG).show();
            act.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + act.getPackageName())));
            return;
        }
        new Thread(() -> {
            try {
                PackageInstaller pi = act.getPackageManager().getPackageInstaller();
                PackageInstaller.SessionParams params =
                        new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                params.setAppPackageName(act.getPackageName());
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
                }
                int id = pi.createSession(params);
                try (PackageInstaller.Session session = pi.openSession(id)) {
                    try (InputStream in = new FileInputStream(apk);
                         OutputStream out = session.openWrite("base.apk", 0, apk.length())) {
                        copiar(in, out);
                        session.fsync(out);
                    }
                    Intent i = new Intent(act, InstallReceiver.class);
                    int flags = PendingIntent.FLAG_UPDATE_CURRENT
                            | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0);
                    PendingIntent pend = PendingIntent.getBroadcast(act, id, i, flags);
                    session.commit(pend.getIntentSender());
                }
            } catch (Exception e) {
                Log.w(TAG, "Falló la instalación: " + e);
            }
        }).start();
    }

    private static String descargarTexto(String url) throws Exception {
        HttpURLConnection c = abrir(url);
        try (InputStream in = c.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            copiar(in, out);
            return out.toString("UTF-8");
        } finally {
            c.disconnect();
        }
    }

    private static void descargarArchivo(String url, File destino) throws Exception {
        File tmp = new File(destino.getPath() + ".part");
        HttpURLConnection c = abrir(url);
        try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(tmp)) {
            copiar(in, out);
        } finally {
            c.disconnect();
        }
        if (!tmp.renameTo(destino)) throw new Exception("No se pudo guardar el APK");
    }

    private static HttpURLConnection abrir(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(60000);
        c.setUseCaches(false);
        c.setInstanceFollowRedirects(true);
        if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode() + " en " + url);
        return c;
    }

    private static void copiar(InputStream in, OutputStream out) throws Exception {
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
    }
}
