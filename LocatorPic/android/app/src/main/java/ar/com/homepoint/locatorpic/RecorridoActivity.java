package ar.com.homepoint.locatorpic;

import android.content.Intent;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.LruCache;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.recyclerview.widget.GridLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Grilla con las zonas del recorrido en curso: miniatura, numero y estado de
 * subida, agrupadas por sector si hay. Tocando una zona se puede rehacer,
 * insertar otra antes, eliminarla (las demas se renumeran solas) o cambiar el
 * sector desde ahi. Desde aca se finaliza el recorrido.
 */
public class RecorridoActivity extends AppCompatActivity {

    private static final int TIPO_SECTOR = 0, TIPO_ZONA = 1;

    private Sesiones repo;
    private Sesiones.Sesion sesion;
    private GuiaAnterior guia;
    private TextView resumen, vacio;
    private RecyclerView grilla;
    private int columnas;
    private final Adaptador adaptador = new Adaptador();
    private final Sesiones.Oyente alCambiar = this::pintar;

    // Lo que muestra la grilla: un encabezado (String) o una zona (Integer = posicion).
    private final List<Object> elementos = new ArrayList<>();

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
        vacio = findViewById(R.id.vacio);
        grilla = findViewById(R.id.grilla);
        columnas = Math.max(3, getResources().getDisplayMetrics().widthPixels
                / (int) (120 * getResources().getDisplayMetrics().density));
        GridLayoutManager gestor = new GridLayoutManager(this, columnas);
        gestor.setSpanSizeLookup(new GridLayoutManager.SpanSizeLookup() {
            @Override
            public int getSpanSize(int pos) {
                return pos < elementos.size() && elementos.get(pos) instanceof String ? columnas : 1;
            }
        });
        grilla.setLayoutManager(gestor);
        grilla.setAdapter(adaptador);

        findViewById(R.id.atras).setOnClickListener(v -> finish());
        findViewById(R.id.seguir).setOnClickListener(v -> abrirCamara(CamaraActivity.MODO_SEGUIR, 0));
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

    private void pintar() {
        if (sesion == null) return;
        int total = sesion.zonas.size();
        int pendientes = sesion.pendientes();
        String txt = total + (total == 1 ? " zona" : " zonas");
        txt += pendientes == 0 ? " · todo subido" : " · " + pendientes + " sin subir";
        int anterior = guia.cantidadZonas();
        if (anterior > 0) txt += " · vez anterior: " + anterior;
        resumen.setText(txt);
        vacio.setVisibility(total == 0 ? View.VISIBLE : View.GONE);
        grilla.setVisibility(total == 0 ? View.GONE : View.VISIBLE);

        elementos.clear();
        for (int i = 0; i < total; i++) {
            String nombre = sesion.sectores.get(sesion.zonas.get(i));
            if (nombre != null) {
                int hasta = i;
                while (hasta + 1 < total && !sesion.sectores.containsKey(sesion.zonas.get(hasta + 1))) hasta++;
                elementos.add(nombre + "  ·  " + (hasta > i ? "zonas " + (i + 1) + "–" + (hasta + 1) : "zona " + (i + 1)));
            }
            elementos.add(i);
        }
        adaptador.notifyDataSetChanged();
    }

    private void abrirCamara(String modo, int posicion) {
        Intent i = new Intent(this, CamaraActivity.class);
        i.putExtra(CamaraActivity.EXTRA_SESION, sesion.id);
        i.putExtra(CamaraActivity.EXTRA_MODO, modo);
        i.putExtra(CamaraActivity.EXTRA_POSICION, posicion);
        startActivity(i);
        if (CamaraActivity.MODO_SEGUIR.equals(modo)) finish();
    }

    private void opcionesZona(int posicion) {
        boolean conTomas = sesion.barridoDeZona(posicion) != null;
        String[] opciones = {conTomas ? "Rehacer las tomas" : "Rehacer la foto", "Insertar una zona antes",
                "Cambiar sector desde acá", "Eliminar esta zona"};
        new MaterialAlertDialogBuilder(this)
                .setTitle("Zona " + (posicion + 1))
                .setItems(opciones, (d, cual) -> {
                    if (cual == 0) abrirCamara(CamaraActivity.MODO_REHACER, posicion);
                    else if (cual == 1) abrirCamara(CamaraActivity.MODO_INSERTAR, posicion);
                    else if (cual == 2) cambiarSector(posicion);
                    else new MaterialAlertDialogBuilder(this)
                                .setTitle("Eliminar zona " + (posicion + 1))
                                .setMessage("Las zonas siguientes se renumeran (la " + (posicion + 2) + " pasa a ser la " + (posicion + 1) + ")."
                                        + (conTomas ? " Se borran todas sus tomas." : ""))
                                .setPositiveButton("Eliminar", (d2, w) -> repo.eliminar(sesion, posicion))
                                .setNegativeButton("Cancelar", null).show();
                })
                .show();
    }

    /** Elegir (o quitar) el sector que empieza en esta zona. */
    private void cambiarSector(int posicion) {
        String zonaId = sesion.zonas.get(posicion);
        boolean marcada = sesion.sectores.containsKey(zonaId);
        List<String> nombres = new ArrayList<>(sesion.nombresSectores());
        for (String n : guia.nombresSectores()) if (!nombres.contains(n)) nombres.add(n);
        List<String> opciones = new ArrayList<>(nombres);
        opciones.add("Nombre nuevo…");
        if (marcada) opciones.add("Quitar el sector que empieza acá");
        new MaterialAlertDialogBuilder(this)
                .setTitle("Sector desde la zona " + (posicion + 1))
                .setItems(opciones.toArray(new String[0]), (d, cual) -> {
                    if (cual < nombres.size()) repo.ponerSector(sesion, zonaId, nombres.get(cual));
                    else if (cual == nombres.size()) pedirNombre(zonaId);
                    else repo.ponerSector(sesion, zonaId, null);
                })
                .setNegativeButton("Cancelar", null)
                .show();
    }

    private void pedirNombre(String zonaId) {
        EditText campo = new EditText(this);
        campo.setHint("Ej.: Adelante izquierda");
        campo.setSingleLine(true);
        FrameLayout marco = new FrameLayout(this);
        int m = Math.round(20 * getResources().getDisplayMetrics().density);
        marco.setPadding(m, m / 2, m, 0);
        marco.addView(campo);
        new MaterialAlertDialogBuilder(this)
                .setTitle("Nombre del sector")
                .setView(marco)
                .setPositiveButton("Aplicar", (d, w) -> {
                    String n = campo.getText().toString().trim();
                    if (!n.isEmpty()) repo.ponerSector(sesion, zonaId, n);
                })
                .setNegativeButton("Cancelar", null)
                .show();
    }

    private void finalizar() {
        int total = sesion.zonas.size();
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
        int anterior = guia.cantidadZonas();
        String mensaje = "El recorrido tiene " + total + " zonas.";
        if (anterior > 0 && anterior != total) {
            int dif = total - anterior;
            mensaje += "\n\n⚠ La vez anterior fueron " + anterior + " (" + (dif > 0 ? dif + " más" : -dif + " menos")
                    + "). Si sobra o falta una foto, los números de zona se corren desde ahí. Revisá la grilla antes de finalizar.";
        } else if (anterior > 0) {
            mensaje += " Igual que la vez anterior.";
        }
        List<String> sectores = sesion.nombresSectores();
        if (!sectores.isEmpty()) mensaje += "\n\nSectores: " + String.join(", ", sectores) + ".";
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

    // ------------------------------------------------------------------

    private class Adaptador extends RecyclerView.Adapter<RecyclerView.ViewHolder> {
        @Override
        public int getItemViewType(int pos) {
            return elementos.get(pos) instanceof String ? TIPO_SECTOR : TIPO_ZONA;
        }

        @NonNull
        @Override
        public RecyclerView.ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int tipo) {
            LayoutInflater inf = LayoutInflater.from(parent.getContext());
            if (tipo == TIPO_SECTOR) {
                return new RecyclerView.ViewHolder(inf.inflate(R.layout.item_sector, parent, false)) { };
            }
            return new Celda(inf.inflate(R.layout.item_zona, parent, false));
        }

        @Override
        public void onBindViewHolder(@NonNull RecyclerView.ViewHolder h, int i) {
            Object e = elementos.get(i);
            if (e instanceof String) {
                ((TextView) h.itemView).setText((String) e);
                return;
            }
            Celda c = (Celda) h;
            int pos = (Integer) e;
            Sesiones.Foto f = sesion.fotoDeZona(pos);
            Sesiones.Barrido b = sesion.barridoDeZona(pos);
            c.numero.setText(String.valueOf(pos + 1));
            c.itemView.setOnClickListener(v -> opcionesZona(pos));
            if (b != null) {
                c.tomas.setText(b.estantes.size() + " est. · " + b.tomas() + " tomas");
                c.tomas.setVisibility(View.VISIBLE);
            } else {
                c.tomas.setVisibility(View.GONE);
            }
            if (f == null) return;

            // Estado de la zona: subida si subieron todas sus fotos.
            boolean subida = true, error = false;
            for (String id : sesion.fotosDe(sesion.zonas.get(pos))) {
                Sesiones.Foto x = sesion.fotos.get(id);
                if (x == null) continue;
                subida &= x.subida;
                error |= !x.subida && x.error != null;
            }
            if (subida) {
                c.estado.setImageResource(R.drawable.ic_check);
                c.estado.setBackgroundTintList(ColorStateList.valueOf(getColor(R.color.exito)));
            } else if (error) {
                c.estado.setImageResource(R.drawable.ic_alerta);
                c.estado.setBackgroundTintList(ColorStateList.valueOf(getColor(R.color.alerta)));
            } else {
                c.estado.setImageResource(R.drawable.ic_reloj);
                c.estado.setBackgroundTintList(ColorStateList.valueOf(0x99000000));
            }

            File archivo = repo.archivoMiniatura(sesion, f.id);
            c.miniatura.setTag(f.id);
            Bitmap enCache = miniaturas.get(f.id);
            if (enCache != null) {
                c.miniatura.setImageBitmap(enCache);
                return;
            }
            c.miniatura.setImageDrawable(null);
            hilo.execute(() -> {
                BitmapFactory.Options op = new BitmapFactory.Options();
                op.inSampleSize = 2;
                Bitmap bmp = BitmapFactory.decodeFile(archivo.getAbsolutePath(), op);
                if (bmp == null) return;
                miniaturas.put(f.id, bmp);
                principal.post(() -> {
                    if (f.id.equals(c.miniatura.getTag())) c.miniatura.setImageBitmap(bmp);
                });
            });
        }

        @Override
        public int getItemCount() {
            return sesion != null ? elementos.size() : 0;
        }
    }

    private static class Celda extends RecyclerView.ViewHolder {
        final ImageView miniatura, estado;
        final TextView numero, tomas;

        Celda(View v) {
            super(v);
            miniatura = v.findViewById(R.id.miniatura);
            estado = v.findViewById(R.id.estado);
            numero = v.findViewById(R.id.numero);
            tomas = v.findViewById(R.id.tomas);
        }
    }
}
