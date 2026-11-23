// =====================================================
// SERVIDOR LOCAL (sin la CLI de Vercel)
// Sirve /src y ejecuta las funciones de /api imitando a Vercel:
// req.body (JSON), req.query, res.status().json() y rewrites del SPA.
// Uso: npm run dev   (o npm run dev:simulado para no gastar cuota de Gemini)
// =====================================================
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const PUBLICO = join(RAIZ, "src");
const PUERTO = Number(process.env.PORT ?? 3000);
const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};
const FUNCIONES = new Set(["sesion", "chat", "diagnostico", "admin"]);

function adaptarRespuesta(res) {
  res.status = (codigo) => {
    res.statusCode = codigo;
    return res;
  };
  res.json = (datos) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(datos));
    return res;
  };
  return res;
}

async function leerCuerpo(req) {
  const partes = [];
  for await (const p of req) partes.push(p);
  const texto = Buffer.concat(partes).toString("utf8");
  if (!texto) return undefined;
  try {
    return JSON.parse(texto);
  } catch {
    return texto;
  }
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      const nombre = url.pathname.slice(5).replace(/\/$/, "");
      if (!FUNCIONES.has(nombre)) return adaptarRespuesta(res).status(404).json({ error: "No existe" });
      const { default: handler } = await import(pathToFileURL(join(RAIZ, "api", `${nombre}.js`)).href);
      req.query = Object.fromEntries(url.searchParams);
      req.body = await leerCuerpo(req);
      return await handler(req, adaptarRespuesta(res));
    }
    // Archivos estáticos; cualquier otra ruta → index.html (como el rewrite de vercel.json)
    const ruta = normalize(join(PUBLICO, decodeURIComponent(url.pathname)));
    if (!ruta.startsWith(PUBLICO)) return res.writeHead(403).end();
    try {
      const contenido = await readFile(ruta);
      res.writeHead(200, { "Content-Type": TIPOS[extname(ruta)] ?? "application/octet-stream" });
      return res.end(contenido);
    } catch {
      res.writeHead(200, { "Content-Type": TIPOS[".html"] });
      return res.end(await readFile(join(PUBLICO, "index.html")));
    }
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.writeHead(500).end("Error del servidor");
  }
});

servidor.listen(PUERTO, () => {
  const modo = process.env.MOCK_AI === "1" ? " (modo simulado, sin Gemini)" : "";
  console.log(`Diagnóstico Studio-IA en http://localhost:${PUERTO}${modo}`);
});
