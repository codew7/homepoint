package ar.com.homepoint.locatorpic;

import android.content.Context;
import android.net.Uri;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import com.google.android.gms.tasks.Tasks;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.storage.FirebaseStorage;
import com.google.firebase.storage.StorageMetadata;

import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;

/**
 * Sube a Firebase Storage las fotos confirmadas.
 *
 * Lo maneja WorkManager: corre solo cuando hay conexion, sigue aunque se
 * cierre la app, y si algo falla reintenta con esperas cada vez mas largas.
 * Las fotos esperan en el equipo hasta que se suben.
 */
public class SubidaWorker extends Worker {

    private static final String NOMBRE = "subidas";

    public SubidaWorker(@NonNull Context ctx, @NonNull WorkerParameters params) {
        super(ctx, params);
    }

    /** Pide que se suba lo pendiente (se llama al confirmar cada foto y al abrir la app). */
    public static void encolar(Context ctx) {
        OneTimeWorkRequest pedido = new OneTimeWorkRequest.Builder(SubidaWorker.class)
                .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 20, TimeUnit.SECONDS)
                .build();
        WorkManager.getInstance(ctx).enqueueUniqueWork(NOMBRE, ExistingWorkPolicy.APPEND_OR_REPLACE, pedido);
    }

    /** "Reintentar ahora": descarta las esperas y vuelve a probar en el momento. */
    public static void reintentarAhora(Context ctx) {
        OneTimeWorkRequest pedido = new OneTimeWorkRequest.Builder(SubidaWorker.class)
                .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 20, TimeUnit.SECONDS)
                .build();
        WorkManager.getInstance(ctx).enqueueUniqueWork(NOMBRE, ExistingWorkPolicy.REPLACE, pedido);
    }

    @NonNull
    @Override
    public Result doWork() {
        if (!LocatorPicApp.firebaseListo()) return Result.failure();
        if (FirebaseAuth.getInstance().getCurrentUser() == null) return Result.retry();

        Sesiones repo = Sesiones.get(getApplicationContext());
        FirebaseStorage storage = FirebaseStorage.getInstance();
        Set<String> intentadas = new HashSet<>();
        boolean huboError = false;

        // Se vuelve a mirar al terminar cada tanda: si mientras tanto se
        // confirmaron fotos nuevas, tambien se suben en esta misma pasada.
        while (!isStopped()) {
            List<Sesiones.Pendiente> lista = repo.pendientes();
            boolean algunaNueva = false;
            for (Sesiones.Pendiente p : lista) {
                if (isStopped()) break;
                if (!intentadas.add(p.sesionId + "/" + p.fotoId)) continue;
                algunaNueva = true;
                try {
                    if (!p.foto.exists()) {
                        // Se borro (por ejemplo, se rehizo la foto) mientras esperaba.
                        continue;
                    }
                    StorageMetadata meta = new StorageMetadata.Builder()
                            .setContentType("image/jpeg")
                            .setCustomMetadata("sesion", p.sesionId)
                            .setCustomMetadata("foto", p.fotoId)
                            .build();
                    Tasks.await(storage.getReference(Sesiones.rutaStorage(p.sesionId, p.fotoId))
                            .putFile(Uri.fromFile(p.foto), meta), 10, TimeUnit.MINUTES);
                    if (p.miniatura.exists()) {
                        Tasks.await(storage.getReference(Sesiones.rutaStorageMiniatura(p.sesionId, p.fotoId))
                                .putFile(Uri.fromFile(p.miniatura), meta), 2, TimeUnit.MINUTES);
                    }
                    repo.marcarSubida(p.sesionId, p.fotoId);
                } catch (Exception e) {
                    Log.w("LocatorPic", "Fallo la subida de " + p.fotoId, e);
                    repo.marcarError(p.sesionId, p.fotoId, mensaje(e));
                    huboError = true;
                }
            }
            if (!algunaNueva) break;
        }
        return huboError ? Result.retry() : Result.success();
    }

    private static String mensaje(Exception e) {
        Throwable t = e.getCause() != null ? e.getCause() : e;
        String m = t.getMessage();
        if (m == null) return "Error de subida";
        if (m.toLowerCase().contains("permission")) return "Sin permiso en Storage (revisar reglas)";
        return m.length() > 120 ? m.substring(0, 120) : m;
    }
}
