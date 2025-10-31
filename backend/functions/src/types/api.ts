/**
 * Types API Request/Response - Social Finance Impact Platform
 * Interfaces pour toutes les requêtes et réponses API
 */

import { 
  UserType, 
  ProjectCategory, 
  Language, 
  Currency, 
  Country, 
  PaginationOptions, 
  PaginatedResponse,
  Address 
} from './global';

/**
 * Base Response Interface
 */
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
    field?: string;
  };
  timestamp: string;
}

/**
 * Authentication API Types
 */
export namespace AuthAPI {
  
  // Complete Profile
  export interface CompleteProfileRequest {
    userType: 'contributor' | 'creator';
    firstName: string;
    lastName: string;
    phoneNumber?: string;
    dateOfBirth: string;
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

  export interface CompleteProfileResponse {
    userId: string;
    profileComplete: boolean;
    kycRequired: boolean;
    nextStep: string;
  }

  // KYC Initialization
  export interface InitKYCRequest {
    kycLevel: 'basic' | 'enhanced';
  }

  export interface InitKYCResponse {
    sumsubToken: string;
    sumsubUrl: string;
    externalUserId: string;
    levelName: string;
    expiresAt: string;
  }

  // Profile Response
  export interface ProfileResponse {
    uid: string;
    email: string;
    firstName: string;
    lastName: string;
    userType: UserType;
    profilePicture?: string;
    kyc: {
      status: string;
      level: number;
      verifiedAt?: string;
      documents: {
        type: string;
        status: string;
        submittedAt: string;
      }[];
    };
    stats: {
      totalContributed: number;
      projectsSupported: number;
      projectsCreated: number;
      auditsCompleted: number;
    };
    preferences: any;
    createdAt: string;
    lastLoginAt: string;
  }

  // Update Profile
  export interface UpdateProfileRequest {
    profilePicture?: string;
    bio?: string;
    preferences?: {
      notifications?: {
        email?: boolean;
        push?: boolean;
        inApp?: boolean;
      };
      interestedCategories?: ProjectCategory[];
    };
    address?: {
      city?: string;
      country?: Country;
    };
  }

  export interface UpdateProfileResponse {
    updated: boolean;
    profilePictureUrl?: string;
  }

  // Handle KYC Webhook
  export interface HandleKYCWebhookRequest {
    type: string;
    reviewResult: {
      moderationComment: string;
      clientComment: string;
      reviewStatus: string;
      reviewRejectType?: string;
    };
    externalUserId: string;
    inspectionId: string;
    applicantId: string;
    correlationId: string;
    levelName: string;
    sandboxMode: boolean;
    reviewAnswer: string;
  }
}

/**
 * Projects API Types
 */
export namespace ProjectsAPI {
  
  // Create Project
  export interface CreateProjectRequest {
    title: string;
    shortDescription: string;
    fullDescription: string;
    category: ProjectCategory;
    fundingGoal: number;
    duration: number;
    location: {
      city: string;
      country: Country;
      coordinates?: {
        lat: number;
        lng: number;
      };
    };
    milestones: {
      title: string;
      description: string;
      targetDate: string;
      fundingPercentage: number;
      deliverables: string[];
    }[];
    images?: {
      url: string;
      caption?: string;
      isMain?: boolean;
    }[];
    tags?: string[];
  }

  export interface CreateProjectResponse {
    projectId: string;
    slug: string;
    status: string;
    estimatedApprovalTime: string;
  }

  // Submit Project
  export interface SubmitProjectRequest {
    finalReview: boolean;
    acceptsTerms: boolean;
    additionalNotes?: string;
  }

  export interface SubmitProjectResponse {
    status: string;
    submittedAt: string;
    estimatedDecision: string;
    reviewQueue: number;
  }

  // Project List Query
  export interface ProjectListQuery extends PaginationOptions {
    status?: 'live' | 'funded' | 'active' | 'completed';
    category?: ProjectCategory;
    minFunding?: number;
    maxFunding?: number;
    sortBy?: 'recent' | 'popular' | 'ending_soon' | 'funding_progress';
    search?: string;
  }

  // Project List Item
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
    status: string;
    endDate: string;
    createdAt: string;
    metrics: {
      views: number;
      saves: number;
    };
  }

  export interface ProjectListResponse extends PaginatedResponse<ProjectListItem> {}

  // Project Details
  export interface ProjectDetailsResponse {
    id: string;
    title: string;
    shortDescription: string;
    fullDescription: string;
    category: ProjectCategory;
    status: string;
    creator: {
      uid: string;
      displayName: string;
      profilePicture?: string;
      bio?: string;
      stats: {
        projectsCreated: number;
        successRate: number;
      };
    };
    funding: {
      goal: number;
      raised: number;
      percentage: number;
      contributorsCount: number;
      platformFee: number;
      auditFee: number;
    };
    timeline: {
      createdAt: string;
      publishedAt?: string;
      endDate: string;
      daysRemaining: number;
    };
    milestones: {
      id: string;
      title: string;
      description: string;
      budgetPercentage: number;
      status: string;
      dueDate: string;
      submittedAt?: string;
      audit?: {
        auditorName: string;
        status: string;
        completedAt?: string;
      };
    }[];
    impactMetrics: {
      beneficiariesCount: number;
      targetAudience: string;
      actualImpact?: any;
    };
    media: {
      coverImageUrl: string;
      additionalImages: string[];
      documents: {
        name: string;
        type: string;
        url: string;
        downloadable: boolean;
      }[];
    };
    userInteraction: {
      hasContributed: boolean;
      contributionAmount?: number;
      isSaved: boolean;
      canContribute: boolean;
    };
  }

  // Moderate Project
  export interface ModerateProjectRequest {
    decision: 'approved' | 'rejected';
    feedback?: string;
    requestedChanges?: string[];
    priority?: 'high' | 'medium' | 'low';
    assignAuditor?: string;
  }

  export interface ModerateProjectResponse {
    status: string;
    moderatedAt: string;
    notificationSent: boolean;
    auditorAssigned?: string;
  }

  // Search Projects
  export interface SearchProjectsRequest extends PaginationOptions {
    query: string;
    filters?: {
      category?: ProjectCategory;
      status?: string[];
      location?: {
        country?: Country;
        city?: string;
      };
      funding?: {
        min?: number;
        max?: number;
      };
    };
  }
}

/**
 * Contributions API Types
 */
export namespace ContributionsAPI {
  
  // Create Contribution
  export interface CreateContributionRequest {
    projectId: string;
    amount: number;
    message?: string;
    anonymous: boolean;
    paymentMethod: {
      type: 'card';
      source: 'form' | 'saved';
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
      total: number;
    };
    escrow: {
      holdUntil: string;
      releaseConditions: string[];
    };
  }

  // Confirm Contribution
  export interface ConfirmContributionRequest {
    paymentIntentId: string;
    stripeClientSecret: string;
  }

  export interface ConfirmContributionResponse {
    status: string;
    receiptUrl: string;
    transactionId: string;
    escrowDetails: {
      amount: number;
      heldUntil: string;
      releaseSchedule: {
        milestoneId: string;
        amount: number;
        conditions: string;
      }[];
    };
  }

  // Portfolio Response
  export interface ContributionPortfolioResponse {
    summary: {
      totalInvested: number;
      activeContributions: number;
      completedProjects: number;
      totalImpact: {
        beneficiariesHelped: number;
        projectsSupported: number;
      };
    };
    contributions: {
      id: string;
      amount: number;
      date: string;
      status: string;
      project: {
        id: string;
        title: string;
        coverImage: string;
        status: string;
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
    }[];
  }
}

/**
 * Audits API Types
 */
export namespace AuditsAPI {
  
  // Assign Auditor
  export interface AssignAuditorRequest {
    projectId: string;
    auditorUid: string;
    specializations: string[];
    deadline: string;
    compensation?: number;
  }

  export interface AssignAuditorResponse {
    auditId: string;
    assignedAt: string;
    deadline: string;
    status: string;
    compensation: number;
    estimatedHours: number;
    notificationSent: boolean;
    specializations: string[];
    nextStep: string;
  }

  // Accept Audit
  export interface AcceptAuditRequest {
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
      milestones: {
        id: string;
        title: string;
        status: string;
        dueDate: string;
        fundingPercentage: number;
      }[];
    };
    compensation: {
      amount: number;
      currency: string;
      terms: string;
    };
    workspace: {
      url: string;
      documentsRequired: number;
      milestonesToReview: number;
    };
    nextSteps: string[];
  }

  // Submit Report
  export interface SubmitReportRequest {
    milestoneId: string;
    decision: 'approved' | 'rejected' | 'needs_revision';
    score: number;
    criteria: {
      name: string;
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
    };
    evidence: {
      type: 'document' | 'image' | 'video';
      name: string;
      content: string;
    }[];
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

  // Auditor Dashboard
  export interface AuditorDashboardResponse {
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
    assigned: {
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
    }[];
    completed: {
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
    }[];
    opportunities?: any[];
    alerts?: any[];
    profile?: {
      specializations: string[];
      certifications: any[];
      hourlyRate: number;
      maxConcurrentAudits: number;
      availability: string;
      languages: string[];
    };
    performance?: {
      thisMonth: {
        auditsCompleted: number;
        averageScore: number;
        earnings: number;
      };
      trends: {
        improving: boolean;
        consistent: boolean;
        needsImprovement: boolean;
      };
    };
    nextActions?: string[];
  }
}

/**
 * Notifications API Types
 */
export namespace NotificationsAPI {
  
  // Notification Item
  export interface NotificationItem {
    id: string;
    type: string;
    title: string;
    message: string;
    data: {
      projectId?: string;
      amount?: number;
      actionUrl?: string;
      [key: string]: any;
    };
    read: boolean;
    createdAt: string;
  }

  // Notifications List
  export interface NotificationsListResponse {
    unreadCount: number;
    notifications: NotificationItem[];
  }

  // Mark as Read
  export interface MarkNotificationReadResponse {
    marked: boolean;
    readAt: string;
  }

  // Send Notification Request
  export interface SendNotificationRequest {
    recipientUid: string;
    type: string;
    title: string;
    message: string;
    data?: Record<string, any>;
    channels?: {
      inApp?: boolean;
      email?: boolean;
      push?: boolean;
    };
    priority?: 'low' | 'medium' | 'high' | 'urgent';
  }
}

/**
 * System API Types
 */
export namespace SystemAPI {
  
  // System Config Response
  export interface SystemConfigResponse {
    limits: {
      maxContributionAmount: number;
      maxProjectGoal: number;
      maxActiveProjects: number;
    };
    fees: {
      platformPercentage: number;
      auditPercentage: number;
    };
    categories: {
      id: string;
      name: string;
      description: string;
      icon: string;
    }[];
    kycLevels: {
      basic: {
        maxContribution: number;
        requirements: string[];
      };
      enhanced: {
        maxContribution: number;
        requirements: string[];
      };
    };
  }

  // Feedback Request
  export interface FeedbackRequest {
    type: 'bug' | 'feature' | 'complaint' | 'other';
    subject: string;
    message: string;
    category: 'ui' | 'payment' | 'project' | 'audit';
    priority: 'low' | 'medium' | 'high';
    attachments?: {
      name: string;
      type: 'image' | 'document';
      content: string;
    }[];
  }

  export interface FeedbackResponse {
    ticketId: string;
    createdAt: string;
    estimatedResponse: string;
    trackingUrl: string;
  }
}

/**
 * Admin API Types
 */
export namespace AdminAPI {
  
  // Admin Dashboard
  export interface AdminDashboardResponse {
    metrics: {
      totalUsers: number;
      activeProjects: number;
      totalFunding: number;
      completionRate: number;
    };
    pendingActions: {
      projectsToReview: number;
      kycToValidate: number;
      disputesToResolve: number;
    };
    recentActivity: {
      type: string;
      description: string;
      timestamp: string;
    }[];
  }
}

/**
 * Payments API Types
 */
export namespace PaymentsAPI {
  
  // Stripe Webhook Request
  export interface StripeWebhookRequest {
    id: string;
    object: string;
    api_version: string;
    created: number;
    data: {
      object: any;
    };
    livemode: boolean;
    pending_webhooks: number;
    request: {
      id: string;
      idempotency_key: string;
    };
    type: string;
  }

  // Stripe Webhook Response
  export interface StripeWebhookResponse {
    received: boolean;
    eventType: string;
    eventId: string;
    processed: boolean;
  }

  // Process Refunds Request
  export interface ProcessRefundsRequest {
    refundType: 'single' | 'project_cancelled' | 'project_failed' | 'dispute_resolution';
    contributionId?: string;
    refundReason?: string;
    projectId?: string;
    amount?: number;
    notifyContributors?: boolean;
    processImmediately?: boolean;
    adminOverride?: boolean;
  }

  export interface ProcessRefundsResponse {
    refundType: string;
    totalProcessed: number;
    successful: number;
    failed: number;
    totalRefunded: number;
    results: any[];
    processedAt: string;
    processedBy: string;
    success: boolean;
  }

  // Release Escrow Request
  export interface ReleaseEscrowRequest {
    releaseType: 'milestone_completion' | 'project_completion' | 'emergency_release' | 'admin_override';
    projectId: string;
    milestoneId?: string;
    releaseReason?: string;
    releasePercentage?: number;
    notifyContributors?: boolean;
    notifyCreator?: boolean;
    bypassSafetyChecks?: boolean;
  }

  export interface ReleaseEscrowResponse {
    releaseType: string;
    projectId: string;
    milestoneId?: string;
    totalReleased: number;
    contributionsProcessed: number;
    successful: number;
    failed: number;
    results: any[];
    processedAt: string;
    success: boolean;
  }
}

/**
 * Shared utility types
 */
export type RequestWithAuth<T = {}> = T & {
  auth: {
    uid: string;
    token: {
      email: string;
      role?: string;
      [key: string]: any;
    };
  };
};

export type CallableContext = {
  auth?: {
    uid: string;
    token: Record<string, any>;
  };
  rawRequest: {
    ip: string;
    [key: string]: any;
  };
};

export type PaginatedRequest = {
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
  startAfter?: string;
};

export type SortableFields = 'createdAt' | 'updatedAt' | 'funding.raised' | 'timeline.endDate' | 'analytics.views';

export type FilterOperator = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'not-in' | 'array-contains' | 'array-contains-any';