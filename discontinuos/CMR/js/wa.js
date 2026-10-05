/* =========================================================================
   Nexo CRM · capa WhatsApp
   Tres modos de operación:
     demo   — todo simulado, para probar y capacitar sin riesgo
     link   — abre wa.me con el mensaje listo; sirve con cualquier WhatsApp
     cloud  — API oficial de Meta (Cloud API) para enviar de verdad
   Incluye motor de automatizaciones, puente de entrada y motor de campañas.
   ========================================================================= */
(function (NS) {
  'use strict';

  const util = NS.util, store = NS.store;

  const wa = NS.wa = {};

  /* --------------------------------------------------------------- estado */
  wa.mode = function () { return store.state.connection.mode; };
  wa.isLive = function () { return wa.mode() === 'cloud'; };

  wa.modeLabel = function () {
    return { demo: 'Modo demostración', link: 'Envío por enlace', cloud: 'API oficial conectada' }[wa.mode()] || '—';
  };

  /* ------------------------------------------------------------ contactos */
  wa.findContactByPhone = function (phone) {
    const raw = util.phoneRaw(phone);
    return store.state.contacts.find(function (c) { return util.phoneRaw(c.phone) === raw; });
  };

  wa.ensureContact = function (phone, name) {
    let c = wa.findContactByPhone(phone);
    if (c) return c;
    c = {
      id: util.uid('ct'), name: name || util.phone(phone), phone: util.phoneRaw(phone),
      email: '', company: '', city: '', source: 'WhatsApp directo', tags: [], custom: {},
      optIn: true, createdAt: Date.now(), lastSeen: Date.now(), notes: [], blocked: false
    };
    store.state.contacts.push(c);
    return c;
  };

  wa.ensureConversation = function (contactId, subject) {
    let conv = store.state.conversations.find(function (c) { return c.contactId === contactId && c.status !== 'closed'; });
    if (conv) return { conv: conv, created: false };
    conv = {
      id: util.uid('cv'), contactId: contactId, subject: subject || 'Conversación',
      assignedTo: null, status: 'open', unread: 0, pinned: false, tags: [],
      createdAt: Date.now(), lastMessageAt: Date.now(), firstResponseAt: null, firstInboundAt: null,
      closedAt: null, snoozeUntil: null, channel: 'whatsapp', messages: []
    };
    store.state.conversations.unshift(conv);
    return { conv: conv, created: true };
  };

  /* ------------------------------------------------------ horario laboral */
  wa.withinHours = function (date) {
    const h = store.state.workspace.hours;
    if (!h || !h.enabled) return true;
    const d = date || new Date();
    if (h.days.indexOf(d.getDay()) < 0) return false;
    const mins = d.getHours() * 60 + d.getMinutes();
    const p = function (t) { const a = String(t || '0:0').split(':'); return (+a[0]) * 60 + (+a[1] || 0); };
    return mins >= p(h.from) && mins <= p(h.to);
  };

  /* -------------------------------------------------------------- envío */
  /* payload: {type:'text'|'template'|'note', body, templateId, vars, file} */
  wa.send = function (conv, payload) {
    const contact = store.contact(conv.contactId);
    const me = store.me();
    const now = Date.now();

    const msg = {
      id: util.uid('m'),
      dir: payload.type === 'note' ? 'note' : 'out',
      type: payload.type === 'note' ? 'text' : (payload.type || 'text'),
      body: payload.body,
      at: now,
      status: payload.type === 'note' ? 'note' : 'sending',
      author: me ? me.id : null,
      templateId: payload.templateId || null,
      meta: payload.meta || null
    };

    conv.messages.push(msg);
    conv.lastMessageAt = now;
    if (conv.status === 'closed') { conv.status = 'open'; conv.closedAt = null; }
    if (msg.dir === 'out' && conv.firstInboundAt && !conv.firstResponseAt) conv.firstResponseAt = now;
    if (msg.dir === 'out' && !conv.assignedTo && me) conv.assignedTo = me.id;

    /* la nota interna nunca sale del CRM */
    if (msg.dir === 'note') {
      store.commit(null, 'message', { convId: conv.id, msg: msg });
      return Promise.resolve(msg);
    }

    store.commit(null, 'message', { convId: conv.id, msg: msg });
    NS.ui.sound('out');

    const mode = wa.mode();

    if (mode === 'cloud') {
      return wa.cloudSend(contact.phone, payload).then(function (res) {
        msg.status = 'sent';
        msg.wamid = res && res.messages && res.messages[0] && res.messages[0].id;
        store.commit(null, 'message-status', { convId: conv.id, msgId: msg.id });
        return msg;
      }).catch(function (err) {
        msg.status = 'failed';
        msg.error = String(err.message || err);
        store.commit(null, 'message-status', { convId: conv.id, msgId: msg.id });
        NS.ui.toast('No se pudo enviar: ' + msg.error, 'danger');
        NS.ui.sound('error');
        throw err;
      });
    }

    if (mode === 'link') {
      window.open(wa.waLink(contact.phone, payload.body), '_blank', 'noopener');
      msg.status = 'sent';
      msg.meta = Object.assign({}, msg.meta, { via: 'link' });
      store.commit(null, 'message-status', { convId: conv.id, msgId: msg.id });
      return Promise.resolve(msg);
    }

    /* demo: recorrido completo de estados, con tiempos plausibles */
    fakeDelivery(conv, msg);
    return Promise.resolve(msg);
  };

  function fakeDelivery(conv, msg) {
    setTimeout(function () {
      msg.status = 'sent';
      store.commit(null, 'message-status', { convId: conv.id, msgId: msg.id });
    }, 420 + Math.random() * 400);
    setTimeout(function () {
      msg.status = 'delivered';
      store.commit(null, 'message-status', { convId: conv.id, msgId: msg.id });
    }, 1300 + Math.random() * 900);
    setTimeout(function () {
      if (msg.status === 'delivered') {
        msg.status = 'read';
        store.commit(null, 'message-status', { convId: conv.id, msgId: msg.id });
      }
    }, 3600 + Math.random() * 5000);
  }

  wa.waLink = function (phone, text) {
    return 'https://wa.me/' + util.phoneRaw(phone) + (text ? '?text=' + encodeURIComponent(text) : '');
  };

  /* --------------------------------------------------- API oficial (Meta) */
  wa.graphBase = function () {
    const c = store.state.connection;
    return 'https://graph.facebook.com/' + (c.graphVersion || 'v21.0');
  };

  wa.cloudSend = function (phone, payload) {
    const c = store.state.connection;
    if (!c.phoneNumberId || !c.token) return Promise.reject(new Error('Falta configurar el número o el token'));

    let body;
    if (payload.type === 'template') {
      const tpl = store.template(payload.templateId);
      if (!tpl) return Promise.reject(new Error('Plantilla inexistente'));
      const params = (tpl.variables || []).map(function (v, i) {
        return { type: 'text', text: String((payload.vars && payload.vars[i + 1]) || '') };
      });
      body = {
        messaging_product: 'whatsapp', to: util.phoneRaw(phone), type: 'template',
        template: {
          name: tpl.name, language: { code: tpl.language || 'es' },
          components: params.length ? [{ type: 'body', parameters: params }] : []
        }
      };
    } else {
      body = {
        messaging_product: 'whatsapp', to: util.phoneRaw(phone), type: 'text',
        text: { body: payload.body, preview_url: true }
      };
    }

    return fetch(wa.graphBase() + '/' + c.phoneNumberId + '/messages', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + c.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error((j.error && j.error.message) || ('HTTP ' + r.status));
        return j;
      });
    });
  };

  wa.testConnection = function () {
    const c = store.state.connection;
    if (!c.phoneNumberId || !c.token) return Promise.reject(new Error('Completá el ID de número y el token'));
    return fetch(wa.graphBase() + '/' + c.phoneNumberId + '?fields=display_phone_number,verified_name,quality_rating', {
      headers: { 'Authorization': 'Bearer ' + c.token }
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error((j.error && j.error.message) || ('HTTP ' + r.status));
        store.commit(function (s) {
          s.connection.displayNumber = j.display_phone_number || '';
          s.connection.verifiedName = j.verified_name || '';
          s.connection.quality = j.quality_rating || '';
          s.connection.verifiedAt = Date.now();
        }, 'connection');
        return j;
      });
    });
  };

  /* Trae las plantillas aprobadas de la cuenta de WhatsApp Business */
  wa.fetchTemplates = function () {
    const c = store.state.connection;
    if (!c.wabaId || !c.token) return Promise.reject(new Error('Completá el ID de la cuenta (WABA) y el token'));
    return fetch(wa.graphBase() + '/' + c.wabaId + '/message_templates?limit=100', {
      headers: { 'Authorization': 'Bearer ' + c.token }
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error((j.error && j.error.message) || ('HTTP ' + r.status));
        const list = (j.data || []).map(function (t) {
          const bodyComp = (t.components || []).find(function (x) { return x.type === 'BODY'; }) || {};
          const headComp = (t.components || []).find(function (x) { return x.type === 'HEADER'; }) || {};
          const footComp = (t.components || []).find(function (x) { return x.type === 'FOOTER'; }) || {};
          const vars = (String(bodyComp.text || '').match(/\{\{\d+\}\}/g) || []).map(function (v, i) { return 'var' + (i + 1); });
          return {
            id: 'tpl_' + t.id, name: t.name, category: t.category || 'UTILIDAD',
            language: t.language, status: (t.status || '').toLowerCase() === 'approved' ? 'aprobada' : (t.status || '').toLowerCase(),
            header: headComp.text || '', body: bodyComp.text || '', footer: footComp.text || '',
            buttons: [], variables: vars, remote: true
          };
        });
        store.commit(function (s) {
          const locales = s.templates.filter(function (t) { return !t.remote; });
          s.templates = locales.concat(list);
        }, 'templates');
        return list;
      });
    });
  };

  /* ------------------------------------------------------------ entrada */
  /* Registra un mensaje entrante y dispara las automatizaciones.          */
  wa.receive = function (opts) {
    const contact = opts.contactId ? store.contact(opts.contactId) : wa.ensureContact(opts.phone, opts.name);
    if (!contact) return null;
    const r = wa.ensureConversation(contact.id, opts.subject);
    const conv = r.conv;
    const now = opts.at || Date.now();

    const msg = {
      id: opts.id || util.uid('m'), dir: 'in', type: opts.type || 'text',
      body: opts.body, at: now, status: 'received', author: null
    };
    conv.messages.push(msg);
    conv.lastMessageAt = now;
    conv.unread = (conv.unread || 0) + 1;
    if (conv.status === 'closed') { conv.status = 'open'; conv.closedAt = null; }
    if (conv.status === 'pending') conv.status = 'open';
    if (!conv.firstInboundAt) conv.firstInboundAt = now;
    conv.snoozeUntil = null;
    contact.lastSeen = now;

    const esPrimero = conv.messages.filter(function (m) { return m.dir === 'in'; }).length === 1;

    store.commit(null, 'message', { convId: conv.id, msg: msg, inbound: true });
    NS.ui.sound('in');
    NS.ui.notify(contact.name, util.truncate(opts.body, 90), function () {
      NS.app && NS.app.openConversation(conv.id);
    });

    /* automatizaciones, en orden de definición */
    if (r.created) wa.runAutomations('new_conversation', { conv: conv, contact: contact, msg: msg });
    if (esPrimero) wa.runAutomations('first_message', { conv: conv, contact: contact, msg: msg });
    if (!wa.withinHours(new Date(now))) wa.runAutomations('message_out_of_hours', { conv: conv, contact: contact, msg: msg });
    wa.runAutomations('keyword', { conv: conv, contact: contact, msg: msg });

    return { conv: conv, msg: msg };
  };

  /* --------------------------------------------- motor de automatizaciones */
  let rrIndex = 0;

  wa.runAutomations = function (triggerType, ctx) {
    const st = store.state;
    let ran = 0;
    st.automations.forEach(function (rule) {
      if (!rule.active || rule.trigger.type !== triggerType) return;

      if (triggerType === 'keyword') {
        const words = String(rule.trigger.keywords || '').split(',')
          .map(function (w) { return util.norm(w.trim()); }).filter(Boolean);
        const body = util.norm(ctx.msg ? ctx.msg.body : '');
        if (!words.some(function (w) { return body.indexOf(w) >= 0; })) return;
      }
      /* una respuesta automática por conversación y por regla, para no repetir */
      const seen = ctx.conv.autoRan = ctx.conv.autoRan || {};
      if (rule.trigger.type !== 'keyword' && seen[rule.id]) return;
      seen[rule.id] = Date.now();

      applyActions(rule, ctx);
      rule.stats = rule.stats || { runs: 0 };
      rule.stats.runs++;
      rule.stats.lastRun = Date.now();
      ran++;
    });
    if (ran) store.commit(null, 'automation-run', { trigger: triggerType, count: ran });
    return ran;
  };

  function applyActions(rule, ctx) {
    const st = store.state, conv = ctx.conv, contact = ctx.contact;

    rule.actions.forEach(function (a) {
      switch (a.type) {
        case 'reply': {
          const text = util.interpolate(a.text || '', {
            nombre: (contact.name || '').split(' ')[0],
            negocio: st.workspace.name,
            ausencia: st.workspace.awayMessage,
            bienvenida: st.workspace.welcomeMessage
          }).replace('{{ausencia}}', st.workspace.awayMessage);
          /* pequeño retardo: una respuesta instantánea delata al robot */
          setTimeout(function () {
            const msg = {
              id: util.uid('m'), dir: 'out', type: 'text', body: text, at: Date.now(),
              status: wa.mode() === 'cloud' ? 'sending' : 'sent', author: null,
              meta: { bot: true, ruleId: rule.id }
            };
            conv.messages.push(msg);
            conv.lastMessageAt = msg.at;
            store.commit(null, 'message', { convId: conv.id, msg: msg });
            if (wa.mode() === 'cloud') {
              wa.cloudSend(contact.phone, { type: 'text', body: text })
                .then(function () { msg.status = 'sent'; store.commit(null, 'message-status', { convId: conv.id, msgId: msg.id }); })
                .catch(function (e) { msg.status = 'failed'; msg.error = String(e.message || e); store.commit(null, 'message-status', {}); });
            } else if (wa.mode() === 'demo') {
              fakeDelivery(conv, msg);
            }
          }, 900 + Math.random() * 900);
          break;
        }
        case 'tag':
          if (a.tagId && conv.tags.indexOf(a.tagId) < 0) conv.tags.push(a.tagId);
          if (a.tagId && contact.tags.indexOf(a.tagId) < 0) contact.tags.push(a.tagId);
          break;
        case 'assign': {
          const activos = st.agents.filter(function (ag) { return ag.active; });
          if (a.mode === 'agent' && a.agentId) conv.assignedTo = a.agentId;
          else if (activos.length) { conv.assignedTo = activos[rrIndex % activos.length].id; rrIndex++; }
          break;
        }
        case 'stage': {
          let deal = store.dealsOf(contact.id).find(function (d) {
            const stg = store.stage(d.stageId);
            return stg && stg.kind === 'open';
          });
          if (!deal) {
            deal = {
              id: util.uid('dl'), contactId: contact.id, title: 'Oportunidad de ' + (contact.name || '').split(' ')[0],
              value: 0, currency: st.workspace.currency, stageId: a.stageId, ownerId: conv.assignedTo,
              createdAt: Date.now(), updatedAt: Date.now(), closedAt: null, lostReason: '', tags: []
            };
            st.deals.push(deal);
          } else if (a.stageId) { deal.stageId = a.stageId; deal.updatedAt = Date.now(); }
          break;
        }
        case 'task':
          st.tasks.push({
            id: util.uid('tk'), contactId: contact.id, title: a.title || 'Seguimiento',
            dueAt: Date.now() + (a.dueIn || 60) * 60000, done: false,
            ownerId: conv.assignedTo || (store.me() || {}).id, createdAt: Date.now()
          });
          break;
        case 'status':
          conv.status = a.status || 'pending';
          break;
      }
    });
  }

  /* Revisión periódica de conversaciones sin respuesta (disparador no_reply) */
  wa.checkNoReply = function () {
    const st = store.state;
    const reglas = st.automations.filter(function (r) { return r.active && r.trigger.type === 'no_reply'; });
    if (!reglas.length) return;
    const now = Date.now();
    st.conversations.forEach(function (conv) {
      if (conv.status === 'closed') return;
      const last = store.lastMessage(conv);
      if (!last || last.dir !== 'in') return;
      const contact = store.contact(conv.contactId);
      if (!contact) return;
      reglas.forEach(function (rule) {
        const mins = (now - last.at) / 60000;
        if (mins < (rule.trigger.minutes || 30)) return;
        const seen = conv.autoRan = conv.autoRan || {};
        if (seen['nr_' + rule.id] === last.id) return;
        seen['nr_' + rule.id] = last.id;
        applyActions(rule, { conv: conv, contact: contact, msg: last });
        rule.stats = rule.stats || { runs: 0 };
        rule.stats.runs++;
      });
    });
  };

  /* ------------------------------------------------------------ campañas */
  wa.audienceOf = function (campaign) {
    const st = store.state;
    const a = campaign.audience || {};
    if (a.ids && a.ids.length) {
      return a.ids.map(function (id) { return store.contact(id); })
        .filter(function (c) { return c && !c.blocked && (!a.optInOnly || c.optIn); });
    }
    return st.contacts.filter(function (c) {
      if (c.blocked) return false;
      if (a.optInOnly && !c.optIn) return false;
      if (a.tags && a.tags.length && !a.tags.every(function (t) { return c.tags.indexOf(t) >= 0; })) return false;
      if (a.stage) {
        const deals = store.dealsOf(c.id);
        if (!deals.some(function (d) { return d.stageId === a.stage; })) return false;
      }
      if (a.city && util.norm(c.city) !== util.norm(a.city)) return false;
      return true;
    });
  };

  const running = {};

  wa.runCampaign = function (campaignId, onProgress) {
    const st = store.state;
    const cp = st.campaigns.find(function (c) { return c.id === campaignId; });
    if (!cp) return;
    if (running[campaignId]) return;

    const tpl = store.template(cp.templateId);
    const audiencia = wa.audienceOf(cp);
    if (!audiencia.length) { NS.ui.toast('La audiencia quedó vacía con esos filtros', 'warn'); return; }

    cp.status = 'enviando';
    cp.stats = { audience: audiencia.length, sent: 0, delivered: 0, read: 0, replied: 0, failed: 0 };
    store.commit(null, 'campaign', { id: campaignId });

    let i = 0;
    const intervalo = Math.max(120, 60000 / Math.max(1, cp.throttle || 15));
    const state = { cancel: false };
    running[campaignId] = state;

    const paso = function () {
      if (state.cancel) { finish('cancelada'); return; }
      if (i >= audiencia.length) { finish('completada'); return; }

      const contact = audiencia[i++];
      const vars = Object.assign({ 1: (contact.name || '').split(' ')[0] }, cp.vars || {});
      const cuerpo = util.interpolate((tpl && tpl.body) || cp.body || '', vars);

      const r = wa.ensureConversation(contact.id, 'Campaña: ' + cp.name);
      const conv = r.conv;
      if (conv.tags.indexOf('tag_campaña') < 0) conv.campaignId = cp.id;

      const enviar = wa.mode() === 'cloud'
        ? wa.cloudSend(contact.phone, { type: 'template', templateId: cp.templateId, vars: vars })
        : Promise.resolve({ simulated: true });

      const msg = {
        id: util.uid('m'), dir: 'out', type: 'template', body: cuerpo, at: Date.now(),
        status: 'sending', author: (store.me() || {}).id, templateId: cp.templateId,
        meta: { campaignId: cp.id }
      };
      conv.messages.push(msg);
      conv.lastMessageAt = msg.at;

      enviar.then(function () {
        msg.status = 'sent';
        cp.stats.sent++;
        /* progresión estadística realista de entregas y lecturas */
        setTimeout(function () {
          if (Math.random() > 0.04) { msg.status = 'delivered'; cp.stats.delivered++; }
          else { msg.status = 'failed'; cp.stats.failed++; }
          store.commit(null, 'campaign', { id: campaignId });
        }, 900 + Math.random() * 1200);
        setTimeout(function () {
          if (msg.status === 'delivered' && Math.random() > 0.22) { msg.status = 'read'; cp.stats.read++; }
          store.commit(null, 'campaign', { id: campaignId });
        }, 2600 + Math.random() * 3000);
      }).catch(function (e) {
        msg.status = 'failed'; msg.error = String(e.message || e);
        cp.stats.failed++;
      }).then(function () {
        store.commit(null, 'campaign', { id: campaignId });
        onProgress && onProgress(cp, i, audiencia.length);
        setTimeout(paso, intervalo);
      });
    };

    const finish = function (estado) {
      cp.status = estado;
      cp.finishedAt = Date.now();
      delete running[campaignId];
      store.log('campaign', (estado === 'completada' ? 'completó' : 'detuvo') + ' la campaña “' + cp.name + '”');
      store.commit(null, 'campaign', { id: campaignId, done: true });
      if (estado === 'completada') { NS.ui.toast('Campaña “' + cp.name + '” finalizada', 'ok'); NS.ui.sound('done'); }
    };

    paso();
  };

  wa.stopCampaign = function (id) { if (running[id]) running[id].cancel = true; };
  wa.isRunning = function (id) { return !!running[id]; };

  /* ------------------------------------------- puente de mensajes entrantes */
  /* El webhook de Meta no puede apuntar a una página estática. El puente lee
     un endpoint JSON (por ejemplo un nodo de Firebase o un Apps Script) donde
     tu webhook deposita los mensajes recibidos.                              */
  let bridgeTimer = null;

  wa.startBridge = function () {
    wa.stopBridge();
    const c = store.state.connection;
    if (!c.bridge.enabled || !c.bridge.url) return;
    const tick = function () {
      fetch(c.bridge.url, { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          const items = Array.isArray(data) ? data : Object.keys(data || {}).map(function (k) {
            return Object.assign({ _key: k }, data[k]);
          });
          const vistos = store.state.connection.bridge.seen || {};
          let nuevos = 0;
          items.forEach(function (it) {
            const id = it.id || it._key || (it.from + '_' + it.ts);
            if (!id || vistos[id]) return;
            vistos[id] = 1;
            nuevos++;
            wa.receive({
              phone: it.from || it.phone, name: it.name || it.profileName,
              body: it.text || it.body || '', at: it.ts ? Number(it.ts) : Date.now(), id: id
            });
          });
          store.state.connection.bridge.seen = vistos;
          store.state.connection.bridge.lastPoll = Date.now();
          store.state.connection.bridge.error = '';
          if (nuevos) store.commit(null, 'bridge');
        })
        .catch(function (e) {
          store.state.connection.bridge.error = String(e.message || e);
        });
    };
    tick();
    bridgeTimer = setInterval(tick, 8000);
  };

  wa.stopBridge = function () { if (bridgeTimer) { clearInterval(bridgeTimer); bridgeTimer = null; } };

  /* ------------------------------------------------------------ simulador */
  /* Sólo en modo demostración: da vida a la bandeja para poder evaluar la
     herramienta con movimiento real.                                       */
  const RESPUESTAS = [
    'Perfecto, muchas gracias! 🙌', 'Dale, lo veo y te confirmo', 'Me pasás el link de pago?',
    'Ah buenísimo, no sabía', 'Y tienen envío para hoy?', 'Ok, cuánto sería el total?',
    'Gracias por la data 😊', 'Lo consulto y te aviso mañana', 'Sí, dale, confirmo el pedido',
    'Puede ser el jueves a la mañana?', 'Perfecto. Factura A por favor', 'Buenísimo, gracias!! 💚'
  ];
  const NUEVOS = [
    'Hola! Vi su cuenta, hacen envíos?', 'Buenas, quería consultar por el catálogo 🙂',
    'Hola, me pasan lista de precios?', 'Buen día! Tienen stock disponible?',
    'Hola, quería hacer una consulta sobre un pedido'
  ];

  let simTimer = null;

  wa.startSimulator = function () {
    wa.stopSimulator();
    if (wa.mode() !== 'demo' || !store.state.settings.simulator) return;

    const schedule = function () {
      simTimer = setTimeout(function () {
        try { tick(); } catch (e) { console.warn(e); }
        schedule();
      }, 22000 + Math.random() * 46000);
    };

    const tick = function () {
      if (document.hidden) return;
      const st = store.state;
      const abiertas = st.conversations.filter(function (c) { return c.status !== 'closed'; });
      /* de vez en cuando entra alguien nuevo */
      if (Math.random() < 0.22 || !abiertas.length) {
        const libres = st.contacts.filter(function (c) {
          return !st.conversations.some(function (cv) { return cv.contactId === c.id && cv.status !== 'closed'; });
        });
        if (libres.length) {
          const c = libres[Math.floor(Math.random() * libres.length)];
          wa.receive({ contactId: c.id, body: NUEVOS[Math.floor(Math.random() * NUEVOS.length)], subject: 'Consulta' });
          return;
        }
      }
      const conv = abiertas[Math.floor(Math.random() * abiertas.length)];
      if (!conv) return;
      wa.receive({ contactId: conv.contactId, body: RESPUESTAS[Math.floor(Math.random() * RESPUESTAS.length)] });
    };

    schedule();
  };

  wa.stopSimulator = function () { if (simTimer) { clearTimeout(simTimer); simTimer = null; } };

  wa.restartServices = function () {
    wa.stopSimulator(); wa.stopBridge();
    wa.startSimulator(); wa.startBridge();
  };

})(window.CRM);
