-- Migración 01 · Cierre por mensajes fuera de tema
-- Para bases creadas con una versión anterior de schema.sql (local y Neon).
-- Es idempotente: se puede ejecutar más de una vez sin problema.
--   Local: psql -U postgres -d diagnostico_ia -f database/migracion-01-fuera-de-tema.sql
--   Neon:  SQL Editor → pegar este archivo → Run

-- Avisos por mensajes fuera de tema; al tercero la sesión se cierra sin diagnóstico
alter table public.sesiones add column if not exists fuera_de_tema integer not null default 0;

-- Nuevo estado 'cerrado' (terminó sin diagnóstico)
alter table public.sesiones drop constraint if exists sesiones_estado_check;
alter table public.sesiones add constraint sesiones_estado_check
  check (estado in ('en_curso', 'completado', 'cerrado'));

-- La vista de contactos muestra también los avisos
create or replace view public.vista_leads with (security_invoker = true) as
select s.creado, s.nombre, s.email, s.empresa, s.estado, s.turnos,
       d.cargo, d.industria, d.horas_mes_liberadas, d.valor_anual_esperado, d.id as diagnostico_id,
       s.fuera_de_tema
from public.sesiones s
left join public.diagnosticos d on d.id = s.diagnostico_id
order by s.creado desc;
