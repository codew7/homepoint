package ar.com.homepoint.locatorpic;

import android.app.Application;
import android.util.Log;

import com.google.firebase.FirebaseApp;
import com.google.firebase.database.FirebaseDatabase;

/**
 * Arranque de la app: inicia Firebase con el modo sin conexion de la base de
 * datos (las escrituras quedan en cola y se mandan solas al volver la señal)
 * y retoma las subidas que hayan quedado pendientes.
 */
public class LocatorPicApp extends Application {

    private static boolean firebaseListo = false;

    /** false si falta google-services.json (la app no puede conectarse). */
    public static boolean firebaseListo() {
        return firebaseListo;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        try {
            if (FirebaseApp.getApps(this).isEmpty()) FirebaseApp.initializeApp(this);
            firebaseListo = !FirebaseApp.getApps(this).isEmpty();
            if (firebaseListo) {
                FirebaseDatabase db = FirebaseDatabase.getInstance();
                db.setPersistenceEnabled(true);
                // La guia de la semana anterior tiene que estar disponible aunque no haya señal.
                db.getReference(Sesiones.RAIZ + "/ultima").keepSynced(true);
            }
        } catch (Exception e) {
            Log.e("LocatorPic", "Firebase no esta configurado", e);
            firebaseListo = false;
        }
        if (firebaseListo) SubidaWorker.encolar(this);
    }
}
