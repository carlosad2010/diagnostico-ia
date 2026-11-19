import { describe, expect, it } from "vitest";
import { TEXTO_CONSENTIMIENTO as textoFront, formatTime, getMessageMeta, isValidMessage, parsearTexto, textoPlano } from "../src/utils.js";
import { TEXTO_CONSENTIMIENTO as textoServidor } from "../lib/servicio.js";

describe("utils del navegador", () => {
  it("el texto de consentimiento del navegador y del servidor es el mismo", () => {
    expect(textoFront).toBe(textoServidor);
  });
  it("getMessageMeta distingue persona y consultor", () => {
    expect(getMessageMeta("user")).toEqual({ roleClass: "message--user", author: "Tú" });
    expect(getMessageMeta("assistant").roleClass).toBe("message--consultor");
  });
  it("isValidMessage rechaza vacíos", () => {
    expect(isValidMessage("   ")).toBe(false);
    expect(isValidMessage("hola")).toBe(true);
    expect(isValidMessage(null)).toBe(false);
  });
  it("formatTime devuelve una hora corta", () => {
    expect(formatTime(new Date(2026, 10, 19, 15, 5).getTime())).toMatch(/3:05/);
  });
  it("parsearTexto arma párrafos, listas y negritas", () => {
    const b = parsearTexto("Hola **Laura**.\n\n1. Cargo\n2. Empresa\n- Correo\n- Excel");
    expect(b.map((x) => x.tipo)).toEqual(["p", "ol", "ul"]);
    expect(b[0].segmentos).toEqual([{ texto: "Hola ", negrita: false }, { texto: "Laura", negrita: true }, { texto: ".", negrita: false }]);
    expect(b[1].items).toHaveLength(2);
  });
  it("parsearTexto no interpreta HTML: queda como texto", () => {
    const b = parsearTexto("<img src=x onerror=alert(1)>");
    expect(b[0].segmentos[0].texto).toBe("<img src=x onerror=alert(1)>");
  });
  it("textoPlano quita las negritas para copiar", () => {
    expect(textoPlano("Primera acción: **plantilla única**")).toBe("Primera acción: plantilla única");
  });
});
