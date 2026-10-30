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
 * y se refleja en Firebase en locatorpic/sesiones/{id}.
 *
 * El deposito se divide en GRUPOS fijos (FL, FR, BL, BR, OT). Cada grupo es
 * una cuadricula: cada COLUMNA es una lista de fotos de arriba hacia abajo
 * (los estantes). Una foto puesta a la derecha de otra es una columna nueva;
 * una puesta debajo es otro estante de la misma columna. El numero de
 * columna es su lugar en la lista (1, 2, 3...), asi que insertar o borrar
 * una columna solo reordena la lista, sin renombrar archivos.
 *
 *   grupos/{FL} = [ [fotoId, fotoId], [fotoId], ... ]   (columna 1, columna 2...)
 *
 * Estados: en_curso -> lista (finalizada en el equipo) -> descargada (la bajo
 * la PC) -> procesada (la PC guardo las ubicaciones) -> archivada.
 */
public final class Sesiones {

    public static final String RAIZ = "locatorpic";
    public static final int LADO_MINIATURA = 480;

    /** Grupos del deposito, en el orden en que se recorren. */
    public static final String[] GRUPOS = {"FL", "FR", "BL", "BR", "OT"};

    public static String nombreGrupo(String g) {
        switch (g) {
            case "FL": return "Adelante izquierda";
            case "FR": return "Adelante derecha";
            case "BL": return "Atrás izquierda";
            case "BR": return "Atrás derecha";
            default: return "Otros";
        }
    }

    public static final class Foto {
        public String id;
        public long tomada;
        public int ancho, alto;
        public long bytes;
        public boolean subida;
        public String error;
        public String grupo;
    }

    public static final class Sesion {
        public String id;
        public long creada;
        public String estado = "en_curso";
        public final Map<String, Foto> fotos = new HashMap<>();
        // grupo -> columnas -> ids de foto (de arriba hacia abajo)
        public final Map<String, List<List<String>>> grupos = new HashMap<>();

        /** Columnas del grupo (lista vacia si todavia no tiene). No modificar. */
        public List<List<String>> columnas(String grupo) {
            List<List<String>> c = grupos.get(grupo);
            return c != null ? c : new ArrayList<>();
        }

        public int totalColumnas() {
            int n = 0;
            for (List<List<String>> c : grupos.values()) n += c.size();
            return n;
        }

        /** Todas las fotos, en el orden del recorrido. */
        public List<String> todasLasFotos() {
            List<String> l = new ArrayList<>();
            for (String g : GRUPOS) for (List<String> col : columnas(g)) l.addAll(col);
            return l;
        }

        /** Id de la foto en ese lugar (columna y estante desde 0), o null. */
        public String fotoEn(String grupo, int columna, int estante) {
            List<List<String>> c = columnas(grupo);
            if (columna < 0 || columna >= c.size()) return null;
            List<String> col = c.get(columna);
            return estante >= 0 && estante < col.size() ? col.get(estante) : null;
        }

        /** {columna, estante} (desde 0) de la foto dentro de su grupo, o null. */
        public int[] lugarDe(String fotoId) {
            for (List<List<String>> c : grupos.values()) {
                for (int i = 0; i < c.size(); i++) {
                    int e = c.get(i).indexOf(fotoId);
                    if (e >= 0) return new int[]{i, e};
                }
            }
            return null;
        }

        public int pendientes() {
            int n = 0;
            for (String id : todasLasFotos()) {
                Foto f = fotos.get(id);
                if (f != null && !f.subida) n++;
            }
            return n;
        }

        public int conError() {
            int n = 0;
            for (String id : todasLasFotos()) {
                Foto f = fotos.get(id);
                if (f != null && !f.subida && f.error != null) n++;
            }
            return n;
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
            for (String id : s.todasLasFotos()) {
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
     * Agrega una foto confirmada al grupo.
     *   nuevaColumna=true: crea una columna nueva en la posicion "columna"
     *                      (si es igual a la cantidad, va al final).
     *   reemplazar=true:   cambia la foto de ese lugar (rehacer).
     *   si no:             la agrega en la columna, en la posicion "estante"
     *                      (si es igual a la cantidad, va abajo de todo).
     */
    public synchronized Foto agregar(Sesion s, String grupo, int columna, int estante,
                                     boolean nuevaColumna, boolean reemplazar, File tomada) throws IOException {
        Foto f = nuevaFoto(s, tomada);
        f.grupo = grupo;
        Map<String, Object> datos = new HashMap<>();
        List<List<String>> cols = s.grupos.get(grupo);
        if (cols == null) {
            cols = new ArrayList<>();
            s.grupos.put(grupo, cols);
        }
        if (nuevaColumna || columna >= cols.size()) {
            List<String> col = new ArrayList<>();
            col.add(f.id);
            cols.add(Math.min(Math.max(columna, 0), cols.size()), col);
        } else {
            List<String> col = cols.get(Math.max(columna, 0));
            if (reemplazar && estante >= 0 && estante < col.size()) {
                String vieja = col.set(estante, f.id);
                borrarFotoLocal(s, vieja);
                datos.put("fotos/" + vieja, null);
            } else {
                col.add(Math.min(Math.max(estante, 0), col.size()), f.id);
            }
        }
        s.fotos.put(f.id, f);
        guardar(s);

        datos.put("grupos/" + grupo, copia(cols));
        datos.put("fotos/" + f.id, metaFoto(s, f));
        ref(s).updateChildren(datos);

        avisar();
        SubidaWorker.encolar(ctx);
        return f;
    }

    /** Saca una foto. Si su columna queda vacia, la columna desaparece (las siguientes se renumeran). */
    public synchronized void quitarFoto(Sesion s, String fotoId) {
        Foto f = s.fotos.get(fotoId);
        if (f == null || f.grupo == null) return;
        List<List<String>> cols = s.columnas(f.grupo);
        for (int i = 0; i < cols.size(); i++) {
            if (cols.get(i).remove(fotoId)) {
                if (cols.get(i).isEmpty()) cols.remove(i);
                break;
            }
        }
        borrarFotoLocal(s, fotoId);
        guardar(s);
        Map<String, Object> datos = new HashMap<>();
        datos.put("fotos/" + fotoId, null);
        datos.put("grupos/" + f.grupo, cols.isEmpty() ? null : copia(cols));
        ref(s).updateChildren(datos);
        avisar();
    }

    /** Saca una columna entera con sus fotos; las siguientes se renumeran. */
    public synchronized void eliminarColumna(Sesion s, String grupo, int columna) {
        List<List<String>> cols = s.columnas(grupo);
        if (columna < 0 || columna >= cols.size()) return;
        Map<String, Object> datos = new HashMap<>();
        for (String id : cols.remove(columna)) {
            borrarFotoLocal(s, id);
            datos.put("fotos/" + id, null);
        }
        guardar(s);
        datos.put("grupos/" + grupo, cols.isEmpty() ? null : copia(cols));
        ref(s).updateChildren(datos);
        avisar();
    }

    private Foto nuevaFoto(Sesion s, File tomada) throws IOException {
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
        return f;
    }

    private static Map<String, Object> metaFoto(Sesion s, Foto f) {
        Map<String, Object> meta = new HashMap<>();
        meta.put("tomada", f.tomada);
        meta.put("ancho", f.ancho);
        meta.put("alto", f.alto);
        meta.put("bytes", f.bytes);
        meta.put("ruta", rutaStorage(s.id, f.id));
        meta.put("min", rutaStorageMiniatura(s.id, f.id));
        meta.put("grupo", f.grupo);
        return meta;
    }

    private static List<List<String>> copia(List<List<String>> cols) {
        List<List<String>> l = new ArrayList<>();
        for (List<String> c : cols) l.add(new ArrayList<>(c));
        return l;
    }

    private static Map<String, Object> copiaGrupos(Sesion s) {
        Map<String, Object> m = new HashMap<>();
        for (String g : GRUPOS) {
            List<List<String>> c = s.columnas(g);
            if (!c.isEmpty()) m.put(g, copia(c));
        }
        return m;
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
        Map<String, Object> grupos = copiaGrupos(s);

        Map<String, Object> datos = new HashMap<>();
        datos.put("sesiones/" + s.id + "/estado", "lista");
        datos.put("sesiones/" + s.id + "/finalizada", ServerValue.TIMESTAMP);
        datos.put("sesiones/" + s.id + "/grupos", grupos);
        Map<String, Object> ultima = new HashMap<>();
        ultima.put("sesionId", s.id);
        ultima.put("finalizada", ServerValue.TIMESTAMP);
        ultima.put("grupos", grupos);
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
            JSONObject fotos = new JSONObject();
            for (Foto f : s.fotos.values()) {
                JSONObject j = new JSONObject();
                j.put("tomada", f.tomada);
                j.put("ancho", f.ancho);
                j.put("alto", f.alto);
                j.put("bytes", f.bytes);
                j.put("subida", f.subida);
                if (f.error != null) j.put("error", f.error);
                if (f.grupo != null) j.put("grupo", f.grupo);
                fotos.put(f.id, j);
            }
            o.put("fotos", fotos);
            JSONObject grupos = new JSONObject();
            for (Map.Entry<String, List<List<String>>> e : s.grupos.entrySet()) {
                JSONArray cols = new JSONArray();
                for (List<String> col : e.getValue()) cols.put(new JSONArray(col));
                grupos.put(e.getKey(), cols);
            }
            o.put("grupos", grupos);
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
                        f.grupo = j.has("grupo") ? j.optString("grupo") : null;
                        s.fotos.put(f.id, f);
                    }
                }
            }
            JSONObject grupos = o.optJSONObject("grupos");
            if (grupos != null && grupos.names() != null) {
                JSONArray ids = grupos.names();
                for (int i = 0; i < ids.length(); i++) {
                    JSONArray cols = grupos.getJSONArray(ids.getString(i));
                    List<List<String>> l = new ArrayList<>();
                    for (int c = 0; c < cols.length(); c++) {
                        JSONArray col = cols.getJSONArray(c);
                        List<String> fotosCol = new ArrayList<>();
                        for (int e = 0; e < col.length(); e++) fotosCol.add(col.getString(e));
                        if (!fotosCol.isEmpty()) l.add(fotosCol);
                    }
                    s.grupos.put(ids.getString(i), l);
                }
            } else {
                convertirVersionAnterior(s, o);
            }
            return s;
        } catch (IOException | JSONException e) {
            Log.e("LocatorPic", "Sesion ilegible: " + archivo, e);
            return null;
        }
    }

    // Recorrido de la version 1 (zonas y tomas cercanas): cada zona pasa a ser
    // una columna del grupo OT, para no perder fotos que falten subir.
    private static void convertirVersionAnterior(Sesion s, JSONObject o) throws JSONException {
        JSONArray zonas = o.optJSONArray("zonas");
        if (zonas == null || zonas.length() == 0) return;
        JSONObject barridos = o.optJSONObject("barridos");
        List<List<String>> cols = new ArrayList<>();
        for (int i = 0; i < zonas.length(); i++) {
            String z = zonas.getString(i);
            List<String> col = new ArrayList<>();
            JSONArray estantes = barridos != null ? barridos.optJSONArray(z) : null;
            if (estantes != null) {
                for (int e = 0; e < estantes.length(); e++) {
                    JSONArray fila = estantes.getJSONArray(e);
                    for (int t = 0; t < fila.length(); t++) col.add(fila.getString(t));
                }
            } else {
                col.add(z);
            }
            if (!col.isEmpty()) cols.add(col);
        }
        s.grupos.put("OT", cols);
        for (List<String> col : cols) for (String id : col) {
            Foto f = s.fotos.get(id);
            if (f != null) f.grupo = "OT";
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
