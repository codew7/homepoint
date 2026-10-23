# Verificador de comprobantes de transferencia

Programa local para detectar comprobantes de transferencia alterados (con Photoshop o IA) que mandan los clientes por WhatsApp, cuando no hay acceso a la cuenta donde se recibe el pago.

## Cómo se usa

1. Abrí **`Verificador de comprobantes.exe`** (está en `dist\`). Es portable, no se instala: se puede copiar a cualquier carpeta o pendrive. Guarda sus datos en la carpeta `Verificador - datos`, al lado del `.exe`.
2. **Soltá el comprobante** en la ventana o pegalo con **Ctrl+V** (por ejemplo, después de copiar la imagen en WhatsApp). También acepta PDF.
3. En 20 a 60 segundos aparece el resultado general: **Sin alteraciones**, **Revisar** o **Alterado**, con un resumen breve.
4. Si querés más información, tocá **Ver detalle**:
   - **Imagen**: el comprobante con las zonas alteradas marcadas.
   - **Hallazgos**: todo lo que se observó.
   - **Datos**: lo que se leyó del comprobante.
5. Opcional: marcá **Aprobado** o **Rechazado**. Con eso aprende cómo son los números de operación reales de cada banco.

El ícono del reloj abre el **historial**. Para usar el `.exe`, la PC necesita Claude Code instalado y con la sesión iniciada (usa tu suscripción, sin clave de API) y Edge WebView2, que ya viene con Windows 10 y 11.

Para desarrollo también sigue andando **`Verificador.bat`**, que abre la misma pantalla en el navegador y usa la carpeta `datos\`.

## Qué revisa

- **Alteraciones visuales (el control principal):** Claude revisa el comprobante como un perito. Busca tipografías, tamaños o nitidez distintos alrededor del monto, la fecha, el destinatario y los números; parches o manchas en el fondo; textos desalineados; diseño que no corresponde a la app del banco; incoherencias como el día de la semana o la hora del celular; y señales de imagen generada con IA.
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
