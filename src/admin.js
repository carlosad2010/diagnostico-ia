import { h, textoEnriquecido } from "./dom.js";
import { formatoNumero } from "./utils.js";

// =====================================================
// PANEL ADMINISTRATIVO (/admin) — uso exclusivo del dueño del software.
// Historial de personas que hicieron el diagnóstico, indicadores, descarga en CSV
// y lectura de cada conversación. Todo se pinta con textContent.
// =====================================================

const ESTADOS = {
  completado: ["Diagnóstico entregado", "estado--ok"],
  en_curso: ["En curso", "estado--curso"],
  abandonado: ["Sin terminar", "estado--alerta"],
  cerrado: ["Cerrada por fuera de tema", "estado--cerrado"],
};
const PERIODOS = [
  ["todo", "Todo el historial"],
  ["7", "Últimos 7 días"],
  ["30", "Últimos 30 días"],
  ["90", "Últimos 90 días"],
  ["rango", "Rango personalizado"],
];

const filtros = { q: "", estado: "", periodo: "todo", desde: "", hasta: "", pagina: 1 };
const compacto = new Intl.NumberFormat("es-CO", { notation: "compact", maximumFractionDigits: 1 });
const fechaCorta = (d) => new Date(d).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" }).replace(/ de /g, " ");
const hora = (d) => new Date(d).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" });
const isoDia = (t) => new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export function adminView() {
  return `<section class="admin" id="admin" aria-live="polite"><p class="cargando">Cargando el panel…</p></section>`;
}

export function initAdmin() {
  // El panel no debe aparecer en buscadores
  if (!document.querySelector('meta[name="robots"]')) document.head.append(h("meta", { name: "robots", content: "noindex, nofollow" }));
  cargar();
}

// ---------- Datos ----------
function parametros(extra = {}) {
  const p = new URLSearchParams();
  if (filtros.q) p.set("q", filtros.q);
  if (filtros.estado) p.set("estado", filtros.estado);
  const hoy = Date.now();
  if (["7", "30", "90"].includes(filtros.periodo)) p.set("desde", isoDia(hoy - (Number(filtros.periodo) - 1) * 864e5));
  if (filtros.periodo === "rango") {
    if (filtros.desde) p.set("desde", filtros.desde);
    if (filtros.hasta) p.set("hasta", filtros.hasta);
  }
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return p;
}

async function cargar() {
  const raiz = document.getElementById("admin");
  if (!raiz) return;
  raiz.classList.add("admin--cargando"); // mantiene lo anterior a media opacidad mientras llega lo nuevo
  try {
    const r = await fetch(`/api/admin?${parametros({ accion: "panel", pagina: filtros.pagina })}`);
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) return pintarAcceso(raiz);
    if (!r.ok) return raiz.replaceChildren(h("section", { class: "seccion" }, h("h1", { text: "Panel no disponible" }), h("p", { text: d.error || "Intenta de nuevo." })));
    pintarPanel(raiz, d);
  } finally {
    raiz.classList.remove("admin--cargando");
  }
}

// ---------- Acceso ----------
function pintarAcceso(raiz, error) {
  const alerta = h("p", { class: "form-error", role: "alert", text: error ?? "", hidden: !error });
  const clave = h("input", { id: "clave", type: "password", class: "form-control", required: true, autocomplete: "current-password" });
  const boton = h("button", { type: "submit", class: "btn btn--full", text: "Entrar" });
  const form = h("form", { class: "registro admin-acceso" },
    h("p", { class: "kicker", text: "Uso administrativo" }),
    h("h1", { class: "registro__titulo", text: "Panel de diagnósticos" }),
    h("div", { class: "campo" }, h("label", { for: "clave", text: "Contraseña" }), clave),
    alerta,
    boton,
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    boton.disabled = true;
    const r = await fetch("/api/admin?accion=entrar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clave: clave.value }) });
    if (r.ok) return cargar();
    const d = await r.json().catch(() => ({}));
    pintarAcceso(raiz, d.error || "No se pudo entrar.");
  });
  raiz.replaceChildren(form);
  clave.focus();
}

async function salir() {
  await fetch("/api/admin?accion=salir", { method: "POST" });
  pintarAcceso(document.getElementById("admin"));
}

// ---------- Panel ----------
function pintarPanel(raiz, d) {
  // La primera vez arma el marco; después solo cambia el contenido (los filtros no pierden el foco)
  if (!raiz.querySelector(".admin-panel")) raiz.replaceChildren(marco());
  raiz.querySelector("#admin-indicadores").replaceChildren(...indicadoresVista(d.indicadores));
  raiz.querySelector("#admin-semanas").replaceChildren(graficaSemanas(d.semanas));
  raiz.querySelector("#admin-industrias").replaceChildren(listaIndustrias(d.industrias));
  raiz.querySelector("#admin-tabla").replaceChildren(tabla(d));
  raiz.querySelector("#admin-exportar").href = `/api/admin?${parametros({ accion: "exportar" })}`;
}

function marco() {
  const buscar = h("input", { type: "search", class: "form-control", placeholder: "Nombre, correo, empresa, cargo o industria", "aria-label": "Buscar", value: filtros.q });
  let espera;
  buscar.addEventListener("input", () => {
    clearTimeout(espera);
    espera = setTimeout(() => {
      filtros.q = buscar.value.trim();
      filtros.pagina = 1;
      cargar();
    }, 300);
  });

  const desde = h("input", { type: "date", class: "form-control", "aria-label": "Desde", value: filtros.desde });
  const hasta = h("input", { type: "date", class: "form-control", "aria-label": "Hasta", value: filtros.hasta });
  const rango = h("div", { class: "admin-rango", hidden: filtros.periodo !== "rango" }, desde, h("span", { text: "a" }), hasta);
  for (const [input, k] of [[desde, "desde"], [hasta, "hasta"]]) {
    input.addEventListener("change", () => {
      filtros[k] = input.value;
      filtros.pagina = 1;
      cargar();
    });
  }
  const periodo = h("select", { class: "form-select", "aria-label": "Periodo" }, PERIODOS.map(([v, t]) => h("option", { value: v, text: t, selected: v === filtros.periodo })));
  periodo.addEventListener("change", () => {
    filtros.periodo = periodo.value;
    filtros.pagina = 1;
    rango.hidden = periodo.value !== "rango";
    cargar();
  });
  const estado = h("select", { class: "form-select", "aria-label": "Estado" },
    h("option", { value: "", text: "Todos los estados" }),
    Object.entries(ESTADOS).map(([v, [t]]) => h("option", { value: v, text: t, selected: v === filtros.estado })),
  );
  estado.addEventListener("change", () => {
    filtros.estado = estado.value;
    filtros.pagina = 1;
    cargar();
  });

  return h("div", { class: "admin-panel" },
    h("header", { class: "admin-cabecera" },
      h("div", {}, h("p", { class: "kicker", text: "Uso administrativo" }), h("h1", { text: "Historial de diagnósticos" })),
      h("div", { class: "admin-cabecera__acciones" },
        h("a", { id: "admin-exportar", class: "btn", href: "#", download: true, text: "Descargar CSV" }),
        h("button", { type: "button", class: "btn btn--sec", text: "Salir", onclick: salir }),
      ),
    ),
    h("div", { class: "admin-filtros", role: "search" }, periodo, rango, estado, buscar),
    h("div", { class: "admin-indicadores", id: "admin-indicadores" }),
    h("div", { class: "admin-graficas" },
      h("section", { class: "seccion admin-tarjeta" }, h("h2", { text: "Diagnósticos iniciados por semana" }), h("p", { class: "sutil", text: "Últimas 12 semanas del periodo elegido" }), h("div", { id: "admin-semanas" })),
      h("section", { class: "seccion admin-tarjeta" }, h("h2", { text: "Industrias más frecuentes" }), h("p", { class: "sutil", text: "Entre los diagnósticos entregados" }), h("div", { id: "admin-industrias" })),
    ),
    h("section", { class: "seccion admin-tarjeta" }, h("div", { id: "admin-tabla" })),
  );
}

function indicadoresVista(k) {
  const tile = (etiqueta, valor, nota, destacada) =>
    h("div", { class: `cifra${destacada ? " cifra--oro" : ""}` }, h("span", { class: "cifra__etiqueta", text: etiqueta }), h("strong", { text: valor }), nota ? h("span", { text: nota }) : null);
  const pct = Math.round(k.tasa_finalizacion * 100);
  return [
    tile("Personas que iniciaron", formatoNumero(k.personas)),
    tile("Diagnósticos entregados", formatoNumero(k.completados), `${pct} % de finalización`, true),
    tile("Sin terminar", formatoNumero(k.sin_terminar), `${formatoNumero(k.en_curso)} en curso ahora`),
    tile("Cerradas por fuera de tema", formatoNumero(k.cerradas)),
    tile("Horas al mes liberables", `${formatoNumero(k.horas_mes, 1)} h`, `${formatoNumero(k.horas_mes_promedio, 1)} h por diagnóstico`),
    tile("Ahorro anual estimado", k.valor_anual ? compacto.format(k.valor_anual) : "—", k.valor_anual ? "suma en la moneda de cada persona" : "nadie dio el costo de su hora"),
    tile("Respuestas por conversación", formatoNumero(k.respuestas_promedio, 1), "promedio"),
  ];
}

// Columnas por semana: una sola serie (sin leyenda), tooltip al pasar el cursor o enfocar.
function graficaSemanas(semanas) {
  const max = Math.max(1, ...semanas.map((s) => s.iniciados));
  const tope = max <= 4 ? 4 : Math.ceil(max / 5) * 5;
  const tooltip = h("div", { class: "grafica__tooltip", role: "status", hidden: true });
  const columnas = semanas.map((s, i) => {
    const etiqueta = `Semana del ${new Date(s.inicio).toLocaleDateString("es-CO", { day: "numeric", month: "short" })}`;
    const col = h("button", { type: "button", class: "grafica__col", "aria-label": `${etiqueta}: ${s.iniciados} iniciados, ${s.entregados} entregados` },
      i === semanas.length - 1 && s.iniciados ? h("span", { class: "grafica__valor", text: String(s.iniciados) }) : null,
      h("span", { class: "grafica__barra", style: `height:${(s.iniciados / tope) * 100}%` }),
    );
    const mostrar = () => {
      tooltip.replaceChildren(
        h("strong", { text: `${s.iniciados} iniciados` }),
        h("span", { text: `${s.entregados} con diagnóstico entregado` }),
        h("span", { class: "sutil", text: etiqueta }),
      );
      tooltip.hidden = false;
      const caja = col.getBoundingClientRect();
      const padre = col.parentElement.getBoundingClientRect();
      tooltip.style.left = `${Math.min(Math.max(caja.left - padre.left + caja.width / 2, 70), padre.width - 70)}px`;
    };
    col.addEventListener("pointerenter", mostrar);
    col.addEventListener("focus", mostrar);
    col.addEventListener("pointerleave", () => (tooltip.hidden = true));
    col.addEventListener("blur", () => (tooltip.hidden = true));
    return col;
  });
  const ejes = [tope, tope / 2, 0].map((v) => h("div", { class: "grafica__linea" }, h("span", { text: formatoNumero(v) })));
  const fechas = semanas.map((s) => {
    const d = new Date(s.inicio);
    return h("span", { text: `${d.getDate()}/${d.getMonth() + 1}` });
  });
  return h("div", { class: "grafica" },
    h("div", { class: "grafica__area" }, h("div", { class: "grafica__ejes", "aria-hidden": "true" }, ejes), h("div", { class: "grafica__cols" }, columnas), tooltip),
    h("div", { class: "grafica__fechas", "aria-hidden": "true" }, fechas),
  );
}

function listaIndustrias(lista) {
  if (!lista.length) return h("p", { class: "sutil", text: "Aún no hay diagnósticos entregados en este periodo." });
  const max = lista[0].total;
  return h("ol", { class: "ranking" },
    lista.map((x) =>
      h("li", {},
        h("span", { class: "ranking__nombre", text: x.nombre }),
        h("span", { class: "ranking__valor", text: formatoNumero(x.total) }),
        h("span", { class: "ranking__pista", "aria-hidden": "true" }, h("span", { class: "ranking__barra", style: `width:${(x.total / max) * 100}%` })),
      ),
    ),
  );
}

function tabla(d) {
  if (!d.filas.length) return h("p", { class: "sutil", text: "No hay diagnósticos con estos filtros." });
  const dinero = (x) => (x.valor_anual_esperado === null ? "—" : `${formatoNumero(x.valor_anual_esperado)} ${x.moneda ?? ""}`.trim());
  const fila = (x) => {
    const [texto, clase] = ESTADOS[x.estado] ?? [x.estado, ""];
    return h("tr", {},
      h("td", { "data-label": "Fecha", class: "col-fecha" }, h("span", { text: fechaCorta(x.creado) }), h("span", { class: "sutil", text: hora(x.creado) })),
      h("td", { "data-label": "Persona", class: "col-actividad" }, h("strong", { text: x.nombre }), h("span", { class: "sutil", text: x.email })),
      h("td", { "data-label": "Empresa", text: x.empresa || "—" }),
      h("td", { "data-label": "Cargo e industria" }, h("span", { text: x.cargo || "—" }), x.industria ? h("span", { class: "sutil", text: x.industria }) : null),
      h("td", { "data-label": "Estado" }, h("span", { class: `estado ${clase}`, text: texto }), x.fuera_de_tema ? h("span", { class: "sutil", text: `${x.fuera_de_tema} aviso(s) fuera de tema` }) : null),
      h("td", { "data-label": "Respuestas", class: "num", text: formatoNumero(x.turnos) }),
      h("td", { "data-label": "Horas/mes", class: "num", text: x.horas_mes_liberadas === null ? "—" : `${formatoNumero(x.horas_mes_liberadas, 1)} h` }),
      h("td", { "data-label": "Ahorro anual", class: "num", text: dinero(x) }),
      h("td", { "data-label": "Acciones", class: "admin-acciones" },
        h("button", { type: "button", class: "btn btn-link enlace", text: "Conversación", onclick: () => verConversacion(x.id) }),
        x.diagnostico_id ? h("a", { href: `/diagnostico/${x.diagnostico_id}`, target: "_blank", rel: "noopener", text: "Informe" }) : null,
      ),
    );
  };
  const pagina = (n) => () => {
    filtros.pagina = n;
    cargar();
    document.getElementById("admin-tabla")?.scrollIntoView({ block: "start" });
  };
  return h("div", {},
    h("div", { class: "admin-tabla__cabecera" },
      h("h2", { text: "Personas que hicieron el diagnóstico" }),
      h("span", { class: "sutil", text: `${formatoNumero(d.total)} en total` }),
    ),
    h("div", { class: "tabla-scroll" },
      h("table", { class: "tabla-admin" },
        h("thead", {}, h("tr", {}, ["Fecha", "Persona", "Empresa", "Cargo e industria", "Estado", "Respuestas", "Horas/mes", "Ahorro anual", ""].map((c) => h("th", { scope: "col", text: c })))),
        h("tbody", {}, d.filas.map(fila)),
      ),
    ),
    d.paginas > 1
      ? h("nav", { class: "paginacion", "aria-label": "Páginas" },
          h("button", { type: "button", class: "btn btn--sec", text: "Anterior", disabled: d.pagina <= 1, onclick: pagina(d.pagina - 1) }),
          h("span", { text: `Página ${d.pagina} de ${d.paginas}` }),
          h("button", { type: "button", class: "btn btn--sec", text: "Siguiente", disabled: d.pagina >= d.paginas, onclick: pagina(d.pagina + 1) }),
        )
      : null,
  );
}

// ---------- Conversación ----------
async function verConversacion(id) {
  const dialogo = h("dialog", { class: "dialogo", "aria-label": "Conversación" });
  const cerrar = () => dialogo.close();
  dialogo.addEventListener("close", () => dialogo.remove());
  dialogo.addEventListener("click", (e) => {
    if (e.target === dialogo) cerrar(); // clic fuera del contenido
  });
  dialogo.append(h("p", { class: "cargando", text: "Cargando conversación…" }));
  document.body.append(dialogo);
  dialogo.showModal();

  const r = await fetch(`/api/admin?accion=conversacion&id=${encodeURIComponent(id)}`);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    dialogo.replaceChildren(h("p", { text: d.error || "No se pudo cargar." }), h("button", { type: "button", class: "btn", text: "Cerrar", onclick: cerrar }));
    return;
  }
  const s = d.sesion;
  const [estado, clase] = ESTADOS[s.estado] ?? [s.estado, ""];
  const mensaje = (m) =>
    h("div", { class: `message ${m.rol === "user" ? "message--user" : "message--consultor"}` },
      m.rol === "user" ? null : h("span", { class: "message__avatar", "aria-hidden": "true", text: "IA" }),
      h("div", { class: "message__burbuja" },
        m.rol === "user" ? h("p", { class: "message__text", text: m.texto }) : h("div", { class: "message__text" }, textoEnriquecido(m.texto)),
        h("div", { class: "message__meta" }, h("time", { class: "message__time", text: `${fechaCorta(m.creado)} · ${hora(m.creado)}` })),
      ),
    );
  dialogo.replaceChildren(
    h("header", { class: "dialogo__cabecera" },
      h("div", {},
        h("p", { class: "kicker", text: fechaCorta(s.creado) }),
        h("h2", { text: s.empresa ? `${s.nombre} · ${s.empresa}` : s.nombre }),
        h("p", { class: "sutil" }, h("span", { class: `estado ${clase}`, text: estado }), ` ${s.email} · ${s.turnos} respuestas`),
      ),
      h("div", { class: "dialogo__acciones" },
        s.diagnostico_id ? h("a", { class: "btn btn--sec", href: `/diagnostico/${s.diagnostico_id}`, target: "_blank", rel: "noopener", text: "Ver informe" }) : null,
        h("button", { type: "button", class: "btn", text: "Cerrar", onclick: cerrar }),
      ),
    ),
    h("div", { class: "dialogo__mensajes" }, d.mensajes.length ? d.mensajes.map(mensaje) : h("p", { class: "sutil", text: "Sin mensajes." })),
  );
}
