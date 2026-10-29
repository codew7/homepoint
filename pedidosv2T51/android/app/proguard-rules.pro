# El puente JavaScript se llama por reflexion desde la pagina: si el
# ofuscador le cambia los nombres a esos metodos, la impresion y las
# descargas dejan de funcionar sin dar ningun error visible.
-keepclassmembers class ar.com.homepoint.pedidos.** {
    @android.webkit.JavascriptInterface <methods>;
}
