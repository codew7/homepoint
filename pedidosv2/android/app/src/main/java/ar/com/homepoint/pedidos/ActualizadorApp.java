package ar.com.homepoint.pedidos;

import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.widget.Toast;

import androidx.appcompat.app.AlertDialog;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.content.pm.PackageInfoCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Actualizacion de la app desde GitHub Releases.
 *
 * El workflow "APK Pedidos" publica cada APK como release con el numero de
 * run como versionCode (PedidosHomePoint-15.apk, tag pedidos-v1.0.15). Aca se
 * consulta el ultimo release, y si trae un numero mayor al instalado se ofrece
 * bajarlo e instalarlo encima. Android no permite instalar en silencio fuera
 * de Play Store: el usuario siempre ve el dialogo del sistema y toca Instalar,
 * pero no tiene que buscar el APK ni desinstalar nada.
 *
 * Solo funciona con la variante firmada: una compilacion debug cambia de firma
 * en cada build y no se puede instalar encima, por eso en debug no se chequea.
 */
class ActualizadorApp {

    private static final String URL_ULTIMO_RELEASE =
            "https://api.github.com/repos/codew7/homepoint/releases/latest";
    private static final String MIME_APK = "application/vnd.android.package-archive";

    private static final String PREFS = "actualizador";
    private static final String PREF_ULTIMO_CHEQUEO = "ultimoChequeo";
    private static final String PREF_POSPUESTA_HASTA = "pospuestaHasta";
    private static final long ENTRE_CHEQUEOS_MS = 60L * 60 * 1000;
    private static final long POSPONER_MS = 24L * 60 * 60 * 1000;

    private static final Pattern NUMERO_EN_APK = Pattern.compile("-(\\d+)\\.apk$");
    private static final Pattern ULTIMO_NUMERO = Pattern.compile("(\\d+)$");

    private static class Version {
        long codigo;
        String nombre;
        String url;
    }

    private final MainActivity actividad;
    private final SharedPreferences prefs;
    private final ExecutorService fondo = Executors.newSingleThreadExecutor();
    private final boolean esDebug;

    private long descargaId = -1;
    private File apkDescargado;
    private boolean esperandoPermisoInstalar;
    private BroadcastReceiver receptorDescarga;

    ActualizadorApp(MainActivity actividad) {
        this.actividad = actividad;
        this.prefs = actividad.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        this.esDebug = (actividad.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    // ---------------------------------------------------------------- ciclo de vida

    /** Llamar desde onResume: retoma una instalacion pendiente y chequea si toca. */
    void alVolver() {
        if (esperandoPermisoInstalar) {
            esperandoPermisoInstalar = false;
            // Si volvio sin conceder el permiso no se lo manda de nuevo a
            // Ajustes (seria un bucle): se vuelve a ofrecer en el proximo chequeo.
            if (puedeInstalar()) instalar();
            return;
        }
        chequear();
    }

    void cerrar() {
        desregistrarReceptor();
        fondo.shutdownNow();
    }

    // ---------------------------------------------------------------- chequeo

    private void chequear() {
        if (esDebug) return;
        long ahora = System.currentTimeMillis();
        if (ahora < prefs.getLong(PREF_POSPUESTA_HASTA, 0)) return;
        if (ahora - prefs.getLong(PREF_ULTIMO_CHEQUEO, 0) < ENTRE_CHEQUEOS_MS) return;
        prefs.edit().putLong(PREF_ULTIMO_CHEQUEO, ahora).apply();

        final long instalada = versionInstalada();
        fondo.execute(() -> {
            try {
                Version v = consultarUltimoRelease();
                if (v != null && v.codigo > instalada) {
                    actividad.runOnUiThread(() -> ofrecer(v));
                }
            } catch (Exception e) {
                // Sin red o GitHub caido: se vuelve a intentar en el proximo chequeo.
            }
        });
    }

    private long versionInstalada() {
        try {
            PackageInfo pi = actividad.getPackageManager().getPackageInfo(actividad.getPackageName(), 0);
            return PackageInfoCompat.getLongVersionCode(pi);
        } catch (Exception e) {
            return Long.MAX_VALUE;
        }
    }

    private Version consultarUltimoRelease() throws Exception {
        HttpURLConnection con = (HttpURLConnection) new URL(URL_ULTIMO_RELEASE).openConnection();
        con.setConnectTimeout(10000);
        con.setReadTimeout(10000);
        con.setRequestProperty("Accept", "application/vnd.github+json");
        con.setRequestProperty("User-Agent", "PedidosHomePointApp");
        try {
            if (con.getResponseCode() != 200) return null;
            StringBuilder sb = new StringBuilder();
            try (BufferedReader r = new BufferedReader(
                    new InputStreamReader(con.getInputStream(), StandardCharsets.UTF_8))) {
                String linea;
                while ((linea = r.readLine()) != null) sb.append(linea);
            }
            JSONObject release = new JSONObject(sb.toString());
            JSONArray assets = release.optJSONArray("assets");
            if (assets == null) return null;

            for (int i = 0; i < assets.length(); i++) {
                JSONObject a = assets.getJSONObject(i);
                String nombre = a.optString("name", "");
                if (!nombre.endsWith(".apk")) continue;

                Version v = new Version();
                v.url = a.getString("browser_download_url");
                v.nombre = release.optString("tag_name", "").replaceFirst("^pedidos-v", "");
                v.codigo = extraerCodigo(nombre, release.optString("tag_name", ""));
                return v.codigo > 0 ? v : null;
            }
            return null;
        } finally {
            con.disconnect();
        }
    }

    /** El versionCode viene en el nombre del APK; el tag es el respaldo. */
    private static long extraerCodigo(String nombreApk, String tag) {
        Matcher m = NUMERO_EN_APK.matcher(nombreApk);
        if (m.find()) return Long.parseLong(m.group(1));
        m = ULTIMO_NUMERO.matcher(tag);
        if (m.find()) return Long.parseLong(m.group(1));
        return 0;
    }

    // ---------------------------------------------------------------- dialogo

    private void ofrecer(Version v) {
        if (actividad.isFinishing() || actividad.isDestroyed()) return;
        new AlertDialog.Builder(actividad)
                .setTitle(R.string.act_titulo)
                .setMessage(actividad.getString(R.string.act_detalle, v.nombre))
                .setPositiveButton(R.string.act_ahora, (d, w) -> descargar(v))
                .setNegativeButton(R.string.act_despues, (d, w) -> prefs.edit()
                        .putLong(PREF_POSPUESTA_HASTA, System.currentTimeMillis() + POSPONER_MS)
                        .apply())
                .show();
    }

    // ---------------------------------------------------------------- descarga

    private void descargar(Version v) {
        File carpeta = actividad.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        DownloadManager dm = (DownloadManager) actividad.getSystemService(Context.DOWNLOAD_SERVICE);
        if (carpeta == null || dm == null) {
            Toast.makeText(actividad, R.string.act_error_descarga, Toast.LENGTH_LONG).show();
            return;
        }

        // Los APK de actualizaciones anteriores ya no sirven para nada.
        File[] viejos = carpeta.listFiles((d, n) -> n.endsWith(".apk"));
        if (viejos != null) for (File f : viejos) f.delete();

        String nombreArchivo = "PedidosHomePoint-" + v.codigo + ".apk";
        apkDescargado = new File(carpeta, nombreArchivo);

        DownloadManager.Request req = new DownloadManager.Request(Uri.parse(v.url))
                .setTitle(actividad.getString(R.string.app_name) + " " + v.nombre)
                .setDescription(actividad.getString(R.string.act_descargando))
                .setMimeType(MIME_APK)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
                .setDestinationInExternalFilesDir(actividad, Environment.DIRECTORY_DOWNLOADS, nombreArchivo);

        registrarReceptor();
        descargaId = dm.enqueue(req);
        Toast.makeText(actividad, R.string.act_descargando, Toast.LENGTH_SHORT).show();
    }

    private void registrarReceptor() {
        if (receptorDescarga != null) return;
        receptorDescarga = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent i) {
                long id = i.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                if (id != descargaId) return;
                desregistrarReceptor();
                if (descargaExitosa(id)) {
                    instalar();
                } else {
                    apkDescargado = null;
                    Toast.makeText(actividad, R.string.act_error_descarga, Toast.LENGTH_LONG).show();
                }
            }
        };
        // Es un broadcast del sistema: el receptor tiene que ser exportado.
        ContextCompat.registerReceiver(actividad, receptorDescarga,
                new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
                ContextCompat.RECEIVER_EXPORTED);
    }

    private void desregistrarReceptor() {
        if (receptorDescarga == null) return;
        try {
            actividad.unregisterReceiver(receptorDescarga);
        } catch (IllegalArgumentException ignorada) {
        }
        receptorDescarga = null;
    }

    private boolean descargaExitosa(long id) {
        DownloadManager dm = (DownloadManager) actividad.getSystemService(Context.DOWNLOAD_SERVICE);
        if (dm == null) return false;
        try (Cursor c = dm.query(new DownloadManager.Query().setFilterById(id))) {
            if (c == null || !c.moveToFirst()) return false;
            int estado = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            return estado == DownloadManager.STATUS_SUCCESSFUL;
        } catch (Exception e) {
            return false;
        }
    }

    // ---------------------------------------------------------------- instalacion

    private boolean puedeInstalar() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O
                || actividad.getPackageManager().canRequestPackageInstalls();
    }

    private void instalar() {
        if (apkDescargado == null || !apkDescargado.exists()) return;

        // Desde Android 8 cada app necesita permiso propio para instalar APKs.
        // Se manda al ajuste puntual de esta app y al volver (onResume) se retoma.
        if (!puedeInstalar()) {
            Toast.makeText(actividad, R.string.act_permiso, Toast.LENGTH_LONG).show();
            try {
                esperandoPermisoInstalar = true;
                actividad.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + actividad.getPackageName())));
            } catch (ActivityNotFoundException e) {
                esperandoPermisoInstalar = false;
            }
            return;
        }

        Uri uri = FileProvider.getUriForFile(actividad,
                actividad.getPackageName() + ".fileprovider", apkDescargado);
        Intent i = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, MIME_APK)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            actividad.startActivity(i);
            apkDescargado = null;
        } catch (ActivityNotFoundException e) {
            Toast.makeText(actividad, R.string.act_error_descarga, Toast.LENGTH_LONG).show();
        }
    }
}
