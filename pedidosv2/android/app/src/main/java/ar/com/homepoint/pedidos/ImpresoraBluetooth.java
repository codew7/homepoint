package ar.com.homepoint.pedidos;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
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

    /** UUID estandar del perfil SPP (Serial Port Profile) que hablan las termicas. */
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final String PREFS = "impresora_bt";
    private static final String CLAVE_MAC = "direccion_mac";

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
        byte[] datos = trabajoDatos;
        hiloEnvio.execute(() -> {
            BluetoothSocket socket = null;
            try {
                BluetoothAdapter adaptador = obtenerAdaptador();
                if (adaptador != null) adaptador.cancelDiscovery();
                socket = dispositivo.createRfcommSocketToServiceRecord(SPP_UUID);
                socket.connect();
                OutputStream out = socket.getOutputStream();
                out.write(datos);
                out.flush();
                // Le da tiempo al buffer de la impresora a vaciarse: cerrar el
                // socket apenas se manda puede recortar el final del ticket.
                Thread.sleep(400);
                app.runOnUiThread(() -> terminar(true, null));
            } catch (Exception e) {
                String motivo = (e instanceof IOException)
                        ? app.getString(R.string.bt_sin_conexion)
                        : "No se pudo imprimir: " + e.getMessage();
                app.runOnUiThread(() -> terminar(false, motivo));
            } finally {
                if (socket != null) {
                    try { socket.close(); } catch (IOException ignored) { /* nada */ }
                }
            }
        });
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
