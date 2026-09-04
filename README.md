# wa-monitor

Assistente personale di Gaetano: monitora WhatsApp personale e di lavoro,
gestisce agenda e pagamenti, tiene le pratiche legali, e prepara (mai invia
da sola) le email che servono, in attesa della tua conferma su Telegram.

## Come funziona

Il servizio `listener` si collega al WhatsApp personale via QR (whatsapp-web.js)
e salva ogni messaggio in arrivo su Supabase. Non invia mai nulla su WhatsApp:
è ascolto puro.

Per il WhatsApp di lavoro non serve una sessione nuova: quel numero ha già
una sessione WAHA collegata e usata da Leo (il bot ComproSubitoAuto), e
WhatsApp permette solo 4 dispositivi collegati per numero, quindi conviene
riusare quella. Il servizio `webhook-lavoro` non apre nessuna sessione
propria: espone solo un endpoint che riceve gli eventi dalla sessione WAHA
esistente, in aggiunta al webhook che Leo già usa, non al suo posto. Per
attivarlo, sulla sessione WAHA (progetto Railway `waha-comprosubito`) va
aggiunto un secondo webhook che punti a
`https://<dominio-webhook-lavoro>/waha-webhook?k=<WEBHOOK_SECRET>` — WAHA
supporta più webhook sulla stessa sessione, quindi quello di Leo continua a
funzionare com'è. Il formato esatto degli eventi può variare leggermente a
seconda della versione di WAHA installata: il servizio logga il payload
grezzo se non riesce a riconoscere un campo, così al primo collegamento è
facile vedere nei log di Railway se serve un piccolo aggiustamento.

Il servizio `bot` è il bot Telegram con cui parli in linguaggio naturale.
Legge i messaggi di entrambi i numeri e li smista con una griglia semplice:
cosa richiede una tua risposta oggi, cosa aspetta una risposta dall'altra
parte, cosa hai promesso tu, cosa è solo rumore. Gestisce anche l'agenda
(scadenze, pagamenti come i muratori, viaggi), le pratiche legali (ricorsi,
contestazioni, PEC dell'avvocato) e prepara bozze di email: quando serve
scrivere a qualcuno, il bot mostra destinatario, oggetto e testo per intero
e chiede conferma esplicita prima di mandarla — non manda mai nulla da solo.

Il servizio `recap` è uno script pensato per uno schedule Railway: ogni
mattina legge scadenze, pratiche legali vicine, bozze email in attesa e i
messaggi delle ultime 24 ore, e manda un riepilogo su Telegram.

La pagina web `agenda/scadenzario.html` (pubblicata come artifact) mostra
visivamente scadenze e promemoria, collegata alla stessa tabella Supabase.

## Preparazione

Crea un progetto Supabase dedicato, apri l'SQL editor e lancia il contenuto
di `supabase/schema.sql`. Crea un bot Telegram con @BotFather, prendi il
token, scrivigli un messaggio e recupera il tuo chat id da
`https://api.telegram.org/bot<TOKEN>/getUpdates`.

Copia `.env.example` in `.env` e riempi i valori. Le variabili SMTP servono
solo al bot, per mandare davvero un'email dopo che l'hai approvata: vanno
bene le credenziali SMTP di una delle tue caselle esistenti (Aruba,
documenti@, Yahoo...), basta attivare l'accesso SMTP su quella casella.

## Deploy su Railway

Quattro servizi nello stesso progetto Railway, tutti sullo stesso codice:

`listener` (WhatsApp personale), comando `npm run listener`, con un volume
su `/data`.

`webhook-lavoro` (WhatsApp lavoro, riusa la sessione WAHA di Leo), comando
`npm run webhook-lavoro`, nessun volume: non tiene nessuna sessione propria.

`bot`, comando `npm run bot`, nessun volume, con anche le variabili SMTP.

`recap`, comando `npm run recap`, impostato come Cron Schedule (es. ogni
mattina alle 7), nessun volume.

Con la CLI, da dentro questa cartella: `npm i -g @railway/cli`, poi
`railway login`, poi per ciascuno dei quattro servizi `railway link`
(scegliendo quel servizio) e `railway up`.

## Primo collegamento a WhatsApp

Per `listener`, quando ha un dominio pubblico generato da Railway, apri
`https://<dominio>/qr?k=<QR_SECRET>` e scansiona con il WhatsApp personale
da Dispositivi collegati → Collega un dispositivo.

Per `webhook-lavoro` non c'è nessun QR da scansionare: basta generare il
dominio pubblico su Railway e aggiungere quell'URL come webhook aggiuntivo
sulla sessione WAHA esistente, come descritto sopra. Il numero di lavoro
resta con lo stesso identico dispositivo collegato di sempre.
