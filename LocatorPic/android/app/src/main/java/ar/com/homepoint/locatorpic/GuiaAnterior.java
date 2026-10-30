package ar.com.homepoint.locatorpic;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import com.google.firebase.database.DataSnapshot;
import com.google.firebase.database.DatabaseError;
import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.database.ValueEventListener;
import com.google.firebase.storage.FirebaseStorage;

import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * La "foto guia": el recorrido terminado anterior (locatorpic/ultima).
 * Baja sus miniaturas al equipo para mostrar, al sacar FL columna 3, como se
 * saco FL columna 3 la vez anterior. Asi se repite el encuadre y los numeros
 * de columna no se corren de una semana a otra.
 */
public final class GuiaAnterior {

    public interface Oyente {
        void alCambiar();
    }

    private static GuiaAnterior instancia;

    public static synchronized GuiaAnterior get(Context c) {
        if (instancia == null) instancia = new GuiaAnterior(c.getApplicationContext());
        return instancia;
    }

    private final File cache;
    private final List<Oyente> oyentes = new CopyOnWriteArrayList<>();
    private final Handler principal = new Handler(Looper.getMainLooper());
    private final ExecutorService hilo = Executors.newSingleThreadExecutor();

    private volatile String sesionId;
    private volatile long finalizada;
    // grupo -> columnas -> ids de foto (de arriba hacia abajo)
    private volatile Map<String, List<List<String>>> grupos = new HashMap<>();
    private boolean escuchando;

    private GuiaAnterior(Context ctx) {
        cache = new File(ctx.getCacheDir(), "guia");
    }

    /** Empieza a escuchar el ultimo recorrido terminado y baja sus miniaturas. */
    public synchronized void iniciar() {
        if (escuchando || !LocatorPicApp.firebaseListo()) return;
        escuchando = true;
        FirebaseDatabase.getInstance().getReference(Sesiones.RAIZ + "/ultima")
                .addValueEventListener(new ValueEventListener() {
                    @Override
                    public void onDataChange(DataSnapshot snap) {
                        String id = snap.child("sesionId").getValue(String.class);
                        Long fin = snap.child("finalizada").getValue(Long.class);
                        Map<String, List<List<String>>> g = new HashMap<>();
                        List<String> todas = new ArrayList<>();
                        for (String grupo : Sesiones.GRUPOS) {
                            List<List<String>> cols = new ArrayList<>();
                            for (DataSnapshot c : snap.child("grupos").child(grupo).getChildren()) {
                                List<String> col = new ArrayList<>();
                                for (DataSnapshot f : c.getChildren()) {
                                    String v = f.getValue(String.class);
                                    if (v != null) col.add(v);
                                }
                                if (!col.isEmpty()) cols.add(col);
                                todas.addAll(col);
                            }
                            g.put(grupo, cols);
                        }
                        sesionId = id;
                        finalizada = fin != null ? fin : 0;
                        grupos = g;
                        avisar();
                        if (id != null) bajarMiniaturas(id, todas);
                    }

                    @Override
                    public void onCancelled(DatabaseError error) { }
                });
    }

    public String sesionId() {
        return sesionId;
    }

    public long finalizada() {
        return finalizada;
    }

    /** Columnas que tuvo el grupo la vez anterior. */
    public int columnas(String grupo) {
        List<List<String>> c = grupos.get(grupo);
        return c != null ? c.size() : 0;
    }

    public int totalColumnas() {
        int n = 0;
        for (List<List<String>> c : grupos.values()) n += c.size();
        return n;
    }

    /** Fotos (estantes) que tuvo esa columna (desde 0) la vez anterior. */
    public int estantes(String grupo, int columna) {
        List<List<String>> c = grupos.get(grupo);
        return c != null && columna >= 0 && columna < c.size() ? c.get(columna).size() : 0;
    }

    /**
     * Miniatura de ese lugar (columna y estante desde 0) en el recorrido
     * anterior, o null si no hay o todavia no bajo.
     */
    public File miniatura(String grupo, int columna, int estante) {
        List<List<String>> c = grupos.get(grupo);
        String id = sesionId;
        if (id == null || c == null || columna < 0 || columna >= c.size()) return null;
        List<String> col = c.get(columna);
        if (estante < 0 || estante >= col.size()) return null;
        File f = archivo(id, col.get(estante));
        return f.exists() && f.length() > 0 ? f : null;
    }

    public void agregarOyente(Oyente o) {
        oyentes.add(o);
    }

    public void quitarOyente(Oyente o) {
        oyentes.remove(o);
    }

    private File archivo(String sesion, String fotoId) {
        return new File(new File(cache, sesion), fotoId + ".jpg");
    }

    private void bajarMiniaturas(String sesion, List<String> lista) {
        hilo.execute(() -> {
            File dir = new File(cache, sesion);
            if (!dir.exists()) dir.mkdirs();
            // Las guias de recorridos viejos ya no sirven.
            File[] viejas = cache.listFiles();
            if (viejas != null) for (File v : viejas) if (!v.getName().equals(sesion)) borrar(v);

            FirebaseStorage storage = FirebaseStorage.getInstance();
            for (String fotoId : lista) {
                File f = archivo(sesion, fotoId);
                if (f.exists() && f.length() > 0) continue;
                try {
                    com.google.android.gms.tasks.Tasks.await(
                            storage.getReference(Sesiones.rutaStorageMiniatura(sesion, fotoId)).getFile(f),
                            1, java.util.concurrent.TimeUnit.MINUTES);
                    avisar();
                } catch (Exception e) {
                    f.delete();   // sin conexion: se reintenta la proxima vez
                }
            }
        });
    }

    private void avisar() {
        principal.post(() -> {
            for (Oyente o : oyentes) o.alCambiar();
        });
    }

    private static void borrar(File f) {
        File[] hijos = f.listFiles();
        if (hijos != null) for (File h : hijos) borrar(h);
        f.delete();
    }
}
