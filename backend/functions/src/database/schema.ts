/**
 * Database Schema Definition
 * Social Finance Impact Platform
 * 
 * Defines Firestore collections, indexes, and data models
 * for optimal performance and security
 */

import { FieldValue, Timestamp } from 'firebase-admin/firestore';

// ============================================================================
// BASE INTERFACES
// ============================================================================

export interface BaseDocument {
  id: string;
  createdAt: Date | Timestamp | FieldValue;
  updatedAt: Date | Timestamp | FieldValue;
  version: number;
}

export interface AuditableDocument extends BaseDocument {
  createdBy: string;
  updatedBy: string;
}

export interface SoftDeletableDocument extends BaseDocument {
  deletedAt?: Date | Timestamp | null;
  deletedBy?: string | null;
  isDeleted: boolean;
}

// ============================================================================
// USER SCHEMA
// ============================================================================

export interface UserProfile extends AuditableDocument {
  // Firebase Auth integration
  firebaseUid: string;
  email: string; // Encrypted in storage
  emailVerified: boolean;
  
  // Profile information
  profile: {
    firstName: string; // Encrypted
    lastName: string; // Encrypted
    displayName?: string;
    bio?: string;
    avatar?: {
      url: string;
      thumbnailUrl: string;
      uploadedAt: Date;
    };
    dateOfBirth?: Date; // Encrypted, for age verification
    phoneNumber?: string; // Encrypted
    
    // Location (optional, privacy-controlled)
    location?: {
      country: string;
      region?: string;
      city?: string;
      coordinates?: {
        lat: number;
        lng: number;
      };
    };
    
    // Social links
    website?: string;
    socialLinks?: {
      twitter?: string;
      linkedin?: string;
      github?: string;
      instagram?: string;
    };
  };
  
  // User preferences
  preferences: {
    // Notification settings
    notifications: {
      email: boolean;
      push: boolean;
      sms: boolean;
      frequency: 'immediate' | 'daily' | 'weekly' | 'monthly';
      types: {
        projectUpdates: boolean;
        donationReceipts: boolean;
        systemAnnouncements: boolean;
        marketingEmails: boolean;
        auditReports: boolean;
      };
    };
    
    // Privacy settings
    privacy: {
      profileVisibility: 'public' | 'private' | 'supporters_only';
      showDonations: boolean;
      showLocation: boolean;
      showContactInfo: boolean;
      allowDirectMessages: boolean;
    };
    
    // Platform preferences
    language: string; // ISO 639-1 code
    timezone: string; // IANA timezone
    currency: string; // ISO 4217 code
    theme: 'light' | 'dark' | 'auto';
  };
  
  // Authentication & Security
  security: {
    lastLoginAt?: Date;
    lastLoginIP?: string;
    loginAttempts: number;
    lockedUntil?: Date;
    passwordChangedAt?: Date;
    twoFactorEnabled: boolean;
    securityQuestions?: Array<{
      question: string;
      answerHash: string; // Hashed answer
    }>;
  };
  
  // User roles and permissions
  roles: Array<'user' | 'creator' | 'moderator' | 'auditor' | 'support' | 'admin'>;
  permissions: string[];
  
  // KYC and verification
  verification: {
    status: 'pending' | 'in_progress' | 'approved' | 'rejected' | 'requires_action';
    level: 'basic' | 'enhanced' | 'premium';
    kycProvider?: string;
    kycSessionId?: string;
    verifiedAt?: Date;
    documents?: Array<{
      type: 'passport' | 'drivers_license' | 'national_id' | 'proof_of_address';
      status: 'pending' | 'approved' | 'rejected';
      uploadedAt: Date;
      expiresAt?: Date;
    }>;
    riskAssessment?: {
      level: 'low' | 'medium' | 'high';
      score: number;
      factors: string[];
      assessedAt: Date;
    };
  };
  
  // Platform engagement
  engagement: {
    totalDonations: number;
    totalDonationAmount: number;
    totalProjectsCreated: number;
    totalProjectsSupported: number;
    averageRating: number;
    totalReviews: number;
    lastActiveAt: Date;
    signupSource?: string;
    referralCode?: string;
    referredBy?: string;
  };
  
  // Financial information
  financial: {
    // Payment methods (references to secure vault)
    paymentMethods: Array<{
      id: string;
      type: 'card' | 'bank_account' | 'paypal' | 'stripe';
      provider: string;
      last4?: string;
      brand?: string;
      expiryMonth?: number;
      expiryYear?: number;
      isDefault: boolean;
      addedAt: Date;
    }>;
    
    // Tax information
    taxInfo?: {
      taxId?: string; // Encrypted
      vatNumber?: string; // Encrypted
      taxCountry: string;
      taxExempt: boolean;
    };
    
    // Donation limits
    limits: {
      dailyLimit: number;
      monthlyLimit: number;
      yearlyLimit: number;
      currentDailySpent: number;
      currentMonthlySpent: number;
      currentYearlySpent: number;
    };
  };
  
  // Legal compliance
  compliance: {
    termsAcceptedAt: Date;
    termsVersion: string;
    privacyAcceptedAt: Date;
    privacyVersion: string;
    cookiesAcceptedAt?: Date;
    marketingConsent: boolean;
    marketingConsentAt?: Date;
    gdprDataRequest?: {
      type: 'access' | 'rectification' | 'erasure' | 'portability';
      requestedAt: Date;
      processedAt?: Date;
      status: 'pending' | 'processing' | 'completed' | 'rejected';
    };
  };
  
  // Account status
  status: 'active' | 'inactive' | 'suspended' | 'pending_verification' | 'banned';
  suspensionReason?: string;
  suspensionExpiresAt?: Date;
}

// ============================================================================
// PROJECT SCHEMA
// ============================================================================

export interface Project extends AuditableDocument, SoftDeletableDocument {
  // Basic project information
  title: string;
  slug: string; // URL-friendly identifier
  shortDescription: string;
  fullDescription: string;
  category: 'education' | 'health' | 'environment' | 'poverty' | 'disaster_relief' | 'community' | 'technology' | 'other';
  tags: string[];
  
  // Creator information
  creatorId: string;
  creatorProfile: {
    displayName: string;
    avatar?: string;
    verificationLevel: 'basic' | 'enhanced' | 'premium';
  };
  
  // Funding details
  funding: {
    goal: number; // Target amount in cents
    currency: string; // ISO 4217
    raised: number; // Current amount raised in cents
    backerCount: number;
    averageDonation: number;
    
    // Funding timeline
    startDate: Date;
    endDate: Date;
    duration: number; // Days
    
    // Fee structure
    fees: {
      platform: number; // Percentage
      payment: number; // Percentage
      audit: number; // Percentage
    };
  };
  
  // Project location
  location: {
    country: string;
    region?: string;
    city?: string;
    coordinates?: {
      lat: number;
      lng: number;
    };
    impactRadius?: number; // Kilometers
  };
  
  // Media and assets
  media: {
    coverImage: {
      url: string;
      thumbnailUrl: string;
      alt: string;
    };
    gallery?: Array<{
      type: 'image' | 'video';
      url: string;
      thumbnailUrl?: string;
      caption?: string;
      alt?: string;
    }>;
    documents?: Array<{
      name: string;
      url: string;
      type: string;
      size: number;
      uploadedAt: Date;
    }>;
  };
  
  // Project milestones
  milestones: Array<{
    id: string;
    title: string;
    description: string;
    targetDate: Date;
    fundingPercentage: number; // Percentage of total goal
    deliverables: string[];
    status: 'pending' | 'in_progress' | 'completed' | 'delayed' | 'cancelled';
    completedAt?: Date;
    evidence?: Array<{
      type: 'image' | 'document' | 'video';
      url: string;
      description: string;
    }>;
  }>;
  
  // Project timeline and updates
  updates: Array<{
    id: string;
    title: string;
    content: string;
    publishedAt: Date;
    isPublic: boolean;
    media?: Array<{
      type: 'image' | 'video';
      url: string;
      caption?: string;
    }>;
  }>;
  
  // Team members
  team?: Array<{
    userId: string;
    role: string;
    displayName: string;
    avatar?: string;
    bio?: string;
    joinedAt: Date;
  }>;
  
  // Project status and workflow
  status: 'draft' | 'submitted' | 'under_review' | 'published' | 'funded' | 'in_progress' | 'completed' | 'cancelled' | 'suspended';
  submittedAt?: Date;
  publishedAt?: Date;
  completedAt?: Date;
  
  // Moderation and review
  moderation: {
    reviewStatus: 'pending' | 'approved' | 'rejected' | 'requires_changes';
    reviewedBy?: string;
    reviewedAt?: Date;
    reviewNotes?: string;
    flaggedReasons?: string[];
    flaggedBy?: string[];
    autoApproved: boolean;
  };
  
  // Risk assessment
  riskAssessment: {
    level: 'low' | 'medium' | 'high' | 'critical';
    score: number;
    factors: Array<{
      category: string;
      description: string;
      weight: number;
    }>;
    assessedAt: Date;
    assessedBy: string; // 'system' or user ID
  };
  
  // Analytics and metrics
  analytics: {
    viewCount: number;
    shareCount: number;
    favoriteCount: number;
    conversionRate: number; // Views to donations
    averageTimeOnPage: number;
    topReferrers: Array<{
      source: string;
      visits: number;
    }>;
    geographicDistribution: Record<string, number>; // Country code -> donation count
  };
  
  // SEO and marketing
  seo: {
    metaTitle?: string;
    metaDescription?: string;
    keywords?: string[];
    canonicalUrl?: string;
  };
  
  // Legal and compliance
  legal: {
    termsAccepted: boolean;
    termsVersion: string;
    intellectualProperty: {
      owns: boolean;
      licenses?: string[];
      restrictions?: string[];
    };
    dataProtection: {
      gdprCompliant: boolean;
      dataRetentionPeriod: number; // Days
    };
  };
}

// ============================================================================
// DONATION SCHEMA
// ============================================================================

export interface Donation extends AuditableDocument {
  // Basic donation information
  projectId: string;
  donorId: string;
  amount: number; // Amount in cents
  currency: string; // ISO 4217
  
  // Payment processing
  payment: {
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'refunded' | 'disputed' | 'cancelled';
    provider: 'stripe' | 'paypal' | 'bank_transfer';
    transactionId?: string;
    paymentIntentId?: string;
    paymentMethodId?: string;
    
    // Payment method details (masked/tokenized)
    paymentMethod: {
      type: 'card' | 'bank_account' | 'paypal' | 'apple_pay' | 'google_pay';
      last4?: string;
      brand?: string;
      fingerprint?: string;
      country?: string;
    };
    
    // Processing timestamps
    processedAt?: Date;
    capturedAt?: Date;
    refundedAt?: Date;
    
    // Fees breakdown
    fees: {
      platform: number;
      payment: number;
      audit: number;
      total: number;
    };
  };
  
  // Donor information (privacy-controlled)
  donor: {
    name?: string; // Encrypted, only if not anonymous
    email: string; // Encrypted
    anonymous: boolean;
    message?: string;
    country?: string;
    
    // Recognition preferences
    recognition: {
      allowPublicRecognition: boolean;
      allowNameDisplay: boolean;
      allowAmountDisplay: boolean;
    };
  };
  
  // Recurring donation settings
  recurring?: {
    enabled: boolean;
    frequency: 'weekly' | 'monthly' | 'quarterly' | 'annually';
    subscriptionId?: string;
    nextPaymentDate?: Date;
    endDate?: Date;
    pausedUntil?: Date;
    totalPayments: number;
    completedPayments: number;
    failedPayments: number;
    lastPaymentDate?: Date;
    status: 'active' | 'paused' | 'cancelled' | 'completed' | 'failed';
  };
  
  // Tax and receipts
  tax: {
    deductible: boolean;
    receiptGenerated: boolean;
    receiptUrl?: string;
    receiptNumber?: string;
    taxYear: number;
    donorTaxId?: string; // Encrypted
  };
  
  // Compliance and fraud detection
  compliance: {
    amlChecked: boolean;
    amlStatus: 'clear' | 'review' | 'flagged';
    riskLevel: 'low' | 'medium' | 'high';
    riskScore: number;
    riskFactors: string[];
    
    // Geographic and behavioral data
    ipAddress: string; // Hashed
    userAgent: string;
    deviceFingerprint?: string;
    geoLocation?: {
      country: string;
      region: string;
      city: string;
      isp?: string;
      vpnDetected: boolean;
    };
    
    // Fraud detection results
    fraudAnalysis: {
      provider: string;
      score: number;
      decision: 'approve' | 'review' | 'decline';
      reasons: string[];
      analysedAt: Date;
    };
  };
  
  // Campaign tracking
  campaign?: {
    source: string;
    medium: string;
    campaign: string;
    term?: string;
    content?: string;
    referrer?: string;
    landingPage?: string;
  };
  
  // Donation impact tracking
  impact?: {
    milestoneContribution: number; // Percentage of milestone achieved
    impactMetrics: Record<string, number>; // Custom metrics per project type
    recognitionLevel: 'bronze' | 'silver' | 'gold' | 'platinum';
  };
  
  // Escrow and disbursement
  escrow: {
    held: boolean;
    releaseDate?: Date;
    releasedAt?: Date;
    releasedAmount?: number;
    disbursementId?: string;
    holdReason?: string;
  };
  
  // Communication preferences
  communication: {
    sendReceipt: boolean;
    sendUpdates: boolean;
    allowProjectCreatorContact: boolean;
    preferredLanguage: string;
  };
}

// ============================================================================
// AUDIT LOG SCHEMA
// ============================================================================

export interface AuditLog extends BaseDocument {
  // Event identification
  eventId: string;
  eventType: 'user_action' | 'system_event' | 'security_event' | 'payment_event' | 'compliance_event';
  action: string;
  resource: string;
  resourceId: string;
  
  // Actor information
  actorId: string; // User ID or 'system'
  actorType: 'user' | 'admin' | 'system' | 'service';
  actorDetails?: {
    email?: string;
    name?: string;
    roles?: string[];
    ipAddress?: string;
    userAgent?: string;
  };
  
  // Event details
  details: {
    operation: 'create' | 'read' | 'update' | 'delete' | 'execute';
    status: 'success' | 'failure' | 'pending';
    changes?: {
      before?: Record<string, any>;
      after?: Record<string, any>;
    };
    metadata?: Record<string, any>;
    errorMessage?: string;
  };
  
  // Context information
  context: {
    sessionId?: string;
    requestId?: string;
    apiVersion?: string;
    clientVersion?: string;
    environment: 'development' | 'staging' | 'production';
    service: string;
    endpoint?: string;
    method?: string;
  };
  
  // Risk and compliance
  risk: {
    level: 'low' | 'medium' | 'high' | 'critical';
    score?: number;
    factors?: string[];
    requiresReview: boolean;
  };
  
  // Retention and compliance
  retention: {
    retainUntil: Date;
    complianceCategory: 'security' | 'financial' | 'operational' | 'legal';
    immutable: boolean;
  };
}

// ============================================================================
// NOTIFICATION SCHEMA
// ============================================================================

export interface Notification extends BaseDocument {
  // Recipient information
  userId: string;
  
  // Notification content
  type: 'project_update' | 'donation_receipt' | 'milestone_achieved' | 'project_funded' | 'security_alert' | 'system_announcement';
  title: string;
  message: string;
  data?: Record<string, any>;
  
  // Delivery channels
  channels: {
    inApp: boolean;
    email: boolean;
    push: boolean;
    sms: boolean;
  };
  
  // Status tracking
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  readAt?: Date;
  deliveredAt?: Date;
  failureReason?: string;
  
  // Related entities
  relatedEntity?: {
    type: 'project' | 'donation' | 'user';
    id: string;
  };
  
  // Priority and scheduling
  priority: 'low' | 'normal' | 'high' | 'urgent';
  scheduledFor?: Date;
  expiresAt?: Date;
  
  // Grouping and batching
  groupId?: string;
  batchId?: string;
  canBatch: boolean;
}

// ============================================================================
// ANALYTICS SCHEMA
// ============================================================================

export interface Analytics extends BaseDocument {
  // Metric identification
  metricType: 'page_view' | 'donation' | 'project_creation' | 'user_registration' | 'search' | 'conversion';
  entity: 'user' | 'project' | 'donation' | 'platform';
  entityId?: string;
  
  // Measurement data
  value: number;
  unit?: string;
  dimensions: Record<string, string | number>;
  
  // Time series data
  timestamp: Date;
  timeGranularity: 'minute' | 'hour' | 'day' | 'week' | 'month';
  
  // Session and user context
  sessionId?: string;
  userId?: string;
  anonymousId?: string;
  
  // Geographic and device data
  geo?: {
    country: string;
    region?: string;
    city?: string;
  };
  
  device?: {
    type: 'desktop' | 'mobile' | 'tablet';
    os: string;
    browser: string;
  };
  
  // Campaign attribution
  attribution?: {
    source: string;
    medium: string;
    campaign: string;
    term?: string;
    content?: string;
  };
}

// ============================================================================
// FIRESTORE INDEXES CONFIGURATION
// ============================================================================

export const FIRESTORE_INDEXES = {
  // User indexes
  users: [
    { fields: ['firebaseUid'], unique: true },
    { fields: ['email'], unique: true },
    { fields: ['status', 'createdAt'] },
    { fields: ['roles', 'status'] },
    { fields: ['verification.status', 'createdAt'] },
    { fields: ['engagement.lastActiveAt'] },
    { fields: ['isDeleted', 'status'] }
  ],
  
  // Project indexes
  projects: [
    { fields: ['slug'], unique: true },
    { fields: ['creatorId', 'status'] },
    { fields: ['status', 'publishedAt'] },
    { fields: ['category', 'status', 'publishedAt'] },
    { fields: ['location.country', 'status', 'publishedAt'] },
    { fields: ['funding.endDate', 'status'] },
    { fields: ['moderation.reviewStatus', 'submittedAt'] },
    { fields: ['riskAssessment.level', 'status'] },
    { fields: ['isDeleted', 'status'] },
    // Full-text search support
    { fields: ['tags'], arrayContains: true },
    { fields: ['status', 'funding.raised'] },
    { fields: ['status', 'analytics.viewCount'] }
  ],
  
  // Donation indexes
  donations: [
    { fields: ['donorId', 'createdAt'] },
    { fields: ['projectId', 'createdAt'] },
    { fields: ['payment.status', 'createdAt'] },
    { fields: ['donorId', 'payment.status'] },
    { fields: ['projectId', 'payment.status'] },
    { fields: ['recurring.status', 'recurring.nextPaymentDate'] },
    { fields: ['compliance.riskLevel', 'createdAt'] },
    { fields: ['compliance.amlStatus', 'createdAt'] },
    { fields: ['tax.taxYear', 'donorId'] },
    { fields: ['amount', 'currency', 'createdAt'] }
  ],
  
  // Audit log indexes
  auditLogs: [
    { fields: ['actorId', 'createdAt'] },
    { fields: ['eventType', 'createdAt'] },
    { fields: ['resource', 'resourceId', 'createdAt'] },
    { fields: ['risk.level', 'createdAt'] },
    { fields: ['risk.requiresReview', 'createdAt'] },
    { fields: ['context.service', 'createdAt'] },
    { fields: ['retention.retainUntil'] }
  ],
  
  // Notification indexes
  notifications: [
    { fields: ['userId', 'createdAt'] },
    { fields: ['userId', 'status'] },
    { fields: ['type', 'createdAt'] },
    { fields: ['status', 'scheduledFor'] },
    { fields: ['priority', 'createdAt'] },
    { fields: ['groupId', 'createdAt'] }
  ],
  
  // Analytics indexes
  analytics: [
    { fields: ['metricType', 'timestamp'] },
    { fields: ['entity', 'entityId', 'timestamp'] },
    { fields: ['userId', 'timestamp'] },
    { fields: ['sessionId', 'timestamp'] },
    { fields: ['timeGranularity', 'timestamp'] },
    { fields: ['geo.country', 'timestamp'] }
  ]
};

// ============================================================================
// COLLECTION SECURITY RULES REFERENCE
// ============================================================================

export const SECURITY_RULES_REFERENCE = {
  users: {
    read: ['self', 'admin', 'auditor'],
    write: ['self', 'admin'],
    create: ['authenticated'],
    delete: ['admin']
  },
  
  projects: {
    read: ['public_if_published', 'creator', 'admin', 'moderator'],
    write: ['creator', 'admin', 'moderator'],
    create: ['verified_user', 'creator', 'admin'],
    delete: ['creator', 'admin']
  },
  
  donations: {
    read: ['donor', 'project_creator', 'admin', 'auditor'],
    write: ['system', 'admin'],
    create: ['authenticated'],
    delete: ['admin']
  },
  
  auditLogs: {
    read: ['admin', 'auditor'],
    write: ['system'],
    create: ['system'],
    delete: ['never']
  },
  
  notifications: {
    read: ['recipient', 'admin'],
    write: ['system', 'admin'],
    create: ['system'],
    delete: ['recipient', 'admin']
  },
  
  analytics: {
    read: ['admin', 'analyst'],
    write: ['system'],
    create: ['system'],
    delete: ['admin']
  }
};

export default {
  UserProfile,
  Project,
  Donation,
  AuditLog,
  Notification,
  Analytics,
  FIRESTORE_INDEXES,
  SECURITY_RULES_REFERENCE
};