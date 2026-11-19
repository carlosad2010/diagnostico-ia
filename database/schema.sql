-- Diagnóstico IA · Studio-IA
-- PostgreSQL local. Ejecuta este script una vez:
--   createdb -U postgres diagnostico_ia
--   psql -U postgres -d diagnostico_ia -f database/schema.sql
-- Las tablas tienen RLS activo y SIN políticas: solo el dueño de las tablas (el rol del servidor) puede leer y escribir.

create extension if not exists pgcrypto;

create table if not exists public.sesiones (
  id uuid primary key default gen_random_uuid(),
  creado timestamptz not null default now(),
  nombre text not null,
  email text not null,
  empresa text,
  consentimiento boolean not null,
  consentimiento_texto text not null,
  estado text not null default 'en_curso' check (estado in ('en_curso', 'completado')),
  turnos integer not null default 0,
  diagnostico_id uuid
);

create table if not exists public.mensajes (
  id bigint generated always as identity primary key,
  sesion_id uuid not null references public.sesiones(id) on delete cascade,
  creado timestamptz not null default now(),
  rol text not null check (rol in ('user', 'assistant')),
  texto text not null
);
create index if not exists mensajes_sesion_idx on public.mensajes (sesion_id, id);

create table if not exists public.diagnosticos (
  id uuid primary key default gen_random_uuid(),
  sesion_id uuid not null references public.sesiones(id) on delete cascade,
  creado timestamptz not null default now(),
  datos jsonb not null,
  cargo text,
  industria text,
  horas_mes_liberadas numeric,
  valor_anual_esperado numeric
);

alter table public.sesiones enable row level security;
alter table public.mensajes enable row level security;
alter table public.diagnosticos enable row level security;

-- Vista para revisar los contactos (select * from vista_leads).
create or replace view public.vista_leads with (security_invoker = true) as
select s.creado, s.nombre, s.email, s.empresa, s.estado, s.turnos,
       d.cargo, d.industria, d.horas_mes_liberadas, d.valor_anual_esperado, d.id as diagnostico_id
from public.sesiones s
left join public.diagnosticos d on d.id = s.diagnostico_id
order by s.creado desc;
