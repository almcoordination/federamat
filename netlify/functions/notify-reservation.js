const nodemailer = require('nodemailer');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, '');

function response(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

async function fetchRows(table, filters) {
  const query = new URLSearchParams({ select: '*', ...filters });
  const result = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!result.ok) throw new Error(`Supabase ${table}: ${result.status}`);
  return result.json();
}

function formatDate(date) {
  if (!date) return '—';
  const [year, month, day] = date.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return response(405, { error: 'Méthode non autorisée' });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GMAIL_USER || !GMAIL_APP_PASSWORD) {
    console.error('Variables Netlify manquantes pour la notification de réservation.');
    return response(500, { error: 'Service email non configuré' });
  }

  let reservationId;
  try {
    reservationId = JSON.parse(event.body || '{}').reservationId;
  } catch {
    return response(400, { error: 'Requête invalide' });
  }
  if (typeof reservationId !== 'string' || !reservationId) return response(400, { error: 'Réservation manquante' });

  try {
    const [reservation] = await fetchRows('reservations', { id: `eq.${reservationId}` });
    if (!reservation) return response(404, { error: 'Réservation introuvable' });
    if (reservation.status !== 'pending') return response(409, { error: 'La réservation n’est plus en attente' });

    const [equipment] = await fetchRows('equipment', { id: `eq.${reservation.equip_id}` });
    if (!equipment?.owner_asso_id) return response(200, { sent: false, reason: 'owner-not-set' });
    const [owner] = await fetchRows('associations', { id: `eq.${equipment.owner_asso_id}` });
    if (!owner?.email) return response(200, { sent: false, reason: 'owner-email-missing' });
    const [requester] = await fetchRows('associations', { id: `eq.${reservation.asso_id}` });

    const appName = 'FédéraMat';
    const subject = `[${appName}] Nouvelle demande pour votre matériel — ${equipment.name}`;
    const text = [
      `Bonjour ${owner.referent || owner.name},`,
      '',
      'Une demande de réservation concerne votre matériel.',
      '',
      `Équipement : ${equipment.name} × ${reservation.qty}`,
      `Association demandeuse : ${requester?.name || 'Non renseignée'}`,
      `Du : ${formatDate(reservation.date_start)} au ${formatDate(reservation.date_end)}`,
      reservation.reason ? `Motif : ${reservation.reason}` : '',
      '',
      'La demande est en attente de validation dans FédéraMat.',
    ].filter(Boolean).join('\n');

    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    });
    await transporter.sendMail({
      from: { name: appName, address: GMAIL_USER },
      to: owner.email,
      subject,
      text,
    });
    transporter.close();
    return response(200, { sent: true });
  } catch (error) {
    console.error('Notification réservation :', error);
    return response(500, { error: 'Échec de la notification' });
  }
};