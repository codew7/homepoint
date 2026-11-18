# App Android de Reposición (APK)

App instalable de **Reposición** para los celulares del depósito y del salón.

La app muestra `https://home-point-admin.dev.ar/reposicion/` desde el sitio publicado, así que
**los cambios de la página llegan solos**: si la app estaba abierta, aparece arriba el cartel
azul *"Hay una versión nueva · Actualizar"* y con un toque se recarga.

Lo que agrega la app sobre la página:

- **Etiquetas por Bluetooth directo** a la térmica (Nexus Z-NX 461 UB), sin programas extra.
  Usa Bluetooth clásico, el mismo con el que se empareja en Android.
- **Pantalla siempre encendida**, para no perderse los avisos entre depósito y salón.
- **Pistola lectora**: escribe directo en la app (USB con adaptador OTG o Bluetooth).
- **Cámara** para escanear, con su permiso.
- **Se actualiza sola**: ver abajo.

## Compilar y publicar

No hay que hacer nada a mano: cada vez que se sube un cambio dentro de `reposicion/android`,
GitHub compila el APK (pestaña **Actions** → *APK Reposicion*, tarda 3 a 6 minutos) y lo deja en
el release **reposicion-apk**. También se puede lanzar a mano con **Run workflow**.

Usa la misma clave de firma que la app de Pedidos (los secrets `ANDROID_KEYSTORE_BASE64` y
`ANDROID_KEYSTORE_PASSWORD`, ya cargados). Sin esa clave no se publica nada.

El release está marcado como *pre-release* a propósito: así nunca figura como "último release"
y la app de Pedidos no lo confunde con una actualización suya.

## Instalar por primera vez

1. En el celular, abrí la página de Reposición en Chrome y tocá **Instalar en este celular**
   → **Descargar la app**. (Link directo:
   `https://github.com/codew7/homepoint/releases/download/reposicion-apk/Reposicion.apk`)
2. Abrí `Reposicion.apk`. Si Android pregunta, permití *instalar apps de esta fuente* y tocá
   **Instalar**.
3. Emparejá la impresora desde los **ajustes de Bluetooth de Android** (una sola vez). La
   primera vez que imprimas, la app pide elegirla de la lista.

## Actualizaciones de la app

La app revisa al abrirse y cada 15 minutos si hay un APK nuevo. Si lo hay, muestra
**Actualizar / Más tarde**. *Actualizar* lo baja y abre el instalador de Android, que pide un
toque para confirmar (Android no deja instalar sin ese toque fuera de Play Store). Se instala
encima, sin perder nada. *Más tarde* lo vuelve a ofrecer a las 4 horas.

## Cambiar cosas

| Qué                   | Dónde                                                                 |
|-----------------------|-----------------------------------------------------------------------|
| Dirección que abre    | `URL_APP` y `HOST_APP` en `app/src/main/java/ar/com/homepoint/reposicion/MainActivity.java` |
| Nombre bajo el ícono  | `app_name` en `app/src/main/res/values/strings.xml`                   |
| Colores               | `app/src/main/res/values/colors.xml`                                  |
| Ícono                 | los PNG de `app/src/main/res/mipmap-*` (salen de `reposicion/icon-maskable-512.png`) |
