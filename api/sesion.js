import { store } from "../lib/store.js";
import { Registro, esUuid, iniciarSesion, mensajesVisibles, urlBase } from "../lib/servicio.js";
import { responderError } from "../lib/http.js";

// POST /api/sesion → registra a la persona y devuelve el saludo del consultor
// GET  /api/sesion?id=… → recupera la conversación para continuarla
export default async function handler(req, res) {
  try {
    if (req.method === "POST") {
      const datos = Registro.safeParse(req.body);
      if (!datos.success) {
        return res.status(400).json({ error: "Revisa tu nombre, tu correo y la autorización de datos." });
      }
      return res.status(200).json(await iniciarSesion(datos.data, urlBase(req)));
    }
    if (req.method === "GET") {
      const id = req.query?.id;
      if (!esUuid(id)) return res.status(400).json({ error: "Sesión no válida" });
      const db = store();
      const sesion = await db.obtenerSesion(id);
      if (!sesion) return res.status(404).json({ error: "Sesión no encontrada" });
      return res.status(200).json({
        nombre: sesion.nombre,
        estado: sesion.estado,
        turnos: sesion.turnos,
        mensajes: mensajesVisibles(await db.obtenerMensajes(id)),
        diagnosticoUrl: sesion.diagnostico_id ? `${urlBase(req)}/diagnostico/${sesion.diagnostico_id}` : null,
      });
    }
    return res.status(405).json({ error: "Método no permitido" });
  } catch (error) {
    return responderError(res, error, "sesion");
  }
}
