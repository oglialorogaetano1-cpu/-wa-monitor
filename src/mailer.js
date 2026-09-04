// Invio email reale, usato SOLO dopo che una bozza è stata approvata da
// Gaetano. Nessun altro punto del codice deve chiamare sendMail.
const nodemailer = require('nodemailer');

const {
  SMTP_HOST,
  SMTP_PORT = 465,
  SMTP_SECURE = 'true',
  SMTP_USER,
  SMTP_PASS,
  EMAIL_FROM,
} = process.env;

let transporter = null;

function getTransporter() {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw new Error(
      'SMTP non configurato: mancano SMTP_HOST, SMTP_USER o SMTP_PASS nelle variabili d\'ambiente.'
    );
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: SMTP_SECURE === 'true',
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
}

async function sendMail({ to, subject, body }) {
  const t = getTransporter();
  await t.sendMail({
    from: EMAIL_FROM || SMTP_USER,
    to,
    subject,
    text: body,
  });
}

module.exports = { sendMail };
