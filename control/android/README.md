# App Android "Control"

App liviana con **dos funciones**: *Buscar artículo* (en qué pedidos está y marcarlo listo) y
*Control de pedido* (contar cada unidad del casillero con el lector o la cámara).

- Id: `ar.com.homepoint.control` — convive con "Pedidos Colector" y la app de tablets.
- **La página se carga desde el sitio**: `https://home-point-admin.dev.ar/control/control.html`.
  Cualquier cambio en `control/control.html` llega solo, sin reinstalar el APK (hace falta
  que el cambio esté publicado en el sitio).
- Usa los mismos datos de Firebase que `pedidosv2`: un control hecho acá se ve igual en la
  tablet y en el colector, y al revés.
- **Lector**: en colectores, igual que "Pedidos Colector" (`LectorColector.java`). En un Zebra
  arma solo el perfil de DataWedge `ControlHomePoint`. En otros colectores, en la app de ajustes
  del lector poner salida **Broadcast**; si deja escribir la acción, usar
  `ar.com.homepoint.control.LECTURA` con el dato en `data`.
- **Cámara**: en celulares sin lector, el botón de escanear abre la cámara.
- Ícono: el pin de HomePoint oscuro sobre amarillo (`#FFC400`).

## Compilar en esta PC

En Git Bash, dentro de `control/android`:

```bash
export JAVA_HOME="/c/Users/alero/AppData/Local/Programs/jdk-17.0.20.1+1"
~/.gradle/wrapper/dists/gradle-8.9-bin/*/gradle-8.9/bin/gradle assembleDebug
cp app/build/outputs/apk/debug/app-debug.apk ../Control.apk
```

Solo hace falta recompilar si cambia algo de Android (ícono, nombre, lector), no la página.
