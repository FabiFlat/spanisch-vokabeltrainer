-- Einmalig im Supabase SQL Editor ausführen.
create table if not exists public.user_unlocks (
    user_id uuid primary key references auth.users(id) on delete cascade,
    beta_tester boolean not null default false,
    all_designs boolean not null default false,
    updated_at timestamptz not null default now()
);

alter table public.user_unlocks enable row level security;

drop policy if exists "Users can read their own unlocks" on public.user_unlocks;
create policy "Users can read their own unlocks"
on public.user_unlocks for select
to authenticated
using (auth.uid() = user_id);

revoke all on public.user_unlocks from anon, authenticated;
grant select on public.user_unlocks to authenticated;

create or replace function public.redeem_unlock_code(input_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
    uid uuid := auth.uid();
    normalized_code text := upper(trim(coalesce(input_code, '')));
    beta_value boolean := false;
    designs_value boolean := false;
begin
    if uid is null then
        return jsonb_build_object('success', false, 'message', 'Bitte melde dich zuerst an.');
    end if;

    if normalized_code = 'BETA-SPANISCH' then
        beta_value := true;
        designs_value := true;
    elsif normalized_code = 'DESIGN-SPANISCH' then
        designs_value := true;
    else
        return jsonb_build_object('success', false, 'message', 'Dieser Code ist ungültig.');
    end if;

    insert into public.user_unlocks (user_id, beta_tester, all_designs, updated_at)
    values (uid, beta_value, designs_value, now())
    on conflict (user_id) do update
    set beta_tester = public.user_unlocks.beta_tester or excluded.beta_tester,
        all_designs = public.user_unlocks.all_designs or excluded.all_designs,
        updated_at = now();

    return jsonb_build_object(
        'success', true,
        'message', case
            when beta_value then 'Beta-Tester-Freischaltung aktiviert! Alle Belohnungen und Designs sind freigeschaltet.'
            else 'Alle Farbdesigns wurden freigeschaltet!'
        end
    );
end;
$$;

revoke all on function public.redeem_unlock_code(text) from public;
grant execute on function public.redeem_unlock_code(text) to authenticated;
