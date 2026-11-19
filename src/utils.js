// =====================================================
// FUNCIONES PURAS DEL NAVEGADOR (sin document ni fetch, para poder probarlas)
// =====================================================

// Debe coincidir con lib/servicio.js (lo comprueba tests/utils.test.js)
export const TEXTO_CONSENTIMIENTO =
  "Autorizo a Studio-IA a tratar mis datos (nombre, correo, empresa y respuestas) para generar y enviarme este diagnóstico y contactarme sobre él, conforme a la Ley 1581 de 2012. Entiendo que mis respuestas se procesan con un servicio de IA de terceros y no compartiré información confidencial.";

export const MENSAJE_CIERRE = "Listo, entrégame el diagnóstico con lo que tienes.";
export const CLAVE_SESION = "studio-ia-diagnostico-sesion";

// Clase CSS y nombre según quién habla
export function getMessageMeta(rol) {
  const esPersona = rol === "user";
  return {
    roleClass: esPersona ? "message--user" : "message--consultor",
    author: esPersona ? "Tú" : "Consultor Studio-IA",
  };
}

// Hora corta, por ejemplo "3:45 p. m."
export function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" });
}

export function isValidMessage(text) {
  return typeof text === "string" && text.trim().length > 0;
}

export function formatoNumero(n, decimales = 0) {
  return Number(n).toLocaleString("es-CO", { maximumFractionDigits: decimales });
}

// Texto del consultor → bloques { tipo: "p" | "ol" | "ul", ... } con segmentos { texto, negrita }.
// Así el navegador lo pinta con textContent (nunca innerHTML).
export function parsearTexto(texto) {
  const bloques = [];
  for (const cruda of String(texto).split("\n")) {
    const linea = cruda.trim();
    const ultimo = bloques.at(-1);
    if (!linea) {
      if (ultimo?.tipo === "p" && ultimo.lineas.length) bloques.push({ tipo: "p", lineas: [] });
      continue;
    }
    const numerada = linea.match(/^\d+[.)]\s+(.*)$/);
    const vineta = linea.match(/^[-*•]\s+(.*)$/);
    if (numerada || vineta) {
      const tipo = numerada ? "ol" : "ul";
      const item = (numerada ?? vineta)[1];
      if (ultimo?.tipo === tipo) ultimo.items.push(segmentos(item));
      else bloques.push({ tipo, items: [segmentos(item)] });
      continue;
    }
    if (ultimo?.tipo === "p") ultimo.lineas.push(linea);
    else bloques.push({ tipo: "p", lineas: [linea] });
  }
  return bloques
    .filter((b) => b.tipo !== "p" || b.lineas.length)
    .map((b) => (b.tipo === "p" ? { tipo: "p", segmentos: segmentos(b.lineas.join(" ")) } : b));
}

export function segmentos(texto) {
  return texto
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((parte) =>
      parte.startsWith("**") && parte.endsWith("**") ? { texto: parte.slice(2, -2), negrita: true } : { texto: parte, negrita: false },
    );
}

// Texto plano (para el botón de copiar)
export function textoPlano(texto) {
  return String(texto).replace(/\*\*([^*]+)\*\*/g, "$1");
}
