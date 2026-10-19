# Comparador de envíos · Correo Argentino + Vía Cargo

Una sola pantalla para cotizar el mismo paquete en las dos empresas (envíos de sucursal a sucursal), comparar tarifas y compartirle al cliente una ficha prolija.

## Arrancar

1. Tener listo el cotizador del Correo (`../Correo`: venv con Playwright y `.env` con las credenciales de MiCorreo). El de Vía Cargo no necesita nada.
2. Doble clic en `Cotizador.bat` (o `..\Correo\venv\Scripts\python.exe servidor.py`). Se abre `http://127.0.0.1:8613/`.

Los tres cotizadores pueden convivir abiertos (puertos 8611, 8612 y 8613).

## Qué hace

- **Un solo formulario**: medidas (o volumen), peso, valor declarado y destino por localidad o CP. El catálogo cruza las 3.765 sucursales del Correo con las 1.899 localidades de Vía Cargo.
- **Análisis en vivo** de cómo cobra cada empresa (escalón del Correo, franjas de Vía Cargo) y cuánto margen hay para agrandar la caja o sumar peso sin cambiar de precio.
- **Consulta en paralelo**: Vía Cargo responde en segundos; el Correo (que navega MiCorreo) tarda 15–40 s por modalidad y aparece cuando llega. Con la caché activada, una cotización repetida (mismo escalón, destino y valor, hasta 30 días) sale al instante.
- **Comparativa**: Paq.ar Clásico contra Vía Cargo Estándar (agencia a agencia, con pago en origen o en destino); opción más económica destacada y diferencia en $ y % contra ella; desglose por concepto de Vía Cargo; sucursal del Correo (dirección, horario, mapa) y agencias de Vía Cargo en origen y destino.
- **Precio al cliente**: recargo % o fijo con redondeo (Configuración), visible como columna aparte y en la ficha.
- **Ficha para el cliente**: elegís qué servicios incluir, nombre del cliente, direcciones de retiro; copiás la imagen al portapapeles (WhatsApp), la bajás en PNG o la imprimís en PDF. También «Copiar resumen» en texto.
- **Historial** con filtro, repetir, ver, ficha, exportación CSV/JSON.
- **MiCorreo**: botón para abrir el sitio con la cotización cargada y terminar el envío.

## Atajos

`Ctrl+Enter` compara · `Esc` cierra los paneles · flechas + `Enter` en el buscador de destino.
