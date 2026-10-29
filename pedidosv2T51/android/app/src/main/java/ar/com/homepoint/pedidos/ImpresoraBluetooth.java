package ar.com.homepoint.pedidos;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;
import android.util.Base64;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.appcompat.app.AlertDialog;
import androidx.core.content.ContextCompat;

import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Impresion ESC-POS directa por Bluetooth clasico (perfil SPP), sin pasar por
 * el dialogo de impresion de Android ni por ninguna app intermediaria.
 *
 * pedidosv2.html arma los mismos comandos ESC-POS que ya usa para la
 * impresora de PC via QZ Tray (ver construirESCPOS en el HTML); aca solo se
 * decodifica ese base64 y se escribe crudo en el socket. La complejidad esta
 * toda del lado de: pedir permiso, prender Bluetooth si esta apagado, y
 * dejar elegir la impresora una sola vez (se guarda su direccion MAC).
 *
 * Un solo trabajo de impresion por vez: en una terminal de mostrador no hace
 * falta cola, y encolar de mas complica sin necesidad.
 */
class ImpresoraBluetooth {

    private static final String TAG = "ImpresoraBT";

    /** UUID estandar del perfil SPP (Serial Port Profile) que hablan las termicas. */
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final String PREFS = "impresora_bt";
    private static final String CLAVE_MAC = "direccion_mac";

    /** Bytes por escritura: el buffer de la impresora no traga mucho mas de una vez. */
    private static final int TROZO = 2048;

    /** A quien avisarle cuando termina un trabajo de impresion (no de configuracion). */
    interface Callback {
        void onResultado(boolean ok, String mensaje);
    }

    private final MainActivity app;
    private final ExecutorService hiloEnvio = Executors.newSingleThreadExecutor();
    private final ActivityResultLauncher<String> pedirPermiso;
    private final ActivityResultLauncher<Intent> pedirActivar;

    // Trabajo en curso: null = nada pendiente. datos == null significa que es
    // solo "elegir/cambiar impresora", sin imprimir nada.
    private byte[] trabajoDatos;
    private Callback trabajoCallback;
    private boolean trabajoForzarEleccion;
    private boolean trabajoEnCurso;

    ImpresoraBluetooth(MainActivity app) {
        this.app = app;
        pedirPermiso = app.registerForActivityResult(
                new androidx.activity.result.contract.ActivityResultContracts.RequestPermission(),
                concedido -> {
                    if (!trabajoEnCurso) return;
                    if (Boolean.TRUE.equals(concedido)) continuar();
                    else terminar(false, app.getString(R.string.bt_sin_permiso));
                });
        pedirActivar = app.registerForActivityResult(
                new androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult(),
                resultado -> {
                    if (!trabajoEnCurso) return;
                    if (resultado.getResultCode() == android.app.Activity.RESULT_OK) continuar();
                    else terminar(false, app.getString(R.string.bt_activar));
                });
    }

    /** Imprime bytesBase64 (ya armado por la pagina) en la impresora guardada; si no hay ninguna, la pide. */
    void imprimir(byte[] datos, Callback callback) {
        if (trabajoEnCurso) {
            callback.onResultado(false, "Ya hay una impresión en curso");
            return;
        }
        trabajoEnCurso = true;
        trabajoDatos = datos;
        trabajoCallback = callback;
        trabajoForzarEleccion = false;
        continuar();
    }

    /** Abre el selector de impresora aunque ya haya una guardada, para poder cambiarla. */
    void elegirImpresora() {
        if (trabajoEnCurso) return;
        trabajoEnCurso = true;
        trabajoDatos = null;
        trabajoCallback = null;
        trabajoForzarEleccion = true;
        continuar();
    }

    private void continuar() {
        BluetoothAdapter adaptador = obtenerAdaptador();
        if (adaptador == null) {
            terminar(false, app.getString(R.string.bt_sin_hardware));
            return;
        }
        if (!tienePermiso()) {
            pedirPermiso.launch(Manifest.permission.BLUETOOTH_CONNECT);
            return;
        }
        if (!adaptador.isEnabled()) {
            pedirActivar.launch(new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE));
            return;
        }

        String mac = trabajoForzarEleccion ? null : prefs().getString(CLAVE_MAC, null);
        BluetoothDevice dispositivo = mac == null ? null : buscarPorDireccion(adaptador, mac);

        if (dispositivo == null) {
            mostrarSelector(adaptador);
            return;
        }
        if (trabajoDatos == null) {
            terminar(true, null);   // "elegir impresora" con una ya guardada: nada que hacer
            return;
        }
        enviar(dispositivo);
    }

    private void mostrarSelector(BluetoothAdapter adaptador) {
        List<BluetoothDevice> emparejados;
        try {
            emparejados = new ArrayList<>(adaptador.getBondedDevices());
        } catch (SecurityException e) {
            terminar(false, app.getString(R.string.bt_sin_permiso));
            return;
        }
        if (emparejados.isEmpty()) {
            new AlertDialog.Builder(app)
                    .setTitle(R.string.bt_sin_dispositivos_titulo)
                    .setMessage(R.string.bt_sin_dispositivos_detalle)
                    .setPositiveButton(android.R.string.ok, null)
                    .setOnDismissListener(d -> terminar(false, app.getString(R.string.bt_sin_dispositivos_detalle)))
                    .show();
            return;
        }
        Collections.sort(emparejados, (a, b) -> nombreDe(a).compareToIgnoreCase(nombreDe(b)));
        String[] nombres = new String[emparejados.size()];
        for (int i = 0; i < emparejados.size(); i++) nombres[i] = nombreDe(emparejados.get(i));

        final boolean[] eligio = {false};
        new AlertDialog.Builder(app)
                .setTitle(R.string.bt_elegir_titulo)
                .setItems(nombres, (dialogo, cual) -> {
                    eligio[0] = true;
                    BluetoothDevice elegido = emparejados.get(cual);
                    guardar(elegido);
                    if (trabajoDatos == null) {
                        terminar(true, app.getString(R.string.bt_configurada, nombreDe(elegido)));
                    } else {
                        enviar(elegido);
                    }
                })
                .setNegativeButton(android.R.string.cancel, null)
                .setOnDismissListener(d -> {
                    if (!eligio[0]) terminar(false, app.getString(R.string.bt_sin_eleccion));
                })
                .show();
    }

    private void enviar(BluetoothDevice dispositivo) {
        final byte[] datos = trabajoDatos;
        Toast.makeText(app, R.string.bt_conectando, Toast.LENGTH_SHORT).show();
        hiloEnvio.execute(() -> {
            BluetoothSocket socket = null;
            try {
                // Nunca arrancamos un descubrimiento, pero si el sistema esta
                // escaneando, la conexion RFCOMM se puede caer. Cancelarlo es
                // solo una precaucion y en Android 12+ exige BLUETOOTH_SCAN,
                // un permiso que no pedimos: sin este try/catch la
                // SecurityException se comia el trabajo entero ANTES de
                // intentar conectar, y no se imprimia nada.
                try {
                    BluetoothAdapter adaptador = obtenerAdaptador();
                    if (adaptador != null) adaptador.cancelDiscovery();
                } catch (Exception ignorado) { /* se sigue igual */ }

                socket = abrirSocket(dispositivo);
                escribirTodo(socket, datos);
                app.runOnUiThread(() -> terminar(true, null));
            } catch (Exception e) {
                Log.w(TAG, "No se pudo imprimir por Bluetooth", e);
                final String motivo = app.getString(R.string.bt_sin_conexion)
                        + "\n\nDetalle: " + e.getClass().getSimpleName()
                        + (e.getMessage() == null ? "" : ": " + e.getMessage());
                app.runOnUiThread(() -> terminar(false, motivo));
            } finally {
                if (socket != null) {
                    try { socket.close(); } catch (IOException ignored) { /* nada */ }
                }
            }
        });
    }

    /**
     * Abre el puerto serie con la impresora probando las cuatro formas que
     * existen, en orden. Las termicas baratas suelen fallar con la primera:
     * muchas no publican el service record de SPP (y entonces buscarlas por
     * UUID no encuentra nada) o rechazan el canal cifrado. El canal 1 a mano
     * por reflexion es el ultimo recurso, y es el que termina funcionando en
     * buena parte de los modulos genericos.
     */
    private BluetoothSocket abrirSocket(BluetoothDevice dispositivo) throws Exception {
        Exception ultimo = null;
        for (int intento = 1; intento <= 4; intento++) {
            BluetoothSocket socket = null;
            try {
                socket = crearSocket(dispositivo, intento);
                socket.connect();
                Log.i(TAG, "Impresora conectada en el intento " + intento);
                return socket;
            } catch (Exception e) {
                ultimo = e;
                Log.w(TAG, "Intento " + intento + " de conexion fallido: " + e);
                if (socket != null) {
                    try { socket.close(); } catch (IOException ignorado) { /* nada */ }
                }
            }
        }
        throw ultimo != null ? ultimo : new IOException("No se pudo abrir el puerto de la impresora");
    }

    private BluetoothSocket crearSocket(BluetoothDevice d, int intento) throws Exception {
        switch (intento) {
            case 1:  return d.createRfcommSocketToServiceRecord(SPP_UUID);
            case 2:  return d.createInsecureRfcommSocketToServiceRecord(SPP_UUID);
            case 3:  return (BluetoothSocket) d.getClass()
                            .getMethod("createRfcommSocket", int.class).invoke(d, 1);
            default: return (BluetoothSocket) d.getClass()
                            .getMethod("createInsecureRfcommSocket", int.class).invoke(d, 1);
        }
    }

    /**
     * Manda los bytes de a poco. El buffer de una termica es de unos pocos KB:
     * volcarle un rotulo entero (~90 KB) de una sola vez le hace perder la
     * mitad del trabajo. Al final espera un rato proporcional al tamano, para
     * que el socket no se cierre mientras la impresora todavia esta sacando
     * papel, que es lo que corta los tickets por la mitad.
     */
    private void escribirTodo(BluetoothSocket socket, byte[] datos) throws IOException, InterruptedException {
        OutputStream out = socket.getOutputStream();
        for (int i = 0; i < datos.length; i += TROZO) {
            int largo = Math.min(TROZO, datos.length - i);
            out.write(datos, i, largo);
            out.flush();
            Thread.sleep(20);
        }
        Thread.sleep(Math.min(5000, 500 + datos.length / 40));
    }

    private void terminar(boolean ok, String mensaje) {
        Callback callback = trabajoCallback;
        boolean eraConfiguracion = (trabajoDatos == null);
        trabajoEnCurso = false;
        trabajoDatos = null;
        trabajoCallback = null;

        if (eraConfiguracion) {
            if (mensaje != null) Toast.makeText(app, mensaje, Toast.LENGTH_LONG).show();
            return;
        }
        if (callback != null) callback.onResultado(ok, mensaje);
    }

    // ---------------------------------------------------------------- helpers

    private BluetoothAdapter obtenerAdaptador() {
        android.bluetooth.BluetoothManager bm =
                (android.bluetooth.BluetoothManager) app.getSystemService(android.content.Context.BLUETOOTH_SERVICE);
        return bm == null ? null : bm.getAdapter();
    }

    private boolean tienePermiso() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;   // API < 31: alcanza con el manifest
        return ContextCompat.checkSelfPermission(app, Manifest.permission.BLUETOOTH_CONNECT)
                == android.content.pm.PackageManager.PERMISSION_GRANTED;
    }

    private BluetoothDevice buscarPorDireccion(BluetoothAdapter adaptador, String mac) {
        try {
            for (BluetoothDevice d : adaptador.getBondedDevices()) {
                if (mac.equals(d.getAddress())) return d;
            }
        } catch (SecurityException e) { /* se resuelve mas arriba, con tienePermiso() */ }
        return null;
    }

    private String nombreDe(BluetoothDevice d) {
        try {
            String n = d.getName();
            return (n == null || n.isEmpty()) ? d.getAddress() : n;
        } catch (SecurityException e) {
            return d.getAddress();
        }
    }

    private void guardar(BluetoothDevice d) {
        try {
            prefs().edit().putString(CLAVE_MAC, d.getAddress()).apply();
        } catch (SecurityException e) { /* nada */ }
    }

    private SharedPreferences prefs() {
        return app.getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE);
    }

    /** Decodifica el base64 que arma pedidosv2.html a partir de construirESCPOS(). */
    static byte[] decodificar(String base64) {
        return Base64.decode(base64, Base64.DEFAULT);
    }
}
