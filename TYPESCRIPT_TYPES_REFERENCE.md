# TypeScript Type Definitions - Social Impact Platform

Complete type definitions for frontend integration.

---

## Table of Contents

1. [Global Types](#global-types)
2. [User Types](#user-types)
3. [Project Types](#project-types)
4. [Contribution Types](#contribution-types)
5. [Audit Types](#audit-types)
6. [Notification Types](#notification-types)
7. [API Response Types](#api-response-types)

---

## Global Types

```typescript
// types/global.ts

export type UserType = 'contributor' | 'creator' | 'auditor' | 'admin';

export type KYCStatus = 'pending' | 'approved' | 'rejected' | 'requires_action';

export type KYCLevel = 0 | 1 | 2; // 0: unverified, 1: basic, 2: enhanced

export type ProjectStatus =
  | 'draft'
  | 'under_review'
  | 'live'
  | 'funded'
  | 'active'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ProjectCategory =
  | 'environment'
  | 'education'
  | 'health'
  | 'community'
  | 'innovation';

export type MilestoneStatus =
  | 'pending'
  | 'submitted'
  | 'under_audit'
  | 'approved'
  | 'rejected'
  | 'revision_requested';

export type ContributionStatus =
  | 'pending'
  | 'confirmed'
  | 'failed'
  | 'refunded'
  | 'disputed';

export type AuditStatus =
  | 'assigned'
  | 'accepted'
  | 'in_progress'
  | 'submitted'
  | 'completed'
  | 'rejected';

export type PaymentStatus =
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'requires_action';

export type NotificationType =
  | 'contribution'
  | 'project'
  | 'audit'
  | 'system'
  | 'payment'
  | 'kyc';

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
  startDate: string;
  endDate: string;
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
```

---

## User Types

```typescript
// types/user.ts

export interface UserProfile {
  uid: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  profilePicture?: string;
  bio?: string;
  userType: UserType;
  profileComplete: boolean;

  kyc: {
    status: KYCStatus;
    level: KYCLevel;
    provider: 'sumsub';
    externalId?: string;
    submittedAt?: string;
    approvedAt?: string;
    expiresAt?: string;
    rejectionReason?: string;
    documents: Array<{
      type: 'passport' | 'id_card' | 'driving_license' | 'proof_of_address';
      status: 'pending' | 'approved' | 'rejected';
      submittedAt: string;
    }>;
  };

  preferences: {
    language: Language;
    currency: Currency;
    timezone?: string;
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
      categories: ProjectCategory[];
      causes?: string[];
    };
  };

  stats: {
    // Contributor stats
    totalContributed: number;
    projectsSupported: number;
    averageContribution: number;
    lastContributionAt?: string;

    // Creator stats
    projectsCreated: number;
    totalFundsRaised: number;
    successfulProjects: number;
    averageProjectSize: number;
    lastProjectAt?: string;

    // Auditor stats
    auditsCompleted: number;
    averageAuditTime: number;
    approvalRate: number;
    totalEarnings: number;
    lastAuditAt?: string;

    // General engagement
    profileViews: number;
    loginStreak: number;
    lastLoginAt: string;
  };

  accountStatus: 'active' | 'suspended' | 'banned';
  createdAt: string;
  updatedAt: string;
}

export interface UpdateProfileData {
  profilePicture?: string;
  bio?: string;
  preferences?: Partial<UserProfile['preferences']>;
  address?: {
    city?: string;
    country?: Country;
  };
}

export interface CompleteProfileData {
  userType: 'contributor' | 'creator';
  firstName: string;
  lastName: string;
  phoneNumber?: string;
  dateOfBirth: string; // ISO format YYYY-MM-DD
  address: Address;
  preferences: {
    language: Language;
    currency: Currency;
    notifications: {
      email: boolean;
      push: boolean;
      inApp: boolean;
    };
    interestedCategories: ProjectCategory[];
  };
}
```

---

## Project Types

```typescript
// types/project.ts

export interface Project {
  id: string;
  uid: string;
  slug: string;

  title: string;
  shortDescription: string;
  fullDescription: string;
  category: ProjectCategory;
  tags: string[];

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

  funding: {
    goal: number; // in cents
    raised: number; // in cents
    currency: Currency;
    percentage: number;
    contributorsCount: number;
    averageContribution: number;
    deadline: string;
    minContribution: number;
    maxContribution?: number;
    fees: {
      platformPercentage: number;
      auditPercentage: number;
      platformAmount: number;
      auditAmount: number;
    };
  };

  status: ProjectStatus;
  visibility: 'public' | 'private';

  timeline: {
    createdAt: string;
    submittedAt?: string;
    approvedAt?: string;
    publishedAt?: string;
    startDate?: string;
    endDate: string;
    completedAt?: string;
    daysRemaining?: number;
  };

  impactGoals: {
    primary: string;
    secondary?: string[];
    metrics: Array<{
      id: string;
      name: string;
      target: number;
      unit: string;
      description?: string;
      current: number;
      percentage: number;
      lastUpdatedAt?: string;
    }>;
  };

  milestones: Array<{
    id: string;
    order: number;
    title: string;
    description: string;
    criteria: string[];
    deliverables: string[];
    budget: {
      percentage: number;
      amount: number;
      spent?: number;
    };
    timeline: {
      plannedStartDate: string;
      plannedEndDate: string;
      actualStartDate?: string;
      actualEndDate?: string;
      submissionDeadline: string;
    };
    status: MilestoneStatus;
    submission?: MilestoneSubmission;
    audit?: MilestoneAudit;
  }>;

  media: {
    coverImage: string;
    gallery?: string[];
    video?: string;
    documents?: Array<{
      id: string;
      name: string;
      url: string;
      type: 'business_plan' | 'impact_study' | 'budget' | 'other';
      size: number;
      uploadedAt: string;
      downloadable: boolean;
    }>;
  };

  location?: {
    country: Country;
    region?: string;
    city?: string;
    coordinates?: {
      latitude: number;
      longitude: number;
    };
  };

  team: Array<{
    id: string;
    name: string;
    role: string;
    bio?: string;
    avatar?: string;
    linkedin?: string;
    isLead: boolean;
    joinedAt: string;
  }>;

  settings: {
    allowPublicComments: boolean;
    publicContributorsList: boolean;
    allowComments: boolean;
    emailUpdatesEnabled: boolean;
    autoRefundOnFailure: boolean;
  };

  stats: {
    views: number;
    totalViews: number;
    saves: number;
    shares: number;
    comments: number;
    conversionRate: number;
  };

  auditRequired: boolean;
  auditStatus?: AuditStatus;
  riskLevel: 'low' | 'medium' | 'high';

  createdAt: string;
  updatedAt: string;
}

export interface MilestoneSubmission {
  submittedAt: string;
  submittedBy: string;
  description: string;
  completionPercentage: number;
  evidence: Array<{
    type: 'image' | 'document' | 'video' | 'link';
    name: string;
    url: string;
    description?: string;
    uploadedAt: string;
  }>;
  actualMetrics: {
    beneficiariesReached?: number;
    outcomesMeasured?: Record<string, any>;
    feedback?: string[];
  };
}

export interface MilestoneAudit {
  auditorUid: string;
  auditorName: string;
  assignedAt: string;
  startedAt?: string;
  completedAt?: string;
  deadline: string;
  score: number;
  decision: 'approved' | 'rejected' | 'needs_revision';
  criteriaEvaluation: Array<{
    criterion: string;
    met: boolean;
    score: number;
    comments?: string;
  }>;
  report: {
    summary: string;
    strengths: string[];
    weaknesses: string[];
    recommendations: string[];
    riskAssessment: 'low' | 'medium' | 'high';
    confidence: number;
  };
  fundsReleased?: number;
  releaseDate?: string;
}

export interface CreateProjectData {
  title: string;
  shortDescription: string;
  description: string;
  category: ProjectCategory;
  tags: string[];

  impactGoals: {
    primary: string;
    secondary?: string[];
    metrics: Array<{
      name: string;
      target: number;
      unit: string;
      description?: string;
    }>;
  };

  funding: {
    goal: number;
    currency: Currency;
    deadline: string;
    minContribution?: number;
  };

  milestones: Array<{
    title: string;
    description: string;
    targetDate: string;
    fundingPercentage: number;
    deliverables: string[];
  }>;

  media: {
    coverImage: string;
    gallery?: string[];
    video?: string;
    documents?: Array<{
      name: string;
      url: string;
      type: string;
      size?: number;
    }>;
  };

  location: {
    country: Country;
    region?: string;
    city?: string;
    coordinates?: {
      lat: number;
      lng: number;
    };
  };

  team: Array<{
    name: string;
    role: string;
    bio?: string;
    avatar?: string;
    linkedin?: string;
  }>;

  settings?: {
    allowPublicComments?: boolean;
    requireIdentityVerification?: boolean;
    autoApproveContributions?: boolean;
    notifyOnMilestone?: boolean;
    visibility?: 'public' | 'private';
  };
}

export interface ProjectListItem {
  id: string;
  title: string;
  shortDescription: string;
  category: ProjectCategory;
  coverImageUrl: string;
  creator: {
    uid: string;
    displayName: string;
    profilePicture?: string;
  };
  funding: {
    goal: number;
    raised: number;
    percentage: number;
    contributorsCount: number;
  };
  status: ProjectStatus;
  endDate: string;
  createdAt: string;
  metrics: {
    views: number;
    saves: number;
  };
}

export interface SearchProjectsParams {
  query?: string;
  category?: ProjectCategory;
  status?: ProjectStatus;
  minFunding?: number;
  maxFunding?: number;
  location?: Country;
  sortBy?: 'recent' | 'popular' | 'ending_soon' | 'funding_progress';
  limit?: number;
  offset?: number;
}
```

---

## Contribution Types

```typescript
// types/contribution.ts

export interface Contribution {
  id: string;
  uid: string;
  contributorUid: string;
  projectId: string;

  contributor: {
    uid: string;
    displayName: string;
    profilePicture?: string;
    isAnonymous: boolean;
    country?: Country;
  };

  amount: {
    gross: number; // in cents
    fees: {
      platform: number;
      stripe: number;
      total: number;
    };
    net: number; // in cents
    currency: Currency;
  };

  payment: {
    status: PaymentStatus;
    provider: 'stripe';
    paymentIntentId: string;
    paymentMethodId?: string;
    customerStripeId?: string;
    cardLast4?: string;
    cardBrand?: string;
    cardCountry?: string;
    initiatedAt: string;
    confirmedAt?: string;
    failedAt?: string;
    refundedAt?: string;
    failureReason?: string;
  };

  escrow: {
    status: 'held' | 'released' | 'refunded';
    heldAmount: number;
    releasedAmount: number;
    releases: Array<{
      milestoneId: string;
      amount: number;
      releasedAt: string;
      reason: string;
    }>;
    refund?: {
      amount: number;
      reason: string;
      processedAt: string;
      stripeRefundId: string;
    };
  };

  message?: string;

  preferences: {
    anonymous: boolean;
    receiveUpdates: boolean;
    allowContact: boolean;
  };

  source: {
    referrer?: string;
    campaign?: string;
    medium?: string;
    device: 'mobile' | 'tablet' | 'desktop';
  };

  status: ContributionStatus;
  verified: boolean;

  createdAt: string;
  updatedAt: string;
}

export interface CreateContributionData {
  projectId: string;
  amount: number;
  message?: string;
  anonymous: boolean;
  paymentMethod: {
    type: 'card';
    source: 'form' | 'saved';
    savedPaymentMethodId?: string;
  };
}

export interface CreateContributionResponse {
  contributionId: string;
  paymentIntent: {
    id: string;
    clientSecret: string;
    amount: number;
    currency: string;
  };
  fees: {
    platformFee: number;
    stripeFee: number;
    totalFees: number;
  };
  escrow: {
    holdUntil: string;
    releaseConditions: string[];
  };
  success: boolean;
}

export interface ConfirmPaymentData {
  paymentIntentId: string;
  stripeClientSecret: string;
}

export interface ConfirmPaymentResponse {
  status: 'succeeded';
  receiptUrl: string;
  transactionId: string;
  escrowDetails: {
    amount: number;
    heldUntil: string;
    releaseSchedule: Array<{
      milestoneId: string;
      amount: number;
      conditions: string;
    }>;
  };
}

export interface ContributionPortfolio {
  summary: {
    totalInvested: number;
    activeContributions: number;
    completedProjects: number;
    totalImpact: {
      beneficiariesHelped: number;
      projectsSupported: number;
    };
  };
  contributions: Array<{
    id: string;
    amount: number;
    date: string;
    status: ContributionStatus;
    project: {
      id: string;
      title: string;
      coverImage: string;
      status: ProjectStatus;
      progress: {
        milestonesCompleted: number;
        totalMilestones: number;
        percentageComplete: number;
      };
    };
    returns: {
      expectedImpact: string;
      actualImpact?: string;
    };
  }>;
}
```

---

## Audit Types

```typescript
// types/audit.ts

export interface Audit {
  id: string;
  projectId: string;
  projectTitle: string;
  creatorUid: string;
  creatorName: string;

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

  scope: {
    totalMilestones: number;
    estimatedHours: number;
    complexity: 'low' | 'medium' | 'high';
    specialRequirements?: string[];
  };

  timeline: {
    assignedAt: string;
    acceptedAt?: string;
    startedAt?: string;
    completedAt?: string;
    deadline: string;
    responseTime?: number;
    processingTime?: number;
    isOverdue: boolean;
  };

  status: AuditStatus;

  compensation: {
    baseAmount: number;
    bonusAmount?: number;
    totalAmount: number;
    currency: Currency;
    status: 'pending' | 'approved' | 'paid';
    paidAt?: string;
    invoiceRequired: boolean;
  };

  results: {
    milestonesAudited: number;
    averageScore: number;
    totalApproved: number;
    totalRejected: number;
    totalRevisions: number;
    fundsReleased: number;
  };

  feedback: {
    creatorRating?: number;
    creatorComment?: string;
    creatorSubmittedAt?: string;
    auditorComplexityRating?: number;
    auditorComment?: string;
    auditorSubmittedAt?: string;
    systemQualityScore?: number;
  };

  createdAt: string;
  updatedAt: string;
}

export interface AcceptAuditData {
  acceptanceNote?: string;
  estimatedCompletionDate: string;
}

export interface AcceptAuditResponse {
  status: string;
  acceptedAt: string;
  deadline: string;
  estimatedCompletion: string;
  project: {
    id: string;
    title: string;
    creator: string;
    category: string;
    milestones: Array<{
      id: string;
      title: string;
      status: string;
      dueDate: string;
      fundingPercentage: number;
    }>;
  };
  compensation: {
    amount: number;
    currency: Currency;
    terms: string;
  };
  workspace: {
    url: string;
    documentsRequired: number;
    milestonesToReview: number;
  };
  nextSteps: string[];
}

export interface SubmitReportData {
  milestoneId: string;
  decision: 'approved' | 'rejected' | 'needs_revision';
  score: number;
  criteria: Array<{
    name: string;
    met: boolean;
    score: number;
    comments?: string;
  }>;
  report: {
    summary: string;
    strengths: string[];
    weaknesses: string[];
    recommendations: string[];
    riskAssessment: 'low' | 'medium' | 'high';
  };
  evidence: Array<{
    type: 'document' | 'image' | 'video';
    name: string;
    content: string; // base64 or URL
  }>;
}

export interface SubmitReportResponse {
  reportId: string;
  submittedAt: string;
  decision: string;
  score: number;
  fundsReleased: number;
  nextMilestone?: {
    id: string;
    title: string;
    dueDate: string;
    status: string;
  };
  compensation: {
    amount: number;
    status: string;
    estimatedPayment: string;
  };
  followUp?: {
    required: boolean;
    deadline: string;
    type: string;
  };
  auditSummary: {
    timeSpent: number;
    criteriaEvaluated: number;
    evidenceProvided: number;
    riskLevel: string;
    confidenceLevel: number;
  };
}

export interface AuditorDashboard {
  stats: {
    totalAudits: number;
    completedAudits: number;
    activeAudits: number;
    completedThisMonth: number;
    averageProcessingTime: number;
    approvalRate: number;
    totalEarnings: number;
    thisMonthEarnings: number;
    averageScore: number;
    specializations: string[];
    rating: number;
  };
  assigned: Array<{
    auditId: string;
    projectId: string;
    projectTitle: string;
    projectCategory: string;
    milestoneTitle: string;
    milestoneId: string;
    assignedAt: string;
    acceptedAt: string;
    deadline: string;
    priority: 'high' | 'medium' | 'low';
    status: string;
    progress: {
      documentsReviewed: number;
      criteriaCompleted: number;
      estimatedTimeRemaining: number;
    };
    compensation: number;
    workspaceUrl: string;
    nextAction: string;
  }>;
  completed: Array<{
    auditId: string;
    projectId: string;
    projectTitle: string;
    projectCategory: string;
    milestoneTitle: string;
    completedAt: string;
    submittedAt: string;
    decision: string;
    score: number;
    timeSpent: number;
    compensation: {
      amount: number;
      status: string;
      paidAt: string;
    };
    feedback?: {
      creatorRating: number;
      creatorComment: string;
      wouldRecommend: boolean;
      submittedAt: string;
    };
    reportUrl: string;
  }>;
}
```

---

## Notification Types

```typescript
// types/notification.ts

export interface Notification {
  id: string;
  recipientUid: string;
  type: NotificationType;
  subtype: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';

  title: string;
  message: string;
  actionText?: string;
  actionUrl?: string;

  data: {
    projectId?: string;
    contributionId?: string;
    auditId?: string;
    amount?: number;
    [key: string]: any;
  };

  status: {
    read: boolean;
    readAt?: string;
    clicked: boolean;
    clickedAt?: string;
    dismissed: boolean;
    dismissedAt?: string;
  };

  channels: {
    inApp: {
      sent: boolean;
      sentAt?: string;
    };
    email: {
      enabled: boolean;
      sent: boolean;
      sentAt?: string;
      emailId?: string;
      opened?: boolean;
      clicked?: boolean;
    };
    push: {
      enabled: boolean;
      sent: boolean;
      sentAt?: string;
      messageId?: string;
      delivered?: boolean;
    };
  };

  source: 'system' | 'admin' | 'automated';
  locale: string;
  expiresAt?: string;

  createdAt: string;
}

export interface NotificationsList {
  unreadCount: number;
  notifications: Notification[];
}

export interface MarkNotificationReadResponse {
  marked: boolean;
  readAt: string;
}
```

---

## API Response Types

```typescript
// types/api-responses.ts

export interface BaseResponse {
  success: boolean;
  timestamp: string;
}

export interface ErrorResponse extends BaseResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any;
    field?: string;
  };
}

export interface SuccessResponse<T> extends BaseResponse {
  success: true;
  data: T;
}

// Health check
export interface HealthResponse {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime: number;
  responseTime: number;
  services: {
    database: {
      status: string;
      responseTime: number;
    };
    [key: string]: any;
  };
  system: {
    memory: any;
    cpu: any;
  };
}

// System status
export interface StatusResponse {
  status: 'operational';
  timestamp: string;
  api: {
    version: string;
    environment: string;
    region: string;
  };
  metrics: {
    requests: number;
    errors: number;
    averageResponseTime: number;
  };
}
```

---

## Constants

```typescript
// types/constants.ts

export const API_LIMITS = {
  CONTRIBUTION: {
    MIN_AMOUNT: 1000, // €10 in cents
    MAX_AMOUNT: 100000, // €1,000 in cents
    MAX_DAILY_BASIC: 100000, // €1,000
    MAX_MONTHLY_BASIC: 1000000, // €10,000
    MAX_MONTHLY_ENHANCED: 10000000, // €100,000
  },

  PROJECT: {
    MIN_FUNDING_GOAL: 100000, // €1,000
    MAX_FUNDING_GOAL: 5000000, // €50,000
    MIN_DURATION_DAYS: 30,
    MAX_DURATION_DAYS: 90,
    MAX_ACTIVE_PER_CREATOR: 3,
  },

  KYC: {
    BASIC_MAX_CONTRIBUTION: 100000, // €1,000
    ENHANCED_MAX_CONTRIBUTION: 10000000, // €100,000
  },
} as const;

export const FEES = {
  PLATFORM_PERCENTAGE: 0.05, // 5%
  AUDIT_PERCENTAGE: 0.03, // 3%
  STRIPE_PERCENTAGE: 0.029, // 2.9%
  STRIPE_FIXED_FEE: 30, // €0.30 in cents
} as const;

export const PROJECT_CATEGORIES = [
  { id: 'environment', name: 'Environment', icon: '🌱', color: '#10B981' },
  { id: 'education', name: 'Education', icon: '📚', color: '#3B82F6' },
  { id: 'health', name: 'Health', icon: '🏥', color: '#EF4444' },
  { id: 'community', name: 'Community', icon: '🤝', color: '#8B5CF6' },
  { id: 'innovation', name: 'Innovation', icon: '💡', color: '#F59E0B' },
] as const;

export const KYC_LEVELS = {
  NONE: {
    level: 0,
    name: 'Unverified',
    maxContribution: 0,
  },
  BASIC: {
    level: 1,
    name: 'Basic Verification',
    maxContribution: 100000, // €1,000
    requirements: ['identity_document', 'selfie'],
  },
  ENHANCED: {
    level: 2,
    name: 'Enhanced Verification',
    maxContribution: 10000000, // €100,000
    requirements: ['identity_document', 'proof_of_address', 'selfie', 'manual_review'],
  },
} as const;
```

---

## Usage Example

```typescript
// Example: Complete type-safe project creation

import { CreateProjectData, Project } from '@/types/project';
import { firebaseFunctions } from '@/lib/functions';

async function createProject(data: CreateProjectData): Promise<Project> {
  const response = await firebaseFunctions.createProject(data);

  // Fetch full project details
  const project = await apiClient.get<Project>(`/projects/${response.projectId}`);

  return project;
}

// All types are inferred and checked at compile time
const projectData: CreateProjectData = {
  title: 'My Project',
  // ... TypeScript will ensure all required fields are present
};

const project = await createProject(projectData);
console.log(project.funding.goal); // Type: number
console.log(project.milestones); // Type: Array<Milestone>
```

---

This provides complete, type-safe integration with the backend API.
