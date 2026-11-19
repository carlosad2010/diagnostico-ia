import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analizar, conversar, extraerJson, getReplyText, separarCierre, toGeminiContents } from "../lib/gemini.js";
import { DIAGNOSTICO_EJEMPLO } from "../lib/ejemplo.js";

const respuesta = (texto, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => (status < 400 ? { candidates: [{ content: { parts: [{ text: "pensando", thought: true }, { text: texto }] } }] } : { error: { message: "malo" } }),
});

describe("funciones puras", () => {
  it("toGeminiContents empieza en user y une roles seguidos", () => {
    const c = toGeminiContents([
      { rol: "assistant", texto: "saludo" },
      { rol: "user", texto: "a" },
      { rol: "user", texto: "b" },
      { rol: "assistant", texto: "c" },
    ]);
    expect(c).toEqual([
      { role: "user", parts: [{ text: "a\n\nb" }] },
      { role: "model", parts: [{ text: "c" }] },
    ]);
  });
  it("getReplyText ignora el razonamiento", async () => {
    expect(getReplyText(await respuesta("hola").json())).toBe("hola");
  });
  it("separarCierre detecta y quita la marca", () => {
    expect(separarCierre("Listo, preparo tu diagnóstico.\n[[DIAGNOSTICO]]")).toEqual({ texto: "Listo, preparo tu diagnóstico.", cerrar: true });
    expect(separarCierre("Sigamos").cerrar).toBe(false);
  });
  it("extraerJson tolera bloques ```json y texto alrededor", () => {
    expect(extraerJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extraerJson('Aquí va: {"a":2} fin')).toEqual({ a: 2 });
  });
});

describe("llamadas a Gemini (fetch simulado)", () => {
  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", "clave-secreta");
    vi.stubEnv("MOCK_AI", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("conversar envía la key en el header y nunca en la URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuesta("¿Cuál es tu cargo?"));
    vi.stubGlobal("fetch", fetchMock);
    const r = await conversar([{ rol: "user", texto: "Hola" }]);
    expect(r).toEqual({ texto: "¿Cuál es tu cargo?", cerrar: false });
    const [url, opciones] = fetchMock.mock.calls[0];
    expect(url).not.toContain("clave-secreta");
    expect(opciones.headers["x-goog-api-key"]).toBe("clave-secreta");
    expect(JSON.parse(opciones.body).systemInstruction.parts[0].text).toContain("Consultor de Diagnóstico");
  });

  it("conversar propaga el 429 para avisar de la cuota", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta("", 429))); // todos los modelos sin cuota
    await expect(conversar([{ rol: "user", texto: "Hola" }])).rejects.toMatchObject({ status: 429 });
  });

  it("conversar cambia al modelo de respaldo si el principal está saturado (503)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(respuesta("", 503)).mockResolvedValueOnce(respuesta("Hola desde el respaldo"));
    vi.stubGlobal("fetch", fetchMock);
    const r = await conversar([{ rol: "user", texto: "Hola" }]);
    expect(r.texto).toBe("Hola desde el respaldo");
    expect(fetchMock.mock.calls[0][0]).not.toBe(fetchMock.mock.calls[1][0]);
  });

  it("conversar no cambia de modelo ante un 400", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuesta("", 400));
    vi.stubGlobal("fetch", fetchMock);
    await expect(conversar([{ rol: "user", texto: "Hola" }])).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("analizar prueba el siguiente formato si la API rechaza el esquema (400)", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(respuesta("", 400))
      .mockResolvedValueOnce(respuesta(JSON.stringify(DIAGNOSTICO_EJEMPLO)));
    vi.stubGlobal("fetch", fetchMock);
    const d = await analizar([{ rol: "user", texto: "Soy coordinadora de compras" }]);
    expect(d.oportunidades[0].id).toBe("OP-01");
    const config1 = JSON.parse(fetchMock.mock.calls[0][1].body).generationConfig;
    const config2 = JSON.parse(fetchMock.mock.calls[1][1].body).generationConfig;
    expect(config1.responseFormat.text.mimeType).toBe("application/json");
    expect(config2.responseJsonSchema).toBeDefined();
  });

  it("analizar pide corrección si el JSON no cumple el esquema", async () => {
    const malo = { ...DIAGNOSTICO_EJEMPLO, tareas: [] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(respuesta(JSON.stringify(malo)))
      .mockResolvedValueOnce(respuesta(JSON.stringify(DIAGNOSTICO_EJEMPLO)));
    vi.stubGlobal("fetch", fetchMock);
    await analizar([{ rol: "user", texto: "x" }]);
    const segundo = JSON.parse(fetchMock.mock.calls[1][1].body).contents[0].parts[0].text;
    expect(segundo).toContain("tenía estos errores");
    expect(segundo).toContain("tareas");
  });

  it("analizar se rinde tras varios intentos inválidos", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta("esto no es JSON")));
    await expect(analizar([{ rol: "user", texto: "x" }])).rejects.toThrow("No se pudo generar");
  });
});
