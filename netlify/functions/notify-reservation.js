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
    const missing = [
      ['SUPABASE_URL', SUPABASE_URL],
      ['SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY],
      ['GMAIL_USER', GMAIL_USER],
      ['GMAIL_APP_PASSWORD', GMAIL_APP_PASSWORD],
    ].filter(([, value]) => !value).map(([name]) => name);
    console.error('Variables Netlify manquantes :', missing.join(', '));
    return response(500, { error: `Variables Netlify manquantes : ${missing.join(', ')}` });
  }

  let requestId, reservationId, requestedStatus, note;
  try {
    ({ requestId, reservationId, status: requestedStatus, note } = JSON.parse(event.body || '{}'));
  } catch {
    return response(400, { error: 'Requête invalide' });
  }
  if (typeof requestId !== 'string' || !requestId) return response(400, { error: 'Demande manquante' });
  if (reservationId != null && (typeof reservationId !== 'string' || !reservationId)) return response(400, { error: 'Ligne de réservation invalide' });
  if (!['pending', 'under_review', 'approved', 'rejected'].includes(requestedStatus)) return response(400, { error: 'Statut invalide' });

  try {
    let reservations = await fetchRows('reservations', { request_id: `eq.${requestId}` });
    if (!reservations.length) reservations = await fetchRows('reservations', { id: `eq.${requestId}` });
    if (reservationId) reservations = reservations.filter(reservation => reservation.id === reservationId);
    if (!reservations.length) return response(404, { error: 'Demande introuvable' });
    if (reservations.some(reservation => reservation.status !== requestedStatus)) return response(409, { error: 'Le statut de la demande a changé' });
    if (requestedStatus === 'pending') return response(200, { sent: false, reason: 'awaiting-admin-approval' });

    const first = reservations[0];
    const equipmentIds = [...new Set(reservations.map(reservation => reservation.equip_id).filter(Boolean))];
    const equipment = equipmentIds.length
      ? await fetchRows('equipment', { id: `in.(${equipmentIds.join(',')})` })
      : [];
    const equipmentById = new Map(equipment.map(item => [item.id, item]));
    const associationIds = [...new Set([
      first.asso_id,
      ...equipment.map(item => item.owner_asso_id),
    ].filter(Boolean))];
    const associations = associationIds.length
      ? await fetchRows('associations', { id: `in.(${associationIds.join(',')})` })
      : [];
    const associationById = new Map(associations.map(association => [association.id, association]));
    const requester = associationById.get(first.asso_id);
    const deliveries = requestedStatus === 'rejected'
      ? (requester?.email ? [{ to: requester.email, owner: null, reservations }] : [])
      : [...reservations.reduce((groups, reservation) => {
        const ownerId = equipmentById.get(reservation.equip_id)?.owner_asso_id;
        if (!ownerId) return groups;
        if (!groups.has(ownerId)) groups.set(ownerId, []);
        groups.get(ownerId).push(reservation);
        return groups;
      }, new Map())].map(([ownerId, items]) => ({
        to: associationById.get(ownerId)?.email,
        owner: associationById.get(ownerId),
        reservations: items,
      })).filter(delivery => delivery.to);
    if (!deliveries.length) {
      return response(200, { sent: false, reason: requestedStatus === 'rejected' ? 'requester-email-missing' : 'no-lending-association-email' });
    }

    const appName = 'FédéraMat';
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    });
    for (const delivery of deliveries) {
      const items = delivery.reservations.map(reservation => {
        const item = equipmentById.get(reservation.equip_id);
        return `- ${item?.name || 'Matériel'} × ${reservation.qty}`;
      });
      const text = [
        'Bonjour,',
        '',
        requestedStatus === 'under_review'
          ? 'Une demande de réservation portant sur du matériel dont votre association est propriétaire est en cours d’examen par l’administrateur. Voici son récapitulatif.'
          : requestedStatus === 'approved'
            ? 'La demande de matériel ci-dessous a été approuvée. Voici le récapitulatif du matériel dont votre association est propriétaire.'
            : 'La demande de réservation ci-dessous a été refusée par l’administrateur.',
        '',
        `Association demandeuse : ${requester?.name || 'Non renseignée'}`,
        `Du : ${formatDate(first.date_start)} au ${formatDate(first.date_end)}`,
        `Lieu : ${first.location || 'Non renseigné'}`,
        `Motif : ${first.reason || 'Non renseigné'}`,
        '',
        'Matériel concerné :',
        ...items,
        note ? `${requestedStatus === 'rejected' ? 'Motif du refus' : 'Message'} : ${note}` : '',
        '',
      ].filter(Boolean).join('\n');
      const subject = requestedStatus === 'under_review'
        ? `[${appName}] Demande à examiner — ${requester?.name || 'Association'}`
        : requestedStatus === 'approved'
          ? `[${appName}] Matériel à prêter — ${requester?.name || 'Demande approuvée'}`
          : `[${appName}] Demande de réservation refusée`;
      await transporter.sendMail({
        from: { name: appName, address: GMAIL_USER },
        to: delivery.to,
        subject,
        text,
      });
    }
    transporter.close();
    return response(200, { sent: true, recipientCount: deliveries.length });
  } catch (error) {
    console.error('Notification réservation :', error);
    if (error.code === 'EAUTH' || error.responseCode === 535) {
      return response(502, { error: 'Gmail a refusé la connexion. Vérifiez GMAIL_USER et le mot de passe d’application.' });
    }
    if (['ETIMEDOUT', 'ECONNECTION', 'ENOTFOUND'].includes(error.code)) {
      return response(502, { error: `Connexion SMTP Gmail impossible depuis Netlify (${error.code}).` });
    }
    if (error.responseCode >= 500) {
      return response(502, { error: `Gmail a refusé le message (code ${error.responseCode}). Vérifiez l’adresse email destinataire.` });
    }
    return response(500, { error: 'Échec de la notification. Consultez les journaux de la fonction Netlify.' });
  }
};