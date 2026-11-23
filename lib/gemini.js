import { PROMPT_ANALISIS, PROMPT_ENTREVISTA, MARCA_CIERRE, MARCA_FUERA_DE_TEMA, estadoSesion } from "./prompts.js";
import { DiagnosticoSchema, erroresLegibles, esquemaGemini } from "./esquema.js";
import { validarCoherencia } from "./calculos.js";
import { DIAGNOSTICO_EJEMPLO } from "./ejemplo.js";

// =====================================================
// CONFIGURACIÓN: la decide el servidor, nunca el cliente
// =====================================================
const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
export const MODELO_CHAT = process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite";
// El análisis final es la parte más exigente: puedes usar un modelo más capaz.
export const MODELO_ANALISIS = process.env.GEMINI_MODEL_ANALISIS ?? MODELO_CHAT;
// Nivel de razonamiento del análisis (low, medium o high): más alto = menos errores, pero más lento.
export const RAZONAMIENTO_ANALISIS = process.env.GEMINI_RAZONAMIENTO_ANALISIS ?? "low";
// Modelos de respaldo (capa gratuita) por si el principal está saturado (503) o sin cuota (429).
// Se prueban en orden. Puedes cambiarlos con GEMINI_MODELOS_RESPALDO (separados por comas).
const RESPALDO = (process.env.GEMINI_MODELOS_RESPALDO ?? "gemini-3.1-flash-lite,gemini-3-flash-preview,gemini-3.5-flash")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
// Errores que justifican probar otro modelo (un 400 o 403 no se arregla cambiando de modelo)
const CAMBIAR_MODELO = new Set([404, 429, 500, 502, 503, 504]);
const cadena = (principal) => [principal, ...RESPALDO.filter((m) => m !== principal)];
const FALLBACK ="Perdí el hilo un momento. ¿Me lo repites con otras palabras?";

export class ErrorGemini extends Error {
  constructor(status, detalle) {
    super(`Gemini respondió ${status}`);
    this.status = status;
    this.detalle = detalle;
  }
}

// =====================================================
// FUNCIONES PURAS (se prueban sin red)
// =====================================================

// { rol, texto } → { role, parts }, el formato de Gemini. Debe empezar con "user"
// y los mensajes seguidos del mismo rol se unen en uno.
export function toGeminiContents(mensajes) {
  const contents = [];
  for (const m of mensajes) {
    const role = m.rol === "user" ? "user" : "model";
    const ultimo = contents.at(-1);
    if (ultimo?.role === role) ultimo.parts[0].text += `\n\n${m.texto}`;
    else contents.push({ role, parts: [{ text: String(m.texto) }] });
  }
  const primero = contents.findIndex((c) => c.role === "user");
  return primero === -1 ? [] : contents.slice(primero);
}

// Lee el texto de forma segura e ignora el razonamiento interno (thought)
export function getReplyText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts
    .filter((p) => !p?.thought)
    .map((p) => p?.text)
    .filter((t) => typeof t === "string")
    .join("")
    .trim();
}

// Separa las marcas del texto visible. Tolera espacios o guiones distintos
// ("[[ FUERA DE TEMA ]]"), porque el modelo a veces no copia la marca exacta.
const RE_CIERRE = /\[\[\s*DIAGN[OÓ]STICO\s*\]\]/i;
const RE_FUERA = /\[\[\s*FUERA[\s_-]*DE[\s_-]*TEMA\s*\]\]/i;
const quitar = (texto, re) => texto.replace(new RegExp(re.source, "gi"), "");
export function separarCierre(texto) {
  const fueraDeTema = RE_FUERA.test(texto);
  const cerrar = !fueraDeTema && RE_CIERRE.test(texto); // un mensaje fuera de tema nunca cierra con diagnóstico
  return { texto: quitar(quitar(texto, RE_CIERRE), RE_FUERA).trim(), cerrar, fueraDeTema };
}

// Extrae el JSON aunque venga dentro de ```json … ``` o con texto alrededor
export function extraerJson(texto) {
  const limpio = texto.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(limpio);
  } catch {
    const i = limpio.indexOf("{");
    const j = limpio.lastIndexOf("}");
    if (i === -1 || j <= i) throw new Error("La respuesta no contiene JSON");
    return JSON.parse(limpio.slice(i, j + 1));
  }
}

export function transcripcion(mensajes) {
  return mensajes
    .map((m) => `${m.rol === "user" ? "PERSONA" : "CONSULTOR"}: ${m.texto}`)
    .join("\n\n");
}

// =====================================================
// LLAMADA A GEMINI (la key va en un header, nunca en la URL)
// =====================================================
async function generarCon(modelo, body) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ErrorGemini(500, "Falta GEMINI_API_KEY");
  const response = await fetch(`${BASE}/${modelo}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ErrorGemini(response.status, data?.error?.message);
  return data;
}

// Prueba el modelo principal y, si está ocupado o sin cuota, los de respaldo en orden.
async function generar(principal, body) {
  let ultimo;
  for (const modelo of cadena(principal)) {
    try {
      return await generarCon(modelo, body);
    } catch (e) {
      if (!(e instanceof ErrorGemini) || !CAMBIAR_MODELO.has(e.status)) throw e;
      console.warn(`[gemini] ${modelo} respondió ${e.status}; pruebo el siguiente modelo`);
      ultimo = e;
    }
  }
  throw ultimo;
}

const SEGURIDAD = [
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
];

/**
 * Un turno de la entrevista. `avisos` = mensajes fuera de tema ya advertidos en la sesión.
 * Devuelve { texto, cerrar, fueraDeTema }.
 */
export async function conversar(historial, { avisos = 0 } = {}) {
  if (process.env.MOCK_AI === "1") return simularChat(historial);
  const data = await generar(MODELO_CHAT, {
    systemInstruction: { parts: [{ text: `${PROMPT_ENTREVISTA}\n\n${estadoSesion(avisos)}` }] },
    contents: toGeminiContents(historial),
    generationConfig: {
      temperature: 0.6,
      maxOutputTokens: 2048,
      thinkingConfig: { thinkingLevel: "low" },
    },
    safetySettings: SEGURIDAD,
  });
  return separarCierre(getReplyText(data) || FALLBACK);
}

// Formas de pedir JSON con esquema, de la más nueva a la más compatible.
// Si la API rechaza una (400), se intenta la siguiente.
const FORMATOS = [
  (schema) => ({ responseFormat: { text: { mimeType: "application/json", schema } } }),
  (schema) => ({ responseMimeType: "application/json", responseJsonSchema: schema }),
  () => ({ responseMimeType: "application/json" }), // sin esquema: lo describe el prompt
];

// Recuerda el primer formato que la API acepta: los rechazados (400) no se vuelven a pedir en esta instancia.
let formatoInicial = 0;
export const reiniciarFormatoAnalisis = () => (formatoInicial = 0); // solo para las pruebas
const MAX_CORRECCIONES = 3;
const MAX_REINTENTOS = 2; // ante 503/429 (Gemini saturado), con espera creciente
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** Genera el diagnóstico estructurado a partir de la entrevista. Devuelve el objeto validado. */
export async function analizar(mensajes) {
  if (process.env.MOCK_AI === "1") return structuredClone(DIAGNOSTICO_EJEMPLO);
  const schema = esquemaGemini();
  const pedido = `Transcripción de la entrevista de diagnóstico:\n\n${transcripcion(mensajes)}\n\nDevuelve solo el JSON del diagnóstico.`;
  let formato = formatoInicial;
  let correccion = "";
  let correcciones = 0;
  let reintentos = 0;

  while (correcciones <= MAX_CORRECCIONES) {
    const extra = formato === 2 ? `\n\nEl JSON debe cumplir este JSON Schema:\n${JSON.stringify(schema)}` : "";
    let data;
    try {
      data = await generar(MODELO_ANALISIS, {
        systemInstruction: { parts: [{ text: PROMPT_ANALISIS }] },
        contents: [{ role: "user", parts: [{ text: pedido + extra + correccion }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 16384,
          thinkingConfig: { thinkingLevel: RAZONAMIENTO_ANALISIS },
          ...FORMATOS[formato](schema),
        },
      });
    } catch (e) {
      // 400: este formato no es aceptado por el modelo → probar el siguiente
      if (e instanceof ErrorGemini && e.status === 400 && formato < FORMATOS.length - 1) {
        console.warn(`[gemini] formato ${formato} rechazado: ${e.detalle}`);
        formato++;
        formatoInicial = formato;
        continue;
      }
      // Saturación o cuota: espera y reintenta antes de rendirse
      if (e instanceof ErrorGemini && [429, 503].includes(e.status) && reintentos < MAX_REINTENTOS) {
        reintentos++;
        console.warn(`[gemini] análisis: ${e.status}, reintento ${reintentos}`);
        await espera(Number(process.env.GEMINI_ESPERA_REINTENTO_MS ?? 4000) * reintentos);
        continue;
      }
      throw e;
    }

    correcciones++;
    let objeto;
    try {
      objeto = extraerJson(getReplyText(data));
    } catch {
      correccion = "\n\nTu respuesta anterior no era JSON válido. Devuelve únicamente el objeto JSON.";
      continue;
    }
    const parsed = DiagnosticoSchema.safeParse(objeto);
    const errores = parsed.success ? validarCoherencia(parsed.data) : [];
    if (parsed.success && errores.length === 0) return parsed.data;
    const detalle = parsed.success ? errores.map((e) => `- ${e}`).join("\n") : erroresLegibles(parsed.error);
    correccion = `\n\nTu respuesta anterior tenía estos errores; corrígelos y devuelve el JSON completo:\n${detalle}`;
  }
  throw new Error("No se pudo generar un diagnóstico válido");
}

// =====================================================
// MODO SIMULADO (MOCK_AI=1): para probar sin gastar cuota
// =====================================================
// En modo simulado, estos mensajes se tratan como fuera de tema (para probar el cierre).
const FUERA_SIMULADO = /receta|f[uú]tbol|chiste|poema/i;

function simularChat(historial) {
  const ultimo = historial.at(-1);
  if (ultimo?.rol === "user" && FUERA_SIMULADO.test(ultimo.texto)) {
    return separarCierre(
      `Mi función es ayudarte a descubrir qué tareas de tu trabajo se pueden automatizar con IA, así que con eso no puedo ayudarte. Sigamos con tu diagnóstico: ¿cuál es la tarea que más tiempo te quita en la semana?\n${MARCA_FUERA_DE_TEMA}`,
    );
  }
  // Cuenta las respuestas dentro del tema (incluye el mensaje de arranque)
  const respuestas = historial.filter((m) => m.rol === "user" && !FUERA_SIMULADO.test(m.texto)).length;
  const guion = [
    "¡Hola! Soy el Consultor de Diagnóstico de Studio-IA. Te haré una pregunta a la vez para descubrir qué tareas de tu trabajo te quitan más tiempo y cuáles se pueden automatizar con IA. Responde con tus palabras: entre más detalle me des, mejor será tu diagnóstico.\n\nPara empezar, ¿cuál es tu cargo y cómo es un día normal en tu trabajo? Por ejemplo, qué entregas, a quién y con qué herramientas trabajas.",
    "Gracias, eso me ayuda a ubicarte. ¿Qué haces **todos los días** y qué te toca **a fin de mes**? Por ejemplo, registrar documentos, responder solicitudes o armar informes.",
    "Entiendo. ¿Qué información **copias o digitas** de un lugar a otro y cuántas veces al mes lo haces? Por ejemplo, pasar datos de un correo a Excel o de un PDF a un sistema.",
    "Hasta ahora tengo tres tareas: registrar facturas, conciliar bancos y copiar datos entre sistemas. ¿Cuánto tiempo te toma cada una y cuántas personas participan?",
    `Con esto tengo suficiente; preparo tu diagnóstico…\n${MARCA_CIERRE}`,
  ];
  return separarCierre(guion[Math.min(respuestas - 1, guion.length - 1)]);
}
