/* =========================================================================
   Nexo CRM · datos
   Esquema, migraciones y generador determinista del espacio de demostración.
   ========================================================================= */
(function (NS) {
  'use strict';

  const util = NS.util;

  /* PRNG determinista: la demo se ve igual en cada máquina */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a += 0x6D2B79F5;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const NOMBRES = [
    'Camila Ferreyra', 'Nicolás Sosa', 'Valentina Ruiz', 'Matías Ocampo', 'Julieta Bianchi',
    'Federico Paz', 'Agustina Molina', 'Lucas Domínguez', 'Micaela Ledesma', 'Tomás Aguirre',
    'Rocío Vega', 'Santiago Peralta', 'Florencia Cabrera', 'Ignacio Bustos', 'Brenda Quiroga',
    'Emiliano Suárez', 'Sofía Maldonado', 'Gonzalo Herrera', 'Antonella Ríos', 'Damián Correa',
    'Milagros Acosta', 'Joaquín Benítez', 'Guadalupe Silva', 'Ramiro Godoy', 'Abril Fernández',
    'Leandro Cáceres', 'Martina Ibarra', 'Franco Villalba', 'Delfina Roldán', 'Ezequiel Ponce',
    'Carolina Núñez', 'Bruno Zabala'
  ];

  const EMPRESAS = [
    'Kiosco La Esquina', 'Distribuidora Sur', 'Almacén Doña Rosa', 'Bazar Nuevo Siglo', '',
    'Perfumería Aurora', '', 'Mayorista Río Paraná', '', 'Tienda Girasol', '', '',
    'Autoservicio El Trébol', '', 'Farmacia Central', '', 'Regalería Luna', '', '', 'Óptica Visión',
    '', 'Ferretería Don Pedro', '', '', 'Boutique Amapola', '', '', 'Pinturería Colores', '', '',
    'Librería El Ateneo Chico', ''
  ];

  const CIUDADES = [
    'CABA', 'La Plata', 'Rosario', 'Córdoba', 'Mar del Plata', 'Mendoza', 'Salta',
    'San Miguel de Tucumán', 'Neuquén', 'Bahía Blanca', 'Santa Fe', 'Quilmes', 'Morón', 'Tigre'
  ];

  const ORIGENES = ['Instagram', 'Sitio web', 'Recomendación', 'Google', 'Feria', 'WhatsApp directo', 'Marketplace'];

  /* Guiones de conversación: [dirección, texto] · in = cliente, out = negocio */
  const GUIONES = [
    {
      tema: 'Consulta de precio', tag: 'lead',
      msgs: [
        ['in', 'Hola! Buenas tardes 👋 Vi el combo de verano en Instagram, me pasás precio?'],
        ['out', 'Hola {{nombre}}, cómo estás! Te cuento: el *Combo Verano* está {{precio}} con envío incluido a {{ciudad}}.'],
        ['in', 'Buenísimo. Y si llevo 3?'],
        ['out', 'Llevando 3 o más te queda {{precio2}} cada uno. Te reservo?'],
        ['in', 'Dale, reservame 3 🙌'],
        ['out', 'Listo, quedan reservados hasta mañana 18 hs. Te paso el link de pago por acá.']
      ]
    },
    {
      tema: 'Estado de pedido', tag: 'envio',
      msgs: [
        ['in', 'Buen día, quería saber cómo viene mi pedido #{{pedido}}'],
        ['out', 'Buen día {{nombre}}! Tu pedido salió ayer por Correo Argentino, el seguimiento es {{tracking}}.'],
        ['in', 'Perfecto, muchas gracias!'],
        ['out', 'De nada 😊 Cualquier cosa escribinos por acá.']
      ]
    },
    {
      tema: 'Reclamo', tag: 'reclamo',
      msgs: [
        ['in', 'Hola, me llegó el pedido pero falta un producto 😕'],
        ['in', 'Pedí 4 y vinieron 3'],
        ['out', 'Lamento el inconveniente {{nombre}}. Ya lo estoy revisando con depósito, dame 10 minutos.'],
        ['note', 'Verificado con depósito: error de picking. Se reenvía sin cargo.'],
        ['out', 'Confirmado, fue un error nuestro. Te lo despachamos hoy mismo sin costo y te sumo un descuento del 10% en tu próxima compra.'],
        ['in', 'Uf, gracias por la rapidez! Todo bien entonces 🙏']
      ]
    },
    {
      tema: 'Cobranza', tag: 'cobranza',
      msgs: [
        ['out', 'Hola {{nombre}}! Te recuerdo que la factura {{factura}} vence mañana. Cualquier cosa avisame.'],
        ['in', 'Hola! Sí, la paso a pagar hoy a la tarde'],
        ['out', 'Genial, gracias 🙌'],
        ['in', 'Listo, ya transferí. Te mando el comprobante'],
        ['in', '[comprobante-transferencia.pdf]', 'doc'],
        ['out', 'Recibido, ya lo imputo. Gracias {{nombre}}!']
      ]
    },
    {
      tema: 'Mayorista', tag: 'mayorista',
      msgs: [
        ['in', 'Buenas! Tienen lista mayorista? Tengo un local en {{ciudad}}'],
        ['out', 'Hola {{nombre}}! Sí, trabajamos mayorista desde 12 unidades. Te paso la lista actualizada.'],
        ['out', '[lista-mayorista-2024.pdf]', 'doc'],
        ['in', 'Gracias! La reviso y te confirmo el pedido'],
        ['note', 'Local con buen volumen potencial. Hacer seguimiento en 48 hs.']
      ]
    },
    {
      tema: 'Cambio o devolución', tag: 'reclamo',
      msgs: [
        ['in', 'Hola, quería cambiar un talle. Me queda chico'],
        ['out', 'Hola {{nombre}}! Sin problema, tenés 30 días para el cambio. Qué talle necesitás?'],
        ['in', 'El siguiente, M'],
        ['out', 'Perfecto, tengo stock. Te paso la etiqueta de devolución y en cuanto salga te despacho el M.'],
        ['in', 'Genial, gracias 💚']
      ]
    },
    {
      tema: 'Consulta de stock', tag: 'lead',
      msgs: [
        ['in', 'Hola tienen stock del modelo azul?'],
        ['out', 'Hola! Sí, quedan 6 unidades del azul. Te reservo alguna?'],
        ['in', 'Dejame verlo y te aviso'],
        ['out', 'Dale, quedo atento 👍']
      ]
    },
    {
      tema: 'Postventa', tag: 'vip',
      msgs: [
        ['out', 'Hola {{nombre}}! Pasaron unos días desde tu compra, cómo te fue con el producto?'],
        ['in', 'Muy bien! Encantada, ya lo recomendé a dos amigas ✨'],
        ['out', 'Nos alegra muchísimo 🙌 Te dejo un 15% para tu próxima compra: GRACIAS15'],
        ['in', 'Sos un genio, gracias!']
      ]
    },
    {
      tema: 'Negociación', tag: 'mayorista',
      msgs: [
        ['in', 'Hola, recibí la cotización. Se puede mejorar algo el precio pagando al contado?'],
        ['out', 'Hola {{nombre}}! Pagando por transferencia te puedo hacer un 8% adicional.'],
        ['in', 'Y con envío incluido?'],
        ['out', 'Con envío incluido llego hasta un 5%. Igual te sigue quedando muy conveniente por volumen.'],
        ['note', 'Pidió mejora. Margen mínimo aceptable 5%. Autorizado por Marcos.'],
        ['in', 'Ok, lo consulto con mi socio y te digo mañana']
      ]
    },
    {
      tema: 'Primer contacto', tag: 'lead',
      msgs: [
        ['in', 'Hola, buenas!'],
        ['in', 'Me pasaron su contacto, hacen envíos a {{ciudad}}?'],
        ['out', 'Hola {{nombre}}! Sí, enviamos a todo el país. A {{ciudad}} llega en 3 a 5 días hábiles.'],
        ['in', 'Perfecto, después les escribo 😊']
      ]
    }
  ];

  const SIN_RESPUESTA = [
    ['in', 'Hola! Consulta: hacen factura A?'],
    ['in', 'Buenas, sigue disponible el pack x6?'],
    ['in', 'Hola, quería saber si tienen local a la calle 🙂'],
    ['in', 'Buen día! Me confirman si llegó mi transferencia?'],
    ['in', 'Hola, quiero hacer un pedido grande. Con quién puedo hablar?'],
    ['in', 'Hola! Cuánto sale el envío a {{ciudad}}?']
  ];

  /* ------------------------------------------------------------ esquema */
  function defaults() {
    return {
      meta: { version: 1, createdAt: Date.now(), updatedAt: Date.now(), onboarded: false, demo: true },
      workspace: {
        name: 'Maresia',
        tagline: 'Atención por WhatsApp',
        phone: '5491133445566',
        currency: 'ARS',
        timezone: 'America/Argentina/Buenos_Aires',
        hours: { enabled: true, from: '09:00', to: '19:00', days: [1, 2, 3, 4, 5] },
        awayMessage: 'Gracias por escribirnos 🙌 Nuestro horario es de lunes a viernes de 9 a 19 hs. Te respondemos apenas abramos.',
        welcomeMessage: '¡Hola! Gracias por escribir a {{negocio}}. Contanos en qué te podemos ayudar y te respondemos enseguida.'
      },
      connection: {
        mode: 'demo',            // demo · link · cloud
        phoneNumberId: '',
        wabaId: '',
        token: '',
        verifyToken: '',
        graphVersion: 'v21.0',
        displayNumber: '',
        bridge: { enabled: false, url: '', lastPoll: 0 },
        verifiedAt: 0
      },
      sync: { enabled: false, url: '', node: 'nexo-crm', lastPush: 0, lastPull: 0 },
      session: { agentId: 'agent_ana' },
      agents: [],
      contacts: [],
      conversations: [],
      deals: [],
      stages: [],
      tags: [],
      quickReplies: [],
      templates: [],
      campaigns: [],
      automations: [],
      tasks: [],
      activity: [],
      settings: {
        theme: 'dark',
        density: 'comfortable',
        sound: true,
        desktopNotifications: false,
        simulator: true,
        sla: { firstResponse: 15, resolution: 240 },   // minutos
        signature: { enabled: true, text: '' },
        inboxSort: 'recent'
      }
    };
  }

  /* ---------------------------------------------------------- migración */
  function migrate(data) {
    const base = defaults();
    const out = Object.assign({}, base, data);
    /* fusión superficial de los objetos de configuración */
    ['meta', 'workspace', 'connection', 'session', 'settings', 'sync'].forEach(function (k) {
      out[k] = Object.assign({}, base[k], data[k] || {});
    });
    out.workspace.hours = Object.assign({}, base.workspace.hours, (data.workspace || {}).hours || {});
    out.connection.bridge = Object.assign({}, base.connection.bridge, (data.connection || {}).bridge || {});
    out.settings.sla = Object.assign({}, base.settings.sla, (data.settings || {}).sla || {});
    out.settings.signature = Object.assign({}, base.settings.signature, (data.settings || {}).signature || {});
    /* colecciones siempre array */
    ['agents', 'contacts', 'conversations', 'deals', 'stages', 'tags', 'quickReplies',
      'templates', 'campaigns', 'automations', 'tasks', 'activity'].forEach(function (k) {
        if (!Array.isArray(out[k])) out[k] = base[k];
      });
    /* saneo de conversaciones */
    out.conversations.forEach(function (c) {
      if (!Array.isArray(c.messages)) c.messages = [];
      if (!Array.isArray(c.tags)) c.tags = [];
      if (c.unread == null) c.unread = 0;
    });
    out.contacts.forEach(function (c) {
      if (!Array.isArray(c.tags)) c.tags = [];
      if (!c.custom) c.custom = {};
    });
    return out;
  }

  /* ----------------------------------------------------- catálogos base */
  function baseAgents() {
    return [
      { id: 'agent_ana', name: 'Ana Rivas', email: 'ana@maresia.com', role: 'admin', status: 'online', active: true },
      { id: 'agent_bruno', name: 'Bruno Ferraro', email: 'bruno@maresia.com', role: 'agente', status: 'online', active: true },
      { id: 'agent_carla', name: 'Carla Duarte', email: 'carla@maresia.com', role: 'agente', status: 'away', active: true },
      { id: 'agent_marcos', name: 'Marcos Ledesma', email: 'marcos@maresia.com', role: 'supervisor', status: 'offline', active: true }
    ];
  }

  function baseTags() {
    return [
      { id: 'tag_lead', name: 'Lead nuevo', color: 'blue' },
      { id: 'tag_vip', name: 'VIP', color: 'magenta' },
      { id: 'tag_mayorista', name: 'Mayorista', color: 'amber' },
      { id: 'tag_reclamo', name: 'Reclamo', color: 'danger' },
      { id: 'tag_cobranza', name: 'Cobranza', color: 'violet' },
      { id: 'tag_envio', name: 'Envío', color: 'green' },
      { id: 'tag_recurrente', name: 'Recurrente', color: 'blue' }
    ];
  }
  const TAGMAP = { lead: 'tag_lead', vip: 'tag_vip', mayorista: 'tag_mayorista', reclamo: 'tag_reclamo', cobranza: 'tag_cobranza', envio: 'tag_envio' };

  function baseStages() {
    return [
      { id: 'st_nuevo', name: 'Nuevo lead', color: 'blue', order: 0, kind: 'open', probability: 10 },
      { id: 'st_contacto', name: 'Contactado', color: 'violet', order: 1, kind: 'open', probability: 25 },
      { id: 'st_cotiza', name: 'Cotizado', color: 'amber', order: 2, kind: 'open', probability: 50 },
      { id: 'st_nego', name: 'Negociación', color: 'magenta', order: 3, kind: 'open', probability: 75 },
      { id: 'st_ganado', name: 'Ganado', color: 'green', order: 4, kind: 'won', probability: 100 },
      { id: 'st_perdido', name: 'Perdido', color: 'neutral', order: 5, kind: 'lost', probability: 0 }
    ];
  }

  function baseQuickReplies() {
    return [
      { id: 'qr_saludo', shortcut: 'hola', title: 'Saludo inicial', body: '¡Hola {{nombre}}! Gracias por escribirnos 😊 ¿En qué te puedo ayudar?' },
      { id: 'qr_envio', shortcut: 'envio', title: 'Costo de envío', body: 'Hacemos envíos a todo el país. El costo es de $4.500 y llega en 3 a 5 días hábiles. Superando $60.000 el envío es *gratis*.' },
      { id: 'qr_pago', shortcut: 'pago', title: 'Medios de pago', body: 'Aceptamos transferencia, débito y crédito hasta 6 cuotas sin interés. Por transferencia tenés *10% off*.' },
      { id: 'qr_horario', shortcut: 'horario', title: 'Horario de atención', body: 'Nuestro horario es de lunes a viernes de 9 a 19 hs y sábados de 9 a 13 hs.' },
      { id: 'qr_cambio', shortcut: 'cambio', title: 'Política de cambios', body: 'Tenés 30 días corridos para cambios con el ticket de compra y el producto sin uso.' },
      { id: 'qr_espera', shortcut: 'espera', title: 'Pedir un momento', body: 'Dame un minuto que lo verifico y te confirmo 🙏' },
      { id: 'qr_cierre', shortcut: 'cierre', title: 'Cierre de conversación', body: '¡Gracias por escribirnos! Cualquier cosa quedamos por acá 💚' }
    ];
  }

  function baseTemplates() {
    return [
      {
        id: 'tpl_bienvenida', name: 'bienvenida_cliente', category: 'UTILIDAD', language: 'es_AR', status: 'aprobada',
        header: '', body: '¡Hola {{1}}! Gracias por contactarte con {{2}}. Ya estamos viendo tu consulta y te respondemos a la brevedad.',
        footer: 'Respondé este mensaje para hablar con una persona', buttons: [], variables: ['nombre', 'negocio']
      },
      {
        id: 'tpl_pedido', name: 'confirmacion_pedido', category: 'UTILIDAD', language: 'es_AR', status: 'aprobada',
        header: 'Tu pedido está confirmado', body: 'Hola {{1}}, confirmamos tu pedido *{{2}}* por {{3}}. Te avisamos cuando salga el despacho.',
        footer: '', buttons: [{ type: 'url', text: 'Ver estado', url: 'https://' }], variables: ['nombre', 'pedido', 'total']
      },
      {
        id: 'tpl_despacho', name: 'pedido_despachado', category: 'UTILIDAD', language: 'es_AR', status: 'aprobada',
        header: '', body: '{{1}}, tu pedido salió 🚚 Podés seguirlo con el código {{2}}. Llega en 3 a 5 días hábiles.',
        footer: '', buttons: [], variables: ['nombre', 'tracking']
      },
      {
        id: 'tpl_cobranza', name: 'recordatorio_pago', category: 'UTILIDAD', language: 'es_AR', status: 'aprobada',
        header: '', body: 'Hola {{1}}, te recordamos que la factura {{2}} por {{3}} vence el {{4}}. Si ya la abonaste, ignorá este mensaje.',
        footer: '', buttons: [], variables: ['nombre', 'factura', 'monto', 'vencimiento']
      },
      {
        id: 'tpl_promo', name: 'promocion_temporada', category: 'MARKETING', language: 'es_AR', status: 'aprobada',
        header: 'Nueva temporada', body: '{{1}}, arrancó la nueva temporada con *{{2}}% off* en toda la línea. Válido hasta el {{3}}.',
        footer: 'Respondé BAJA para no recibir más promociones', buttons: [{ type: 'quick_reply', text: 'Ver catálogo' }, { type: 'quick_reply', text: 'BAJA' }],
        variables: ['nombre', 'descuento', 'vigencia']
      },
      {
        id: 'tpl_reactivacion', name: 'reactivacion_cliente', category: 'MARKETING', language: 'es_AR', status: 'pendiente',
        header: '', body: '¡Hola {{1}}! Hace un tiempo que no nos visitás. Te dejamos un {{2}}% de bienvenida de vuelta 💚',
        footer: '', buttons: [], variables: ['nombre', 'descuento']
      }
    ];
  }

  function baseAutomations() {
    return [
      {
        id: 'au_bienvenida', name: 'Saludo automático al primer mensaje', active: true, icon: 'sparkle',
        trigger: { type: 'first_message' },
        conditions: [],
        actions: [{ type: 'reply', text: '¡Hola! Gracias por escribir a {{negocio}} 👋 Ya te estamos leyendo, en un momento te responde una persona del equipo.' },
        { type: 'tag', tagId: 'tag_lead' }],
        stats: { runs: 0 }
      },
      {
        id: 'au_fuera', name: 'Aviso fuera de horario', active: true, icon: 'clock',
        trigger: { type: 'message_out_of_hours' },
        conditions: [],
        actions: [{ type: 'reply', text: '{{ausencia}}' }],
        stats: { runs: 0 }
      },
      {
        id: 'au_precio', name: 'Palabra clave: precio / cuánto sale', active: true, icon: 'dollar',
        trigger: { type: 'keyword', keywords: 'precio, cuanto sale, cuánto sale, lista, cotización' },
        conditions: [],
        actions: [{ type: 'tag', tagId: 'tag_lead' }, { type: 'stage', stageId: 'st_nuevo' }],
        stats: { runs: 0 }
      },
      {
        id: 'au_asignacion', name: 'Repartir conversaciones nuevas entre agentes', active: true, icon: 'handoff',
        trigger: { type: 'new_conversation' },
        conditions: [],
        actions: [{ type: 'assign', mode: 'round_robin' }],
        stats: { runs: 0 }
      },
      {
        id: 'au_reclamo', name: 'Escalar reclamos al supervisor', active: false, icon: 'warn',
        trigger: { type: 'keyword', keywords: 'reclamo, roto, no funciona, dañado, falta, error' },
        conditions: [],
        actions: [{ type: 'tag', tagId: 'tag_reclamo' }, { type: 'assign', mode: 'agent', agentId: 'agent_marcos' },
        { type: 'task', title: 'Revisar reclamo', dueIn: 60 }],
        stats: { runs: 0 }
      },
      {
        id: 'au_sinrespuesta', name: 'Recordar conversaciones sin responder', active: true, icon: 'bell',
        trigger: { type: 'no_reply', minutes: 30 },
        conditions: [],
        actions: [{ type: 'task', title: 'Responder conversación demorada', dueIn: 15 }],
        stats: { runs: 0 }
      }
    ];
  }

  /* -------------------------------------------------------- construcción */
  function build() {
    const s = defaults();
    const r = rng(20240816);
    const pick = function (arr) { return arr[Math.floor(r() * arr.length)]; };
    const int = function (a, b) { return a + Math.floor(r() * (b - a + 1)); };

    s.agents = baseAgents();
    s.tags = baseTags();
    s.stages = baseStages();
    s.quickReplies = baseQuickReplies();
    s.templates = baseTemplates();
    s.automations = baseAutomations();

    const now = Date.now();
    const DAY = 86400000;
    const agentIds = s.agents.map(function (a) { return a.id; });

    /* ---- contactos ---- */
    NOMBRES.forEach(function (nombre, i) {
      const ciudad = pick(CIUDADES);
      const empresa = EMPRESAS[i % EMPRESAS.length];
      const createdAt = now - int(2, 180) * DAY;
      s.contacts.push({
        id: 'ct_' + (i + 1),
        name: nombre,
        phone: '549' + int(11, 11) + int(20000000, 79999999),
        email: r() > 0.45 ? util.slug(nombre.split(' ')[0]) + '.' + util.slug(nombre.split(' ')[1]) + '@mail.com' : '',
        company: empresa,
        city: ciudad,
        source: pick(ORIGENES),
        tags: [],
        custom: {},
        optIn: r() > 0.12,
        createdAt: createdAt,
        lastSeen: now - int(0, 20) * DAY,
        notes: [],
        blocked: false
      });
    });

    /* ---- conversaciones ---- */
    const totalConv = 26;
    for (let i = 0; i < totalConv; i++) {
      const contact = s.contacts[i];
      const guion = GUIONES[i % GUIONES.length];
      const abierta = i < 14;                      // las primeras quedan activas
      const diasAtras = abierta ? (i < 6 ? 0 : int(0, 3)) : int(2, 29);
      const base = now - diasAtras * DAY - int(1, 8) * 3600000;
      const vars = {
        nombre: contact.name.split(' ')[0],
        ciudad: contact.city,
        precio: '$' + util.num(int(18, 65) * 1000),
        precio2: '$' + util.num(int(14, 55) * 1000),
        pedido: String(int(10450, 10990)),
        tracking: 'CA' + int(100000000, 999999999) + 'AR',
        factura: 'A-0001-' + String(int(1000, 9999))
      };

      const msgs = [];
      let t = base;
      let firstIn = null, firstOutAfterIn = null;
      guion.msgs.forEach(function (m, idx) {
        t += int(40, 900) * 1000;
        const dir = m[0];
        const body = util.interpolate(m[1], vars);
        const msg = {
          id: util.uid('m'),
          dir: dir,
          type: m[2] || 'text',
          body: body,
          at: t,
          status: dir === 'out' ? (r() > 0.15 ? 'read' : 'delivered') : 'received',
          author: dir === 'out' ? agentIds[i % agentIds.length] : null
        };
        if (dir === 'note') { msg.author = agentIds[(i + 1) % agentIds.length]; msg.status = 'note'; }
        if (dir === 'in' && firstIn == null) firstIn = t;
        if (dir === 'out' && firstIn != null && firstOutAfterIn == null) firstOutAfterIn = t;
        msgs.push(msg);
      });

      /* algunas conversaciones abiertas terminan con el cliente esperando */
      let unread = 0;
      if (abierta && i % 3 !== 2) {
        t += int(120, 1800) * 1000;
        msgs.push({
          id: util.uid('m'), dir: 'in', type: 'text',
          body: util.interpolate(SIN_RESPUESTA[i % SIN_RESPUESTA.length][1], vars),
          at: t, status: 'received', author: null
        });
        unread = int(1, 3);
      }

      const last = msgs[msgs.length - 1];
      const status = abierta ? (unread ? 'open' : (i % 3 === 2 ? 'pending' : 'open')) : 'closed';
      const tagId = TAGMAP[guion.tag];

      s.conversations.push({
        id: 'cv_' + (i + 1),
        contactId: contact.id,
        subject: guion.tema,
        assignedTo: (abierta && i % 4 === 3) ? null : agentIds[i % agentIds.length],
        status: status,
        unread: unread,
        pinned: i === 1,
        tags: tagId ? [tagId] : [],
        createdAt: base,
        lastMessageAt: last.at,
        firstResponseAt: firstOutAfterIn,
        firstInboundAt: firstIn,
        closedAt: status === 'closed' ? last.at + int(60, 900) * 1000 : null,
        snoozeUntil: null,
        channel: 'whatsapp',
        messages: msgs
      });
      if (tagId && contact.tags.indexOf(tagId) < 0) contact.tags.push(tagId);
      if (i % 7 === 0) contact.tags.push('tag_vip');
      if (i % 3 === 0) contact.tags.push('tag_recurrente');
      if (contact.company) contact.tags.push('tag_mayorista');
      contact.tags = contact.tags.filter(function (v, idx, a) { return a.indexOf(v) === idx; });
    }

    /* ---- negocios (embudo) ---- */
    const openStages = ['st_nuevo', 'st_contacto', 'st_cotiza', 'st_nego'];
    for (let i = 0; i < 22; i++) {
      const contact = s.contacts[i % s.contacts.length];
      let stageId;
      if (i < 12) stageId = openStages[i % openStages.length];
      else stageId = (i % 3 === 0) ? 'st_perdido' : 'st_ganado';
      const createdAt = now - int(1, 45) * DAY;
      const won = stageId === 'st_ganado', lost = stageId === 'st_perdido';
      s.deals.push({
        id: 'dl_' + (i + 1),
        contactId: contact.id,
        title: pick(['Pedido mayorista', 'Combo verano x3', 'Reposición mensual', 'Primer pedido',
          'Pack promocional', 'Compra corporativa', 'Reposición temporada', 'Pedido especial']),
        value: int(25, 480) * 1000,
        currency: 'ARS',
        stageId: stageId,
        ownerId: agentIds[i % agentIds.length],
        createdAt: createdAt,
        updatedAt: createdAt + int(0, 6) * DAY,
        closedAt: (won || lost) ? createdAt + int(2, 20) * DAY : null,
        lostReason: lost ? pick(['Precio', 'Eligió competencia', 'Sin respuesta', 'Fuera de zona']) : '',
        tags: []
      });
    }

    /* ---- tareas ---- */
    const titulos = ['Llamar para cerrar pedido', 'Enviar cotización actualizada', 'Confirmar dirección de envío',
      'Verificar pago pendiente', 'Hacer seguimiento post venta', 'Cargar datos de facturación'];
    for (let i = 0; i < 9; i++) {
      s.tasks.push({
        id: 'tk_' + (i + 1),
        contactId: s.contacts[i].id,
        title: titulos[i % titulos.length],
        dueAt: now + (i - 3) * DAY + int(2, 8) * 3600000,
        done: i > 6,
        ownerId: agentIds[i % agentIds.length],
        createdAt: now - int(1, 10) * DAY
      });
    }

    /* ---- campañas ---- */
    s.campaigns = [
      {
        id: 'cp_1', name: 'Lanzamiento temporada verano', templateId: 'tpl_promo',
        audience: { tags: ['tag_recurrente'], stage: '', optInOnly: true },
        vars: { 2: '25', 3: '31/12' },
        status: 'completada', throttle: 20,
        createdAt: now - 12 * DAY, scheduledAt: now - 11 * DAY, finishedAt: now - 11 * DAY + 3600000,
        stats: { audience: 180, sent: 180, delivered: 174, read: 141, replied: 38, failed: 6 }
      },
      {
        id: 'cp_2', name: 'Recordatorio de vencimientos', templateId: 'tpl_cobranza',
        audience: { tags: ['tag_cobranza'], stage: '', optInOnly: false },
        vars: {}, status: 'programada', throttle: 12,
        createdAt: now - 2 * DAY, scheduledAt: now + 2 * DAY, finishedAt: null,
        stats: { audience: 24, sent: 0, delivered: 0, read: 0, replied: 0, failed: 0 }
      },
      {
        id: 'cp_3', name: 'Reactivación clientes dormidos', templateId: 'tpl_reactivacion',
        audience: { tags: [], stage: 'st_perdido', optInOnly: true },
        vars: { 2: '15' }, status: 'borrador', throttle: 15,
        createdAt: now - 1 * DAY, scheduledAt: null, finishedAt: null,
        stats: { audience: 0, sent: 0, delivered: 0, read: 0, replied: 0, failed: 0 }
      }
    ];

    /* ---- actividad ---- */
    s.activity = [
      { id: util.uid('act'), at: now - 3600000, type: 'deal', text: 'movió “Pedido mayorista” a Negociación', actor: 'agent_bruno', refs: {} },
      { id: util.uid('act'), at: now - 5400000, type: 'campaign', text: 'completó la campaña “Lanzamiento temporada verano”', actor: 'agent_ana', refs: {} },
      { id: util.uid('act'), at: now - 9000000, type: 'contact', text: 'importó 42 contactos desde CSV', actor: 'agent_ana', refs: {} },
      { id: util.uid('act'), at: now - 26 * 3600000, type: 'automation', text: 'activó “Escalar reclamos al supervisor”', actor: 'agent_marcos', refs: {} }
    ];

    /* ---- historial sintético para métricas de 30 días ---- */
    s.meta.history = buildHistory(r, now);
    return s;
  }

  /* Serie diaria de 30 días: volumen, primera respuesta y resoluciones.
     Se usa junto a los datos reales para que el tablero tenga profundidad. */
  function buildHistory(r, now) {
    const DAY = 86400000, out = [];
    for (let i = 119; i >= 0; i--) {
      const date = new Date(now - i * DAY);
      const dow = date.getDay();
      const finde = dow === 0 || dow === 6;
      const base = finde ? 12 : 34;
      const conversaciones = Math.max(4, Math.round(base + (r() - 0.5) * 16 + (119 - i) * 0.12));
      const entrantes = Math.round(conversaciones * (2.4 + r()));
      const salientes = Math.round(entrantes * (0.85 + r() * 0.3));
      out.push({
        date: util.startOfDay(date).getTime(),
        conversaciones: conversaciones,
        entrantes: entrantes,
        salientes: salientes,
        resueltas: Math.round(conversaciones * (0.62 + r() * 0.3)),
        frt: Math.round((finde ? 22 : 9) + r() * 14),          // minutos
        nuevos: Math.max(0, Math.round(conversaciones * 0.35 + (r() - 0.5) * 6))
      });
    }
    return out;
  }

  NS.seed = {
    build: build,
    migrate: migrate,
    defaults: defaults,
    rng: rng,
    /* espacio limpio: catálogos sí, datos de demostración no */
    blank: function (workspaceName) {
      const s = defaults();
      s.meta.demo = false;
      s.meta.onboarded = true;
      s.workspace.name = workspaceName || 'Mi negocio';
      s.agents = [{ id: 'agent_ana', name: 'Yo', email: '', role: 'admin', status: 'online', active: true }];
      s.session.agentId = 'agent_ana';
      s.tags = baseTags();
      s.stages = baseStages();
      s.quickReplies = baseQuickReplies();
      s.templates = baseTemplates();
      s.automations = baseAutomations().map(function (a) {
        if (a.id === 'au_asignacion') a.active = false;
        return a;
      });
      s.meta.history = [];
      return s;
    }
  };

})(window.CRM);
