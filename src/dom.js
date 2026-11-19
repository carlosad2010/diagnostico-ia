// =====================================================
// AYUDANTE PARA CREAR ELEMENTOS DE FORMA SEGURA
// Todo el texto entra con textContent: nada de lo que escribe la persona
// o devuelve la IA se interpreta como HTML (protección contra XSS).
// =====================================================
import { parsearTexto } from "./utils.js";

export function h(tag, props = {}, ...hijos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const hijo of hijos.flat()) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    el.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
  return el;
}

// SVG (necesita su propio espacio de nombres)
export function s(tag, props = {}, ...hijos) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(props)) if (v !== undefined) el.setAttribute(k, v);
  for (const hijo of hijos.flat()) if (hijo) el.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  return el;
}

function pintarSegmentos(segs) {
  return segs.map((sg) => (sg.negrita ? h("strong", { text: sg.texto }) : document.createTextNode(sg.texto)));
}

// Texto del consultor con párrafos, listas y negritas
export function textoEnriquecido(texto) {
  const frag = document.createDocumentFragment();
  for (const b of parsearTexto(texto)) {
    if (b.tipo === "p") frag.append(h("p", {}, pintarSegmentos(b.segmentos)));
    else frag.append(h(b.tipo, {}, b.items.map((item) => h("li", {}, pintarSegmentos(item)))));
  }
  return frag;
}
