import { store } from "../lib/store.js";
import { MAX_CARACTERES, MAX_TURNOS, MensajeEntrada, procesarMensaje, urlBase } from "../lib/servicio.js";
import { responderError } from "../lib/http.js";

// POST /api/chat { sesionId, mensaje, cerrar? }
// El historial vive en el servidor: el cliente solo envía el mensaje nuevo.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  const entrada = MensajeEntrada.safeParse(req.body);
  if (!entrada.success) {
    return res.status(400).json({ error: `El mensaje debe tener entre 1 y ${MAX_CARACTERES} caracteres.` });
  }
  const { sesionId, mensaje, cerrar } = entrada.data;

  try {
    const sesion = await store().obtenerSesion(sesionId);
    if (!sesion) return res.status(404).json({ error: "Sesión no encontrada." });
    if (sesion.estado === "cerrado") {
      return res.status(409).json({ error: "Esta conversación terminó sin diagnóstico. Puedes empezar uno nuevo desde el inicio." });
    }
    if (sesion.estado === "completado") {
      return res.status(409).json({ error: "Este diagnóstico ya terminó. Puedes ver el informe con el botón." });
    }
    if (sesion.turnos >= MAX_TURNOS && !cerrar) {
      return res.status(429).json({ error: "Se alcanzó el límite de mensajes. Pulsa «Entregar mi diagnóstico»." });
    }
    const base = urlBase(req);
    const r = await procesarMensaje(sesion, mensaje, { cerrar, base });
    return res.status(200).json({
      respuesta: r.respuesta,
      diagnosticoUrl: r.diagnosticoId ? `${base}/diagnostico/${r.diagnosticoId}` : null,
      errorDiagnostico: r.errorDiagnostico ?? null,
      cerrada: r.cerrada ?? false,
    });
  } catch (error) {
    return responderError(res, error, "chat");
  }
}
