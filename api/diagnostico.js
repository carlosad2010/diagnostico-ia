import { esUuid, informe } from "../lib/servicio.js";
import { responderError } from "../lib/http.js";

// GET /api/diagnostico?id=… → datos del informe (el id es un UUID imposible de adivinar)
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Método no permitido" });
  const id = req.query?.id;
  if (!esUuid(id)) return res.status(400).json({ error: "Diagnóstico no válido" });
  try {
    const datos = await informe(id);
    if (!datos) return res.status(404).json({ error: "Diagnóstico no encontrado" });
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    return res.status(200).json(datos);
  } catch (error) {
    return responderError(res, error, "diagnostico");
  }
}
