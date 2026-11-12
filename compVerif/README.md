# Verificador de comprobantes de transferencia

Programa local para detectar comprobantes de transferencia alterados (con Photoshop o IA) que mandan los clientes por WhatsApp, cuando no hay acceso a la cuenta donde se recibe el pago.

## Cómo se usa

1. Abrí **`Verificador de comprobantes.exe`** (está en `dist\`). Es portable, no se instala: se puede copiar a cualquier carpeta o pendrive. Guarda sus datos en la carpeta `Verificador - datos`, al lado del `.exe`.
2. **Soltá el comprobante** en la ventana o pegalo con **Ctrl+V** (por ejemplo, después de copiar la imagen en WhatsApp). También acepta PDF.
3. En 20 a 90 segundos aparece el resultado general: **Sin alteraciones**, **Revisar** o **Alterado**, con un resumen breve.
4. Si querés más información, tocá **Ver detalle**:
   - **Imagen**: el comprobante con las zonas alteradas marcadas.
   - **Hallazgos**: todo lo que se observó.
   - **Datos**: lo que se leyó del comprobante.
5. Opcional: marcá **Aprobado** o **Rechazado**. Con eso aprende cómo son los números de operación reales de cada banco.

El ícono del reloj abre el **historial**. Para usar el `.exe`, la PC necesita Claude Code instalado y con la sesión iniciada (usa tu suscripción, sin clave de API) y Edge WebView2, que ya viene con Windows 10 y 11.

Para desarrollo también sigue andando **`Verificador.bat`**, que abre la misma pantalla en el navegador y usa la carpeta `datos\`.

## Comprobantes de WhatsApp (opcional)

En la pantalla principal, la tarjeta **Comprobantes de WhatsApp** tiene un interruptor. Prendido, el verificador:

1. Baja solo los comprobantes de pago que mandan los clientes (corre `WhatsAppSync\descargar-comprobantes.js` oculto, cada 5 minutos; se cierra junto con la app).
2. Analiza cada comprobante nuevo con los mismos controles de siempre, de a uno y del más viejo al más nuevo. Si soltás o pegás uno a mano, ese va primero.
3. Marca los sospechosos en tres lugares:
   - **El archivo** en `WhatsAppSync\comprobantes\`: termina en **[ALTERADO]** (rojo), **[REVISAR]** (amarillo) o **[RECHAZADO]**.
   - **El verificador**: el ícono de mensajes muestra cuántos alterados faltan decidir, y la ventana lo dice en la barra de tareas.
   - **pedidosv2**: el comprobante y el pedido muestran el aviso ("Comprobante posiblemente alterado").

Marcar **Aprobado** quita la marca y **Rechazado** la deja como [RECHAZADO], en los tres lugares.

La primera vez que se prende se analizan los comprobantes de los últimos 3 días; los más viejos quedan **Sin analizar**, con un botón para analizarlos. Si Claude falla, el comprobante no se marca y se reintenta solo (hasta 3 veces).

**Límite importante:** WhatsAppSync no guarda el archivo original, sino una copia achicada y recomprimida, sin datos internos; de los PDF guarda solo una foto de la primera página. Por eso, en estos comprobantes no se pueden buscar sellos de IA o de Photoshop, ni comparar el texto interno de un PDF, y el control de fondo liso detecta poco. El resultado lo aclara en Hallazgos. Ante la duda, descargá el original desde WhatsApp y soltalo en el verificador.

**Comprobantes repetidos:** el mismo comprobante desde **otro teléfono** o para **otro pedido** sale en rojo, porque es la señal típica de un comprobante reutilizado. Si el cliente lo reenvía en el mismo chat, o lo pegás a mano después de que llegó por WhatsApp, se anota como dato y no da alarma. Pero si ese comprobante ya había salido alterado, el reenvío también sale en rojo.

Requisitos: Node.js instalado y la carpeta `WhatsAppSync` con `clave-firebase.json`. Si el verificador no la encuentra solo, pide elegirla. Mientras el interruptor esté prendido, no hace falta abrir `descargar-comprobantes.bat`; si se abre igual, avisa que ya hay una descarga corriendo y se cierra.

## Qué revisa

- **Alteraciones visuales (el control principal):** Claude revisa el comprobante como un perito. Busca tipografías, tamaños o nitidez distintos alrededor del monto, la fecha, el destinatario y los números; parches o manchas en el fondo; textos desalineados; diseño que no corresponde a la app del banco; incoherencias como el día de la semana o la hora del celular; y errores típicos de una IA al redibujar (letras chicas deformes, íconos inventados, logos distintos). Además de la imagen completa, recibe franjas ampliadas para mirar de cerca.
- **Comparación con comprobantes reales:** junto al comprobante, Claude recibe hasta 3 comprobantes que marcaste **Aprobado** (el último de cada banco, los de diseño más parecido primero) y compara letra, colores, íconos y márgenes con los del mismo banco. Cuantos más apruebes, mejor compara.
- **Ediciones con IA (ChatGPT, Gemini):** la IA vuelve a dibujar la imagen entera, así que no deja parches. Se buscan sus propias huellas:
  - *Fondo liso:* una captura real pinta el fondo de un color exacto (en capturas reales, más del 75 % de los píxeles son iguales a su vecino; en imágenes de ChatGPT, 37-44 %). Menos de 50 % sale rojo, de 50 a 65 % amarillo. El valor aparece siempre en Hallazgos. No se aplica a fotos de tickets o de otra pantalla. Ojo: la compresión de WhatsApp tapa esta huella, así que sirve sobre todo con el archivo original.
  - *Fondo casi blanco:* las apps de los bancos pintan blanco puro y WhatsApp lo conserva; ChatGPT deja un blanco apenas gris o tintado (250-254), que suele sobrevivir a WhatsApp. Sale amarillo, salvo que los comprobantes aprobados de ese banco tengan el mismo fondo.
  - *Formato:* ChatGPT y Gemini entregan tamaños fijos (cuadrado, 2:3, 3:4, 4:5, 9:16). Una captura tiene la forma alargada de la pantalla del celular.
  - *Sellos dentro del archivo:* marcas de IA (C2PA, «creado con IA») o de programas como Photoshop o Canva. WhatsApp las borra si se manda como foto; sirven cuando llega como documento.
  - *Para salir de dudas:* subí la imagen a la app de Gemini y preguntale «¿Esta imagen fue creada o editada con IA de Google?». Detecta su marca invisible (SynthID), que resiste WhatsApp. Para imágenes de ChatGPT no hay un verificador equivalente.
- **Números retocados:** los dígitos de control del CBU/CVU y del CUIT. Si alguien cambia un número a mano, casi nunca cierran.
- **Comprobantes repetidos:** el mismo archivo, una imagen casi igual o el mismo número de operación ya enviados antes.
- **PDF:** si lo que se ve no coincide con el texto que hay adentro del archivo (un monto tapado y reescrito) o si tiene cosas agregadas encima.
- **Mapa de retoques (ELA):** ayuda visual opcional. Con texto sobre fondo liso aporta poco.

**Rojo**: probablemente alterado. **Amarillo**: revisar. **Verde**: sin signos de alteración, **pero no es una garantía**. Una edición muy prolija puede no notarse.

## Recomendaciones

- Si dudás, pedí el **PDF original** que se comparte desde la app del banco: es mucho más difícil de falsificar bien.
- Para montos altos, pedí un video corto donde el cliente muestre el movimiento en la app.

## Datos

Todo queda en esta PC, en `datos/` (historial y copia de cada comprobante). Esa carpeta no se sube a git.

## Para desarrollo

```
venv\Scripts\python.exe construir.py                # arma dist\Verificador de comprobantes.exe (--icono redibuja el ícono)
venv\Scripts\python.exe app.py                      # la app de escritorio sin compilar
venv\Scripts\python.exe servidor.py [puerto] [--sin-navegador]
venv\Scripts\python.exe lector.py <archivo>         # sólo la revisión con Claude
venv\Scripts\python.exe forense.py <archivo>        # sólo el análisis del archivo
venv\Scripts\python.exe reglas.py cbu <numero>      # probar dígitos verificadores (también: cuit)
```

Variables: `VERIFICADOR_MODELO` (por defecto `opus`; `sonnet` es más rápido y gasta menos uso de la suscripción) y `VERIFICADOR_DATOS` (otra carpeta de datos, para pruebas).
