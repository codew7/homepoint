package ar.com.homepoint.locatorpic;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Rect;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Size;
import android.view.ContextThemeWrapper;
import android.view.HapticFeedbackConstants;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.Surface;
import android.view.View;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.FocusMeteringAction;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.ImageCaptureException;
import androidx.camera.core.MeteringPoint;
import androidx.camera.core.Preview;
import androidx.camera.core.resolutionselector.AspectRatioStrategy;
import androidx.camera.core.resolutionselector.ResolutionSelector;
import androidx.camera.core.resolutionselector.ResolutionStrategy;
import androidx.camera.extensions.ExtensionMode;
import androidx.camera.extensions.ExtensionsManager;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.google.common.util.concurrent.ListenableFuture;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * Captura de cada zona.
 *
 * Modos de recorrido (EXTRA_MODO):
 *   seguir   -> agrega zonas al final, una tras otra (lo normal).
 *   rehacer  -> cambia la zona EXTRA_POSICION.
 *   insertar -> agrega una zona nueva antes de EXTRA_POSICION.
 *
 * Cada zona se puede sacar de dos formas:
 *   Foto unica     -> una foto con la maxima calidad del equipo; se revisa y
 *                     se confirma (RevisionActivity).
 *   Tomas cercanas -> varias fotos por estante, de izquierda a derecha, cada
 *                     una pisando ~30% de la anterior (se muestra esa franja
 *                     sobre el visor). Si la toma sale nitida y con luz se
 *                     confirma sola, con "Deshacer". Se guarda la orientacion
 *                     del equipo en cada toma; la PC las une como un
 *                     rompecabezas.
 *
 * El chip "Sector" pone nombre a un grupo de zonas ("Adelante izquierda"):
 * vale desde esta zona hasta que empiece otro sector.
 */
public class CamaraActivity extends AppCompatActivity implements SensorEventListener {

    public static final String EXTRA_SESION = "sesion";
    public static final String EXTRA_MODO = "modo";
    public static final String EXTRA_POSICION = "posicion";
    public static final String MODO_SEGUIR = "seguir", MODO_REHACER = "rehacer", MODO_INSERTAR = "insertar";

    private static final String PREF_HDR = "hdr";
    private static final String PREF_TOMAS = "tomasCercanas";
    private static final float SOLAPE = 0.3f;              // franja de la toma anterior
    private static final Size RESOLUCION_TOMA = new Size(3264, 2448);   // ~8 MP: de cerca alcanza
    private static final int CALIDAD_TOMA = 90;
    private static final long DURACION_DESHACER = 3500;

    private Sesiones repo;
    private Sesiones.Sesion sesion;
    private GuiaAnterior guia;
    private String modo;
    private int posicion;   // 0 = zona 1

    // Tomas cercanas
    private boolean tomasCercanas;
    private String barridoId;        // zona de tomas en curso (null hasta la primera toma)
    private int estante;             // 0 = el de mas arriba
    private String ultimaToma;       // para "Deshacer"
    private File enRevision;         // toma que fue a revision completa
    private float[] orientacionEnRevision;
    private String sectorPendiente;  // sector elegido antes de que exista la zona

    private PreviewView visor;
    private ImageView piel, guiaImg, solape;
    private View foco, destello, guiaBorde, guiaPanel, barraTomas, lineaCorte;
    private TextView zona, subZona, txtSubidas, guiaTxt, aviso, modoUnica, modoTomas, sector, sigEstante, terminarZona, deshacer;
    private ImageButton disparar, linterna, hdr;
    private NivelView nivel;

    private ProcessCameraProvider proveedor;
    private ExtensionsManager extensiones;
    private ImageCapture captura;
    private Camera camara;
    private boolean hdrDisponible, hdrActivo, linternaPrendida, tomando;
    private Executor principal;
    private final ExecutorService hilo = Executors.newSingleThreadExecutor();

    private SensorManager sensores;
    private Sensor rotacion;
    private volatile float[] orientacion;   // {azimut, inclinacion, giro}

    private final Sesiones.Oyente alCambiar = this::pintarSubidas;
    private final GuiaAnterior.Oyente alCambiarGuia = this::pintarZona;
    private final Runnable ocultarDeshacer = () -> {
        deshacer.animate().alpha(0f).setDuration(200).withEndAction(() -> deshacer.setVisibility(View.GONE));
        ultimaToma = null;
    };

    private final ActivityResultLauncher<Intent> revision =
            registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), r -> {
                if (tomasCercanas) {
                    File f = enRevision;
                    enRevision = null;
                    if (r.getResultCode() == RESULT_OK && f != null && f.exists()) {
                        guardarToma(f, orientacionEnRevision);
                    } else {
                        listoParaOtra();
                    }
                    return;
                }
                listoParaOtra();
                if (r.getResultCode() != RESULT_OK) return;   // "Repetir": misma zona
                aplicarSectorPendiente(posicion);
                if (MODO_SEGUIR.equals(modo)) {
                    pasarALaSiguienteZona();
                } else {
                    finish();   // rehacer / insertar: vuelve a la grilla
                }
            });

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        setContentView(R.layout.activity_camara);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        pantallaCompleta();

        repo = Sesiones.get(this);
        guia = GuiaAnterior.get(this);
        sesion = repo.porId(getIntent().getStringExtra(EXTRA_SESION));
        if (sesion == null) {
            finish();
            return;
        }
        modo = getIntent().getStringExtra(EXTRA_MODO);
        if (modo == null) modo = MODO_SEGUIR;
        posicion = MODO_SEGUIR.equals(modo) ? sesion.zonas.size() : getIntent().getIntExtra(EXTRA_POSICION, 0);
        principal = ContextCompat.getMainExecutor(this);
        hdrActivo = getPreferences(MODE_PRIVATE).getBoolean(PREF_HDR, false);
        sensores = (SensorManager) getSystemService(SENSOR_SERVICE);
        rotacion = sensores != null ? sensores.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR) : null;

        visor = findViewById(R.id.visor);
        piel = findViewById(R.id.piel);
        solape = findViewById(R.id.solape);
        lineaCorte = findViewById(R.id.lineaCorte);
        foco = findViewById(R.id.foco);
        destello = findViewById(R.id.destello);
        zona = findViewById(R.id.zona);
        subZona = findViewById(R.id.subZona);
        txtSubidas = findViewById(R.id.txtSubidas);
        guiaPanel = findViewById(R.id.guia);
        guiaImg = findViewById(R.id.guiaImg);
        guiaBorde = findViewById(R.id.guiaBorde);
        guiaTxt = findViewById(R.id.guiaTxt);
        aviso = findViewById(R.id.aviso);
        disparar = findViewById(R.id.disparar);
        linterna = findViewById(R.id.linterna);
        hdr = findViewById(R.id.hdr);
        nivel = findViewById(R.id.nivel);
        modoUnica = findViewById(R.id.modoUnica);
        modoTomas = findViewById(R.id.modoTomas);
        sector = findViewById(R.id.sector);
        barraTomas = findViewById(R.id.barraTomas);
        sigEstante = findViewById(R.id.sigEstante);
        terminarZona = findViewById(R.id.terminarZona);
        deshacer = findViewById(R.id.deshacer);

        disparar.setOnClickListener(v -> sacar());
        findViewById(R.id.atras).setOnClickListener(v -> finish());
        findViewById(R.id.zonas).setOnClickListener(v -> {
            startActivity(new Intent(this, RecorridoActivity.class));
            finish();
        });
        linterna.setOnClickListener(v -> alternarLinterna());
        hdr.setOnClickListener(v -> {
            hdrActivo = !hdrActivo;
            getPreferences(MODE_PRIVATE).edit().putBoolean(PREF_HDR, hdrActivo).apply();
            pintarHdr();
            vincular();
            Toast.makeText(this, hdrActivo ? "HDR activado" : "HDR desactivado", Toast.LENGTH_SHORT).show();
        });
        guiaPanel.setOnClickListener(v -> alternarPiel());
        modoUnica.setOnClickListener(v -> cambiarModo(false));
        modoTomas.setOnClickListener(v -> cambiarModo(true));
        sector.setOnClickListener(v -> elegirSector());
        sigEstante.setOnClickListener(v -> siguienteEstante());
        terminarZona.setOnClickListener(v -> terminarZonaDeTomas());
        deshacer.setOnClickListener(v -> deshacerToma());
        configurarEnfoque();

        tomasCercanas = modoInicial();
        pintarZona();
        aviso.postDelayed(() -> aviso.animate().alpha(0f).setDuration(400), 4000);
        iniciarCamara();
    }

    @Override
    protected void onStart() {
        super.onStart();
        repo.agregarOyente(alCambiar);
        guia.agregarOyente(alCambiarGuia);
        guia.iniciar();
        pintarSubidas();
    }

    @Override
    protected void onStop() {
        super.onStop();
        repo.quitarOyente(alCambiar);
        guia.quitarOyente(alCambiarGuia);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (rotacion != null) sensores.registerListener(this, rotacion, SensorManager.SENSOR_DELAY_UI);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (sensores != null) sensores.unregisterListener(this);
    }

    @Override
    public void onWindowFocusChanged(boolean foco) {
        super.onWindowFocusChanged(foco);
        if (foco) pantallaCompleta();
    }

    /** La tecla de volumen tambien saca la foto. */
    @Override
    public boolean onKeyDown(int code, KeyEvent e) {
        if (code == KeyEvent.KEYCODE_VOLUME_DOWN || code == KeyEvent.KEYCODE_VOLUME_UP || code == KeyEvent.KEYCODE_CAMERA) {
            if (e.getRepeatCount() == 0) sacar();
            return true;
        }
        return super.onKeyDown(code, e);
    }

    // ------------------------------------------------------------------
    // Orientacion del equipo (para ubicar las tomas cercanas)
    // ------------------------------------------------------------------

    @Override
    public void onSensorChanged(SensorEvent e) {
        float[] r = new float[9];
        SensorManager.getRotationMatrixFromVector(r, e.values);
        // Hacia donde mira la camara (eje -Z del equipo) en el mundo: este, norte, arriba.
        float x = -r[2], y = -r[5], z = -r[8];
        float azimut = (float) Math.toDegrees(Math.atan2(x, y));
        if (azimut < 0) azimut += 360f;
        float inclinacion = (float) Math.toDegrees(Math.asin(Math.max(-1f, Math.min(1f, z))));
        // Giro: cuanto se inclina el borde largo de la pantalla respecto de la horizontal.
        int rot = visor.getDisplay() != null ? visor.getDisplay().getRotation() : Surface.ROTATION_90;
        float lateral = (rot == Surface.ROTATION_90 || rot == Surface.ROTATION_270) ? r[7] : r[6];
        float giro = (float) Math.toDegrees(Math.asin(Math.max(-1f, Math.min(1f, lateral))));
        orientacion = new float[]{azimut, inclinacion, giro};
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) { }

    // ------------------------------------------------------------------
    // Camara
    // ------------------------------------------------------------------

    private void iniciarCamara() {
        ListenableFuture<ProcessCameraProvider> f = ProcessCameraProvider.getInstance(this);
        f.addListener(() -> {
            try {
                proveedor = f.get();
            } catch (Exception e) {
                Toast.makeText(this, "No se pudo abrir la cámara", Toast.LENGTH_LONG).show();
                finish();
                return;
            }
            ListenableFuture<ExtensionsManager> ef = ExtensionsManager.getInstanceAsync(this, proveedor);
            ef.addListener(() -> {
                try {
                    extensiones = ef.get();
                    hdrDisponible = extensiones.isExtensionAvailable(CameraSelector.DEFAULT_BACK_CAMERA, ExtensionMode.HDR);
                } catch (Exception e) {
                    hdrDisponible = false;
                }
                hdr.setVisibility(hdrDisponible ? View.VISIBLE : View.GONE);
                pintarHdr();
                vincular();
            }, principal);
        }, principal);
    }

    /**
     * Conecta el visor y la captura a la camara trasera en 4:3: con la maxima
     * resolucion en foto unica, y unos 8 MP en tomas cercanas (de cerca
     * alcanza, y son muchas fotos para subir).
     */
    private void vincular() {
        if (proveedor == null) return;
        proveedor.unbindAll();

        CameraSelector selector = CameraSelector.DEFAULT_BACK_CAMERA;
        if (hdrActivo && hdrDisponible && extensiones != null) {
            selector = extensiones.getExtensionEnabledCameraSelector(selector, ExtensionMode.HDR);
        }
        int rotacionPantalla = visor.getDisplay() != null ? visor.getDisplay().getRotation() : Surface.ROTATION_90;

        ResolutionStrategy estrategia = tomasCercanas
                ? new ResolutionStrategy(RESOLUCION_TOMA, ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER)
                : ResolutionStrategy.HIGHEST_AVAILABLE_STRATEGY;
        ResolutionSelector paraFoto = new ResolutionSelector.Builder()
                .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
                .setResolutionStrategy(estrategia)
                .build();
        ResolutionSelector paraVisor = new ResolutionSelector.Builder()
                .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
                .build();

        Preview preview = new Preview.Builder().setResolutionSelector(paraVisor).setTargetRotation(rotacionPantalla).build();
        preview.setSurfaceProvider(visor.getSurfaceProvider());
        captura = new ImageCapture.Builder()
                .setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
                .setJpegQuality(tomasCercanas ? CALIDAD_TOMA : 95)
                .setResolutionSelector(paraFoto)
                .setTargetRotation(rotacionPantalla)
                .build();
        try {
            camara = proveedor.bindToLifecycle(this, selector, preview, captura);
        } catch (Exception e) {
            if (hdrActivo) {
                // Algunos equipos anuncian HDR pero fallan al usarlo: se sigue sin HDR.
                hdrActivo = false;
                pintarHdr();
                vincular();
                return;
            }
            Toast.makeText(this, "No se pudo iniciar la cámara: " + e.getMessage(), Toast.LENGTH_LONG).show();
            return;
        }
        boolean hayFlash = camara.getCameraInfo().hasFlashUnit();
        linterna.setVisibility(hayFlash ? View.VISIBLE : View.GONE);
        if (hayFlash && linternaPrendida) camara.getCameraControl().enableTorch(true);
    }

    private void sacar() {
        if (captura == null || tomando) return;
        tomando = true;
        disparar.setEnabled(false);
        vibrar();
        destello.setAlpha(0.85f);
        destello.animate().alpha(0f).setDuration(260).start();
        float[] orientacionAlSacar = orientacion;
        boolean derecho = nivel.estaDerecho();

        File tmp = new File(getCacheDir(), "captura-" + System.currentTimeMillis() + ".jpg");
        ImageCapture.OutputFileOptions op = new ImageCapture.OutputFileOptions.Builder(tmp).build();
        captura.takePicture(op, principal, new ImageCapture.OnImageSavedCallback() {
            @Override
            public void onImageSaved(@NonNull ImageCapture.OutputFileResults r) {
                if (tomasCercanas) revisarToma(tmp, orientacionAlSacar, derecho);
                else abrirRevision(tmp, derecho, false, null);
            }

            @Override
            public void onError(@NonNull ImageCaptureException e) {
                listoParaOtra();
                tmp.delete();
                Toast.makeText(CamaraActivity.this, "No se pudo sacar la foto: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        });
    }

    private void abrirRevision(File archivo, boolean derecho, boolean soloRevisar, String titulo) {
        Intent i = new Intent(this, RevisionActivity.class);
        i.putExtra(RevisionActivity.EXTRA_SESION, sesion.id);
        i.putExtra(RevisionActivity.EXTRA_ARCHIVO, archivo.getAbsolutePath());
        i.putExtra(RevisionActivity.EXTRA_POSICION, posicion);
        i.putExtra(RevisionActivity.EXTRA_REEMPLAZAR, MODO_REHACER.equals(modo));
        i.putExtra(RevisionActivity.EXTRA_DERECHO, derecho);
        i.putExtra(RevisionActivity.EXTRA_SOLO_REVISAR, soloRevisar);
        if (titulo != null) i.putExtra(RevisionActivity.EXTRA_TITULO, titulo);
        revision.launch(i);
    }

    private void listoParaOtra() {
        tomando = false;
        disparar.setEnabled(true);
    }

    // ------------------------------------------------------------------
    // Tomas cercanas
    // ------------------------------------------------------------------

    /** Si la toma salio nitida, con luz y derecha, se guarda sola; si no, a revision. */
    private void revisarToma(File tmp, float[] orient, boolean derecho) {
        hilo.execute(() -> {
            Bitmap bmp = Imagenes.cargar(tmp, 1200);
            float[] q = bmp != null ? Imagenes.calidad(bmp) : new float[]{0, 0};
            if (bmp != null) bmp.recycle();
            boolean bien = derecho && q[0] >= RevisionActivity.NITIDEZ_MINIMA && q[1] >= RevisionActivity.BRILLO_MINIMO;
            runOnUiThread(() -> {
                if (bien) {
                    guardarToma(tmp, orient);
                } else {
                    enRevision = tmp;
                    orientacionEnRevision = orient;
                    abrirRevision(tmp, derecho, true, "Zona " + (posicion + 1) + " · Estante " + (estante + 1)
                            + " · Toma " + (tomasEnEstante() + 1));
                }
            });
        });
    }

    private void guardarToma(File tmp, float[] orient) {
        boolean primera = barridoId == null;
        String zid = primera ? repo.nuevoIdZona() : barridoId;
        int est = estante;
        hilo.execute(() -> {
            try {
                Sesiones.Foto f = repo.agregarToma(sesion, zid, posicion, primera && MODO_REHACER.equals(modo), est, tmp, orient);
                runOnUiThread(() -> {
                    barridoId = zid;
                    if (primera) aplicarSectorPendiente(posicion);
                    ultimaToma = f.id;
                    listoParaOtra();
                    pintarZona();
                    mostrarDeshacer("Estante " + (est + 1) + " · toma " + (f.indice + 1) + " guardada");
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    listoParaOtra();
                    Toast.makeText(this, "No se pudo guardar la toma: " + e.getMessage(), Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private void deshacerToma() {
        if (ultimaToma == null || barridoId == null) return;
        String zid = barridoId, foto = ultimaToma;
        ultimaToma = null;
        deshacer.removeCallbacks(ocultarDeshacer);
        deshacer.setVisibility(View.GONE);
        hilo.execute(() -> {
            repo.quitarToma(sesion, zid, foto);
            runOnUiThread(() -> {
                if (!sesion.barridos.containsKey(zid)) {
                    barridoId = null;
                    estante = 0;
                }
                pintarZona();
                Toast.makeText(this, "Toma descartada: sacala de nuevo", Toast.LENGTH_SHORT).show();
            });
        });
    }

    private void mostrarDeshacer(String texto) {
        deshacer.removeCallbacks(ocultarDeshacer);
        deshacer.setText(texto + "  ·  DESHACER");
        deshacer.setAlpha(1f);
        deshacer.setVisibility(View.VISIBLE);
        deshacer.postDelayed(ocultarDeshacer, DURACION_DESHACER);
    }

    private void siguienteEstante() {
        if (tomasEnEstante() == 0) {
            Toast.makeText(this, "Sacá al menos una toma de este estante", Toast.LENGTH_SHORT).show();
            return;
        }
        estante++;
        pintarZona();
        Toast.makeText(this, "Estante " + (estante + 1) + ": empezá por la izquierda", Toast.LENGTH_SHORT).show();
    }

    private void terminarZonaDeTomas() {
        if (barridoId == null) {
            Toast.makeText(this, "Todavía no hay tomas en esta zona", Toast.LENGTH_SHORT).show();
            return;
        }
        Sesiones.Barrido b = sesion.barridos.get(barridoId);
        int n = b != null ? b.tomas() : 0;
        Toast.makeText(this, "Zona " + (posicion + 1) + " lista: " + n + " tomas", Toast.LENGTH_SHORT).show();
        if (MODO_SEGUIR.equals(modo)) pasarALaSiguienteZona();
        else finish();
    }

    private int tomasEnEstante() {
        Sesiones.Barrido b = barridoId != null ? sesion.barridos.get(barridoId) : null;
        return b != null && estante < b.estantes.size() ? b.estantes.get(estante).size() : 0;
    }

    /**
     * Franja para encastrar la proxima toma: el 30% derecho de la toma
     * anterior, a la izquierda del visor; o, al empezar un estante, el 30% de
     * abajo de la primera toma del estante de arriba, arriba del visor.
     */
    private void pintarSolape() {
        Sesiones.Barrido b = barridoId != null ? sesion.barridos.get(barridoId) : null;
        String fotoId = null;
        boolean deArriba = false;
        if (tomasCercanas && b != null) {
            if (estante < b.estantes.size() && !b.estantes.get(estante).isEmpty()) {
                List<String> fila = b.estantes.get(estante);
                fotoId = fila.get(fila.size() - 1);
            } else if (estante > 0 && estante - 1 < b.estantes.size() && !b.estantes.get(estante - 1).isEmpty()) {
                fotoId = b.estantes.get(estante - 1).get(0);
                deArriba = true;
            }
        }
        if (fotoId == null) {
            solape.setTag(null);
            solape.setImageDrawable(null);
            solape.setVisibility(View.GONE);
            return;
        }
        File archivo = repo.archivoFoto(sesion, fotoId);
        boolean arriba = deArriba;
        String esperado = fotoId + arriba;
        if (esperado.equals(solape.getTag())) return;   // ya esta dibujada
        solape.setTag(esperado);
        hilo.execute(() -> {
            Bitmap bmp = Imagenes.cargar(archivo, 1000);
            if (bmp == null) return;
            int w = bmp.getWidth(), h = bmp.getHeight();
            Bitmap franja = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            Canvas c = new Canvas(franja);
            if (arriba) {
                int alto = Math.round(h * SOLAPE);
                c.drawBitmap(bmp, new Rect(0, h - alto, w, h), new Rect(0, 0, w, alto), null);
            } else {
                int ancho = Math.round(w * SOLAPE);
                c.drawBitmap(bmp, new Rect(w - ancho, 0, w, h), new Rect(0, 0, ancho, h), null);
            }
            bmp.recycle();
            runOnUiThread(() -> {
                if (!esperado.equals(solape.getTag())) return;
                solape.setImageBitmap(franja);
                solape.setVisibility(View.VISIBLE);
            });
        });
    }

    private void cambiarModo(boolean tomas) {
        if (tomas == tomasCercanas) return;
        if (barridoId != null) {
            Toast.makeText(this, "Esta zona ya tiene tomas. Terminala o deshacé las tomas para cambiar.", Toast.LENGTH_LONG).show();
            return;
        }
        tomasCercanas = tomas;
        getPreferences(MODE_PRIVATE).edit().putBoolean(PREF_TOMAS, tomas).apply();
        vincular();
        pintarZona();
        if (tomas) {
            Toast.makeText(this, "Tomas cercanas: de izquierda a derecha, pisando un poco la anterior", Toast.LENGTH_LONG).show();
        }
    }

    /**
     * Modo con que empieza la zona: el de la zona que se rehace; si no, el que
     * tuvo esa zona la vez anterior; si no hay datos, el ultimo que se uso.
     */
    private boolean modoInicial() {
        if (MODO_REHACER.equals(modo)) return sesion.barridoDeZona(posicion) != null;
        int numero = posicion + 1;
        if (numero <= guia.cantidadZonas()) return guia.fueConTomas(numero);
        return getPreferences(MODE_PRIVATE).getBoolean(PREF_TOMAS, false);
    }

    private void pasarALaSiguienteZona() {
        posicion = sesion.zonas.size();
        barridoId = null;
        estante = 0;
        ultimaToma = null;
        deshacer.setVisibility(View.GONE);
        boolean antes = tomasCercanas;
        tomasCercanas = modoInicial();
        if (antes != tomasCercanas) vincular();
        pintarZona();
    }

    // ------------------------------------------------------------------
    // Sectores
    // ------------------------------------------------------------------

    /** Sector en que cae la zona actual (o el que se va a aplicar). */
    private String sectorActual() {
        if (sectorPendiente != null) return sectorPendiente;
        boolean existe = MODO_REHACER.equals(modo) || barridoId != null;
        return sesion.sectorDe(existe ? posicion : posicion - 1);
    }

    /** Sector que empezaba en esta zona la vez anterior, si no es el que ya rige. */
    private String sectorSugerido() {
        String s = guia.sectorQueEmpieza(posicion + 1);
        return s != null && !s.equals(sectorActual()) ? s : null;
    }

    private void elegirSector() {
        String sugerido = sectorSugerido();
        if (sugerido != null) {
            ponerSector(sugerido);
            return;
        }
        List<String> nombres = new ArrayList<>(sesion.nombresSectores());
        for (String n : guia.nombresSectores()) if (!nombres.contains(n)) nombres.add(n);
        List<String> opciones = new ArrayList<>(nombres);
        opciones.add("Nombre nuevo…");
        ContextThemeWrapper tema = new ContextThemeWrapper(this, R.style.Tema_LocatorPic);
        new MaterialAlertDialogBuilder(tema)
                .setTitle("Sector desde la zona " + (posicion + 1))
                .setItems(opciones.toArray(new String[0]), (d, cual) -> {
                    if (cual < nombres.size()) ponerSector(nombres.get(cual));
                    else pedirNombreSector(tema);
                })
                .setNegativeButton("Cancelar", null)
                .show();
    }

    private void pedirNombreSector(ContextThemeWrapper tema) {
        EditText campo = new EditText(tema);
        campo.setHint("Ej.: Adelante izquierda");
        campo.setSingleLine(true);
        FrameLayout marco = new FrameLayout(tema);
        int m = Math.round(20 * getResources().getDisplayMetrics().density);
        marco.setPadding(m, m / 2, m, 0);
        marco.addView(campo);
        new MaterialAlertDialogBuilder(tema)
                .setTitle("Nombre del sector")
                .setView(marco)
                .setPositiveButton("Aplicar", (d, w) -> {
                    String n = campo.getText().toString().trim();
                    if (!n.isEmpty()) ponerSector(n);
                })
                .setNegativeButton("Cancelar", null)
                .show();
    }

    /** Si la zona ya existe se marca ya; si no, cuando se guarde su primera foto. */
    private void ponerSector(String nombre) {
        boolean existe = MODO_REHACER.equals(modo) || barridoId != null;
        if (existe && posicion < sesion.zonas.size()) {
            repo.ponerSector(sesion, sesion.zonas.get(posicion), nombre);
            sectorPendiente = null;
        } else {
            sectorPendiente = nombre;
        }
        Toast.makeText(this, "Sector «" + nombre + "» desde la zona " + (posicion + 1), Toast.LENGTH_SHORT).show();
        pintarSector();
    }

    private void aplicarSectorPendiente(int pos) {
        if (sectorPendiente == null || pos < 0 || pos >= sesion.zonas.size()) return;
        repo.ponerSector(sesion, sesion.zonas.get(pos), sectorPendiente);
        sectorPendiente = null;
    }

    // ------------------------------------------------------------------
    // Pantalla
    // ------------------------------------------------------------------

    private void pintarZona() {
        int numero = posicion + 1;
        zona.setText(String.valueOf(numero));
        int anterior = guia.cantidadZonas();
        String sub;
        if (tomasCercanas) {
            sub = "Estante " + (estante + 1) + " · toma " + (tomasEnEstante() + 1);
            if (MODO_REHACER.equals(modo) && barridoId == null) sub += " · rehaciendo";
        } else if (MODO_REHACER.equals(modo)) sub = "Rehaciendo la foto";
        else if (MODO_INSERTAR.equals(modo)) sub = "Zona nueva (se insertan antes de la " + numero + ")";
        else if (anterior > 0) sub = "Vez anterior: " + anterior + " zonas";
        else sub = "Primer recorrido";
        subZona.setText(sub);

        pintarSegmento(modoUnica, !tomasCercanas);
        pintarSegmento(modoTomas, tomasCercanas);
        barraTomas.setVisibility(tomasCercanas ? View.VISIBLE : View.GONE);
        sigEstante.setAlpha(tomasEnEstante() > 0 ? 1f : 0.45f);
        terminarZona.setAlpha(barridoId != null ? 1f : 0.45f);
        lineaCorte.setVisibility(tomasCercanas ? View.GONE : View.VISIBLE);
        aviso.setText(tomasCercanas
                ? "De izquierda a derecha: encastrá cada toma con la franja de la anterior"
                : "Encuadrá las dos columnas: la línea marca el corte");
        pintarSolape();
        pintarSector();
        pintarGuia();
    }

    private void pintarSegmento(TextView t, boolean activo) {
        t.setBackgroundTintList(ColorStateList.valueOf(activo ? getColor(R.color.acento) : 0x00000000));
        t.setTextColor(activo ? 0xFFFFFFFF : getColor(R.color.cam_texto_2));
    }

    private void pintarSector() {
        String sugerido = sectorSugerido();
        String actual = sectorActual();
        if (sugerido != null) {
            sector.setText("¿Acá empieza «" + sugerido + "»? Tocá");
            sector.setBackgroundTintList(ColorStateList.valueOf(getColor(R.color.acento)));
        } else {
            sector.setText(actual != null ? actual : "Sin sector · tocá para nombrar");
            sector.setBackgroundTintList(null);
        }
    }

    private void pintarGuia() {
        int anterior = guia.cantidadZonas();
        File f = guia.miniatura(posicion + 1);
        Bitmap bmp = f != null ? BitmapFactory.decodeFile(f.getAbsolutePath()) : null;
        if (bmp != null) {
            guiaImg.setImageBitmap(bmp);
            piel.setImageBitmap(bmp);
            guiaTxt.setText("Vez anterior · zona " + (posicion + 1) + (guia.fueConTomas(posicion + 1) ? " · tomas" : ""));
            guiaPanel.setAlpha(1f);
        } else {
            guiaImg.setImageDrawable(null);
            piel.setImageDrawable(null);
            piel.setVisibility(View.GONE);
            guiaBorde.setVisibility(View.GONE);
            guiaTxt.setText(anterior > 0 && posicion + 1 > anterior ? "Zona nueva" : "Sin foto guía");
            guiaPanel.setAlpha(0.7f);
        }
    }

    private void alternarPiel() {
        if (piel.getDrawable() == null) return;
        boolean mostrar = piel.getVisibility() != View.VISIBLE;
        piel.setVisibility(mostrar ? View.VISIBLE : View.GONE);
        guiaBorde.setVisibility(mostrar ? View.VISIBLE : View.GONE);
        if (mostrar) Toast.makeText(this, "Alineá la estantería con la foto de la vez anterior", Toast.LENGTH_SHORT).show();
    }

    private void pintarSubidas() {
        int total = 0;
        for (String z : sesion.zonas) total += sesion.fotosDe(z).size();
        int pendientes = sesion.pendientes();
        if (total == 0) txtSubidas.setText("Recorrido nuevo");
        else if (pendientes == 0) txtSubidas.setText(total + (total == 1 ? " foto subida" : " fotos subidas"));
        else txtSubidas.setText("Subidas " + (total - pendientes) + " de " + total);
    }

    /** Tocar el visor enfoca y mide la luz en ese punto. */
    @SuppressLint("ClickableViewAccessibility")
    private void configurarEnfoque() {
        visor.setOnTouchListener((v, e) -> {
            if (e.getAction() != MotionEvent.ACTION_UP || camara == null) return true;
            MeteringPoint punto = visor.getMeteringPointFactory().createPoint(e.getX(), e.getY());
            FocusMeteringAction accion = new FocusMeteringAction.Builder(punto,
                    FocusMeteringAction.FLAG_AF | FocusMeteringAction.FLAG_AE)
                    .setAutoCancelDuration(4, TimeUnit.SECONDS).build();
            camara.getCameraControl().startFocusAndMetering(accion);
            foco.setX(e.getX() - foco.getWidth() / 2f);
            foco.setY(e.getY() - foco.getHeight() / 2f);
            foco.setScaleX(1.4f);
            foco.setScaleY(1.4f);
            foco.setAlpha(1f);
            foco.setVisibility(View.VISIBLE);
            foco.animate().scaleX(1f).scaleY(1f).setDuration(180).withEndAction(() ->
                    foco.animate().alpha(0f).setStartDelay(700).setDuration(300)).start();
            return true;
        });
    }

    private void alternarLinterna() {
        if (camara == null) return;
        linternaPrendida = !linternaPrendida;
        camara.getCameraControl().enableTorch(linternaPrendida);
        linterna.setImageResource(linternaPrendida ? R.drawable.ic_rayo : R.drawable.ic_rayo_off);
        linterna.setImageTintList(ColorStateList.valueOf(linternaPrendida ? getColor(R.color.acento) : 0xFFFFFFFF));
    }

    private void pintarHdr() {
        hdr.setImageTintList(ColorStateList.valueOf(hdrActivo ? getColor(R.color.acento) : 0xFFFFFFFF));
    }

    private void vibrar() {
        int tipo = Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.CONFIRM : HapticFeedbackConstants.VIRTUAL_KEY;
        disparar.performHapticFeedback(tipo);
    }

    private void pantallaCompleta() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.hide(WindowInsetsCompat.Type.systemBars());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
