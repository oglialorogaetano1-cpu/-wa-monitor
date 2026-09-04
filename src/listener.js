// wa-monitor / listener
// Si collega a WhatsApp in SOLA LETTURA: non invia mai messaggi.
// Salva ogni messaggio ricevuto su Supabase. Espone un endpoint /qr protetto
// da chiave per scansionare il QR di accoppiamento la prima volta.

require('dotenv').config();
const express = require('express');
const qrcode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { createClient } = require('@supabase/supabase-js');

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  QR_SECRET,
  WA_ACCOUNT_LABEL = 'personale', // 'personale' o 'lavoro': quale numero è questo listener
  PORT = 3000,
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Mancano SUPABASE_URL o SUPABASE_SERVICE_KEY nelle variabili d\'ambiente.');
  process.exit(1);
}
if (!QR_SECRET) {
  console.error('Manca QR_SECRET: imposta una chiave segreta per proteggere l\'endpoint /qr.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

let lastQr = null;
let ready = false;

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: `/data/wa-session-${WA_ACCOUNT_LABEL}` }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  },
});

client.on('qr', (qr) => {
  lastQr = qr;
  ready = false;
  console.log('Nuovo QR generato. Aprire /qr?k=<QR_SECRET> per scansionarlo.');
});

client.on('ready', () => {
  ready = true;
  lastQr = null;
  console.log(`WhatsApp (${WA_ACCOUNT_LABEL}) collegato e in ascolto (sola lettura).`);
});

client.on('disconnected', (reason) => {
  ready = false;
  console.warn('WhatsApp disconnesso:', reason);
});

// IMPORTANTE: nessun handler invia messaggi. Il client resta di sola lettura.
client.on('message', async (msg) => {
  try {
    const chat = await msg.getChat();
    const contact = await msg.getContact();

    const row = {
      wa_account: WA_ACCOUNT_LABEL,
      wa_message_id: msg.id?._serialized || null,
      chat_id: chat.id?._serialized || msg.from,
      chat_name: chat.name || contact.pushname || contact.number || null,
      is_group: !!chat.isGroup,
      sender_name: contact.pushname || contact.name || contact.number || null,
      sender_number: contact.number || null,
      direction: msg.fromMe ? 'out' : 'in',
      body: msg.body || null,
      message_type: msg.type || 'text',
      wa_timestamp: new Date(msg.timestamp * 1000).toISOString(),
    };

    const { error } = await supabase.from('messages').upsert(row, {
      onConflict: 'wa_account,wa_message_id',
    });
    if (error) console.error('Errore salvataggio messaggio:', error.message);
  } catch (err) {
    console.error('Errore elaborazione messaggio:', err.message);
  }
});

client.initialize();

// --- Server HTTP minimale: healthcheck + QR protetto ---
const app = express();

app.get('/', (_req, res) => {
  res.json({ account: WA_ACCOUNT_LABEL, status: ready ? 'connected' : 'waiting_for_qr' });
});

app.get('/qr', async (req, res) => {
  if (req.query.k !== QR_SECRET) {
    return res.status(403).send('Non autorizzato.');
  }
  if (ready) {
    return res.send('WhatsApp è già collegato. Nessun QR da mostrare.');
  }
  if (!lastQr) {
    return res.send('QR non ancora generato, riprova tra qualche secondo.');
  }
  const dataUrl = await qrcode.toDataURL(lastQr);
  res.send(`<html><body style="display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#111">
    <img src="${dataUrl}" style="width:320px;height:320px" />
  </body></html>`);
});

app.listen(PORT, () => {
  console.log(`Listener HTTP su porta ${PORT}`);
});
