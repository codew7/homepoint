package ar.com.homepoint.pedidos;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.SystemClock;

import androidx.core.content.ContextCompat;

import java.nio.charset.StandardCharsets;

/**
 * Lector de codigos incorporado del colector de datos.
 *
 * Pensado para el 3nStar NuStar 65 (Android 14, lector 2D generico de
 * MediaTek), pero sin atarse a una marca: cada fabricante manda las lecturas
 * con su propio "aviso" (broadcast), asi que se escuchan los de las familias
 * mas comunes y cualquiera llega a la pagina con window.__lecturaColector().
 *
 * En el equipo, la app de ajustes del lector ("Escaner", "Scanner",
 * "ScanWedge"...) tiene que tener la salida en modo "Broadcast"/"Transmision".
 * Si deja poner una accion propia, usar ACCION_PROPIA con el dato en "data".
 * Si queda en modo teclado igual funciona: la pagina lo toma como la pistola.
 *
 * Si el equipo es un Zebra, ademas arma solo el perfil de DataWedge.
 */
class LectorColector {

    interface Receptor {
        void alLeer(String texto, String tipo);
    }

    /**
     * Avisos conocidos: {accion, extra con el texto}. El extra es una pista: si
     * no viene, se usa el primer texto del aviso (ver textoDe).
     */
    private static final String[][] AVISOS = {
            {"com.android.server.scannerservice.broadcast", "scannerdata"},   // iData y lectores MTK genericos
            {"android.intent.ACTION_DECODE_DATA", "barcode_string"},          // Urovo y clones
            {"scan.rcv.message", "barocode"},                                  // varios genericos (llega en bytes)
            {"com.scanner.broadcast", "data"},                                 // Chainway y genericos
            {"android.intent.action.SCANRESULT", "value"},                     // Seuic / AutoID
            {"nlscan.action.SCANNER_RESULT", "SCAN_BARCODE1"},                 // Newland
            {"com.sunmi.scanner.ACTION_DATA_CODE_RECEIVED", "data"},           // Sunmi
            {"com.honeywell.decode.intent.action.EDIT_DATA", "data"},          // Honeywell
            {"android.intent.action.SCAN_RESULT", "barcode"},                  // otros genericos
    };

    /** La misma lectura repetida en menos de esto es un eco, no otra unidad. */
    private static final long REPETIDO_MS = 150;

    // DataWedge (Zebra)
    private static final String DW_PAQUETE = "com.symbol.datawedge";
    private static final String DW_PERFIL = "PedidosColector";
    private static final String DW_API = "com.symbol.datawedge.api.ACTION";
    private static final String DW = "com.symbol.datawedge.api.";
    private static final String DW_DATOS = "com.symbol.datawedge.data_string";
    private static final String DW_TIPO = "com.symbol.datawedge.label_type";

    private final Context ctx;
    private final Receptor receptor;
    private final String accionPropia;
    private final boolean hayDataWedge;
    private boolean escuchando;
    private String ultimoTexto = "";
    private long ultimaVez;

    private final BroadcastReceiver oyente = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent i) {
            String texto = textoDe(i);
            if (texto == null) return;
            // Saltos o tabs que el lector agrega como sufijo.
            texto = texto.replaceAll("[\\r\\n\\t\\u0000]+$", "").trim();
            if (texto.isEmpty()) return;
            // Hay equipos que mandan la misma lectura por dos avisos a la vez.
            long ahora = SystemClock.elapsedRealtime();
            if (texto.equals(ultimoTexto) && ahora - ultimaVez < REPETIDO_MS) return;
            ultimoTexto = texto;
            ultimaVez = ahora;
            String tipo = i.getStringExtra(DW_TIPO);
            receptor.alLeer(texto, tipo == null ? "" : tipo.replace("LABEL-TYPE-", ""));
        }
    };

    LectorColector(Context ctx, Receptor receptor) {
        this.ctx = ctx;
        this.receptor = receptor;
        this.accionPropia = ctx.getPackageName() + ".LECTURA";
        this.hayDataWedge = instalado(DW_PAQUETE);
    }

    /** Accion para poner en la app del lector si permite elegir una. */
    String accionPropia() {
        return accionPropia;
    }

    /** True si hay gatillo por software (hoy, solo con DataWedge). */
    boolean puedeDisparar() {
        return hayDataWedge;
    }

    /** En un Zebra crea o actualiza el perfil de DataWedge; en otros no hace nada. */
    void configurar() {
        if (!hayDataWedge) return;
        enviar(DW + "CREATE_PROFILE", DW_PERFIL);

        Bundle app = new Bundle();
        app.putString("PACKAGE_NAME", ctx.getPackageName());
        app.putStringArray("ACTIVITY_LIST", new String[]{"*"});

        Bundle codigos = new Bundle();
        codigos.putString("scanner_selection", "auto");
        codigos.putString("scanner_input_enabled", "true");
        Bundle conApp = perfil(plugin("BARCODE", codigos));
        conApp.putParcelableArray("APP_LIST", new Bundle[]{app});
        enviar(DW + "SET_CONFIG", conApp);

        Bundle salida = new Bundle();
        salida.putString("intent_output_enabled", "true");
        salida.putString("intent_action", accionPropia);
        salida.putString("intent_category", Intent.CATEGORY_DEFAULT);
        salida.putString("intent_delivery", "2");   // 2 = broadcast
        enviar(DW + "SET_CONFIG", perfil(plugin("INTENT", salida)));

        // Sin teclado: si no, cada lectura llegaria dos veces.
        Bundle teclado = new Bundle();
        teclado.putString("keystroke_output_enabled", "false");
        enviar(DW + "SET_CONFIG", perfil(plugin("KEYSTROKE", teclado)));
    }

    /** Prende o apaga el haz como el gatillo fisico. False si no se puede. */
    boolean disparar() {
        if (!hayDataWedge) return false;
        enviar(DW + "SOFT_SCAN_TRIGGER", "TOGGLE_SCANNING");
        return true;
    }

    void escuchar() {
        if (escuchando) return;
        IntentFilter filtro = new IntentFilter(accionPropia);
        for (String[] a : AVISOS) filtro.addAction(a[0]);
        // Con categoria DEFAULT tambien entran los avisos que no traen ninguna.
        filtro.addCategory(Intent.CATEGORY_DEFAULT);
        // Lo manda la app del lector, que es otra app: tiene que ser exportado.
        ContextCompat.registerReceiver(ctx, oyente, filtro, ContextCompat.RECEIVER_EXPORTED);
        escuchando = true;
    }

    void dejarDeEscuchar() {
        if (!escuchando) return;
        try { ctx.unregisterReceiver(oyente); } catch (IllegalArgumentException e) { /* ya estaba */ }
        escuchando = false;
    }

    /** Texto de la lectura: el extra conocido y, si no esta, el primer texto del aviso. */
    private static String textoDe(Intent i) {
        Bundle extras = i.getExtras();
        if (extras == null) return null;
        String accion = i.getAction();
        String clave = DW_DATOS;
        for (String[] a : AVISOS) {
            if (a[0].equals(accion)) { clave = a[1]; break; }
        }
        String t = comoTexto(extras, clave, extras.getInt("length", -1));
        if (t != null) return t;
        for (String k : extras.keySet()) {
            t = comoTexto(extras, k, -1);
            if (t != null) return t;
        }
        return null;
    }

    private static String comoTexto(Bundle extras, String clave, int largo) {
        Object v = extras.get(clave);
        if (v instanceof String) return ((String) v).isEmpty() ? null : (String) v;
        if (v instanceof byte[]) {
            byte[] b = (byte[]) v;
            int n = largo > 0 && largo <= b.length ? largo : b.length;
            return n == 0 ? null : new String(b, 0, n, StandardCharsets.UTF_8);
        }
        return null;
    }

    private boolean instalado(String paquete) {
        try {
            ctx.getPackageManager().getPackageInfo(paquete, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    private Bundle plugin(String nombre, Bundle parametros) {
        Bundle b = new Bundle();
        b.putString("PLUGIN_NAME", nombre);
        b.putString("RESET_CONFIG", "true");
        b.putBundle("PARAM_LIST", parametros);
        return b;
    }

    private Bundle perfil(Bundle plugin) {
        Bundle b = new Bundle();
        b.putString("PROFILE_NAME", DW_PERFIL);
        b.putString("PROFILE_ENABLED", "true");
        b.putString("CONFIG_MODE", "UPDATE");
        b.putBundle("PLUGIN_CONFIG", plugin);
        return b;
    }

    private void enviar(String extra, String valor) {
        Intent i = new Intent(DW_API);
        i.putExtra(extra, valor);
        ctx.sendBroadcast(i);
    }

    private void enviar(String extra, Bundle valor) {
        Intent i = new Intent(DW_API);
        i.putExtra(extra, valor);
        ctx.sendBroadcast(i);
    }
}
