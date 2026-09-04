// wa-monitor / bot Telegram
// Gaetano dialoga qui in linguaggio naturale. Il bot usa Claude con due
// strumenti veri (ricerca messaggi, conteggio traffico) per rispondere
// leggendo quello che il listener ha raccolto. Oggi il bot NON può compiere
// azioni (mandare mail, ecc.): se richiesto, lo dice chiaramente invece di
// far finta di averlo fatto. Domani, per aggiungere azioni, basta aggiungere
// nuovi tool a questa stessa lista.

require('dotenv').config();
const { Telegraf } = require('telegraf');
const Anthropic = require('@anthropic-ai/sdk').default;
const {
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
} = require('./queries');
const { sendMail } = require('./mailer');

const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  ANTHROPIC_API_KEY,
} = process.env;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !ANTHROPIC_API_KEY) {
  console.error('Mancano TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID o ANTHROPIC_API_KEY.');
  process.exit(1);
}

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Sei l'assistente personale di Gaetano su Telegram, il suo punto unico per
WhatsApp, agenda, pratiche legali ed email. Parli in italiano, tono diretto e
naturale, senza elenchi puntati né titoli, come in una chat normale.

MESSAGGI WHATSAPP: leggi (in sola lettura, non scrivi mai su WhatsApp) sia il
numero personale che quello di lavoro — quest'ultimo ha già un bot suo (Leo)
che gestisce i lead, tu lo osservi soltanto. Quando fai un riepilogo o rispondi
a "cosa mi sono perso", applica sempre questa griglia mentale invece di
elencare tutto alla rinfusa: cosa richiede una risposta di Gaetano oggi, cosa
è in attesa di risposta dall'altra parte, cosa Gaetano ha promesso e non ha
ancora fatto, e cosa è solo rumore (gruppi, notifiche, chiacchiere) che può
ignorare. Di' sempre da quale numero (personale o lavoro) viene un messaggio
quando è rilevante.

AGENDA: gestisci promemoria, scadenze, pagamenti da fare (es. muratori,
fornitori, persone) e viaggi con gli strumenti dedicati. Se Gaetano dà una
data/ora relativa (lunedì, domani, tra un'ora) convertila tu in ISO 8601
usando come riferimento l'ora attuale indicata nel messaggio, fuso orario
Europe/Rome.

PRATICHE LEGALI: ricorsi, contestazioni, PEC dell'avvocato hanno un loro
spazio dedicato, con controparte, riferimento pratica e scadenza: usa gli
strumenti apposta, non trattarle come semplici promemoria.

AZIONI (mandare email): puoi preparare bozze di email quando serve
scrivere a qualcuno, ma NON le mandi mai da solo. Prepara la bozza con
prepara_email, mostra a Gaetano destinatario, oggetto e testo per intero
nel messaggio, e chiedigli conferma esplicita. Solo se Gaetano approva
chiaramente quella bozza specifica (es. "invia", "va bene mandala",
"sì confermo") chiami invia_email_approvata con l'id di quella bozza.
Se non è inequivocabile che stia approvando proprio quella bozza, chiedi
di nuovo invece di inviare. Per qualunque altra azione che non hai come
strumento, dillo chiaramente invece di far finta di averla eseguita.`;

const tools = [
  {
    name: 'cerca_messaggi',
    description:
      'Cerca tra i messaggi WhatsApp raccolti dal monitoraggio, filtrando per periodo, contatto/chat, testo contenuto o priorità.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Data/ora di inizio in formato ISO 8601, opzionale' },
        to: { type: 'string', description: 'Data/ora di fine in formato ISO 8601, opzionale' },
        contact: { type: 'string', description: 'Nome del contatto o della chat da cercare, opzionale' },
        text: { type: 'string', description: 'Testo da cercare nel corpo del messaggio, opzionale' },
        priority: { type: 'string', enum: ['alta', 'normale', 'bassa'], description: 'Priorità assegnata, opzionale' },
        wa_account: { type: 'string', enum: ['personale', 'lavoro'], description: 'Limita a un solo numero, opzionale' },
        limit: { type: 'number', description: 'Numero massimo di risultati, default 50' },
      },
    },
  },
  {
    name: 'conta_traffico',
    description:
      'Conta quanti messaggi sono arrivati nel periodo indicato, raggruppati per contatto/chat, per capire chi scrive di più.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Data/ora di inizio in formato ISO 8601, opzionale' },
        to: { type: 'string', description: 'Data/ora di fine in formato ISO 8601, opzionale' },
        wa_account: { type: 'string', enum: ['personale', 'lavoro'], description: 'Limita a un solo numero, opzionale' },
      },
    },
  },
  {
    name: 'aggiungi_promemoria',
    description: 'Crea un nuovo promemoria o scadenza nell\'agenda personale di Gaetano.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Titolo breve del promemoria' },
        notes: { type: 'string', description: 'Dettagli aggiuntivi, opzionale' },
        due_at: { type: 'string', description: 'Scadenza in formato ISO 8601, opzionale se non ha una data precisa' },
        priority: { type: 'string', enum: ['alta', 'normale', 'bassa'], description: 'Priorità, default normale' },
        category: { type: 'string', enum: ['generico', 'pagamento', 'viaggio', 'legale'], description: 'Tipo di promemoria, default generico. Per ricorsi/contestazioni/PEC avvocato usa invece registra_pratica_legale.' },
        counterpart: { type: 'string', description: 'A chi si riferisce, es. "muratore Franco" o "assicurazione", opzionale' },
        amount: { type: 'number', description: 'Importo, solo se è un pagamento, opzionale' },
      },
      required: ['title'],
    },
  },
  {
    name: 'lista_promemoria',
    description: 'Elenca i promemoria/scadenze dell\'agenda, filtrati per stato e periodo.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['pending', 'done'], description: 'Default pending (da fare)' },
        from: { type: 'string', description: 'Scadenza da (ISO 8601), opzionale' },
        to: { type: 'string', description: 'Scadenza a (ISO 8601), opzionale' },
      },
    },
  },
  {
    name: 'completa_promemoria',
    description: 'Segna come fatto un promemoria, cercandolo per id o per titolo simile.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Id del promemoria, se noto' },
        title: { type: 'string', description: 'Testo per cercarlo per titolo, se l\'id non è noto' },
      },
    },
  },
  {
    name: 'registra_pratica_legale',
    description: 'Registra o aggiorna un ricorso, una contestazione o una PEC dell\'avvocato, con controparte e scadenza.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Titolo breve della pratica' },
        tipo: { type: 'string', enum: ['ricorso', 'contestazione', 'pec_avvocato', 'altro'] },
        controparte: { type: 'string', description: 'Chi è dall\'altra parte, es. "Agenzia Entrate" o "Avv. Bianchi", opzionale' },
        riferimento: { type: 'string', description: 'Numero pratica o protocollo, opzionale' },
        scadenza: { type: 'string', description: 'Scadenza in ISO 8601, opzionale' },
        notes: { type: 'string', description: 'Dettagli, opzionale' },
      },
      required: ['title'],
    },
  },
  {
    name: 'lista_pratiche_legali',
    description: 'Elenca le pratiche legali, per stato (default: aperta).',
    input_schema: {
      type: 'object',
      properties: {
        stato: { type: 'string', enum: ['aperta', 'in_corso', 'chiusa'] },
      },
    },
  },
  {
    name: 'aggiorna_pratica_legale',
    description: 'Aggiorna lo stato o le note di una pratica legale esistente, dato il suo id.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        stato: { type: 'string', enum: ['aperta', 'in_corso', 'chiusa'] },
        notes: { type: 'string' },
        scadenza: { type: 'string', description: 'Nuova scadenza in ISO 8601' },
      },
      required: ['id'],
    },
  },
  {
    name: 'prepara_email',
    description: 'Prepara una bozza di email da mostrare a Gaetano per approvazione. Non la invia.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Indirizzo destinatario' },
        subject: { type: 'string' },
        body: { type: 'string', description: 'Testo completo dell\'email' },
        context: { type: 'string', description: 'Perché proponi questa email, per tuo riferimento' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'invia_email_approvata',
    description: 'Invia una bozza di email SOLO dopo che Gaetano ha confermato esplicitamente proprio quella bozza.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Id della bozza da inviare' },
      },
      required: ['id'],
    },
  },
];

async function runTool(name, input) {
  if (name === 'cerca_messaggi') return searchMessages(input);
  if (name === 'conta_traffico') return countTraffic(input);
  if (name === 'aggiungi_promemoria') return addReminder(input);
  if (name === 'lista_promemoria') return listReminders(input);
  if (name === 'completa_promemoria') return completeReminder(input);
  if (name === 'registra_pratica_legale') return addLegalMatter(input);
  if (name === 'lista_pratiche_legali') return listLegalMatters(input);
  if (name === 'aggiorna_pratica_legale') return updateLegalMatter(input);
  if (name === 'prepara_email') return createDraftEmail(input);
  if (name === 'invia_email_approvata') return sendApprovedEmail(input.id);
  throw new Error(`Strumento sconosciuto: ${name}`);
}

// Invia solo se la bozza esiste ancora ed è in stato 'draft': evita doppi
// invii se Gaetano conferma due volte per errore.
async function sendApprovedEmail(id) {
  const drafts = await listPendingActions({ status: 'draft', limit: 50 });
  const draft = drafts.find((d) => d.id === id);
  if (!draft) {
    return { ok: false, message: 'Bozza non trovata o già gestita in precedenza.' };
  }
  await sendMail(draft.payload);
  await supabase.from('pending_actions').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', id);
  return { ok: true, message: `Email inviata a ${draft.payload.to}.` };
}

async function ask(userText) {
  const now = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
  const messages = [
    { role: 'user', content: `[Ora attuale: ${now}, Europe/Rome]\n\n${userText}` },
  ];

  for (let turn = 0; turn < 5; turn++) {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    const toolUses = response.content.filter((b) => b.type === 'tool_use');
    if (toolUses.length === 0) {
      return response.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
    }

    messages.push({ role: 'assistant', content: response.content });

    const toolResults = [];
    for (const use of toolUses) {
      try {
        const result = await runTool(use.name, use.input || {});
        toolResults.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: JSON.stringify(result),
        });
      } catch (err) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: `Errore: ${err.message}`,
          is_error: true,
        });
      }
    }
    messages.push({ role: 'user', content: toolResults });
  }

  return 'Ho fatto troppi passaggi per rispondere, prova a riformulare la domanda in modo più specifico.';
}

bot.use(async (ctx, next) => {
  const chatId = String(ctx.chat?.id || '');
  if (chatId !== String(TELEGRAM_CHAT_ID)) {
    return; // ignora chiunque non sia Gaetano
  }
  return next();
});

bot.start((ctx) => ctx.reply('Ciao Gaetano, sono online. Chiedimi pure cosa ti sei perso.'));

bot.on('text', async (ctx) => {
  try {
    await ctx.sendChatAction('typing');
    const reply = await ask(ctx.message.text);
    await ctx.reply(reply || 'Non ho trovato nulla di rilevante.');
  } catch (err) {
    console.error('Errore bot:', err);
    await ctx.reply('Ho avuto un problema a rispondere, riprova tra poco.');
  }
});

bot.launch();
console.log('Bot Telegram avviato.');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
