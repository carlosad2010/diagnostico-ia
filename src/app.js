import { chatView, initChat } from "./chat.js";
import { informeView, initInforme } from "./informe.js";
import { initThemeToggle } from "./theme.js";
import { h } from "./dom.js";
import { CLAVE_SESION, TEXTO_CONSENTIMIENTO } from "./utils.js";

// =====================================================
// VISTAS ESTÁTICAS (sin datos de la persona)
// =====================================================
function inicioView() {
  return `
    <section class="home row align-items-center g-4 g-lg-5">
      <div class="col-lg-6">
        <p class="kicker">Consultoría Studio-IA · 15 minutos</p>
        <h1 class="home__title">Descubre qué puedes automatizar en tu trabajo</h1>
        <p class="home__intro">
          Conversa con nuestro Consultor de Diagnóstico. Te hará pocas preguntas a la vez sobre tu día a día
          y al final recibirás tus oportunidades priorizadas, con la solución más simple y el ahorro estimado.
        </p>
        <ul class="home__traits" aria-label="Qué obtienes">
          <li class="trait">Cualquier cargo o industria</li>
          <li class="trait">Primero procesos, luego IA</li>
          <li class="trait">Plan de 30-60-90 días</li>
        </ul>
      </div>
      <div class="col-lg-5 offset-lg-1">
        <div id="inicio-accion"></div>
      </div>
    </section>`;
}

function comoFuncionaView() {
  return `
    <section class="about">
      <p class="kicker">Cómo funciona</p>
      <h1>Un diagnóstico en cuatro pasos</h1>
      <ol class="pasos-lista">
        <li><strong>Contexto.</strong> Tu cargo, tu empresa y las herramientas que usas.</li>
        <li><strong>Mapa de tu semana.</strong> Qué haces a diario, cada semana y a fin de mes.</li>
        <li><strong>Detectores.</strong> Qué copias, qué esperas, qué te preguntan siempre, qué sale mal.</li>
        <li><strong>Detalle de las tareas clave.</strong> Frecuencia, tiempo, reglas, datos y riesgos.</li>
      </ol>
      <h2>Qué recibes</h2>
      <ul>
        <li>Inventario de tareas con horas al mes y matriz de impacto y viabilidad.</li>
        <li>De 3 a 5 fichas de oportunidad con la solución recomendada, una alternativa y el primer paso.</li>
        <li>Ahorro estimado con un factor conservador y una hoja de ruta de 30-60-90 días.</li>
        <li>Lo que <strong>no</strong> conviene automatizar todavía, y por qué.</li>
      </ul>
      <h2>El filtro de decisión</h2>
      <p>Para cada oportunidad respondemos en orden: ¿conviene mejorar el proceso primero? ¿bastan reglas? ¿hace falta IA generativa? ¿un modelo predictivo? ¿un agente? ¿hay datos suficientes? ¿debe quedar revisión humana? La primera respuesta que resuelve el problema es la recomendación.</p>
      <h2>Tus datos</h2>
      <p>No necesitas compartir nombres de clientes, cifras confidenciales ni contraseñas. Tus respuestas se procesan con un servicio de IA de terceros (Google Gemini) y se guardan para generar tu informe.</p>
      <a href="/chat" class="btn" data-link>Empezar mi diagnóstico</a>
    </section>`;
}

// =====================================================
// INICIO: registro o "continuar"
// =====================================================
function initInicio() {
  const zona = document.getElementById("inicio-accion");
  let sesion = null;
  try {
    sesion = localStorage.getItem(CLAVE_SESION);
  } catch {
    /* sin almacenamiento */
  }
  if (sesion) {
    zona.append(
      h("div", { class: "registro d-grid gap-2" },
        h("h2", { class: "registro__titulo", text: "Tienes un diagnóstico en curso" }),
        h("a", { href: "/chat", class: "btn", "data-link": true, text: "Continuar mi diagnóstico" }),
        h("button", { type: "button", class: "btn btn--sec", text: "Empezar uno nuevo", onclick: () => {
          localStorage.removeItem(CLAVE_SESION);
          render();
        } }),
      ),
    );
    return;
  }
  zona.append(formularioRegistro());
}

function formularioRegistro() {
  const error = h("p", { class: "form-error", role: "alert", hidden: true });
  const boton = h("button", { type: "submit", class: "btn btn--full btn-lg", disabled: true, text: "Comenzar diagnóstico" });
  const check = h("input", { type: "checkbox", id: "consent", class: "form-check-input", required: true, onchange: (e) => (boton.disabled = !e.target.checked) });

  const campo = (id, etiqueta, attrs) =>
    h("div", { class: "campo" }, h("label", { for: id, text: etiqueta }), h("input", { id, name: id, class: "form-control", ...attrs }));

  const form = h("form", { class: "registro", novalidate: false },
    h("h2", { class: "registro__titulo", text: "Empieza tu diagnóstico" }),
    campo("nombre", "Nombre", { required: true, minlength: 2, maxlength: 80, autocomplete: "given-name" }),
    campo("email", "Correo (ahí te enviamos el informe)", { type: "email", required: true, maxlength: 120, autocomplete: "email" }),
    campo("empresa", "Empresa (opcional)", { maxlength: 120, autocomplete: "organization" }),
    h("label", { class: "consent", for: "consent" }, check, h("span", { text: TEXTO_CONSENTIMIENTO })),
    error,
    boton,
    h("p", { class: "nota", text: "No compartas nombres de clientes, cifras confidenciales ni contraseñas: no hacen falta." }),
  );

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(form));
    boton.disabled = true;
    boton.textContent = "Conectando con el consultor…";
    error.hidden = true;
    try {
      const r = await fetch("/api/sesion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: datos.nombre, email: datos.email, empresa: datos.empresa, consentimiento: check.checked }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      localStorage.setItem(CLAVE_SESION, d.sesionId);
      navigateTo("/chat");
    } catch (err) {
      error.textContent = err.message || "No pudimos iniciar. Intenta de nuevo.";
      error.hidden = false;
      boton.disabled = !check.checked;
      boton.textContent = "Comenzar diagnóstico";
    }
  });
  return form;
}

// =====================================================
// ROUTING (History API)
// =====================================================
const routes = {
  "/inicio": { title: "Diagnóstico de automatización · Studio-IA", view: inicioView, init: initInicio },
  "/chat": { title: "Entrevista · Studio-IA", view: chatView, init: initChat },
  "/como-funciona": { title: "Cómo funciona · Studio-IA", view: comoFuncionaView },
};

function retomarSesion(id) {
  try {
    localStorage.setItem(CLAVE_SESION, id);
  } catch {
    /* sin almacenamiento */
  }
  history.replaceState(null, "", "/chat");
  render();
}

function resolver(path) {
  if (routes[path]) return { ...routes[path], path };
  const informe = path.match(/^\/diagnostico\/([0-9a-f-]{36})$/i);
  // Enlace del correo: guarda la sesión en este navegador y abre el chat
  const retomar = path.match(/^\/retomar\/([0-9a-f-]{36})$/i);
  if (retomar) return { title: "Retomando tu diagnóstico · Studio-IA", view: () => "<p>Retomando tu diagnóstico…</p>", init: () => retomarSesion(retomar[1]), path: "/chat" };
  if (informe) return { title: "Tu diagnóstico · Studio-IA", view: informeView, init: () => initInforme(informe[1]), path: "/diagnostico" };
  return null;
}

export function render() {
  const route = resolver(location.pathname);
  if (!route) {
    history.replaceState(null, "", "/inicio");
    return render();
  }
  const vista = document.getElementById("view");
  vista.innerHTML = route.view(); // plantillas propias, sin datos de la persona
  document.title = route.title;
  document.body.dataset.vista = route.path.slice(1);
  updateActiveLink(route.path);
  if (route.init) route.init();
}

function updateActiveLink(path) {
  document.querySelectorAll(".app-nav__link").forEach((link) => {
    if (link.getAttribute("href") === path) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

export function navigateTo(url) {
  history.pushState(null, "", url);
  render();
  document.getElementById("view").focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

document.addEventListener("click", (event) => {
  const link = event.target.closest("a[data-link]");
  if (!link || event.ctrlKey || event.metaKey) return;
  event.preventDefault();
  navigateTo(link.getAttribute("href"));
});
window.addEventListener("popstate", render);
initThemeToggle();
render();
