import { z } from "zod";
import { store } from "./store.js";
import { analizar, conversar } from "./gemini.js";
import { calcularDiagnostico } from "./calculos.js";
import { enviarEnlaceRetomar, enviarInforme } from "./correo.js";
import { MAX_FUERA_DE_TEMA, despedidaFueraDeTema } from "./prompts.js";

// =====================================================
// LÓGICA DEL DIAGNÓSTICO (la usan las funciones de /api)
// =====================================================

export const MAX_TURNOS = Number(process.env.MAX_TURNOS ?? 40);
export const MAX_CARACTERES = 3000;
// Debe coincidir con el texto que muestra src/utils.js (lo comprueba un test)
export const TEXTO_CONSENTIMIENTO =
  "Autorizo a Studio-IA a tratar mis datos (nombre, correo, empresa y respuestas) para generar y enviarme este diagnóstico y contactarme sobre él, conforme a la Ley 1581 de 2012. Entiendo que mis respuestas se procesan con un servicio de IA de terceros y no compartiré información confidencial.";

export const Registro = z.object({
  nombre: z.string().trim().min(2).max(80),
  email: z.email().max(120),
  empresa: z.string().trim().max(120).optional().default(""),
  consentimiento: z.literal(true),
});
export const MensajeEntrada = z.object({
  sesionId: z.uuid(),
  mensaje: z.string().trim().min(1).max(MAX_CARACTERES),
  cerrar: z.boolean().optional().default(false),
});
export const esUuid = (id) => z.uuid().safeParse(id).success;

export function urlBase(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  const proto = req.headers["x-forwarded-proto"] ?? (host?.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Crea la sesión y devuelve el saludo del consultor. */
export async function iniciarSesion({ nombre, email, empresa }, base) {
  const db = store();
  const sesion = await db.crearSesion({ nombre, email, empresa: empresa || null, consentimiento_texto: TEXTO_CONSENTIMIENTO });
  const arranque = { rol: "user", texto: `Hola, soy ${nombre}${empresa ? ` y trabajo en ${empresa}` : ""}. Quiero hacer mi diagnóstico.` };
  const r = await conversar([arranque]);
  await db.agregarMensajes(sesion.id, [arranque, { rol: "assistant", texto: r.texto }]);
  if (base) {
    await enviarEnlaceRetomar({ para: email, nombre, url: `${base}/retomar/${sesion.id}` }).catch((e) => console.error("[correo]", e));
  }
  return { sesionId: sesion.id, respuesta: r.texto };
}

/**
 * Procesa un mensaje. Si el consultor decide cerrar, la persona lo pide (cerrar=true)
 * o se llega al límite de turnos, genera el diagnóstico.
 * Si el mensaje está fuera de tema suma un aviso; al llegar a MAX_FUERA_DE_TEMA
 * cierra la conversación sin diagnóstico (regla fija del servidor, no del modelo).
 * Devuelve { respuesta, cerrada?, diagnosticoId?, errorDiagnostico? }.
 */
export async function procesarMensaje(sesion, mensaje, { cerrar = false, base }) {
  const db = store();
  const historial = await db.obtenerMensajes(sesion.id);
  const persona = { rol: "user", texto: mensaje };
  // En un reintento de cierre no se repite el mensaje de la persona
  const nuevos = cerrar && historial.at(-1)?.rol === "user" ? [] : [persona];
  let respuesta = "";
  let debeCerrar = cerrar || sesion.turnos + 1 >= MAX_TURNOS;
  let cerrada = false;

  if (!cerrar) {
    const avisos = sesion.fuera_de_tema ?? 0;
    const r = await conversar([...historial, ...nuevos], { avisos });
    respuesta = r.texto;
    if (r.fueraDeTema) {
      cerrada = avisos + 1 >= MAX_FUERA_DE_TEMA;
      if (cerrada) {
        respuesta = despedidaFueraDeTema(sesion.nombre);
        debeCerrar = false;
      }
      await db.registrarFueraDeTema(sesion.id, avisos + 1, cerrada).catch((e) =>
        console.error("[fuera de tema] no se pudo guardar el aviso (¿falta database/migracion-01-fuera-de-tema.sql?)", e),
      );
    } else {
      debeCerrar ||= r.cerrar;
    }
    nuevos.push({ rol: "assistant", texto: respuesta });
  }
  await db.agregarMensajes(sesion.id, nuevos);
  await db.sumarTurno(sesion.id, sesion.turnos);
  if (cerrada) return { respuesta, cerrada: true };
  if (!debeCerrar) return { respuesta };

  // ---- Cierre: análisis estructurado ----
  try {
    const conversacion = [...historial, ...nuevos].slice(1); // sin el mensaje de arranque
    const datos = await analizar(conversacion);
    const { totales, oportunidades } = calcularDiagnostico(datos);
    const diagnosticoId = await db.guardarDiagnostico(sesion.id, datos, {
      cargo: datos.contexto.cargo,
      industria: datos.contexto.industria,
      horas_mes_liberadas: totales.horas_mes_esperadas,
      valor_anual_esperado: totales.valor_anual_esperado,
    });
    const primera = oportunidades[0];
    const despedida = `¡Listo, ${sesion.nombre}! Tu diagnóstico está preparado. La primera acción recomendada es **${primera.nombre}**: ${primera.primer_paso}\n\nAbre el informe completo con el botón de abajo; también puedes guardarlo en PDF.`;
    await db.agregarMensajes(sesion.id, [{ rol: "assistant", texto: despedida }]);
    await enviarInforme({ para: sesion.email, nombre: sesion.nombre, empresa: sesion.empresa, url: `${base}/diagnostico/${diagnosticoId}` }).catch((e) =>
      console.error("[correo]", e),
    );
    return { respuesta: [respuesta, despedida].filter(Boolean).join("\n\n"), diagnosticoId };
  } catch (error) {
    console.error("[análisis]", error);
    return {
      respuesta: respuesta || "Estoy preparando tu diagnóstico…",
      errorDiagnostico: "No pude generar el informe esta vez. Pulsa «Reintentar diagnóstico» en unos segundos.",
    };
  }
}

/** Mensajes que se muestran al retomar la conversación (sin el arranque automático). */
export function mensajesVisibles(historial) {
  return historial.slice(1).map((m) => ({ rol: m.rol, texto: m.texto, creado: m.creado }));
}

/** Datos del informe para la vista /diagnostico/:id (sin el correo de la persona). */
export async function informe(id) {
  const guardado = await store().obtenerDiagnostico(id);
  if (!guardado) return null;
  return {
    id: guardado.id,
    creado: guardado.creado,
    persona: { nombre: guardado.sesion?.nombre ?? "", empresa: guardado.sesion?.empresa ?? null },
    datos: guardado.datos,
    calculos: calcularDiagnostico(guardado.datos),
  };
}
