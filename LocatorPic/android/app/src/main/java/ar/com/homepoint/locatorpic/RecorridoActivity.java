package ar.com.homepoint.locatorpic;

import android.content.Intent;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.LruCache;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Cuadricula del recorrido en curso, un grupo por pestaña (FL, FR, BL, BR,
 * OT). Cada columna va al lado de la otra y sus fotos de arriba hacia abajo.
 *   "+" a la derecha de todo      -> columna nueva al final.
 *   "+" debajo de una columna     -> otro estante en esa columna.
 *   tocar el numero de columna    -> insertar una antes, eliminarla.
 *   tocar una foto                -> rehacerla o eliminarla.
 * Desde aca se finaliza el recorrido.
 */
public class RecorridoActivity extends AppCompatActivity {

    public static final String EXTRA_GRUPO = "grupo";
    private static final String PREF_GRUPO = "grupoGrilla";

    private Sesiones repo;
    private Sesiones.Sesion sesion;
    private GuiaAnterior guia;
    private String grupo;
    private TextView resumen, infoGrupo;
    private LinearLayout pestanias, cuadricula;
    private HorizontalScrollView desplazar;
    private final Sesiones.Oyente alCambiar = this::pintar;

    private final ExecutorService hilo = Executors.newFixedThreadPool(2);
    private final Handler principal = new Handler(Looper.getMainLooper());
    private final LruCache<String, Bitmap> miniaturas = new LruCache<String, Bitmap>(24 * 1024 * 1024) {
        @Override
        protected int sizeOf(String k, Bitmap b) {
            return b.getByteCount();
        }
    };

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        setContentView(R.layout.activity_recorrido);
        repo = Sesiones.get(this);
        guia = GuiaAnterior.get(this);
        resumen = findViewById(R.id.resumen);
        infoGrupo = findViewById(R.id.infoGrupo);
        pestanias = findViewById(R.id.pestanias);
        cuadricula = findViewById(R.id.cuadricula);
        desplazar = findViewById(R.id.desplazar);

        grupo = getIntent().getStringExtra(EXTRA_GRUPO);
        if (grupo == null) grupo = getPreferences(MODE_PRIVATE).getString(PREF_GRUPO, Sesiones.GRUPOS[0]);
        for (String g : Sesiones.GRUPOS) {
            TextView t = new TextView(this);
            t.setTag(g);
            t.setGravity(Gravity.CENTER);
            t.setTextSize(14);
            t.setTypeface(getResources().getFont(R.font.mono_bold));
            t.setBackgroundResource(R.drawable.fondo_foto_celda);
            t.setOnClickListener(v -> {
                grupo = g;
                getPreferences(MODE_PRIVATE).edit().putString(PREF_GRUPO, g).apply();
                pintar();
            });
            pestanias.addView(t, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f));
        }

        findViewById(R.id.atras).setOnClickListener(v -> finish());
        findViewById(R.id.seguir).setOnClickListener(v -> {
            Intent i = camara(CamaraActivity.ACCION_SEGUIR, 0, 0);
            startActivity(i);
            finish();
        });
        findViewById(R.id.finalizar).setOnClickListener(v -> finalizar());
    }

    @Override
    protected void onStart() {
        super.onStart();
        sesion = repo.enCurso();
        if (sesion == null) {
            finish();
            return;
        }
        repo.agregarOyente(alCambiar);
        pintar();
    }

    @Override
    protected void onStop() {
        super.onStop();
        repo.quitarOyente(alCambiar);
    }

    private Intent camara(String accion, int columna, int estante) {
        Intent i = new Intent(this, CamaraActivity.class);
        i.putExtra(CamaraActivity.EXTRA_SESION, sesion.id);
        i.putExtra(CamaraActivity.EXTRA_GRUPO, grupo);
        i.putExtra(CamaraActivity.EXTRA_ACCION, accion);
        i.putExtra(CamaraActivity.EXTRA_COLUMNA, columna);
        i.putExtra(CamaraActivity.EXTRA_ESTANTE, estante);
        return i;
    }

    // ------------------------------------------------------------------
    // Pantalla
    // ------------------------------------------------------------------

    private void pintar() {
        if (sesion == null) return;
        int total = sesion.totalColumnas();
        int pendientes = sesion.pendientes();
        String txt = total + (total == 1 ? " columna" : " columnas");
        txt += pendientes == 0 ? " · todo subido" : " · " + pendientes + " fotos sin subir";
        resumen.setText(txt);

        for (int i = 0; i < pestanias.getChildCount(); i++) {
            TextView t = (TextView) pestanias.getChildAt(i);
            String g = (String) t.getTag();
            int n = sesion.columnas(g).size();
            boolean activa = g.equals(grupo);
            t.setText(n > 0 ? g + " · " + n : g);
            t.setBackgroundTintList(ColorStateList.valueOf(activa ? getColor(R.color.acento) : 0x00000000));
            t.setTextColor(activa ? 0xFFFFFFFF : getColor(n > 0 ? R.color.texto : R.color.apagado));
        }

        List<List<String>> cols = sesion.columnas(grupo);
        String info = grupo + " · " + Sesiones.nombreGrupo(grupo) + " · "
                + (cols.isEmpty() ? "sin fotos" : cols.size() + (cols.size() == 1 ? " columna" : " columnas"));
        int antes = guia.columnas(grupo);
        if (antes > 0) info += " · vez anterior: " + antes;
        infoGrupo.setText(info);

        cuadricula.removeAllViews();
        LayoutInflater inf = LayoutInflater.from(this);
        for (int c = 0; c < cols.size(); c++) {
            final int col = c;
            List<String> fotos = cols.get(c);
            LinearLayout columna = new LinearLayout(this);
            columna.setOrientation(LinearLayout.VERTICAL);
            columna.setPadding(dp(4), 0, dp(4), 0);

            TextView titulo = new TextView(this);
            titulo.setText("C" + (c + 1));
            titulo.setGravity(Gravity.CENTER);
            titulo.setTextSize(15);
            titulo.setTypeface(getResources().getFont(R.font.mono_bold));
            titulo.setTextColor(getColor(R.color.texto));
            titulo.setPadding(0, dp(6), 0, dp(6));
            fondoTocable(titulo);
            titulo.setOnClickListener(v -> opcionesColumna(col));
            columna.addView(titulo, new LinearLayout.LayoutParams(dp(104), LinearLayout.LayoutParams.WRAP_CONTENT));

            for (int e = 0; e < fotos.size(); e++) {
                final int est = e;
                View celda = inf.inflate(R.layout.item_foto, columna, false);
                pintarFoto(celda, fotos.get(e), fotos.size() > 1 ? "E" + (e + 1) : null);
                celda.setOnClickListener(v -> opcionesFoto(col, est));
                columna.addView(celda);
            }
            columna.addView(celdaMas("↓", "Estante", dp(56),
                    v -> startActivity(camara(CamaraActivity.ACCION_ABAJO, col, 0))));
            cuadricula.addView(columna);
        }
        // Columna nueva al final
        LinearLayout nueva = new LinearLayout(this);
        nueva.setOrientation(LinearLayout.VERTICAL);
        nueva.setPadding(dp(4), dp(6) + dp(30), dp(4), 0);
        nueva.addView(celdaMas("→", cols.isEmpty() ? "Primera columna" : "Columna nueva", dp(138),
                v -> startActivity(camara(CamaraActivity.ACCION_COLUMNA, cols.size(), 0))));
        cuadricula.addView(nueva);
    }

    private View celdaMas(String flecha, String texto, int alto, View.OnClickListener alTocar) {
        TextView t = new TextView(this);
        t.setText("+ " + flecha + "\n" + texto);
        t.setGravity(Gravity.CENTER);
        t.setTextSize(12);
        t.setTextColor(getColor(R.color.acento));
        t.setTypeface(t.getTypeface(), android.graphics.Typeface.BOLD);
        t.setBackgroundResource(R.drawable.fondo_celda_mas);
        t.setOnClickListener(alTocar);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(104), alto);
        lp.bottomMargin = dp(6);
        t.setLayoutParams(lp);
        return t;
    }

    private void pintarFoto(View celda, String fotoId, String estante) {
        ImageView miniatura = celda.findViewById(R.id.miniatura);
        ImageView estado = celda.findViewById(R.id.estado);
        TextView est = celda.findViewById(R.id.estante);
        est.setVisibility(estante != null ? View.VISIBLE : View.GONE);
        if (estante != null) est.setText(estante);

        Sesiones.Foto f = sesion.fotos.get(fotoId);
        if (f == null) return;
        if (f.subida) {
            estado.setImageResource(R.drawable.ic_check);
            estado.setBackgroundTintList(ColorStateList.valueOf(getColor(R.color.exito)));
        } else if (f.error != null) {
            estado.setImageResource(R.drawable.ic_alerta);
            estado.setBackgroundTintList(ColorStateList.valueOf(getColor(R.color.alerta)));
        } else {
            estado.setImageResource(R.drawable.ic_reloj);
            estado.setBackgroundTintList(ColorStateList.valueOf(0x99000000));
        }

        miniatura.setTag(fotoId);
        Bitmap enCache = miniaturas.get(fotoId);
        if (enCache != null) {
            miniatura.setImageBitmap(enCache);
            return;
        }
        File archivo = repo.archivoMiniatura(sesion, fotoId);
        hilo.execute(() -> {
            BitmapFactory.Options op = new BitmapFactory.Options();
            op.inSampleSize = 2;
            Bitmap bmp = BitmapFactory.decodeFile(archivo.getAbsolutePath(), op);
            if (bmp == null) return;
            miniaturas.put(fotoId, bmp);
            principal.post(() -> {
                if (fotoId.equals(miniatura.getTag())) miniatura.setImageBitmap(bmp);
            });
        });
    }

    private void fondoTocable(View v) {
        TypedValue tv = new TypedValue();
        getTheme().resolveAttribute(android.R.attr.selectableItemBackground, tv, true);
        v.setBackgroundResource(tv.resourceId);
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    // ------------------------------------------------------------------
    // Opciones
    // ------------------------------------------------------------------

    private void opcionesColumna(int col) {
        List<String> fotos = sesion.columnas(grupo).get(col);
        String[] opciones = {"Insertar una columna antes", "Agregar un estante abajo", "Eliminar la columna"};
        new MaterialAlertDialogBuilder(this)
                .setTitle(grupo + " · Columna " + (col + 1))
                .setItems(opciones, (d, cual) -> {
                    if (cual == 0) startActivity(camara(CamaraActivity.ACCION_COLUMNA, col, 0));
                    else if (cual == 1) startActivity(camara(CamaraActivity.ACCION_ABAJO, col, 0));
                    else new MaterialAlertDialogBuilder(this)
                                .setTitle("Eliminar " + grupo + " · Columna " + (col + 1))
                                .setMessage("Se borra" + (fotos.size() == 1 ? " su foto" : "n sus " + fotos.size() + " fotos")
                                        + ". Las columnas siguientes se renumeran (la " + (col + 2) + " pasa a ser la " + (col + 1) + ").")
                                .setPositiveButton("Eliminar", (d2, w) -> repo.eliminarColumna(sesion, grupo, col))
                                .setNegativeButton("Cancelar", null).show();
                })
                .show();
    }

    private void opcionesFoto(int col, int est) {
        List<String> fotos = sesion.columnas(grupo).get(col);
        String fotoId = fotos.get(est);
        boolean unica = fotos.size() == 1;
        String lugar = grupo + " · Columna " + (col + 1) + (unica ? "" : " · estante " + (est + 1));
        String[] opciones = {"Rehacer esta foto", "Eliminar esta foto"};
        new MaterialAlertDialogBuilder(this)
                .setTitle(lugar)
                .setItems(opciones, (d, cual) -> {
                    if (cual == 0) {
                        startActivity(camara(CamaraActivity.ACCION_REHACER, col, est));
                        return;
                    }
                    new MaterialAlertDialogBuilder(this)
                            .setTitle("Eliminar foto")
                            .setMessage(unica
                                    ? "Es la única foto de la columna: la columna desaparece y las siguientes se renumeran."
                                    : "Las fotos de abajo suben un lugar.")
                            .setPositiveButton("Eliminar", (d2, w) -> repo.quitarFoto(sesion, fotoId))
                            .setNegativeButton("Cancelar", null).show();
                })
                .show();
    }

    private void finalizar() {
        int total = sesion.totalColumnas();
        if (total == 0) {
            new MaterialAlertDialogBuilder(this).setMessage("El recorrido no tiene fotos.").setPositiveButton("Ok", null).show();
            return;
        }
        int pendientes = sesion.pendientes();
        if (pendientes > 0) {
            new MaterialAlertDialogBuilder(this)
                    .setTitle("Faltan subir " + pendientes + (pendientes == 1 ? " foto" : " fotos"))
                    .setMessage("Para finalizar, todas las fotos tienen que estar subidas. Conectate a una red con buena señal (idealmente WiFi) y esperá a que termine.")
                    .setPositiveButton("Reintentar ahora", (d, w) -> SubidaWorker.reintentarAhora(this))
                    .setNegativeButton("Esperar", null).show();
            return;
        }
        StringBuilder detalle = new StringBuilder();
        List<String> distintos = new ArrayList<>();
        boolean hayAnterior = guia.totalColumnas() > 0;
        for (String g : Sesiones.GRUPOS) {
            int n = sesion.columnas(g).size(), antes = guia.columnas(g);
            if (n > 0) detalle.append("\n• ").append(g).append(": ").append(n).append(n == 1 ? " columna" : " columnas");
            if (hayAnterior && n != antes) distintos.add(g + " (" + antes + " → " + n + ")");
        }
        String mensaje = "El recorrido tiene " + total + (total == 1 ? " columna:" : " columnas:") + detalle;
        if (!distintos.isEmpty()) {
            mensaje += "\n\n⚠ Cambió la cantidad de columnas respecto de la vez anterior en " + String.join(", ", distintos)
                    + ". Si sobra o falta una, los números de columna de ese grupo se corren desde ahí. Revisá la cuadrícula antes de finalizar.";
        }
        mensaje += "\n\nDespués, en la PC: doble clic en relevar.bat.";
        new MaterialAlertDialogBuilder(this)
                .setTitle("Finalizar recorrido")
                .setMessage(mensaje)
                .setPositiveButton("Finalizar", (d, w) -> {
                    repo.finalizar(sesion);
                    finish();
                })
                .setNegativeButton("Revisar", null).show();
    }
}
