const nodemailer = require('nodemailer');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, '');

function response(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

async function fetchRows(table, filters, select = '*') {
  const query = new URLSearchParams({ select, ...filters });
  const result = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!result.ok) throw new Error(`Supabase ${table}: ${result.status}`);
  return result.json();
}

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return response(405, { error: 'Méthode non autorisée' });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GMAIL_USER || !GMAIL_APP_PASSWORD) {
    const missing = [
      ['SUPABASE_URL', SUPABASE_URL],
      ['SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY],
      ['GMAIL_USER', GMAIL_USER],
      ['GMAIL_APP_PASSWORD', GMAIL_APP_PASSWORD],
    ].filter(([, value]) => !value).map(([name]) => name);
    console.error('Variables Netlify manquantes :', missing.join(', '));
    return response(500, { error: `Variables Netlify manquantes : ${missing.join(', ')}` });
  }

  let adminId, password, subject, message;
  try {
    ({ adminId, password, subject, message } = JSON.parse(event.body || '{}'));
  } catch {
    return response(400, { error: 'Requête invalide' });
  }
  if (typeof adminId !== 'string' || !adminId || typeof password !== 'string' || !password) {
    return response(401, { error: 'Authentification administrateur requise.' });
  }
  if (typeof subject !== 'string' || !subject.trim() || subject.length > 180 || /[\r\n]/.test(subject)) {
    return response(400, { error: 'Objet invalide (180 caractères maximum, sans retour à la ligne).' });
  }
  if (typeof message !== 'string' || !message.trim() || message.length > 10000) {
    return response(400, { error: 'Message invalide (10 000 caractères maximum).' });
  }

  let transporter;
  try {
    const users = await fetchRows('users', { id: `eq.${adminId}` }, 'id,role,password');
    if (!users.some(user => user.role === 'admin' && user.password === password)) {
      return response(403, { error: 'Envoi réservé à un compte administrateur valide.' });
    }

    const associations = await fetchRows('associations', { active: 'eq.true' }, 'email');
    const recipientByAddress = new Map(associations
      .map(association => typeof association.email === 'string' ? association.email.trim() : '')
      .filter(Boolean)
      .map(email => [email.toLowerCase(), email]));
    const recipients = [...recipientByAddress.values()];
    if (!recipients.length) return response(409, { error: 'Aucune association active ne dispose d’une adresse e-mail.' });

    transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    });
    const result = await transporter.sendMail({
      from: { name: 'FédéraMat', address: GMAIL_USER },
      bcc: recipients,
      subject: `[FédéraMat] ${subject.trim()}`,
      text: message.trim(),
    });
    const recipientCount = result.accepted.length;
    if (!recipientCount) {
      return response(502, { error: 'Le serveur de messagerie n’a accepté aucun destinataire.' });
    }
    return response(200, { sent: true, recipientCount, rejectedCount: result.rejected.length });
  } catch (error) {
    console.error('Envoi du message collectif :', error);
    if (error.code === 'EAUTH' || error.responseCode === 535) {
      return response(502, { error: 'Gmail a refusé la connexion. Vérifiez GMAIL_USER et le mot de passe d’application.' });
    }
    if (['ETIMEDOUT', 'ECONNECTION', 'ENOTFOUND'].includes(error.code)) {
      return response(502, { error: `Connexion SMTP Gmail impossible depuis Netlify (${error.code}).` });
    }
    if (error.responseCode >= 500) {
      return response(502, { error: `Gmail a refusé le message (code ${error.responseCode}). Vérifiez les adresses e-mail destinataires.` });
    }
    return response(500, { error: 'Échec de l’envoi. Consultez les journaux de la fonction Netlify.' });
  } finally {
    transporter?.close();
  }
};
