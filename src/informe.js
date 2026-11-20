import { h } from "./dom.js";
import { formatoNumero } from "./utils.js";

// =====================================================
// INFORME DEL DIAGNÓSTICO (/diagnostico/:id)
// Lenguaje claro y sin gráficas: qué actividades del día a día se pueden
// automatizar con IA, con qué herramientas y por dónde empezar.
// Todo se pinta con textContent a partir del JSON de /api/diagnostico.
// =====================================================

const SOLUCION = {
  mejora_proceso: "Ordenar el proceso primero",
  reglas: "Automatización por reglas",
  ia_generativa: "IA generativa (redacta y resume)",
  asistente_conocimiento: "Asistente con tus documentos",
  analitica_reportes: "Análisis y reportes automáticos",
  predictiva: "IA que predice y alerta",
  agente: "Agente de IA",
  recolectar_datos: "Reunir los datos primero",
};
const ESFUERZO = { bajo: "1-3 días", medio: "1-3 semanas", alto: "1-3 meses" };

// El cuadrante técnico se traduce a algo que cualquiera entienda.
const POTENCIAL = {
  "Ganancia rápida": { nivel: "Alto", clase: "alto", nota: "Empieza por aquí" },
  "Proyecto estratégico": { nivel: "Medio", clase: "medio", nota: "Vale la pena, pero toma más trabajo" },
  "Mejora menor": { nivel: "Medio", clase: "medio", nota: "Es fácil, pero ahorra poco" },
  "No por ahora": { nivel: "Bajo", clase: "bajo", nota: "Todavía no conviene" },
};
const ORDEN = ["Ganancia rápida", "Proyecto estratégico", "Mejora menor", "No por ahora"];

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

const chips = (lista) => h("ul", { class: "chips" }, lista.map((x) => h("li", { text: x })));

function construir({ persona, datos: d, calculos, creado }) {
  const { tareas, oportunidades, totales, factor } = calculos;
  const pct = Math.round(factor * 100);
  const dinero = (n) => (n === null || n === undefined ? "—" : `${formatoNumero(n)} ${d.moneda}`);
  const horas = (n) => `${formatoNumero(n, 1)} h`;
  const fecha = new Date(creado).toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" });
  const automatizables = tareas.filter((t) => t.cuadrante !== "No por ahora");
  const rapidas = tareas.filter((t) => t.cuadrante === "Ganancia rápida").length;
  const oportunidadDe = new Map(oportunidades.map((o) => [o.tarea_id, o]));
  const frag = document.createDocumentFragment();

  // ---------- Portada ----------
  frag.append(
    h("header", { class: "portadilla" },
      h("div", {},
        h("img", { src: "/assets/logo-claro.png", alt: "Studio-IA", class: "portadilla__logo", width: 170, height: 40 }),
        h("p", { class: "kicker kicker--claro", text: "Tu diagnóstico de automatización con IA" }),
        h("h1", { text: persona.empresa ? `${persona.nombre} · ${persona.empresa}` : persona.nombre }),
        h("p", { text: `${d.contexto.cargo} · ${d.contexto.industria} · ${fecha}` }),
      ),
      h("div", { class: "portadilla__lado" },
        h("button", { type: "button", class: "btn no-imprimir", text: "Descargar PDF", onclick: () => window.print() }),
      ),
    ),
  );

  // ---------- 1. Resumen ----------
  const cifra = (valor, texto, destacada) => h("div", { class: `cifra${destacada ? " cifra--oro" : ""}` }, h("strong", { text: valor }), h("span", { text: texto }));
  frag.append(
    seccion("Lo más importante", "Tu resumen",
      h("p", { class: "lead", text: d.resumen }),
      h("div", { class: "cifras" },
        cifra(`${automatizables.length} de ${tareas.length}`, "actividades de tu día a día se pueden automatizar"),
        cifra(horas(totales.horas_mes_esperadas), "podrías liberar cada mes", true),
        d.costo_hora
          ? cifra(dinero(totales.valor_anual_esperado), "de ahorro estimado al año")
          : cifra(String(rapidas), rapidas === 1 ? "actividad para empezar ya" : "actividades para empezar ya"),
      ),
    ),
  );

  // ---------- 2. Tabla de actividades ----------
  const filas = [...tareas].sort(
    (a, b) => ORDEN.indexOf(a.cuadrante) - ORDEN.indexOf(b.cuadrante) || b.horas_mes_liberadas - a.horas_mes_liberadas,
  );
  const fila = (t) => {
    const p = POTENCIAL[t.cuadrante];
    const op = oportunidadDe.get(t.id);
    const herramientas = op?.solucion.herramientas ?? [];
    return h("tr", {},
      h("td", { "data-label": "Actividad", class: "col-actividad" }, h("strong", { text: t.nombre }), h("span", { class: "sutil", text: t.descripcion })),
      h("td", { "data-label": "Tiempo hoy", text: `${horas(t.horas_mes_actual)} al mes` }),
      h("td", { "data-label": "¿Se puede automatizar?" }, h("span", { class: `nivel nivel--${p.clase}`, text: p.nivel }), h("span", { class: "sutil", text: p.nota })),
      h("td", { "data-label": "IA o herramientas que necesita" },
        h("strong", { text: SOLUCION[t.solucion] }),
        herramientas.length ? chips(herramientas) : null,
      ),
      h("td", { "data-label": "Podrías ahorrar", text: t.cuadrante === "No por ahora" ? "—" : `${horas(t.horas_mes_liberadas * factor)} al mes` }),
    );
  };
  const sec2 = seccion("Tus actividades", "Qué se puede automatizar de tu trabajo",
    h("p", { text: "Revisamos cada actividad que nos contaste. Aquí ves cuáles se pueden automatizar con IA, qué tanto vale la pena y qué herramientas harían falta." }),
    h("div", { class: "tabla-scroll" },
      h("table", { class: "tabla-act" },
        h("thead", {}, h("tr", {}, ["Actividad", "Tiempo hoy", "¿Se puede automatizar?", "IA o herramientas que necesita", "Podrías ahorrar"].map((c) => h("th", { scope: "col", text: c })))),
        h("tbody", {}, filas.map(fila)),
      ),
    ),
    h("p", { class: "sutil", text: `El ahorro es una estimación prudente: contamos el ${pct} % del tiempo que se podría liberar en teoría.` }),
  );
  frag.append(sec2);

  // ---------- 3. Por dónde empezar ----------
  frag.append(
    seccion("Por dónde empezar", "Tus mejores oportunidades",
      h("p", { text: "Estas son las actividades en las que la IA te ayudaría más, en orden de prioridad." }),
      oportunidades.map((o, i) => ficha(o, i + 1, d, factor, horas, dinero)),
    ),
  );

  // ---------- 4. Hoja de ruta ----------
  const etapa = (t, sub, items) => h("div", { class: "etapa" }, h("strong", { text: t }), h("span", { text: sub }), h("ul", {}, items.map((x) => h("li", { text: x }))));
  const sec4 = seccion("Tu plan", "Qué hacer en los próximos 90 días",
    h("div", { class: "ruta" },
      etapa("Primeros 30 días", "Ordenar y empezar con lo fácil", d.hoja_ruta.dias_30),
      etapa("Días 31 a 60", "Probar con un piloto", d.hoja_ruta.dias_60),
      etapa("Días 61 a 90", "Extender lo que funcionó", d.hoja_ruta.dias_90),
    ),
  );
  sec4.classList.add("salto");
  frag.append(sec4);

  // ---------- 5. No automatizar ----------
  if (d.no_automatizar_todavia.length) {
    frag.append(
      seccion("Con cuidado", "Lo que todavía no conviene automatizar",
        h("ul", { class: "lista" }, d.no_automatizar_todavia.map((n) => h("li", {}, h("strong", { text: `${n.tarea}: ` }), n.razon))),
      ),
    );
  }

  // ---------- 6. Notas ----------
  const supuestos = oportunidades.flatMap((o) => o.supuestos);
  frag.append(
    seccion("Antes de decidir", "Lo que conviene confirmar",
      d.datos_faltantes.length || supuestos.length
        ? h("ul", { class: "lista" }, supuestos.map((x) => h("li", { text: x })), d.datos_faltantes.map((x) => h("li", { text: x })))
        : null,
      !d.costo_hora ? h("p", { text: "No nos diste el costo de tu hora de trabajo. Si lo agregas, podemos calcular el ahorro en dinero." }) : null,
      h("p", { class: "sutil", text: "Este diagnóstico lo generó una IA a partir de tu entrevista. Las cifras son estimaciones para priorizar, no una promesa de resultados: confírmalas con una medición antes de invertir." }),
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

function ficha(o, n, d, factor, horas, dinero) {
  const t = o.tarea;
  const p = t ? POTENCIAL[t.cuadrante] : null;
  const dato = (k, v, nota) => h("div", {}, h("span", { text: k }), h("strong", { text: v }), nota ? h("em", { text: nota }) : null);
  return h("article", { class: "ficha" },
    h("header", {},
      h("span", { class: "ficha__num", text: String(n) }),
      h("h3", { text: o.nombre }),
      p ? h("span", { class: `nivel nivel--${p.clase}`, text: `Potencial ${p.nivel.toLowerCase()}` }) : null,
    ),
    h("div", { class: "ficha__grid" },
      h("div", {},
        h("h4", { text: "Cómo lo haces hoy" }), h("p", { text: o.as_is }),
        h("h4", { text: "Qué te quita tiempo" }), h("p", { text: o.dolor }),
      ),
      h("div", { class: "ficha__solucion" },
        h("h4", { text: `Qué cambia con IA · ${SOLUCION[o.solucion.tipo]}` }),
        h("p", { text: o.solucion.descripcion }),
        h("h4", { text: "Herramientas que necesitas" }),
        chips(o.solucion.herramientas),
        h("p", { class: "sutil" }, h("strong", { text: "Otra opción: " }), o.solucion.alternativa),
      ),
    ),
    h("h4", { text: "Cómo quedaría" }),
    h("ol", { class: "pasos" }, o.to_be.map((x) => h("li", { text: x }))),
    h("div", { class: "mini-cifras" },
      dato("Ahorro al mes", t ? horas(t.horas_mes_liberadas * factor) : "—", "estimación prudente"),
      dato("Ahorro al año", d.costo_hora ? dinero(t?.valor_anual ?? null) : "—", d.costo_hora ? "estimado" : "falta el costo de tu hora"),
      dato("Tiempo para implementarlo", ESFUERZO[o.esfuerzo], "aproximado"),
      dato("Cómo sabrás que funciona", o.kpi.nombre, `${o.kpi.linea_base} → ${o.kpi.meta}`),
    ),
    h("p", {}, h("strong", { text: "Revisa siempre: " }), o.revision_humana),
    h("p", {}, h("strong", { text: "Ten en cuenta: " }), o.riesgos.join(" ")),
    h("p", { class: "primer-paso" }, h("strong", { text: "Tu primer paso esta semana: " }), o.primer_paso),
  );
}
