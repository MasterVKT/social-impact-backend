/**
 * Constants globales - Social Finance Impact Platform
 * Configuration et constantes utilisées dans toute l'application
 */

/**
 * Configuration de l'application
 */
export const APP_CONFIG = {
  name: 'Social Impact Platform',
  version: '1.0.0',
  environment: process.env.NODE_ENV || 'development',
  region: 'europe-west1',
  timezone: 'Europe/Paris',
  defaultLanguage: 'fr' as const,
  defaultCurrency: 'EUR' as const,
} as const;

/**
 * Limites et quotas
 */
export const LIMITS = {
  // Contributions
  CONTRIBUTION: {
    MIN_AMOUNT: 1000, // 10€ en centimes
    MAX_AMOUNT: 100000, // 1000€ en centimes
    MAX_PER_USER_PER_PROJECT: 10000000, // 100k€ en centimes
    MAX_ANONYMOUS: 5000, // 50€ maximum pour contributions anonymes
  },
  
  // Projets
  PROJECT: {
    MIN_FUNDING_GOAL: 1000, // 10€ en centimes
    MAX_FUNDING_GOAL: 5000000, // 50k€ en centimes
    MAX_ACTIVE_PER_CREATOR: 3,
    MIN_DURATION_DAYS: 30,
    MAX_DURATION_DAYS: 90,
    MIN_MILESTONES: 1,
    MAX_MILESTONES: 5,
    MAX_IMAGES: 10,
    MAX_DOCUMENTS: 5,
  },
  
  // KYC
  KYC: {
    BASIC_MAX_CONTRIBUTION: 100000, // 1000€ en centimes
    ENHANCED_MAX_CONTRIBUTION: 10000000, // 100k€ en centimes
    TOKEN_EXPIRY_HOURS: 24,
    DOCUMENT_MAX_SIZE_MB: 10,
  },
  
  // Fichiers
  FILE: {
    MAX_IMAGE_SIZE_MB: 5,
    MAX_DOCUMENT_SIZE_MB: 10,
    MAX_VIDEO_SIZE_MB: 50,
    ALLOWED_IMAGE_TYPES: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
    ALLOWED_DOCUMENT_TYPES: ['.pdf', '.doc', '.docx', '.txt'],
    ALLOWED_VIDEO_TYPES: ['.mp4', '.mov', '.avi', '.webm'],
  },
  
  // Rate limiting
  RATE_LIMITS: {
    LOGIN_ATTEMPTS: 5,
    PASSWORD_RESET: 3,
    EMAIL_SEND: 10,
    API_CALLS_PER_MINUTE: 60,
    CONTRIBUTION_PER_HOUR: 5,
  },
} as const;

/**
 * Structure de frais
 */
export const FEES = {
  PLATFORM_PERCENTAGE: 0.05, // 5%
  AUDIT_PERCENTAGE: 0.03, // 3%
  STRIPE_PERCENTAGE: 0.029, // 2.9%
  STRIPE_FIXED_FEE: 30, // 0.30€ en centimes
  
  // Calculs
  calculateFees: (amount: number) => {
    const platformFee = Math.round(amount * FEES.PLATFORM_PERCENTAGE);
    const auditFee = Math.round(amount * FEES.AUDIT_PERCENTAGE);
    const stripeFee = Math.round(amount * FEES.STRIPE_PERCENTAGE + FEES.STRIPE_FIXED_FEE);
    
    return {
      platform: platformFee,
      audit: auditFee,
      stripe: stripeFee,
      total: platformFee + auditFee + stripeFee,
    };
  },
} as const;

/**
 * Catégories de projets
 */
export const PROJECT_CATEGORIES = {
  ENVIRONMENT: {
    id: 'environment',
    name: { fr: 'Environnement', en: 'Environment' },
    description: { 
      fr: 'Projets pour la protection de l\'environnement et la lutte contre le changement climatique',
      en: 'Projects for environmental protection and climate change mitigation'
    },
    icon: '🌱',
    color: '#10B981',
    order: 1,
  },
  EDUCATION: {
    id: 'education',
    name: { fr: 'Éducation', en: 'Education' },
    description: { 
      fr: 'Projets éducatifs et de formation professionnelle',
      en: 'Educational and professional training projects'
    },
    icon: '📚',
    color: '#3B82F6',
    order: 2,
  },
  HEALTH: {
    id: 'health',
    name: { fr: 'Santé', en: 'Health' },
    description: { 
      fr: 'Projets de santé publique et d\'accès aux soins',
      en: 'Public health and healthcare access projects'
    },
    icon: '🏥',
    color: '#EF4444',
    order: 3,
  },
  COMMUNITY: {
    id: 'community',
    name: { fr: 'Communauté', en: 'Community' },
    description: { 
      fr: 'Projets de développement communautaire et d\'entraide',
      en: 'Community development and mutual aid projects'
    },
    icon: '🤝',
    color: '#8B5CF6',
    order: 4,
  },
  INNOVATION: {
    id: 'innovation',
    name: { fr: 'Innovation', en: 'Innovation' },
    description: { 
      fr: 'Projets technologiques et d\'innovation sociale',
      en: 'Technological and social innovation projects'
    },
    icon: '💡',
    color: '#F59E0B',
    order: 5,
  },
} as const;

/**
 * Statuts des entités
 */
export const STATUS = {
  USER: {
    ACTIVE: 'active',
    SUSPENDED: 'suspended',
    BANNED: 'banned',
  },
  
  PROJECT: {
    DRAFT: 'draft',
    UNDER_REVIEW: 'under_review',
    LIVE: 'live',
    FUNDED: 'funded',
    ACTIVE: 'active',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
  },
  
  CONTRIBUTION: {
    PENDING: 'pending',
    CONFIRMED: 'confirmed',
    FAILED: 'failed',
    REFUNDED: 'refunded',
    DISPUTED: 'disputed',
  },
  
  MILESTONE: {
    PENDING: 'pending',
    SUBMITTED: 'submitted',
    UNDER_AUDIT: 'under_audit',
    APPROVED: 'approved',
    REJECTED: 'rejected',
    REVISION_REQUESTED: 'needs_revision',
  },
  
  AUDIT: {
    ASSIGNED: 'assigned',
    ACCEPTED: 'accepted',
    IN_PROGRESS: 'in_progress',
    SUBMITTED: 'submitted',
    COMPLETED: 'completed',
    REJECTED: 'rejected',
  },
  
  KYC: {
    PENDING: 'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected',
    REQUIRES_ACTION: 'requires_action',
    EXPIRED: 'expired',
  },
  
  PAYMENT: {
    PENDING: 'pending',
    PROCESSING: 'processing',
    SUCCEEDED: 'succeeded',
    FAILED: 'failed',
    CANCELED: 'canceled',
    REQUIRES_ACTION: 'requires_action',
  },
} as const;

/**
 * Types d'utilisateurs et permissions
 */
export const USER_TYPES = {
  CONTRIBUTOR: {
    id: 'contributor',
    name: { fr: 'Contributeur', en: 'Contributor' },
    permissions: [
      'contribution.create',
      'contribution.view_own',
      'project.view',
      'profile.update_own',
    ],
  },
  CREATOR: {
    id: 'creator',
    name: { fr: 'Créateur', en: 'Creator' },
    permissions: [
      'project.create',
      'project.update_own',
      'project.view_own',
      'milestone.submit',
      'contribution.create',
      'contribution.view_own',
      'profile.update_own',
    ],
  },
  AUDITOR: {
    id: 'auditor',
    name: { fr: 'Auditeur', en: 'Auditor' },
    permissions: [
      'audit.accept',
      'audit.evaluate',
      'milestone.approve',
      'milestone.reject',
      'project.view',
      'profile.update_own',
    ],
  },
  ADMIN: {
    id: 'admin',
    name: { fr: 'Administrateur', en: 'Administrator' },
    permissions: [
      'project.moderate',
      'user.manage',
      'audit.assign',
      'system.configure',
      'analytics.view_all',
      '*', // Toutes permissions
    ],
  },
} as const;

/**
 * Configuration KYC
 */
export const KYC_CONFIG = {
  LEVELS: {
    NONE: {
      level: 0,
      name: 'Non vérifié',
      maxContribution: 0,
      requirements: [],
    },
    BASIC: {
      level: 1,
      name: 'Vérification de base',
      maxContribution: LIMITS.KYC.BASIC_MAX_CONTRIBUTION,
      requirements: ['identity_document', 'selfie'],
      sumsubLevelName: 'basic-kyc-level',
    },
    ENHANCED: {
      level: 2,
      name: 'Vérification renforcée',
      maxContribution: LIMITS.KYC.ENHANCED_MAX_CONTRIBUTION,
      requirements: ['identity_document', 'proof_of_address', 'selfie', 'manual_review'],
      sumsubLevelName: 'enhanced-kyc-level',
    },
  },
  
  DOCUMENT_TYPES: {
    PASSPORT: 'passport',
    ID_CARD: 'id_card',
    DRIVERS_LICENSE: 'driving_license',
    PROOF_OF_ADDRESS: 'proof_of_address',
    SELFIE: 'selfie',
  },
} as const;

/**
 * Configuration email et notifications
 */
export const NOTIFICATIONS = {
  TYPES: {
    CONTRIBUTION: 'contribution',
    PROJECT: 'project',
    AUDIT: 'audit',
    KYC: 'kyc',
    SYSTEM: 'system',
    PAYMENT: 'payment',
    MARKETING: 'marketing',
  },
  
  PRIORITIES: {
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    URGENT: 'urgent',
  },
  
  CHANNELS: {
    IN_APP: 'inApp',
    EMAIL: 'email',
    PUSH: 'push',
    SMS: 'sms',
  },
  
  // Templates SendGrid
  EMAIL_TEMPLATES: {
    WELCOME: 'd-welcome-template-id',
    KYC_APPROVED: 'd-kyc-approved-template-id',
    KYC_REJECTED: 'd-kyc-rejected-template-id',
    CONTRIBUTION_RECEIPT: 'd-contribution-receipt-template-id',
    PROJECT_APPROVED: 'd-project-approved-template-id',
    PROJECT_REJECTED: 'd-project-rejected-template-id',
    MILESTONE_COMPLETED: 'd-milestone-completed-template-id',
    AUDIT_ASSIGNMENT: 'd-audit-assignment-template-id',
    PASSWORD_RESET: 'd-password-reset-template-id',
  },
} as const;

/**
 * Configuration audit
 */
export const AUDIT_CONFIG = {
  TIMEOUT_DAYS: 14,
  MIN_SCORE: 60,
  MAX_SCORE: 100,
  
  CRITERIA: {
    DELIVERABLES_QUALITY: {
      name: 'Qualité des livrables',
      weight: 30,
      required: true,
    },
    BUDGET_COMPLIANCE: {
      name: 'Respect du budget',
      weight: 25,
      required: true,
    },
    TIMELINE_ADHERENCE: {
      name: 'Respect des délais',
      weight: 20,
      required: true,
    },
    IMPACT_EVIDENCE: {
      name: 'Preuves d\'impact',
      weight: 15,
      required: true,
    },
    DOCUMENTATION: {
      name: 'Documentation complète',
      weight: 10,
      required: false,
    },
  },
  
  COMPENSATION: {
    BASE_AMOUNT: 20000, // 200€ en centimes
    COMPLEXITY_MULTIPLIER: {
      LOW: 1.0,
      MEDIUM: 1.5,
      HIGH: 2.0,
    },
    QUALITY_BONUS: 5000, // 50€ bonus qualité
    SPEED_BONUS: 3000, // 30€ bonus rapidité
  },
} as const;

/**
 * URLs et endpoints
 */
export const URLS = {
  FRONTEND: {
    PRODUCTION: 'https://socialimpact.fr',
    STAGING: 'https://staging.socialimpact.fr',
    DEVELOPMENT: 'http://localhost:3000',
  },
  
  API: {
    BASE: `https://europe-west1-${process.env.GCLOUD_PROJECT}.cloudfunctions.net`,
  },
  
  EXTERNAL: {
    STRIPE_DASHBOARD: 'https://dashboard.stripe.com',
    SUMSUB_DASHBOARD: 'https://cockpit.sumsub.com',
  },
} as const;

/**
 * Regex patterns
 */
export const PATTERNS = {
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  PHONE: /^\+[1-9]\d{1,14}$/,
  PASSWORD: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
  PROJECT_SLUG: /^[a-z0-9-]+$/,
  IBAN: /^[A-Z]{2}[0-9]{2}[A-Z0-9]{4}[0-9]{7}([A-Z0-9]?){0,16}$/,
  POSTAL_CODE: {
    FR: /^[0-9]{5}$/,
    BE: /^[0-9]{4}$/,
    DE: /^[0-9]{5}$/,
    ES: /^[0-9]{5}$/,
    IT: /^[0-9]{5}$/,
  },
} as const;

/**
 * Messages d'erreur standardisés
 */
export const ERROR_MESSAGES = {
  AUTH: {
    REQUIRED: 'Authentification requise',
    INVALID_TOKEN: 'Token d\'authentification invalide',
    INSUFFICIENT_PERMISSIONS: 'Permissions insuffisantes',
    ACCOUNT_SUSPENDED: 'Compte suspendu',
    ACCOUNT_BANNED: 'Compte banni',
  },
  
  VALIDATION: {
    REQUIRED_FIELD: 'Ce champ est obligatoire',
    INVALID_EMAIL: 'Adresse email invalide',
    INVALID_PHONE: 'Numéro de téléphone invalide',
    PASSWORD_TOO_WEAK: 'Mot de passe trop faible',
    AMOUNT_TOO_LOW: `Montant minimum: ${LIMITS.CONTRIBUTION.MIN_AMOUNT / 100}€`,
    AMOUNT_TOO_HIGH: `Montant maximum: ${LIMITS.CONTRIBUTION.MAX_AMOUNT / 100}€`,
  },
  
  BUSINESS: {
    KYC_REQUIRED: 'Vérification KYC requise',
    QUOTA_EXCEEDED: 'Quota dépassé',
    PROJECT_LIMIT_REACHED: 'Limite de projets atteinte',
    CONTRIBUTION_LIMIT_REACHED: 'Limite de contribution atteinte',
    INSUFFICIENT_FUNDS: 'Fonds insuffisants',
    PROJECT_NOT_LIVE: 'Projet non disponible pour les contributions',
  },
  
  SYSTEM: {
    INTERNAL_ERROR: 'Erreur interne du serveur',
    SERVICE_UNAVAILABLE: 'Service temporairement indisponible',
    RATE_LIMIT_EXCEEDED: 'Limite de requêtes dépassée',
    MAINTENANCE_MODE: 'Maintenance en cours',
  },
} as const;

/**
 * Configuration de développement
 */
export const DEV_CONFIG = {
  BYPASS_KYC: process.env.NODE_ENV === 'development',
  BYPASS_PAYMENTS: process.env.NODE_ENV === 'development',
  MOCK_EXTERNAL_SERVICES: process.env.NODE_ENV === 'test',
  LOG_LEVEL: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
  
  TEST_USERS: {
    CONTRIBUTOR: 'test-contributor@example.com',
    CREATOR: 'test-creator@example.com',
    AUDITOR: 'test-auditor@example.com',
    ADMIN: 'test-admin@example.com',
  },
} as const;

/**
 * Métriques et analytics
 */
export const ANALYTICS = {
  EVENTS: {
    USER_REGISTERED: 'user_registered',
    PROFILE_COMPLETED: 'profile_completed',
    KYC_STARTED: 'kyc_started',
    KYC_COMPLETED: 'kyc_completed',
    PROJECT_CREATED: 'project_created',
    PROJECT_PUBLISHED: 'project_published',
    CONTRIBUTION_MADE: 'contribution_made',
    MILESTONE_SUBMITTED: 'milestone_submitted',
    AUDIT_COMPLETED: 'audit_completed',
  },
  
  CONVERSION_FUNNELS: {
    USER_ONBOARDING: [
      'user_registered',
      'profile_completed',
      'kyc_started',
      'kyc_completed',
    ],
    PROJECT_CREATION: [
      'project_started',
      'project_drafted',
      'project_submitted',
      'project_published',
    ],
    CONTRIBUTION_FLOW: [
      'project_viewed',
      'contribute_clicked',
      'payment_started',
      'payment_completed',
    ],
  },
} as const;