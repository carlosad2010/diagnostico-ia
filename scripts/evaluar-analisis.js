// =====================================================
// EVALUACIÓN DEL ANÁLISIS CON CASOS REALES (usa Gemini de verdad: gasta cuota)
// Corre el análisis sobre las conversaciones de tests/fixtures y comprueba que las
// horas de cada tarea queden dentro del rango esperado.
// Uso: npm run eval:analisis            (2 corridas por caso)
//      CORRIDAS=3 GEMINI_MODEL_ANALISIS=gemini-3-flash-preview npm run eval:analisis
// =====================================================
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

delete process.env.MOCK_AI;
const { analizar, MODELO_ANALISIS, RAZONAMIENTO_ANALISIS } = await import("../lib/gemini.js");
const { calcularDiagnostico, HORAS_MES_PERSONA } = await import("../lib/calculos.js");

const CARPETA = fileURLToPath(new URL("../tests/fixtures", import.meta.url));
const CORRIDAS = Number(process.env.CORRIDAS ?? 2);
const casos = readdirSync(CARPETA).filter((f) => f.endsWith(".json"));
console.log(`Modelo de análisis: ${MODELO_ANALISIS} · razonamiento: ${RAZONAMIENTO_ANALISIS} · ${CORRIDAS} corridas por caso\n`);

let fallas = 0;
for (const archivo of casos) {
  const caso = JSON.parse(readFileSync(join(CARPETA, archivo), "utf8"));
  console.log(`== ${archivo}`);
  for (let i = 1; i <= CORRIDAS; i++) {
    const inicio = Date.now();
    let datos;
    // Si Gemini está saturado (503) o sin cuota (429), espera y reintenta hasta 4 veces
    for (let intento = 1; !datos; intento++) {
      try {
        datos = await analizar(caso.conversacion);
      } catch (e) {
        if (intento >= 4 || ![429, 503].includes(e.status)) break;
        console.log(`  Gemini ocupado (${e.status}); reintento en ${30 * intento} s…`);
        await new Promise((ok) => setTimeout(ok, 30000 * intento));
      }
    }
    if (!datos) {
      console.log(`  corrida ${i}: ERROR Gemini no respondió`);
      fallas++;
      continue;
    }
    const { tareas, oportunidades, totales } = calcularDiagnostico(datos);
    const problemas = [];
    for (const esp of caso.esperado) {
      const re = new RegExp(esp.patron, "i");
      const t = tareas.find((x) => re.test(`${x.nombre} ${x.descripcion}`));
      if (!t) {
        problemas.push(`falta la tarea /${esp.patron}/`);
        continue;
      }
      const ok = t.horas_mes_actual >= esp.horas_min && t.horas_mes_actual <= esp.horas_max;
      console.log(`  ${ok ? "✓" : "✗"} ${t.nombre}: ${t.horas_mes_actual} h/mes (esperado ${esp.horas_min}-${esp.horas_max}) ← «${t.cita}»`);
      if (!ok) problemas.push(`${t.nombre}: ${t.horas_mes_actual} h fuera de rango (${esp.nota})`);
    }
    const porPersona = tareas.reduce((a, t) => a + t.horas_mes_actual / t.personas, 0);
    if (porPersona > HORAS_MES_PERSONA * 1.25) problemas.push(`suma ${Math.round(porPersona)} h/mes por persona`);
    if (caso.costo_hora_esperado && datos.costo_hora !== caso.costo_hora_esperado) problemas.push(`costo_hora ${datos.costo_hora}`);
    if (oportunidades.length < Math.min(3, tareas.length)) problemas.push(`solo ${oportunidades.length} oportunidades`);
    const seg = Math.round((Date.now() - inicio) / 1000);
    console.log(`  corrida ${i}: ${problemas.length ? `✗ ${problemas.join("; ")}` : "✓ todo en rango"} · ${tareas.length} tareas, ${oportunidades.length} oportunidades, ${totales.horas_mes_actual} h/mes, ${seg} s\n`);
    if (problemas.length) fallas++;
  }
}
console.log(fallas ? `${fallas} corrida(s) con problemas` : "Todas las corridas en rango");
process.exit(fallas ? 1 : 0);
