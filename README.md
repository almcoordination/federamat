# FédéraMat — Système de gestion mutualisée du matériel

Application web complète pour la gestion du stock et des réservations de matériel au sein d'une fédération d'associations.

---

## 🚀 Installation & démarrage

### Option 1 — Ouverture directe (test local)
Double-cliquez sur `index.html` pour ouvrir l'application dans votre navigateur.
> ⚠️ Certains navigateurs bloquent le localStorage en fichier local. Dans ce cas, utilisez l'option 2.

### Option 2 — Serveur local simple (recommandé)
```bash
# Avec Python (installé par défaut sur Mac/Linux)
cd federamat/
python3 -m http.server 8080
# Puis ouvrez http://localhost:8080

# Avec Node.js
npx serve .
```

### Option 3 — Hébergement web
Uploadez tous les fichiers sur votre hébergeur (OVH, Infomaniak, etc.) ou déployez sur :
- **Netlify** : connectez le dépôt GitHub comme hébergement alternatif
- **Vercel** : `vercel --prod`
- **GitHub Pages** : push le dossier, activez Pages dans les paramètres

### Emails et GitHub Pages

Les emails ne sont pas envoyés automatiquement. Après le passage d’une réservation en examen ou après une décision, l’application propose des brouillons Gmail adaptés aux associations concernées. Lors d’une approbation, le brouillon du demandeur est proposé en premier, puis celui du propriétaire du matériel ; en cas de refus, le demandeur reçoit le brouillon. La rubrique **Message collectif** prépare aussi un brouillon adressé en copie cachée aux associations actives. Ouvrez chaque brouillon, vérifiez-le puis cliquez sur « Envoyer » dans Gmail. Ces fonctions sont compatibles avec GitHub Pages et ne nécessitent pas de backend.

Si l'application affiche une erreur de connexion, ouvrez la console du navigateur (`F12`) : le message Supabase indique maintenant la table ou la permission en cause. Vérifiez aussi que l'URL du projet et la clé publique dans `js/app.js` correspondent au même projet.

> Important : cette version utilise une authentification applicative et stocke les mots de passe dans la table `users`. Les règles RLS « allow all » rendent ces données accessibles à toute personne possédant la clé publique. Pour un usage réel, migrez les comptes vers Supabase Auth et restreignez les politiques RLS avant de diffuser l'URL.

---

## 🔐 Comptes de démonstration

| Identifiant | Mot de passe | Rôle | Association |
|---|---|---|---|
| `admin` | `admin123` | Administrateur fédéral | — |
| `soleil` | `soleil123` | Membre | Asso Soleil |
| `sport` | `sport123` | Membre | Sport Club |
| `jeunes` | `jeunes123` | Membre | Jeunes Actifs |
| `cine` | `cine123` | Membre | Ciné Asso |
| `culture` | `culture123` | Membre | Culture&Co |
| `tech` | `tech123` | Membre | Tech Lab |
| `enviro` | `enviro123` | Membre | EnviroClub |
| `aide` | `aide123` | Membre | Aide & Lien |

---

## ✨ Fonctionnalités

### 🛡️ Administrateur fédéral
- **Tableau de bord** : statistiques globales, alertes stock, demandes en attente
- **Calendrier** : vue mensuelle de toutes les réservations par couleur
- **Stock & inventaire** : gestion complète (ajout, modification, suivi disponibilité)
- **Réservations** : historique global avec filtres par statut
- **Validations** : approbation/refus des demandes avec détection de conflits
- **Associations** : gestion des membres (ajout, modification, suspension)
- **Message collectif** : préparation d’un brouillon Gmail adressé en copie cachée aux associations actives
- **Historique** : journal complet de toutes les activités

### 🏢 Association membre
- **Tableau de bord** : vue de ses propres réservations et alertes stock
- **Calendrier** : ses réservations uniquement
- **Stock** : consultation du stock disponible + bouton "Réserver"
- **Réservations** : ses demandes avec possibilité d'annulation
- **Historique** : journal des activités

---

## 🗂️ Structure des fichiers

```
federamat/
├── index.html          # Application complète (shell + pages)
├── css/
│   └── style.css       # Styles et thème
├── js/
│   └── app.js          # Logique métier, données, rendu
└── README.md           # Ce fichier
```

---

## 💾 Données & persistance

Les données sont stockées dans le **localStorage** du navigateur. Elles persistent entre les sessions sur le même appareil/navigateur.

Pour **remettre à zéro** les données : ouvrez la console du navigateur (F12) et tapez :
```javascript
localStorage.removeItem('federamat_data'); location.reload();
```

---

## 🔧 Personnalisation

### Modifier les associations et équipements par défaut
Éditez la section `INITIAL_DATA` dans `js/app.js` (lignes 5–75).

### Changer les couleurs
Modifiez les variables CSS dans `css/style.css` (section `:root`).

### Ajouter des utilisateurs
Ajoutez des entrées dans le tableau `users` de `INITIAL_DATA` dans `js/app.js`.

---

## 🔮 Évolutions possibles (V2)
- Base de données côté serveur (Supabase, Firebase, ou backend PHP/Node)
- Notifications email réelles (SMTP ou Sendgrid)
- Export PDF/Excel des réservations
- Application mobile (PWA)
- Signature numérique au retour du matériel
- Gestion des dépôts de garantie

---

## 📞 Support
Application créée avec FédéraMat v1.0 — Gestion mutualisée du matériel associatif.
