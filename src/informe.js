import { h, s } from "./dom.js";
import { formatoNumero } from "./utils.js";

// =====================================================
// INFORME DEL DIAGNÓSTICO (/diagnostico/:id)
// Todo se pinta con textContent a partir del JSON de /api/diagnostico.
// =====================================================

const SOLUCION = {
  mejora_proceso: "Mejora de proceso",
  reglas: "Automatización por reglas",
  ia_generativa: "Flujo con IA generativa",
  asistente_conocimiento: "Asistente con conocimiento",
  analitica_reportes: "Análisis y reportes",
  predictiva: "IA predictiva y alertas",
  agente: "Agente",
  recolectar_datos: "Recolectar datos primero",
};
const FILTRO = [
  ["mejorar_proceso", "¿Mejorar el proceso antes de automatizar?"],
  ["reglas", "¿Basta con automatización por reglas?"],
  ["ia_generativa", "¿Se necesita IA generativa?"],
  ["predictivo", "¿Se justifica un modelo predictivo?"],
  ["agente", "¿Se necesita un agente?"],
  ["datos_suficientes", "¿La información permite construir la solución?"],
  ["revision_humana", "¿Se mantiene revisión humana?"],
];
const RESPUESTA = { si: "Sí", no: "No", no_aplica: "No aplica" };
const EVIDENCIA = { hecho: "Dato dado", estimacion: "Estimación", supuesto: "Supuesto" };
const ESFUERZO = { bajo: "1-3 días", medio: "1-3 semanas", alto: "1-3 meses" };

export function informeView() {
  return `<div class="informe" id="informe"><p class="cargando">Cargando tu diagnóstico…</p></div>`;
}

export async function initInforme(id) {
  const cont = document.getElementById("informe");
  try {
    const r = await fetch(`/api/diagnostico?id=${id}`);
    if (!r.ok) throw new Error(r.status === 404 ? "No encontramos este diagnóstico." : "No pudimos cargar el diagnóstico.");
    cont.replaceChildren(construir(await r.json()));
  } catch (e) {
    cont.replaceChildren(
      h("section", { class: "seccion" },
        h("h1", { text: e.message }),
        h("p", {}, "Revisa el enlace o ", h("a", { href: "/inicio", "data-link": true, text: "empieza un diagnóstico nuevo" }), "."),
      ),
    );
  }
}

function seccion(kicker, titulo, ...contenido) {
  return h("section", { class: "seccion" }, h("p", { class: "kicker", text: kicker }), titulo ? h("h2", { text: titulo }) : null, ...contenido);
}

function etiqueta(texto, oro = false) {
  return h("span", { class: `etiqueta${oro ? " etiqueta--oro" : ""}`, text: texto });
}

function construir({ persona, datos: d, calculos, creado }) {
  const { tareas, oportunidades, totales, factor } = calculos;
  const pct = Math.round(factor * 100);
  const dinero = (n) => (n === null || n === undefined ? "—" : `${formatoNumero(n)} ${d.moneda}`);
  const rapidas = tareas.filter((t) => t.cuadrante === "Ganancia rápida").length;
  const fecha = new Date(creado).toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" });
  const supuestos = oportunidades.flatMap((o) => o.supuestos.map((x) => `${o.id}: ${x}`));
  const frag = document.createDocumentFragment();

  // ---------- Portada ----------
  frag.append(
    h("header", { class: "portadilla" },
      h("div", {},
        h("img", { src: "/assets/logo-claro.png", alt: "Studio-IA", class: "portadilla__logo", width: 170, height: 40 }),
        h("p", { class: "kicker kicker--claro", text: "Diagnóstico de procesos automatizables" }),
        h("h1", { text: persona.empresa ? `${persona.nombre} · ${persona.empresa}` : persona.nombre }),
        h("p", { text: `${d.contexto.cargo} · ${d.contexto.area} · ${d.contexto.industria} · ${fecha}` }),
      ),
      h("div", { class: "portadilla__lado" },
        h("img", { src: "/assets/avatar-consultor.svg", alt: "", class: "portadilla__avatar", width: 120, height: 120 }),
        h("button", { type: "button", class: "btn no-imprimir", text: "Descargar PDF", onclick: () => window.print() }),
      ),
    ),
  );

  // ---------- 1. Resumen ----------
  const cifra = (valor, texto, oro) => h("div", { class: `cifra${oro ? " cifra--oro" : ""}` }, h("strong", { text: valor }), h("span", { text: texto }));
  frag.append(
    seccion("1 · Resumen ejecutivo", "Lo más importante",
      h("p", { class: "lead", text: d.resumen }),
      h("div", { class: "cifras" },
        cifra(`${formatoNumero(totales.horas_mes_actual, 1)} h`, "al mes toman hoy las tareas analizadas"),
        cifra(`${formatoNumero(totales.horas_mes_esperadas, 1)} h`, "al mes se podrían liberar (estimación conservadora)", true),
        cifra(d.costo_hora ? dinero(totales.valor_anual_esperado) : "Sin costo hora", d.costo_hora ? "de ahorro esperado al año" : "el ahorro se expresa en horas"),
        cifra(String(rapidas), rapidas === 1 ? "ganancia rápida (alto impacto y viabilidad)" : "ganancias rápidas (alto impacto y viabilidad)"),
      ),
      h("h3", { text: "Primeras acciones" }),
      h("ol", { class: "acciones-lista" }, oportunidades.slice(0, 3).map((o) => h("li", {}, h("strong", { text: `${o.nombre}. ` }), o.primer_paso))),
    ),
  );

  // ---------- 2. Contexto ----------
  const dato = (t, v) => h("div", {}, h("dt", { text: t }), h("dd", { text: v }));
  frag.append(
    seccion("2 · Contexto", "Punto de partida",
      h("dl", { class: "contexto" },
        dato("Cargo y área", `${d.contexto.cargo} · ${d.contexto.area}`),
        dato("Empresa", `${d.contexto.industria} · ${d.contexto.tamano_empresa} · ${d.contexto.modelo_negocio}`),
        dato("Herramientas", d.contexto.herramientas.join(", ") || "—"),
        dato("Restricciones", d.contexto.restricciones.join("; ") || "Ninguna mencionada"),
      ),
    ),
  );

  // ---------- 3. Matriz ----------
  const sec3 = seccion("3 · Priorización", "Dónde empezar",
    h("p", { text: "Cada punto es una tarea. El impacto combina el volumen de trabajo y el costo de los errores; la viabilidad combina repetitividad, entrada digital, reglas claras, datos disponibles y riesgo." }),
    matriz(tareas),
  );
  sec3.classList.add("salto");
  frag.append(sec3);

  // ---------- 4. Inventario ----------
  const fila = (t) =>
    h("tr", {},
      h("td", { text: t.id }),
      h("td", {}, h("strong", { text: t.nombre }), h("br"), h("span", { class: "sutil", text: `${t.descripcion} · ${EVIDENCIA[t.origen_cifras]}` })),
      h("td", { text: formatoNumero(t.veces_por_mes) }),
      h("td", { text: formatoNumero(t.minutos_por_vez) }),
      h("td", { text: String(t.personas) }),
      h("td", { text: formatoNumero(t.horas_mes_actual, 1) }),
      h("td", { text: formatoNumero(t.horas_mes_liberadas, 1) }),
      h("td", { text: `${formatoNumero(t.impacto, 1)} / ${formatoNumero(t.viabilidad, 1)}` }),
      h("td", {}, etiqueta(t.cuadrante, t.cuadrante === "Ganancia rápida"), h("br"), h("span", { class: "sutil", text: SOLUCION[t.solucion] })),
    );
  frag.append(
    seccion("4 · Inventario de tareas", "Todas las tareas analizadas",
      h("div", { class: "tabla-scroll" },
        h("table", {},
          h("thead", {}, h("tr", {}, ["Id", "Tarea", "Veces/mes", "Min/vez", "Personas", "Horas/mes hoy", "Horas/mes liberables*", "Impacto / viabilidad", "Cuadrante y solución"].map((c) => h("th", { scope: "col", text: c })))),
          h("tbody", {}, tareas.map(fila)),
        ),
      ),
      h("p", { class: "sutil", text: `* Teóricas, antes de aplicar el factor de realización del ${pct} %.` }),
    ),
  );

  // ---------- 5. Fichas ----------
  frag.append(seccion("5 · Oportunidades priorizadas", "Fichas de oportunidad", oportunidades.map((o) => ficha(o, d, factor, pct, dinero))));

  // ---------- 6. Hoja de ruta ----------
  const etapa = (t, sub, items) => h("div", { class: "etapa" }, h("strong", { text: t }), h("span", { text: sub }), h("ul", {}, items.map((x) => h("li", { text: x }))));
  const sec6 = seccion("6 · Hoja de ruta", "Plan 30-60-90 días",
    h("div", { class: "ruta" },
      etapa("30 días", "Mejorar procesos y ganancias rápidas", d.hoja_ruta.dias_30),
      etapa("60 días", "Piloto medido", d.hoja_ruta.dias_60),
      etapa("90 días", "Extender lo que funcionó", d.hoja_ruta.dias_90),
    ),
  );
  sec6.classList.add("salto");
  frag.append(sec6);

  // ---------- 7. No automatizar ----------
  if (d.no_automatizar_todavia.length) {
    frag.append(seccion("7 · Lo que no conviene automatizar todavía", null, h("ul", {}, d.no_automatizar_todavia.map((n) => h("li", {}, h("strong", { text: `${n.tarea}: ` }), n.razon)))));
  }

  // ---------- 8. Supuestos ----------
  frag.append(
    seccion("8 · Supuestos y datos faltantes", null,
      h("ul", {},
        h("li", { text: `Las horas liberables usan los minutos estimados con la solución; el ahorro esperado aplica un factor de realización del ${pct} %.` }),
        h("li", { text: d.costo_hora ? `Costo de la hora usado: ${dinero(d.costo_hora)}, dato dado por la persona entrevistada.` : "No se dio el costo de la hora: agrégalo para estimar el ahorro en dinero." }),
        supuestos.map((x) => h("li", { text: x })),
        d.datos_faltantes.map((x) => h("li", { text: `Por confirmar: ${x}` })),
      ),
      h("p", { class: "sutil", text: "Diagnóstico generado con IA a partir de una entrevista. Las cifras son estimaciones para priorizar, no una promesa de resultados: valídalas con una medición antes de invertir." }),
    ),
  );

  // ---------- Cierre ----------
  frag.append(
    h("section", { class: "seccion cta" },
      h("img", { src: "/assets/logo-oscuro.png", alt: "Studio-IA", class: "cta__logo", width: 170, height: 40 }),
      h("div", {}, h("h3", { text: "¿Quieres implementarlo o formar a tu equipo?" }), h("p", { text: "Studio-IA acompaña la implementación de estas oportunidades y diseña formación en IA aplicada para tu área." })),
    ),
  );
  return frag;
}

function ficha(o, d, factor, pct, dinero) {
  const t = o.tarea;
  const mini = (k, v, nota) => h("div", {}, h("span", { text: k }), h("strong", { text: v }), h("em", { text: nota }));
  return h("article", { class: "ficha" },
    h("header", {}, etiqueta(o.id), h("h3", { text: o.nombre }), t ? etiqueta(t.cuadrante, t.cuadrante === "Ganancia rápida") : null),
    h("div", { class: "ficha__grid" },
      h("div", {},
        h("h4", { text: "Situación actual" }), h("p", { text: o.as_is }),
        h("h4", { text: "Dolor" }), h("p", {}, o.dolor, " ", h("span", { class: "sutil", text: `(${EVIDENCIA[o.evidencia]})` })),
        h("h4", { text: "Datos disponibles" }), h("p", { text: o.datos_disponibles }),
      ),
      h("div", { class: "ficha__solucion" },
        h("h4", { text: `Solución recomendada · ${SOLUCION[o.solucion.tipo]}` }),
        h("p", { text: o.solucion.descripcion }),
        h("p", {}, h("strong", { text: "Herramientas: " }), o.solucion.herramientas.join(", ")),
        h("p", {}, h("strong", { text: "Alternativa: " }), o.solucion.alternativa),
        h("p", {}, h("strong", { text: "Revisión humana: " }), o.revision_humana),
      ),
    ),
    h("h4", { text: "Cómo quedaría (TO-BE)" }),
    h("ol", { class: "pasos" }, o.to_be.map((p) => h("li", { text: p }))),
    h("details", { class: "filtro", open: true },
      h("summary", { text: "Filtro de decisión" }),
      h("table", {}, h("tbody", {}, FILTRO.map(([k, pregunta]) => h("tr", {}, h("td", { text: pregunta }), h("td", {}, h("strong", { text: RESPUESTA[o.filtro[k].respuesta] })), h("td", { text: o.filtro[k].justificacion }))))),
    ),
    h("div", { class: "mini-cifras" },
      mini("KPI", o.kpi.nombre, `${o.kpi.linea_base} → ${o.kpi.meta} · ${o.kpi.frecuencia}`),
      mini("Esfuerzo", o.esfuerzo[0].toUpperCase() + o.esfuerzo.slice(1), ESFUERZO[o.esfuerzo]),
      mini("Horas/mes esperadas", t ? formatoNumero(t.horas_mes_liberadas * factor, 1) : "—", `con factor ${pct} %`),
      mini("Valor anual", dinero(t?.valor_anual ?? null), d.costo_hora ? "estimado" : "falta costo hora"),
    ),
    h("p", {}, h("strong", { text: "Riesgos: " }), o.riesgos.join(" ")),
    h("p", { class: "primer-paso" }, h("strong", { text: "Primer paso esta semana: " }), o.primer_paso),
  );
}

// Matriz 2x2: viabilidad (x) × impacto (y), escala 1-5, corte en 3,5
function matriz(tareas) {
  const W = 640, H = 440, m = { l: 64, r: 20, t: 20, b: 56 };
  const x = (v) => m.l + ((v - 1) / 4) * (W - m.l - m.r);
  const y = (v) => H - m.b - ((v - 1) / 4) * (H - m.t - m.b);
  const cx = x(3.5), cy = y(3.5);
  const zonas = [
    [cx, m.t, W - m.r, cy, "zona-oro", "Ganancia rápida"],
    [m.l, m.t, cx, cy, "zona-azul", "Proyecto estratégico"],
    [cx, cy, W - m.r, H - m.b, "zona-gris", "Mejora menor"],
    [m.l, cy, cx, H - m.b, "zona-fondo", "No por ahora"],
  ];
  const vistos = new Map();
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "matriz", role: "img", "aria-label": "Matriz de impacto y viabilidad de las tareas" },
    zonas.map(([x0, y0, x1, y1, cls, txt]) => s("g", {}, s("rect", { x: x0, y: y0, width: x1 - x0, height: y1 - y0, class: cls }), s("text", { x: x0 + 10, y: y0 + 22, class: "matriz__zona" }, txt))),
    s("rect", { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, class: "matriz__marco" }),
    [1, 2, 3, 4, 5].map((v) => s("g", { class: "matriz__eje" }, s("text", { x: x(v), y: H - m.b + 18, "text-anchor": "middle" }, String(v)), s("text", { x: m.l - 10, y: y(v) + 4, "text-anchor": "end" }, String(v)))),
    s("text", { x: (m.l + W - m.r) / 2, y: H - 12, "text-anchor": "middle", class: "matriz__titulo" }, "Viabilidad →"),
    s("text", { x: 18, y: (m.t + H - m.b) / 2, "text-anchor": "middle", class: "matriz__titulo", transform: `rotate(-90 18 ${(m.t + H - m.b) / 2})` }, "Impacto →"),
    tareas.map((t) => {
      const k = `${t.viabilidad}-${t.impacto}`;
      const n = vistos.get(k) ?? 0;
      vistos.set(k, n + 1);
      const px = x(t.viabilidad) + n * 22, py = y(t.impacto) - n * 6;
      const oro = t.cuadrante === "Ganancia rápida";
      return s("g", { class: oro ? "punto punto--oro" : "punto" },
        s("title", {}, `${t.id} · ${t.nombre}`),
        s("circle", { cx: px, cy: py, r: 15 }),
        s("text", { x: px, y: py + 4, "text-anchor": "middle" }, t.id),
      );
    }),
  );
  return svg;
}
