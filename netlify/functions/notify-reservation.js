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

  let reservationId, requestedStatus, note;
  try {
    ({ reservationId, status: requestedStatus, note } = JSON.parse(event.body || '{}'));
  } catch {
    return response(400, { error: 'Requête invalide' });
  }
  if (typeof reservationId !== 'string' || !reservationId) return response(400, { error: 'Réservation manquante' });
  if (!['pending', 'approved', 'rejected'].includes(requestedStatus)) return response(400, { error: 'Statut invalide' });

  try {
    const [reservation] = await fetchRows('reservations', { id: `eq.${reservationId}` });
    if (!reservation) return response(404, { error: 'Réservation introuvable' });
    if (reservation.status !== requestedStatus) return response(409, { error: 'Le statut de la réservation a changé' });

    const [equipment] = await fetchRows('equipment', { id: `eq.${reservation.equip_id}` });
    const [requester] = await fetchRows('associations', { id: `eq.${reservation.asso_id}` });
    const owner = equipment?.owner_asso_id
      ? (await fetchRows('associations', { id: `eq.${equipment.owner_asso_id}` }))[0]
      : null;
    const recipients = requestedStatus === 'pending'
      ? [owner?.email]
      : requestedStatus === 'approved'
        ? [requester?.email, owner?.email]
        : [requester?.email];
    const to = [...new Set(recipients.filter(Boolean))];
    if (!to.length) return response(200, { sent: false, reason: 'recipient-email-missing' });

    const appName = 'FédéraMat';
    const labels = { pending: 'Nouvelle demande', approved: 'Réservation approuvée', rejected: 'Réservation refusée' };
    const subject = `[${appName}] ${labels[requestedStatus]} — ${equipment?.name || 'matériel'}`;
    const text = [
      'Bonjour,',
      '',
      requestedStatus === 'pending'
        ? 'Une demande de réservation concerne votre matériel.'
        : requestedStatus === 'approved'
          ? 'La demande de réservation a été approuvée.'
          : 'La demande de réservation a été refusée.',
      '',
      `Équipement : ${equipment?.name || 'Matériel'} × ${reservation.qty}`,
      `Association demandeuse : ${requester?.name || 'Non renseignée'}`,
      `Du : ${formatDate(reservation.date_start)} au ${formatDate(reservation.date_end)}`,
      reservation.reason ? `Motif : ${reservation.reason}` : '',
      note ? `${requestedStatus === 'rejected' ? 'Motif du refus' : 'Message'} : ${note}` : '',
      '',
      requestedStatus === 'pending' ? 'La demande est en attente de validation dans FédéraMat.' : '',
    ].filter(Boolean).join('\n');

    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    });
    await transporter.sendMail({
      from: { name: appName, address: GMAIL_USER },
      to,
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