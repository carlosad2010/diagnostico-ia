import { store } from "../lib/store.js";
import { esUuid, mensajesVisibles, urlBase } from "../lib/servicio.js";
import {
  adminConfigurado, claveCorrecta, cookieDeSalida, cookieDeSesion, csv, filaPublica, filtrar,
  indicadores, industrias, leerFiltros, porSemana, sesionValida,
} from "../lib/admin.js";

// Panel administrativo (uso exclusivo del dueño del software).
//   POST /api/admin?accion=entrar  { clave }     → cookie de sesión (8 h)
//   POST /api/admin?accion=salir
//   GET  /api/admin?accion=panel&q&estado&desde&hasta&pagina → indicadores, semanas, industrias y tabla
//   GET  /api/admin?accion=exportar&…filtros    → CSV para Excel
//   GET  /api/admin?accion=conversacion&id=…    → mensajes de una sesión
const POR_PAGINA = 20;
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  if (!adminConfigurado()) {
    return res.status(503).json({ error: "El panel no está configurado: define ADMIN_PASSWORD (mínimo 8 caracteres)." });
  }
  const accion = req.query?.accion;

  try {
    if (req.method === "POST" && accion === "entrar") {
      if (!claveCorrecta(req.body?.clave)) {
        await espera(800); // frena intentos repetidos
        return res.status(401).json({ error: "Contraseña incorrecta." });
      }
      res.setHeader("Set-Cookie", cookieDeSesion());
      return res.status(200).json({ ok: true });
    }
    if (req.method === "POST" && accion === "salir") {
      res.setHeader("Set-Cookie", cookieDeSalida());
      return res.status(200).json({ ok: true });
    }
    if (!sesionValida(req.headers?.cookie)) return res.status(401).json({ error: "Inicia sesión para ver el panel." });
    if (req.method !== "GET") return res.status(405).json({ error: "Método no permitido" });

    if (accion === "panel" || accion === "exportar") {
      const f = leerFiltros(req.query);
      const filas = filtrar(await store().listarSesionesAdmin(), f);
      if (accion === "exportar") {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="historico-diagnosticos-${new Date().toISOString().slice(0, 10)}.csv"`);
        return res.status(200).end(csv(filas.map(filaPublica), urlBase(req)));
      }
      const fin = f.hasta ? new Date(`${f.hasta}T12:00:00`).getTime() : Date.now();
      const desde = (f.pagina - 1) * POR_PAGINA;
      return res.status(200).json({
        indicadores: indicadores(filas),
        semanas: porSemana(filas, fin),
        industrias: industrias(filas),
        total: filas.length,
        pagina: f.pagina,
        paginas: Math.max(1, Math.ceil(filas.length / POR_PAGINA)),
        filas: filas.slice(desde, desde + POR_PAGINA).map(filaPublica),
      });
    }

    if (accion === "conversacion") {
      if (!esUuid(req.query?.id)) return res.status(400).json({ error: "Sesión no válida" });
      const c = await store().conversacionAdmin(req.query.id);
      if (!c) return res.status(404).json({ error: "Sesión no encontrada" });
      const [fila] = filtrar([{ ...c.sesion, ultima_actividad: c.mensajes.at(-1)?.creado ?? c.sesion.creado }], {});
      return res.status(200).json({ sesion: filaPublica(fila), mensajes: mensajesVisibles(c.mensajes) });
    }

    return res.status(400).json({ error: "Acción no válida" });
  } catch (error) {
    console.error("[admin]", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
}
