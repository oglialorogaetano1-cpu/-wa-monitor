// wa-monitor / webhook-lavoro
// Non apre una sua sessione WhatsApp: riceve gli eventi dalla sessione WAHA
// già collegata e usata da Leo (bot ComproSubitoAuto), così il numero di
// lavoro non prende uno slot in più tra i dispositivi collegati. Va
// aggiunto come webhook aggiuntivo sulla sessione WAHA esistente, ACCANTO
// a quello che Leo già usa, mai al posto suo. Questo servizio non scrive
// mai su WhatsApp: legge soltanto e salva su Supabase.

require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  WEBHOOK_SECRET,
  PORT = 3000,
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Mancano SUPABASE_URL o SUPABASE_SERVICE_KEY nelle variabili d\'ambiente.');
  process.exit(1);
}
if (!WEBHOOK_SECRET) {
  console.error('Manca WEBHOOK_SECRET: imposta una chiave per proteggere l\'endpoint del webhook.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const app = express();
app.use(express.json({ limit: '5mb' }));

app.get('/', (_req, res) => {
  res.json({ status: 'in ascolto', account: 'lavoro', source: 'waha (sessione condivisa con Leo)' });
});

// WAHA manda qui gli eventi della sessione. La forma esatta del payload
// varia leggermente tra versioni di WAHA: normalizziamo con dei fallback
// e logghiamo il payload grezzo se non riusciamo a riconoscerlo, così è
// facile adattare i nomi dei campi guardando i log una volta collegato.
app.post('/waha-webhook', async (req, res) => {
  if (req.query.k !== WEBHOOK_SECRET) {
    return res.status(403).json({ error: 'non autorizzato' });
  }

  // Rispondiamo subito: WAHA non deve aspettare Supabase per considerare
  // l'evento consegnato.
  res.status(200).json({ ok: true });

  try {
    const body = req.body || {};
    const event = body.event || body.type;
    const payload = body.payload || body.data || body;

    // Interessano solo i messaggi in arrivo; ignoriamo stati, presenze, ack.
    if (event && !String(event).toLowerCase().includes('message')) return;
    if (!payload || (payload.fromMe && !payload.body)) return;

    const chatId = payload.from || payload.chatId || payload.id?.remote || null;
    if (!chatId) {
      console.warn('Webhook lavoro: payload senza chat riconoscibile, lo loggo per adattare il parsing:', JSON.stringify(body).slice(0, 2000));
      return;
    }

    const isGroup = String(chatId).endsWith('@g.us');
    const senderName =
      payload.notifyName || payload._data?.notifyName || payload.author || payload.participant || null;
    const timestampSec = payload.timestamp || payload.t || Math.floor(Date.now() / 1000);
    const messageId =
      (typeof payload.id === 'string' ? payload.id : payload.id?._serialized || payload.id?.id) || null;

    const row = {
      wa_account: 'lavoro',
      wa_message_id: messageId,
      chat_id: chatId,
      chat_name: payload.chatName || senderName || chatId,
      is_group: isGroup,
      sender_name: senderName,
      sender_number: isGroup ? (payload.author || null) : chatId.split('@')[0],
      direction: payload.fromMe ? 'out' : 'in',
      body: payload.body || payload.caption || null,
      message_type: payload.type || 'text',
      wa_timestamp: new Date(timestampSec * 1000).toISOString(),
    };

    const { error } = await supabase.from('messages').upsert(row, {
      onConflict: 'wa_account,wa_message_id',
    });
    if (error) console.error('Errore salvataggio messaggio (lavoro):', error.message);
  } catch (err) {
    console.error('Errore elaborazione webhook lavoro:', err.message);
  }
});

app.listen(PORT, () => {
  console.log(`Webhook lavoro in ascolto sulla porta ${PORT}, in attesa degli eventi WAHA su /waha-webhook`);
});
