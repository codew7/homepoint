# Nexo CRM · CRM para WhatsApp

CRM completo para atender, vender y medir por WhatsApp. Corre entero en el
navegador: sin instalación, sin compilación y sin servidor propio.

Abrí `CMR/index.html` (doble clic o publicado en GitHub Pages) y listo. La
primera vez una guía de tres pasos deja el espacio configurado.

---

## Qué incluye

| Módulo | Qué resuelve |
| --- | --- |
| **Bandeja** | Todas las conversaciones en un lugar: búsqueda profunda en el historial, filtros (sin leer, míos, sin asignar, en espera, cerradas), asignación por agente, estados, posponer, etiquetas, notas internas que el cliente nunca ve, adjuntos, plantillas, respuestas rápidas con `/atajo` y ficha del contacto al costado. |
| **Contactos** | Listado ordenable con filtros y selección múltiple. Etiquetado en lote, exportación e importación CSV (los números repetidos se actualizan en lugar de duplicarse), campos personalizados y ficha 360 con negocios, tareas y notas. |
| **Embudo** | Tablero Kanban con arrastre real: la tarjeta sigue al dedo desde donde la agarraste, hereda la velocidad al soltar y aterriza con un resorte. Totales por etapa, alerta de negocios fríos y etapas configurables. |
| **Campañas** | Difusión por plantilla con audiencia filtrada (etiquetas, etapa, consentimiento), conteo en vivo, ritmo de envío por minuto, vista previa tal como la recibe el cliente y seguimiento de enviados, entregados, leídos y respuestas. |
| **Automatizaciones** | Reglas «cuando pasa esto → hacé aquello»: saludo instantáneo, aviso fuera de horario, palabras clave, reparto entre agentes, escalado de reclamos y recordatorios. Seis recetas se activan en un clic. |
| **Métricas** | Volumen de mensajes, tiempo de primera respuesta contra tu objetivo, embudo, ranking del equipo, mapa de calor por día y hora, y etiquetas más usadas. Cada gráfico tiene su vista en tabla y se exporta a CSV. |
| **Ajustes** | Conexión, datos del negocio, horario, equipo y roles, etiquetas, respuestas rápidas, plantillas, etapas, apariencia, respaldo y sincronización. |

Atajos: `Ctrl/⌘ + K` abre la paleta de comandos, `G` + `B/C/E/K/M/A` navega,
`N` inicia una conversación, `/` busca en la bandeja y `?` muestra la ayuda.

---

## Los tres modos de conexión

Se eligen en **Ajustes → Conexión** y se pueden cambiar cuando quieras.

### 1. Demostración (por defecto)
Nada sale a WhatsApp. Los envíos simulan sus tildes de entregado y leído, y
cada 20 a 70 segundos llega un mensaje nuevo para ver la bandeja en
movimiento. Sirve para evaluar la herramienta y capacitar al equipo.

### 2. Envío por enlace — sin API, sin costos
El CRM abre WhatsApp Web o la app con el número cargado y el mensaje ya
escrito; vos apretás enviar. Funciona con cualquier WhatsApp, incluso el
personal.

Límites honestos: no hay confirmación de entrega ni de lectura, los mensajes
entrantes se registran a mano y las campañas no se envían solas.

### 3. API oficial de Meta (Cloud API) — envío real
Necesitás una cuenta de WhatsApp Business en Meta. Cargá en Ajustes:

- **ID del número de teléfono** (*Phone number ID*)
- **ID de la cuenta** (*WhatsApp Business Account ID*, para traer plantillas)
- **Token de acceso**
- **Token de verificación** del webhook (lo inventás vos)

Con **Probar conexión** verificás las credenciales y con **Traer plantillas**
importás las que Meta ya te aprobó.

> ⚠️ El token queda guardado en el navegador de esa computadora. Usá un token
> de sistema con permisos mínimos, rotalo seguido y no uses esta app en un
> equipo compartido con gente ajena.

#### Mensajes entrantes: el puente

El webhook de Meta necesita un servidor y esta app es estática, así que los
entrantes llegan por un **puente**: un endpoint JSON donde tu webhook deposita
los mensajes. El CRM lo consulta cada 8 segundos y crea las conversaciones.

Cada mensaje tiene que verse así:

```json
[
  { "id": "wamid.xxx", "from": "5491133445566", "name": "Camila", "text": "Hola!", "ts": 1735689600000 }
]
```

También acepta un objeto de objetos, que es lo que devuelve Firebase Realtime
Database. Ejemplo mínimo con Google Apps Script publicado como aplicación web:

```javascript
function doGet(e) {
  // verificación inicial de Meta
  if (e.parameter['hub.verify_token'] === 'TU_TOKEN') {
    return ContentService.createTextOutput(e.parameter['hub.challenge']);
  }
  // lectura del buzón
  const buzon = PropertiesService.getScriptProperties().getProperty('buzon') || '[]';
  return ContentService.createTextOutput(buzon).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  const msgs = [];
  (body.entry || []).forEach(function (entry) {
    (entry.changes || []).forEach(function (ch) {
      const v = ch.value || {};
      const perfil = ((v.contacts || [])[0] || {}).profile || {};
      (v.messages || []).forEach(function (m) {
        msgs.push({
          id: m.id, from: m.from, name: perfil.name || '',
          text: (m.text || {}).body || '[' + m.type + ']',
          ts: Number(m.timestamp) * 1000
        });
      });
    });
  });
  const props = PropertiesService.getScriptProperties();
  const buzon = JSON.parse(props.getProperty('buzon') || '[]').concat(msgs).slice(-200);
  props.setProperty('buzon', JSON.stringify(buzon));
  return ContentService.createTextOutput('ok');
}
```

Pegá la URL `/exec` en **URL del endpoint JSON** y activá el puente. Mientras
tanto, **Registrar mensaje entrante a mano** deja cargar un mensaje que dispara
las automatizaciones igual que uno real.

---

## Dónde viven los datos

Todo se guarda en el `localStorage` del navegador. No hay servidor propio ni
telemetría: los datos no salen de la computadora salvo que actives la
sincronización.

- **Respaldo**: Ajustes → Datos y respaldo → *Descargar respaldo* (`.json`).
  Restaurar carga ese archivo tal cual.
- **Sincronización opcional**: apuntá a tu propia Firebase Realtime Database
  (`https://tu-proyecto-default-rtdb.firebaseio.com` + un nodo). Sube cada 30
  segundos y podés bajar a mano.
  Es sincronización simple: **gana el último cambio**. Si dos personas editan a
  la vez, la última en subir pisa a la anterior. Para equipos chicos con turnos
  separados alcanza; para escritura concurrente real hace falta un backend.
- **Empezar de cero**: borra contactos, conversaciones y negocios de ejemplo y
  conserva etiquetas, etapas, plantillas y respuestas rápidas.

Los roles del equipo organizan asignaciones y reportes, pero no son control de
acceso: al correr todo en el navegador, cualquiera con la computadora abierta
ve todo.

---

## Estructura

```
CMR/
├── index.html              armazón de la página
├── assets/app.css          sistema de diseño completo (tokens, componentes, temas)
└── js/
    ├── core.js             utilidades, resortes de animación, store y persistencia
    ├── data.js             esquema, migraciones y generador del espacio de demostración
    ├── ui.js               avisos, modales, cajones, menús, sonido
    ├── charts.js           gráficos SVG con capa de hover y vista en tabla
    ├── wa.js               capa WhatsApp, automatizaciones, puente y campañas
    ├── view-inbox.js       bandeja de entrada
    ├── view-contacts.js    contactos
    ├── view-pipeline.js    embudo Kanban
    ├── view-campaigns.js   campañas
    ├── view-automations.js automatizaciones
    ├── view-analytics.js   métricas
    ├── view-settings.js    ajustes y sincronización
    └── app.js              navegación, paleta de comandos, atajos y guía inicial
```

Sin dependencias ni compilación: scripts clásicos, por eso funciona también
abriendo el archivo directamente (`file://`). Las únicas peticiones externas
son las tipografías de Google Fonts, que tienen alternativa del sistema si no
hay conexión.

## Accesibilidad y preferencias

La interfaz respeta `prefers-reduced-motion` (reemplaza los resortes por
fundidos), `prefers-reduced-transparency` (opaca los materiales) y
`prefers-contrast: more` (bordes definidos). El tema sigue al sistema si lo
dejás en automático. La paleta de los gráficos está validada para las tres
formas de daltonismo y toda visualización tiene su equivalente en tabla.
