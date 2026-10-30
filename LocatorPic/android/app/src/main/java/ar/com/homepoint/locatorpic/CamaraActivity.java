package ar.com.homepoint.locatorpic;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Rect;
import android.os.Build;
import android.os.Bundle;
import android.util.Size;
import android.view.ContextThemeWrapper;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.Surface;
import android.view.View;
import android.view.WindowManager;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
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
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * Captura en vertical. Cada foto va a un lugar de la cuadricula del grupo
 * elegido (FL, FR, BL, BR, OT):
 *   "→ Columna nueva":    la proxima foto es una columna nueva, a la derecha
 *                         de la ultima que se saco.
 *   "↓ Estante de abajo": la proxima foto va debajo, en la misma columna
 *                         (para columnas que no entran en una sola foto).
 * La eleccion queda hasta que se cambie.
 *
 * Si la foto sale nitida, con luz y derecha se guarda sola (con "Deshacer");
 * si no, se abre la revision completa.
 *
 * Desde la cuadricula (RecorridoActivity) se abre en un lugar puntual con
 * EXTRA_ACCION: columna nueva en una posicion, otro estante debajo de una
 * columna, o rehacer una foto.
 */
public class CamaraActivity extends AppCompatActivity {

    public static final String EXTRA_SESION = "sesion";
    public static final String EXTRA_GRUPO = "grupo";
    public static final String EXTRA_ACCION = "accion";
    public static final String EXTRA_COLUMNA = "columna";   // desde 0
    public static final String EXTRA_ESTANTE = "estante";   // desde 0
    public static final String ACCION_SEGUIR = "seguir", ACCION_COLUMNA = "columna",
            ACCION_ABAJO = "abajo", ACCION_REHACER = "rehacer";

    private static final String PREF_HDR = "hdr";
    private static final String PREF_GRUPO = "grupo";
    private static final String PREF_ABAJO = "abajo";
    private static final float SOLAPE = 0.25f;             // franja de la foto de arriba
    private static final Size RESOLUCION = new Size(3264, 2448);   // ~8 MP: de cerca alcanza
    private static final int CALIDAD = 90;
    private static final long DURACION_DESHACER = 3500;

    private Sesiones repo;
    private Sesiones.Sesion sesion;
    private GuiaAnterior guia;
    private String accion;

    // Donde va la proxima foto
    private String grupo;
    private boolean abajo;        // true: debajo de la columna "ancla"; false: columna nueva a su derecha
    private int ancla = -1;       // columna de referencia (desde 0); -1 = ninguna
    private int rehacerColumna, rehacerEstante;

    private String ultimaFoto;    // para "Deshacer"
    private int anclaAntes;
    private File enRevision;

    private PreviewView visor;
    private ImageView piel, guiaImg, solape;
    private View foco, destello, guiaBorde, guiaPanel, direccion;
    private TextView columna, subColumna, txtSubidas, guiaTxt, aviso, dirDerecha, dirAbajo, deshacer;
    private LinearLayout grupos;
    private ImageButton disparar, linterna, hdr;
    private NivelView nivel;

    private ProcessCameraProvider proveedor;
    private ExtensionsManager extensiones;
    private ImageCapture captura;
    private Camera camara;
    private boolean hdrDisponible, hdrActivo, linternaPrendida, tomando;
    private Executor principal;
    private final ExecutorService hilo = Executors.newSingleThreadExecutor();

    private final Sesiones.Oyente alCambiar = this::pintarSubidas;
    private final GuiaAnterior.Oyente alCambiarGuia = this::pintar;
    private final Runnable ocultarDeshacer = () -> {
        deshacer.animate().alpha(0f).setDuration(200).withEndAction(() -> deshacer.setVisibility(View.GONE));
        ultimaFoto = null;
    };

    private final ActivityResultLauncher<Intent> revision =
            registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), r -> {
                File f = enRevision;
                enRevision = null;
                if (r.getResultCode() == RESULT_OK && f != null && f.exists()) guardar(f);
                else listoParaOtra();
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
        principal = ContextCompat.getMainExecutor(this);
        hdrActivo = getPreferences(MODE_PRIVATE).getBoolean(PREF_HDR, false);

        visor = findViewById(R.id.visor);
        piel = findViewById(R.id.piel);
        solape = findViewById(R.id.solape);
        foco = findViewById(R.id.foco);
        destello = findViewById(R.id.destello);
        columna = findViewById(R.id.columna);
        subColumna = findViewById(R.id.subColumna);
        txtSubidas = findViewById(R.id.txtSubidas);
        grupos = findViewById(R.id.grupos);
        guiaPanel = findViewById(R.id.guia);
        guiaImg = findViewById(R.id.guiaImg);
        guiaBorde = findViewById(R.id.guiaBorde);
        guiaTxt = findViewById(R.id.guiaTxt);
        aviso = findViewById(R.id.aviso);
        direccion = findViewById(R.id.direccion);
        dirDerecha = findViewById(R.id.dirDerecha);
        dirAbajo = findViewById(R.id.dirAbajo);
        deshacer = findViewById(R.id.deshacer);
        disparar = findViewById(R.id.disparar);
        linterna = findViewById(R.id.linterna);
        hdr = findViewById(R.id.hdr);
        nivel = findViewById(R.id.nivel);

        disparar.setOnClickListener(v -> sacar());
        findViewById(R.id.atras).setOnClickListener(v -> finish());
        findViewById(R.id.verGrilla).setOnClickListener(v -> {
            if (!ACCION_SEGUIR.equals(accion)) {   // se abrio desde la cuadricula: se vuelve a ella
                finish();
                return;
            }
            Intent i = new Intent(this, RecorridoActivity.class);
            i.putExtra(RecorridoActivity.EXTRA_GRUPO, grupo);
            startActivity(i);
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
        dirDerecha.setOnClickListener(v -> cambiarDireccion(false));
        dirAbajo.setOnClickListener(v -> cambiarDireccion(true));
        deshacer.setOnClickListener(v -> deshacerFoto());
        configurarEnfoque();
        armarBotonesDeGrupo();

        accion = getIntent().getStringExtra(EXTRA_ACCION);
        if (accion == null) accion = ACCION_SEGUIR;
        String g = getIntent().getStringExtra(EXTRA_GRUPO);
        int col = getIntent().getIntExtra(EXTRA_COLUMNA, 0);
        switch (accion) {
            case ACCION_COLUMNA:      // columna nueva en la posicion "col"
                grupo = g;
                ancla = col - 1;
                abajo = false;
                break;
            case ACCION_ABAJO:        // otro estante debajo de la columna "col"
                grupo = g;
                ancla = col;
                abajo = true;
                break;
            case ACCION_REHACER:
                grupo = g;
                rehacerColumna = col;
                rehacerEstante = getIntent().getIntExtra(EXTRA_ESTANTE, 0);
                break;
            default:
                grupo = g;
                abajo = getPreferences(MODE_PRIVATE).getBoolean(PREF_ABAJO, false);
        }
        if (grupo == null) {
            // Empezando o siguiendo el recorrido: se elige el grupo a mano.
            ponerGrupo(getPreferences(MODE_PRIVATE).getString(PREF_GRUPO, Sesiones.GRUPOS[0]));
            aviso.post(this::elegirGrupo);
        } else if (ACCION_SEGUIR.equals(accion)) {
            ponerGrupo(grupo);
        } else {
            pintar();
        }
        aviso.postDelayed(() -> aviso.animate().alpha(0f).setDuration(400), 5000);
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
    // Grupo y lugar de la proxima foto
    // ------------------------------------------------------------------

    private void armarBotonesDeGrupo() {
        for (String g : Sesiones.GRUPOS) {
            TextView t = new TextView(this);
            t.setText(g);
            t.setTag(g);
            t.setGravity(Gravity.CENTER);
            t.setTextSize(15);
            t.setTypeface(getResources().getFont(R.font.mono_bold));
            t.setBackgroundResource(R.drawable.fondo_chip_cam);
            t.setOnClickListener(v -> {
                if (ACCION_REHACER.equals(accion)) {
                    Toast.makeText(this, "Estás rehaciendo una foto de " + grupo, Toast.LENGTH_SHORT).show();
                    return;
                }
                ponerGrupo(g);
            });
            grupos.addView(t, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f));
        }
    }

    private void elegirGrupo() {
        String[] opciones = new String[Sesiones.GRUPOS.length];
        int actual = 0;
        for (int i = 0; i < opciones.length; i++) {
            String g = Sesiones.GRUPOS[i];
            int n = sesion.columnas(g).size();
            opciones[i] = g + " · " + Sesiones.nombreGrupo(g) + (n > 0 ? "  (" + n + (n == 1 ? " columna)" : " columnas)") : "");
            if (g.equals(grupo)) actual = i;
        }
        new MaterialAlertDialogBuilder(new ContextThemeWrapper(this, R.style.Tema_LocatorPic))
                .setTitle("¿Qué grupo vas a fotografiar?")
                .setSingleChoiceItems(opciones, actual, (d, cual) -> {
                    ponerGrupo(Sesiones.GRUPOS[cual]);
                    d.dismiss();
                })
                .setPositiveButton("Listo", null)
                .show();
    }

    /** Cambia de grupo: la proxima foto sigue despues de su ultima columna. */
    private void ponerGrupo(String g) {
        grupo = g;
        getPreferences(MODE_PRIVATE).edit().putString(PREF_GRUPO, g).apply();
        ancla = sesion.columnas(g).size() - 1;
        ultimaFoto = null;
        deshacer.setVisibility(View.GONE);
        pintar();
    }

    private void cambiarDireccion(boolean haciaAbajo) {
        if (ACCION_REHACER.equals(accion) || haciaAbajo == abajo) return;
        if (haciaAbajo && ancla < 0) {
            Toast.makeText(this, "Primero sacá una columna", Toast.LENGTH_SHORT).show();
            return;
        }
        abajo = haciaAbajo;
        getPreferences(MODE_PRIVATE).edit().putBoolean(PREF_ABAJO, abajo).apply();
        pintar();
    }

    private boolean rehaciendo() {
        return ACCION_REHACER.equals(accion);
    }

    /** Columna (desde 0) donde cae la proxima foto. */
    private int columnaObjetivo() {
        if (rehaciendo()) return rehacerColumna;
        return abajo && ancla >= 0 ? ancla : ancla + 1;
    }

    /** Estante (desde 0) donde cae la proxima foto. */
    private int estanteObjetivo() {
        if (rehaciendo()) return rehacerEstante;
        return abajo && ancla >= 0 ? sesion.columnas(grupo).get(ancla).size() : 0;
    }

    private boolean columnaNueva() {
        return !rehaciendo() && !(abajo && ancla >= 0);
    }

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

    /** Conecta el visor y la captura a la camara trasera, en 4:3 y unos 8 MP. */
    private void vincular() {
        if (proveedor == null) return;
        proveedor.unbindAll();

        CameraSelector selector = CameraSelector.DEFAULT_BACK_CAMERA;
        if (hdrActivo && hdrDisponible && extensiones != null) {
            selector = extensiones.getExtensionEnabledCameraSelector(selector, ExtensionMode.HDR);
        }
        int rotacionPantalla = visor.getDisplay() != null ? visor.getDisplay().getRotation() : Surface.ROTATION_0;

        ResolutionSelector paraFoto = new ResolutionSelector.Builder()
                .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
                .setResolutionStrategy(new ResolutionStrategy(RESOLUCION, ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER))
                .build();
        ResolutionSelector paraVisor = new ResolutionSelector.Builder()
                .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
                .build();

        Preview preview = new Preview.Builder().setResolutionSelector(paraVisor).setTargetRotation(rotacionPantalla).build();
        preview.setSurfaceProvider(visor.getSurfaceProvider());
        captura = new ImageCapture.Builder()
                .setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
                .setJpegQuality(CALIDAD)
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
        if (captura == null || tomando || grupo == null) return;
        tomando = true;
        disparar.setEnabled(false);
        vibrar();
        destello.setAlpha(0.85f);
        destello.animate().alpha(0f).setDuration(260).start();
        boolean derecho = nivel.estaDerecho();

        File tmp = new File(getCacheDir(), "captura-" + System.currentTimeMillis() + ".jpg");
        ImageCapture.OutputFileOptions op = new ImageCapture.OutputFileOptions.Builder(tmp).build();
        captura.takePicture(op, principal, new ImageCapture.OnImageSavedCallback() {
            @Override
            public void onImageSaved(@NonNull ImageCapture.OutputFileResults r) {
                revisar(tmp, derecho);
            }

            @Override
            public void onError(@NonNull ImageCaptureException e) {
                listoParaOtra();
                tmp.delete();
                Toast.makeText(CamaraActivity.this, "No se pudo sacar la foto: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        });
    }

    /** Si la foto salio nitida, con luz y derecha, se guarda sola; si no, a revision. */
    private void revisar(File tmp, boolean derecho) {
        hilo.execute(() -> {
            Bitmap bmp = Imagenes.cargar(tmp, 1200);
            float[] q = bmp != null ? Imagenes.calidad(bmp) : new float[]{0, 0};
            if (bmp != null) bmp.recycle();
            boolean bien = derecho && q[0] >= RevisionActivity.NITIDEZ_MINIMA && q[1] >= RevisionActivity.BRILLO_MINIMO;
            runOnUiThread(() -> {
                if (bien) {
                    guardar(tmp);
                    return;
                }
                enRevision = tmp;
                Intent i = new Intent(this, RevisionActivity.class);
                i.putExtra(RevisionActivity.EXTRA_ARCHIVO, tmp.getAbsolutePath());
                i.putExtra(RevisionActivity.EXTRA_DERECHO, derecho);
                i.putExtra(RevisionActivity.EXTRA_TITULO, textoLugar(columnaObjetivo(), estanteObjetivo()));
                revision.launch(i);
            });
        });
    }

    private void guardar(File tmp) {
        String g = grupo;
        int col = columnaObjetivo(), est = estanteObjetivo();
        boolean nueva = columnaNueva(), reemplazar = rehaciendo();
        hilo.execute(() -> {
            try {
                Sesiones.Foto f = repo.agregar(sesion, g, col, est, nueva, reemplazar, tmp);
                runOnUiThread(() -> {
                    listoParaOtra();
                    int[] lugar = sesion.lugarDe(f.id);
                    String texto = lugar != null ? textoLugar(lugar[0], lugar[1]) : g;
                    if (reemplazar) {
                        Toast.makeText(this, texto + ": foto cambiada", Toast.LENGTH_SHORT).show();
                        finish();
                        return;
                    }
                    anclaAntes = ancla;
                    if (lugar != null) ancla = lugar[0];
                    ultimaFoto = f.id;
                    pintar();
                    mostrarDeshacer(texto + " guardada");
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    listoParaOtra();
                    Toast.makeText(this, "No se pudo guardar la foto: " + e.getMessage(), Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private void deshacerFoto() {
        if (ultimaFoto == null) return;
        String foto = ultimaFoto;
        ultimaFoto = null;
        deshacer.removeCallbacks(ocultarDeshacer);
        deshacer.setVisibility(View.GONE);
        hilo.execute(() -> {
            repo.quitarFoto(sesion, foto);
            runOnUiThread(() -> {
                ancla = Math.min(anclaAntes, sesion.columnas(grupo).size() - 1);
                pintar();
                Toast.makeText(this, "Foto descartada: sacala de nuevo", Toast.LENGTH_SHORT).show();
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

    private void listoParaOtra() {
        tomando = false;
        disparar.setEnabled(true);
    }

    // ------------------------------------------------------------------
    // Pantalla
    // ------------------------------------------------------------------

    /** "FL · Columna 3 · estante 2" (columna y estante desde 0). */
    private String textoLugar(int col, int est) {
        String t = grupo + " · Columna " + (col + 1);
        boolean variosEstantes = est > 0 || (col < sesion.columnas(grupo).size() && sesion.columnas(grupo).get(col).size() > 1);
        return variosEstantes ? t + " · estante " + (est + 1) : t;
    }

    private void pintar() {
        if (grupo == null) return;
        int col = columnaObjetivo(), est = estanteObjetivo();
        int hay = sesion.columnas(grupo).size();
        columna.setText(grupo + " " + (col + 1));

        String sub;
        if (rehaciendo()) sub = "Rehaciendo" + (est > 0 || sesion.columnas(grupo).get(col).size() > 1 ? " el estante " + (est + 1) : " la foto");
        else if (!columnaNueva()) sub = "Estante " + (est + 1) + " (debajo del " + est + ")";
        else if (col < hay) sub = "Columna nueva: se inserta antes de la " + (col + 1);
        else sub = "Columna nueva";
        int antes = guia.columnas(grupo);
        if (antes > 0 && !rehaciendo()) sub += "\nVez anterior: " + antes + (antes == 1 ? " columna" : " columnas");
        subColumna.setText(sub);

        for (int i = 0; i < grupos.getChildCount(); i++) {
            TextView t = (TextView) grupos.getChildAt(i);
            boolean activo = grupo.equals(t.getTag());
            t.setBackgroundTintList(ColorStateList.valueOf(activo ? getColor(R.color.acento) : 0x00000000));
            t.setTextColor(activo ? 0xFFFFFFFF : getColor(R.color.cam_texto_2));
        }
        direccion.setVisibility(rehaciendo() ? View.GONE : View.VISIBLE);
        pintarSegmento(dirDerecha, !abajo || ancla < 0);
        pintarSegmento(dirAbajo, abajo && ancla >= 0);
        dirAbajo.setAlpha(ancla >= 0 ? 1f : 0.45f);
        aviso.setText(columnaNueva()
                ? "Encuadrá la columna entera, de ancho completo"
                : "Seguí hacia abajo: encastrá con la franja de la foto de arriba");
        pintarSolape();
        pintarGuia();
    }

    private void pintarSegmento(TextView t, boolean activo) {
        t.setBackgroundTintList(ColorStateList.valueOf(activo ? getColor(R.color.acento) : 0x00000000));
        t.setTextColor(activo ? 0xFFFFFFFF : getColor(R.color.cam_texto_2));
    }

    /** Al bajar un estante: el 25% de abajo de la foto de arriba, arriba del visor. */
    private void pintarSolape() {
        String fotoId = columnaNueva() ? null : sesion.fotoEn(grupo, columnaObjetivo(), estanteObjetivo() - 1);
        if (fotoId == null) {
            solape.setTag(null);
            solape.setImageDrawable(null);
            solape.setVisibility(View.GONE);
            return;
        }
        if (fotoId.equals(solape.getTag())) return;   // ya esta dibujada
        solape.setTag(fotoId);
        File archivo = repo.archivoFoto(sesion, fotoId);
        hilo.execute(() -> {
            Bitmap bmp = Imagenes.cargar(archivo, 1000);
            if (bmp == null) return;
            int w = bmp.getWidth(), h = bmp.getHeight();
            int alto = Math.round(h * SOLAPE);
            Bitmap franja = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            new Canvas(franja).drawBitmap(bmp, new Rect(0, h - alto, w, h), new Rect(0, 0, w, alto), null);
            bmp.recycle();
            runOnUiThread(() -> {
                if (!fotoId.equals(solape.getTag())) return;
                solape.setImageBitmap(franja);
                solape.setVisibility(View.VISIBLE);
            });
        });
    }

    private void pintarGuia() {
        int col = columnaObjetivo(), est = estanteObjetivo();
        File f = guia.miniatura(grupo, col, est);
        Bitmap bmp = f != null ? BitmapFactory.decodeFile(f.getAbsolutePath()) : null;
        if (bmp != null) {
            guiaImg.setImageBitmap(bmp);
            piel.setImageBitmap(bmp);
            guiaTxt.setText("Antes: " + grupo + " " + (col + 1) + (guia.estantes(grupo, col) > 1 ? "·" + (est + 1) : ""));
            guiaPanel.setAlpha(1f);
        } else {
            guiaImg.setImageDrawable(null);
            piel.setImageDrawable(null);
            piel.setVisibility(View.GONE);
            guiaBorde.setVisibility(View.GONE);
            guiaTxt.setText(guia.columnas(grupo) > 0 && col >= guia.columnas(grupo) ? "Nueva" : "Sin guía");
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
        int total = sesion.todasLasFotos().size();
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
            FocusMeteringAction accionFoco = new FocusMeteringAction.Builder(punto,
                    FocusMeteringAction.FLAG_AF | FocusMeteringAction.FLAG_AE)
                    .setAutoCancelDuration(4, TimeUnit.SECONDS).build();
            camara.getCameraControl().startFocusAndMetering(accionFoco);
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
