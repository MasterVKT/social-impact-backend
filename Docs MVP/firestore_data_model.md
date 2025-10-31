# Modèle de Données Firestore - Schémas Complets
## Social Finance Impact Platform MVP

## 1. Architecture de données générale

### 1.1 Conventions de nommage

**Collections** : `snake_case` (users, projects, notifications)
**Documents** : Identifiants générés automatiquement ou UIDs Firebase Auth
**Champs** : `camelCase` (firstName, createdAt, kycStatus)
**Énumérations** : `snake_case` (user_type: "contributor", "creator")

### 1.2 Champs automatiques

Tous les documents incluent automatiquement :
```typescript
interface BaseDocument {
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
  version: number; // Incrémenté à chaque modification
}
```

### 1.3 Soft delete

Les suppressions logiques utilisent le champ :
```typescript
interface SoftDeletable {
  deleted: boolean;
  deletedAt?: FirebaseFirestore.Timestamp;
  deletedBy?: string; // UID de l'utilisateur
}
```

## 2. Collection Users

### 2.1 Structure du document user

**Path** : `/users/{uid}`

```typescript
interface UserDocument extends BaseDocument {
  // Identité principale
  uid: string; // UID Firebase Auth
  email: string; // Synchronisé avec Firebase Auth
  firstName: string; // 2-50 caractères
  lastName: string; // 2-50 caractères
  displayName: string; // Générée automatiquement
  profilePicture?: string; // URL Firebase Storage
  bio?: string; // Maximum 500 caractères
  
  // Type et rôle
  userType: 'contributor' | 'creator' | 'auditor' | 'admin';
  permissions: string[]; // Calculées selon userType
  
  // Informations personnelles
  phoneNumber?: string; // Format international +33...
  dateOfBirth?: string; // Format ISO YYYY-MM-DD
  gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say';
  
  // Adresse
  address?: {
    street?: string;
    city?: string;
    postalCode?: string;
    country: string; // Code ISO 3166-1 alpha-2
    coordinates?: {
      latitude: number;
      longitude: number;
    };
  };
  
  // Statut KYC
  kyc: {
    status: 'pending' | 'approved' | 'rejected' | 'expired';
    level: 0 | 1 | 2; // 0=none, 1=basic, 2=enhanced
    provider: 'sumsub';
    externalId?: string; // ID chez Sumsub
    submittedAt?: FirebaseFirestore.Timestamp;
    approvedAt?: FirebaseFirestore.Timestamp;
    expiresAt?: FirebaseFirestore.Timestamp;
    rejectionReason?: string;
    documents: {
      type: 'passport' | 'id_card' | 'driving_license' | 'proof_of_address';
      status: 'pending' | 'approved' | 'rejected';
      submittedAt: FirebaseFirestore.Timestamp;
      fileName?: string;
      storageUrl?: string; // Firebase Storage path
    }[];
  };
  
  // Préférences utilisateur
  preferences: {
    language: 'fr' | 'en';
    currency: 'EUR';
    timezone?: string; // Format IANA
    notifications: {
      email: boolean;
      push: boolean;
      inApp: boolean;
      frequency: 'immediate' | 'daily' | 'weekly';
    };
    privacy: {
      profilePublic: boolean;
      showContributions: boolean;
      allowContact: boolean;
    };
    interests: {
      categories: ('environment' | 'education' | 'health' | 'community' | 'innovation')[];
      causes?: string[];
    };
  };
  
  // Statistiques d'activité
  stats: {
    // Statistiques contributeur
    totalContributed: number; // Montant total en centimes
    projectsSupported: number;
    averageContribution: number;
    lastContributionAt?: FirebaseFirestore.Timestamp;
    
    // Statistiques créateur
    projectsCreated: number;
    totalFundsRaised: number; // En centimes
    successfulProjects: number;
    averageProjectSize: number;
    lastProjectAt?: FirebaseFirestore.Timestamp;
    
    // Statistiques auditeur
    auditsCompleted: number;
    averageAuditTime: number; // En heures
    approvalRate: number; // Pourcentage 0-100
    totalEarnings: number; // En centimes
    lastAuditAt?: FirebaseFirestore.Timestamp;
    
    // Engagement général
    profileViews: number;
    loginStreak: number;
    lastLoginAt: FirebaseFirestore.Timestamp;
  };
  
  // Métadonnées système
  accountStatus: 'active' | 'suspended' | 'banned';
  suspendedAt?: FirebaseFirestore.Timestamp;
  suspensionReason?: string;
  bannedAt?: FirebaseFirestore.Timestamp;
  banReason?: string;
  
  // Audit trail
  lastModifiedBy?: string; // UID utilisateur ou 'system'
  ipAddress?: string; // IP de création du compte
  userAgent?: string; // User agent de création
}
```

### 2.2 Index Firestore pour Users

```typescript
// Index simples automatiques sur tous les champs de premier niveau

// Index composites nécessaires
const userIndexes = [
  // Recherche et filtrage administrateur
  ['userType', 'kyc.status', 'createdAt'],
  ['accountStatus', 'userType', 'lastLoginAt'],
  ['kyc.status', 'kyc.level', 'updatedAt'],
  
  // Statistiques et classements
  ['userType', 'stats.totalContributed', 'createdAt'],
  ['userType', 'stats.projectsCreated', 'stats.successfulProjects'],
  ['userType', 'stats.auditsCompleted', 'stats.approvalRate'],
  
  // Recherche géographique (si implémentée)
  ['address.country', 'userType', 'createdAt']
];
```

### 2.3 Règles de validation Users

```javascript
// Dans les Firestore Security Rules
function isValidUser(user) {
  return user.keys().hasAll(['email', 'firstName', 'lastName', 'userType']) &&
         user.email is string &&
         user.firstName is string && user.firstName.size() >= 2 && user.firstName.size() <= 50 &&
         user.lastName is string && user.lastName.size() >= 2 && user.lastName.size() <= 50 &&
         user.userType in ['contributor', 'creator', 'auditor', 'admin'] &&
         user.preferences.language in ['fr', 'en'] &&
         user.preferences.currency == 'EUR';
}

function canWriteUser(uid) {
  return request.auth != null && 
         (request.auth.uid == uid || hasRole('admin'));
}
```

## 3. Collection Projects

### 3.1 Structure du document project

**Path** : `/projects/{projectId}`

```typescript
interface ProjectDocument extends BaseDocument {
  // Identifiants
  id: string; // ID auto-généré Firestore
  slug?: string; // URL-friendly identifier
  
  // Informations de base
  title: string; // 10-100 caractères
  shortDescription: string; // 50-200 caractères 
  fullDescription: string; // 500-5000 caractères
  category: 'environment' | 'education' | 'health' | 'community' | 'innovation';
  tags?: string[]; // Mots-clés pour recherche
  
  // Créateur (dénormalisé pour performance)
  creator: {
    uid: string;
    displayName: string;
    profilePicture?: string;
    bio?: string;
    stats: {
      projectsCreated: number;
      successRate: number;
      averageRating: number;
    };
  };
  
  // Configuration financière
  funding: {
    goal: number; // Objectif en centimes
    raised: number; // Montant collecté en centimes
    currency: 'EUR';
    percentage: number; // Calculé automatiquement
    contributorsCount: number; // Nombre de contributeurs uniques
    averageContribution: number; // Moyenne en centimes
    fees: {
      platformPercentage: number; // Défaut 5%
      auditPercentage: number; // Défaut 3%
      platformAmount: number; // Calculé en centimes
      auditAmount: number; // Calculé en centimes
    };
    minimumContribution: number; // Défaut 1000 centimes (10€)
    maximumContribution?: number; // Optionnel
  };
  
  // Timeline et statuts
  status: 'draft' | 'under_review' | 'live' | 'funded' | 'active' | 'completed' | 'failed' | 'cancelled';
  timeline: {
    createdAt: FirebaseFirestore.Timestamp;
    submittedAt?: FirebaseFirestore.Timestamp;
    approvedAt?: FirebaseFirestore.Timestamp;
    publishedAt?: FirebaseFirestore.Timestamp;
    startDate?: FirebaseFirestore.Timestamp; // Début effectif
    endDate: FirebaseFirestore.Timestamp; // Fin de campagne
    completedAt?: FirebaseFirestore.Timestamp;
    campaignDuration: 30 | 60 | 90; // Durée en jours
    daysRemaining?: number; // Calculé dynamiquement
  };
  
  // Média et contenu
  media: {
    coverImage: {
      url: string; // URL Firebase Storage
      thumbnails: {
        small: string; // 150x150
        medium: string; // 300x300
        large: string; // 600x600
      };
      alt?: string;
    };
    additionalImages?: {
      url: string;
      thumbnails: Record<string, string>;
      caption?: string;
      order: number;
    }[];
    video?: {
      url: string;
      thumbnail: string;
      duration?: number;
      type: 'youtube' | 'vimeo' | 'direct';
    };
    documents?: {
      name: string;
      type: 'business_plan' | 'impact_study' | 'budget' | 'other';
      url: string; // Firebase Storage
      size: number; // En bytes
      uploadedAt: FirebaseFirestore.Timestamp;
      downloadable: boolean;
    }[];
  };
  
  // Métriques d'impact
  impact: {
    beneficiariesCount: number; // Nombre estimé
    targetAudience: string; // Description
    sdgGoals?: number[]; // Objectifs de développement durable ONU
    measurementMethod: string;
    expectedOutcomes: string[];
    // Rempli après validation des milestones
    actualBeneficiaries?: number;
    actualOutcomes?: string[];
    impactScore?: number; // Calculé par l'IA
  };
  
  // Modération et qualité
  moderation: {
    status: 'pending' | 'approved' | 'rejected' | 'flagged';
    reviewedBy?: string; // UID admin
    reviewedAt?: FirebaseFirestore.Timestamp;
    rejectionReason?: string;
    aiScore: number; // Score IA 0-100
    aiFlags?: string[]; // Flags automatiques détectés
    manualFlags?: {
      type: string;
      reason: string;
      reportedBy: string;
      reportedAt: FirebaseFirestore.Timestamp;
    }[];
  };
  
  // Analytics et engagement
  analytics: {
    views: number; // Vues uniques
    totalViews: number; // Vues totales
    saves: number; // Mises en favoris
    shares: number; // Partages
    conversionRate: number; // Pourcentage visiteurs -> contributeurs
    averageTimeSpent: number; // En secondes
    bounceRate: number; // Pourcentage
    trafficSources: Record<string, number>; // Source -> nombre de visites
    lastViewedAt: FirebaseFirestore.Timestamp;
  };
  
  // Géolocalisation (optionnel)
  location?: {
    country: string; // Code ISO
    region?: string;
    city?: string;
    coordinates?: {
      latitude: number;
      longitude: number;
    };
  };
  
  // Configuration avancée
  settings: {
    allowAnonymousContributions: boolean;
    publicContributorsList: boolean;
    allowComments: boolean; // Pour versions futures
    emailUpdatesEnabled: boolean;
    autoRefundOnFailure: boolean;
  };
}
```

### 3.2 Sous-collection Milestones

**Path** : `/projects/{projectId}/milestones/{milestoneId}`

```typescript
interface MilestoneDocument extends BaseDocument {
  // Identifiants
  id: string;
  projectId: string; // Référence parent
  order: number; // 1, 2, 3 pour MVP
  
  // Description
  title: string; // 10-100 caractères
  description: string; // 200-2000 caractères
  criteria: string[]; // Critères de validation
  deliverables: string[]; // Livrables attendus
  
  // Budget et planning
  budget: {
    percentage: number; // Pourcentage du budget total
    amount: number; // Montant en centimes (calculé)
    spent?: number; // Montant dépensé déclaré
  };
  
  timeline: {
    plannedStartDate: FirebaseFirestore.Timestamp;
    plannedEndDate: FirebaseFirestore.Timestamp;
    actualStartDate?: FirebaseFirestore.Timestamp;
    actualEndDate?: FirebaseFirestore.Timestamp;
    submissionDeadline: FirebaseFirestore.Timestamp; // Calculé auto
  };
  
  // Statut et soumissions
  status: 'pending' | 'in_progress' | 'submitted' | 'under_audit' | 'approved' | 'rejected' | 'needs_revision';
  
  submission?: {
    submittedAt: FirebaseFirestore.Timestamp;
    submittedBy: string; // UID créateur
    description: string; // Description des réalisations
    completionPercentage: number; // Auto-évaluation 0-100
    
    // Preuves et evidence
    evidence: {
      type: 'image' | 'document' | 'video' | 'link';
      name: string;
      url: string; // Firebase Storage ou lien externe
      description?: string;
      uploadedAt: FirebaseFirestore.Timestamp;
    }[];
    
    // Métriques de réalisation
    actualMetrics: {
      beneficiariesReached?: number;
      outcomesMeasured?: Record<string, any>;
      feedback?: string[]; // Témoignages bénéficiaires
    };
  };
  
  // Audit et validation
  audit?: {
    auditorUid: string;
    auditorName: string; // Dénormalisé
    assignedAt: FirebaseFirestore.Timestamp;
    startedAt?: FirebaseFirestore.Timestamp;
    completedAt?: FirebaseFirestore.Timestamp;
    deadline: FirebaseFirestore.Timestamp;
    
    // Évaluation
    score: number; // 0-100
    decision: 'approved' | 'rejected' | 'needs_revision';
    
    criteriaEvaluation: {
      criterion: string;
      met: boolean;
      score: number; // 0-100
      comments?: string;
    }[];
    
    report: {
      summary: string; // Minimum 200 caractères
      strengths: string[];
      weaknesses: string[];
      recommendations: string[];
      riskAssessment: 'low' | 'medium' | 'high';
      confidence: number; // 0-100
    };
    
    // Actions post-audit
    fundsReleased?: number; // Montant débloqué en centimes
    releaseDate?: FirebaseFirestore.Timestamp;
  };
  
  // Communication
  communications?: {
    from: string; // UID
    to: string; // UID
    message: string;
    timestamp: FirebaseFirestore.Timestamp;
    type: 'question' | 'clarification' | 'update';
  }[];
}
```

### 3.3 Sous-collection Contributions

**Path** : `/projects/{projectId}/contributions/{contributionId}`

```typescript
interface ContributionDocument extends BaseDocument {
  // Identifiants
  id: string;
  projectId: string;
  contributorUid: string;
  
  // Informations contributeur (dénormalisées)
  contributor: {
    uid: string;
    displayName: string;
    profilePicture?: string;
    isAnonymous: boolean; // Choix du contributeur
    country?: string; // Pour analytics
  };
  
  // Montants et paiement
  amount: {
    gross: number; // Montant brut en centimes
    fees: {
      platform: number; // Commission plateforme
      stripe: number; // Frais Stripe
      total: number; // Total des frais
    };
    net: number; // Montant net pour le projet
    currency: 'EUR';
  };
  
  // Statut de paiement
  payment: {
    status: 'pending' | 'processing' | 'confirmed' | 'failed' | 'refunded';
    provider: 'stripe';
    
    // Informations Stripe
    paymentIntentId: string;
    paymentMethodId?: string;
    customerStripeId?: string;
    
    // Détails carte (sécurisés)
    cardLast4?: string;
    cardBrand?: string;
    cardCountry?: string;
    
    // Timeline paiement
    initiatedAt: FirebaseFirestore.Timestamp;
    confirmedAt?: FirebaseFirestore.Timestamp;
    failedAt?: FirebaseFirestore.Timestamp;
    refundedAt?: FirebaseFirestore.Timestamp;
    failureReason?: string;
  };
  
  // Escrow et déblocage
  escrow: {
    status: 'held' | 'released' | 'refunded';
    heldAmount: number; // Montant bloqué en centimes
    releasedAmount: number; // Montant débloqué
    
    releases: {
      milestoneId: string;
      amount: number;
      releasedAt: FirebaseFirestore.Timestamp;
      reason: string;
    }[];
    
    refund?: {
      amount: number;
      reason: string;
      processedAt: FirebaseFirestore.Timestamp;
      stripeRefundId: string;
    };
  };
  
  // Message et préférences
  message?: string; // Message optionnel du contributeur
  preferences: {
    anonymous: boolean;
    receiveUpdates: boolean;
    allowContact: boolean;
  };
  
  // Source et attribution
  source: {
    referrer?: string; // URL de provenance
    campaign?: string; // Campagne marketing
    medium?: string; // Email, social, etc.
    device: 'mobile' | 'tablet' | 'desktop';
    userAgent?: string;
  };
  
  // Métadonnées
  ipAddress?: string; // Pour détection fraude
  riskScore?: number; // Score anti-fraude 0-100
  verified: boolean; // Contribution vérifiée
}
```

## 4. Collection Audits

### 4.1 Structure du document audit

**Path** : `/audits/{auditId}`

```typescript
interface AuditDocument extends BaseDocument {
  // Identifiants et références
  id: string;
  projectId: string;
  projectTitle: string; // Dénormalisé
  creatorUid: string;
  creatorName: string; // Dénormalisé
  
  // Auditeur
  auditor: {
    uid: string;
    displayName: string;
    email: string;
    profilePicture?: string;
    specializations: string[];
    stats: {
      auditsCompleted: number;
      averageRating: number;
      approvalRate: number;
    };
  };
  
  // Configuration audit
  scope: {
    totalMilestones: number;
    estimatedHours: number;
    complexity: 'low' | 'medium' | 'high';
    specialRequirements?: string[];
  };
  
  // Timeline
  timeline: {
    assignedAt: FirebaseFirestore.Timestamp;
    acceptedAt?: FirebaseFirestore.Timestamp;
    startedAt?: FirebaseFirestore.Timestamp;
    completedAt?: FirebaseFirestore.Timestamp;
    deadline: FirebaseFirestore.Timestamp;
    
    // Calculés
    responseTime?: number; // Temps pour accepter (heures)
    processingTime?: number; // Temps total audit (heures)
    isOverdue: boolean; // Calculé dynamiquement
  };
  
  // Statut global
  status: 'assigned' | 'accepted' | 'in_progress' | 'completed' | 'declined' | 'reassigned';
  
  // Compensation
  compensation: {
    baseAmount: number; // Montant de base en centimes
    bonusAmount?: number; // Bonus qualité/rapidité
    totalAmount: number; // Total en centimes
    currency: 'EUR';
    status: 'pending' | 'approved' | 'paid';
    paidAt?: FirebaseFirestore.Timestamp;
    invoiceRequired: boolean;
  };
  
  // Résultats et performance
  results: {
    milestonesAudited: number;
    averageScore: number; // Score moyen des milestones
    totalApproved: number;
    totalRejected: number;
    totalRevisions: number;
    fundsReleased: number; // Montant total débloqué
  };
  
  // Feedback et qualité
  feedback: {
    // Feedback du créateur sur l'auditeur
    creatorRating?: number; // 1-5 étoiles
    creatorComment?: string;
    creatorSubmittedAt?: FirebaseFirestore.Timestamp;
    
    // Feedback de l'auditeur sur le projet
    auditorComplexityRating?: number; // 1-5
    auditorComment?: string;
    auditorSubmittedAt?: FirebaseFirestore.Timestamp;
    
    // Évaluation système
    systemQualityScore?: number; // Calculé automatiquement
  };
  
  // Communications
  communications: {
    from: string; // UID
    to: string; // UID
    type: 'message' | 'clarification' | 'objection';
    content: string;
    timestamp: FirebaseFirestore.Timestamp;
    read: boolean;
  }[];
  
  // Métadonnées
  reassignmentHistory?: {
    previousAuditorUid: string;
    reason: string;
    reassignedAt: FirebaseFirestore.Timestamp;
    reassignedBy: string; // UID admin
  }[];
}
```

## 5. Collection Transactions

### 5.1 Structure du document transaction

**Path** : `/transactions/{transactionId}`

```typescript
interface TransactionDocument extends BaseDocument {
  // Identifiants
  id: string;
  type: 'contribution' | 'platform_fee' | 'audit_fee' | 'stripe_fee' | 'refund' | 'payout' | 'compensation';
  
  // Références
  projectId?: string;
  contributionId?: string;
  milestoneId?: string;
  auditId?: string;
  
  // Parties impliquées
  from: {
    type: 'user' | 'project' | 'platform' | 'stripe' | 'external';
    uid?: string; // Si type=user
    name: string;
  };
  
  to: {
    type: 'user' | 'project' | 'platform' | 'stripe' | 'external';
    uid?: string; // Si type=user
    name: string;
  };
  
  // Montants
  amount: {
    gross: number; // Montant brut en centimes
    fees: number; // Frais prélevés
    net: number; // Montant net
    currency: 'EUR';
    exchangeRate?: number; // Pour futures devises
  };
  
  // Statut et traitement
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  
  // Détails paiement externe
  external: {
    provider: 'stripe' | 'bank_transfer';
    externalId: string; // ID chez le provider
    metadata?: Record<string, any>;
  };
  
  // Timeline
  timeline: {
    initiatedAt: FirebaseFirestore.Timestamp;
    processedAt?: FirebaseFirestore.Timestamp;
    completedAt?: FirebaseFirestore.Timestamp;
    failedAt?: FirebaseFirestore.Timestamp;
  };
  
  // Description et contexte
  description: string;
  internalNotes?: string; // Notes administratives
  
  // Réconciliation
  reconciliation: {
    reconciled: boolean;
    reconciledAt?: FirebaseFirestore.Timestamp;
    reconciledBy?: string; // UID admin
    discrepancies?: string[];
  };
  
  // Audit trail
  auditTrail: {
    action: string;
    performedBy: string; // UID ou 'system'
    timestamp: FirebaseFirestore.Timestamp;
    details?: string;
  }[];
}
```

## 6. Collection Notifications

### 6.1 Structure du document notification

**Path** : `/notifications/{notificationId}`

```typescript
interface NotificationDocument extends BaseDocument {
  // Identifiants
  id: string;
  recipientUid: string;
  
  // Type et catégorie
  type: 'contribution' | 'project' | 'audit' | 'kyc' | 'system' | 'marketing';
  subtype: string; // Sous-type spécifique
  priority: 'low' | 'medium' | 'high' | 'urgent';
  
  // Contenu
  title: string; // Titre court
  message: string; // Message principal
  actionText?: string; // Texte du bouton d'action
  actionUrl?: string; // URL d'action
  
  // Données contextuelles
  data: {
    projectId?: string;
    contributionId?: string;
    auditId?: string;
    amount?: number;
    [key: string]: any; // Données additionnelles flexibles
  };
  
  // Statuts
  status: {
    read: boolean;
    readAt?: FirebaseFirestore.Timestamp;
    clicked: boolean;
    clickedAt?: FirebaseFirestore.Timestamp;
    dismissed: boolean;
    dismissedAt?: FirebaseFirestore.Timestamp;
  };
  
  // Canaux de diffusion
  channels: {
    inApp: {
      sent: boolean;
      sentAt?: FirebaseFirestore.Timestamp;
    };
    email: {
      enabled: boolean;
      sent: boolean;
      sentAt?: FirebaseFirestore.Timestamp;
      emailId?: string; // ID SendGrid
      opened?: boolean;
      clicked?: boolean;
    };
    push: {
      enabled: boolean;
      sent: boolean;
      sentAt?: FirebaseFirestore.Timestamp;
      messageId?: string; // ID FCM
      delivered?: boolean;
    };
  };
  
  // Planification
  scheduling: {
    scheduleType: 'immediate' | 'delayed' | 'recurring';
    scheduledFor?: FirebaseFirestore.Timestamp;
    timezone?: string;
    recurring?: {
      frequency: 'daily' | 'weekly' | 'monthly';
      interval: number;
      endDate?: FirebaseFirestore.Timestamp;
    };
  };
  
  // Métadonnées
  source: 'system' | 'admin' | 'automated';
  batchId?: string; // Pour notifications groupées
  templateId?: string; // Template utilisé
  locale: string; // Langue de la notification
  
  // Expiration
  expiresAt?: FirebaseFirestore.Timestamp;
  autoDelete: boolean;
}
```

## 7. Collection System Config

### 7.1 Structure de la configuration système

**Path** : `/system_config/{configType}`

```typescript
interface SystemConfigDocument extends BaseDocument {
  // Configuration générale
  id: string;
  type: 'platform_settings' | 'fee_structure' | 'limits' | 'categories' | 'kyc_config' | 'email_templates';
  environment: 'development' | 'staging' | 'production';
  
  // Statut
  active: boolean;
  version: string; // Version sémantique
  
  // Configuration spécifique selon le type
  config: Record<string, any>;
  
  // Métadonnées
  description?: string;
  lastModifiedBy: string; // UID admin
  approvedBy?: string; // UID admin approuvant
  approvedAt?: FirebaseFirestore.Timestamp;
  
  // Historique des changements
  changeHistory: {
    version: string;
    changes: string[];
    modifiedBy: string;
    modifiedAt: FirebaseFirestore.Timestamp;
    previousConfig?: Record<string, any>;
  }[];
}

// Exemples de configurations spécifiques

interface PlatformSettingsConfig {
  fees: {
    platformPercentage: number; // 5
    auditPercentage: number; // 3
    stripePercentage: number; // ~2.9
  };
  limits: {
    maxContributionAmount: number; // 100000 centimes
    maxProjectGoal: number; // 5000000 centimes
    maxActiveProjects: number; // 3
    maxProjectDuration: number; // 90 jours
  };
  kyc: {
    basicLevel: {
      maxContribution: number;
      requirements: string[];
    };
    enhancedLevel: {
      maxContribution: number;
      requirements: string[];
    };
  };
}

interface CategoriesConfig {
  categories: {
    id: string;
    name: Record<string, string>; // Multilingue
    description: Record<string, string>;
    icon: string;
    active: boolean;
    order: number;
  }[];
}
```

## 8. Index et optimisations

### 8.1 Index composites essentiels

```typescript
// Index pour la collection projects
const projectIndexes = [
  // Page d'accueil et filtres
  ['status', 'category', 'createdAt'],
  ['status', 'funding.percentage', 'timeline.endDate'],
  ['category', 'status', 'funding.raised'],
  
  // Dashboard créateur
  ['creator.uid', 'status', 'updatedAt'],
  ['creator.uid', 'timeline.endDate', 'status'],
  
  // Recherche et analytics
  ['moderation.status', 'moderation.aiScore', 'createdAt'],
  ['location.country', 'category', 'status'],
  ['timeline.endDate', 'status', 'funding.percentage']
];

// Index pour la collection contributions
const contributionIndexes = [
  // Portfolio utilisateur
  ['contributorUid', 'payment.status', 'createdAt'],
  ['contributorUid', 'amount.gross', 'createdAt'],
  
  // Analytics projet
  ['projectId', 'payment.status', 'createdAt'],
  ['projectId', 'createdAt', 'amount.gross'],
  
  // Détection fraude
  ['payment.status', 'riskScore', 'createdAt'],
  ['contributor.country', 'amount.gross', 'createdAt']
];

// Index pour les notifications
const notificationIndexes = [
  // Dashboard utilisateur
  ['recipientUid', 'status.read', 'createdAt'],
  ['recipientUid', 'type', 'createdAt'],
  ['recipientUid', 'priority', 'createdAt'],
  
  // Nettoyage automatique
  ['expiresAt', 'autoDelete', 'status.dismissed'],
  ['createdAt', 'status.read', 'autoDelete']
];
```

### 8.2 Stratégies de dénormalisation

**Données dénormalisées pour performance :**

1. **Informations créateur dans projects** : Évite les jointures
2. **Statistiques utilisateur dans users** : Calculs pré-faits
3. **Métadonnées projet dans contributions** : Performance des listes
4. **Données auditeur dans audits** : Évite les lookups

**Mise à jour des données dénormalisées via Functions :**

```typescript
// Exemple de Function pour maintenir la cohérence
exports.updateDenormalizedData = functions.firestore
  .document('users/{userId}')
  .onUpdate(async (change, context) => {
    const after = change.after.data();
    const before = change.before.data();
    
    // Mise à jour des projets si nom/photo changé
    if (after.displayName !== before.displayName || 
        after.profilePicture !== before.profilePicture) {
      await updateProjectsCreator(context.params.userId, {
        displayName: after.displayName,
        profilePicture: after.profilePicture
      });
    }
  });
```

Cette documentation complète du modèle de données Firestore permet aux développeurs backend de comprendre et implémenter l'ensemble de la structure de données de manière autonome.