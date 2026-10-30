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
 * Una zona puede ser de FOTO UNICA (su id es el de la foto) o de TOMAS
 * CERCANAS (su id esta en "barridos"): varias fotos por estante, de izquierda
 * a derecha, y los estantes de arriba hacia abajo. La PC las une como un
 * rompecabezas.
 *
 * "sectores" marca la zona donde EMPIEZA cada grupo con nombre ("Adelante
 * izquierda"); el sector sigue hasta la zona donde empieza el siguiente.
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
        // Solo en las tomas cercanas:
        public String zona;             // id de la zona (barrido) a la que pertenece
        public int estante, indice;     // 0 = primer estante / primera toma
        public float[] orientacion;     // {azimut, inclinacion, giro} en grados, o null
    }

    /** Zona de tomas cercanas: una lista de tomas (ids de foto) por estante. */
    public static final class Barrido {
        public final List<List<String>> estantes = new ArrayList<>();

        public int tomas() {
            int n = 0;
            for (List<String> e : estantes) n += e.size();
            return n;
        }

        public String primera() {
            for (List<String> e : estantes) if (!e.isEmpty()) return e.get(0);
            return null;
        }

        public List<String> todas() {
            List<String> l = new ArrayList<>();
            for (List<String> e : estantes) l.addAll(e);
            return l;
        }
    }

    public static final class Sesion {
        public String id;
        public long creada;
        public String estado = "en_curso";
        public final List<String> zonas = new ArrayList<>();
        public final Map<String, Foto> fotos = new HashMap<>();
        public final Map<String, Barrido> barridos = new HashMap<>();
        public final Map<String, String> sectores = new HashMap<>();

        /** Ids de las fotos de una zona: la foto unica o todas sus tomas. */
        public List<String> fotosDe(String zonaId) {
            Barrido b = barridos.get(zonaId);
            if (b != null) return b.todas();
            List<String> l = new ArrayList<>();
            l.add(zonaId);
            return l;
        }

        public int pendientes() {
            int n = 0;
            for (String z : zonas) {
                for (String id : fotosDe(z)) {
                    Foto f = fotos.get(id);
                    if (f != null && !f.subida) n++;
                }
            }
            return n;
        }

        public int conError() {
            int n = 0;
            for (String z : zonas) {
                for (String id : fotosDe(z)) {
                    Foto f = fotos.get(id);
                    if (f != null && !f.subida && f.error != null) n++;
                }
            }
            return n;
        }

        /** Foto que representa la zona: la unica, o la primera toma. */
        public Foto fotoDeZona(int posicion) {
            if (posicion < 0 || posicion >= zonas.size()) return null;
            String z = zonas.get(posicion);
            Barrido b = barridos.get(z);
            return fotos.get(b != null ? b.primera() : z);
        }

        public Barrido barridoDeZona(int posicion) {
            return (posicion >= 0 && posicion < zonas.size()) ? barridos.get(zonas.get(posicion)) : null;
        }

        /** Nombre del sector al que pertenece la zona (el ultimo que empezo antes), o null. */
        public String sectorDe(int posicion) {
            for (int i = Math.min(posicion, zonas.size() - 1); i >= 0; i--) {
                String n = sectores.get(zonas.get(i));
                if (n != null) return n;
            }
            return null;
        }

        /** Nombres de sector usados en este recorrido, en orden. */
        public List<String> nombresSectores() {
            List<String> l = new ArrayList<>();
            for (String z : zonas) {
                String n = sectores.get(z);
                if (n != null && !l.contains(n)) l.add(n);
            }
            return l;
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
            for (String z : s.zonas) {
                for (String id : s.fotosDe(z)) {
                    Foto f = s.fotos.get(id);
                    if (f != null && !f.subida) lista.add(new Pendiente(s.id, id, archivoFoto(s, id), archivoMiniatura(s, id)));
                }
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
        Foto f = nuevaFoto(s, tomada);
        Map<String, Object> datos = new HashMap<>();
        ubicarZona(s, f.id, posicion, reemplazar, datos);
        s.fotos.put(f.id, f);
        guardar(s);

        datos.put("zonas", new ArrayList<>(s.zonas));
        datos.put("fotos/" + f.id, metaFoto(s, f));
        ref(s).updateChildren(datos);

        avisar();
        SubidaWorker.encolar(ctx);
        return f;
    }

    /**
     * Agrega una TOMA CERCANA a una zona de tomas. La primera toma crea la zona
     * (en "posicion", igual que agregar). estante: 0 = el de mas arriba; si es
     * uno mas que los que hay, empieza un estante nuevo.
     * Devuelve la foto guardada.
     */
    public synchronized Foto agregarToma(Sesion s, String zonaId, int posicion, boolean reemplazar,
                                         int estante, File tomada, float[] orientacion) throws IOException {
        Foto f = nuevaFoto(s, tomada);
        Map<String, Object> datos = new HashMap<>();
        Barrido b = s.barridos.get(zonaId);
        if (b == null) {
            b = new Barrido();
            s.barridos.put(zonaId, b);
            ubicarZona(s, zonaId, posicion, reemplazar, datos);
        }
        while (b.estantes.size() <= estante) b.estantes.add(new ArrayList<>());
        List<String> fila = b.estantes.get(estante);
        f.zona = zonaId;
        f.estante = estante;
        f.indice = fila.size();
        f.orientacion = orientacion;
        fila.add(f.id);
        s.fotos.put(f.id, f);
        guardar(s);

        datos.put("zonas", new ArrayList<>(s.zonas));
        datos.put("barridos/" + zonaId + "/estantes", copiaEstantes(b));
        datos.put("fotos/" + f.id, metaFoto(s, f));
        ref(s).updateChildren(datos);

        avisar();
        SubidaWorker.encolar(ctx);
        return f;
    }

    /** Deshace una toma. Si la zona queda sin tomas, se saca del recorrido. */
    public synchronized void quitarToma(Sesion s, String zonaId, String fotoId) {
        Barrido b = s.barridos.get(zonaId);
        if (b == null) return;
        for (List<String> fila : b.estantes) fila.remove(fotoId);
        while (!b.estantes.isEmpty() && b.estantes.get(b.estantes.size() - 1).isEmpty()) {
            b.estantes.remove(b.estantes.size() - 1);
        }
        borrarFotoLocal(s, fotoId);
        Map<String, Object> datos = new HashMap<>();
        datos.put("fotos/" + fotoId, null);
        if (b.tomas() == 0) {
            int pos = s.zonas.indexOf(zonaId);
            if (pos >= 0) {
                s.zonas.remove(pos);
                moverSector(s, zonaId, pos, datos);
            }
            s.barridos.remove(zonaId);
            datos.put("barridos/" + zonaId, null);
            datos.put("zonas", new ArrayList<>(s.zonas));
        } else {
            datos.put("barridos/" + zonaId + "/estantes", copiaEstantes(b));
        }
        guardar(s);
        ref(s).updateChildren(datos);
        avisar();
    }

    /** Id para una zona de tomas cercanas nueva (se crea con su primera toma). */
    public String nuevoIdZona() {
        return "b" + Long.toString(System.currentTimeMillis(), 36) + aleatorio(4);
    }

    /**
     * Marca que en esta zona empieza un sector con nombre (o lo quita si el
     * nombre es null o vacio).
     */
    public synchronized void ponerSector(Sesion s, String zonaId, String nombre) {
        if (zonaId == null || !s.zonas.contains(zonaId)) return;
        String limpio = nombre != null ? nombre.trim() : "";
        if (limpio.isEmpty()) s.sectores.remove(zonaId);
        else s.sectores.put(zonaId, limpio);
        guardar(s);
        ref(s).child("sectores").child(zonaId).setValue(limpio.isEmpty() ? null : limpio);
        avisar();
    }

    /** Saca una zona del recorrido; las siguientes se renumeran solas. */
    public synchronized void eliminar(Sesion s, int posicion) {
        if (posicion < 0 || posicion >= s.zonas.size()) return;
        String id = s.zonas.remove(posicion);
        Map<String, Object> datos = new HashMap<>();
        borrarZonaLocal(s, id, datos);
        moverSector(s, id, posicion, datos);
        guardar(s);
        datos.put("zonas", new ArrayList<>(s.zonas));
        ref(s).updateChildren(datos);
        avisar();
    }

    // Pone la zona nueva en su lugar (al final, antes de otra, o en lugar de
    // otra si se esta rehaciendo). La reemplazada se borra y le pasa su sector.
    private void ubicarZona(Sesion s, String zonaId, int posicion, boolean reemplazar, Map<String, Object> datos) {
        if (reemplazar && posicion >= 0 && posicion < s.zonas.size()) {
            String vieja = s.zonas.set(posicion, zonaId);
            borrarZonaLocal(s, vieja, datos);
            String sector = s.sectores.remove(vieja);
            if (sector != null) {
                s.sectores.put(zonaId, sector);
                datos.put("sectores/" + vieja, null);
                datos.put("sectores/" + zonaId, sector);
            }
        } else {
            s.zonas.add(Math.min(Math.max(posicion, 0), s.zonas.size()), zonaId);
        }
    }

    // Si se saca la zona donde empezaba un sector, el sector pasa a empezar
    // en la zona siguiente (si esa no empieza otro).
    private void moverSector(Sesion s, String zonaId, int posicion, Map<String, Object> datos) {
        String sector = s.sectores.remove(zonaId);
        if (sector == null) return;
        datos.put("sectores/" + zonaId, null);
        if (posicion < s.zonas.size()) {
            String siguiente = s.zonas.get(posicion);
            if (!s.sectores.containsKey(siguiente)) {
                s.sectores.put(siguiente, sector);
                datos.put("sectores/" + siguiente, sector);
            }
        }
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
        if (f.zona != null) {
            meta.put("zona", f.zona);
            meta.put("estante", f.estante);
            meta.put("indice", f.indice);
            if (f.orientacion != null) {
                Map<String, Object> o = new HashMap<>();
                o.put("azimut", (double) f.orientacion[0]);
                o.put("inclinacion", (double) f.orientacion[1]);
                o.put("giro", (double) f.orientacion[2]);
                meta.put("orientacion", o);
            }
        }
        return meta;
    }

    private static List<List<String>> copiaEstantes(Barrido b) {
        List<List<String>> l = new ArrayList<>();
        for (List<String> fila : b.estantes) l.add(new ArrayList<>(fila));
        return l;
    }

    private static Map<String, Object> copiaBarridos(Sesion s) {
        Map<String, Object> m = new HashMap<>();
        for (String z : s.zonas) {
            Barrido b = s.barridos.get(z);
            if (b == null) continue;
            Map<String, Object> e = new HashMap<>();
            e.put("estantes", copiaEstantes(b));
            m.put(z, e);
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
        List<String> zonas = new ArrayList<>(s.zonas);

        Map<String, Object> datos = new HashMap<>();
        datos.put("sesiones/" + s.id + "/estado", "lista");
        datos.put("sesiones/" + s.id + "/finalizada", ServerValue.TIMESTAMP);
        datos.put("sesiones/" + s.id + "/zonas", zonas);
        Map<String, Object> barridos = copiaBarridos(s);
        Map<String, Object> sectores = new HashMap<>(s.sectores);
        datos.put("sesiones/" + s.id + "/barridos", barridos.isEmpty() ? null : barridos);
        datos.put("sesiones/" + s.id + "/sectores", sectores.isEmpty() ? null : sectores);
        Map<String, Object> ultima = new HashMap<>();
        ultima.put("sesionId", s.id);
        ultima.put("finalizada", ServerValue.TIMESTAMP);
        ultima.put("zonas", zonas);
        ultima.put("barridos", barridos.isEmpty() ? null : barridos);
        ultima.put("sectores", sectores.isEmpty() ? null : sectores);
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
                if (f.zona != null) {
                    j.put("zona", f.zona);
                    j.put("estante", f.estante);
                    j.put("indice", f.indice);
                    if (f.orientacion != null) {
                        j.put("orientacion", new JSONArray()
                                .put(f.orientacion[0]).put(f.orientacion[1]).put(f.orientacion[2]));
                    }
                }
                fotos.put(f.id, j);
            }
            o.put("fotos", fotos);
            JSONObject barridos = new JSONObject();
            for (Map.Entry<String, Barrido> e : s.barridos.entrySet()) {
                JSONArray estantes = new JSONArray();
                for (List<String> fila : e.getValue().estantes) estantes.put(new JSONArray(fila));
                barridos.put(e.getKey(), estantes);
            }
            o.put("barridos", barridos);
            o.put("sectores", new JSONObject(s.sectores));
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
                        f.zona = j.has("zona") ? j.optString("zona") : null;
                        f.estante = j.optInt("estante");
                        f.indice = j.optInt("indice");
                        JSONArray or = j.optJSONArray("orientacion");
                        if (or != null && or.length() == 3) {
                            f.orientacion = new float[]{(float) or.getDouble(0), (float) or.getDouble(1), (float) or.getDouble(2)};
                        }
                        s.fotos.put(f.id, f);
                    }
                }
            }
            JSONObject barridos = o.optJSONObject("barridos");
            if (barridos != null && barridos.names() != null) {
                JSONArray ids = barridos.names();
                for (int i = 0; i < ids.length(); i++) {
                    Barrido b = new Barrido();
                    JSONArray estantes = barridos.getJSONArray(ids.getString(i));
                    for (int e = 0; e < estantes.length(); e++) {
                        JSONArray fila = estantes.getJSONArray(e);
                        List<String> l = new ArrayList<>();
                        for (int t = 0; t < fila.length(); t++) l.add(fila.getString(t));
                        b.estantes.add(l);
                    }
                    s.barridos.put(ids.getString(i), b);
                }
            }
            JSONObject sectores = o.optJSONObject("sectores");
            if (sectores != null && sectores.names() != null) {
                JSONArray ids = sectores.names();
                for (int i = 0; i < ids.length(); i++) s.sectores.put(ids.getString(i), sectores.getString(ids.getString(i)));
            }
            return s;
        } catch (IOException | JSONException e) {
            Log.e("LocatorPic", "Sesion ilegible: " + archivo, e);
            return null;
        }
    }

    // Borra la zona del equipo (la foto unica o todas sus tomas) y anota en
    // "datos" lo que hay que borrar en Firebase.
    private void borrarZonaLocal(Sesion s, String zonaId, Map<String, Object> datos) {
        for (String id : s.fotosDe(zonaId)) {
            borrarFotoLocal(s, id);
            datos.put("fotos/" + id, null);
        }
        if (s.barridos.remove(zonaId) != null) datos.put("barridos/" + zonaId, null);
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
