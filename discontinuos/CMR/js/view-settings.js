/* =========================================================================
   Nexo CRM · ajustes
   Conexión con WhatsApp, negocio, equipo, catálogos, apariencia y datos.
   ========================================================================= */
(function (NS) {
  'use strict';

  const util = NS.util, dom = NS.dom, store = NS.store, ui = NS.ui, wa = NS.wa;
  const el = dom.el, esc = util.esc, icon = dom.icon;

  const TABS = [
    { k: 'conexion', label: 'Conexión', icon: 'whatsapp' },
    { k: 'negocio', label: 'Negocio', icon: 'building' },
    { k: 'equipo', label: 'Equipo', icon: 'users' },
    { k: 'etiquetas', label: 'Etiquetas', icon: 'tag' },
    { k: 'respuestas', label: 'Respuestas rápidas', icon: 'bolt' },
    { k: 'plantillas', label: 'Plantillas', icon: 'template' },
    { k: 'embudo', label: 'Etapas', icon: 'kanban' },
    { k: 'apariencia', label: 'Apariencia', icon: 'sun' },
    { k: 'datos', label: 'Datos y respaldo', icon: 'archive' }
  ];

  const COLORES = ['blue', 'magenta', 'amber', 'green', 'violet', 'danger', 'neutral'];
  const state = { tab: 'conexion' };
  let root;

  /* -------------------------------------------------------------- render */
  function render() {
    root.innerHTML =
      '<div class="tabs" style="overflow-x:auto;padding:0 12px;flex:none">' +
      TABS.map(function (t) {
        return '<button class="tab" data-tab="' + t.k + '" aria-selected="' + (state.tab === t.k) + '">' +
          esc(t.label) + '</button>';
      }).join('') + '</div>' +
      '<div class="scroll pad-lg" style="flex:1" id="st-body"></div>';

    const body = root.querySelector('#st-body');
    body.innerHTML = '<div style="max-width:820px;margin:0 auto">' + ({
      conexion: conexionHTML, negocio: negocioHTML, equipo: equipoHTML, etiquetas: etiquetasHTML,
      respuestas: respuestasHTML, plantillas: plantillasHTML, embudo: embudoHTML,
      apariencia: aparienciaHTML, datos: datosHTML
    }[state.tab])() + '</div>';

  }

  function section(title, sub, inner) {
    return '<div class="card" style="margin-bottom:16px">' +
      '<div class="card-head"><div class="stack" style="gap:1px;min-width:0">' +
      '<span class="t-md">' + esc(title) + '</span>' +
      (sub ? '<span class="t-xs faint">' + esc(sub) + '</span>' : '') +
      '</div></div>' +
      '<div class="card-pad stack" style="gap:14px">' + inner + '</div></div>';
  }

  function switchRow(id, label, sub, on) {
    return '<div class="row-gap" style="gap:11px;align-items:flex-start">' +
      '<button class="switch" role="switch" aria-checked="' + (on ? 'true' : 'false') + '" data-switch="' + id + '"></button>' +
      '<div class="stack" style="gap:1px;min-width:0">' +
      '<span class="t-sm strong">' + esc(label) + '</span>' +
      (sub ? '<span class="t-xs faint">' + esc(sub) + '</span>' : '') +
      '</div></div>';
  }

  /* ------------------------------------------------------------- conexión */
  function conexionHTML() {
    const c = store.state.connection;
    const modos = [
      {
        k: 'demo', icon: 'sparkle', title: 'Demostración',
        desc: 'Todo simulado, con mensajes de ejemplo que llegan solos. Ideal para probar y capacitar al equipo.'
      },
      {
        k: 'link', icon: 'link', title: 'Envío por enlace',
        desc: 'Sin API ni costos: el CRM abre WhatsApp con el mensaje escrito y vos apretás enviar. Funciona con cualquier número.'
      },
      {
        k: 'cloud', icon: 'whatsapp', title: 'API oficial de WhatsApp',
        desc: 'Envío automático, plantillas y campañas reales. Requiere una cuenta de WhatsApp Business en Meta.'
      }
    ];

    return '<div class="section-title"><span class="t-display">Conexión</span></div>' +
      '<p class="t-sm muted" style="margin-bottom:18px;max-width:600px">Elegí cómo querés que el CRM se comunique con WhatsApp. ' +
      'Podés empezar en demostración, pasar a enlace mientras tramitás la cuenta y activar la API oficial cuando esté lista.</p>' +

      '<div class="stack" style="gap:9px;margin-bottom:18px">' +
      modos.map(function (m) {
        return '<button class="choice" data-mode="' + m.k + '" aria-checked="' + (c.mode === m.k) + '">' +
          '<span class="choice-mark">' + icon(m.icon, 18) + '</span>' +
          '<span class="stack" style="gap:3px;min-width:0">' +
          '<span class="t-sm strong">' + esc(m.title) + '</span>' +
          '<span class="t-xs faint">' + esc(m.desc) + '</span>' +
          '</span></button>';
      }).join('') + '</div>' +

      (c.mode === 'cloud' ? section('Credenciales de Meta',
        'Se guardan en este navegador. No las compartas ni las subas a un repositorio público.',
        '<div class="callout" data-kind="warn">' + icon('warn', 16) +
        '<div>Al ser una app que corre en el navegador, el token queda accesible para quien use esta computadora. ' +
        'Usá un token de sistema con permisos mínimos y rotalo periódicamente.</div></div>' +
        '<div class="grid-2">' +
        field('phoneNumberId', 'ID del número de teléfono', c.phoneNumberId, 'Phone number ID') +
        field('wabaId', 'ID de la cuenta (WABA)', c.wabaId, 'WhatsApp Business Account ID') +
        '</div>' +
        field('token', 'Token de acceso', c.token, 'EAAG…', 'password') +
        '<div class="grid-2">' +
        field('graphVersion', 'Versión de la API', c.graphVersion, 'v21.0') +
        field('verifyToken', 'Token de verificación del webhook', c.verifyToken, 'Lo inventás vos') +
        '</div>' +
        '<div class="row-gap" style="gap:8px">' +
        '<button class="btn btn-primary" data-act="test">' + icon('shield', 15) + 'Probar conexión</button>' +
        '<button class="btn btn-outline" data-act="fetch-tpl">' + icon('download', 15) + 'Traer plantillas</button>' +
        '</div>' +
        (c.verifiedAt ? '<div class="callout" data-kind="ok">' + icon('check', 16) +
          '<div>Conectado como <b>' + esc(c.verifiedName || '—') + '</b> · ' + esc(c.displayNumber || '') +
          (c.quality ? ' · calidad ' + esc(c.quality) : '') +
          '<br><span class="t-xs faint">Verificado ' + esc(util.relTime(c.verifiedAt)) + '</span></div></div>' : '')
      ) : '') +

      (c.mode === 'cloud' ? section('Mensajes entrantes',
        'El webhook de Meta necesita un servidor. El puente lee los mensajes desde un endpoint JSON.',
        '<ol class="t-sm muted" style="margin:0;padding-left:18px;line-height:1.9">' +
        '<li>En Meta → WhatsApp → Configuración, apuntá el webhook a tu servidor o Apps Script.</li>' +
        '<li>Usá <code class="t-num">' + esc(c.verifyToken || 'tu-token') + '</code> como token de verificación.</li>' +
        '<li>Ese servicio guarda cada mensaje como <code class="t-num">{from, name, text, ts, id}</code>.</li>' +
        '<li>Pegá acá la URL pública que devuelve ese JSON. El CRM la consulta cada 8 segundos.</li>' +
        '</ol>' +
        switchRow('bridge', 'Activar puente de entrada', 'Consulta el endpoint y crea las conversaciones automáticamente', c.bridge.enabled) +
        field('bridgeUrl', 'URL del endpoint JSON', c.bridge.url, 'https://tu-proyecto.firebaseio.com/whatsapp_inbox.json') +
        (c.bridge.lastPoll ? '<div class="t-xs faint">Última consulta ' + esc(util.relTime(c.bridge.lastPoll)) +
          (c.bridge.error ? ' · <span style="color:var(--danger-fg)">' + esc(c.bridge.error) + '</span>' : '') + '</div>' : '') +
        '<div class="row-gap"><button class="btn btn-outline btn-sm" data-act="manual-in">' + icon('plus', 14) +
        'Registrar mensaje entrante a mano</button></div>'
      ) : '') +

      (c.mode === 'link' ? section('Cómo funciona el modo enlace', '',
        '<div class="callout" data-kind="info">' + icon('info', 16) +
        '<div>Al enviar, se abre WhatsApp Web o la app con el texto ya escrito y el número cargado. ' +
        'Vos confirmás el envío. El mensaje queda registrado en el historial del CRM, ' +
        'pero no hay confirmación de entrega ni de lectura, y las campañas no se envían solas.</div></div>' +
        field('displayNumber', 'Tu número de WhatsApp (para mostrar)', c.displayNumber, '5491133445566')
      ) : '') +

      (c.mode === 'demo' ? section('Espacio de demostración', '',
        '<div class="callout" data-kind="ok">' + icon('check', 16) +
        '<div>Nada sale a WhatsApp. Los envíos se simulan con sus tildes de entregado y leído, ' +
        'y cada tanto llega un mensaje nuevo para que puedas ver la bandeja en movimiento.</div></div>' +
        switchRow('simulator', 'Simular mensajes entrantes', 'Llega un mensaje cada 20 a 70 segundos', store.state.settings.simulator) +
        '<div class="row-gap" style="gap:8px">' +
        '<button class="btn btn-outline btn-sm" data-act="manual-in">' + icon('plus', 14) + 'Simular un mensaje ahora</button>' +
        '</div>'
      ) : '');
  }

  function field(id, label, value, placeholder, type) {
    return '<div class="field"><label class="label">' + esc(label) + '</label>' +
      '<input class="input" type="' + (type || 'text') + '" data-conf="' + id + '" value="' + esc(value || '') +
      '" placeholder="' + esc(placeholder || '') + '" autocomplete="off"></div>';
  }

  /* -------------------------------------------------------------- negocio */
  function negocioHTML() {
    const w = store.state.workspace;
    const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    return '<div class="section-title"><span class="t-display">Negocio</span></div>' +
      section('Identidad', 'Aparece en los mensajes automáticos y en las plantillas',
        '<div class="grid-2">' +
        field('wsName', 'Nombre del negocio', w.name) +
        field('wsPhone', 'Teléfono principal', w.phone, '5491133445566') +
        '</div>' +
        '<div class="grid-2">' +
        '<div class="field"><label class="label">Moneda</label>' +
        '<select class="select" data-conf="wsCurrency">' +
        ['ARS', 'USD', 'EUR', 'CLP', 'MXN', 'COP', 'PEN', 'UYU', 'BRL'].map(function (m) {
          return '<option value="' + m + '"' + (w.currency === m ? ' selected' : '') + '>' + m + '</option>';
        }).join('') + '</select></div>' +
        field('wsTagline', 'Descripción corta', w.tagline) +
        '</div>'
      ) +
      section('Horario de atención', 'Define cuándo se dispara el aviso de ausencia',
        switchRow('hoursEnabled', 'Aplicar horario', 'Fuera de este rango se considera fuera de horario', w.hours.enabled) +
        '<div class="grid-2">' +
        '<div class="field"><label class="label">Desde</label><input class="input" type="time" data-conf="hoursFrom" value="' + esc(w.hours.from) + '"></div>' +
        '<div class="field"><label class="label">Hasta</label><input class="input" type="time" data-conf="hoursTo" value="' + esc(w.hours.to) + '"></div>' +
        '</div>' +
        '<div class="field"><label class="label">Días</label><div class="pills">' +
        DIAS.map(function (d, i) {
          return '<button class="pill" data-day="' + i + '" aria-pressed="' + (w.hours.days.indexOf(i) >= 0) + '">' + d + '</button>';
        }).join('') + '</div></div>'
      ) +
      section('Mensajes automáticos', 'Podés usar {{nombre}} y {{negocio}}',
        '<div class="field"><label class="label">Bienvenida</label>' +
        '<textarea class="textarea" data-conf="wsWelcome" rows="3">' + esc(w.welcomeMessage) + '</textarea></div>' +
        '<div class="field"><label class="label">Fuera de horario</label>' +
        '<textarea class="textarea" data-conf="wsAway" rows="3">' + esc(w.awayMessage) + '</textarea></div>'
      ) +
      section('Objetivos de servicio (SLA)', 'Se usan para marcar los tiempos en Métricas',
        '<div class="grid-2">' +
        '<div class="field"><label class="label">Primera respuesta (minutos)</label>' +
        '<input class="input" type="number" min="1" data-conf="slaFirst" value="' + store.state.settings.sla.firstResponse + '"></div>' +
        '<div class="field"><label class="label">Resolución (minutos)</label>' +
        '<input class="input" type="number" min="1" data-conf="slaRes" value="' + store.state.settings.sla.resolution + '"></div>' +
        '</div>'
      );
  }

  /* --------------------------------------------------------------- equipo */
  function equipoHTML() {
    const st = store.state;
    return '<div class="section-title"><span class="t-display">Equipo</span>' +
      '<span class="spacer"></span>' +
      '<button class="btn btn-sm btn-primary" data-act="new-agent">' + icon('plus', 14) + 'Agregar agente</button></div>' +
      '<div class="card"><div class="stack">' +
      st.agents.map(function (a) {
        const convs = st.conversations.filter(function (c) { return c.assignedTo === a.id; }).length;
        return '<div class="mini-item" style="margin:5px 8px;cursor:default">' +
          ui.avatarHTML(a.name, { seed: a.id, status: a.status }) +
          '<div class="stack" style="gap:1px;min-width:0;flex:1">' +
          '<span class="t-sm strong truncate">' + esc(a.name) +
          (a.id === (store.me() || {}).id ? ' <span class="chip" data-color="accent">vos</span>' : '') + '</span>' +
          '<span class="t-xs faint truncate">' + esc(a.email || 'sin email') + ' · ' + convs + ' conversaciones</span>' +
          '</div>' +
          '<span class="chip" data-color="' + (a.role === 'admin' ? 'violet' : a.role === 'supervisor' ? 'blue' : 'neutral') + '">' +
          esc(a.role) + '</span>' +
          '<button class="btn btn-ghost btn-icon btn-sm" data-act="agent-menu" data-id="' + a.id + '">' + icon('more', 15) + '</button>' +
          '</div>';
      }).join('') +
      '</div></div>' +
      '<div class="callout" data-kind="info" style="margin-top:14px">' + icon('info', 16) +
      '<div>Los roles organizan el trabajo y las asignaciones. Como la app corre íntegramente en el navegador, ' +
      'no reemplazan a un control de acceso del servidor: para trabajo compartido real, activá la sincronización ' +
      'en <b>Datos y respaldo</b>.</div></div>';
  }

  /* ------------------------------------------------------------ etiquetas */
  function etiquetasHTML() {
    return '<div class="section-title"><span class="t-display">Etiquetas</span>' +
      '<span class="spacer"></span>' +
      '<button class="btn btn-sm btn-primary" data-act="new-tag">' + icon('plus', 14) + 'Nueva etiqueta</button></div>' +
      '<div class="card"><div class="stack">' +
      store.state.tags.map(function (t) {
        const n = store.state.contacts.filter(function (c) { return c.tags.indexOf(t.id) >= 0; }).length;
        return '<div class="mini-item" style="margin:5px 8px;cursor:default">' +
          ui.tagHTML(t) +
          '<span class="t-xs faint">' + n + ' contactos</span>' +
          '<span class="spacer"></span>' +
          '<button class="btn btn-ghost btn-icon btn-sm" data-act="edit-tag" data-id="' + t.id + '">' + icon('edit', 14) + '</button>' +
          '<button class="btn btn-ghost btn-icon btn-sm" data-act="del-tag" data-id="' + t.id + '">' + icon('trash', 14) + '</button>' +
          '</div>';
      }).join('') + '</div></div>';
  }

  /* --------------------------------------------------- respuestas rápidas */
  function respuestasHTML() {
    return '<div class="section-title"><span class="t-display">Respuestas rápidas</span>' +
      '<span class="spacer"></span>' +
      '<button class="btn btn-sm btn-primary" data-act="new-qr">' + icon('plus', 14) + 'Nueva respuesta</button></div>' +
      '<p class="t-sm muted" style="margin-bottom:14px">En el chat escribí <span class="qr-key">/</span> seguido del atajo para insertarla al instante.</p>' +
      '<div class="stack" style="gap:9px">' +
      store.state.quickReplies.map(function (r) {
        return '<div class="card card-pad">' +
          '<div class="row-gap" style="gap:9px;margin-bottom:7px">' +
          '<span class="qr-key">/' + esc(r.shortcut) + '</span>' +
          '<span class="t-sm strong truncate">' + esc(r.title) + '</span>' +
          '<span class="spacer"></span>' +
          '<button class="btn btn-ghost btn-icon btn-sm" data-act="edit-qr" data-id="' + r.id + '">' + icon('edit', 14) + '</button>' +
          '<button class="btn btn-ghost btn-icon btn-sm" data-act="del-qr" data-id="' + r.id + '">' + icon('trash', 14) + '</button>' +
          '</div>' +
          '<div class="t-sm muted">' + util.waFormat(r.body) + '</div>' +
          '</div>';
      }).join('') + '</div>';
  }

  /* ------------------------------------------------------------ plantillas */
  function plantillasHTML() {
    return '<div class="section-title"><span class="t-display">Plantillas</span>' +
      '<span class="spacer"></span>' +
      '<button class="btn btn-sm btn-primary" data-act="new-tpl">' + icon('plus', 14) + 'Nueva plantilla</button></div>' +
      '<div class="callout" data-kind="info" style="margin-bottom:14px">' + icon('info', 16) +
      '<div>WhatsApp exige plantillas aprobadas por Meta para iniciar conversaciones fuera de la ventana de 24 horas. ' +
      'Con la API oficial conectada podés traer las tuyas desde <b>Conexión → Traer plantillas</b>.</div></div>' +
      '<div class="stack" style="gap:9px">' +
      store.state.templates.map(function (t) {
        return '<div class="card card-pad">' +
          '<div class="row-gap" style="gap:8px;margin-bottom:8px">' +
          '<span class="t-sm strong truncate">' + esc(t.name) + '</span>' +
          '<span class="chip" data-color="' + (t.category === 'MARKETING' ? 'magenta' : 'blue') + '">' + esc(t.category) + '</span>' +
          '<span class="chip" data-color="' + (t.status === 'aprobada' ? 'green' : 'amber') + '">' + esc(t.status) + '</span>' +
          '<span class="t-xs faint">' + esc(t.language) + '</span>' +
          '<span class="spacer"></span>' +
          (t.remote ? '<span class="t-xs faint">de Meta</span>' :
            '<button class="btn btn-ghost btn-icon btn-sm" data-act="edit-tpl" data-id="' + t.id + '">' + icon('edit', 14) + '</button>' +
            '<button class="btn btn-ghost btn-icon btn-sm" data-act="del-tpl" data-id="' + t.id + '">' + icon('trash', 14) + '</button>') +
          '</div>' +
          (t.header ? '<div class="t-sm strong">' + esc(t.header) + '</div>' : '') +
          '<div class="t-sm muted">' + util.waFormat(t.body) + '</div>' +
          (t.footer ? '<div class="t-xs faint" style="margin-top:5px">' + esc(t.footer) + '</div>' : '') +
          '</div>';
      }).join('') + '</div>';
  }

  /* --------------------------------------------------------------- embudo */
  function embudoHTML() {
    const stages = store.state.stages.slice().sort(function (a, b) { return a.order - b.order; });
    return '<div class="section-title"><span class="t-display">Etapas del embudo</span>' +
      '<span class="spacer"></span>' +
      '<button class="btn btn-sm btn-primary" data-act="new-stage">' + icon('plus', 14) + 'Nueva etapa</button></div>' +
      '<div class="card"><div class="stack">' +
      stages.map(function (s, i) {
        const n = store.state.deals.filter(function (d) { return d.stageId === s.id; }).length;
        return '<div class="mini-item" style="margin:5px 8px;cursor:default">' +
          '<i class="dot" style="color:var(--' + ({ blue: 'c1', magenta: 'c2', amber: 'c3', green: 'c4', violet: 'c5' }[s.color] || 'c-neutral') + ')"></i>' +
          '<div class="stack" style="gap:1px;min-width:0;flex:1">' +
          '<span class="t-sm strong truncate">' + esc(s.name) + '</span>' +
          '<span class="t-xs faint">' + n + ' negocios · ' +
          ({ open: 'en curso', won: 'cierre ganado', lost: 'cierre perdido' }[s.kind] || s.kind) + '</span>' +
          '</div>' +
          '<button class="btn btn-ghost btn-icon btn-sm" data-act="stage-up" data-id="' + s.id + '"' + (i === 0 ? ' disabled' : '') + '>' + icon('arrowUp', 14) + '</button>' +
          '<button class="btn btn-ghost btn-icon btn-sm" data-act="stage-down" data-id="' + s.id + '"' + (i === stages.length - 1 ? ' disabled' : '') + '>' + icon('arrowDown', 14) + '</button>' +
          '<button class="btn btn-ghost btn-icon btn-sm" data-act="edit-stage" data-id="' + s.id + '">' + icon('edit', 14) + '</button>' +
          '<button class="btn btn-ghost btn-icon btn-sm" data-act="del-stage" data-id="' + s.id + '">' + icon('trash', 14) + '</button>' +
          '</div>';
      }).join('') + '</div></div>';
  }

  /* ----------------------------------------------------------- apariencia */
  function aparienciaHTML() {
    const s = store.state.settings;
    return '<div class="section-title"><span class="t-display">Apariencia</span></div>' +
      section('Tema', 'La app se adapta también a la preferencia del sistema',
        '<div class="segmented" id="theme-seg">' +
        [['dark', 'Oscuro'], ['light', 'Claro'], ['auto', 'Automático']].map(function (t) {
          return '<button data-theme="' + t[0] + '" aria-selected="' + (s.theme === t[0]) + '">' + t[1] + '</button>';
        }).join('') + '</div>' +
        '<div class="field"><label class="label">Densidad</label>' +
        '<div class="segmented" id="density-seg">' +
        [['comfortable', 'Cómoda'], ['compact', 'Compacta']].map(function (t) {
          return '<button data-density="' + t[0] + '" aria-selected="' + (s.density === t[0]) + '">' + t[1] + '</button>';
        }).join('') + '</div></div>'
      ) +
      section('Avisos', '',
        switchRow('sound', 'Sonido al recibir y enviar', 'Tonos cortos, sólo en momentos con significado', s.sound) +
        switchRow('desktopNotifications', 'Notificaciones del sistema', 'Avisos aunque la pestaña esté en segundo plano', s.desktopNotifications)
      ) +
      section('Firma', 'Se agrega al final de cada mensaje que enviás',
        switchRow('signature', 'Agregar firma', '', s.signature.enabled) +
        '<div class="field"><input class="input" data-conf="signatureText" value="' + esc(s.signature.text) +
        '" placeholder="— Ana, de Maresia"></div>'
      );
  }

  /* --------------------------------------------------------------- datos */
  function datosHTML() {
    const st = store.state;
    const tam = Math.round(JSON.stringify(st).length / 1024);
    return '<div class="section-title"><span class="t-display">Datos y respaldo</span></div>' +
      section('Este espacio', 'Todo se guarda en el navegador de esta computadora',
        '<dl class="kv">' +
        '<dt>Contactos</dt><dd>' + util.num(st.contacts.length) + '</dd>' +
        '<dt>Conversaciones</dt><dd>' + util.num(st.conversations.length) + '</dd>' +
        '<dt>Mensajes</dt><dd>' + util.num(util.sum(st.conversations, function (c) { return c.messages.length; })) + '</dd>' +
        '<dt>Negocios</dt><dd>' + util.num(st.deals.length) + '</dd>' +
        '<dt>Tamaño</dt><dd>' + util.num(tam) + ' KB</dd>' +
        '</dl>' +
        '<div class="row-gap wrap" style="gap:8px">' +
        '<button class="btn btn-outline" data-act="backup">' + icon('download', 15) + 'Descargar respaldo</button>' +
        '<button class="btn btn-outline" data-act="restore">' + icon('upload', 15) + 'Restaurar respaldo</button>' +
        '<input type="file" id="restore-file" class="hide" accept=".json,application/json">' +
        '</div>'
      ) +
      section('Sincronización entre dispositivos', 'Opcional. Guarda una copia del espacio en tu propia base de datos',
        '<div class="callout" data-kind="warn">' + icon('warn', 16) +
        '<div>Sincronización simple: <b>gana el último cambio</b>. Si dos personas editan a la vez, ' +
        'la última en subir pisa a la anterior. Para equipos chicos con turnos separados funciona bien.</div></div>' +
        switchRow('sync', 'Activar sincronización', 'Sube automáticamente cada 30 segundos', st.sync.enabled) +
        field('syncUrl', 'URL base de Firebase Realtime Database', st.sync.url, 'https://tu-proyecto-default-rtdb.firebaseio.com') +
        field('syncNode', 'Nodo', st.sync.node, 'nexo-crm') +
        '<div class="row-gap wrap" style="gap:8px">' +
        '<button class="btn btn-outline" data-act="push">' + icon('upload', 15) + 'Subir ahora</button>' +
        '<button class="btn btn-outline" data-act="pull">' + icon('download', 15) + 'Bajar ahora</button>' +
        '</div>' +
        (st.sync.lastPush ? '<div class="t-xs faint">Última subida ' + esc(util.relTime(st.sync.lastPush)) + '</div>' : '') +
        (st.sync.lastPull ? '<div class="t-xs faint">Última bajada ' + esc(util.relTime(st.sync.lastPull)) + '</div>' : '')
      ) +
      section('Zona sensible', '',
        '<div class="row-gap wrap" style="gap:8px">' +
        '<button class="btn btn-outline" data-act="clear-demo">' + icon('sparkle', 15) + 'Empezar de cero (sin datos de ejemplo)</button>' +
        '<button class="btn btn-danger" data-act="reset">' + icon('trash', 15) + 'Borrar todo y reiniciar</button>' +
        '</div>'
      );
  }

  /* ------------------------------------------------------------- eventos */
  /* Delegación registrada una sola vez, al montar. */
  function wireOnce() {
    dom.on(root, 'click', '[data-tab]', function () { state.tab = this.dataset.tab; render(); });

    /* --- conexión --- */
    dom.on(root, 'click', '[data-mode]', function () {
      const m = this.dataset.mode;
      store.commit(function (s) { s.connection.mode = m; }, 'connection');
      wa.restartServices();
      ui.toast('Modo: ' + wa.modeLabel(), 'ok');
      render();
      NS.app.refreshChrome();
    });

    dom.on(root, 'change', '[data-conf]', function () { saveConf(this.dataset.conf, this.value); });
    dom.on(root, 'click', '[data-switch]', function () {
      const on = this.getAttribute('aria-checked') !== 'true';
      this.setAttribute('aria-checked', on ? 'true' : 'false');
      saveSwitch(this.dataset.switch, on);
    });

    dom.on(root, 'click', '[data-day]', function () {
      const d = Number(this.dataset.day);
      store.commit(function (s) {
        const days = s.workspace.hours.days;
        const i = days.indexOf(d);
        if (i >= 0) days.splice(i, 1); else days.push(d);
        days.sort();
      }, 'workspace');
      this.setAttribute('aria-pressed', store.state.workspace.hours.days.indexOf(d) >= 0);
    });

    dom.on(root, 'click', '[data-act="test"]', function () {
      const btn = this;
      btn.classList.add('is-disabled');
      btn.innerHTML = icon('refresh', 15) + 'Probando…';
      wa.testConnection().then(function (j) {
        ui.toast('Conectado a ' + (j.verified_name || j.display_phone_number || 'WhatsApp'), 'ok');
        ui.sound('done');
        render();
      }).catch(function (e) {
        ui.toast('No se pudo conectar: ' + e.message, 'danger');
        btn.classList.remove('is-disabled');
        btn.innerHTML = icon('shield', 15) + 'Probar conexión';
      });
    });

    dom.on(root, 'click', '[data-act="fetch-tpl"]', function () {
      wa.fetchTemplates().then(function (l) {
        ui.toast('Se trajeron ' + l.length + ' plantillas', 'ok');
      }).catch(function (e) { ui.toast(e.message, 'danger'); });
    });

    dom.on(root, 'click', '[data-act="manual-in"]', manualInbound);

    /* --- equipo --- */
    dom.on(root, 'click', '[data-act="new-agent"]', function () { editAgent(null); });
    dom.on(root, 'click', '[data-act="agent-menu"]', function () { agentMenu(this.dataset.id, this); });

    /* --- etiquetas --- */
    dom.on(root, 'click', '[data-act="new-tag"]', function () { editTag(null); });
    dom.on(root, 'click', '[data-act="edit-tag"]', function () { editTag(this.dataset.id); });
    dom.on(root, 'click', '[data-act="del-tag"]', function () {
      const id = this.dataset.id, t = store.tag(id);
      ui.confirm({ title: 'Eliminar etiqueta', message: 'Se quita “' + t.name + '” de todos los contactos.', danger: true, confirmText: 'Eliminar' })
        .then(function (ok) {
          if (!ok) return;
          store.commit(function (s) {
            s.tags = s.tags.filter(function (x) { return x.id !== id; });
            s.contacts.forEach(function (c) { c.tags = c.tags.filter(function (x) { return x !== id; }); });
            s.conversations.forEach(function (c) { c.tags = c.tags.filter(function (x) { return x !== id; }); });
          }, 'tag');
          render();
        });
    });

    /* --- respuestas rápidas --- */
    dom.on(root, 'click', '[data-act="new-qr"]', function () { editQR(null); });
    dom.on(root, 'click', '[data-act="edit-qr"]', function () { editQR(this.dataset.id); });
    dom.on(root, 'click', '[data-act="del-qr"]', function () {
      const id = this.dataset.id;
      store.commit(function (s) { s.quickReplies = s.quickReplies.filter(function (x) { return x.id !== id; }); }, 'qr');
      render();
    });

    /* --- plantillas --- */
    dom.on(root, 'click', '[data-act="new-tpl"]', function () { editTemplate(null); });
    dom.on(root, 'click', '[data-act="edit-tpl"]', function () { editTemplate(this.dataset.id); });
    dom.on(root, 'click', '[data-act="del-tpl"]', function () {
      const id = this.dataset.id;
      store.commit(function (s) { s.templates = s.templates.filter(function (x) { return x.id !== id; }); }, 'tpl');
      render();
    });

    /* --- etapas --- */
    dom.on(root, 'click', '[data-act="new-stage"]', function () { editStage(null); });
    dom.on(root, 'click', '[data-act="edit-stage"]', function () { editStage(this.dataset.id); });
    dom.on(root, 'click', '[data-act="stage-up"]', function () { moveStage(this.dataset.id, -1); });
    dom.on(root, 'click', '[data-act="stage-down"]', function () { moveStage(this.dataset.id, 1); });
    dom.on(root, 'click', '[data-act="del-stage"]', function () {
      const id = this.dataset.id;
      const n = store.state.deals.filter(function (d) { return d.stageId === id; }).length;
      if (n) { ui.toast('Movés primero los ' + n + ' negocios de esta etapa', 'warn'); return; }
      store.commit(function (s) { s.stages = s.stages.filter(function (x) { return x.id !== id; }); }, 'stage');
      render();
    });

    /* --- apariencia --- */
    dom.on(root, 'click', '#theme-seg button', function () {
      const t = this.dataset.theme;
      store.commit(function (s) { s.settings.theme = t; }, 'settings');
      NS.app.applyTheme();
      render();
    });
    dom.on(root, 'click', '#density-seg button', function () {
      const d = this.dataset.density;
      store.commit(function (s) { s.settings.density = d; }, 'settings');
      NS.app.applyTheme();
      render();
    });

    /* --- datos --- */
    dom.on(root, 'click', '[data-act="backup"]', function () {
      util.download('nexo-crm-' + new Date().toISOString().slice(0, 10) + '.json', store.export(), 'application/json');
      ui.toast('Respaldo descargado', 'ok');
    });
    dom.on(root, 'click', '[data-act="restore"]', function () { root.querySelector('#restore-file').click(); });
    dom.on(root, 'change', '#restore-file', function () {
      const f = this.files && this.files[0];
      if (!f) return;
      const fr = new FileReader();
      fr.onload = function () {
        try {
          store.import(fr.result);
          ui.toast('Respaldo restaurado', 'ok');
          setTimeout(function () { location.reload(); }, 700);
        } catch (e) { ui.toast('Archivo inválido: ' + e.message, 'danger'); }
      };
      fr.readAsText(f);
    });
    dom.on(root, 'click', '[data-act="push"]', function () {
      NS.sync.push().then(function () { ui.toast('Datos subidos', 'ok'); render(); })
        .catch(function (e) { ui.toast('No se pudo subir: ' + e.message, 'danger'); });
    });
    dom.on(root, 'click', '[data-act="pull"]', function () {
      ui.confirm({
        title: 'Bajar datos de la nube', danger: true, confirmText: 'Reemplazar',
        message: 'Se reemplaza todo lo que tenés en este navegador por la copia de la nube.'
      }).then(function (ok) {
        if (!ok) return;
        NS.sync.pull().then(function () {
          ui.toast('Datos actualizados', 'ok');
          setTimeout(function () { location.reload(); }, 700);
        }).catch(function (e) { ui.toast('No se pudo bajar: ' + e.message, 'danger'); });
      });
    });
    dom.on(root, 'click', '[data-act="clear-demo"]', function () {
      ui.confirm({
        title: 'Empezar de cero', danger: true, confirmText: 'Empezar limpio',
        message: 'Se borran los contactos, conversaciones y negocios de ejemplo. Se conservan etiquetas, etapas, plantillas y respuestas rápidas.'
      }).then(function (ok) {
        if (!ok) return;
        const nombre = store.state.workspace.name;
        const conexion = store.state.connection;
        const blank = NS.seed.blank(nombre);
        blank.connection = conexion;
        store.state = blank;
        store.save();
        location.reload();
      });
    });
    dom.on(root, 'click', '[data-act="reset"]', function () {
      ui.confirm({
        title: 'Borrar todo', danger: true, confirmText: 'Borrar definitivamente',
        message: 'Se elimina absolutamente todo de este navegador y la app vuelve al estado inicial. Descargá un respaldo antes si querés conservarlo.'
      }).then(function (ok) { if (ok) store.reset(); });
    });
  }

  function saveConf(key, value) {
    store.commit(function (s) {
      switch (key) {
        case 'phoneNumberId': case 'wabaId': case 'token': case 'graphVersion':
        case 'verifyToken': case 'displayNumber':
          s.connection[key] = value.trim(); break;
        case 'bridgeUrl': s.connection.bridge.url = value.trim(); wa.restartServices(); break;
        case 'wsName': s.workspace.name = value; break;
        case 'wsPhone': s.workspace.phone = util.phoneRaw(value); break;
        case 'wsTagline': s.workspace.tagline = value; break;
        case 'wsCurrency': s.workspace.currency = value; break;
        case 'wsWelcome': s.workspace.welcomeMessage = value; break;
        case 'wsAway': s.workspace.awayMessage = value; break;
        case 'hoursFrom': s.workspace.hours.from = value; break;
        case 'hoursTo': s.workspace.hours.to = value; break;
        case 'slaFirst': s.settings.sla.firstResponse = Number(value) || 15; break;
        case 'slaRes': s.settings.sla.resolution = Number(value) || 240; break;
        case 'signatureText': s.settings.signature.text = value; break;
        case 'syncUrl': s.sync.url = value.trim().replace(/\/$/, ''); break;
        case 'syncNode': s.sync.node = value.trim() || 'nexo-crm'; break;
      }
    }, 'settings');
    NS.app.refreshChrome();
  }

  function saveSwitch(key, on) {
    store.commit(function (s) {
      switch (key) {
        case 'bridge': s.connection.bridge.enabled = on; wa.restartServices(); break;
        case 'simulator': s.settings.simulator = on; wa.restartServices(); break;
        case 'hoursEnabled': s.workspace.hours.enabled = on; break;
        case 'sound': s.settings.sound = on; if (on) ui.sound('in'); break;
        case 'desktopNotifications':
          s.settings.desktopNotifications = on;
          if (on) ui.requestNotifications().then(function (ok) {
            if (!ok) {
              store.commit(function (s2) { s2.settings.desktopNotifications = false; }, 'settings');
              ui.toast('El navegador bloqueó las notificaciones', 'warn');
              render();
            }
          });
          break;
        case 'signature': s.settings.signature.enabled = on; break;
        case 'sync': s.sync.enabled = on; NS.sync.autoStart(); break;
      }
    }, 'settings');
  }

  /* -------------------------------------------------------- diálogos ABM */
  function manualInbound() {
    const contactos = store.state.contacts.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    ui.form({
      title: 'Registrar mensaje entrante', icon: 'inbox',
      subtitle: 'Se comporta igual que un mensaje real: dispara las automatizaciones',
      fields: [
        {
          key: 'contactId', label: 'Contacto', type: 'select', value: (contactos[0] || {}).id,
          options: contactos.map(function (c) { return { value: c.id, label: c.name }; })
        },
        { key: 'body', label: 'Mensaje', type: 'textarea', required: true, rows: 3, value: 'Hola! Quería hacer una consulta' }
      ]
    }).then(function (r) {
      if (!r) return;
      const res = wa.receive({ contactId: r.contactId, body: r.body });
      ui.toast('Mensaje recibido', 'ok');
      if (res) NS.app.go('bandeja', { conv: res.conv.id });
    });
  }

  function editAgent(id) {
    const a = id ? store.agent(id) : null;
    ui.form({
      title: a ? 'Editar agente' : 'Nuevo agente', icon: 'users',
      fields: [
        { key: 'name', label: 'Nombre', required: true, value: a ? a.name : '' },
        { key: 'email', label: 'Email', type: 'email', value: a ? a.email : '' },
        {
          key: 'role', label: 'Rol', type: 'select', value: a ? a.role : 'agente',
          options: [{ value: 'agente', label: 'Agente' }, { value: 'supervisor', label: 'Supervisor' }, { value: 'admin', label: 'Administrador' }]
        },
        { key: 'active', label: 'Recibe asignaciones', type: 'switch', value: a ? a.active : true }
      ]
    }).then(function (r) {
      if (!r) return;
      store.commit(function (s) {
        if (a) Object.assign(a, r);
        else s.agents.push(Object.assign({ id: util.uid('agent'), status: 'online' }, r));
      }, 'agent');
      render();
    });
  }

  function agentMenu(id, anchor) {
    const a = store.agent(id);
    ui.menu(anchor, [
      { icon: 'edit', label: 'Editar', onClick: function () { editAgent(id); } },
      {
        icon: 'logout', label: 'Entrar como ' + a.name.split(' ')[0], checked: (store.me() || {}).id === id,
        onClick: function () {
          store.commit(function (s) { s.session.agentId = id; }, 'session');
          NS.app.refreshChrome();
          ui.toast('Ahora trabajás como ' + a.name, 'ok');
          render();
        }
      },
      { sep: true },
      {
        icon: 'trash', label: 'Eliminar', variant: 'danger', disabled: store.state.agents.length <= 1,
        onClick: function () {
          if (store.state.agents.length <= 1) return;
          store.commit(function (s) {
            s.agents = s.agents.filter(function (x) { return x.id !== id; });
            s.conversations.forEach(function (c) { if (c.assignedTo === id) c.assignedTo = null; });
            if (s.session.agentId === id) s.session.agentId = s.agents[0].id;
          }, 'agent');
          render();
        }
      }
    ], { align: 'right' });
  }

  function editTag(id, done) {
    const t = id ? store.tag(id) : null;
    ui.form({
      title: t ? 'Editar etiqueta' : 'Nueva etiqueta', icon: 'tag',
      fields: [
        { key: 'name', label: 'Nombre', required: true, value: t ? t.name : '' },
        {
          key: 'color', label: 'Color', type: 'select', value: t ? t.color : 'blue',
          options: COLORES.map(function (c) {
            return {
              value: c, label: {
                blue: 'Azul', magenta: 'Magenta', amber: 'Ámbar', green: 'Verde',
                violet: 'Violeta', danger: 'Rojo', neutral: 'Gris'
              }[c]
            };
          })
        }
      ]
    }).then(function (r) {
      if (!r) return;
      let created = null;
      store.commit(function (s) {
        if (t) Object.assign(t, r);
        else { created = Object.assign({ id: util.uid('tag') }, r); s.tags.push(created); }
      }, 'tag');
      if (root && root.isConnected) render();
      done && done(created || t);
    });
  }

  function editQR(id) {
    const r0 = id ? store.state.quickReplies.find(function (x) { return x.id === id; }) : null;
    ui.form({
      title: r0 ? 'Editar respuesta rápida' : 'Nueva respuesta rápida', icon: 'bolt',
      fields: [
        { key: 'shortcut', label: 'Atajo', required: true, value: r0 ? r0.shortcut : '', hint: 'Sin la barra. Se usa escribiendo /atajo en el chat.' },
        { key: 'title', label: 'Título', required: true, value: r0 ? r0.title : '' },
        {
          key: 'body', label: 'Mensaje', type: 'textarea', required: true, rows: 5, value: r0 ? r0.body : '',
          hint: 'Variables disponibles: {{nombre}}, {{negocio}}, {{telefono}}. Formato: *negrita* _cursiva_'
        }
      ]
    }).then(function (r) {
      if (!r) return;
      r.shortcut = util.slug(r.shortcut);
      store.commit(function (s) {
        if (r0) Object.assign(r0, r);
        else s.quickReplies.push(Object.assign({ id: util.uid('qr') }, r));
      }, 'qr');
      render();
    });
  }

  function editTemplate(id) {
    const t = id ? store.template(id) : null;
    ui.form({
      title: t ? 'Editar plantilla' : 'Nueva plantilla', icon: 'template', size: 'wide',
      fields: [
        { key: 'name', label: 'Nombre técnico', required: true, value: t ? t.name : '', hint: 'Minúsculas y guiones bajos, igual que en Meta. Ej: confirmacion_pedido' },
        {
          key: 'category', label: 'Categoría', type: 'select', value: t ? t.category : 'UTILIDAD',
          options: [{ value: 'UTILIDAD', label: 'Utilidad' }, { value: 'MARKETING', label: 'Marketing' }, { value: 'AUTENTICACION', label: 'Autenticación' }]
        },
        { key: 'language', label: 'Idioma', value: t ? t.language : 'es_AR' },
        { key: 'header', label: 'Encabezado (opcional)', value: t ? t.header : '' },
        {
          key: 'body', label: 'Cuerpo', type: 'textarea', required: true, rows: 5, value: t ? t.body : '',
          hint: 'Usá {{1}}, {{2}}… para las variables.'
        },
        { key: 'footer', label: 'Pie (opcional)', value: t ? t.footer : '' },
        {
          key: 'status', label: 'Estado', type: 'select', value: t ? t.status : 'pendiente',
          options: [{ value: 'aprobada', label: 'Aprobada' }, { value: 'pendiente', label: 'Pendiente' }, { value: 'rechazada', label: 'Rechazada' }]
        }
      ]
    }).then(function (r) {
      if (!r) return;
      const vars = (String(r.body).match(/\{\{\d+\}\}/g) || []).map(function (v, i) { return 'variable' + (i + 1); });
      store.commit(function (s) {
        if (t) Object.assign(t, r, { variables: vars });
        else s.templates.push(Object.assign({ id: util.uid('tpl'), buttons: [], variables: vars }, r));
      }, 'tpl');
      render();
    });
  }

  function editStage(id) {
    const s0 = id ? store.stage(id) : null;
    ui.form({
      title: s0 ? 'Editar etapa' : 'Nueva etapa', icon: 'kanban',
      fields: [
        { key: 'name', label: 'Nombre', required: true, value: s0 ? s0.name : '' },
        {
          key: 'color', label: 'Color', type: 'select', value: s0 ? s0.color : 'blue',
          options: COLORES.map(function (c) { return { value: c, label: c }; })
        },
        {
          key: 'kind', label: 'Tipo', type: 'select', value: s0 ? s0.kind : 'open',
          options: [{ value: 'open', label: 'En curso' }, { value: 'won', label: 'Cierre ganado' }, { value: 'lost', label: 'Cierre perdido' }]
        },
        { key: 'probability', label: 'Probabilidad (%)', type: 'number', value: s0 ? s0.probability : 50, min: 0, max: 100 }
      ]
    }).then(function (r) {
      if (!r) return;
      store.commit(function (s) {
        if (s0) Object.assign(s0, r);
        else s.stages.push(Object.assign({ id: util.uid('st'), order: s.stages.length }, r));
      }, 'stage');
      render();
    });
  }

  function moveStage(id, dir) {
    store.commit(function (s) {
      const list = s.stages.slice().sort(function (a, b) { return a.order - b.order; });
      const i = list.findIndex(function (x) { return x.id === id; });
      const j = i + dir;
      if (j < 0 || j >= list.length) return;
      const tmp = list[i].order; list[i].order = list[j].order; list[j].order = tmp;
    }, 'stage');
    render();
  }

  /* --------------------------------------------- sincronización opcional */
  /* REST de Firebase Realtime Database: sin SDK, sin build, sin dependencias */
  let syncTimer = null;

  NS.sync = {
    endpoint: function () {
      const s = store.state.sync;
      if (!s.url) throw new Error('Falta la URL de la base');
      return s.url.replace(/\/$/, '') + '/' + (s.node || 'nexo-crm') + '.json';
    },
    push: function () {
      const payload = JSON.parse(store.export());
      payload.meta.syncedAt = Date.now();
      return fetch(NS.sync.endpoint(), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        store.commit(function (s) { s.sync.lastPush = Date.now(); }, null);
      });
    },
    pull: function () {
      return fetch(NS.sync.endpoint(), { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (data) {
        if (!data || !data.meta) throw new Error('No hay datos guardados en ese nodo');
        const sync = store.state.sync;
        store.import(data);
        store.state.sync = Object.assign(sync, { lastPull: Date.now() });
        store.save();
      });
    },
    autoStart: function () {
      if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
      if (!store.state.sync.enabled || !store.state.sync.url) return;
      syncTimer = setInterval(function () {
        NS.sync.push().catch(function (e) { console.warn('sync', e); });
      }, 30000);
    }
  };

  /* --------------------------------------------------------------- vista */
  NS.views = NS.views || {};
  NS.views.ajustes = {
    title: 'Ajustes',
    icon: 'gear',
    mount: function (container, params) {
      root = container;
      root.className = 'view stack';
      if (params && params.tab) state.tab = params.tab;
      wireOnce();
      render();
      return { destroy: function () { } };
    }
  };

  NS.settings = {
    newTag: function (cb) { editTag(null, cb); },
    go: function (tab) { NS.app.go('ajustes', { tab: tab }); }
  };

})(window.CRM);
