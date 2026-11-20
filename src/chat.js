import { h, textoEnriquecido } from "./dom.js";
import { CLAVE_SESION, MENSAJE_CIERRE, formatTime, getMessageMeta, isValidMessage, textoPlano } from "./utils.js";
import { navigateTo } from "./app.js";

// =====================================================
// 1. ESTADO DE LA VISTA (el historial real vive en el servidor)
// =====================================================
const estado = {
  sesionId: null,
  mensajes: [], // { rol, texto, creado }
  diagnosticoUrl: null,
  errorDiagnostico: null,
  cerrada: false, // terminó sin diagnóstico (mensajes fuera de tema)
  cargando: false,
  cerrando: false,
};

const COPY_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const CHECK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`;

// =====================================================
// 2. VISTA
// =====================================================
export function chatView() {
  return `
    <header class="app-header">
      <span class="app-header__avatar" aria-hidden="true">IA</span>
      <div>
        <h1 class="app-title">Consultor de Diagnóstico</h1>
        <p class="app-subtitle"><span class="status-dot"></span>En línea · Studio-IA</p>
      </div>
    </header>
    <section class="messages" id="messages" aria-live="polite"></section>
    <div id="chat-pie"></div>`;
}

// =====================================================
// 3. MENSAJES
// =====================================================
function crearMensaje(m) {
  const { roleClass, author } = getMessageMeta(m.rol);
  const cuerpo = m.rol === "user" ? h("p", { class: "message__text", text: m.texto }) : h("div", { class: "message__text" }, textoEnriquecido(m.texto));
  const pie = h("div", { class: "message__meta" }, h("time", { class: "message__time", datetime: new Date(m.creado).toISOString(), text: formatTime(m.creado) }));
  if (m.rol !== "user") pie.append(botonCopiar(textoPlano(m.texto)));
  return h("div", { class: `message ${roleClass}` },
    m.rol !== "user" ? h("span", { class: "message__avatar", "aria-hidden": "true", text: "IA" }) : null,
    h("div", { class: "message__burbuja" }, h("span", { class: "message__author", text: author }), cuerpo, pie),
  );
}

function botonCopiar(texto) {
  const b = h("button", { type: "button", class: "message__copy", "aria-label": "Copiar respuesta", title: "Copiar respuesta" });
  b.innerHTML = COPY_ICON; // ícono propio, no texto de la persona
  b.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(texto);
      b.innerHTML = CHECK_ICON;
      b.classList.add("message__copy--done");
      setTimeout(() => {
        b.innerHTML = COPY_ICON;
        b.classList.remove("message__copy--done");
      }, 1500);
    } catch (e) {
      console.error("No se pudo copiar:", e);
    }
  });
  return b;
}

function renderMensajes() {
  const cont = document.getElementById("messages");
  if (!cont) return;
  cont.replaceChildren(...estado.mensajes.map(crearMensaje));
  if (estado.cargando) {
    const texto = estado.cerrando
      ? "Analizando tu entrevista y preparando el informe (puede tardar hasta un minuto)"
      : "El consultor está escribiendo";
    const puntos = h("span", { class: "typing-dots", "aria-hidden": "true" }, h("span", { text: "." }), h("span", { text: "." }), h("span", { text: "." }));
    cont.append(h("div", { class: "message message--consultor message--typing" }, h("div", { class: "message__burbuja" }, texto, puntos)));
  }
  if (estado.diagnosticoUrl) {
    const ruta = new URL(estado.diagnosticoUrl).pathname;
    cont.append(
      h("div", { class: "listo" },
        h("div", {}, h("p", { class: "kicker", text: "Tu diagnóstico está listo" }), h("strong", { text: "Oportunidades priorizadas, ahorro estimado y hoja de ruta." })),
        h("a", { class: "btn", href: ruta, "data-link": true, text: "Ver mi diagnóstico" }),
      ),
    );
  }
  cont.scrollTop = cont.scrollHeight;
}

// =====================================================
// 4. PIE: cuadro de texto y acciones
// =====================================================
function renderPie(error) {
  const pie = document.getElementById("chat-pie");
  if (!pie) return;
  const alerta = error ? h("p", { class: "form-error", role: "alert", text: error }) : null;

  if (estado.diagnosticoUrl || estado.cerrada) {
    pie.replaceChildren(
      h("div", { class: "chat-acciones" },
        h("span", {
          text: estado.cerrada
            ? "La conversación terminó sin diagnóstico."
            : "La entrevista terminó. Si configuraste el correo, también te llegó el enlace.",
        }),
        h("button", { type: "button", class: "btn btn--sec", text: estado.cerrada ? "Empezar un diagnóstico" : "Hacer otro diagnóstico", onclick: nuevo }),
      ),
    );
    return;
  }

  const input = h("textarea", {
    id: "message-input", class: "chat-input form-control", rows: 2, maxlength: 3000, "aria-label": "Tu respuesta",
    placeholder: "Cuéntalo con tus palabras y con todo el detalle que puedas…",
    disabled: estado.cargando,
  });
  const enviar = h("button", { type: "submit", id: "send-button", class: "btn chat-send", disabled: estado.cargando, text: "Enviar" });
  const form = h("form", { class: "input-area", id: "chat-form" }, input, enviar);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!isValidMessage(input.value) || estado.cargando) return;
    mandar(input.value.trim());
  });

  const respuestas = estado.mensajes.filter((m) => m.rol === "user").length;
  const acciones = h("div", { class: "chat-acciones" }, h("span", { text: `Respuestas: ${respuestas}. Entre más detalle, mejor tu diagnóstico (lo ideal son 8-15 respuestas).` }));
  if (estado.errorDiagnostico) {
    acciones.append(h("button", { type: "button", class: "btn", disabled: estado.cargando, text: "Reintentar diagnóstico", onclick: () => mandar(MENSAJE_CIERRE, true) }));
  } else if (respuestas >= 3) {
    acciones.append(h("button", { type: "button", class: "btn btn-link enlace", disabled: estado.cargando, text: "Ya tengo prisa: entrégame el diagnóstico", onclick: () => mandar(MENSAJE_CIERRE, true) }));
  }
  pie.replaceChildren(...[alerta, form, acciones].filter(Boolean));
  if (!estado.cargando) input.focus({ preventScroll: true });
  return input;
}

// =====================================================
// 5. ENVIAR A LA FUNCIÓN /api/chat
// =====================================================
async function mandar(texto, cerrar = false) {
  // Un reintento de diagnóstico no repite el mensaje de cierre en pantalla
  const reintento = cerrar && estado.errorDiagnostico;
  if (!reintento) estado.mensajes.push({ rol: "user", texto, creado: Date.now() });
  estado.cargando = true;
  estado.cerrando = cerrar;
  renderMensajes();
  renderPie();

  let error = null;
  try {
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sesionId: estado.sesionId, mensaje: texto, cerrar }),
    });
    const d = await r.json();
    if (!r.ok) {
      const err = new Error(d.error);
      err.status = r.status;
      throw err;
    }
    if (d.respuesta && !(reintento && d.errorDiagnostico)) estado.mensajes.push({ rol: "assistant", texto: d.respuesta, creado: Date.now() });
    estado.diagnosticoUrl = d.diagnosticoUrl;
    estado.errorDiagnostico = d.errorDiagnostico;
    estado.cerrada = Boolean(d.cerrada);
    if (d.errorDiagnostico) error = d.errorDiagnostico;
  } catch (e) {
    console.error(e);
    if (!reintento) estado.mensajes.pop();
    error = e.message || "No se envió el mensaje. Intenta de nuevo.";
    if (e.status === 409) await cargar(); // ya estaba terminado
  } finally {
    estado.cargando = false;
    estado.cerrando = false;
    renderMensajes();
    const input = renderPie(error);
    // si falló, el texto vuelve al cuadro para reintentar
    if (error && input && !cerrar && !estado.errorDiagnostico) input.value = texto;
  }
}

async function cargar() {
  const r = await fetch(`/api/sesion?id=${estado.sesionId}`);
  if (!r.ok) throw new Error(String(r.status));
  const d = await r.json();
  estado.mensajes = d.mensajes.map((m) => ({ ...m, creado: m.creado ? new Date(m.creado).getTime() : Date.now() }));
  estado.diagnosticoUrl = d.diagnosticoUrl;
  estado.cerrada = d.estado === "cerrado";
}

function nuevo() {
  localStorage.removeItem(CLAVE_SESION);
  Object.assign(estado, { sesionId: null, mensajes: [], diagnosticoUrl: null, errorDiagnostico: null, cerrada: false });
  navigateTo("/inicio");
}

// =====================================================
// 6. INICIO DE LA VISTA
// =====================================================
export async function initChat() {
  let id = null;
  try {
    id = localStorage.getItem(CLAVE_SESION);
  } catch {
    /* sin almacenamiento */
  }
  if (!id) return navigateTo("/inicio");

  if (estado.sesionId !== id) {
    Object.assign(estado, { sesionId: id, mensajes: [], diagnosticoUrl: null, errorDiagnostico: null, cerrada: false });
    estado.cargando = true;
    renderMensajes();
    try {
      await cargar();
    } catch {
      localStorage.removeItem(CLAVE_SESION);
      estado.sesionId = null;
      return navigateTo("/inicio");
    } finally {
      estado.cargando = false;
    }
  }
  renderMensajes();
  renderPie();
}
