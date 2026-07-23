const S = {
  ctx: null,
  negocioId: null,
  queue: "esperan",
  canalId: null,
  tag: "",
  conversaciones: [],
  conversacionId: null,
  mensajes: [],
  agentes: [],
  atajos: [],
  notas: [],
  detailTab: "chat",
  admin: null,
  poll: null,
};

const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
const fecha = (value) => {
  if (!value) return "";
  const d = new Date(String(value).replace(" ", "T") + (String(value).includes("Z") ? "" : "Z"));
  return Number.isNaN(d.getTime())
    ? esc(value)
    : new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(d);
};
const iniciales = (nombre) =>
  String(nombre || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
const etiquetasDe = (conv) =>
  String(conv?.etiquetas || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

function formatoWhatsApp(texto) {
  let html = esc(texto);
  html = html.replace(/\bhttps?:\/\/[^\s<]+/g, (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
  html = html.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<strong>$2</strong>");
  return html;
}

async function api(path, options = {}) {
  const respuesta = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    if (respuesta.status === 401 && path !== "/api/backoffice/login") mostrarLogin();
    throw new Error(data.error || `Error ${respuesta.status}`);
  }
  return data;
}

let toastTimer;
function toast(mensaje, esError = false) {
  clearTimeout(toastTimer);
  $("toast").textContent = mensaje;
  $("toast").classList.toggle("error", esError);
  $("toast").hidden = false;
  toastTimer = setTimeout(() => {
    $("toast").hidden = true;
  }, 4200);
}

function mostrarLogin() {
  clearInterval(S.poll);
  S.poll = null;
  S.ctx = null;
  $("app").hidden = true;
  $("login").hidden = false;
  setTimeout(() => $("loginUsuario").focus(), 0);
}

function negocioSeleccionado() {
  return S.ctx?.negocios.find((n) => n.id === S.negocioId) || null;
}

function negocioDeConversacion() {
  const conv = S.conversaciones.find((c) => c.id === S.conversacionId);
  return conv ? S.ctx?.negocios.find((n) => n.id === conv.negocioId) || null : null;
}

function puedeAdministrar(negocio) {
  return !!(S.ctx?.usuario.esSuperAdmin || negocio?.rol === "admin");
}

function puedeVerAdmin() {
  return !!(
    S.ctx?.usuario.esSuperAdmin ||
    S.ctx?.negocios.some((n) => n.rol === "admin" && n.features?.gestionUsuarios === true)
  );
}

async function iniciarApp() {
  const ctx = await api("/api/backoffice/yo");
  S.ctx = ctx;
  $("login").hidden = true;
  $("app").hidden = false;
  $("userName").textContent = ctx.usuario.nombre;
  $("userRole").textContent = ctx.usuario.esSuperAdmin ? "Superadmin" : "Agente";
  $("userAvatar").textContent = iniciales(ctx.usuario.nombre);
  $("navAdmin").hidden = !puedeVerAdmin();
  renderNegocios();
  if (ctx.negocios.length) {
    await cargarConversaciones();
  } else {
    S.conversaciones = [];
    S.conversacionId = null;
    renderConversaciones();
    renderFiltros();
    if (ctx.usuario.esSuperAdmin) await abrirAdmin();
  }
  if (ctx.negocios.length && !S.poll) {
    S.poll = setInterval(async () => {
      if (!$("inboxView").hidden) {
        await cargarConversaciones(true);
        if (S.conversacionId) await cargarDetalle(true);
      }
    }, 15000);
  }
}

function renderNegocios() {
  const opciones = [];
  if (!S.ctx.negocios.length) opciones.push('<option value="">Sin negocios configurados</option>');
  if (S.ctx.negocios.length > 1) opciones.push('<option value="">Todos mis negocios</option>');
  opciones.push(...S.ctx.negocios.map((n) => `<option value="${n.id}">${esc(n.nombre)}</option>`));
  $("negocioSelect").innerHTML = opciones.join("");
  if (S.ctx.negocios.length === 1) S.negocioId = S.ctx.negocios[0].id;
  $("negocioSelect").value = S.negocioId || "";
}

function queryConversaciones() {
  const p = new URLSearchParams();
  if (S.negocioId) p.set("negocioId", S.negocioId);
  if (S.queue === "esperan") p.set("estado", "humano");
  if (S.queue === "mias") p.set("asignado", "mias");
  if (S.queue === "sin_asignar") p.set("asignado", "sin_asignar");
  if (S.canalId) p.set("canalId", S.canalId);
  if (S.tag) p.set("etiqueta", S.tag);
  return p.toString();
}

async function cargarConversaciones(silencioso = false) {
  try {
    const nuevas = (await api(`/api/backoffice/conversaciones?${queryConversaciones()}`)).conversaciones || [];
    const firma = (lista) =>
      JSON.stringify(
        lista.map((c) => [c.id, c.updatedAt, c.estado, c.asignadoA, c.etiquetas, c.valoracion, c.canalId])
      );
    const cambio = firma(nuevas) !== firma(S.conversaciones);
    S.conversaciones = nuevas;
    if (cambio) {
      renderConversaciones();
      renderFiltros();
    }
    if (S.conversacionId && !S.conversaciones.some((c) => c.id === S.conversacionId)) {
      S.conversacionId = null;
      cerrarDetalle();
    }
  } catch (error) {
    if (!silencioso) toast(error.message, true);
  }
}

function renderFiltros() {
  const actuales = new Map();
  for (const c of S.conversaciones) if (c.canalId) actuales.set(c.canalId, c.canalNombre || c.phoneNumberId || `Canal ${c.canalId}`);
  $("canalFilter").innerHTML =
    '<option value="">Todos los canales</option>' +
    [...actuales.entries()].map(([id, nombre]) => `<option value="${id}">${esc(nombre)}</option>`).join("");
  $("canalFilter").value = S.canalId || "";
}

function renderConversaciones() {
  $("conversationCount").textContent = S.conversaciones.length;
  $("conversationList").innerHTML = S.conversaciones.length
    ? S.conversaciones
        .map(
          (c) => `
      <button class="conversation-item ${c.id === S.conversacionId ? "active" : ""}" data-conversation-id="${c.id}">
        <div class="item-top">
          <strong>${esc(c.nombre || c.numero)}</strong>
          <span class="item-time">${fecha(c.updatedAt)}</span>
        </div>
        <div class="item-number">${esc(c.numero)}</div>
        <div class="item-meta">
          ${!S.negocioId ? `<span class="badge business">${esc(c.negocioNombre)}</span>` : ""}
          ${c.canalNombre ? `<span class="badge channel">${esc(c.canalNombre)}</span>` : ""}
          ${c.asignadoNombre ? `<span class="badge assigned">👤 ${esc(c.asignadoNombre)}</span>` : ""}
          ${c.valoracion === "positiva" ? "<span>👍</span>" : c.valoracion === "negativa" ? "<span>👎</span>" : ""}
          ${etiquetasDe(c)
            .slice(0, 3)
            .map((t) => `<span class="tag">${esc(t)}</span>`)
            .join("")}
        </div>
      </button>`
        )
        .join("")
    : '<div class="list-empty">No hay conversaciones para estos filtros.</div>';
}

async function seleccionarConversacion(id) {
  S.conversacionId = Number(id);
  S.detailTab = "chat";
  renderConversaciones();
  $("emptyDetail").hidden = true;
  $("conversationDetail").hidden = false;
  await cargarDetalle();
}

async function cargarDetalle(silencioso = false) {
  const conv = S.conversaciones.find((c) => c.id === S.conversacionId);
  if (!conv) return;
  try {
    const [hilo, agentes] = await Promise.all([
      api(`/api/backoffice/mensajes?conversacionId=${conv.id}`),
      api(`/api/backoffice/agentes?negocioId=${conv.negocioId}`),
    ]);
    S.mensajes = hilo.mensajes || [];
    S.agentes = agentes.agentes || [];
    const negocio = negocioDeConversacion();
    if (negocio?.features.atajos) {
      S.atajos = (await api(`/api/backoffice/atajos?negocioId=${conv.negocioId}`)).atajos || [];
    } else {
      S.atajos = [];
    }
    renderDetalle();
    if (S.detailTab === "notes") await cargarNotas();
  } catch (error) {
    if (!silencioso) toast(error.message, true);
  }
}

function renderDetalle() {
  const conv = S.conversaciones.find((c) => c.id === S.conversacionId);
  const negocio = negocioDeConversacion();
  if (!conv || !negocio) return;
  $("contactName").textContent = conv.nombre || conv.numero;
  $("contactMeta").textContent = [conv.numero, conv.negocioNombre, conv.canalNombre].filter(Boolean).join(" · ");
  $("conversationState").className = `status ${conv.estado}`;
  $("conversationState").textContent = conv.estado === "humano" ? "Atención humana" : "Bot activo";
  $("resolveButton").hidden = conv.estado !== "humano";

  const esAdmin = puedeAdministrar(negocio);
  const agentesVisibles = esAdmin
    ? S.agentes
    : S.agentes.filter((a) => a.id === S.ctx.usuario.id || a.id === conv.asignadoA);
  $("assignmentSelect").innerHTML =
    '<option value="">Sin asignar</option>' +
    agentesVisibles.map((a) => `<option value="${a.id}">${esc(a.nombre || a.usuario)}</option>`).join("");
  $("assignmentSelect").value = conv.asignadoA || "";

  $("messages").innerHTML = S.mensajes.length
    ? S.mensajes
        .map(
          (m) => `
      <div class="message ${esc(m.rol)}">
        ${formatoWhatsApp(m.contenido)}
        <small>${m.rol === "humano" ? "Persona" : m.rol === "user" ? "Cliente" : "Bot"} · ${fecha(m.ts)}</small>
      </div>`
        )
        .join("")
    : '<div class="list-empty">Todavía no hay mensajes.</div>';
  $("messages").scrollTop = $("messages").scrollHeight;

  const puedeEtiquetar = negocio.features.etiquetas;
  $("tagRow").hidden = !puedeEtiquetar;
  if (puedeEtiquetar) {
    $("tagRow").innerHTML =
      etiquetasDe(conv)
        .map((t) => `<span class="tag">${esc(t)} <button data-remove-tag="${esc(t)}" title="Quitar">×</button></span>`)
        .join("") +
      '<input id="newTag" placeholder="+ etiqueta" aria-label="Agregar etiqueta">';
  }
  $("notesTab").hidden = !negocio.features.notas;
  $("ratingUp").parentElement.hidden = !negocio.features.valoracion;
  $("ratingUp").classList.toggle("active", conv.valoracion === "positiva");
  $("ratingDown").classList.toggle("active", conv.valoracion === "negativa");
  $("shortcutButton").hidden = !negocio.features.atajos;
  renderDetalleTab();
}

function renderDetalleTab() {
  const notas = S.detailTab === "notes";
  document.querySelectorAll("[data-detail-tab]").forEach((b) => b.classList.toggle("active", b.dataset.detailTab === S.detailTab));
  $("messages").hidden = notas;
  $("composer").hidden = notas;
  $("notes").hidden = !notas;
  $("noteForm").hidden = !notas;
}

async function cargarNotas() {
  if (!S.conversacionId) return;
  S.notas = (await api(`/api/backoffice/notas?conversacionId=${S.conversacionId}`)).notas || [];
  $("notes").innerHTML = S.notas.length
    ? S.notas
        .map(
          (n) => `<div class="note"><small>${esc(n.usuarioNombre || "—")} · ${fecha(n.ts)}</small>${esc(n.texto)}</div>`
        )
        .join("")
    : '<div class="list-empty">Todavía no hay notas internas.</div>';
}

function cerrarDetalle() {
  S.conversacionId = null;
  $("conversationDetail").hidden = true;
  $("emptyDetail").hidden = false;
  renderConversaciones();
}

async function guardarEtiquetas(etiquetas) {
  await api("/api/backoffice/etiquetas", {
    method: "POST",
    body: JSON.stringify({ conversacionId: S.conversacionId, etiquetas }),
  });
  await cargarConversaciones(true);
  await cargarDetalle(true);
}

function mostrarAtajos() {
  const conv = S.conversaciones.find((c) => c.id === S.conversacionId);
  const negocio = negocioDeConversacion();
  if (!conv || !negocio) return;
  const gestionar = puedeAdministrar(negocio)
    ? `
      <div class="shortcut-manage">
        <form id="shortcutForm" class="admin-form">
          <input name="clave" placeholder="Clave" required>
          <input name="texto" placeholder="Texto de respuesta" required>
          <button class="primary" type="submit">Crear</button>
        </form>
        ${S.atajos
          .filter((a) => Number(a.negocioId) === conv.negocioId)
          .map((a) => `<button class="shortcut-item danger" data-delete-shortcut="${a.id}">Eliminar /${esc(a.clave)}</button>`)
          .join("")}
      </div>`
    : "";
  $("shortcutPopover").innerHTML =
    (S.atajos.length
      ? S.atajos
          .map(
            (a) => `<button class="shortcut-item" data-use-shortcut="${a.id}"><strong>/${esc(a.clave)}</strong><small>${esc(a.texto)}</small></button>`
          )
          .join("")
      : '<div class="list-empty">No hay respuestas rápidas.</div>') + gestionar;
  $("shortcutPopover").hidden = !$("shortcutPopover").hidden;
}

async function abrirAdmin() {
  if (!puedeVerAdmin()) return;
  $("inboxView").hidden = true;
  $("adminView").hidden = false;
  $("navInbox").classList.remove("active");
  $("navAdmin").classList.add("active");
  await cargarAdmin();
}

function abrirInbox() {
  $("adminView").hidden = true;
  $("inboxView").hidden = false;
  $("navAdmin").classList.remove("active");
  $("navInbox").classList.add("active");
}

async function cargarAdmin() {
  try {
    S.admin = await api("/api/admin/estado");
    renderAdmin();
  } catch (error) {
    toast(error.message, true);
  }
}

const opcionesNegocios = (incluirVacio = false) =>
  `${incluirVacio ? '<option value="">Sin negocio</option>' : ""}${(S.admin?.negocios || [])
    .filter((n) => n.activo)
    .map((n) => `<option value="${n.id}">${esc(n.nombre)}</option>`)
    .join("")}`;
const opcionesUsuarios = () =>
  (S.admin?.usuarios || [])
    .filter((u) => u.activo && !u.esSuperAdmin)
    .map((u) => `<option value="${u.id}">${esc(u.nombre || u.usuario)}</option>`)
    .join("");

function renderAdmin() {
  if (!S.admin) return;
  const superadmin = S.ctx.usuario.esSuperAdmin;
  const adminNegocios = new Set(S.ctx.negocios.filter((n) => superadmin || n.rol === "admin").map((n) => n.id));
  const membresias = S.admin.membresias || [];
  const negocioNombre = (id) => S.admin.negocios.find((n) => Number(n.id) === Number(id))?.nombre || `#${id}`;
  const usuarioNombre = (id) => {
    const u = S.admin.usuarios.find((x) => Number(x.id) === Number(id));
    return u?.nombre || u?.usuario || `#${id}`;
  };

  const cards = [];
  if (superadmin) {
    cards.push(`
      <section class="admin-card">
        <div class="card-head"><div><h2>Negocios</h2><p>Tenants activos del CRM.</p></div><span class="count">${S.admin.negocios.length}</span></div>
        <form id="businessForm" class="admin-form">
          <input name="clave" placeholder="slug-negocio" required>
          <input name="nombre" placeholder="Nombre visible" required>
          <button class="primary" type="submit">Crear negocio</button>
        </form>
        <div class="admin-list">${S.admin.negocios
          .map(
            (n) => `<div class="admin-row"><div><strong>${esc(n.nombre)}</strong><small>${esc(n.clave)} · ${esc(n.tier)} · ${n.activo ? "activo" : "inactivo"}</small></div><div class="row-actions"><button data-edit-business="${n.id}">Editar</button></div></div>`
          )
          .join("")}</div>
      </section>`);
  }

  cards.push(`
    <section class="admin-card ${superadmin ? "" : "full"}">
      <div class="card-head"><div><h2>Equipo</h2><p>Usuarios y acceso por negocio.</p></div><span class="count">${S.admin.usuarios.length}</span></div>
      <form id="userForm" class="admin-form triple">
        <input name="usuario" placeholder="usuario" required>
        <input name="nombre" placeholder="Nombre visible" required>
        <input name="password" type="password" minlength="10" autocomplete="new-password" placeholder="Contraseña temporal" required>
        <select name="negocioId">${opcionesNegocios(superadmin)}</select>
        <select name="rol"><option value="agente">Agente</option><option value="admin">Admin</option></select>
        <button class="primary" type="submit">Crear usuario</button>
      </form>
      <form id="membershipForm" class="admin-form triple">
        <select name="usuarioId" required>${opcionesUsuarios()}</select>
        <select name="negocioId" required>${opcionesNegocios()}</select>
        <select name="rol"><option value="agente">Agente</option><option value="admin">Admin</option></select>
        <button class="secondary" type="submit">Asignar acceso</button>
      </form>
      ${superadmin ? `<div class="admin-list">${S.admin.usuarios
        .map(
          (u) => `<div class="admin-row"><div><strong>${esc(u.nombre || u.usuario)}</strong><small>${esc(u.usuario)} · ${u.esSuperAdmin ? "superadmin" : "usuario"} · ${u.activo ? "activo" : "inactivo"}</small></div><div class="row-actions"><button data-edit-user="${u.id}">Editar usuario</button></div></div>`
        )
        .join("")}</div><br>` : ""}
      <div class="admin-list">${membresias
        .filter((m) => adminNegocios.has(Number(m.negocioId)))
        .map(
          (m) => `<div class="admin-row"><div><strong>${esc(usuarioNombre(m.usuarioId))}</strong><small>${esc(negocioNombre(m.negocioId))} · ${esc(m.rol)}</small></div><div class="row-actions"><button class="danger" data-delete-membership="${m.usuarioId}:${m.negocioId}">Quitar</button></div></div>`
        )
        .join("")}</div>
    </section>`);

  if (superadmin) {
    cards.push(`
      <section class="admin-card">
        <div class="card-head"><div><h2>Canales de WhatsApp</h2><p>El token nunca vuelve a mostrarse.</p></div><span class="count">${S.admin.canales.length}</span></div>
        <form id="channelForm" class="admin-form triple">
          <select name="negocioId" required>${opcionesNegocios()}</select>
          <input name="phoneNumberId" placeholder="Phone Number ID" required>
          <input name="nombre" placeholder="Nombre del canal">
          <input name="token" type="password" autocomplete="off" placeholder="Token permanente" required>
          <button class="primary" type="submit">Guardar canal</button>
        </form>
        <div class="admin-list">${S.admin.canales
          .map(
            (c) => `<div class="admin-row"><div><strong>${esc(c.nombre || c.phoneNumberId)}</strong><small>${esc(negocioNombre(c.negocioId))} · ${esc(c.phoneNumberId)} · token ${c.tieneToken ? "cargado" : "faltante"}</small></div><div class="row-actions"><button data-edit-channel="${c.id}">Editar</button></div></div>`
          )
          .join("")}</div>
      </section>
      <section class="admin-card">
        <div class="card-head"><div><h2>API keys de bots</h2><p>Las claves nuevas se muestran una sola vez.</p></div><span class="count">${S.admin.keys.length}</span></div>
        <form id="keyForm" class="admin-form">
          <select name="negocioId" required>${opcionesNegocios()}</select>
          <input name="nombre" placeholder="Bot producción" required>
          <button class="primary" type="submit">Generar key</button>
        </form>
        <div id="newKeyBox"></div>
        <div class="admin-list">${S.admin.keys
          .map(
            (k) => `<div class="admin-row"><div><strong>${esc(k.nombre)}</strong><small>${esc(negocioNombre(k.negocioId))} · •••${esc(k.keySuffix)} · ${k.activo ? "activa" : "revocada"}${k.lastUsedAt ? ` · último uso ${fecha(k.lastUsedAt)}` : ""}</small></div><div class="row-actions">${k.activo ? `<button class="danger" data-revoke-key="${k.id}">Revocar</button>` : ""}</div></div>`
          )
          .join("")}</div>
      </section>
      <section class="admin-card full">
        <div class="card-head"><div><h2>Plan Full y excepciones</h2><p>Catálogo general y overrides por negocio.</p></div></div>
        <div class="admin-form triple">
          <select id="featureName">${["etiquetas", "notas", "valoracion", "atajos", "gestionUsuarios", "maxAgentes"].map((f) => `<option>${f}</option>`).join("")}</select>
          <input id="featureValue" placeholder="true | false | unlimited | número">
          <button class="secondary" data-action="save-plan-feature">Guardar en Full</button>
          <select id="overrideBusiness">${opcionesNegocios()}</select>
          <input id="overrideValue" placeholder="Vacío elimina el override">
          <button class="secondary" data-action="save-override">Guardar excepción</button>
        </div>
        <div class="admin-list">${S.admin.planFeatures
          .map((f) => `<div class="admin-row"><div><strong>${esc(f.feature)}</strong><small>full = ${esc(f.valor)}</small></div></div>`)
          .join("")}${S.admin.overrides
          .map((f) => `<div class="admin-row"><div><strong>${esc(f.feature)}</strong><small>${esc(negocioNombre(f.negocioId))} = ${esc(f.valor)}</small></div></div>`)
          .join("")}</div>
      </section>`);
  }
  $("adminContent").innerHTML = cards.join("");
}

async function submitAdminForm(form) {
  const data = Object.fromEntries(new FormData(form));
  if (form.id === "businessForm") await api("/api/admin/negocios", { method: "POST", body: JSON.stringify(data) });
  if (form.id === "userForm") {
    if (!data.negocioId) delete data.negocioId;
    else data.negocioId = Number(data.negocioId);
    await api("/api/admin/usuarios", { method: "POST", body: JSON.stringify(data) });
  }
  if (form.id === "membershipForm") {
    data.usuarioId = Number(data.usuarioId);
    data.negocioId = Number(data.negocioId);
    await api("/api/admin/membresias", { method: "POST", body: JSON.stringify(data) });
  }
  if (form.id === "channelForm") {
    data.negocioId = Number(data.negocioId);
    await api("/api/admin/canales", { method: "POST", body: JSON.stringify(data) });
  }
  if (form.id === "keyForm") {
    data.negocioId = Number(data.negocioId);
    const resultado = await api("/api/admin/keys", { method: "POST", body: JSON.stringify(data) });
    await cargarAdmin();
    $("newKeyBox").innerHTML = `<p class="secret-box"><strong>Copiala ahora:</strong><br>${esc(resultado.apiKey)}</p>`;
    return;
  }
  form.reset();
  toast("Guardado.");
  await iniciarApp();
  await abrirAdmin();
}

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("loginError").textContent = "";
  try {
    await api("/api/backoffice/login", {
      method: "POST",
      body: JSON.stringify({ usuario: $("loginUsuario").value, password: $("loginPassword").value }),
    });
    $("loginPassword").value = "";
    await iniciarApp();
  } catch (error) {
    $("loginError").textContent = error.message;
  }
});

$("negocioSelect").addEventListener("change", async (event) => {
  S.negocioId = event.target.value ? Number(event.target.value) : null;
  S.canalId = null;
  S.conversacionId = null;
  cerrarDetalle();
  await cargarConversaciones();
});

$("canalFilter").addEventListener("change", async (event) => {
  S.canalId = event.target.value ? Number(event.target.value) : null;
  await cargarConversaciones();
});

let tagTimer;
$("tagFilter").addEventListener("input", (event) => {
  clearTimeout(tagTimer);
  tagTimer = setTimeout(async () => {
    S.tag = event.target.value.trim();
    await cargarConversaciones();
  }, 250);
});

$("assignmentSelect").addEventListener("change", async (event) => {
  try {
    await api("/api/backoffice/asignar", {
      method: "POST",
      body: JSON.stringify({
        conversacionId: S.conversacionId,
        usuarioId: event.target.value ? Number(event.target.value) : null,
      }),
    });
    await cargarConversaciones(true);
    await cargarDetalle(true);
  } catch (error) {
    toast(error.message, true);
  }
});

$("replyText").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    document.querySelector('[data-action="send"]').click();
  }
});

$("noteForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/backoffice/notas", {
      method: "POST",
      body: JSON.stringify({ conversacionId: S.conversacionId, texto: $("noteText").value }),
    });
    $("noteText").value = "";
    await cargarNotas();
    toast("Nota guardada.");
  } catch (error) {
    toast(error.message, true);
  }
});

$("adminContent").addEventListener("submit", async (event) => {
  if (!event.target.matches("form")) return;
  event.preventDefault();
  try {
    await submitAdminForm(event.target);
  } catch (error) {
    toast(error.message, true);
  }
});

document.addEventListener("keydown", async (event) => {
  if (event.key === "Enter" && event.target?.id === "newTag") {
    event.preventDefault();
    const nueva = event.target.value.trim();
    if (!nueva) return;
    const conv = S.conversaciones.find((c) => c.id === S.conversacionId);
    await guardarEtiquetas([...new Set([...etiquetasDe(conv), nueva])]);
  }
});

document.addEventListener("click", async (event) => {
  const conversation = event.target.closest("[data-conversation-id]");
  if (conversation) return seleccionarConversacion(conversation.dataset.conversationId);

  const queue = event.target.closest("[data-queue]");
  if (queue) {
    document.querySelectorAll("[data-queue]").forEach((b) => b.classList.toggle("active", b === queue));
    S.queue = queue.dataset.queue;
    return cargarConversaciones();
  }

  const tab = event.target.closest("[data-detail-tab]");
  if (tab) {
    S.detailTab = tab.dataset.detailTab;
    renderDetalleTab();
    if (S.detailTab === "notes") await cargarNotas();
    return;
  }

  const rating = event.target.closest("[data-rating]");
  if (rating) {
    const conv = S.conversaciones.find((c) => c.id === S.conversacionId);
    const nuevo = conv.valoracion === rating.dataset.rating ? null : rating.dataset.rating;
    try {
      await api("/api/backoffice/valoracion", {
        method: "POST",
        body: JSON.stringify({ conversacionId: S.conversacionId, valoracion: nuevo }),
      });
      await cargarConversaciones(true);
      await cargarDetalle(true);
    } catch (error) {
      toast(error.message, true);
    }
    return;
  }

  const removeTag = event.target.closest("[data-remove-tag]");
  if (removeTag) {
    const conv = S.conversaciones.find((c) => c.id === S.conversacionId);
    return guardarEtiquetas(etiquetasDe(conv).filter((t) => t !== removeTag.dataset.removeTag));
  }

  const useShortcut = event.target.closest("[data-use-shortcut]");
  if (useShortcut) {
    const atajo = S.atajos.find((a) => Number(a.id) === Number(useShortcut.dataset.useShortcut));
    if (atajo) $("replyText").value = atajo.texto;
    $("shortcutPopover").hidden = true;
    $("replyText").focus();
    return;
  }

  const deleteShortcut = event.target.closest("[data-delete-shortcut]");
  if (deleteShortcut) {
    try {
      await api(`/api/backoffice/atajos/${deleteShortcut.dataset.deleteShortcut}`, { method: "DELETE" });
      await cargarDetalle();
      mostrarAtajos();
    } catch (error) {
      toast(error.message, true);
    }
    return;
  }

  const editBusiness = event.target.closest("[data-edit-business]");
  if (editBusiness) {
    const n = S.admin.negocios.find((x) => Number(x.id) === Number(editBusiness.dataset.editBusiness));
    const nombre = prompt("Nombre del negocio", n.nombre);
    if (!nombre) return;
    const clave = prompt("Clave/slug", n.clave);
    if (!clave) return;
    const activo = confirm("Aceptar = activo. Cancelar = inactivo.");
    try {
      await api("/api/admin/negocios", {
        method: "PATCH",
        body: JSON.stringify({ id: Number(n.id), nombre, clave, tier: n.tier, activo }),
      });
      await iniciarApp();
      await abrirAdmin();
    } catch (error) {
      toast(error.message, true);
    }
    return;
  }

  const editUser = event.target.closest("[data-edit-user]");
  if (editUser) {
    const u = S.admin.usuarios.find((x) => Number(x.id) === Number(editUser.dataset.editUser));
    const nombre = prompt("Nombre visible", u.nombre || u.usuario);
    if (!nombre) return;
    const password = prompt("Contraseña nueva (vacío conserva la actual)", "");
    if (password && password.length < 10) return toast("La contraseña necesita al menos 10 caracteres.", true);
    const activo = confirm("Aceptar = usuario activo. Cancelar = inactivo.");
    const esSuperAdmin = confirm("Aceptar = superadmin. Cancelar = usuario normal.");
    try {
      await api("/api/admin/usuarios", {
        method: "PATCH",
        body: JSON.stringify({ id: Number(u.id), nombre, password, activo, esSuperAdmin }),
      });
      await iniciarApp();
      await abrirAdmin();
    } catch (error) {
      toast(error.message, true);
    }
    return;
  }

  const editChannel = event.target.closest("[data-edit-channel]");
  if (editChannel) {
    const c = S.admin.canales.find((x) => Number(x.id) === Number(editChannel.dataset.editChannel));
    const nombre = prompt("Nombre del canal", c.nombre || "");
    if (nombre == null) return;
    const phoneNumberId = prompt("Phone Number ID", c.phoneNumberId);
    if (!phoneNumberId) return;
    const token = prompt("Token nuevo (vacío conserva el actual)", "");
    const activo = confirm("Aceptar = canal activo. Cancelar = inactivo.");
    try {
      await api("/api/admin/canales", {
        method: "PATCH",
        body: JSON.stringify({ id: Number(c.id), negocioId: Number(c.negocioId), nombre, phoneNumberId, token, activo }),
      });
      await cargarAdmin();
    } catch (error) {
      toast(error.message, true);
    }
    return;
  }

  const deleteMembership = event.target.closest("[data-delete-membership]");
  if (deleteMembership) {
    const [usuarioId, negocioId] = deleteMembership.dataset.deleteMembership.split(":").map(Number);
    try {
      await api("/api/admin/membresias", { method: "DELETE", body: JSON.stringify({ usuarioId, negocioId }) });
      await cargarAdmin();
    } catch (error) {
      toast(error.message, true);
    }
    return;
  }

  const revokeKey = event.target.closest("[data-revoke-key]");
  if (revokeKey) {
    if (!confirm("¿Revocar esta API key? El bot dejará de poder ingresar mensajes con ella.")) return;
    try {
      await api("/api/admin/keys", { method: "DELETE", body: JSON.stringify({ id: Number(revokeKey.dataset.revokeKey) }) });
      await cargarAdmin();
    } catch (error) {
      toast(error.message, true);
    }
    return;
  }

  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  if (action === "logout") {
    await api("/api/backoffice/logout", { method: "POST" }).catch(() => {});
    return mostrarLogin();
  }
  if (action === "inbox") return abrirInbox();
  if (action === "admin") return abrirAdmin();
  if (action === "refresh-admin") return cargarAdmin();
  if (action === "toggle-shortcuts") return mostrarAtajos();
  if (action === "close-detail") return cerrarDetalle();
  if (action === "resolve") {
    try {
      await api("/api/backoffice/resolver", {
        method: "POST",
        body: JSON.stringify({ conversacionId: S.conversacionId }),
      });
      await cargarConversaciones(true);
      await cargarDetalle(true);
      toast("El bot volvió a tomar la conversación.");
    } catch (error) {
      toast(error.message, true);
    }
  }
  if (action === "send") {
    const texto = $("replyText").value.trim();
    if (!texto) return;
    const boton = event.target.closest("button");
    boton.disabled = true;
    try {
      await api("/api/backoffice/responder", {
        method: "POST",
        body: JSON.stringify({ conversacionId: S.conversacionId, texto }),
      });
      $("replyText").value = "";
      await cargarConversaciones(true);
      await cargarDetalle(true);
    } catch (error) {
      toast(error.message, true);
    } finally {
      boton.disabled = false;
    }
  }
  if (action === "save-plan-feature" || action === "save-override") {
    const feature = $("featureName").value;
    const payload =
      action === "save-plan-feature"
        ? { tier: "full", feature, valor: $("featureValue").value.trim() }
        : { negocioId: Number($("overrideBusiness").value), feature, valor: $("overrideValue").value.trim() };
    try {
      await api("/api/admin/features", { method: "POST", body: JSON.stringify(payload) });
      await iniciarApp();
      await abrirAdmin();
      toast("Feature actualizada.");
    } catch (error) {
      toast(error.message, true);
    }
  }
});

document.addEventListener("submit", async (event) => {
  if (event.target?.id !== "shortcutForm") return;
  event.preventDefault();
  const conv = S.conversaciones.find((c) => c.id === S.conversacionId);
  const data = Object.fromEntries(new FormData(event.target));
  try {
    await api("/api/backoffice/atajos", {
      method: "POST",
      body: JSON.stringify({ negocioId: conv.negocioId, clave: data.clave, texto: data.texto }),
    });
    $("shortcutPopover").hidden = true;
    await cargarDetalle();
    mostrarAtajos();
  } catch (error) {
    toast(error.message, true);
  }
});

iniciarApp().catch((error) => {
  if (!S.ctx) return mostrarLogin();
  toast(error.message, true);
});
