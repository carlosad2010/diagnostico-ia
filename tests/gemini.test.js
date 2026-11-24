import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analizar, conversar, extraerJson, getOpenRouterText, getReplyText, reiniciarFormatoAnalisis, separarCierre, toGeminiContents, toOpenRouterMessages } from "../lib/gemini.js";
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
    expect(separarCierre("Listo, preparo tu diagnóstico.\n[[DIAGNOSTICO]]")).toEqual({ texto: "Listo, preparo tu diagnóstico.", cerrar: true, fueraDeTema: false });
    expect(separarCierre("Sigamos").cerrar).toBe(false);
  });
  it("separarCierre detecta la marca de fuera de tema, aunque venga mal escrita", () => {
    expect(separarCierre("Mi función es tu diagnóstico.\n[[FUERA_DE_TEMA]]")).toEqual({ texto: "Mi función es tu diagnóstico.", cerrar: false, fueraDeTema: true });
    expect(separarCierre("Volvamos al tema. [[ fuera de tema ]]").fueraDeTema).toBe(true);
    // Si vienen las dos marcas, gana fuera de tema: nunca se genera diagnóstico en ese turno
    expect(separarCierre("x\n[[FUERA_DE_TEMA]]\n[[DIAGNOSTICO]]")).toEqual({ texto: "x", cerrar: false, fueraDeTema: true });
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
    vi.stubEnv("GEMINI_ESPERA_REINTENTO_MS", "0");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    reiniciarFormatoAnalisis();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("conversar envía la key en el header y nunca en la URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuesta("¿Cuál es tu cargo?"));
    vi.stubGlobal("fetch", fetchMock);
    const r = await conversar([{ rol: "user", texto: "Hola" }]);
    expect(r).toEqual({ texto: "¿Cuál es tu cargo?", cerrar: false, fueraDeTema: false });
    const [url, opciones] = fetchMock.mock.calls[0];
    expect(url).not.toContain("clave-secreta");
    expect(opciones.headers["x-goog-api-key"]).toBe("clave-secreta");
    expect(JSON.parse(opciones.body).systemInstruction.parts[0].text).toContain("Consultor de Diagnóstico");
  });

  it("conversar le informa al modelo los avisos por mensajes fuera de tema", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuesta("Sigamos"));
    vi.stubGlobal("fetch", fetchMock);
    await conversar([{ rol: "user", texto: "Hola" }]);
    await conversar([{ rol: "user", texto: "Hola" }], { avisos: 1 });
    const instruccion = (i) => JSON.parse(fetchMock.mock.calls[i][1].body).systemInstruction.parts[0].text;
    expect(instruccion(0)).toContain("Aún no has dado avisos");
    expect(instruccion(1)).toContain("último aviso");
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

  it("analizar reintenta cuando Gemini está saturado (503) y recuerda el formato aceptado", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(respuesta("", 400)) // formato 0 rechazado
      .mockResolvedValue(respuesta("", 503)); // luego todos los modelos saturados…
    for (let i = 0; i < 4; i++) fetchMock.mockResolvedValueOnce(respuesta("", 503));
    fetchMock.mockResolvedValueOnce(respuesta(JSON.stringify(DIAGNOSTICO_EJEMPLO))); // …hasta que responde
    vi.stubGlobal("fetch", fetchMock);
    const d = await analizar([{ rol: "user", texto: "x" }]);
    expect(d.oportunidades).toHaveLength(3);
    // Un segundo análisis ya no pide el formato rechazado
    fetchMock.mockResolvedValueOnce(respuesta(JSON.stringify(DIAGNOSTICO_EJEMPLO)));
    const antes = fetchMock.mock.calls.length;
    await analizar([{ rol: "user", texto: "y" }]);
    expect(JSON.parse(fetchMock.mock.calls[antes][1].body).generationConfig.responseJsonSchema).toBeDefined();
  });
});

// Respuesta con la forma de OpenRouter (formato OpenAI)
const respuestaOR = (texto, status = 200, error) => ({
  ok: status < 400,
  status,
  json: async () => (error ? { error } : status < 400 ? { choices: [{ message: { role: "assistant", content: texto } }] } : { error: { code: status, message: "malo" } }),
});

describe("OpenRouter (fetch simulado)", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_KEY", "clave-openrouter");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("MOCK_AI", "");
    vi.stubEnv("GEMINI_ESPERA_REINTENTO_MS", "0");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("convierte la conversación al formato de OpenRouter y quita el razonamiento <think>", () => {
    expect(toOpenRouterMessages("sistema", [{ rol: "assistant", texto: "saludo" }, { rol: "user", texto: "a" }, { rol: "user", texto: "b" }])).toEqual([
      { role: "system", content: "sistema" },
      { role: "user", content: "a\n\nb" },
    ]);
    expect(getOpenRouterText({ choices: [{ message: { content: "<think>dudo</think>\n¿Cuál es tu cargo?" } }] })).toBe("¿Cuál es tu cargo?");
  });

  it("conversar usa openrouter/free con la key en el header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuestaOR("¿Cuál es tu cargo?"));
    vi.stubGlobal("fetch", fetchMock);
    const r = await conversar([{ rol: "user", texto: "Hola" }], { avisos: 1 });
    expect(r).toEqual({ texto: "¿Cuál es tu cargo?", cerrar: false, fueraDeTema: false });
    const [url, opciones] = fetchMock.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(url).not.toContain("clave-openrouter");
    expect(opciones.headers.Authorization).toBe("Bearer clave-openrouter");
    const body = JSON.parse(opciones.body);
    expect(body.model).toBe("openrouter/free");
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("último aviso");
  });

  it("reintenta una vez si OpenRouter devuelve un error pasajero dentro de una respuesta 200", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(respuestaOR("", 200, { code: 502, message: "Provider returned error" }))
      .mockResolvedValueOnce(respuestaOR("Sigamos"));
    vi.stubGlobal("fetch", fetchMock);
    expect((await conversar([{ rol: "user", texto: "Hola" }])).texto).toBe("Sigamos");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("propaga el 429 cuando se acaba el cupo gratuito", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuestaOR("", 429)));
    await expect(conversar([{ rol: "user", texto: "Hola" }])).rejects.toMatchObject({ status: 429 });
  });

  it("analizar pide JSON, describe el esquema y valida la respuesta", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuestaOR("```json\n" + JSON.stringify(DIAGNOSTICO_EJEMPLO) + "\n```"));
    vi.stubGlobal("fetch", fetchMock);
    const d = await analizar([{ rol: "user", texto: "Soy coordinadora de compras" }]);
    expect(d.oportunidades).toHaveLength(3);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[1].content).toContain("JSON Schema");
  });

  it("analizar pide sin response_format si el modelo elegido no lo acepta", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(respuestaOR("", 404, { code: 404, message: "No endpoints found that support response_format" }))
      .mockResolvedValueOnce(respuestaOR(JSON.stringify(DIAGNOSTICO_EJEMPLO)));
    vi.stubGlobal("fetch", fetchMock);
    await analizar([{ rol: "user", texto: "x" }]);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).response_format).toBeUndefined();
  });
});

describe("OpenRouter como respaldo de Gemini", () => {
  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", "clave-gemini");
    vi.stubEnv("OPENROUTER_API_KEY", "clave-openrouter");
    vi.stubEnv("MOCK_AI", "");
    vi.stubEnv("GEMINI_ESPERA_REINTENTO_MS", "0");
    reiniciarFormatoAnalisis();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  const esOpenRouter = (llamada) => llamada[0].startsWith("https://openrouter.ai");

  it("si Gemini responde, OpenRouter no se usa", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuesta("¿Cuál es tu cargo?"));
    vi.stubGlobal("fetch", fetchMock);
    expect((await conversar([{ rol: "user", texto: "Hola" }])).texto).toBe("¿Cuál es tu cargo?");
    expect(fetchMock.mock.calls.some(esOpenRouter)).toBe(false);
  });

  it("la entrevista pasa a OpenRouter cuando todos los modelos de Gemini están saturados", async () => {
    const fetchMock = vi.fn((url) => Promise.resolve(url.startsWith("https://openrouter.ai") ? respuestaOR("Sigamos con tu diagnóstico") : respuesta("", 503)));
    vi.stubGlobal("fetch", fetchMock);
    expect((await conversar([{ rol: "user", texto: "Hola" }])).texto).toBe("Sigamos con tu diagnóstico");
    expect(fetchMock.mock.calls.filter((c) => !esOpenRouter(c)).length).toBe(4); // la cadena completa de Gemini
    expect(fetchMock.mock.calls.filter(esOpenRouter).length).toBe(1);
  });

  it("un error de Gemini que no es de saturación (403) no pasa al respaldo", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuesta("", 403));
    vi.stubGlobal("fetch", fetchMock);
    await expect(conversar([{ rol: "user", texto: "Hola" }])).rejects.toMatchObject({ status: 403 });
    expect(fetchMock.mock.calls.some(esOpenRouter)).toBe(false);
  });

  it("el análisis pasa a OpenRouter (con el esquema en el prompt) cuando Gemini no responde", async () => {
    const fetchMock = vi.fn((url) =>
      Promise.resolve(url.startsWith("https://openrouter.ai") ? respuestaOR(JSON.stringify(DIAGNOSTICO_EJEMPLO)) : respuesta("", 429)),
    );
    vi.stubGlobal("fetch", fetchMock);
    const d = await analizar([{ rol: "user", texto: "x" }]);
    expect(d.oportunidades).toHaveLength(3);
    const llamadaOR = fetchMock.mock.calls.find(esOpenRouter);
    expect(JSON.parse(llamadaOR[1].body).messages[1].content).toContain("JSON Schema");
  });
});
