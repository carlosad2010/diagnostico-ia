import { beforeEach, describe, expect, it, vi } from "vitest";
import admin from "../api/admin.js";
import sesion from "../api/sesion.js";
import chat from "../api/chat.js";
import { reiniciarStore } from "../lib/store.js";
import { cookieDeSesion, csv, sesionValida } from "../lib/admin.js";

function llamar(handler, { method = "GET", body, query, cookie } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      status(c) { this.statusCode = c; return this; },
      json(d) { resolve({ status: this.statusCode, body: d, headers: this.headers }); return this; },
      end(d) { resolve({ status: this.statusCode, body: d, headers: this.headers }); return this; },
    };
    handler({ method, body, query: query ?? {}, headers: { host: "localhost:3000", cookie } }, res);
  });
}
const CLAVE = "clave-de-prueba-123";
const cookieValida = () => cookieDeSesion().split(";")[0];

async function crearSesion(nombre, mensajes = []) {
  const { body } = await llamar(sesion, { method: "POST", body: { nombre, email: `${nombre.length}@b.co`, empresa: "Acme", consentimiento: true } });
  for (const mensaje of mensajes) await llamar(chat, { method: "POST", body: { sesionId: body.sesionId, mensaje } });
  return body.sesionId;
}

describe("panel administrativo", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("MOCK_AI", "1");
    vi.stubEnv("ADMIN_PASSWORD", CLAVE);
    reiniciarStore();
  });

  it("sin ADMIN_PASSWORD el panel no está disponible", async () => {
    vi.stubEnv("ADMIN_PASSWORD", "");
    expect((await llamar(admin, { query: { accion: "panel" } })).status).toBe(503);
  });

  it("pide contraseña y entrega una cookie segura", async () => {
    expect((await llamar(admin, { query: { accion: "panel" } })).status).toBe(401);
    expect((await llamar(admin, { method: "POST", query: { accion: "entrar" }, body: { clave: "otra" } })).status).toBe(401);
    const ok = await llamar(admin, { method: "POST", query: { accion: "entrar" }, body: { clave: CLAVE } });
    expect(ok.status).toBe(200);
    expect(ok.headers["set-cookie"]).toMatch(/HttpOnly; Secure; SameSite=Strict/);
    expect(ok.headers["set-cookie"]).toContain("Path=/api/admin");
  });

  it("rechaza cookies manipuladas, vencidas o firmadas con otra contraseña", () => {
    const valida = cookieValida();
    expect(sesionValida(valida)).toBe(true);
    expect(sesionValida(valida.replace(/.$/, (c) => (c === "a" ? "b" : "a")))).toBe(false);
    expect(sesionValida(valida, Date.now() + 9 * 60 * 60 * 1000)).toBe(false);
    vi.stubEnv("ADMIN_PASSWORD", "otra-clave-distinta");
    expect(sesionValida(valida)).toBe(false);
  });

  it("muestra indicadores, filtra y pagina el historial", async () => {
    await crearSesion("Ana", ["Soy contadora", "Concilio bancos", "Copio facturas", "Somos 2 personas"]); // el simulado entrega el diagnóstico
    await crearSesion("Beto", ["¿Me das una receta?", "¿Y el partido de fútbol?", "Cuéntame un chiste"]); // cerrada por fuera de tema
    await crearSesion("Carla");
    const r = await llamar(admin, { query: { accion: "panel" }, cookie: cookieValida() });
    expect(r.status).toBe(200);
    expect(r.body.indicadores).toMatchObject({ personas: 3, completados: 1, cerradas: 1, en_curso: 1 });
    expect(r.body.indicadores.horas_mes).toBeGreaterThan(0);
    expect(r.body.semanas).toHaveLength(12);
    expect(r.body.semanas.at(-1).iniciados).toBe(3);
    expect(r.body.industrias[0].total).toBe(1);
    expect(r.body.filas.map((f) => f.nombre)).toEqual(expect.arrayContaining(["Ana", "Beto", "Carla"]));

    const filtrado = await llamar(admin, { query: { accion: "panel", q: "ANA", estado: "completado" }, cookie: cookieValida() });
    expect(filtrado.body.filas.map((f) => f.nombre)).toEqual(["Ana"]);
    expect(filtrado.body.filas[0].diagnostico_id).toBeTruthy();
    const cerradas = await llamar(admin, { query: { accion: "panel", estado: "cerrado" }, cookie: cookieValida() });
    expect(cerradas.body.filas[0]).toMatchObject({ nombre: "Beto", fuera_de_tema: 3 });
  });

  it("exporta el historial en CSV para Excel", async () => {
    await crearSesion("=HYPERLINK(\"http://x\")");
    const r = await llamar(admin, { query: { accion: "exportar" }, cookie: cookieValida() });
    expect(r.headers["content-type"]).toContain("text/csv");
    expect(r.headers["content-disposition"]).toMatch(/attachment; filename="historico-diagnosticos-/);
    expect(r.body.startsWith("﻿Fecha;Nombre;Correo")).toBe(true);
    // Un nombre que parece fórmula no se ejecuta en Excel
    expect(r.body).toContain(`"'=HYPERLINK(""http://x"")"`);
  });

  it("el CSV usa coma decimal y no rompe con punto y coma en los textos", () => {
    const texto = csv([{ creado: "2026-11-22T14:00:00Z", nombre: "Ana; Pérez", turnos: 3, horas_mes_liberadas: 12.5, estado: "completado", diagnostico_id: "x" }], "https://app");
    expect(texto).toContain('"Ana; Pérez"');
    expect(texto).toContain(";12,5;");
    expect(texto).toContain("https://app/diagnostico/x");
  });

  it("muestra la conversación completa de una sesión", async () => {
    const id = await crearSesion("Ana", ["Soy contadora"]);
    const r = await llamar(admin, { query: { accion: "conversacion", id }, cookie: cookieValida() });
    expect(r.status).toBe(200);
    expect(r.body.sesion).toMatchObject({ nombre: "Ana", estado: "en_curso" });
    expect(r.body.mensajes.map((m) => m.rol)).toEqual(["assistant", "user", "assistant"]);
    expect((await llamar(admin, { query: { accion: "conversacion", id: "no" }, cookie: cookieValida() })).status).toBe(400);
  });
});
