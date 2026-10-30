package ar.com.homepoint.locatorpic;

import android.annotation.SuppressLint;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Revision de la foto antes de confirmarla: se ve entera, con zoom, y avisa si
 * parece borrosa, oscura o torcida. "Confirmar" la guarda y la pone en cola
 * para subir; "Repetir" la descarta y vuelve a la camara en la misma zona.
 *
 * Con EXTRA_SOLO_REVISAR (tomas cercanas) no guarda nada: "Confirmar" solo
 * devuelve OK y la camara guarda la toma con su estante y orientacion.
 */
public class RevisionActivity extends AppCompatActivity {

    public static final String EXTRA_SESION = "sesion";
    public static final String EXTRA_ARCHIVO = "archivo";
    public static final String EXTRA_POSICION = "posicion";
    public static final String EXTRA_REEMPLAZAR = "reemplazar";
    public static final String EXTRA_DERECHO = "derecho";
    public static final String EXTRA_SOLO_REVISAR = "soloRevisar";
    public static final String EXTRA_TITULO = "titulo";

    // Umbrales del control de calidad (sobre la foto achicada a 400 px).
    // Los usa tambien la camara para confirmar sola las tomas cercanas.
    public static final float NITIDEZ_MINIMA = 45f;
    public static final float BRILLO_MINIMO = 55f;

    private final ExecutorService hilo = Executors.newSingleThreadExecutor();
    private final Handler principal = new Handler(Looper.getMainLooper());

    private File archivo;
    private Sesiones.Sesion sesion;
    private int posicion;
    private boolean reemplazar, guardado, soloRevisar;

    @SuppressLint("ClickableViewAccessibility")
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        setContentView(R.layout.activity_revision);
        pantallaCompleta();

        sesion = Sesiones.get(this).porId(getIntent().getStringExtra(EXTRA_SESION));
        archivo = new File(getIntent().getStringExtra(EXTRA_ARCHIVO));
        posicion = getIntent().getIntExtra(EXTRA_POSICION, 0);
        reemplazar = getIntent().getBooleanExtra(EXTRA_REEMPLAZAR, false);
        boolean derecho = getIntent().getBooleanExtra(EXTRA_DERECHO, true);
        soloRevisar = getIntent().getBooleanExtra(EXTRA_SOLO_REVISAR, false);
        if (sesion == null || !archivo.exists()) {
            finish();
            return;
        }

        ZoomImageView foto = findViewById(R.id.foto);
        View linea = findViewById(R.id.linea);
        TextView titulo = findViewById(R.id.titulo);
        TextView info = findViewById(R.id.info);
        View aviso = findViewById(R.id.avisoCalidad);
        TextView avisoTxt = findViewById(R.id.avisoTxt);

        String tituloExtra = getIntent().getStringExtra(EXTRA_TITULO);
        titulo.setText(tituloExtra != null ? tituloExtra : "Zona " + (posicion + 1) + (reemplazar ? " · rehacer" : ""));
        int[] dim = Imagenes.dimensiones(archivo);
        info.setText(String.format(Locale.US, "%d × %d · %.1f MP · %.1f MB",
                dim[0], dim[1], dim[0] * dim[1] / 1e6, archivo.length() / 1048576.0));

        foto.setOnTouchListener((v, e) -> {
            linea.setVisibility(View.GONE);
            return false;
        });

        hilo.execute(() -> {
            int lado = Math.max(getResources().getDisplayMetrics().widthPixels,
                    getResources().getDisplayMetrics().heightPixels) * 2;
            Bitmap bmp = Imagenes.cargar(archivo, lado);
            if (bmp == null) return;
            float[] calidad = Imagenes.calidad(bmp);
            List<String> problemas = new ArrayList<>();
            if (calidad[0] < NITIDEZ_MINIMA) problemas.add("puede estar borrosa o movida");
            if (calidad[1] < BRILLO_MINIMO) problemas.add("está oscura");
            if (!derecho) problemas.add("el equipo estaba torcido");
            principal.post(() -> {
                foto.setImageBitmap(bmp);
                if (!problemas.isEmpty()) {
                    String t = String.join(", ", problemas);
                    avisoTxt.setText("La foto " + t + ". Revisá con zoom que se lean los precios.");
                    aviso.setVisibility(View.VISIBLE);
                }
            });
        });

        findViewById(R.id.repetir).setOnClickListener(v -> {
            archivo.delete();
            setResult(RESULT_CANCELED);
            finish();
        });
        findViewById(R.id.confirmar).setOnClickListener(v -> confirmar());
    }

    private void confirmar() {
        if (soloRevisar) {
            guardado = true;
            setResult(RESULT_OK);
            finish();
            return;
        }
        View guardando = findViewById(R.id.guardando);
        guardando.setVisibility(View.VISIBLE);
        hilo.execute(() -> {
            try {
                Sesiones.get(this).agregar(sesion, archivo, posicion, reemplazar);
                guardado = true;
                principal.post(() -> {
                    setResult(RESULT_OK);
                    finish();
                });
            } catch (Exception e) {
                principal.post(() -> {
                    guardando.setVisibility(View.GONE);
                    Toast.makeText(this, "No se pudo guardar la foto: " + e.getMessage(), Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    @Override
    public void onBackPressed() {
        // Volver sin confirmar = repetir.
        if (!guardado) archivo.delete();
        setResult(RESULT_CANCELED);
        super.onBackPressed();
    }

    private void pantallaCompleta() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.hide(WindowInsetsCompat.Type.systemBars());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
