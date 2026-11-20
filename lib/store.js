import pg from "pg";

// =====================================================
// ALMACENAMIENTO
// PostgreSQL local (DATABASE_URL). Sin DATABASE_URL y fuera de producción usa la memoria
// del proceso (se pierde al reiniciar): solo para probar en local.
// =====================================================

function storePostgres(pool) {
  const uno = async (sql, params) => (await pool.query(sql, params)).rows[0] ?? null;
  return {
    async crearSesion(s) {
      return uno(
        `insert into sesiones (nombre, email, empresa, consentimiento, consentimiento_texto)
         values ($1, $2, $3, true, $4) returning *`,
        [s.nombre, s.email, s.empresa ?? null, s.consentimiento_texto],
      );
    },
    async obtenerSesion(id) {
      return uno("select * from sesiones where id = $1", [id]);
    },
    async sumarTurno(id, turnos) {
      await pool.query("update sesiones set turnos = $2 where id = $1", [id, turnos + 1]);
    },
    async registrarFueraDeTema(id, avisos, cerrar) {
      await pool.query(
        "update sesiones set fuera_de_tema = $2, estado = case when $3::boolean then 'cerrado' else estado end where id = $1",
        [id, avisos, cerrar],
      );
    },
    async agregarMensajes(sesionId, mensajes) {
      if (mensajes.length === 0) return;
      const params = [sesionId];
      const filas = mensajes.map((m, i) => {
        params.push(m.rol, m.texto);
        return `($1, $${i * 2 + 2}, $${i * 2 + 3})`;
      });
      await pool.query(`insert into mensajes (sesion_id, rol, texto) values ${filas.join(", ")}`, params);
    },
    async obtenerMensajes(sesionId) {
      return (await pool.query("select rol, texto, creado from mensajes where sesion_id = $1 order by id", [sesionId])).rows;
    },
    async guardarDiagnostico(sesionId, datos, resumen) {
      const cliente = await pool.connect();
      try {
        await cliente.query("begin");
        const { rows } = await cliente.query(
          `insert into diagnosticos (sesion_id, datos, cargo, industria, horas_mes_liberadas, valor_anual_esperado)
           values ($1, $2, $3, $4, $5, $6) returning id`,
          [sesionId, JSON.stringify(datos), resumen.cargo, resumen.industria, resumen.horas_mes_liberadas, resumen.valor_anual_esperado],
        );
        await cliente.query("update sesiones set estado = 'completado', diagnostico_id = $2 where id = $1", [sesionId, rows[0].id]);
        await cliente.query("commit");
        return rows[0].id;
      } catch (e) {
        await cliente.query("rollback").catch(() => {});
        throw e;
      } finally {
        cliente.release();
      }
    },
    async obtenerDiagnostico(id) {
      const d = await uno(
        `select d.id, d.creado, d.datos, s.nombre, s.empresa
         from diagnosticos d join sesiones s on s.id = d.sesion_id where d.id = $1`,
        [id],
      );
      return d ? { id: d.id, creado: d.creado, datos: d.datos, sesion: { nombre: d.nombre, empresa: d.empresa } } : null;
    },
  };
}

function storeMemoria() {
  globalThis.__memoriaDiagnostico ??= { sesiones: new Map(), mensajes: new Map(), diagnosticos: new Map() };
  const m = globalThis.__memoriaDiagnostico;
  const ahora = () => new Date().toISOString();
  return {
    async crearSesion(s) {
      const sesion = { id: crypto.randomUUID(), creado: ahora(), nombre: s.nombre, email: s.email, empresa: s.empresa, estado: "en_curso", turnos: 0, fuera_de_tema: 0, diagnostico_id: null };
      m.sesiones.set(sesion.id, sesion);
      return { ...sesion };
    },
    async obtenerSesion(id) {
      const s = m.sesiones.get(id);
      return s ? { ...s } : null;
    },
    async sumarTurno(id) {
      const s = m.sesiones.get(id);
      if (s) s.turnos += 1;
    },
    async registrarFueraDeTema(id, avisos, cerrar) {
      const s = m.sesiones.get(id);
      if (!s) return;
      s.fuera_de_tema = avisos;
      if (cerrar) s.estado = "cerrado";
    },
    async agregarMensajes(id, mensajes) {
      const lista = m.mensajes.get(id) ?? [];
      lista.push(...mensajes.map((x) => ({ rol: x.rol, texto: x.texto, creado: ahora() })));
      m.mensajes.set(id, lista);
    },
    async obtenerMensajes(id) {
      return structuredClone(m.mensajes.get(id) ?? []);
    },
    async guardarDiagnostico(sesionId, datos) {
      const s = m.sesiones.get(sesionId);
      const id = crypto.randomUUID();
      m.diagnosticos.set(id, { id, creado: ahora(), datos, sesion: { nombre: s.nombre, empresa: s.empresa } });
      s.estado = "completado";
      s.diagnostico_id = id;
      return id;
    },
    async obtenerDiagnostico(id) {
      return structuredClone(m.diagnosticos.get(id) ?? null);
    },
  };
}

let instancia = null;

export function store() {
  if (instancia) return instancia;
  const url = process.env.DATABASE_URL;
  if (url && process.env.ALMACEN !== "memoria") {
    instancia = storePostgres(new pg.Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10000 }));
  } else if (process.env.VERCEL_ENV !== "production" || process.env.ALMACEN === "memoria") {
    console.warn("[diagnóstico] Sin DATABASE_URL: se usa la memoria del proceso (solo para pruebas).");
    instancia = storeMemoria();
  } else {
    throw new Error("Falta DATABASE_URL");
  }
  return instancia;
}

// Solo para los tests
export function reiniciarStore() {
  instancia = null;
  globalThis.__memoriaDiagnostico = undefined;
}
