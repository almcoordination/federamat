# Guide de configuration Supabase — FédéraMat

## 1. Créer un projet Supabase

1. Allez sur https://supabase.com et créez un compte gratuit
2. Cliquez **New project**, donnez-lui un nom (ex: `federamat`)
3. Notez bien votre **mot de passe de base de données**
4. Attendez ~2 minutes que le projet se lance

## 2. Récupérer vos clés API

Dans votre projet Supabase → **Settings → API** :

- Copiez **Project URL** → c'est votre `SUPABASE_URL`
- Copiez **anon / public** → c'est votre `SUPABASE_ANON_KEY`

Collez ces deux valeurs dans `js/app.js` (lignes 4 et 5) :

```javascript
const SUPABASE_URL      = 'https://xxxx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJxxxx...';
```

## 3. Créer les tables

Dans Supabase → **SQL Editor** → **New query**, collez et exécutez ce script :

```sql
-- Table des paramètres
create table if not exists settings (
  id text primary key default 'main',
  app_name text default 'A.L.M. Coordination',
  app_tagline text default 'Gestion mutualisée du matériel',
  admin_email text default ''
);
insert into settings (id) values ('main') on conflict do nothing;

-- Table des utilisateurs
create table if not exists users (
  id text primary key,
  name text not null,
  login text not null unique,
  password text not null,
  role text not null default 'asso',
  asso text
);
-- Compte admin par défaut (login: admin / mdp: admin123)
insert into users (id, name, login, password, role, asso)
values ('u0', 'Administrateur', 'admin', 'admin123', 'admin', null)
on conflict do nothing;

-- Table des associations
create table if not exists associations (
  id text primary key,
  name text not null,
  referent text,
  email text,
  phone text,
  active boolean default true,
  color text default '#1D9E75',
  logo text
);

-- Table des équipements
create table if not exists equipment (
  id text primary key,
  name text not null,
  cat text default 'event',
  total integer default 1,
  state text default 'Bon état',
  location text,
  notes text,
  owner_asso_id text references associations(id) on delete set null
);

-- Table des réservations
create table if not exists reservations (
  id text primary key,
  request_id text,
  equip_id text references equipment(id) on delete cascade,
  asso_id text references associations(id) on delete cascade,
  qty integer default 1,
  date_start text,
  date_end text,
  location text,
  reason text,
  status text default 'pending',
  notes text,
  created_at timestamptz default now()
);
create index if not exists reservations_request_id_idx on reservations(request_id);

-- Table de l'historique
create table if not exists history (
  id text primary key,
  type text,
  text text,
  user_name text,
  created_at timestamptz default now()
);
```

Si la table `reservations` existe déjà, exécutez aussi cette migration dans le SQL Editor :

```sql
alter table reservations add column if not exists request_id text;
alter table reservations add column if not exists location text;
create index if not exists reservations_request_id_idx on reservations(request_id);
```

Pour activer l’enregistrement des logos Base64 sur une base existante, exécutez aussi :

```sql
alter table associations add column if not exists logo text;
```

Dans la gestion d’une association, l’administrateur peut coller une image Base64 brute ou un data URL JPEG, PNG, GIF ou WebP. L’application valide l’image et enregistre sa représentation Base64 dans `associations.logo`.

## 4. Configurer les permissions (RLS)

Dans Supabase → **SQL Editor**, exécutez :

```sql
-- Activer Row Level Security sur toutes les tables
alter table settings     enable row level security;
alter table users        enable row level security;
alter table associations enable row level security;
alter table equipment    enable row level security;
alter table reservations enable row level security;
alter table history      enable row level security;

-- Autoriser toutes les opérations avec la clé anon
-- (l'authentification est gérée par l'application elle-même)
create policy "allow_all_settings"     on settings     for all using (true) with check (true);
create policy "allow_all_users"        on users        for all using (true) with check (true);
create policy "allow_all_associations" on associations for all using (true) with check (true);
create policy "allow_all_equipment"    on equipment    for all using (true) with check (true);
create policy "allow_all_reservations" on reservations for all using (true) with check (true);
create policy "allow_all_history"      on history      for all using (true) with check (true);
```

## 5. Activer le temps réel

Dans Supabase → **Database → Replication** :
- Activez la réplication pour les tables : `users`, `associations`, `equipment`, `reservations`, `history`

## 6. Lancer l'application

Ouvrez `index.html` dans votre navigateur (ou hébergez les fichiers sur un serveur web).

**Connexion par défaut :**
- Identifiant : `admin`
- Mot de passe : `admin123`

⚠️ **Changez le mot de passe admin dès la première connexion !**

---

## Récapitulatif des nouvelles fonctionnalités

### Création de comptes (module Comptes)
- Bouton **+ Créer un compte** en haut du tableau
- Formulaire : nom, identifiant, mot de passe (×2), rôle, association liée
- Validation : identifiant unique, mot de passe ≥ 6 caractères
- Suppression d'un compte avec confirmation

### Synchronisation Supabase
- Toutes les données sont stockées dans la base Supabase
- **Temps réel** : si l'admin crée un compte ou approuve une réservation,
  tous les utilisateurs connectés voient la mise à jour instantanément
- Le compte admin par défaut est créé automatiquement au premier setup

### Demande de réservation
- Le formulaire demande les dates, le lieu et le motif, puis permet de cocher le matériel en stock.
- L'administrateur approuve ou refuse la demande complète en une seule fois.
- En cas de refus, le demandeur reçoit le récapitulatif de sa demande.
- En cas d'approbation, chaque association propriétaire reçoit uniquement la liste du matériel qu'elle doit prêter.
- Pour une base existante, appliquez la migration `request_id` et `location` décrite à l'étape 3.
- La fonction Netlify d'envoi d'emails nécessite `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GMAIL_USER` et `GMAIL_APP_PASSWORD` dans les variables d'environnement Netlify.
