import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// =====================================================
// PANEL ADMINISTRATIVO (solo para el dueño del software)
// Acceso con ADMIN_PASSWORD y una cookie firmada (HttpOnly) que dura 8 horas.
// La lógica de filtros, indicadores y CSV es pura: la usan Postgres y la memoria por igual.
// =====================================================

export const COOKIE = "sia_admin";
const DURACION_S = 8 * 60 * 60;
const HORAS_ABANDONO = 24; // una sesión en curso sin actividad en 24 h cuenta como sin terminar

export const ESTADOS = {
  completado: "Diagnóstico entregado",
  en_curso: "En curso",
  abandonado: "Sin terminar",
  cerrado: "Cerrada por fuera de tema",
};

// ---------- Acceso ----------
const clave = () => process.env.ADMIN_PASSWORD ?? "";
export const adminConfigurado = () => clave().length >= 8;
const resumen = (s) => createHash("sha256").update(String(s)).digest();
const firmar = (texto) => createHmac("sha256", `studio-ia-admin:${clave()}`).update(texto).digest("hex");

/** Compara la contraseña en tiempo constante. */
export function claveCorrecta(intento) {
  if (!adminConfigurado() || typeof intento !== "string") return false;
  return timingSafeEqual(resumen(intento), resumen(clave()));
}

export function cookieDeSesion(ahora = Date.now()) {
  const vence = Math.floor(ahora / 1000) + DURACION_S;
  const valor = `${vence}.${firmar(String(vence))}`;
  return `${COOKIE}=${valor}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${DURACION_S}`;
}
export const cookieDeSalida = () => `${COOKIE}=; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

/** ¿La petición trae una cookie de administrador válida y vigente? */
export function sesionValida(cabeceraCookie, ahora = Date.now()) {
  if (!adminConfigurado()) return false;
  const valor = String(cabeceraCookie ?? "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!valor) return false;
  const [vence, firma] = valor.split(".");
  if (!vence || !firma || Number(vence) * 1000 < ahora) return false;
  const esperada = firmar(vence);
  return firma.length === esperada.length && timingSafeEqual(Buffer.from(firma), Buffer.from(esperada));
}

// ---------- Filtros ----------
const DIA = 24 * 60 * 60 * 1000;

/** Estado para el panel: una sesión en curso sin actividad reciente cuenta como "sin terminar". */
export function estadoPanel(fila, ahora = Date.now()) {
  if (fila.estado !== "en_curso") return fila.estado;
  const ultima = new Date(fila.ultima_actividad ?? fila.creado).getTime();
  return ahora - ultima > HORAS_ABANDONO * 60 * 60 * 1000 ? "abandonado" : "en_curso";
}

const sinTildes = (s) => String(s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export function leerFiltros(q = {}) {
  const fecha = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v ?? "") ? v : null);
  return {
    texto: String(q.q ?? "").trim().slice(0, 100),
    estado: Object.hasOwn(ESTADOS, q.estado) ? q.estado : "",
    desde: fecha(q.desde),
    hasta: fecha(q.hasta),
    pagina: Math.max(1, Math.min(10_000, Number.parseInt(q.pagina, 10) || 1)),
  };
}

export function filtrar(filas, f, ahora = Date.now()) {
  const texto = sinTildes(f.texto);
  const desde = f.desde ? new Date(`${f.desde}T00:00:00`).getTime() : null;
  const hasta = f.hasta ? new Date(`${f.hasta}T00:00:00`).getTime() + DIA : null;
  return filas
    .map((x) => ({ ...x, estado_panel: estadoPanel(x, ahora) }))
    .filter((x) => {
      const t = new Date(x.creado).getTime();
      if (desde !== null && t < desde) return false;
      if (hasta !== null && t >= hasta) return false;
      if (f.estado && x.estado_panel !== f.estado) return false;
      if (texto && !sinTildes([x.nombre, x.email, x.empresa, x.cargo, x.industria].join(" ")).includes(texto)) return false;
      return true;
    });
}

// ---------- Indicadores ----------
export function indicadores(filas) {
  const cuenta = (e) => filas.filter((x) => x.estado_panel === e).length;
  const suma = (k) => filas.reduce((a, x) => a + (Number(x[k]) || 0), 0);
  const completados = cuenta("completado");
  const conDiagnostico = filas.filter((x) => x.diagnostico_id);
  return {
    personas: filas.length,
    completados,
    tasa_finalizacion: filas.length ? completados / filas.length : 0,
    en_curso: cuenta("en_curso"),
    sin_terminar: cuenta("abandonado"),
    cerradas: cuenta("cerrado"),
    horas_mes: suma("horas_mes_liberadas"),
    horas_mes_promedio: conDiagnostico.length ? suma("horas_mes_liberadas") / conDiagnostico.length : 0,
    valor_anual: suma("valor_anual_esperado"),
    respuestas_promedio: filas.length ? suma("turnos") / filas.length : 0,
  };
}

/** Diagnósticos iniciados y entregados por semana (lunes), las últimas `n` semanas hasta `fin`. */
export function porSemana(filas, fin = Date.now(), n = 12) {
  const lunes = (t) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.getTime();
  };
  const ultima = lunes(fin);
  const semanas = Array.from({ length: n }, (_, i) => ({ inicio: new Date(ultima - (n - 1 - i) * 7 * DIA).toISOString(), iniciados: 0, entregados: 0 }));
  const indice = new Map(semanas.map((s, i) => [new Date(s.inicio).getTime(), i]));
  for (const x of filas) {
    const i = indice.get(lunes(new Date(x.creado).getTime()));
    if (i === undefined) continue;
    semanas[i].iniciados++;
    if (x.estado_panel === "completado") semanas[i].entregados++;
  }
  return semanas;
}

export function industrias(filas, n = 5) {
  const cuenta = new Map();
  for (const x of filas) {
    if (!x.industria) continue;
    const k = x.industria.trim();
    cuenta.set(k, (cuenta.get(k) ?? 0) + 1);
  }
  return [...cuenta].map(([nombre, total]) => ({ nombre, total })).sort((a, b) => b.total - a.total).slice(0, n);
}

/** Fila para la tabla del panel (sin campos internos). */
export const filaPublica = (x) => ({
  id: x.id,
  creado: x.creado,
  nombre: x.nombre,
  email: x.email,
  empresa: x.empresa,
  cargo: x.cargo,
  industria: x.industria,
  estado: x.estado_panel,
  turnos: x.turnos,
  fuera_de_tema: x.fuera_de_tema ?? 0,
  horas_mes_liberadas: x.horas_mes_liberadas === null || x.horas_mes_liberadas === undefined ? null : Number(x.horas_mes_liberadas),
  valor_anual_esperado: x.valor_anual_esperado === null || x.valor_anual_esperado === undefined ? null : Number(x.valor_anual_esperado),
  moneda: x.moneda ?? null,
  diagnostico_id: x.diagnostico_id,
});

// ---------- CSV (para Excel en español: separador ";" y coma decimal) ----------
function celda(v) {
  if (v === null || v === undefined) return "";
  let s = typeof v === "number" ? v.toLocaleString("es-CO", { useGrouping: false, maximumFractionDigits: 1 }) : String(v);
  // Evita que Excel interprete como fórmula un texto escrito por la persona
  if (typeof v !== "number" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csv(filas, base) {
  const fecha = (d) => new Date(d).toLocaleString("sv-SE", { timeZone: "America/Bogota" }).slice(0, 16);
  const columnas = [
    ["Fecha", (x) => fecha(x.creado)],
    ["Nombre", (x) => x.nombre],
    ["Correo", (x) => x.email],
    ["Empresa", (x) => x.empresa],
    ["Cargo", (x) => x.cargo],
    ["Industria", (x) => x.industria],
    ["Estado", (x) => ESTADOS[x.estado] ?? x.estado],
    ["Respuestas", (x) => x.turnos],
    ["Avisos fuera de tema", (x) => x.fuera_de_tema],
    ["Horas al mes liberables", (x) => x.horas_mes_liberadas],
    ["Ahorro anual estimado", (x) => x.valor_anual_esperado],
    ["Moneda", (x) => x.moneda],
    ["Informe", (x) => (x.diagnostico_id ? `${base}/diagnostico/${x.diagnostico_id}` : "")],
  ];
  const lineas = [columnas.map(([t]) => t).join(";"), ...filas.map((x) => columnas.map(([, f]) => celda(f(x))).join(";"))];
  return `﻿${lineas.join("\r\n")}\r\n`; // BOM para que Excel lea las tildes
}
