package ar.com.homepoint.locatorpic;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.Bundle;
import android.view.HapticFeedbackConstants;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.Surface;
import android.view.View;
import android.view.WindowManager;
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

import com.google.common.util.concurrent.ListenableFuture;

import java.io.File;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;

/**
 * Captura de cada zona con la maxima calidad del equipo.
 *
 * Modos (EXTRA_MODO):
 *   seguir   -> agrega zonas al final, una tras otra (lo normal).
 *   rehacer  -> cambia la foto de la zona EXTRA_POSICION.
 *   insertar -> agrega una zona nueva antes de EXTRA_POSICION.
 */
public class CamaraActivity extends AppCompatActivity {

    public static final String EXTRA_SESION = "sesion";
    public static final String EXTRA_MODO = "modo";
    public static final String EXTRA_POSICION = "posicion";
    public static final String MODO_SEGUIR = "seguir", MODO_REHACER = "rehacer", MODO_INSERTAR = "insertar";

    private static final String PREF_HDR = "hdr";

    private Sesiones repo;
    private Sesiones.Sesion sesion;
    private GuiaAnterior guia;
    private String modo;
    private int posicion;   // 0 = zona 1

    private PreviewView visor;
    private ImageView piel, guiaImg;
    private View foco, destello, guiaBorde, guiaPanel;
    private TextView zona, subZona, txtSubidas, guiaTxt, aviso;
    private ImageButton disparar, linterna, hdr;
    private NivelView nivel;

    private ProcessCameraProvider proveedor;
    private ExtensionsManager extensiones;
    private ImageCapture captura;
    private Camera camara;
    private boolean hdrDisponible, hdrActivo, linternaPrendida, tomando;
    private Executor principal;

    private final Sesiones.Oyente alCambiar = this::pintarSubidas;
    private final GuiaAnterior.Oyente alCambiarGuia = this::pintarZona;

    private final ActivityResultLauncher<Intent> revision =
            registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), r -> {
                tomando = false;
                disparar.setEnabled(true);
                if (r.getResultCode() != RESULT_OK) return;   // "Repetir": misma zona
                if (MODO_SEGUIR.equals(modo)) {
                    posicion = sesion.zonas.size();
                    pintarZona();
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

        visor = findViewById(R.id.visor);
        piel = findViewById(R.id.piel);
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
        configurarEnfoque();

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

    /** Conecta el visor y la captura a la camara trasera, con la maxima resolucion 4:3. */
    private void vincular() {
        if (proveedor == null) return;
        proveedor.unbindAll();

        CameraSelector selector = CameraSelector.DEFAULT_BACK_CAMERA;
        if (hdrActivo && hdrDisponible && extensiones != null) {
            selector = extensiones.getExtensionEnabledCameraSelector(selector, ExtensionMode.HDR);
        }
        int rotacion = visor.getDisplay() != null ? visor.getDisplay().getRotation() : Surface.ROTATION_90;

        ResolutionSelector maxima = new ResolutionSelector.Builder()
                .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
                .setResolutionStrategy(ResolutionStrategy.HIGHEST_AVAILABLE_STRATEGY)
                .build();
        ResolutionSelector paraVisor = new ResolutionSelector.Builder()
                .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
                .build();

        Preview preview = new Preview.Builder().setResolutionSelector(paraVisor).setTargetRotation(rotacion).build();
        preview.setSurfaceProvider(visor.getSurfaceProvider());
        captura = new ImageCapture.Builder()
                .setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
                .setJpegQuality(95)
                .setResolutionSelector(maxima)
                .setTargetRotation(rotacion)
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

        File tmp = new File(getCacheDir(), "captura-" + System.currentTimeMillis() + ".jpg");
        ImageCapture.OutputFileOptions op = new ImageCapture.OutputFileOptions.Builder(tmp).build();
        captura.takePicture(op, principal, new ImageCapture.OnImageSavedCallback() {
            @Override
            public void onImageSaved(@NonNull ImageCapture.OutputFileResults r) {
                Intent i = new Intent(CamaraActivity.this, RevisionActivity.class);
                i.putExtra(RevisionActivity.EXTRA_SESION, sesion.id);
                i.putExtra(RevisionActivity.EXTRA_ARCHIVO, tmp.getAbsolutePath());
                i.putExtra(RevisionActivity.EXTRA_POSICION, posicion);
                i.putExtra(RevisionActivity.EXTRA_REEMPLAZAR, MODO_REHACER.equals(modo));
                i.putExtra(RevisionActivity.EXTRA_DERECHO, nivel.estaDerecho());
                revision.launch(i);
            }

            @Override
            public void onError(@NonNull ImageCaptureException e) {
                tomando = false;
                disparar.setEnabled(true);
                tmp.delete();
                Toast.makeText(CamaraActivity.this, "No se pudo sacar la foto: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        });
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
        linterna.setImageTintList(android.content.res.ColorStateList.valueOf(
                linternaPrendida ? getColor(R.color.acento) : 0xFFFFFFFF));
    }

    // ------------------------------------------------------------------
    // Pantalla
    // ------------------------------------------------------------------

    private void pintarZona() {
        int numero = posicion + 1;
        zona.setText(String.valueOf(numero));
        int anterior = guia.cantidadZonas();
        String sub;
        if (MODO_REHACER.equals(modo)) sub = "Rehaciendo la foto";
        else if (MODO_INSERTAR.equals(modo)) sub = "Zona nueva (se insertan antes de la " + numero + ")";
        else if (anterior > 0) sub = "Vez anterior: " + anterior + " zonas";
        else sub = "Primer recorrido";
        subZona.setText(sub);
        pintarGuia();
    }

    private void pintarGuia() {
        int anterior = guia.cantidadZonas();
        File f = guia.miniatura(posicion + 1);
        Bitmap bmp = f != null ? BitmapFactory.decodeFile(f.getAbsolutePath()) : null;
        if (bmp != null) {
            guiaImg.setImageBitmap(bmp);
            piel.setImageBitmap(bmp);
            guiaTxt.setText("Vez anterior · zona " + (posicion + 1));
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
        int total = sesion.zonas.size();
        int pendientes = sesion.pendientes();
        if (total == 0) txtSubidas.setText("Recorrido nuevo");
        else if (pendientes == 0) txtSubidas.setText(total + (total == 1 ? " foto subida" : " fotos subidas"));
        else txtSubidas.setText("Subidas " + (total - pendientes) + " de " + total);
    }

    private void pintarHdr() {
        hdr.setImageTintList(android.content.res.ColorStateList.valueOf(hdrActivo ? getColor(R.color.acento) : 0xFFFFFFFF));
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
