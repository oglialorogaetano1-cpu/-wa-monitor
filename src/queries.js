// Funzioni di lettura condivise tra bot Telegram e recap.
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Cerca messaggi per periodo, mittente/chat, testo e priorità, su uno o
// entrambi i numeri WhatsApp (personale/lavoro).
async function searchMessages({ from, to, contact, text, priority, wa_account, limit = 50 }) {
  let query = supabase
    .from('messages')
    .select('wa_account, chat_name, sender_name, body, direction, priority, wa_timestamp')
    .order('wa_timestamp', { ascending: false })
    .limit(limit);

  if (from) query = query.gte('wa_timestamp', from);
  if (to) query = query.lte('wa_timestamp', to);
  if (contact) query = query.or(`chat_name.ilike.%${contact}%,sender_name.ilike.%${contact}%`);
  if (text) query = query.ilike('body', `%${text}%`);
  if (priority) query = query.eq('priority', priority);
  if (wa_account) query = query.eq('wa_account', wa_account);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

// Conta i messaggi nel periodo, raggruppati per mittente/chat.
async function countTraffic({ from, to, wa_account }) {
  let query = supabase
    .from('messages')
    .select('wa_account, chat_name, sender_name, direction, wa_timestamp')
    .order('wa_timestamp', { ascending: false })
    .limit(2000);

  if (from) query = query.gte('wa_timestamp', from);
  if (to) query = query.lte('wa_timestamp', to);
  if (wa_account) query = query.eq('wa_account', wa_account);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const counts = {};
  for (const row of data) {
    const key = row.chat_name || row.sender_name || 'sconosciuto';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([who, count]) => ({ who, count }));
}

// Crea un promemoria/scadenza/pagamento/viaggio.
async function addReminder({
  title, notes, due_at, priority = 'normale', source = 'telegram',
  category = 'generico', counterpart, amount,
}) {
  const { data, error } = await supabase
    .from('reminders')
    .insert({ title, notes, due_at, priority, source, category, counterpart, amount })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// Elenca i promemoria, per stato, categoria e periodo di scadenza.
async function listReminders({ status = 'pending', category, from, to, limit = 50 } = {}) {
  let query = supabase
    .from('reminders')
    .select('id, title, notes, due_at, priority, status, category, counterpart, amount, created_at')
    .order('due_at', { ascending: true, nullsFirst: false })
    .limit(limit);

  if (status) query = query.eq('status', status);
  if (category) query = query.eq('category', category);
  if (from) query = query.gte('due_at', from);
  if (to) query = query.lte('due_at', to);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

// Segna un promemoria come completato, cercandolo per id o per titolo simile.
async function completeReminder({ id, title }) {
  let query = supabase.from('reminders').update({
    status: 'done',
    completed_at: new Date().toISOString(),
  });

  if (id) {
    query = query.eq('id', id);
  } else if (title) {
    query = query.ilike('title', `%${title}%`).eq('status', 'pending');
  } else {
    throw new Error('Serve id o title per completare un promemoria.');
  }

  const { data, error } = await query.select();
  if (error) throw new Error(error.message);
  return data;
}

// --- Pratiche legali (ricorsi, contestazioni, PEC avvocato) ---

async function addLegalMatter({ title, tipo = 'altro', controparte, riferimento, scadenza, notes }) {
  const { data, error } = await supabase
    .from('legal_matters')
    .insert({ title, tipo, controparte, riferimento, scadenza, notes })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function listLegalMatters({ stato = 'aperta', limit = 50 } = {}) {
  let query = supabase
    .from('legal_matters')
    .select('id, title, tipo, controparte, riferimento, scadenza, stato, notes, updated_at')
    .order('scadenza', { ascending: true, nullsFirst: false })
    .limit(limit);
  if (stato) query = query.eq('stato', stato);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

async function updateLegalMatter({ id, stato, notes, scadenza }) {
  const patch = { updated_at: new Date().toISOString() };
  if (stato) patch.stato = stato;
  if (notes !== undefined) patch.notes = notes;
  if (scadenza !== undefined) patch.scadenza = scadenza;
  const { data, error } = await supabase.from('legal_matters').update(patch).eq('id', id).select();
  if (error) throw new Error(error.message);
  return data;
}

// --- Azioni proposte dal bot: email in bozza, mai inviate senza conferma ---

async function createDraftEmail({ to, subject, body, context }) {
  const { data, error } = await supabase
    .from('pending_actions')
    .insert({ type: 'email', status: 'draft', payload: { to, subject, body }, context })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function listPendingActions({ status = 'draft', limit = 20 } = {}) {
  const { data, error } = await supabase
    .from('pending_actions')
    .select('id, type, status, payload, context, created_at')
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data;
}

async function markActionRejected(id) {
  const { data, error } = await supabase.from('pending_actions').update({ status: 'rejected' }).eq('id', id).select();
  if (error) throw new Error(error.message);
  return data;
}

module.exports = {
  searchMessages,
  countTraffic,
  addReminder,
  listReminders,
  completeReminder,
  addLegalMatter,
  listLegalMatters,
  updateLegalMatter,
  createDraftEmail,
  listPendingActions,
  markActionRejected,
  supabase,
};
