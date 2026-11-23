import { z } from "zod";

// Formato del diagnóstico (ficha de oportunidades, sección 5 de la skill).

// Gemini lo entrega como JSON; las cifras (horas, impacto, viabilidad, dinero) las calcula lib/calculos.js.

const nota = z.number().int().min(1).max(5);
const texto = z.string().min(1);

export const TIPOS_SOLUCION = [
  "mejora_proceso",
  "reglas",
  "ia_generativa",
  "asistente_conocimiento",
  "analitica_reportes",
  "predictiva",
  "agente",
  "recolectar_datos",
];

export const ETIQUETA_SOLUCION = {
  mejora_proceso: "Mejora de proceso",
  reglas: "Automatización por reglas",
  ia_generativa: "Flujo con IA generativa",
  asistente_conocimiento: "Asistente con conocimiento",
  analitica_reportes: "Análisis y reportes",
  predictiva: "IA predictiva y alertas",
  agente: "Agente",
  recolectar_datos: "Recolectar datos primero",
};

const respuestaFiltro = z.object({
  respuesta: z.enum(["si", "no", "no_aplica"]),
  justificacion: texto,
});

// La frecuencia llega como la dijo la persona ("40 al día"); el código la convierte a veces por mes.
export const PERIODOS = ["dia", "semana", "quincena", "mes", "trimestre", "anio"];
// El tiempo también llega como lo dijo ("4 días en total al mes", "6 minutos cada factura").
export const UNIDADES_TIEMPO = ["minutos", "horas", "dias"];
export const ALCANCES_TIEMPO = ["cada_vez", "total_del_periodo"];

export const TareaSchema = z.object({
  id: texto.describe("T1, T2…"),
  nombre: texto,
  descripcion: texto.describe("Qué es la tarea, en una frase"),
  frecuencia: z
    .object({
      veces: z.number().min(0).describe("Cuántas veces en ese periodo, tal como lo dijo la persona"),
      periodo: z.enum(PERIODOS).describe("dia = día hábil"),
    })
    .describe("Frecuencia sin convertir; el sistema calcula las veces por mes"),
  tiempo: z
    .object({
      cantidad: z.number().min(0),
      unidad: z.enum(UNIDADES_TIEMPO).describe("dias = jornadas de 8 horas"),
      alcance: z
        .enum(ALCANCES_TIEMPO)
        .describe("cada_vez: lo que toma UNA repetición; total_del_periodo: lo que toman TODAS las repeticiones del periodo de la frecuencia"),
    })
    .describe("Tiempo tal como lo dijo la persona, sin convertir; el sistema hace las cuentas"),
  ahorro_porcentaje: z.number().min(0).max(100).describe("Parte del tiempo (0 a 100) que ahorraría la solución recomendada"),
  cita: texto.describe("Frase literal de la persona sobre cada cuánto hace la tarea y cuánto le toma"),
  personas: z.number().int().min(1),
  calificacion: z.object({
    volumen: nota,
    costo_errores: nota,
    repetitividad: nota,
    entrada_digital: nota,
    reglas: nota,
    datos: nota,
    riesgo_invertido: nota,
  }),
  justificacion_nota_baja: texto,
  solucion: z.enum(TIPOS_SOLUCION),
  origen_cifras: z.enum(["hecho", "estimacion", "supuesto"]),
});

export const OportunidadSchema = z.object({
  id: texto.describe("OP-01, OP-02…"),
  tarea_id: texto.describe("Id de la tarea del inventario"),
  nombre: texto,
  proceso_area: texto,
  responsable: texto.describe("Rol, nunca un nombre propio"),
  as_is: texto.describe("Pasos, tiempos y esperas clave"),
  dolor: texto,
  evidencia: z.enum(["hecho", "estimacion", "supuesto"]),
  datos_disponibles: texto,
  filtro: z.object({
    mejorar_proceso: respuestaFiltro,
    reglas: respuestaFiltro,
    ia_generativa: respuestaFiltro,
    predictivo: respuestaFiltro,
    agente: respuestaFiltro,
    datos_suficientes: respuestaFiltro,
    revision_humana: respuestaFiltro,
  }),
  solucion: z.object({
    tipo: z.enum(TIPOS_SOLUCION),
    descripcion: texto,
    herramientas: z.array(texto).min(1),
    alternativa: texto,
  }),
  to_be: z.array(texto).min(2).max(8),
  revision_humana: texto,
  kpi: z.object({
    nombre: texto,
    linea_base: texto,
    meta: texto,
    frecuencia: texto,
    fuente: texto,
  }),
  esfuerzo: z.enum(["bajo", "medio", "alto"]),
  riesgos: z.array(texto).min(1),
  primer_paso: texto.describe("Acción concreta para esta semana"),
  supuestos: z.array(texto),
});

export const DiagnosticoSchema = z.object({
  contexto: z.object({
    cargo: texto,
    area: texto,
    industria: texto,
    tamano_empresa: texto,
    modelo_negocio: texto,
    herramientas: z.array(texto),
    restricciones: z.array(z.string()),
  }),
  costo_hora: z
    .number()
    .positive()
    .nullable()
    .describe("Costo de una hora de trabajo si la persona lo dio; null si no"),
  moneda: z.string().describe("COP, USD, MXN… o vacío si no hay costo_hora"),
  resumen: texto.describe("2-3 frases: el hallazgo principal y la primera acción"),
  tareas: z.array(TareaSchema).min(1).max(12),
  oportunidades: z.array(OportunidadSchema).min(1).max(5),
  hoja_ruta: z.object({
    dias_30: z.array(texto).min(1),
    dias_60: z.array(texto).min(1),
    dias_90: z.array(texto).min(1),
  }),
  no_automatizar_todavia: z.array(z.object({ tarea: texto, razon: texto })),
  datos_faltantes: z.array(z.string()),
});


/**
 * JSON Schema para Gemini: quita palabras clave que no soporta y convierte
 * los anyOf con null en tipos con null (["number", "null"]).
 */
export function esquemaGemini() {
  const NO_SOPORTADAS = new Set(["$schema", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "pattern"]);
  const limpiar = (nodo) => {
    if (Array.isArray(nodo)) return nodo.map(limpiar);
    if (!nodo || typeof nodo !== "object") return nodo;
    if (Array.isArray(nodo.anyOf) && nodo.anyOf.length === 2 && nodo.anyOf.some((o) => o.type === "null")) {
      const base = limpiar(nodo.anyOf.find((o) => o.type !== "null"));
      return { ...base, type: [base.type, "null"], ...(nodo.description ? { description: nodo.description } : {}) };
    }
    const salida = {};
    for (const [k, v] of Object.entries(nodo)) if (!NO_SOPORTADAS.has(k)) salida[k] = limpiar(v);
    return salida;
  };
  return limpiar(z.toJSONSchema(DiagnosticoSchema));
}

/** Mensajes de error legibles para devolverle al modelo si el JSON no es válido. */
export function erroresLegibles(error) {
  return error.issues
    .slice(0, 15)
    .map((i) => `- ${i.path.join(".") || "(raíz)"}: ${i.message}`)
    .join("\n");
}
