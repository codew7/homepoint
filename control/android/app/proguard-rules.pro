# El puente JavaScript se llama por reflexion desde la pagina: si el
# ofuscador le cambia los nombres a esos metodos, el lector
# deja de funcionar sin dar ningun error visible.
-keepclassmembers class ar.com.homepoint.control.** {
    @android.webkit.JavascriptInterface <methods>;
}
