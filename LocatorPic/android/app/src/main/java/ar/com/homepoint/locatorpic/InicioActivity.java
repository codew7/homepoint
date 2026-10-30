package ar.com.homepoint.locatorpic;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.ColorStateList;
import android.os.Bundle;
import android.view.View;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.TextView;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.database.DataSnapshot;
import com.google.firebase.database.DatabaseError;
import com.google.firebase.database.DatabaseReference;
import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.database.ValueEventListener;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Pantalla principal: el recorrido en curso (o empezar uno nuevo), el estado
 * de las subidas y que paso con el ultimo recorrido terminado (si la PC ya lo
 * bajo y cuantos productos ubico).
 */
public class InicioActivity extends AppCompatActivity {

    private Sesiones repo;
    private GuiaAnterior guia;
    private TextView usuario, tituloActual, numZonas, txtZonas, detalleActual, txtSubidas, ultimoFecha, ultimoEstado;
    private View chipSubidas, accionesCurso, ultimoPunto, sinConfig;
    private ImageView icSubidas;
    private MaterialButton principal;

    private DatabaseReference refUltimaSesion;
    private ValueEventListener oyenteUltima;
    private String ultimaEscuchada;

    private final Sesiones.Oyente alCambiarSesiones = this::pintar;
    private final GuiaAnterior.Oyente alCambiarGuia = this::pintarGuia;

    private final ActivityResultLauncher<String> pedirCamara =
            registerForActivityResult(new ActivityResultContracts.RequestPermission(), ok -> {
                if (ok) abrirCamara();
                else new MaterialAlertDialogBuilder(this)
                        .setTitle("Falta el permiso de cámara")
                        .setMessage("LocatorPic necesita la cámara para sacar las fotos del recorrido. Activalo en Ajustes → Aplicaciones → LocatorPic → Permisos.")
                        .setPositiveButton("Entendido", null).show();
            });

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        setContentView(R.layout.activity_inicio);
        usuario = findViewById(R.id.usuario);
        tituloActual = findViewById(R.id.tituloActual);
        numZonas = findViewById(R.id.numZonas);
        txtZonas = findViewById(R.id.txtZonas);
        detalleActual = findViewById(R.id.detalleActual);
        txtSubidas = findViewById(R.id.txtSubidas);
        chipSubidas = findViewById(R.id.chipSubidas);
        icSubidas = findViewById(R.id.icSubidas);
        accionesCurso = findViewById(R.id.accionesCurso);
        ultimoFecha = findViewById(R.id.ultimoFecha);
        ultimoEstado = findViewById(R.id.ultimoEstado);
        ultimoPunto = findViewById(R.id.ultimoPunto);
        sinConfig = findViewById(R.id.sinConfig);
        principal = findViewById(R.id.principal);
        ImageButton salir = findViewById(R.id.salir);

        if (!LocatorPicApp.firebaseListo()) {
            sinConfig.setVisibility(View.VISIBLE);
            principal.setEnabled(false);
            return;
        }
        repo = Sesiones.get(this);
        guia = GuiaAnterior.get(this);

        principal.setOnClickListener(v -> {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) abrirCamara();
            else pedirCamara.launch(Manifest.permission.CAMERA);
        });
        findViewById(R.id.verZonas).setOnClickListener(v -> startActivity(new Intent(this, RecorridoActivity.class)));
        findViewById(R.id.descartar).setOnClickListener(v -> confirmarDescarte());
        chipSubidas.setOnClickListener(v -> {
            SubidaWorker.reintentarAhora(this);
            txtSubidas.setText("Reintentando…");
        });
        salir.setOnClickListener(v -> new MaterialAlertDialogBuilder(this)
                .setTitle("Cerrar sesión")
                .setMessage(repo.totalPendientes() > 0
                        ? "Hay fotos sin subir. Van a subir igual cuando vuelvas a entrar. ¿Cerrar sesión?"
                        : "¿Cerrar sesión en este equipo?")
                .setPositiveButton("Cerrar sesión", (d, w) -> {
                    FirebaseAuth.getInstance().signOut();
                    startActivity(new Intent(this, LoginActivity.class));
                })
                .setNegativeButton("Cancelar", null).show());
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (repo == null) return;
        FirebaseUser u = FirebaseAuth.getInstance().getCurrentUser();
        if (u == null) {
            startActivity(new Intent(this, LoginActivity.class));
            return;
        }
        usuario.setText(u.getEmail());
        repo.agregarOyente(alCambiarSesiones);
        guia.agregarOyente(alCambiarGuia);
        guia.iniciar();
        repo.limpiarDescargadas();
        SubidaWorker.encolar(this);
        pintar();
        pintarGuia();
    }

    @Override
    protected void onStop() {
        super.onStop();
        if (repo == null) return;
        repo.quitarOyente(alCambiarSesiones);
        guia.quitarOyente(alCambiarGuia);
        if (refUltimaSesion != null && oyenteUltima != null) refUltimaSesion.removeEventListener(oyenteUltima);
        ultimaEscuchada = null;
    }

    private void abrirCamara() {
        Sesiones.Sesion s = repo.enCurso();
        if (s == null) s = repo.nueva();
        Intent i = new Intent(this, CamaraActivity.class);
        i.putExtra(CamaraActivity.EXTRA_SESION, s.id);
        startActivity(i);
    }

    private void confirmarDescarte() {
        Sesiones.Sesion s = repo.enCurso();
        if (s == null) return;
        new MaterialAlertDialogBuilder(this)
                .setTitle("Descartar recorrido")
                .setMessage("Se borran las " + s.zonas.size() + " zonas (con todas sus fotos) de este recorrido en curso. La PC no lo va a recibir. ¿Seguro?")
                .setPositiveButton("Descartar", (d, w) -> repo.descartar(s))
                .setNegativeButton("Cancelar", null).show();
    }

    /** Recorrido en curso y subidas. */
    private void pintar() {
        Sesiones.Sesion s = repo.enCurso();
        if (s != null) {
            tituloActual.setText("Recorrido en curso");
            numZonas.setText(String.valueOf(s.zonas.size()));
            txtZonas.setText(s.zonas.size() == 1 ? "zona fotografiada" : "zonas fotografiadas");
            principal.setText("Seguir sacando fotos");
            accionesCurso.setVisibility(View.VISIBLE);
            detalleActual.setText("Empezado el " + fecha(s.creada) + ". Cuando termines, finalizalo desde \"Ver zonas\".");
        } else {
            tituloActual.setText("Nuevo recorrido");
            principal.setText("Empezar recorrido");
            accionesCurso.setVisibility(View.GONE);
        }

        int pendientes = repo.totalPendientes();
        int errores = 0;
        if (s != null) errores = s.conError();
        if (pendientes == 0) {
            chipSubidas.setBackgroundTintList(ColorStateList.valueOf(getColor(R.color.exito_suave)));
            icSubidas.setImageResource(R.drawable.ic_check);
            icSubidas.setImageTintList(ColorStateList.valueOf(getColor(R.color.exito)));
            txtSubidas.setTextColor(getColor(R.color.exito));
            txtSubidas.setText("Todo subido");
        } else {
            boolean conProblema = errores > 0;
            int color = getColor(conProblema ? R.color.alerta : R.color.acento);
            chipSubidas.setBackgroundTintList(ColorStateList.valueOf(getColor(conProblema ? R.color.alerta_suave : R.color.acento_suave)));
            icSubidas.setImageResource(conProblema ? R.drawable.ic_nube_off : R.drawable.ic_nube);
            icSubidas.setImageTintList(ColorStateList.valueOf(color));
            txtSubidas.setTextColor(color);
            txtSubidas.setText(conProblema
                    ? pendientes + " sin subir · tocá para reintentar"
                    : "Subiendo " + pendientes + (pendientes == 1 ? " foto" : " fotos"));
        }
        pintarGuia();
    }

    /** Ultimo recorrido terminado (de cualquier equipo) y que hizo la PC con el. */
    private void pintarGuia() {
        if (repo.enCurso() == null) {
            int n = guia.cantidadZonas();
            numZonas.setText(n > 0 ? String.valueOf(n) : "—");
            txtZonas.setText(n > 0 ? "zonas la vez anterior" : "zonas");
            detalleActual.setText(n > 0
                    ? "Vas a ver la foto de cada zona de la vez anterior como guía."
                    : "Primer recorrido: sacá una foto por tramo de estantería (dos columnas), siempre en el mismo orden.");
        }

        String id = guia.sesionId();
        if (id == null) {
            ultimoFecha.setText("Todavía no hay recorridos terminados");
            ultimoEstado.setText("");
            return;
        }
        ultimoFecha.setText(fecha(guia.finalizada()) + " · " + guia.cantidadZonas() + " zonas");
        if (id.equals(ultimaEscuchada)) return;
        if (refUltimaSesion != null && oyenteUltima != null) refUltimaSesion.removeEventListener(oyenteUltima);
        ultimaEscuchada = id;
        refUltimaSesion = FirebaseDatabase.getInstance().getReference(Sesiones.RAIZ).child("sesiones").child(id);
        oyenteUltima = new ValueEventListener() {
            @Override
            public void onDataChange(DataSnapshot snap) {
                String estado = snap.child("estado").getValue(String.class);
                Long ubicados = snap.child("procesada/productosUbicados").getValue(Long.class);
                int color;
                String texto;
                if ("procesada".equals(estado) || "archivada".equals(estado)) {
                    color = R.color.exito;
                    texto = "Analizado en la PC" + (ubicados != null ? ": " + ubicados + " productos ubicados" : "");
                } else if ("descargada".equals(estado)) {
                    color = R.color.acento;
                    texto = "La PC ya lo bajó; falta guardar el análisis";
                } else {
                    color = R.color.apagado;
                    texto = "Esperando que la PC lo baje (doble clic en relevar.bat)";
                }
                ultimoPunto.setBackgroundTintList(ColorStateList.valueOf(getColor(color)));
                ultimoEstado.setText(texto);
            }

            @Override
            public void onCancelled(DatabaseError error) {
                ultimoEstado.setText("Sin permiso para leer (revisar reglas de Firebase)");
            }
        };
        refUltimaSesion.addValueEventListener(oyenteUltima);
    }

    static String fecha(long ms) {
        if (ms <= 0) return "—";
        return new SimpleDateFormat("EEE d/MM 'a las' HH:mm", new Locale("es", "AR")).format(new Date(ms));
    }
}
