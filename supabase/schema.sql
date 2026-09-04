-- wa-monitor schema
-- Esegui questo file nell'SQL editor di Supabase (progetto dedicato a wa-monitor)

create table if not exists messages (
  id bigserial primary key,
  wa_account text not null default 'personale', -- 'personale' o 'lavoro': quale dei due numeri WhatsApp
  wa_message_id text,
  chat_id text not null,
  chat_name text,
  is_group boolean not null default false,
  sender_name text,
  sender_number text,
  direction text not null default 'in', -- 'in' = ricevuto, 'out' = inviato da te (per contesto, mai generato dal bot)
  body text,
  message_type text default 'text', -- text, image, audio, video, document, other
  priority text, -- assegnata dal recap/bot: 'alta', 'normale', 'bassa'
  wa_timestamp timestamptz not null,
  created_at timestamptz not null default now(),
  unique (wa_account, wa_message_id)
);

create index if not exists idx_messages_wa_timestamp on messages (wa_timestamp desc);
create index if not exists idx_messages_chat_id on messages (chat_id);
create index if not exists idx_messages_sender_name on messages (sender_name);
create index if not exists idx_messages_wa_account on messages (wa_account);

-- log dei recap mattutini generati, utile per non duplicare invii
create table if not exists recaps (
  id bigserial primary key,
  period_start timestamptz not null,
  period_end timestamptz not null,
  summary text not null,
  sent_at timestamptz not null default now()
);

-- promemoria e scadenze: agenda personale, alimentata dal bot Telegram
-- e consultabile/gestibile anche dalla pagina web dell'agenda.
create table if not exists reminders (
  id bigserial primary key,
  title text not null,
  notes text,
  due_at timestamptz,
  priority text default 'normale', -- 'alta', 'normale', 'bassa'
  status text not null default 'pending', -- 'pending', 'done'
  source text default 'telegram', -- 'telegram', 'web', 'manual'
  category text not null default 'generico', -- 'generico', 'pagamento', 'viaggio', 'legale'
  counterpart text, -- a chi si riferisce: es. "muratore Franco", "avvocato Rossi"
  amount numeric, -- importo, solo per i pagamenti, opzionale
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_reminders_due_at on reminders (due_at);
create index if not exists idx_reminders_status on reminders (status);
create index if not exists idx_reminders_category on reminders (category);

-- pratiche legali e amministrative: ricorsi, contestazioni, PEC avvocato.
-- Restano visibili solo al bot (mai alla pagina web, sono più delicate).
create table if not exists legal_matters (
  id bigserial primary key,
  title text not null,
  tipo text not null default 'altro', -- 'ricorso', 'contestazione', 'pec_avvocato', 'altro'
  controparte text, -- chi è dall'altra parte: es. "Agenzia Entrate", "Avv. Bianchi"
  riferimento text, -- numero pratica/protocollo, se c'è
  scadenza timestamptz,
  stato text not null default 'aperta', -- 'aperta', 'in_corso', 'chiusa'
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_legal_scadenza on legal_matters (scadenza);
create index if not exists idx_legal_stato on legal_matters (stato);
alter table legal_matters enable row level security; -- nessuna policy anon: solo la service key del bot

-- azioni proposte dal bot (email da mandare, solleciti, ecc.): il bot le
-- prepara sempre come bozza, non manda mai nulla senza conferma esplicita.
create table if not exists pending_actions (
  id bigserial primary key,
  type text not null default 'email', -- per ora 'email'; in futuro altri tipi
  status text not null default 'draft', -- 'draft', 'approved', 'sent', 'rejected'
  payload jsonb not null, -- { to, subject, body } per le email
  context text, -- perché il bot propone questa azione
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists idx_pending_actions_status on pending_actions (status);
alter table pending_actions enable row level security; -- nessuna policy anon: solo la service key del bot

-- La pagina web dell'agenda si collega con la chiave pubblica (anon), non
-- con la service key. Il bot e il listener usano sempre la service key,
-- che aggira comunque la RLS: le policy qui sotto servono solo alla pagina.
alter table reminders enable row level security;

drop policy if exists "agenda web: lettura" on reminders;
create policy "agenda web: lettura" on reminders
  for select using (true);

drop policy if exists "agenda web: inserimento" on reminders;
create policy "agenda web: inserimento" on reminders
  for insert with check (true);

drop policy if exists "agenda web: aggiornamento" on reminders;
create policy "agenda web: aggiornamento" on reminders
  for update using (true);

drop policy if exists "agenda web: cancellazione" on reminders;
create policy "agenda web: cancellazione" on reminders
  for delete using (true);

-- Le altre tabelle restano chiuse alla chiave pubblica: RLS attiva e
-- nessuna policy per anon, quindi solo la service key (bot/listener/recap)
-- può leggerle o scriverle.
alter table messages enable row level security;
alter table recaps enable row level security;
