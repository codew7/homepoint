package ar.com.homepoint.locatorpic;

import android.graphics.Bitmap;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.widget.TextView;

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
 * Revision de una foto que salio dudosa (borrosa, oscura o torcida): se ve
 * entera, con zoom, y dice que le pasa. "Confirmar" devuelve OK y la camara
 * la guarda en su lugar; "Repetir" la descarta.
 */
public class RevisionActivity extends AppCompatActivity {

    public static final String EXTRA_ARCHIVO = "archivo";
    public static final String EXTRA_DERECHO = "derecho";
    public static final String EXTRA_TITULO = "titulo";

    // Umbrales del control de calidad (sobre la foto achicada). Los usa
    // tambien la camara para guardar sola las fotos que salen bien.
    public static final float NITIDEZ_MINIMA = 45f;
    public static final float BRILLO_MINIMO = 55f;

    private final ExecutorService hilo = Executors.newSingleThreadExecutor();
    private final Handler principal = new Handler(Looper.getMainLooper());

    private File archivo;
    private boolean confirmada;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        setContentView(R.layout.activity_revision);
        pantallaCompleta();

        String ruta = getIntent().getStringExtra(EXTRA_ARCHIVO);
        archivo = ruta != null ? new File(ruta) : null;
        boolean derecho = getIntent().getBooleanExtra(EXTRA_DERECHO, true);
        if (archivo == null || !archivo.exists()) {
            finish();
            return;
        }

        ZoomImageView foto = findViewById(R.id.foto);
        TextView titulo = findViewById(R.id.titulo);
        TextView info = findViewById(R.id.info);
        View aviso = findViewById(R.id.avisoCalidad);
        TextView avisoTxt = findViewById(R.id.avisoTxt);

        String t = getIntent().getStringExtra(EXTRA_TITULO);
        titulo.setText(t != null ? t : "Revisar la foto");
        int[] dim = Imagenes.dimensiones(archivo);
        info.setText(String.format(Locale.US, "%d × %d · %.1f MP · %.1f MB",
                dim[0], dim[1], dim[0] * dim[1] / 1e6, archivo.length() / 1048576.0));

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
                    avisoTxt.setText("La foto " + String.join(", ", problemas) + ". Revisá con zoom que se lean los precios.");
                    aviso.setVisibility(View.VISIBLE);
                }
            });
        });

        findViewById(R.id.repetir).setOnClickListener(v -> {
            archivo.delete();
            setResult(RESULT_CANCELED);
            finish();
        });
        findViewById(R.id.confirmar).setOnClickListener(v -> {
            confirmada = true;
            setResult(RESULT_OK);
            finish();
        });
    }

    @Override
    public void onBackPressed() {
        // Volver sin confirmar = repetir.
        if (!confirmada) archivo.delete();
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
