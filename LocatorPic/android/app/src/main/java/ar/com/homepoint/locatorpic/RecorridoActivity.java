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
import android.widget.ImageView;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.recyclerview.widget.GridLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Grilla con las zonas del recorrido en curso: miniatura, numero y estado de
 * subida. Tocando una zona se puede rehacer, insertar otra antes o eliminarla
 * (las demas se renumeran solas). Desde aca se finaliza el recorrido.
 */
public class RecorridoActivity extends AppCompatActivity {

    private Sesiones repo;
    private Sesiones.Sesion sesion;
    private GuiaAnterior guia;
    private TextView resumen, vacio;
    private RecyclerView grilla;
    private final Adaptador adaptador = new Adaptador();
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
        vacio = findViewById(R.id.vacio);
        grilla = findViewById(R.id.grilla);
        int columnas = Math.max(3, getResources().getDisplayMetrics().widthPixels
                / (int) (120 * getResources().getDisplayMetrics().density));
        grilla.setLayoutManager(new GridLayoutManager(this, columnas));
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
        String[] opciones = {"Rehacer la foto", "Insertar una zona antes", "Eliminar esta zona"};
        new MaterialAlertDialogBuilder(this)
                .setTitle("Zona " + (posicion + 1))
                .setItems(opciones, (d, cual) -> {
                    if (cual == 0) abrirCamara(CamaraActivity.MODO_REHACER, posicion);
                    else if (cual == 1) abrirCamara(CamaraActivity.MODO_INSERTAR, posicion);
                    else new MaterialAlertDialogBuilder(this)
                                .setTitle("Eliminar zona " + (posicion + 1))
                                .setMessage("Las zonas siguientes se renumeran (la " + (posicion + 2) + " pasa a ser la " + (posicion + 1) + ").")
                                .setPositiveButton("Eliminar", (d2, w) -> repo.eliminar(sesion, posicion))
                                .setNegativeButton("Cancelar", null).show();
                })
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

    private class Adaptador extends RecyclerView.Adapter<Celda> {
        @NonNull
        @Override
        public Celda onCreateViewHolder(@NonNull ViewGroup parent, int tipo) {
            return new Celda(LayoutInflater.from(parent.getContext()).inflate(R.layout.item_zona, parent, false));
        }

        @Override
        public void onBindViewHolder(@NonNull Celda c, int pos) {
            Sesiones.Foto f = sesion.fotoDeZona(pos);
            c.numero.setText(String.valueOf(pos + 1));
            c.itemView.setOnClickListener(v -> opcionesZona(c.getBindingAdapterPosition()));
            if (f == null) return;

            if (f.subida) {
                c.estado.setImageResource(R.drawable.ic_check);
                c.estado.setBackgroundTintList(ColorStateList.valueOf(getColor(R.color.exito)));
            } else if (f.error != null) {
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
            return sesion != null ? sesion.zonas.size() : 0;
        }
    }

    private static class Celda extends RecyclerView.ViewHolder {
        final ImageView miniatura, estado;
        final TextView numero;

        Celda(View v) {
            super(v);
            miniatura = v.findViewById(R.id.miniatura);
            estado = v.findViewById(R.id.estado);
            numero = v.findViewById(R.id.numero);
        }
    }
}
