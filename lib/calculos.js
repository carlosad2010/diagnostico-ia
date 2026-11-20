
// Factor de realización conservador (la skill recomienda 50-80 %).
export const FACTOR_REALIZACION = Number(process.env.FACTOR_REALIZACION ?? 0.6);




const redondear = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const promedio = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function cuadrante(impacto, viabilidad) {
  const altoI = impacto >= 3.5;
  const altoV = viabilidad >= 3.5;
  if (altoI && altoV) return "Ganancia rápida";
  if (altoI) return "Proyecto estratégico";
  if (altoV) return "Mejora menor";
  return "No por ahora";
}

// Conversión de la frecuencia a veces por mes (la hace el código, no el modelo).
export const DIAS_HABILES_MES = 20;
const POR_MES = { dia: DIAS_HABILES_MES, semana: 4, quincena: 2, mes: 1, trimestre: 1 / 3, anio: 1 / 12 };

export function vecesPorMes(t) {
  if (t.frecuencia) return t.frecuencia.veces * POR_MES[t.frecuencia.periodo];
  return t.veces_por_mes ?? 0; // diagnósticos guardados antes de este cambio
}

export function calcularTarea(t, costoHora, factor = FACTOR_REALIZACION) {
  const c = t.calificacion;
  const veces = vecesPorMes(t);
  const horasActual = (veces * t.minutos_por_vez * t.personas) / 60;
  const ahorroMin = Math.max(0, t.minutos_por_vez - t.minutos_despues);
  const horasLiberadas = (veces * ahorroMin * t.personas) / 60;
  const impacto = promedio([c.volumen, c.costo_errores]);
  const viabilidad = promedio([c.repetitividad, c.entrada_digital, c.reglas, c.datos, c.riesgo_invertido]);
  return {
    ...t,
    veces_por_mes: redondear(veces),
    horas_mes_actual: redondear(horasActual),
    horas_mes_liberadas: redondear(horasLiberadas),
    impacto: redondear(impacto),
    viabilidad: redondear(viabilidad),
    cuadrante: cuadrante(impacto, viabilidad),
    valor_anual: costoHora ? Math.round(horasLiberadas * 12 * costoHora * factor) : null,
  };
}

export function calcularDiagnostico(d, factor = FACTOR_REALIZACION) {
  const tareas = d.tareas.map((t) => calcularTarea(t, d.costo_hora, factor));
  const liberadas = tareas.reduce((a, t) => a + t.horas_mes_liberadas, 0);
  const totales = {
    horas_mes_actual: redondear(tareas.reduce((a, t) => a + t.horas_mes_actual, 0)),
    horas_mes_liberadas: redondear(liberadas),
    horas_mes_esperadas: redondear(liberadas * factor),
    valor_anual_esperado: d.costo_hora ? Math.round(liberadas * 12 * d.costo_hora * factor) : null,
  };
  // Las oportunidades se ordenan por cuadrante y luego por horas liberadas.
  const orden = ["Ganancia rápida", "Proyecto estratégico", "Mejora menor", "No por ahora"];
  const porId = new Map(tareas.map((t) => [t.id, t]));
  const oportunidades = [...d.oportunidades]
    .map((o) => ({ ...o, tarea: porId.get(o.tarea_id) ?? null }))
    .sort((a, b) => {
      const ca = a.tarea ? orden.indexOf(a.tarea.cuadrante) : 9;
      const cb = b.tarea ? orden.indexOf(b.tarea.cuadrante) : 9;
      return ca - cb || (b.tarea?.horas_mes_liberadas ?? 0) - (a.tarea?.horas_mes_liberadas ?? 0);
    });
  return { tareas, oportunidades, totales, factor };
}

/** Comprobaciones que el esquema no puede expresar; se devuelven al modelo para que corrija. */
export function validarCoherencia(d) {
  const errores = [];
  const ids = new Set(d.tareas.map((t) => t.id));
  if (ids.size !== d.tareas.length) errores.push("Hay ids de tareas repetidos.");
  for (const o of d.oportunidades) {
    if (!ids.has(o.tarea_id)) errores.push(`La oportunidad ${o.id} apunta a la tarea ${o.tarea_id}, que no está en el inventario.`);
  }
  const tareasConOportunidad = new Set(d.oportunidades.map((o) => o.tarea_id));
  if (tareasConOportunidad.size !== d.oportunidades.length) errores.push("Cada oportunidad debe apuntar a una tarea distinta.");
  const minimo = Math.min(3, d.tareas.length);
  if (d.oportunidades.length < minimo) {
    errores.push(`Con ${d.tareas.length} tareas en el inventario, propón al menos ${minimo} oportunidades, cada una sobre una tarea distinta (puede ser una mejora de proceso o una tarea de potencial medio).`);
  }
  for (const t of d.tareas) {
    if (t.minutos_despues > t.minutos_por_vez)
      errores.push(`En ${t.id}, minutos_despues (${t.minutos_despues}) no puede ser mayor que minutos_por_vez (${t.minutos_por_vez}).`);
  }
  if (d.costo_hora && !d.moneda.trim()) errores.push("Si hay costo_hora, indica la moneda.");
  return errores;
}

export const formatoNumero = (n, d = 0) =>
  n.toLocaleString("es-CO", { maximumFractionDigits: d, minimumFractionDigits: 0 });
