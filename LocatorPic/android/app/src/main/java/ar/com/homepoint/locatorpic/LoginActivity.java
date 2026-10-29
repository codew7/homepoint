package ar.com.homepoint.locatorpic;

import android.os.Bundle;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import com.google.android.material.button.MaterialButton;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseAuthInvalidCredentialsException;
import com.google.firebase.auth.FirebaseAuthInvalidUserException;
import com.google.firebase.FirebaseNetworkException;

/** Login con los mismos usuarios de Firebase que pedidosv2. La sesion queda guardada. */
public class LoginActivity extends AppCompatActivity {

    private EditText email, clave;
    private TextView error;
    private MaterialButton entrar;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        setContentView(R.layout.activity_login);
        email = findViewById(R.id.email);
        clave = findViewById(R.id.clave);
        error = findViewById(R.id.error);
        entrar = findViewById(R.id.entrar);

        entrar.setOnClickListener(v -> entrar());
        clave.setOnEditorActionListener((v, id, ev) -> {
            if (id == EditorInfo.IME_ACTION_DONE) {
                entrar();
                return true;
            }
            return false;
        });
    }

    private void entrar() {
        String e = email.getText().toString().trim();
        String c = clave.getText().toString();
        if (e.isEmpty() || c.isEmpty()) {
            mostrarError("Completá el email y la contraseña.");
            return;
        }
        entrar.setEnabled(false);
        entrar.setText("Entrando…");
        error.setVisibility(View.GONE);
        FirebaseAuth.getInstance().signInWithEmailAndPassword(e, c)
                .addOnSuccessListener(r -> finish())
                .addOnFailureListener(ex -> {
                    entrar.setEnabled(true);
                    entrar.setText("Entrar");
                    if (ex instanceof FirebaseNetworkException) mostrarError("Sin conexión. Probá de nuevo cuando tengas señal.");
                    else if (ex instanceof FirebaseAuthInvalidCredentialsException || ex instanceof FirebaseAuthInvalidUserException)
                        mostrarError("Email o contraseña incorrectos.");
                    else mostrarError("No se pudo entrar: " + ex.getMessage());
                });
    }

    private void mostrarError(String m) {
        error.setText(m);
        error.setVisibility(View.VISIBLE);
    }

    @Override
    public void onBackPressed() {
        // Sin login no hay app: volver cierra todo.
        finishAffinity();
    }
}
