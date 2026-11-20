import { describe, expect, it } from "vitest";
import { calcularDiagnostico, cuadrante, validarCoherencia, vecesPorMes } from "../lib/calculos.js";
import { DiagnosticoSchema, esquemaGemini } from "../lib/esquema.js";
import { DIAGNOSTICO_EJEMPLO } from "../lib/ejemplo.js";

describe("cálculos del diagnóstico", () => {
  it("el ejemplo cumple el esquema y es coherente", () => {
    expect(DiagnosticoSchema.safeParse(DIAGNOSTICO_EJEMPLO).success).toBe(true);
    expect(validarCoherencia(DIAGNOSTICO_EJEMPLO)).toEqual([]);
  });
  it("horas y dinero", () => {
    const { tareas, totales } = calcularDiagnostico(DIAGNOSTICO_EJEMPLO, 0.6);
    const t1 = tareas.find((t) => t.id === "T1");
    expect(t1.horas_mes_actual).toBe(48); // 120 × 12 × 2 / 60
    expect(t1.horas_mes_liberadas).toBe(32); // 120 × 8 × 2 / 60
    expect(t1.valor_anual).toBe(5_760_000); // 32 × 12 × 25.000 × 0,6
    expect(totales).toEqual({ horas_mes_actual: 77.7, horas_mes_liberadas: 50.2, horas_mes_esperadas: 30.1, valor_anual_esperado: 9_036_000 });
  });
  it("cuadrantes con corte en 3,5", () => {
    expect(cuadrante(4, 4)).toBe("Ganancia rápida");
    expect(cuadrante(4, 2)).toBe("Proyecto estratégico");
    expect(cuadrante(2, 4)).toBe("Mejora menor");
    expect(cuadrante(2, 2)).toBe("No por ahora");
  });
  it("las ganancias rápidas van primero", () => {
    const { oportunidades } = calcularDiagnostico(DIAGNOSTICO_EJEMPLO);
    expect(oportunidades[0].tarea.cuadrante).toBe("Ganancia rápida");
  });
  it("detecta incoherencias", () => {
    const malo = structuredClone(DIAGNOSTICO_EJEMPLO);
    malo.oportunidades[0].tarea_id = "T9";
    malo.tareas[1].minutos_despues = 99;
    expect(validarCoherencia(malo)).toHaveLength(2);
  });
  it("convierte la frecuencia a veces por mes en el código", () => {
    const base = { minutos_por_vez: 6, minutos_despues: 2, personas: 1 };
    expect(vecesPorMes({ ...base, frecuencia: { veces: 40, periodo: "dia" } })).toBe(800);
    expect(vecesPorMes({ ...base, frecuencia: { veces: 1, periodo: "semana" } })).toBe(4);
    expect(vecesPorMes({ ...base, frecuencia: { veces: 2, periodo: "quincena" } })).toBe(4);
    expect(vecesPorMes({ ...base, frecuencia: { veces: 2, periodo: "anio" } })).toBeCloseTo(1 / 6);
    // Diagnósticos guardados antes del cambio traen veces_por_mes
    expect(vecesPorMes({ ...base, veces_por_mes: 120 })).toBe(120);
    const t1 = calcularDiagnostico(DIAGNOSTICO_EJEMPLO).tareas[0];
    expect(t1.veces_por_mes).toBe(120);
  });
  it("exige al menos 3 oportunidades, cada una sobre una tarea distinta", () => {
    const pocas = structuredClone(DIAGNOSTICO_EJEMPLO);
    pocas.oportunidades = pocas.oportunidades.slice(0, 2);
    expect(validarCoherencia(pocas)).toEqual([expect.stringContaining("al menos 3 oportunidades")]);
    const repetidas = structuredClone(DIAGNOSTICO_EJEMPLO);
    repetidas.oportunidades[2].tarea_id = "T1";
    expect(validarCoherencia(repetidas)).toEqual(["Cada oportunidad debe apuntar a una tarea distinta."]);
    // Con menos de 3 tareas basta una oportunidad por tarea
    const chico = structuredClone(DIAGNOSTICO_EJEMPLO);
    chico.tareas = chico.tareas.slice(0, 1);
    chico.oportunidades = chico.oportunidades.slice(0, 1);
    expect(validarCoherencia(chico)).toEqual([]);
  });
  it("sin costo hora no hay dinero", () => {
    expect(calcularDiagnostico({ ...DIAGNOSTICO_EJEMPLO, costo_hora: null }).totales.valor_anual_esperado).toBeNull();
  });
  it("el esquema para Gemini no tiene palabras clave no soportadas", () => {
    const texto = JSON.stringify(esquemaGemini());
    for (const k of ["$schema", "anyOf", "exclusiveMinimum", "minLength"]) expect(texto).not.toContain(`"${k}"`);
    expect(texto).toContain('"type":["number","null"]');
  });
});
