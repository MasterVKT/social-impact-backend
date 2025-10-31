/**
 * Types globaux pour la Social Finance Impact Platform
 */

export type UserType = 'contributor' | 'creator' | 'auditor' | 'admin';

export type KYCStatus = 'pending' | 'approved' | 'rejected' | 'requires_action';

export type KYCLevel = 0 | 1 | 2; // 0: non-vérifié, 1: basic, 2: enhanced

export type ProjectStatus = 'draft' | 'under_review' | 'live' | 'funded' | 'active' | 'completed' | 'failed' | 'cancelled';

export type ProjectCategory = 'environment' | 'education' | 'health' | 'community' | 'innovation';

export type MilestoneStatus = 'pending' | 'submitted' | 'under_audit' | 'approved' | 'rejected' | 'revision_requested';

export type ContributionStatus = 'pending' | 'confirmed' | 'failed' | 'refunded' | 'disputed';

export type AuditStatus = 'assigned' | 'accepted' | 'in_progress' | 'submitted' | 'completed' | 'rejected';

export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'canceled' | 'requires_action';

export type NotificationType = 'contribution' | 'project' | 'audit' | 'system' | 'payment' | 'kyc';

export type Language = 'fr' | 'en';

export type Currency = 'EUR';

export type Country = string; // ISO 3166-1 alpha-2

export interface Address {
  street: string;
  city: string;
  postalCode: string;
  country: Country;
  coordinates?: {
    lat: number;
    lng: number;
  };
}

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

export interface PaginationOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
  startAfter?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  hasMore: boolean;
  nextPageToken?: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  timestamp: string;
}

export interface FeeStructure {
  platform: number; // 5%
  audit: number; // 3%
  stripe: number; // ~2.9% + 0.30€
  total: number;
}

export interface NotificationPreferences {
  email: boolean;
  push: boolean;
  inApp: boolean;
}

export interface UserPreferences {
  language: Language;
  currency: Currency;
  notifications: NotificationPreferences;
  interestedCategories: ProjectCategory[];
}

export interface UserStats {
  totalContributed: number;
  projectsSupported: number;
  projectsCreated: number;
  successfulProjects: number;
  auditsCompleted: number;
  completionRate: number;
  averageRating: number;
}

export interface ProjectStats {
  views: number;
  contributions: number;
  contributors: number;
  shares: number;
  likes: number;
  comments: number;
}

export interface AuditCriteria {
  name: string;
  description: string;
  weight: number; // Pourcentage du score total
  required: boolean;
}

export interface FileUpload {
  name: string;
  type: string;
  size: number;
  url?: string;
  content?: string; // base64
  uploadedAt?: Date;
}

export interface GeoLocation {
  lat: number;
  lng: number;
  accuracy?: number;
}

/**
 * Erreurs métier standardisées
 */
export enum ErrorCodes {
  // Authentication & Authorization
  AUTH_REQUIRED = 'AUTH_REQUIRED',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
  
  // Validation
  INVALID_INPUT = 'INVALID_INPUT',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  
  // Resources
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  RESOURCE_CONFLICT = 'RESOURCE_CONFLICT',
  
  // Business Rules
  KYC_REQUIRED = 'KYC_REQUIRED',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  BUSINESS_RULE_VIOLATION = 'BUSINESS_RULE_VIOLATION',
  
  // External Services
  EXTERNAL_API_ERROR = 'EXTERNAL_API_ERROR',
  STRIPE_ERROR = 'STRIPE_ERROR',
  SUMSUB_ERROR = 'SUMSUB_ERROR',
  SENDGRID_ERROR = 'SENDGRID_ERROR',
  
  // System
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE'
}

/**
 * Configuration globale de l'application
 */
export interface AppConfig {
  limits: {
    maxContributionAmount: number; // 1000€
    maxProjectGoal: number; // 50000€
    maxActiveProjects: number; // 3 per creator
    maxFileSize: number; // 10MB
    maxImages: number; // 10 per project
  };
  fees: FeeStructure;
  kyc: {
    basic: {
      maxContribution: number;
      requirements: string[];
    };
    enhanced: {
      maxContribution: number;
      requirements: string[];
    };
  };
  audit: {
    timeoutDays: number; // 14 days
    minScore: number; // 60/100
    requiredCriteria: string[];
  };
  project: {
    minDurationDays: number; // 30
    maxDurationDays: number; // 90
    minFundingGoal: number; // 1000€
  };
}

/**
 * Métadonnées d'audit trail
 */
export interface AuditTrail {
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
  version: number;
  changes?: {
    field: string;
    oldValue: any;
    newValue: any;
    timestamp: Date;
    userId: string;
  }[];
}