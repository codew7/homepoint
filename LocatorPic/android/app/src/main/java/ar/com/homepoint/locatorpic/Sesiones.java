package ar.com.homepoint.locatorpic;

import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.database.DataSnapshot;
import com.google.firebase.database.DatabaseError;
import com.google.firebase.database.DatabaseReference;
import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.database.ServerValue;
import com.google.firebase.database.ValueEventListener;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Recorridos ("sesiones") y sus fotos.
 *
 * Cada sesion vive en el equipo (carpeta propia con sesion.json y las fotos)
 * y se refleja en Firebase en locatorpic/sesiones/{id}. El ORDEN de la lista
 * "zonas" es la ubicacion: la primera foto es la zona 1, la segunda la zona 2...
 * Cada foto tiene un id propio, asi que rehacer, insertar o borrar una zona
 * solo reordena la lista, sin renombrar archivos.
 *
 * Estados: en_curso -> lista (finalizada en el equipo) -> descargada (la bajo
 * la PC) -> procesada (la PC guardo las ubicaciones) -> archivada.
 */
public final class Sesiones {

    public static final String RAIZ = "locatorpic";
    public static final int LADO_MINIATURA = 480;

    public static final class Foto {
        public String id;
        public long tomada;
        public int ancho, alto;
        public long bytes;
        public boolean subida;
        public String error;
    }

    public static final class Sesion {
        public String id;
        public long creada;
        public String estado = "en_curso";
        public final List<String> zonas = new ArrayList<>();
        public final Map<String, Foto> fotos = new HashMap<>();

        public int pendientes() {
            int n = 0;
            for (String id : zonas) {
                Foto f = fotos.get(id);
                if (f != null && !f.subida) n++;
            }
            return n;
        }

        public int conError() {
            int n = 0;
            for (String id : zonas) {
                Foto f = fotos.get(id);
                if (f != null && !f.subida && f.error != null) n++;
            }
            return n;
        }

        public Foto fotoDeZona(int posicion) {
            return (posicion >= 0 && posicion < zonas.size()) ? fotos.get(zonas.get(posicion)) : null;
        }
    }

    /** Lo que el SubidaWorker tiene que subir. */
    public static final class Pendiente {
        public final String sesionId, fotoId;
        public final File foto, miniatura;

        Pendiente(String sesionId, String fotoId, File foto, File miniatura) {
            this.sesionId = sesionId;
            this.fotoId = fotoId;
            this.foto = foto;
            this.miniatura = miniatura;
        }
    }

    public interface Oyente {
        void alCambiar();
    }

    private static Sesiones instancia;

    public static synchronized Sesiones get(Context c) {
        if (instancia == null) instancia = new Sesiones(c.getApplicationContext());
        return instancia;
    }

    private final Context ctx;
    private final File base;
    private final Map<String, Sesion> sesiones = new LinkedHashMap<>();
    private final List<Oyente> oyentes = new CopyOnWriteArrayList<>();
    private final Handler principal = new Handler(Looper.getMainLooper());
    private final SecureRandom azar = new SecureRandom();

    private Sesiones(Context ctx) {
        this.ctx = ctx;
        this.base = new File(ctx.getFilesDir(), "sesiones");
        if (!base.exists()) base.mkdirs();
        File[] dirs = base.listFiles(File::isDirectory);
        if (dirs != null) {
            for (File d : dirs) {
                Sesion s = leer(new File(d, "sesion.json"));
                if (s != null) sesiones.put(s.id, s);
            }
        }
    }

    // ------------------------------------------------------------------
    // Consultas
    // ------------------------------------------------------------------

    /** El recorrido que se esta haciendo, o null. */
    public synchronized Sesion enCurso() {
        Sesion ultima = null;
        for (Sesion s : sesiones.values()) {
            if ("en_curso".equals(s.estado) && (ultima == null || s.creada > ultima.creada)) ultima = s;
        }
        return ultima;
    }

    public synchronized Sesion porId(String id) {
        return sesiones.get(id);
    }

    /** Fotos confirmadas que todavia no se subieron (de todos los recorridos del equipo). */
    public synchronized List<Pendiente> pendientes() {
        List<Pendiente> lista = new ArrayList<>();
        for (Sesion s : sesiones.values()) {
            for (String id : s.zonas) {
                Foto f = s.fotos.get(id);
                if (f != null && !f.subida) lista.add(new Pendiente(s.id, id, archivoFoto(s, id), archivoMiniatura(s, id)));
            }
        }
        return lista;
    }

    public synchronized int totalPendientes() {
        int n = 0;
        for (Sesion s : sesiones.values()) n += s.pendientes();
        return n;
    }

    public File archivoFoto(Sesion s, String fotoId) {
        return new File(new File(carpeta(s), "fotos"), fotoId + ".jpg");
    }

    public File archivoMiniatura(Sesion s, String fotoId) {
        return new File(new File(carpeta(s), "min"), fotoId + ".jpg");
    }

    public static String rutaStorage(String sesionId, String fotoId) {
        return RAIZ + "/" + sesionId + "/" + fotoId + ".jpg";
    }

    public static String rutaStorageMiniatura(String sesionId, String fotoId) {
        return RAIZ + "/" + sesionId + "/min/" + fotoId + ".jpg";
    }

    // ------------------------------------------------------------------
    // Cambios
    // ------------------------------------------------------------------

    public synchronized Sesion nueva() {
        Sesion s = new Sesion();
        s.id = new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(new Date()) + "-" + aleatorio(4);
        s.creada = System.currentTimeMillis();
        sesiones.put(s.id, s);
        guardar(s);

        Map<String, Object> datos = new HashMap<>();
        datos.put("creada", ServerValue.TIMESTAMP);
        datos.put("usuario", usuario());
        datos.put("dispositivo", Build.MANUFACTURER + " " + Build.MODEL);
        datos.put("estado", s.estado);
        ref(s).updateChildren(datos);
        avisar();
        return s;
    }

    /**
     * Agrega una foto confirmada.
     * posicion: lugar en la lista (0 = zona 1). Si es igual a la cantidad de
     * zonas, va al final. reemplazar=true cambia la foto de esa zona (rehacer).
     */
    public synchronized Foto agregar(Sesion s, File tomada, int posicion, boolean reemplazar) throws IOException {
        Foto f = new Foto();
        f.id = Long.toString(System.currentTimeMillis(), 36) + aleatorio(4);
        f.tomada = System.currentTimeMillis();

        File destino = archivoFoto(s, f.id);
        mover(tomada, destino);
        int[] dim = Imagenes.dimensiones(destino);
        f.ancho = dim[0];
        f.alto = dim[1];
        f.bytes = destino.length();
        Imagenes.miniatura(destino, archivoMiniatura(s, f.id), LADO_MINIATURA);

        String reemplazada = null;
        if (reemplazar && posicion < s.zonas.size()) {
            reemplazada = s.zonas.set(posicion, f.id);
        } else {
            s.zonas.add(Math.min(Math.max(posicion, 0), s.zonas.size()), f.id);
        }
        s.fotos.put(f.id, f);
        if (reemplazada != null) borrarFotoLocal(s, reemplazada);
        guardar(s);

        Map<String, Object> datos = new HashMap<>();
        datos.put("zonas", new ArrayList<>(s.zonas));
        Map<String, Object> meta = new HashMap<>();
        meta.put("tomada", f.tomada);
        meta.put("ancho", f.ancho);
        meta.put("alto", f.alto);
        meta.put("bytes", f.bytes);
        meta.put("ruta", rutaStorage(s.id, f.id));
        meta.put("min", rutaStorageMiniatura(s.id, f.id));
        datos.put("fotos/" + f.id, meta);
        if (reemplazada != null) datos.put("fotos/" + reemplazada, null);
        ref(s).updateChildren(datos);

        avisar();
        SubidaWorker.encolar(ctx);
        return f;
    }

    /** Saca una zona del recorrido; las siguientes se renumeran solas. */
    public synchronized void eliminar(Sesion s, int posicion) {
        if (posicion < 0 || posicion >= s.zonas.size()) return;
        String id = s.zonas.remove(posicion);
        borrarFotoLocal(s, id);
        guardar(s);
        Map<String, Object> datos = new HashMap<>();
        datos.put("zonas", new ArrayList<>(s.zonas));
        datos.put("fotos/" + id, null);
        ref(s).updateChildren(datos);
        avisar();
    }

    public synchronized void marcarSubida(String sesionId, String fotoId) {
        Sesion s = sesiones.get(sesionId);
        Foto f = s != null ? s.fotos.get(fotoId) : null;
        if (f == null) return;
        f.subida = true;
        f.error = null;
        guardar(s);
        ref(s).child("fotos").child(fotoId).child("subida").setValue(ServerValue.TIMESTAMP);
        avisar();
    }

    public synchronized void marcarError(String sesionId, String fotoId, String error) {
        Sesion s = sesiones.get(sesionId);
        Foto f = s != null ? s.fotos.get(fotoId) : null;
        if (f == null) return;
        f.error = error;
        guardar(s);
        avisar();
    }

    /**
     * Cierra el recorrido: queda listo para que la PC lo baje. Tambien pasa a
     * ser la "guia" del proximo recorrido (locatorpic/ultima).
     */
    public synchronized void finalizar(Sesion s) {
        s.estado = "lista";
        guardar(s);
        List<String> zonas = new ArrayList<>(s.zonas);

        Map<String, Object> datos = new HashMap<>();
        datos.put("sesiones/" + s.id + "/estado", "lista");
        datos.put("sesiones/" + s.id + "/finalizada", ServerValue.TIMESTAMP);
        datos.put("sesiones/" + s.id + "/zonas", zonas);
        Map<String, Object> ultima = new HashMap<>();
        ultima.put("sesionId", s.id);
        ultima.put("finalizada", ServerValue.TIMESTAMP);
        ultima.put("zonas", zonas);
        datos.put("ultima", ultima);
        FirebaseDatabase.getInstance().getReference(RAIZ).updateChildren(datos);
        avisar();
    }

    /** Descarta un recorrido en curso que no se quiere terminar (borra todo lo local). */
    public synchronized void descartar(Sesion s) {
        sesiones.remove(s.id);
        borrarCarpeta(carpeta(s));
        ref(s).child("estado").setValue("descartada");
        avisar();
    }

    /**
     * Libera espacio: los recorridos ya bajados por la PC se borran del equipo
     * (las fotos ya estan en la PC y en Storage).
     */
    public void limpiarDescargadas() {
        List<Sesion> listas = new ArrayList<>();
        synchronized (this) {
            for (Sesion s : sesiones.values()) if ("lista".equals(s.estado)) listas.add(s);
        }
        for (Sesion s : listas) {
            ref(s).child("estado").addListenerForSingleValueEvent(new ValueEventListener() {
                @Override
                public void onDataChange(DataSnapshot snap) {
                    String estado = snap.getValue(String.class);
                    if ("descargada".equals(estado) || "procesada".equals(estado) || "archivada".equals(estado)) {
                        synchronized (Sesiones.this) {
                            sesiones.remove(s.id);
                            borrarCarpeta(carpeta(s));
                        }
                        avisar();
                    }
                }

                @Override
                public void onCancelled(DatabaseError error) { }
            });
        }
    }

    // ------------------------------------------------------------------
    // Oyentes (la pantalla se actualiza cuando cambia algo)
    // ------------------------------------------------------------------

    public void agregarOyente(Oyente o) {
        oyentes.add(o);
    }

    public void quitarOyente(Oyente o) {
        oyentes.remove(o);
    }

    private void avisar() {
        principal.post(() -> {
            for (Oyente o : oyentes) o.alCambiar();
        });
    }

    // ------------------------------------------------------------------
    // Persistencia local
    // ------------------------------------------------------------------

    private File carpeta(Sesion s) {
        return new File(base, s.id);
    }

    private DatabaseReference ref(Sesion s) {
        return FirebaseDatabase.getInstance().getReference(RAIZ).child("sesiones").child(s.id);
    }

    private void guardar(Sesion s) {
        try {
            JSONObject o = new JSONObject();
            o.put("id", s.id);
            o.put("creada", s.creada);
            o.put("estado", s.estado);
            o.put("zonas", new JSONArray(s.zonas));
            JSONObject fotos = new JSONObject();
            for (Foto f : s.fotos.values()) {
                JSONObject j = new JSONObject();
                j.put("tomada", f.tomada);
                j.put("ancho", f.ancho);
                j.put("alto", f.alto);
                j.put("bytes", f.bytes);
                j.put("subida", f.subida);
                if (f.error != null) j.put("error", f.error);
                fotos.put(f.id, j);
            }
            o.put("fotos", fotos);
            File dir = carpeta(s);
            if (!dir.exists()) dir.mkdirs();
            File tmp = new File(dir, "sesion.json.tmp");
            try (OutputStream out = new FileOutputStream(tmp)) {
                out.write(o.toString().getBytes(StandardCharsets.UTF_8));
            }
            File fin = new File(dir, "sesion.json");
            if (!tmp.renameTo(fin)) {
                fin.delete();
                tmp.renameTo(fin);
            }
        } catch (JSONException | IOException e) {
            Log.e("LocatorPic", "No se pudo guardar la sesion " + s.id, e);
        }
    }

    private static Sesion leer(File archivo) {
        if (!archivo.exists()) return null;
        try (InputStream in = new FileInputStream(archivo)) {
            byte[] datos = new byte[(int) archivo.length()];
            int leidos = 0;
            while (leidos < datos.length) {
                int n = in.read(datos, leidos, datos.length - leidos);
                if (n < 0) break;
                leidos += n;
            }
            JSONObject o = new JSONObject(new String(datos, 0, leidos, StandardCharsets.UTF_8));
            Sesion s = new Sesion();
            s.id = o.getString("id");
            s.creada = o.optLong("creada");
            s.estado = o.optString("estado", "en_curso");
            JSONArray zonas = o.optJSONArray("zonas");
            if (zonas != null) for (int i = 0; i < zonas.length(); i++) s.zonas.add(zonas.getString(i));
            JSONObject fotos = o.optJSONObject("fotos");
            if (fotos != null) {
                JSONArray ids = fotos.names();
                if (ids != null) {
                    for (int i = 0; i < ids.length(); i++) {
                        JSONObject j = fotos.getJSONObject(ids.getString(i));
                        Foto f = new Foto();
                        f.id = ids.getString(i);
                        f.tomada = j.optLong("tomada");
                        f.ancho = j.optInt("ancho");
                        f.alto = j.optInt("alto");
                        f.bytes = j.optLong("bytes");
                        f.subida = j.optBoolean("subida");
                        f.error = j.has("error") ? j.optString("error") : null;
                        s.fotos.put(f.id, f);
                    }
                }
            }
            return s;
        } catch (IOException | JSONException e) {
            Log.e("LocatorPic", "Sesion ilegible: " + archivo, e);
            return null;
        }
    }

    private void borrarFotoLocal(Sesion s, String fotoId) {
        s.fotos.remove(fotoId);
        archivoFoto(s, fotoId).delete();
        archivoMiniatura(s, fotoId).delete();
    }

    private static void mover(File origen, File destino) throws IOException {
        File dir = destino.getParentFile();
        if (dir != null && !dir.exists() && !dir.mkdirs()) throw new IOException("No se pudo crear " + dir);
        if (origen.renameTo(destino)) return;
        try (InputStream in = new FileInputStream(origen); OutputStream out = new FileOutputStream(destino)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
        origen.delete();
    }

    private static void borrarCarpeta(File f) {
        File[] hijos = f.listFiles();
        if (hijos != null) for (File h : hijos) borrarCarpeta(h);
        f.delete();
    }

    private String aleatorio(int n) {
        String letras = "abcdefghijkmnpqrstuvwxyz23456789";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) sb.append(letras.charAt(azar.nextInt(letras.length())));
        return sb.toString();
    }

    private static String usuario() {
        FirebaseUser u = FirebaseAuth.getInstance().getCurrentUser();
        return u != null && u.getEmail() != null ? u.getEmail() : "";
    }
}
