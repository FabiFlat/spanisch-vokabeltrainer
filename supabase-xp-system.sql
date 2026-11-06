-- XP-System: einmalig im Supabase SQL Editor ausführen.
-- Ergänzt den bestehenden vocab_data-Datensatz um dauerhaft gespeicherte XP-Werte.

alter table public.vocab_data
    add column if not exists xp integer not null default 0,
    add column if not exists flashcards_learned integer not null default 0,
    add column if not exists sessions_completed integer not null default 0;

-- Negative Werte verhindern.
alter table public.vocab_data
    drop constraint if exists vocab_data_xp_nonnegative,
    add constraint vocab_data_xp_nonnegative check (xp >= 0),
    drop constraint if exists vocab_data_flashcards_nonnegative,
    add constraint vocab_data_flashcards_nonnegative check (flashcards_learned >= 0),
    drop constraint if exists vocab_data_sessions_nonnegative,
    add constraint vocab_data_sessions_nonnegative check (sessions_completed >= 0);
