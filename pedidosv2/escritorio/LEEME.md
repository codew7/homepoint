# App de Windows de Pedidos

`PedidosHomePoint.exe` es la app de **Pedidos HomePoint** para PC. Es un solo archivo de ~1 MB.

Es una ventana propia que abre `pedidosv2.html` directo desde el hosting
(`https://home-point-admin.dev.ar/pedidosv2/pedidosv2.html`). O sea:
**cuando subís un cambio de pedidosv2, la app lo toma sola**, sin reinstalar. Cada vez que se
abre borra la caché de archivos, así que siempre llega lo último que se publicó (el login no se
pierde).

## Instalar en una PC

1. Desde la PC, abrí: `https://home-point-admin.dev.ar/pedidosv2/escritorio/PedidosHomePoint.exe`
2. Abrí el archivo descargado. Si Windows muestra "Windows protegió su PC", tocá
   **Más información → Ejecutar de todas formas** (pasa porque la app no está firmada).
3. Listo: se instala sola, crea el acceso directo **Pedidos HomePoint** en el escritorio y en el
   menú Inicio, y se abre.

No pide permisos de administrador. Se desinstala desde **Configuración → Aplicaciones**.

## Cómo se actualiza

- **Cambios de pedidosv2 (la web):** aparecen solos al abrir la app o al apretar F5.
- **Cambios de la app en sí** (esta carpeta): la app revisa el hosting al abrirse y cada 4 horas.
  Si hay una versión nueva, la baja, la deja lista y pregunta si querés reiniciar. Si decís que no,
  se aplica la próxima vez que la abras.

## Publicar una versión nueva de la app

Solo hace falta si cambiás algo de `fuente\Program.cs` (casi nunca).

1. Doble clic en **`Publicar escritorio.bat`**. Sube el número de versión y genera
   `PedidosHomePoint.exe` y `version.txt`.
2. Subí la carpeta `pedidosv2\escritorio` al repositorio (commit + push).

## Atajos

| Tecla             | Qué hace                              |
|-------------------|---------------------------------------|
| F5 / Ctrl+R       | Recargar                              |
| Ctrl+Shift+R      | Borrar caché y recargar               |
| F11               | Pantalla completa                     |
| Ctrl + / Ctrl −   | Agrandar / achicar                    |
| Ctrl+P            | Imprimir                              |

## Detalles técnicos

- Motor: WebView2 (Edge), viene con Windows 10/11. Si falta, la app ofrece el link para bajarlo.
- Se compila con el `csc.exe` de .NET Framework 4.8 que trae Windows: no hay que instalar nada.
- Instalación: `%LOCALAPPDATA%\Programs\PedidosHomePoint`. Datos (login, etc.):
  `%LOCALAPPDATA%\PedidosHomePoint`.
- Links a WhatsApp u otros sitios se abren en el navegador. La cámara (QR) y el portapapeles se
  permiten solo para el sitio propio.
- Para probar contra un servidor local: `set PEDIDOS_URL=http://...` y
  `set PEDIDOS_ACTUALIZACIONES=http://.../` antes de abrir el .exe con `--portable`.
