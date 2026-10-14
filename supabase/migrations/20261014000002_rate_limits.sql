-- KCRM-73 Shared rate limiter for Copilot and the REST API.
--
-- Fixed-window counters keyed by (bucket, window_start), so limits hold across server
-- instances. Written only through take_rate_limit() by the service role; no signed-in role
-- can read, write or call it (src/lib/rate-limit/supabase.ts).

create table public.rate_limits (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  archived_at timestamptz,
  bucket text not null check (length(bucket) between 1 and 200),
  window_start timestamptz not null,
  hits integer not null default 0 check (hits >= 0),
  expires_at timestamptz not null,
  unique (bucket, window_start)
);

create index rate_limits_expires_at_idx on public.rate_limits (expires_at);

alter table public.rate_limits enable row level security;
-- No policies for authenticated: with RLS on and no grants, only the service role (bypassrls) gets in.
create policy rate_limits_active_user_only on public.rate_limits
  as restrictive for all to authenticated using (public.is_active_user()) with check (public.is_active_user());

revoke all on public.rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.rate_limits to service_role;

/**
 * Counts one request against `p_bucket` for the window containing `p_now` and returns the
 * number of hits in that window including this one. Once the window is full the counter
 * stops growing and the function returns p_limit + 1 (refused). Atomic: one upsert.
 */
create or replace function public.take_rate_limit(
  p_bucket text,
  p_limit integer,
  p_window_seconds integer,
  p_now timestamptz default now()
)
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from p_now) / p_window_seconds) * p_window_seconds);
  n integer;
begin
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'take_rate_limit: limit and window must be positive';
  end if;

  insert into public.rate_limits as r (bucket, window_start, hits, expires_at)
  values (p_bucket, w, 1, w + make_interval(secs => p_window_seconds))
  on conflict (bucket, window_start) do update
    set hits = r.hits + 1, updated_at = now()
    where r.hits < p_limit
  returning r.hits into n;

  -- Housekeeping: old windows for this bucket (cheap, uses the unique index).
  delete from public.rate_limits where bucket = p_bucket and expires_at < p_now - interval '1 hour';

  return coalesce(n, p_limit + 1);
end;
$$;

revoke execute on function public.take_rate_limit(text, integer, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.take_rate_limit(text, integer, integer, timestamptz) to service_role;
