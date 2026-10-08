// ===== FédéraMat — Supabase Edition =====
// Remplacez les deux constantes ci-dessous par vos valeurs Supabase
// (Votre projet → Settings → API)
const SUPABASE_URL     = 'https://cnywouxulqcxyifuxnxr.supabase.co';        // ex: https://xxxx.supabase.co
const SUPABASE_ANON_KEY = 'sb_publishable_B-InHQUBKsYAE9m6Psslgg_56gzi384';  // clé "anon public"

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let pendingAssociationLogo = null;
let removeAssociationLogo = false;
const associationBannerColors = ['#ffffff','#2563eb','#eab308','#dc2626','#16a34a','#f97316','#8b5cf6','#92400e','#000000','#ec4899'];

// ===== STATE =====
let state = {
  currentUser: null,
  data: { settings:{}, users:[], associations:[], equipment:[], reservations:[], history:[] },
  currentPage: 'dashboard',
  calMonth: new Date(),
  stockFilter: 'all',
  stockDate: todayStr(),
  reservFilter: 'all',
};

// ===== HELPERS =====
function getEquip(id) { return state.data.equipment.find(e => e.id === id); }
function getAsso(id)  { return state.data.associations.find(a => a.id === id); }
function sortAssociations() {
  state.data.associations.sort((a,b)=>a.name.localeCompare(b.name,'fr',{sensitivity:'base'}));
}
function associationMark(association, size=32) {
  const logo=association?.logo;
  const style=`width:${size}px;height:${size}px;`;
  if(typeof logo==='string'&&/^data:image\/(?:jpeg|png|gif|webp);base64,[A-Za-z0-9+/]+=*$/i.test(logo)){
    return `<img class="asso-brand-mark" style="${style}" src="${logo}" alt="">`;
  }
  return `<span class="asso-brand-placeholder" style="${style}" aria-hidden="true"></span>`;
}
function associationIdentity(association, size=32) {
  if(!association) return '—';
  return `<span class="association-identity">${associationMark(association,size)}<span>${association.name}</span></span>`;
}
function federationIdentity(label='Fédération', size=20) {
  return `<span class="association-identity"><img class="asso-brand-mark" style="width:${size}px;height:${size}px;" src="ChatGPT Image 3 août 2026, 17_01_25.png" alt="A.L.M."><span>${label}</span></span>`;
}
function isMissingAssociationLogoColumn(error) {
  return ['42703','PGRST204'].includes(error?.code)&&/logo/i.test(error.message||'');
}
function fmtDate(d)   { if (!d) return '—'; const [y,m,day]=d.slice(0,10).split('-'); return `${day}/${m}/${y}`; }
function todayStr()   { const today=new Date(); return `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`; }
function uid()        { return 'x'+Math.random().toString(36).slice(2,9); }
function cfg()        { return state.data.settings; }

// ===== CHARGEMENT SUPABASE =====
async function loadData() {
  showLoader(true);
  const fallbackSettings = { app_name:'A.L.M. Coordination', app_tagline:'Gestion mutualisée du matériel' };
  let lastError;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const [settings, users, associations, equipment, reservations, history] = await Promise.all([
          db.from('settings').select('*').maybeSingle(),
          db.from('users').select('*'),
          db.from('associations').select('*'),
          db.from('equipment').select('*'),
          db.from('reservations').select('*'),
          db.from('history').select('*').order('created_at', { ascending: false }).limit(200),
        ]);
        const failed = [settings, users, associations, equipment, reservations, history].find(result => result.error);
        if (failed?.error) throw failed.error;
        state.data.settings     = settings.data     || fallbackSettings;
        state.data.users        = users.data        || [];
        state.data.associations = associations.data || [];
        sortAssociations();
        state.data.equipment    = equipment.data    || [];
        state.data.reservations = reservations.data || [];
        state.data.history      = history.data      || [];
        return true;
      } catch (e) {
        lastError = e;
        if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 800));
      }
    }
    throw lastError;
  } catch(e) {
    console.error('Supabase:', e);
    toast(`⚠️ Connexion Supabase impossible${e?.message ? ` : ${e.message}` : '.'}`, 9000);
    return false;
  } finally {
    showLoader(false);
  }
}

function showLoader(on) {
  const el = document.getElementById('global-loader');
  if (el) el.style.display = on ? 'flex' : 'none';
}

// ===== TEMPS RÉEL =====
function subscribeRealtime() {
  db.channel('federamat-all')
    .on('postgres_changes', { event:'*', schema:'public' }, async () => {
      await loadData();
      renderSidebar();
      renderPage(state.currentPage);
    })
    .subscribe(status => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('Supabase Realtime:', status);
        toast('⚠️ Synchronisation temps réel interrompue. Les données seront rechargées à la prochaine action.', 7000);
      }
    });
}

// ===== ÉCRITURE =====
async function dbInsert(table, data) {
  const { error } = await db.from(table).insert(data);
  if (error) { toast('Erreur : '+error.message, 5000); console.error(error); return false; }
  return true;
}
async function dbUpdate(table, id, data) {
  const { error } = await db.from(table).update(data).eq('id', id);
  if (error) { toast('Erreur : '+error.message, 5000); console.error(error); return false; }
  return true;
}
async function dbDelete(table, id) {
  const { error } = await db.from(table).delete().eq('id', id);
  if (error) { toast('Erreur : '+error.message, 5000); console.error(error); return false; }
  return true;
}

// ===== HISTORIQUE =====
async function addHistory(type, text) {
  const entry = { id:uid(), type, text, user_name: state.currentUser?.name||'?', created_at: new Date().toISOString() };
  state.data.history.unshift(entry);
  await dbInsert('history', entry);
}

// ===== AUTH =====
async function tryLogin(login, password) {
  const user = state.data.users.find(u => u.login === login && u.password === password);
  if (!user) return false;
  state.currentUser = user;
  sessionStorage.setItem('federamat_user', user.id);
  return true;
}
function tryAutoLogin() {
  const id = sessionStorage.getItem('federamat_user');
  if (id) { const u = state.data.users.find(u => u.id === id); if (u) { state.currentUser = u; return true; } }
  return false;
}
function logout() { state.currentUser = null; sessionStorage.removeItem('federamat_user'); showLogin(); }
function isAdmin() { return state.currentUser?.role === 'admin'; }
function currentAsso() { return state.currentUser?.asso ? state.data.associations.find(a => a.id === state.currentUser.asso) : null; }
function associationBannerColor(association) {
  return associationBannerColors.includes(association?.color) ? association.color : '#ffffff';
}
function updateTopbarBanner() {
  const band=document.getElementById('topbar-color-band');
  if(!band) return;
  band.style.background=isAdmin()
    ?'linear-gradient(90deg, #0057bf 0 33.333%, #659f04 33.333% 66.666%, #f66a03 66.666% 100%)'
    :associationBannerColor(currentAsso());
}
async function changeAssociationBannerColor(color) {
  const picker=document.getElementById('association-banner-color');
  const association=currentAsso();
  if(isAdmin()||!association||!associationBannerColors.includes(color)) {
    if(picker) picker.value=associationBannerColor(association);
    return;
  }
  const previousColor=associationBannerColor(association);
  const updated=await dbUpdate('associations',association.id,{color});
  if(!updated) {
    picker.value=previousColor;
    updateTopbarBanner();
    return;
  }
  association.color=color;
  updateTopbarBanner();
  toast('✓ Couleur du bandeau enregistrée');
}

// ===== DISPONIBILITÉ =====
function computeAvailable(equipId, excludeId=null) {
  const eq=getEquip(equipId); if(!eq) return 0;
  const today=todayStr();
  const used=state.data.reservations
    .filter(r=>r.equip_id===equipId&&!['rejected','cancelled'].includes(r.status)&&r.id!==excludeId)
    .filter(r=>!(r.date_end<today||r.date_start>today))
    .reduce((s,r)=>s+r.qty,0);
  return Math.max(0, eq.total - used);
}
function computeAvailableForPeriod(equipId, ds, de, excludeId=null) {
  const eq=getEquip(equipId); if(!eq) return 0;
  const used=state.data.reservations
    .filter(r=>r.equip_id===equipId&&!['rejected','cancelled'].includes(r.status)&&r.id!==excludeId)
    .filter(r=>!(r.date_end<ds||r.date_start>de))
    .reduce((s,r)=>s+r.qty,0);
  return Math.max(0, eq.total - used);
}

// ===== TOAST =====
function toast(msg, d=3500) {
  const el=document.getElementById('toast'); el.textContent=msg; el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'), d);
}

// ===== NOTIFICATIONS EMAIL =====
function reservationEmailDrafts(requestId, status, note='', reservationId=null) {
  const reservations = state.data.reservations
    .filter(reservation => reservationRequestId(reservation) === requestId)
    .filter(reservation => !reservationId || reservation.id === reservationId);
  if (!reservations.length || !['under_review','approved','rejected'].includes(status)) {
    return { drafts: [], reason: 'no-recipient' };
  }

  const first = reservations[0];
  const requester = getAsso(first.asso_id);
  const deliveries = [];
  if (status === 'rejected') {
    if (typeof requester?.email === 'string' && requester.email.trim()) {
      deliveries.push({ to: requester.email.trim(), association: requester, reservations });
    }
  } else {
    const ownerGroups = new Map();
    reservations.forEach(reservation => {
      const ownerId = getEquip(reservation.equip_id)?.owner_asso_id;
      const owner = ownerId ? getAsso(ownerId) : null;
      if (typeof owner?.email !== 'string' || !owner.email.trim()) return;
      if (!ownerGroups.has(ownerId)) ownerGroups.set(ownerId, { to: owner.email.trim(), association: owner, reservations: [] });
      ownerGroups.get(ownerId).reservations.push(reservation);
    });
    deliveries.push(...ownerGroups.values());
  }

  const reason = status === 'rejected' ? 'requester-email-missing' : 'no-lending-association-email';
  const drafts = deliveries.map(delivery => {
    const equipmentLines = delivery.reservations.map(reservation =>
      `- ${getEquip(reservation.equip_id)?.name || 'Matériel'} × ${reservation.qty}`);
    const text = [
      `Bonjour ${delivery.association.referent || delivery.association.name || 'Madame, Monsieur'},`,
      '',
      status === 'under_review'
        ? 'Une demande de réservation portant sur du matériel dont votre association est propriétaire est en cours d’examen par l’administrateur. Voici son récapitulatif.'
        : status === 'approved'
          ? 'La demande de matériel ci-dessous a été approuvée. Voici le récapitulatif du matériel dont votre association est propriétaire.'
          : 'La demande de réservation ci-dessous a été refusée par l’administrateur.',
      '',
      `Association demandeuse : ${requester?.name || 'Non renseignée'}`,
      `Du : ${fmtDate(first.date_start)} au ${fmtDate(first.date_end)}`,
      `Lieu : ${first.location || 'Non renseigné'}`,
      `Motif : ${first.reason || 'Non renseigné'}`,
      '',
      'Matériel concerné :',
      ...equipmentLines,
      note ? `${status === 'rejected' ? 'Motif du refus' : 'Message'} : ${note}` : '',
      '',
      'Cordialement,',
      'FédéraMat',
    ].filter(Boolean).join('\n');
    const subject = status === 'under_review'
      ? `[FédéraMat] Demande à examiner — ${requester?.name || 'Association'}`
      : status === 'approved'
        ? `[FédéraMat] Matériel à prêter — ${requester?.name || 'Demande approuvée'}`
        : '[FédéraMat] Demande de réservation refusée';
    const composeUrl = new URL('https://mail.google.com/mail/');
    composeUrl.searchParams.set('view', 'cm');
    composeUrl.searchParams.set('fs', '1');
    composeUrl.searchParams.set('to', delivery.to);
    composeUrl.searchParams.set('su', subject);
    composeUrl.searchParams.set('body', text);
    return {
      to: delivery.to,
      associationName: delivery.association.name || delivery.to,
      href: composeUrl.href.length <= 8000 ? composeUrl.href : null,
    };
  });
  return { drafts, reason };
}
function showReservationEmailDrafts(result, statusMessage) {
  const list = document.getElementById('reservation-email-drafts');
  if (!result.drafts.length) {
    toast(`${statusMessage} — ${result.reason === 'requester-email-missing'
      ? 'aucune adresse email renseignée pour l’association demandeuse.'
      : 'aucune adresse email renseignée pour les associations prêteuses.'}`, 7000);
    return;
  }
  list.innerHTML = result.drafts.map(draft => draft.href
    ? `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);">
        <span style="font-size:13px;">${escapeHtml(draft.associationName)} <span style="color:var(--text3);">(${escapeHtml(draft.to)})</span></span>
        <a class="btn btn-primary btn-sm" href="${escapeHtml(draft.href)}" target="_blank" rel="noopener">Ouvrir dans Gmail</a>
      </div>`
    : `<div class="alert alert-warn">Le brouillon pour ${escapeHtml(draft.associationName)} est trop long pour être ouvert dans Gmail.</div>`
  ).join('');
  openModal('modal-reservation-email');
  toast(`${statusMessage} — ${result.drafts.length} brouillon${result.drafts.length > 1 ? 's' : ''} Gmail à préparer.`, 7000);
}

function broadcastRecipients() {
  const recipients = new Map(state.data.associations
    .filter(association => association.active && typeof association.email === 'string' && association.email.trim())
    .map(association => association.email.trim())
    .map(email => [email.toLowerCase(), email]));
  return [...recipients.values()];
}
function renderBroadcast() {
  const count = broadcastRecipients().length;
  document.getElementById('broadcast-recipient-count').textContent =
    `${count} destinataire${count > 1 ? 's' : ''} (associations actives avec une adresse e-mail)`;
  document.getElementById('broadcast-send-button').disabled = count === 0;
}
function submitBroadcastEmail() {
  if (!isAdmin()) {
    toast('Accès réservé à l’administrateur.');
    return;
  }
  const subject = document.getElementById('broadcast-subject').value.trim();
  const message = document.getElementById('broadcast-message').value.trim();
  const recipients = broadcastRecipients();
  const recipientCount = recipients.length;
  if (!subject || !message) {
    toast('Veuillez renseigner l’objet et le message.');
    return;
  }
  if (!recipientCount) {
    toast('Aucune association active ne dispose d’une adresse e-mail.');
    return;
  }
  if (!window.confirm(`Ouvrir un brouillon Gmail avec ${recipientCount} destinataire${recipientCount > 1 ? 's' : ''} en copie cachée ?`)) return;

  const composeUrl = new URL('https://mail.google.com/mail/');
  composeUrl.searchParams.set('view', 'cm');
  composeUrl.searchParams.set('fs', '1');
  composeUrl.searchParams.set('bcc', recipients.join(','));
  composeUrl.searchParams.set('su', `[FédéraMat] ${subject}`);
  composeUrl.searchParams.set('body', message);
  if (composeUrl.href.length > 8000) {
    toast('Le brouillon est trop long pour être ouvert dans Gmail. Réduisez le texte ou le nombre de destinataires.');
    return;
  }
  const composeWindow = window.open(composeUrl.href, '_blank');
  if (!composeWindow) {
    toast('La fenêtre Gmail a été bloquée. Autorisez les fenêtres pop-up pour ce site puis réessayez.');
    return;
  }
  composeWindow.opener = null;
  document.getElementById('broadcast-subject').value = '';
  document.getElementById('broadcast-message').value = '';
  toast('✓ Brouillon ouvert dans Gmail. Vérifiez-le puis cliquez sur « Envoyer ».', 6000);
}

// ===== NAVIGATION =====
function navigate(page) {
  if (page === 'broadcast' && !isAdmin()) {
    navigate('dashboard');
    return;
  }
  state.currentPage = page;
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById('page-'+page)?.classList.add('active');
  document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');
  const titles = { dashboard:'Tableau de bord', calendar:'Calendrier', stock:'Stock & inventaire', reservations:'Mes réservations', approvals:'Validations en attente', associations:'Gestion des associations', annuaire:'Annuaire des associations', history:'Historique', comptes:'Comptes & mots de passe', broadcast:'Message collectif', profile:'Mon profil' };
  document.getElementById('topbar-title').textContent = titles[page]||page;
  renderPage(page);
}
function renderPage(p) {
  ({dashboard:renderDashboard, calendar:renderCalendar, stock:renderStock,
    reservations:renderReservations, approvals:renderApprovals,
    associations:renderAssociations, annuaire:renderAnnuaire,
    history:renderHistory, comptes:renderComptes, broadcast:renderBroadcast, profile:renderProfile}[p]||(() =>{}))();
}

// ===== SIDEBAR =====
function renderSidebar() {
  const user=state.currentUser, asso=currentAsso();
  document.getElementById('sidebar-user-name').textContent = user.name;
  const rb=document.getElementById('sidebar-role-badge');
  rb.textContent=isAdmin()?'Administrateur':'Association';
  rb.className='user-role-badge '+(isAdmin()?'role-admin':'role-asso');
  document.getElementById('sidebar-asso-line').innerHTML = asso?associationIdentity(asso,20):'';
  const topbarAsso=document.getElementById('topbar-user-asso');
  topbarAsso.innerHTML=asso?associationIdentity(asso,26):'';
  topbarAsso.style.display=asso?'':'none';
  const bannerPicker=document.getElementById('association-banner-color');
  bannerPicker.style.display=!isAdmin()&&asso?'':'none';
  bannerPicker.value=associationBannerColor(asso);
  updateTopbarBanner();
  document.querySelectorAll('.admin-only').forEach(el=>el.style.display=isAdmin()?'':'none');
  const pending=groupReservationRequests(state.data.reservations.filter(r=>['pending','under_review'].includes(r.status))).length;
  const badge=document.getElementById('badge-approvals');
  badge.textContent=pending; badge.style.display=pending>0?'':'none';
}

// ===== DASHBOARD =====
function renderDashboard() {
  const d=state.data, pending=groupReservationRequests(d.reservations.filter(r=>['pending','under_review'].includes(r.status)));
  const myR=isAdmin()?d.reservations:d.reservations.filter(r=>r.asso_id===state.currentUser.asso);
  document.getElementById('stat-equip').textContent        = d.equipment.length;
  document.getElementById('stat-reservations').textContent = myR.length;
  document.getElementById('stat-assos').textContent        = d.associations.filter(a=>a.active).length;
  document.getElementById('stat-pending').textContent      = pending.length;
  document.getElementById('stat-pending').style.color      = pending.length>0?'var(--warn)':'var(--text)';
  document.querySelectorAll('.admin-stat').forEach(el=>el.style.display=isAdmin()?'':'none');
  const recent=[...myR].reverse().slice(0,5);
  document.getElementById('dash-recent').innerHTML=recent.map(r=>{
    const eq=getEquip(r.equip_id),as=getAsso(r.asso_id);
    return `<tr><td><strong>${eq?.name||'?'}</strong></td>${isAdmin()?`<td>${associationIdentity(as)}</td>`:''}<td>${fmtDate(r.date_start)}→${fmtDate(r.date_end)}</td><td><span class="badge badge-${r.status}">${statusLabel(r.status)}</span></td></tr>`;
  }).join('')||'<tr><td colspan="4" style="padding:16px;text-align:center;color:var(--text3);">Aucune réservation</td></tr>';
  const alerts=d.equipment.map(eq=>({eq,avail:computeAvailable(eq.id),pct:computeAvailable(eq.id)/eq.total})).filter(x=>x.pct<0.4).sort((a,b)=>a.pct-b.pct).slice(0,5);
  document.getElementById('dash-alerts').innerHTML=alerts.map(({eq,avail,pct})=>{
    const cls=pct<0.2?'danger':'warn';
    return `<div style="margin-bottom:12px;"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;"><span>${eq.name}</span><span style="color:var(--${cls});font-size:12px;font-weight:600;">${avail}/${eq.total}</span></div><div class="progress-bar"><div class="progress-fill ${cls}" style="width:${Math.round(pct*100)}%"></div></div></div>`;
  }).join('')||'<div style="padding:16px;text-align:center;color:var(--text3);font-size:13px;">✓ Tous les stocks sont suffisants</div>';
  const dashAdmin=document.getElementById('dash-admin');
  if (isAdmin()) {
    dashAdmin.style.display='';
    document.getElementById('dash-pending').innerHTML=pending.slice(0,3).map(request=>{
      const first=request.reservations[0],as=getAsso(first.asso_id);
      const summary=request.reservations.map(r=>`${getEquip(r.equip_id)?.name||'?'} × ${r.qty}`).join(', ');
      const status=first.status;
      const action=status==='pending'
        ?`<button class="btn btn-primary btn-sm" onclick="markReservationUnderReview('${request.id}')">Examiner la demande</button>`
        :`<button class="btn btn-primary btn-sm" onclick="navigate('approvals')">Poursuivre l’examen</button>`;
      return `<div class="approval-card" style="padding:12px;"><div class="approval-header"><div><div class="approval-title" style="font-size:13px;">${summary}</div><div class="approval-meta">${associationIdentity(as,22)} · ${fmtDate(first.date_start)}→${fmtDate(first.date_end)}</div></div><span class="badge badge-${status}">${statusLabel(status)}</span></div><div class="approval-actions">${action}<button class="btn btn-sm" onclick="navigate('approvals')">Détails</button></div></div>`;
    }).join('')||'<div style="padding:16px;text-align:center;color:var(--text3);font-size:13px;">✓ Aucune demande à traiter</div>';
  } else { dashAdmin.style.display='none'; }
}
function statusLabel(s){return{pending:'Demande enregistrée',under_review:'En cours d’examen',approved:'Validée',rejected:'Refusée',cancelled:'Annulée'}[s]||s;}
function reservationRequestId(reservation){return reservation.request_id||reservation.id;}
function groupReservationRequests(reservations){
  const groups=new Map();
  reservations.forEach(reservation=>{
    const requestId=reservationRequestId(reservation);
    if(!groups.has(requestId)) groups.set(requestId,{id:requestId,reservations:[]});
    groups.get(requestId).reservations.push(reservation);
  });
  return [...groups.values()];
}

async function markReservationUnderReview(requestId){
  const reservations=state.data.reservations.filter(r=>reservationRequestId(r)===requestId&&r.status==='pending');
  if(!isAdmin()||!reservations.length) return;
  const note=document.getElementById('note-'+requestId)?.value||'';
  const ids=reservations.map(r=>r.id);
  const {error}=await db.from('reservations').update({status:'under_review'}).in('id',ids);
  if(error){toast('Erreur : '+error.message,5000);console.error(error);return;}
  reservations.forEach(r=>{r.status='under_review';});
  const requester=getAsso(reservations[0].asso_id)?.name||'Association';
  await addHistory('under_review',`Demande de ${reservations.length} matériel(aux) (${requester}) mise en cours d’examen`);
  renderSidebar(); renderPage(state.currentPage);
  const drafts=reservationEmailDrafts(requestId,'under_review',note);
  showReservationEmailDrafts(drafts,'Demande mise en cours d’examen');
}
// ===== CALENDAR =====
function renderCalendar() {
  const yr=state.calMonth.getFullYear(), mo=state.calMonth.getMonth();
  const mNames=['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  document.getElementById('cal-month-label').textContent=`${mNames[mo]} ${yr}`;
  let dow=new Date(yr,mo,1).getDay(); dow=dow===0?6:dow-1;
  const days=new Date(yr,mo+1,0).getDate(), today=todayStr();
  const rs=state.data.reservations.filter(r=>!['rejected','cancelled'].includes(r.status));
  let html='';
  for(let i=0;i<dow;i++) html+='<div class="cal-cell other-month"></div>';
  for(let d=1;d<=days;d++){
    const ds=`${yr}-${String(mo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dr=rs.filter(r=>r.date_start<=ds&&r.date_end>=ds);
    const myAssoId=state.currentUser.asso;
    html+=`<div class="cal-cell${ds===today?' today':''}" onclick="calDayClick('${ds}')">
      <div class="cal-date" style="${ds===today?'color:var(--accent);font-weight:700;':''}">${d}</div>
      ${dr.slice(0,3).map(r=>{
        const eq=getEquip(r.equip_id),as=getAsso(r.asso_id),isMine=r.asso_id===myAssoId;
        const label=`${eq?.name||'?'} · ${as?.name||'?'}`;
        return `<div class="cal-event-pill ${['pending','under_review'].includes(r.status)?'pending':(isMine?'approved mine':'approved')}" title="${label}">${eq?.name||'?'} · ${associationIdentity(as,14)}</div>`;
      }).join('')}
      ${dr.length>3?`<div style="font-size:9px;color:var(--text3);">+${dr.length-3} autres</div>`:''}
    </div>`;
  }
  document.getElementById('cal-grid').innerHTML=html;
}
function calPrevMonth(){state.calMonth.setMonth(state.calMonth.getMonth()-1);renderCalendar();}
function calNextMonth(){state.calMonth.setMonth(state.calMonth.getMonth()+1);renderCalendar();}
function calDayClick(d){openNewReservation(d);}

// ===== STOCK =====
function renderStock() {
  const f=state.stockFilter, catMap={event:'Événementiel',sport:'Sportif',tech:'Technique'}, catCls={event:'cat-event',sport:'cat-sport',tech:'cat-tech'};
  document.getElementById('stock-date').value=state.stockDate;
  document.getElementById('stock-tbody').innerHTML=state.data.equipment.filter(eq=>f==='all'||eq.cat===f).sort((a,b)=>a.name.localeCompare(b.name,'fr',{sensitivity:'base'})).map(eq=>{
    const avail=computeAvailableForPeriod(eq.id,state.stockDate,state.stockDate), pct=Math.round(avail/eq.total*100);
    const pcls=pct<20?'danger':pct<40?'warn':'', scls=avail===0?'unavailable':pct<30?'low':'available', stxt=avail===0?'Indisponible':pct<30?'Stock bas':'Disponible';
    const owner=eq.owner_asso_id?getAsso(eq.owner_asso_id):null;
    return `<tr><td><strong>${eq.name}</strong><div style="font-size:11px;color:var(--text3);">${eq.location||''}</div>${owner?`<div style="font-size:11px;color:var(--purple);">${associationIdentity(owner,20)}</div>`:`<div style="font-size:11px;color:var(--text3);">${federationIdentity()}</div>`}</td><td><span class="cat-tag ${catCls[eq.cat]||''}">${catMap[eq.cat]||eq.cat}</span></td><td>${eq.total}</td><td><div class="progress-wrap"><span style="font-size:13px;font-weight:500;">${avail}</span><div class="progress-bar"><div class="progress-fill ${pcls}" style="width:${pct}%"></div></div><span class="progress-num">${pct}%</span></div></td><td><span class="badge badge-${scls}">${stxt}</span></td><td style="font-size:12px;color:var(--text3);">${eq.state}</td><td>${isAdmin()?`<button class="btn btn-sm" onclick="openEditEquip('${eq.id}')">Modifier</button>`:`<button class="btn btn-sm" onclick="openNewReservation(null,'${eq.id}')">Réserver</button>`}</td></tr>`;
  }).join('')||'<tr><td colspan="7" style="padding:24px;text-align:center;color:var(--text3);">Aucun équipement</td></tr>';
}
function setStockFilter(f){state.stockFilter=f;document.querySelectorAll('#stock-filters .filter-btn').forEach(b=>b.classList.toggle('active',b.dataset.filter===f));renderStock();}
function setStockDate(date){if(!date)return;state.stockDate=date;renderStock();}

// ===== RESERVATIONS =====
function renderReservations() {
  let data=isAdmin()?state.data.reservations:state.data.reservations.filter(r=>r.asso_id===state.currentUser.asso);
  if(state.reservFilter!=='all') data=data.filter(r=>r.status===state.reservFilter);
  data=[...data].reverse();
  document.getElementById('reservations-tbody').innerHTML=data.map(r=>{
    const eq=getEquip(r.equip_id),as=getAsso(r.asso_id);
    const actions=isAdmin()?`<button class="btn btn-sm btn-danger" onclick="deleteReserv('${r.id}')">Supprimer la demande</button>`:r.status==='pending'||r.status==='under_review'?`<button class="btn btn-sm btn-danger" onclick="cancelReserv('${r.id}')">Annuler</button>`:['approved','rejected'].includes(r.status)?`<button class="btn btn-sm btn-danger" onclick="deleteReserv('${r.id}')">Supprimer</button>`:'';
    return `<tr><td><strong>${eq?.name||'?'}</strong></td>${isAdmin()?`<td>${associationIdentity(as)}</td>`:''}<td>${fmtDate(r.date_start)}</td><td>${fmtDate(r.date_end)}</td><td>${r.qty}</td><td><span class="badge badge-${r.status}">${statusLabel(r.status)}</span></td><td><button class="btn btn-sm" onclick="showReservDetail('${r.id}')">Voir</button>${actions}</td></tr>`;
  }).join('')||`<tr><td colspan="7"><div style="text-align:center;padding:32px;color:var(--text3);">📋 Aucune réservation</div></td></tr>`;
  const th=document.getElementById('th-asso'); if(th) th.style.display=isAdmin()?'':'none';
}
function setReservFilter(f){state.reservFilter=f;document.querySelectorAll('#reserv-filters .filter-btn').forEach(b=>b.classList.toggle('active',b.dataset.filter===f));renderReservations();}
async function cancelReserv(id){
  const r=state.data.reservations.find(r=>r.id===id&&['pending','under_review'].includes(r.status)); if(!r) return;
  const equipment=getEquip(r.equip_id);
  if(!confirm(`Annuler uniquement ${equipment?.name||'cette ligne'} × ${r.qty} ? Les autres lignes de la demande resteront inchangées.`)) return;
  const ok=await dbUpdate('reservations',id,{status:'cancelled'}); if(!ok) return;
  r.status='cancelled';
  await addHistory('cancelled',`Ligne de réservation ${equipment?.name||'Matériel'} × ${r.qty} annulée par ${state.currentUser?.name||'?'}`);
  renderSidebar(); renderReservations(); toast('Ligne de réservation annulée');
}
async function deleteReserv(id){
  const admin=isAdmin();
  const r=state.data.reservations.find(r=>r.id===id); if(!r) return;
  const requestId=reservationRequestId(r);
  if(!admin&&!['approved','rejected'].includes(r.status)) return;
  const items=admin?[r]:state.data.reservations.filter(item=>reservationRequestId(item)===requestId);
  const equipment=getEquip(r.equip_id)?.name||'Matériel';
  const summary=items.map(item=>`${getEquip(item.equip_id)?.name||'Matériel'} × ${item.qty}`).join(', ');
  const confirmation=admin
    ?`Supprimer uniquement la ligne « ${equipment} × ${r.qty} » de cette demande ? Les autres lignes resteront inchangées.`
    :`Supprimer définitivement cette demande ? Matériel concerné : ${summary}.`;
  if(!confirm(confirmation)) return;
  const {error}=await db.from('reservations').delete().in('id',items.map(item=>item.id));
  if(error){toast('Erreur : '+error.message,5000);console.error(error);return;}
  const deletedIds=new Set(items.map(item=>item.id));
  state.data.reservations=state.data.reservations.filter(item=>!deletedIds.has(item.id));
  await addHistory('deleted',admin
    ?`Ligne de réservation ${equipment} × ${r.qty} supprimée par ${state.currentUser?.name||'?'}.`
    :`Demande de réservation (${summary}) supprimée par ${state.currentUser?.name||'?'}`);
  renderSidebar(); renderPage(state.currentPage);
  toast(admin?'Ligne de réservation supprimée':'Demande supprimée de la base');
}
function showReservDetail(id){
  const r=state.data.reservations.find(r=>r.id===id); if(!r) return;
  const requestItems=state.data.reservations.filter(item=>reservationRequestId(item)===reservationRequestId(r));
  const as=getAsso(r.asso_id),statuses=[...new Set(requestItems.map(item=>statusLabel(item.status)))].join(', ');
  const equipmentList=requestItems.map(item=>{
    const eq=getEquip(item.equip_id),owner=eq?.owner_asso_id?getAsso(eq.owner_asso_id):null;
    return `<li>${eq?.name||'?'} × ${item.qty}${owner?` — prêteur : ${associationIdentity(owner,20)}`:''} <span class="badge badge-${item.status}">${statusLabel(item.status)}</span></li>`;
  }).join('');
  document.getElementById('detail-content').innerHTML=`<div style="margin-bottom:12px;"><span class="badge badge-${r.status}">${statuses}</span></div><table style="width:100%;font-size:13px;border-collapse:collapse;"><tr><td style="padding:7px 0;color:var(--text3);width:40%;border-bottom:1px solid var(--border);">Association</td><td style="border-bottom:1px solid var(--border);">${associationIdentity(as)}</td></tr><tr><td style="padding:7px 0;color:var(--text3);border-bottom:1px solid var(--border);">Matériel demandé</td><td style="border-bottom:1px solid var(--border);"><ul style="margin:0;padding-left:18px;">${equipmentList}</ul></td></tr><tr><td style="padding:7px 0;color:var(--text3);border-bottom:1px solid var(--border);">Du</td><td style="border-bottom:1px solid var(--border);">${fmtDate(r.date_start)}</td></tr><tr><td style="padding:7px 0;color:var(--text3);border-bottom:1px solid var(--border);">Au</td><td style="border-bottom:1px solid var(--border);">${fmtDate(r.date_end)}</td></tr><tr><td style="padding:7px 0;color:var(--text3);border-bottom:1px solid var(--border);">Lieu</td><td style="border-bottom:1px solid var(--border);">${r.location||'—'}</td></tr><tr><td style="padding:7px 0;color:var(--text3);">Motif</td><td>${r.reason||'—'}</td></tr>${r.notes?`<tr><td style="padding:7px 0;color:var(--text3);">Notes admin</td><td style="color:var(--accent-dark);">${r.notes}</td></tr>`:''}</table>`;
  openModal('modal-detail');
}

// ===== APPROVALS =====
function renderApprovals(){
  const pending=groupReservationRequests(state.data.reservations)
    .filter(request=>request.reservations.some(r=>['pending','under_review'].includes(r.status)));
  document.getElementById('approvals-list').innerHTML=pending.map(request=>{
    const reservations=request.reservations,first=reservations[0];
    const active=reservations.find(r=>['pending','under_review'].includes(r.status))||first;
    const asso=getAsso(first.asso_id);
    const conflicts=reservations.filter(r=>r.status==='under_review'&&computeAvailableForPeriod(r.equip_id,r.date_start,r.date_end,r.id)<r.qty);
    const equipmentRows=reservations.map(r=>{
      const eq=getEquip(r.equip_id),owner=eq?.owner_asso_id?getAsso(eq.owner_asso_id):null;
      const actions=r.status==='under_review'
        ?`<button class="btn btn-primary btn-sm" onclick="decideReservationLine('${r.id}','approved')">Valider cette ligne</button> <button class="btn btn-danger btn-sm" onclick="decideReservationLine('${r.id}','rejected')">Refuser</button>`
        :r.status==='pending'?'En attente du début de l’examen':'—';
      return `<tr><td><strong>${eq?.name||'?'}</strong><div class="approval-meta">${owner?associationIdentity(owner,20):federationIdentity('Matériel fédéral',20)}</div></td><td>${r.qty}</td><td><span class="badge badge-${r.status}">${statusLabel(r.status)}</span></td><td>${actions}</td></tr>`;
    }).join('');
    return `<div class="approval-card" id="acard-${request.id}">
      <div class="approval-header">
        <div>
          <div class="approval-title">Demande de ${associationIdentity(asso,26)}</div>
          <div class="approval-meta">Du ${fmtDate(first.date_start)} au ${fmtDate(first.date_end)} · ${reservations.length} matériel(aux)</div>
          <div class="approval-meta">Lieu : ${first.location||'—'}</div>
        </div>
        <span class="badge badge-${active.status}">${statusLabel(active.status)}</span>
      </div>
      ${conflicts.map(r=>`<div class="alert alert-danger" style="margin:8px 0;">⚠️ ${getEquip(r.equip_id)?.name||'Matériel'} : disponibilité modifiée, ${computeAvailableForPeriod(r.equip_id,r.date_start,r.date_end,r.id)} unité(s) disponible(s), ${r.qty} demandée(s).</div>`).join('')}
      <div class="table-wrap"><table><thead><tr><th>Matériel</th><th>Qté</th><th>Statut</th><th>Décision par ligne</th></tr></thead><tbody>${equipmentRows}</tbody></table></div>
      <div class="approval-reason">Motif : ${first.reason||'—'}</div>
      <div style="margin-bottom:10px;">
        <label class="form-label">Message à joindre à l'email (optionnel)</label>
        <input type="text" class="form-control" id="note-${request.id}" placeholder="Précision pour le demandeur ou les prêteurs">
      </div>
      <div class="approval-actions">
        ${reservations.some(r=>r.status==='pending')?`<button class="btn btn-primary btn-sm" onclick="markReservationUnderReview('${request.id}')">Examiner la demande</button>`:''}
      </div>
    </div>`;
  }).join('')||`<div style="text-align:center;padding:48px;color:var(--text3);"><div style="font-size:36px;margin-bottom:12px;">✅</div><div>Aucune validation en attente</div></div>`;
}
async function decideReservationLine(reservationId,status){
  if(!isAdmin()||!['approved','rejected'].includes(status)) return;
  const reservation=state.data.reservations.find(r=>r.id===reservationId&&r.status==='under_review');
  if(!reservation) return;
  const requestId=reservationRequestId(reservation);
  const note=document.getElementById('note-'+requestId)?.value||'';
  const ok=await dbUpdate('reservations',reservationId,{status,notes:note});
  if(!ok) return;
  reservation.status=status;
  reservation.notes=note;
  const equipment=getEquip(reservation.equip_id);
  const requester=getAsso(reservation.asso_id)?.name||'Association';
  await addHistory(status,`Ligne ${equipment?.name||'Matériel'} × ${reservation.qty} de la demande de ${requester} ${status==='approved'?'validée':'refusée'}`);
  renderSidebar(); renderApprovals();
  const drafts=reservationEmailDrafts(requestId,status,note,reservationId);
  showReservationEmailDrafts(drafts,`Ligne ${equipment?.name||'Matériel'} ${status==='approved'?'validée':'refusée'}`);
}

// ===== ASSOCIATIONS =====
function renderAssociations(){
  const counts={}; state.data.reservations.forEach(r=>{counts[r.asso_id]=(counts[r.asso_id]||0)+1;});
  document.getElementById('assos-tbody').innerHTML=state.data.associations.map(a=>{
    return `<tr><td>${associationIdentity(a)}</td><td>${a.referent}</td><td style="color:var(--info);">${a.email}</td><td>${a.phone}</td><td>${counts[a.id]||0}</td><td><span class="badge ${a.active?'badge-active':'badge-inactive'}">${a.active?'Active':'Suspendue'}</span></td><td><button class="btn btn-sm" onclick="openEditAsso('${a.id}')">Gérer</button></td></tr>`;
  }).join('');
}
async function deleteAsso(id){
  if(!isAdmin()) return;
  const association=getAsso(id); if(!association) return;
  const reservationCount=state.data.reservations.filter(r=>r.asso_id===id).length;
  const ownedEquipment=state.data.equipment.filter(eq=>eq.owner_asso_id===id).length;
  const linkedUsers=state.data.users.filter(user=>user.asso===id);
  const effects=[
    reservationCount?`${reservationCount} réservation(s) associée(s) seront supprimées`:'',
    ownedEquipment?`${ownedEquipment} équipement(s) resteront dans le stock fédéral`:'',
    linkedUsers.length?`${linkedUsers.length} compte(s) utilisateur(s) seront dissociés`:'',
  ].filter(Boolean).join(' ; ');
  if(!confirm(`Supprimer définitivement l’association « ${association.name} » ?${effects?`\n${effects}.`:''}`)) return;
  const {error}=await db.from('associations').delete().eq('id',id);
  if(error){toast('Erreur : '+error.message,5000);console.error(error);return;}
  let accountsError=null;
  if(linkedUsers.length){
    const result=await db.from('users').update({asso:null}).eq('asso',id);
    accountsError=result.error;
  }
  state.data.associations=state.data.associations.filter(a=>a.id!==id);
  state.data.reservations=state.data.reservations.filter(r=>r.asso_id!==id);
  state.data.equipment.forEach(eq=>{if(eq.owner_asso_id===id)eq.owner_asso_id=null;});
  if(!accountsError) state.data.users.forEach(user=>{if(user.asso===id)user.asso=null;});
  await addHistory('deleted',`Association « ${association.name} » supprimée par ${state.currentUser?.name||'?'}`);
  if(accountsError){
    console.error(accountsError);
    toast(`Association supprimée, mais erreur lors de la dissociation des comptes : ${accountsError.message}`,7000);
  } else {
    toast('Association supprimée');
  }
  closeModal('modal-asso'); renderSidebar(); renderPage(state.currentPage);
}
async function toggleAsso(id){
  if(!isAdmin()) return;
  const a=getAsso(id); if(!a) return;
  const active=!a.active;
  const ok=await dbUpdate('associations', id, {active});
  if(!ok) return;
  a.active=active;
  const toggleButton=document.getElementById('asso-toggle-btn');
  toggleButton.textContent=active?'Suspendre l’association':'Réactiver l’association';
  renderSidebar(); renderPage(state.currentPage);
  toast(active?'Association réactivée':'Association suspendue');
}

// ===== ANNUAIRE =====
function renderAnnuaire(){
  const actives=state.data.associations.filter(a=>a.active);
  document.getElementById('annuaire-list').innerHTML=actives.length?actives.map(a=>{
    return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;display:flex;align-items:center;gap:16px;">${associationMark(a,44)}<div style="flex:1;"><div style="font-size:14px;font-weight:600;color:var(--text);">${a.name}</div><div style="font-size:12px;color:var(--text2);margin-top:2px;">Référent : ${a.referent}</div></div><div style="text-align:right;flex-shrink:0;"><div style="font-size:13px;color:var(--accent);">✉️ ${a.email}</div><div style="font-size:12px;color:var(--text2);margin-top:4px;">📞 ${a.phone||'—'}</div></div></div>`;
  }).join(''):`<div style="text-align:center;padding:48px;color:var(--text3);"><div style="font-size:36px;margin-bottom:12px;">🏢</div><div>Aucune association enregistrée.</div></div>`;
}

// ===== HISTORY =====
function renderHistory(){
  const icons={under_review:'🔎',approved:'✅',rejected:'❌',cancelled:'↩️',deleted:'🗑️',created:'📋',stock:'📦',settings:'⚙️'};
  document.getElementById('history-list').innerHTML=state.data.history.map(h=>`<div class="log-item"><div class="log-icon ${h.type}">${icons[h.type]||'ℹ️'}</div><div class="log-body"><div class="log-text">${h.text}</div><div class="log-time">${h.created_at?.slice(0,16).replace('T',' ')} · ${h.user_name}</div></div></div>`).join('')||'<div style="text-align:center;padding:32px;color:var(--text3);">Aucun historique</div>';
}

// ===== MODALS =====
function openModal(id){document.getElementById(id).classList.add('open');}
function closeModal(id){document.getElementById(id).classList.remove('open');}

// ===== NOUVELLE RÉSERVATION =====
function openNewReservation(dateStr=null, equipId=null){
  const assoSel=document.getElementById('new-asso'), assoLabel=document.getElementById('new-asso-label');
  if(isAdmin()){ assoSel.style.display=''; assoLabel.style.display=''; assoSel.innerHTML=state.data.associations.filter(a=>a.active).map(a=>`<option value="${a.id}">${a.name}</option>`).join(''); }
  else { assoSel.style.display='none'; assoLabel.style.display='none'; }
  document.getElementById('new-start').value=dateStr||todayStr();
  document.getElementById('new-end').value=dateStr||todayStr();
  document.getElementById('new-equipment-list').innerHTML='';
  document.getElementById('new-location').value='';
  document.getElementById('new-reason').value='';
  renderAvailableEquipment(equipId);
  openModal('modal-new-reserv'); updateAvailabilityPreview();
}
function renderAvailableEquipment(preselectedId=null){
  const list=document.getElementById('new-equipment-list');
  const start=document.getElementById('new-start').value,end=document.getElementById('new-end').value;
  const previous=new Map([...list.querySelectorAll('tbody .reservation-equipment-item')].map(row=>{
    const checkbox=row.querySelector('input[type="checkbox"]');
    return [checkbox.value,{checked:checkbox.checked,qty:row.querySelector('.reservation-equipment-qty').value}];
  }));
  if(!start||!end||start>end){
    list.innerHTML='<div style="padding:12px;color:var(--text3);">Choisissez une période valide pour afficher le matériel disponible.</div>';
    return;
  }
  const categories={event:'Événementiel',sport:'Sportif',tech:'Technique'};
  const available=state.data.equipment.map(eq=>({eq,qty:computeAvailableForPeriod(eq.id,start,end)}))
    .sort((a,b)=>a.eq.name.localeCompare(b.eq.name,'fr',{sensitivity:'base'}));
  list.innerHTML=available.length?`<div class="table-wrap reservation-equipment-table-wrap"><table class="reservation-equipment-table">
    <thead><tr><th>Équipement</th><th>Catégorie</th><th>Total</th><th>Disponibilité</th><th>État</th><th>Qté</th><th>Réserver</th></tr></thead>
    <tbody>${available.map(({eq,qty})=>{
    const owner=eq.owner_asso_id?getAsso(eq.owner_asso_id):null,selection=previous.get(eq.id);
    const selected=qty>0&&(selection?selection.checked:eq.id===preselectedId);
    const amount=qty?Math.min(Math.max(parseInt(selection?.qty||'1',10)||1,1),qty):1;
    const pct=eq.total?Math.round(qty/eq.total*100):0;
    const progressClass=pct<20?'danger':pct<40?'warn':'';
    return `<tr class="reservation-equipment-item">
      <td><strong>${eq.name}</strong><div class="reservation-equipment-meta">${owner?associationIdentity(owner,20):federationIdentity('Matériel fédéral',20)}</div></td>
      <td>${categories[eq.cat]||eq.cat}</td><td>${eq.total}</td>
      <td><div class="progress-wrap"><span>${qty}</span><div class="progress-bar"><div class="progress-fill ${progressClass}" style="width:${pct}%"></div></div><span class="progress-num">${pct}%</span></div></td>
      <td>${eq.state||'—'}</td>
      <td><input class="reservation-equipment-qty" type="number" min="1" max="${Math.max(qty,1)}" value="${amount}" aria-label="Quantité pour ${eq.name}" ${selected?'':'disabled'}></td>
      <td><input type="checkbox" id="reserve-equip-${eq.id}" value="${eq.id}" aria-label="Réserver ${eq.name}" ${selected?'checked':''} ${qty===0?'disabled':''} onchange="updateAvailabilityPreview()"></td>
    </tr>`;
  }).join('')}</tbody></table></div>`:'<div style="padding:12px;color:var(--text3);">Aucun matériel en stock.</div>';
}
function updateAvailabilityPreview(){
  const start=document.getElementById('new-start').value,end=document.getElementById('new-end').value,el=document.getElementById('avail-preview');
  renderAvailableEquipment();
  const rows=[...document.querySelectorAll('#new-equipment-list .reservation-equipment-item')];
  rows.forEach(row=>{
    const checkbox=row.querySelector('input[type="checkbox"]'),qty=row.querySelector('.reservation-equipment-qty');
    qty.disabled=!checkbox.checked;
  });
  const selected=rows.filter(row=>row.querySelector('input[type="checkbox"]').checked).length;
  const validPeriod=start&&end&&start<=end;
  if(!validPeriod){el.className='alert alert-warn';el.textContent='La date de fin doit être égale ou postérieure à la date de début.';el.style.display='';}
  else if(selected){el.className='alert alert-success';el.textContent=`${selected} équipement${selected>1?'s':''} sélectionné${selected>1?'s':''} sur cette période.`;el.style.display='';}
  else{
    const available=rows.filter(row=>!row.querySelector('input[type="checkbox"]').disabled).length;
    el.className=available?'alert':'alert alert-warn';
    el.textContent=available?`${available} équipement${available>1?'s':''} disponible${available>1?'s':''} parmi ${rows.length} en stock.`:'Aucun équipement disponible sur cette période.';
    el.style.display='';
  }
}
async function submitNewReservation(){
  const assoId=isAdmin()?document.getElementById('new-asso').value:state.currentUser.asso;
  const start=document.getElementById('new-start').value,end=document.getElementById('new-end').value,location=document.getElementById('new-location').value.trim(),reason=document.getElementById('new-reason').value.trim();
  const selected=[...document.querySelectorAll('#new-equipment-list .reservation-equipment-item')]
    .map(row=>({checkbox:row.querySelector('input[type="checkbox"]'),qtyInput:row.querySelector('.reservation-equipment-qty')}))
    .filter(item=>item.checkbox.checked)
    .map(item=>({equipId:item.checkbox.value,qty:parseInt(item.qtyInput.value,10)}));
  if(!selected.length||!assoId||!start||!end||!location||!reason){toast('Renseignez les dates, le lieu, le motif et cochez au moins un matériel.');return;}
  if(start>end){toast('La date de début doit être avant la date de fin.');return;}
  const invalid=selected.find(item=>!Number.isInteger(item.qty)||item.qty<1||item.qty>computeAvailableForPeriod(item.equipId,start,end));
  if(invalid){const available=computeAvailableForPeriod(invalid.equipId,start,end);toast(`La quantité pour ${getEquip(invalid.equipId).name} est limitée à ${available} disponible(s).`);return;}
  const createdAt=new Date().toISOString();
  const requestId=uid();
  const reservations=selected.map(item=>({id:uid(),request_id:requestId,equip_id:item.equipId,qty:item.qty,asso_id:assoId,date_start:start,date_end:end,location,reason,status:'pending',created_at:createdAt,notes:''}));
  const ok=await dbInsert('reservations', reservations); if(!ok) return;
  state.data.reservations.push(...reservations);
  await addHistory('created',`Demande de réservation de ${reservations.length} matériel(aux) (${getAsso(assoId)?.name}) soumise`);
  closeModal('modal-new-reserv'); renderSidebar();
  toast('✓ Demande soumise à la validation de l’administrateur.',5000);
  navigate('reservations');
}

// ===== ÉQUIPEMENTS =====
function openAddEquip(){
  document.getElementById('equip-modal-title').textContent='Ajouter un équipement';
  document.getElementById('equip-delete-btn').style.display='none';
  ['equip-id','equip-name','equip-location','equip-notes'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('equip-cat').value='event'; document.getElementById('equip-total').value=1; document.getElementById('equip-state').value='Bon état';
  const os=document.getElementById('equip-owner'); os.innerHTML='<option value="">— Fédération —</option>'+state.data.associations.map(a=>`<option value="${a.id}">${a.name}</option>`).join(''); os.value='';
  openModal('modal-equip');
}
function openEditEquip(id){
  const eq=getEquip(id); if(!eq) return;
  document.getElementById('equip-modal-title').textContent='Modifier un équipement';
  document.getElementById('equip-delete-btn').style.display='';
  document.getElementById('equip-id').value=eq.id; document.getElementById('equip-name').value=eq.name; document.getElementById('equip-cat').value=eq.cat;
  document.getElementById('equip-total').value=eq.total; document.getElementById('equip-state').value=eq.state;
  document.getElementById('equip-location').value=eq.location||''; document.getElementById('equip-notes').value=eq.notes||'';
  const os=document.getElementById('equip-owner'); os.innerHTML='<option value="">— Fédération —</option>'+state.data.associations.map(a=>`<option value="${a.id}">${a.name}</option>`).join(''); os.value=eq.owner_asso_id||'';
  openModal('modal-equip');
}
async function submitEquip(){
  const id=document.getElementById('equip-id').value,name=document.getElementById('equip-name').value.trim();
  if(!name){toast('Veuillez saisir un nom.');return;}
  const data={name,cat:document.getElementById('equip-cat').value,total:parseInt(document.getElementById('equip-total').value)||1,state:document.getElementById('equip-state').value,location:document.getElementById('equip-location').value.trim(),notes:document.getElementById('equip-notes').value.trim(),owner_asso_id:document.getElementById('equip-owner').value||null};
  if(id){ await dbUpdate('equipment', id, data); Object.assign(getEquip(id),data); await addHistory('stock',`Équipement "${name}" modifié`); }
  else { const newEq={id:uid(),...data}; await dbInsert('equipment', newEq); state.data.equipment.push(newEq); await addHistory('stock',`Équipement "${name}" ajouté`); }
  closeModal('modal-equip'); renderStock(); toast('✓ Équipement enregistré');
}
async function deleteEquip(id){
  if(!isAdmin()) return;
  const equipment=getEquip(id); if(!equipment) return;
  const reservations=state.data.reservations.filter(r=>r.equip_id===id);
  if(!confirm(`Supprimer définitivement l’équipement « ${equipment.name} » ?${reservations.length?`\nSes ${reservations.length} ligne(s) de réservation seront également supprimées.`:''}`)) return;
  const ok=await dbDelete('equipment',id); if(!ok) return;
  state.data.equipment=state.data.equipment.filter(eq=>eq.id!==id);
  state.data.reservations=state.data.reservations.filter(r=>r.equip_id!==id);
  await addHistory('deleted',`Équipement « ${equipment.name} » supprimé par ${state.currentUser?.name||'?'}`);
  closeModal('modal-equip'); renderSidebar(); renderPage(state.currentPage); toast('Équipement supprimé');
}

// ===== ASSOCIATIONS MODAL =====
function openAddAsso(){
  document.getElementById('asso-modal-title').textContent='Ajouter une association';
  document.getElementById('asso-delete-btn').style.display='none';
  document.getElementById('asso-toggle-btn').style.display='none';
  ['asso-id','asso-name','asso-referent','asso-email','asso-phone'].forEach(id=>document.getElementById(id).value='');
  resetAssociationLogoForm(null);
  openModal('modal-asso');
}
function openEditAsso(id){
  const a=getAsso(id); if(!a)return;
  document.getElementById('asso-modal-title').textContent='Gérer l’association';
  document.getElementById('asso-delete-btn').style.display='';
  const toggleButton=document.getElementById('asso-toggle-btn');
  toggleButton.style.display='';
  toggleButton.textContent=a.active?'Suspendre l’association':'Réactiver l’association';
  document.getElementById('asso-id').value=a.id;
  document.getElementById('asso-name').value=a.name;
  document.getElementById('asso-referent').value=a.referent;
  document.getElementById('asso-email').value=a.email;
  document.getElementById('asso-phone').value=a.phone;
  resetAssociationLogoForm(a);
  openModal('modal-asso');
}
function resetAssociationLogoForm(association){
  pendingAssociationLogo=null;
  removeAssociationLogo=false;
  document.getElementById('asso-logo-base64').value='';
  document.getElementById('asso-logo-remove').checked=false;
  document.getElementById('asso-logo-remove-wrap').style.display=association?.logo?'':'none';
  document.getElementById('asso-logo-preview').innerHTML=associationMark(association,56);
}
function toggleAssociationLogoRemoval(remove){
  if(!isAdmin()) return;
  removeAssociationLogo=remove;
  if(remove) pendingAssociationLogo=null;
  const association=getAsso(document.getElementById('asso-id').value);
  document.getElementById('asso-logo-preview').innerHTML=associationMark(
    {logo:remove?null:(pendingAssociationLogo||association?.logo)},56
  );
}
async function selectAssociationLogo(value){
  if(!isAdmin()) return;
  const input=document.getElementById('asso-logo-base64');
  try{
    const inputValue=String(value||'').trim();
    if(!inputValue) throw new Error('Collez le Base64 du logo avant de le prévisualiser.');
    const dataUrlMatch=inputValue.match(/^data:image\/(jpeg|png|gif|webp);base64,([\s\S]+)$/i);
    const payload=(dataUrlMatch?dataUrlMatch[2]:inputValue).replace(/\s/g,'');
    if(payload.length>Math.ceil(5*1024*1024*4/3)+4) throw new Error('Le logo Base64 dépasse la taille maximale de 5 Mo.');
    if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload)){
      throw new Error('Le texte collé n’est pas un Base64 valide.');
    }
    const binary=atob(payload);
    if(binary.length>5*1024*1024) throw new Error('Le logo Base64 dépasse la taille maximale de 5 Mo.');
    const bytes=Uint8Array.from(binary,char=>char.charCodeAt(0));
    const isJpeg=bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
    const isPng=bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47&&bytes[4]===0x0d&&bytes[5]===0x0a&&bytes[6]===0x1a&&bytes[7]===0x0a;
    const isGif=String.fromCharCode(...bytes.slice(0,6))==='GIF87a'||String.fromCharCode(...bytes.slice(0,6))==='GIF89a';
    const isWebp=String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
    const detectedType=isJpeg?'jpeg':isPng?'png':isGif?'gif':isWebp?'webp':null;
    if(!detectedType) throw new Error('Le Base64 doit contenir une image JPEG, PNG, GIF ou WebP.');
    if(dataUrlMatch&&dataUrlMatch[1].toLowerCase()!==detectedType){
      throw new Error('Le format déclaré dans le data URL ne correspond pas à l’image.');
    }
    const logo=`data:image/${detectedType};base64,${payload}`;
    const image=await createImageBitmap(new Blob([bytes],{type:`image/${detectedType}`}));
    image.close();
    pendingAssociationLogo=logo;
    removeAssociationLogo=false;
    document.getElementById('asso-logo-remove').checked=false;
    document.getElementById('asso-logo-preview').innerHTML=associationMark({logo},56);
  }catch(error){
    console.error('Logo association :',error);
    toast(error.message||'Impossible de lire ce logo Base64.',5000);
  }
}
async function submitAsso(){
  const id=document.getElementById('asso-id').value,name=document.getElementById('asso-name').value.trim(),referent=document.getElementById('asso-referent').value.trim(),email=document.getElementById('asso-email').value.trim(),phone=document.getElementById('asso-phone').value.trim();
  if(!name||!referent||!email){toast('Nom, référent et email obligatoires.');return;}
  const updates={name,referent,email,phone};
  if(isAdmin()&&(pendingAssociationLogo||removeAssociationLogo)) updates.logo=removeAssociationLogo?null:pendingAssociationLogo;
  if(id){
    const {error}=await db.from('associations').update(updates).eq('id',id);
    if(error){
      console.error(error);
      toast(isMissingAssociationLogoColumn(error)&&'logo'in updates?'Ajoutez d’abord la colonne logo à la table associations avec la migration Supabase.':`Erreur : ${error.message}`,7000);
      return;
    }
    Object.assign(getAsso(id),updates);
    sortAssociations();
  }else{
    const newAsso={id:uid(),name,referent,email,phone,active:true,color:'#ffffff'};
    if(isAdmin()&&pendingAssociationLogo) newAsso.logo=pendingAssociationLogo;
    const {error}=await db.from('associations').insert(newAsso);
    if(error){
      console.error(error);
      toast(isMissingAssociationLogoColumn(error)&&'logo'in newAsso?'Ajoutez d’abord la colonne logo à la table associations avec la migration Supabase.':`Erreur : ${error.message}`,7000);
      return;
    }
    state.data.associations.push(newAsso);
    sortAssociations();
  }
  pendingAssociationLogo=null; removeAssociationLogo=false;
  closeModal('modal-asso'); renderSidebar(); renderPage(state.currentPage); toast('✓ Association enregistrée');
}

// ===== PROFIL =====
function renderProfile(){
  const u=state.currentUser, a=currentAsso();
  document.getElementById('profile-name-display').textContent=u.name;
  document.getElementById('profile-name-input').value=u.name;
  document.getElementById('profile-login').textContent=u.login;
  document.getElementById('profile-role').textContent=isAdmin()?'Administrateur fédéral':'Association membre';
  document.getElementById('profile-asso-name').innerHTML=associationIdentity(a);
  document.getElementById('profile-asso-row').style.display=a?'':'none';
  document.getElementById('profile-name-success').style.display='none';
  ['pw-current','pw-new','pw-confirm'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('pw-error').style.display='none'; document.getElementById('pw-success').style.display='none';
}
async function submitChangeName(){
  const n=document.getElementById('profile-name-input').value.trim(); if(!n){toast('Le nom ne peut pas être vide.');return;}
  await dbUpdate('users', state.currentUser.id, {name:n});
  const u=state.data.users.find(u=>u.id===state.currentUser.id); u.name=n; state.currentUser.name=n;
  renderSidebar(); document.getElementById('profile-name-display').textContent=n;
  document.getElementById('profile-name-success').style.display='';
  await addHistory('created',`Nom modifié → "${n}"`); toast('✓ Nom mis à jour');
}
async function submitChangePassword(){
  const cur=document.getElementById('pw-current').value,np=document.getElementById('pw-new').value,cf=document.getElementById('pw-confirm').value;
  const err=document.getElementById('pw-error'), ok=document.getElementById('pw-success');
  err.style.display='none'; ok.style.display='none';
  if(cur!==state.currentUser.password){err.textContent='Mot de passe actuel incorrect.';err.style.display='';return;}
  if(np.length<6){err.textContent='Minimum 6 caractères.';err.style.display='';return;}
  if(np!==cf){err.textContent='Les mots de passe ne correspondent pas.';err.style.display='';return;}
  await dbUpdate('users', state.currentUser.id, {password:np});
  const u=state.data.users.find(u=>u.id===state.currentUser.id); u.password=np; state.currentUser.password=np;
  await addHistory('created',`Mot de passe modifié pour "${u.login}"`);
  ['pw-current','pw-new','pw-confirm'].forEach(id=>document.getElementById(id).value=''); ok.style.display=''; toast('✓ Mot de passe mis à jour');
}

// ===== COMPTES (ADMIN) =====
function escapeHtml(value){
  return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
function renderComptes(){
  document.getElementById('comptes-tbody').innerHTML=state.data.users.map(u=>{
    const a=u.asso?getAsso(u.asso):null;
    return `<tr>
      <td><strong>${u.name}</strong></td>
      <td><code style="background:var(--surface2);padding:2px 7px;border-radius:4px;font-size:12px;">${u.login}</code></td>
      <td><span class="user-role-badge ${u.role==='admin'?'role-admin':'role-asso'}">${u.role==='admin'?'Administrateur':'Association'}</span></td>
      <td>${associationIdentity(a)}</td>
      <td><code>${escapeHtml(u.password)}</code></td>
      <td style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="btn btn-sm" onclick="openAdminChangePw('${u.id}')">🔑 Changement mdp</button>
      </td>
    </tr>`;
  }).join('');
}

// --- Créer un nouveau compte (admin) ---
function openAddUser(){
  ['new-user-name','new-user-login','new-user-pw','new-user-pw-confirm'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('new-user-role').value='asso';
  document.getElementById('new-user-asso-group').style.display='';
  document.getElementById('new-user-error').style.display='none';
  const sel=document.getElementById('new-user-asso');
  sel.innerHTML='<option value="">— Aucune —</option>'+state.data.associations.map(a=>`<option value="${a.id}">${a.name}</option>`).join('');
  openModal('modal-new-user');
}
function onNewUserRoleChange(){
  document.getElementById('new-user-asso-group').style.display=document.getElementById('new-user-role').value==='asso'?'':'none';
}
async function submitNewUser(){
  const name  = document.getElementById('new-user-name').value.trim();
  const login = document.getElementById('new-user-login').value.trim();
  const pw    = document.getElementById('new-user-pw').value;
  const pw2   = document.getElementById('new-user-pw-confirm').value;
  const role  = document.getElementById('new-user-role').value;
  const asso  = role==='asso'?(document.getElementById('new-user-asso').value||null):null;
  const err   = document.getElementById('new-user-error');
  err.style.display='none';
  if(!name)             { err.textContent='Le nom est obligatoire.';                          err.style.display=''; return; }
  if(!login)            { err.textContent='L\'identifiant est obligatoire.';                  err.style.display=''; return; }
  if(state.data.users.find(u=>u.login===login)){ err.textContent='Cet identifiant est déjà utilisé.'; err.style.display=''; return; }
  if(pw.length<6)       { err.textContent='Mot de passe : 6 caractères minimum.';             err.style.display=''; return; }
  if(pw!==pw2)          { err.textContent='Les mots de passe ne correspondent pas.';          err.style.display=''; return; }
  const newUser={id:uid(), name, login, password:pw, role, asso};
  const ok=await dbInsert('users', newUser); if(!ok) return;
  state.data.users.push(newUser);
  await addHistory('created',`Nouveau compte créé : "${login}" (${role==='admin'?'Administrateur':'Association'})`);
  closeModal('modal-new-user'); renderComptes();
  toast(`✓ Compte "${login}" créé avec succès`);
}

// --- Réinitialiser mot de passe (admin) ---
function openAdminChangePw(userId){
  const u=state.data.users.find(u=>u.id===userId); if(!u) return;
  document.getElementById('admin-pw-user-id').value=userId;
  document.getElementById('admin-pw-user-label').textContent=`Compte : ${u.name} (${u.login})`;
  document.getElementById('admin-pw-delete-btn').style.display=u.id===state.currentUser.id?'none':'';
  document.getElementById('admin-pw-new').value=''; document.getElementById('admin-pw-confirm').value='';
  document.getElementById('admin-pw-error').style.display='none'; openModal('modal-admin-pw');
}
async function submitAdminChangePw(){
  const userId=document.getElementById('admin-pw-user-id').value,np=document.getElementById('admin-pw-new').value,cf=document.getElementById('admin-pw-confirm').value,err=document.getElementById('admin-pw-error');
  err.style.display='none';
  if(np.length<6){err.textContent='Minimum 6 caractères.';err.style.display='';return;}
  if(np!==cf){err.textContent='Les mots de passe ne correspondent pas.';err.style.display='';return;}
  await dbUpdate('users', userId, {password:np});
  const u=state.data.users.find(u=>u.id===userId); u.password=np;
  if(state.currentUser.id===userId) state.currentUser.password=np;
  await addHistory('created',`Mot de passe réinitialisé pour "${u.login}" par l'admin`);
  closeModal('modal-admin-pw'); toast(`✓ Mot de passe de ${u.name} mis à jour`);
}

// --- Supprimer un compte ---
async function deleteUser(userId){
  const u=state.data.users.find(u=>u.id===userId); if(!u) return;
  if(!confirm(`Supprimer le compte "${u.login}" (${u.name}) ?\nCette action est irréversible.`)) return;
  const deleted=await dbDelete('users', userId); if(!deleted) return;
  state.data.users=state.data.users.filter(u=>u.id!==userId);
  await addHistory('created',`Compte "${u.login}" supprimé par l'admin`);
  closeModal('modal-admin-pw');
  renderComptes(); toast(`Compte ${u.login} supprimé`);
}

// ===== LOGIN =====
function showLogin(){document.getElementById('login-page').style.display='flex';document.getElementById('app-page').style.display='none';}
function showApp(){document.getElementById('login-page').style.display='none';document.getElementById('app-page').style.display='flex';renderSidebar();navigate('dashboard');}
async function loginSubmit(){
  const login=document.getElementById('login-user').value.trim(),pass=document.getElementById('login-pass').value;
  document.getElementById('login-error').style.display='none';
  if(await tryLogin(login,pass)){showApp();}else{document.getElementById('login-error').style.display='';document.getElementById('login-pass').value='';}
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('login-pass').addEventListener('keydown',e=>{if(e.key==='Enter')loginSubmit();});
  document.getElementById('login-user').addEventListener('keydown',e=>{if(e.key==='Enter')loginSubmit();});
  const loaded = await loadData();
  if(!loaded){showLogin();return;}
  if(tryAutoLogin()){showApp();}else{showLogin();}
  subscribeRealtime();
});
