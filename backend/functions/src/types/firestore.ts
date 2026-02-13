/**
 * Types Firestore Documents - Social Finance Impact Platform
 * Interfaces complètes basées sur le modèle de données
 */

import { Timestamp } from 'firebase-admin/firestore';
import { 
  UserType, 
  KYCStatus, 
  KYCLevel, 
  ProjectStatus, 
  ProjectCategory, 
  MilestoneStatus, 
  ContributionStatus, 
  AuditStatus, 
  PaymentStatus, 
  NotificationType, 
  Language, 
  Currency, 
  Country, 
  Address, 
  UserPreferences, 
  UserStats, 
  ProjectStats 
} from './global';

/**
 * Base document interface avec champs automatiques
 */
export interface BaseDocument {
  createdAt: Timestamp;
  updatedAt: Timestamp;
  version: number;
}

/**
 * Interface pour soft delete
 */
export interface SoftDeletable {
  deleted: boolean;
  deletedAt?: Timestamp;
  deletedBy?: string;
}

/**
 * Document User - Collection /users/{uid}
 */
export interface UserDocument extends BaseDocument {
  // Identité principale
  uid: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  profilePicture?: string;
  bio?: string;
  
  // Type et rôle
  userType: UserType;
  permissions: string[];
  
  // Informations personnelles
  phoneNumber?: string;
  dateOfBirth?: string; // Format ISO YYYY-MM-DD
  gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say';
  
  // Adresse
  address?: {
    street?: string;
    city?: string;
    postalCode?: string;
    country: Country;
    coordinates?: {
      latitude: number;
      longitude: number;
    };
  };
  
  // Statut KYC
  kyc: {
    status: KYCStatus;
    level: KYCLevel;
    provider: 'sumsub';
    externalId?: string;
    submittedAt?: Timestamp;
    approvedAt?: Timestamp;
    expiresAt?: Timestamp;
    rejectionReason?: string;
    documents: {
      type: 'passport' | 'id_card' | 'driving_license' | 'proof_of_address';
      status: 'pending' | 'approved' | 'rejected';
      submittedAt: Timestamp;
      fileName?: string;
      storageUrl?: string;
    }[];
  };
  
  // Préférences utilisateur
  preferences: {
    language: Language;
    currency: Currency;
    timezone?: string;
    notifications: {
      email: boolean;
      push: boolean;
      inApp: boolean;
      frequency: 'immediate' | 'daily' | 'weekly';
      project_update?: {
        email: boolean;
        push: boolean;
        inApp: boolean;
      };
    };
    privacy: {
      profilePublic: boolean;
      showContributions: boolean;
      allowContact: boolean;
      showProfile?: boolean;
    };
    interests: {
      categories: ProjectCategory[];
      causes?: string[];
    };
  };
  
  // Statistiques d'activité
  stats: {
    // Statistiques contributeur
    totalContributed: number;
    projectsSupported: number;
    averageContribution: number;
    lastContributionAt?: Timestamp;

    // Statistiques créateur
    projectsCreated: number;
    totalFundsRaised: number;
    successfulProjects: number;
    averageProjectSize: number;
    lastProjectAt?: Timestamp;

    // Statistiques auditeur
    auditsCompleted: number;
    averageAuditTime: number;
    approvalRate: number;
    totalEarnings: number;
    lastAuditAt?: Timestamp;

    // Engagement général
    profileViews: number;
    loginStreak: number;
    lastLoginAt: Timestamp;
    notificationsSent?: number;
  };
  
  // Métadonnées système
  accountStatus: 'active' | 'suspended' | 'banned';
  status?: 'active' | 'suspended' | 'banned'; // Alias pour accountStatus
  suspendedAt?: Timestamp;
  suspensionReason?: string;
  bannedAt?: Timestamp;
  banReason?: string;

  // Données d'inscription
  registrationData?: {
    source?: string;
    referredBy?: string;
    ipAddress?: string;
    userAgent?: string;
  };

  // Audit trail
  lastModifiedBy?: string;
  ipAddress?: string;
  userAgent?: string;
  profileComplete: boolean;
}

/**
 * Document Project - Collection /projects/{projectId}
 */
export interface ProjectDocument extends BaseDocument {
  // Identifiants
  id: string;
  slug?: string;
  
  // Informations de base
  title: string;
  shortDescription: string;
  fullDescription: string;
  category: ProjectCategory;
  tags?: string[];
  
  // Créateur (dénormalisé)
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
    goal: number; // En centimes
    raised: number; // En centimes
    currency: Currency;
    percentage: number;
    contributorsCount: number;
    averageContribution: number;
    fees: {
      platformPercentage: number;
      auditPercentage: number;
      platformAmount: number;
      auditAmount: number;
    };
    minimumContribution: number;
    maximumContribution?: number;
  };
  
  // Timeline et statuts
  status: ProjectStatus;
  timeline: {
    createdAt: Timestamp;
    submittedAt?: Timestamp;
    approvedAt?: Timestamp;
    publishedAt?: Timestamp;
    startDate?: Timestamp;
    endDate: Timestamp;
    completedAt?: Timestamp;
    campaignDuration: 30 | 60 | 90;
    daysRemaining?: number;
  };
  
  // Média et contenu
  media: {
    coverImage: {
      url: string;
      thumbnails: {
        small: string;
        medium: string;
        large: string;
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
      url: string;
      size: number;
      uploadedAt: Timestamp;
      downloadable: boolean;
    }[];
  };
  
  // Métriques d'impact
  impact: {
    beneficiariesCount: number;
    targetAudience: string;
    sdgGoals?: number[];
    measurementMethod: string;
    expectedOutcomes: string[];
    actualBeneficiaries?: number;
    actualOutcomes?: string[];
    impactScore?: number;
  };
  
  // Modération et qualité
  moderation: {
    status: 'pending' | 'approved' | 'rejected' | 'flagged';
    reviewedBy?: string;
    reviewedAt?: Timestamp;
    rejectionReason?: string;
    aiScore: number;
    aiFlags?: string[];
    manualFlags?: {
      type: string;
      reason: string;
      reportedBy: string;
      reportedAt: Timestamp;
    }[];
  };
  
  // Analytics et engagement
  analytics: {
    views: number;
    totalViews: number;
    saves: number;
    shares: number;
    conversionRate: number;
    averageTimeSpent: number;
    bounceRate: number;
    trafficSources: Record<string, number>;
    lastViewedAt: Timestamp;
  };
  
  // Géolocalisation
  location?: {
    country: Country;
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
    allowComments: boolean;
    emailUpdatesEnabled: boolean;
    autoRefundOnFailure: boolean;
  };

  // Propriétés de compatibilité (legacy ou calculées)
  currentFunding?: number;
  fundingGoal?: number;
  fundingStatus?: string;
  contributors?: string[];
  creatorUid?: string;
  creatorName?: string;
  creatorEmail?: string;
  creatorDisplayName?: string;
  creatorAvatar?: string;
  description?: string;
  urgency?: string;
  milestones?: any[];
  internationalScope?: boolean;
  currentMilestone?: number;
  deadline?: Timestamp | Date | string;
  escrow?: {
    totalHeld: number;
    totalReleased: number;
    pendingRelease: number;
  };
  acceptingContributions?: boolean;
  validatedAt?: Timestamp;
  conditionalApprovalAt?: Timestamp;
  auditFailedAt?: Timestamp;
  visibility?: 'public' | 'private' | 'draft';

  // Propriétés additionnelles
  team?: Array<{
    uid: string;
    role: string;
    name?: string;
  }>;
  impactGoals?: {
    primary: string;
    secondary?: string[];
  };
  stats?: {
    views: number;
    shares: number;
    favorites: number;
    comments: number;
    likes?: number;
  };
  publishedAt?: Timestamp;
  uid?: string; // Alias pour id
  stripeConnectAccountId?: string;
  auditScore?: number;
}

/**
 * Document Milestone - Sous-collection /projects/{projectId}/milestones/{milestoneId}
 */
export interface MilestoneDocument extends BaseDocument {
  // Identifiants
  id: string;
  projectId: string;
  order: number;
  
  // Description
  title: string;
  description: string;
  criteria: string[];
  deliverables: string[];
  
  // Budget et planning
  budget: {
    percentage: number;
    amount: number;
    spent?: number;
  };
  
  timeline: {
    plannedStartDate: Timestamp;
    plannedEndDate: Timestamp;
    actualStartDate?: Timestamp;
    actualEndDate?: Timestamp;
    submissionDeadline: Timestamp;
  };
  
  // Statut et soumissions
  status: MilestoneStatus;
  
  submission?: {
    submittedAt: Timestamp;
    submittedBy: string;
    description: string;
    completionPercentage: number;
    
    evidence: {
      type: 'image' | 'document' | 'video' | 'link';
      name: string;
      url: string;
      description?: string;
      uploadedAt: Timestamp;
    }[];
    
    actualMetrics: {
      beneficiariesReached?: number;
      outcomesMeasured?: Record<string, any>;
      feedback?: string[];
    };
  };
  
  // Audit et validation
  audit?: {
    auditorUid: string;
    auditorName: string;
    assignedAt: Timestamp;
    startedAt?: Timestamp;
    completedAt?: Timestamp;
    deadline: Timestamp;
    
    score: number;
    decision: 'approved' | 'rejected' | 'needs_revision';
    
    criteriaEvaluation: {
      criterion: string;
      met: boolean;
      score: number;
      comments?: string;
    }[];
    
    report: {
      summary: string;
      strengths: string[];
      weaknesses: string[];
      recommendations: string[];
      riskAssessment: 'low' | 'medium' | 'high';
      confidence: number;
    };
    
    fundsReleased?: number;
    releaseDate?: Timestamp;
  };
  
  // Communication
  communications?: {
    from: string;
    to: string;
    message: string;
    timestamp: Timestamp;
    type: 'question' | 'clarification' | 'update';
  }[];
}

/**
 * Document Contribution - Sous-collection /projects/{projectId}/contributions/{contributionId}
 */
export interface ContributionDocument extends BaseDocument {
  // Identifiants
  id: string;
  projectId: string;
  contributorUid: string;
  
  // Informations contributeur (dénormalisées)
  contributor: {
    uid: string;
    displayName: string;
    profilePicture?: string;
    isAnonymous: boolean;
    country?: Country;
  };
  
  // Montants et paiement
  amount: {
    gross: number; // En centimes
    fees: {
      platform: number;
      stripe: number;
      total: number;
    };
    net: number; // En centimes
    currency: Currency;
  };
  
  // Statut de paiement
  payment: {
    status: PaymentStatus;
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
    initiatedAt: Timestamp;
    confirmedAt?: Timestamp;
    failedAt?: Timestamp;
    refundedAt?: Timestamp;
    failureReason?: string;
  };
  
  // Escrow et déblocage
  escrow: {
    status: 'held' | 'released' | 'refunded';
    heldAmount: number;
    releasedAmount: number;
    
    releases: {
      milestoneId: string;
      amount: number;
      releasedAt: Timestamp;
      reason: string;
    }[];
    
    refund?: {
      amount: number;
      reason: string;
      processedAt: Timestamp;
      stripeRefundId: string;
    };
  };
  
  // Message et préférences
  message?: string;
  preferences: {
    anonymous: boolean;
    receiveUpdates: boolean;
    allowContact: boolean;
  };
  
  // Source et attribution
  source: {
    referrer?: string;
    campaign?: string;
    medium?: string;
    device: 'mobile' | 'tablet' | 'desktop';
    userAgent?: string;
  };
  
  // Métadonnées
  ipAddress?: string;
  riskScore?: number;
  verified: boolean;
}

/**
 * Document Audit - Collection /audits/{auditId}
 */
/**
 * Type pour la compensation d'audit
 */
export interface AuditCompensation {
  baseAmount: number;
  bonusAmount?: number;
  totalAmount: number;
  amount?: number; // Alias pour totalAmount
  currency: Currency;
  status: 'pending' | 'approved' | 'paid';
  paidAt?: Timestamp;
  invoiceRequired: boolean;
}

export interface AuditDocument extends BaseDocument {
  // Identifiants et références
  id: string;
  projectId: string;
  projectTitle: string;
  creatorUid: string;
  creatorName: string;

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
    assignedAt: Timestamp;
    acceptedAt?: Timestamp;
    startedAt?: Timestamp;
    completedAt?: Timestamp;
    deadline: Timestamp;
    responseTime?: number;
    processingTime?: number;
    isOverdue: boolean;
  };

  // Statut global
  status: AuditStatus;

  // Compensation
  compensation: AuditCompensation;
  
  // Résultats et performance
  results: {
    milestonesAudited: number;
    averageScore: number;
    totalApproved: number;
    totalRejected: number;
    totalRevisions: number;
    fundsReleased: number;
  };
  
  // Feedback et qualité
  feedback: {
    creatorRating?: number;
    creatorComment?: string;
    creatorSubmittedAt?: Timestamp;
    
    auditorComplexityRating?: number;
    auditorComment?: string;
    auditorSubmittedAt?: Timestamp;
    
    systemQualityScore?: number;
  };
  
  // Communications
  communications: {
    from: string;
    to: string;
    type: 'message' | 'clarification' | 'objection';
    content: string;
    timestamp: Timestamp;
    read: boolean;
  }[];
  
  // Métadonnées
  reassignmentHistory?: {
    previousAuditorUid: string;
    reason: string;
    reassignedAt: Timestamp;
    reassignedBy: string;
  }[];

  // Propriétés de compatibilité (legacy ou calculées)
  auditorUid?: string; // Alias pour auditor.uid
  score?: number; // Score global de l'audit
  findings?: Array<{
    severity: 'critical' | 'high' | 'medium' | 'low';
    category: string;
    description: string;
    recommendation?: string;
  }>;
  recommendations?: string[];
  estimatedCompensation?: number;
  decision?: 'approved' | 'rejected' | 'conditional';

  // Propriétés supplémentaires pour compatibilité
  assignedAt?: Timestamp; // Alias pour timeline.assignedAt
  assignedBy?: string; // UID de qui a assigné l'audit
  deadline?: Timestamp; // Alias pour timeline.deadline
  acceptedAt?: Timestamp; // Alias pour timeline.acceptedAt
  completedAt?: Timestamp; // Alias pour timeline.completedAt
  specializations?: string[]; // Alias pour auditor.specializations
  requiredDocuments?: string[]; // Documents requis pour l'audit
  criteria?: Array<{
    category: string;
    weight: number;
    description?: string;
  }>; // Critères d'évaluation

  // Propriétés calculées
  finalDecision?: 'approved' | 'rejected' | 'conditional';
  finalScore?: number;
  finalAmount?: number; // Alias pour compensation.totalAmount
  completionTime?: number; // Temps de complétion en jours
  timeSpent?: number; // Temps passé sur l'audit en heures
  estimatedHours?: number; // Alias pour scope.estimatedHours
  currentMilestone?: number; // Jalon en cours d'audit
}

/**
 * Document Transaction - Collection /transactions/{transactionId}
 */
export interface TransactionDocument extends BaseDocument {
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
    uid?: string;
    name: string;
  };
  
  to: {
    type: 'user' | 'project' | 'platform' | 'stripe' | 'external';
    uid?: string;
    name: string;
  };
  
  // Montants
  amount: {
    gross: number;
    fees: number;
    net: number;
    currency: Currency;
    exchangeRate?: number;
  };
  
  // Statut et traitement
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  
  // Détails paiement externe
  external: {
    provider: 'stripe' | 'bank_transfer';
    externalId: string;
    metadata?: Record<string, any>;
  };
  
  // Timeline
  timeline: {
    initiatedAt: Timestamp;
    processedAt?: Timestamp;
    completedAt?: Timestamp;
    failedAt?: Timestamp;
  };
  
  // Description et contexte
  description: string;
  internalNotes?: string;
  
  // Réconciliation
  reconciliation: {
    reconciled: boolean;
    reconciledAt?: Timestamp;
    reconciledBy?: string;
    discrepancies?: string[];
  };
  
  // Audit trail
  auditTrail: {
    action: string;
    performedBy: string;
    timestamp: Timestamp;
    details?: string;
  }[];
}

/**
 * Document Payment - Alias pour Contribution (compatibilité)
 */
export type PaymentDocument = ContributionDocument & {
  status?: PaymentStatus; // Alias pour payment.status
};

/**
 * Document Escrow - Collection /escrow_records/{escrowId}
 */
export interface EscrowDocument extends BaseDocument {
  // Identifiants
  id: string;
  paymentId: string;
  projectId: string;
  contributorUid: string;

  // Montants
  amount: number;
  currency: Currency;
  interest?: number; // Intérêts accumulés

  // Statut
  status: 'held' | 'released' | 'refunded' | 'disputed';
  holdReason?: string;

  // Conditions de libération
  releaseConditions?: string[];
  estimatedReleaseDate?: Date;

  // Références externes
  stripePaymentIntentId?: string;

  // Métadonnées
  releasedAt?: Timestamp;
  refundedAt?: Timestamp;
  lastInterestCalculation?: Timestamp;
}

/**
 * Document Notification - Collection /notifications/{notificationId}
 */
export interface NotificationDocument extends BaseDocument {
  // Identifiants
  id: string;
  recipientUid: string;
  senderUid?: string;

  // Type et catégorie
  type: NotificationType;
  subtype?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  
  // Contenu
  title: string;
  message: string;
  actionText?: string;
  actionUrl?: string;
  
  // Données contextuelles
  data: {
    projectId?: string;
    contributionId?: string;
    auditId?: string;
    amount?: number;
    [key: string]: any;
  };
  
  // Statuts
  status?: {
    read: boolean;
    readAt?: Timestamp;
    clicked: boolean;
    clickedAt?: Timestamp;
    dismissed: boolean;
    dismissedAt?: Timestamp;
  };

  // Canaux de diffusion
  channels?: {
    inApp: {
      sent: boolean;
      sentAt?: Timestamp;
    };
    email: {
      enabled: boolean;
      sent: boolean;
      sentAt?: Timestamp;
      emailId?: string;
      opened?: boolean;
      clicked?: boolean;
    };
    push: {
      enabled: boolean;
      sent: boolean;
      sentAt?: Timestamp;
      messageId?: string;
      delivered?: boolean;
    };
  };

  // Planification
  scheduling?: {
    scheduleType: 'immediate' | 'delayed' | 'recurring';
    scheduledFor?: Timestamp;
    timezone?: string;
    recurring?: {
      frequency: 'daily' | 'weekly' | 'monthly';
      interval: number;
      endDate?: Timestamp;
    };
  };

  // Métadonnées
  source?: 'system' | 'admin' | 'automated';
  batchId?: string;
  templateId?: string;
  locale?: string;
  
  // Expiration
  expiresAt?: Timestamp;
  autoDelete: boolean;
}

/**
 * Document System Config - Collection /system_config/{configType}
 */
export interface SystemConfigDocument extends Omit<BaseDocument, 'version'> {
  // Configuration générale
  id: string;
  type: 'platform_settings' | 'fee_structure' | 'limits' | 'categories' | 'kyc_config' | 'email_templates';
  environment: 'development' | 'staging' | 'production';

  // Statut
  active: boolean;
  version: string;
  
  // Configuration spécifique
  config: Record<string, any>;
  
  // Métadonnées
  description?: string;
  lastModifiedBy: string;
  approvedBy?: string;
  approvedAt?: Timestamp;
  
  // Historique des changements
  changeHistory: {
    version: string;
    changes: string[];
    modifiedBy: string;
    modifiedAt: Timestamp;
    previousConfig?: Record<string, any>;
  }[];
}

/**
 * Types utilitaires pour les requêtes
 */
export type DocumentWithId<T> = T & { id: string };

export type PartialDocument<T> = Partial<T> & { updatedAt: Timestamp };

export type CreateDocument<T> = Omit<T, 'createdAt' | 'updatedAt' | 'version'>;

export type UpdateDocument<T> = Partial<Omit<T, 'createdAt' | 'version'>> & { updatedAt: Timestamp };