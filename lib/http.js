import { ErrorGemini } from "./gemini.js";

// Respuesta de error uniforme: el detalle técnico solo va a los logs del servidor.
export function responderError(res, error, contexto) {
  console.error(`[${contexto}]`, error);
  if (error instanceof ErrorGemini && error.status === 429) {
    return res.status(429).json({ error: "Hay muchas consultas en este momento. Espera unos segundos e intenta de nuevo." });
  }
  if (error instanceof ErrorGemini) {
    return res.status(502).json({ error: "El consultor no respondió. Intenta enviar tu mensaje de nuevo." });
  }
  return res.status(500).json({ error: "Error interno del servidor" });
}
