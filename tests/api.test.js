import { beforeEach, describe, expect, it, vi } from "vitest";
import sesion from "../api/sesion.js";
import chat from "../api/chat.js";
import diagnostico from "../api/diagnostico.js";
import { reiniciarStore } from "../lib/store.js";

// res mínimo con la misma forma que el de Vercel
function llamar(handler, { method = "POST", body, query } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.statusCode = c; return this; },
      json(d) { resolve({ status: this.statusCode, body: d }); return this; },
    };
    handler({ method, body, query: query ?? {}, headers: { host: "localhost:3000" } }, res);
  });
}

describe("funciones de /api en modo simulado", () => {
  beforeEach(() => {
    vi.stubEnv("MOCK_AI", "1");
    reiniciarStore();
  });

  it("valida método y registro", async () => {
    expect((await llamar(chat, { method: "GET" })).status).toBe(405);
    expect((await llamar(sesion, { body: { nombre: "A", email: "x" } })).status).toBe(400);
    expect((await llamar(sesion, { body: { nombre: "Ana", email: "a@b.co", consentimiento: false } })).status).toBe(400);
    expect((await llamar(chat, { body: { sesionId: "no-es-uuid", mensaje: "hola" } })).status).toBe(400);
  });

  it("recorrido completo: registro → entrevista → diagnóstico → informe", async () => {
    const r1 = await llamar(sesion, { body: { nombre: "Ana", email: "a@b.co", empresa: "Ferrecasa", consentimiento: true } });
    expect(r1.status).toBe(200);
    const { sesionId } = r1.body;

    for (const m of ["Soy contadora", "Concilio bancos", "Copio facturas"]) {
      const r = await llamar(chat, { body: { sesionId, mensaje: m } });
      expect(r.status).toBe(200);
      expect(r.body.diagnosticoUrl).toBeNull();
    }
    // El modo simulado cierra con la marca en la 4.a respuesta
    const cierre = await llamar(chat, { body: { sesionId, mensaje: "Somos 2 personas" } });
    expect(cierre.body.diagnosticoUrl).toMatch(/^http:\/\/localhost:3000\/diagnostico\/[0-9a-f-]{36}$/);
    expect(cierre.body.respuesta).toContain("primera acción recomendada");

    // Ya no se puede seguir conversando
    expect((await llamar(chat, { body: { sesionId, mensaje: "hola" } })).status).toBe(409);

    // La sesión se recupera sin el mensaje de arranque
    const g = await llamar(sesion, { method: "GET", query: { id: sesionId } });
    expect(g.body.estado).toBe("completado");
    expect(g.body.mensajes[0].rol).toBe("assistant");
    expect(JSON.stringify(g.body)).not.toContain("a@b.co");

    const id = cierre.body.diagnosticoUrl.split("/").at(-1);
    const inf = await llamar(diagnostico, { method: "GET", query: { id } });
    expect(inf.status).toBe(200);
    expect(inf.body.persona).toEqual({ nombre: "Ana", empresa: "Ferrecasa" });
    expect(inf.body.calculos.totales.horas_mes_esperadas).toBe(30.1);
    expect(JSON.stringify(inf.body)).not.toContain("a@b.co");
  });

  it("el botón de prisa (cerrar) genera el diagnóstico sin llamar al chat", async () => {
    const { body } = await llamar(sesion, { body: { nombre: "Ana", email: "a@b.co", consentimiento: true } });
    const r = await llamar(chat, { body: { sesionId: body.sesionId, mensaje: "Listo, entrégame el diagnóstico.", cerrar: true } });
    expect(r.body.diagnosticoUrl).toBeTruthy();
  });

  it("informe inexistente → 404", async () => {
    const r = await llamar(diagnostico, { method: "GET", query: { id: "00000000-0000-0000-0000-000000000000" } });
    expect(r.status).toBe(404);
  });
});
