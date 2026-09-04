// wa-monitor / recap
// Script pensato per girare su uno schedule Railway (es. ogni mattina).
// Prende i messaggi delle ultime 24 ore, chiede a Claude un riassunto
// sintetico con le priorità, lo salva e lo manda su Telegram.

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk').default;
const { supabase, listReminders, listLegalMatters, listPendingActions } = require('./queries');

const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  ANTHROPIC_API_KEY,
} = process.env;

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

async function main() {
  const to = new Date();
  const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);

  const { data: messages, error } = await supabase
    .from('messages')
    .select('wa_account, chat_name, sender_name, body, direction, wa_timestamp')
    .gte('wa_timestamp', from.toISOString())
    .lte('wa_timestamp', to.toISOString())
    .order('wa_timestamp', { ascending: true })
    .limit(1000);

  if (error) throw new Error(error.message);

  // Scadenze già passate (non completate) e quelle dei prossimi 2 giorni,
  // le pratiche legali con scadenza vicina, e le bozze email ancora in
  // attesa di conferma: così il recap apre con l'agenda completa anche se
  // ieri non è arrivato nessun messaggio.
  const orizzonte = new Date(to.getTime() + 2 * 24 * 60 * 60 * 1000);
  const [scadenze, pratiche, bozze] = await Promise.all([
    listReminders({ status: 'pending', to: orizzonte.toISOString() }),
    listLegalMatters({ stato: 'aperta' }),
    listPendingActions({ status: 'draft' }),
  ]);
  const pratichePresto = pratiche.filter((p) => p.scadenza && new Date(p.scadenza) <= orizzonte);

  if ((!messages || messages.length === 0) && scadenze.length === 0 && pratichePresto.length === 0 && bozze.length === 0) {
    console.log('Niente da segnalare, recap non inviato.');
    return;
  }

  const trascrizione = (messages || [])
    .map((m) => `[${m.wa_timestamp}] (${m.wa_account}) ${m.chat_name || m.sender_name}: ${m.body || ''}`)
    .join('\n') || '(nessun messaggio WhatsApp nelle ultime 24 ore)';

  const elencoScadenze = scadenze.length
    ? scadenze
        .map((r) => `- [${r.category}] ${r.title}${r.counterpart ? ` (${r.counterpart})` : ''}${r.due_at ? ` — scade: ${r.due_at}` : ''} [priorità: ${r.priority}]`)
        .join('\n')
    : '(nessuna scadenza pendente nei prossimi giorni)';

  const elencoLegale = pratichePresto.length
    ? pratichePresto.map((p) => `- ${p.title} (${p.tipo}${p.controparte ? `, ${p.controparte}` : ''}) — scade: ${p.scadenza}`).join('\n')
    : '(nessuna pratica legale con scadenza vicina)';

  const elencoBozze = bozze.length
    ? bozze.map((b) => `- a ${b.payload.to}, oggetto "${b.payload.subject}", in attesa dal ${b.created_at}`).join('\n')
    : '(nessuna bozza email in attesa)';

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1200,
    system:
      'Scrivi in italiano, prosa naturale senza elenchi puntati né titoli, come un ' +
      'assistente personale che fa il punto della situazione a voce a Gaetano. ' +
      'Apri con le scadenze e le pratiche legali imminenti o scadute, se ce ne sono, poi le ' +
      'bozze email ancora da approvare, poi i messaggi WhatsApp (specifica se personale o lavoro ' +
      'solo quando è rilevante). Evidenzia cosa richiede una risposta, cosa è urgente e cosa è ' +
      'solo informativo.',
    messages: [
      {
        role: 'user',
        content: `Scadenze pendenti (oggi e prossimi 2 giorni):\n${elencoScadenze}\n\nPratiche legali con scadenza vicina:\n${elencoLegale}\n\nBozze email in attesa di conferma:\n${elencoBozze}\n\nMessaggi WhatsApp delle ultime 24 ore:\n${trascrizione}\n\nFammi un recap breve e utile.`,
      },
    ],
  });

  const summary = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  await supabase.from('recaps').insert({
    period_start: from.toISOString(),
    period_end: to.toISOString(),
    summary,
  });

  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: summary,
    }),
  });

  console.log('Recap inviato.');
}

main().catch((err) => {
  console.error('Errore recap:', err);
  process.exit(1);
});
