/**
 * Project Repository Implementation
 * Social Finance Impact Platform
 * 
 * Specialized repository for project management with advanced search,
 * funding tracking, and moderation capabilities
 */

import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { BaseRepository, QueryOptions, PaginationResult } from '../repository';
import { Project } from '../schema';
import { logger } from '../../utils/logger';
import { performanceMonitor } from '../../monitoring/performanceMonitor';
import { metricsCollector } from '../../monitoring/metricsCollector';
import { auditLogger } from '../../monitoring/auditLogger';
import { 
  NotFoundError, 
  ConflictError, 
  ValidationError,
  BusinessRuleViolationError 
} from '../../utils/errors';

// ============================================================================
// PROJECT-SPECIFIC INTERFACES
// ============================================================================

export interface ProjectSearchFilters {
  category?: Project['category'];
  status?: Project['status'];
  creatorId?: string;
  country?: string;
  city?: string;
  tags?: string[];
  fundingGoalMin?: number;
  fundingGoalMax?: number;
  raisedMin?: number;
  raisedMax?: number;
  fundingProgress?: 'low' | 'medium' | 'high'; // Based on percentage
  endDateAfter?: Date;
  endDateBefore?: Date;
  riskLevel?: Project['riskAssessment']['level'];
  reviewStatus?: Project['moderation']['reviewStatus'];
  featured?: boolean;
  textSearch?: string;
}

export interface ProjectAnalytics {
  totalProjects: number;
  activeProjects: number;
  completedProjects: number;
  totalFunding: number;
  averageFundingGoal: number;
  averageCompletionRate: number;
  topCategories: Array<{ category: string; count: number; totalFunding: number }>;
  topCountries: Array<{ country: string; count: number }>;
  fundingTrends: Array<{ date: Date; amount: number; projectCount: number }>;
}

export interface ProjectRecommendation {
  projectId: string;
  score: number;
  reasons: string[];
  category: string;
  fundingGoal: number;
  currentFunding: number;
  endDate: Date;
}

export interface FundingMilestone {
  percentage: number;
  amount: number;
  date: Date;
  backerCount: number;
}

// ============================================================================
// PROJECT REPOSITORY CLASS
// ============================================================================

export class ProjectRepository extends BaseRepository<Project> {
  constructor() {
    super('projects');
  }

  // ============================================================================
  // PROJECT CREATION AND LIFECYCLE
  // ============================================================================

  async createProject(projectData: {
    title: string;
    shortDescription: string;
    fullDescription: string;
    category: Project['category'];
    tags: string[];
    fundingGoal: number;
    currency: string;
    duration: number;
    startDate: Date;
    location: Project['location'];
    milestones: Array<Omit<Project['milestones'][0], 'id' | 'status' | 'completedAt'>>;
    media: Project['media'];
    creatorId: string;
  }): Promise<Project> {
    const traceId = await performanceMonitor.startTrace('project_create', 'repository', {
      operation: 'createProject',
      category: projectData.category
    });

    try {
      // Generate unique slug
      const slug = await this.generateUniqueSlug(projectData.title);

      // Check if slug already exists
      const existingProject = await this.findBySlug(slug);
      if (existingProject) {
        throw new ConflictError('A project with this title already exists');
      }

      // Calculate end date
      const endDate = new Date(projectData.startDate);
      endDate.setDate(endDate.getDate() + projectData.duration);

      // Validate milestones
      this.validateMilestones(projectData.milestones, projectData.startDate, endDate);

      // Add IDs to milestones
      const milestonesWithIds = projectData.milestones.map(milestone => ({
        ...milestone,
        id: this.generateId(),
        status: 'pending' as const,
        completedAt: undefined
      }));

      // Perform initial risk assessment
      const riskAssessment = await this.assessProjectRisk(projectData);

      const newProject: Omit<Project, 'id' | 'createdAt' | 'updatedAt' | 'version'> = {
        title: projectData.title,
        slug,
        shortDescription: projectData.shortDescription,
        fullDescription: projectData.fullDescription,
        category: projectData.category,
        tags: projectData.tags,

        creatorId: projectData.creatorId,
        creatorProfile: {
          displayName: '', // Will be populated from user data
          verificationLevel: 'basic'
        },

        funding: {
          goal: projectData.fundingGoal,
          currency: projectData.currency,
          raised: 0,
          backerCount: 0,
          averageDonation: 0,
          startDate: projectData.startDate,
          endDate,
          duration: projectData.duration,
          fees: {
            platform: 5, // 5%
            payment: 2.9, // 2.9%
            audit: 3 // 3%
          }
        },

        location: projectData.location,
        media: projectData.media,
        milestones: milestonesWithIds,
        updates: [],
        team: [],

        status: 'draft',
        submittedAt: undefined,
        publishedAt: undefined,
        completedAt: undefined,

        moderation: {
          reviewStatus: 'pending',
          autoApproved: false
        },

        riskAssessment,

        analytics: {
          viewCount: 0,
          shareCount: 0,
          favoriteCount: 0,
          conversionRate: 0,
          averageTimeOnPage: 0,
          topReferrers: [],
          geographicDistribution: {}
        },

        seo: {
          metaTitle: projectData.title,
          metaDescription: projectData.shortDescription.substring(0, 160),
          keywords: projectData.tags
        },

        legal: {
          termsAccepted: true,
          termsVersion: '1.0',
          intellectualProperty: {
            owns: true
          },
          dataProtection: {
            gdprCompliant: true,
            dataRetentionPeriod: 2555 // 7 years in days
          }
        },

        isDeleted: false,
        createdBy: projectData.creatorId,
        updatedBy: projectData.creatorId
      };

      const project = await this.create(newProject);

      // Log project creation
      await auditLogger.logUserAction(
        projectData.creatorId,
        'create',
        'project',
        project.id,
        'success',
        {
          service: 'project-repository',
          category: projectData.category,
          fundingGoal: projectData.fundingGoal,
          riskLevel: riskAssessment.level
        }
      );

      // Record metrics
      await metricsCollector.recordCounter('projects.created', 1, {
        category: projectData.category,
        riskLevel: riskAssessment.level,
        fundingGoal: this.getFundingGoalRange(projectData.fundingGoal)
      });

      await performanceMonitor.endTrace(traceId, 'success', { 
        projectId: project.id,
        slug 
      });

      logger.info('Project created successfully', {
        projectId: project.id,
        creatorId: projectData.creatorId,
        category: projectData.category,
        slug
      });

      return project;

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });

      throw error;
    }
  }

  async submitProject(projectId: string, submittedBy: string): Promise<Project> {
    const traceId = await performanceMonitor.startTrace('project_submit', 'repository', {
      operation: 'submitProject',
      projectId
    });

    try {
      const project = await this.findByIdOrThrow(projectId);

      if (project.status !== 'draft') {
        throw new BusinessRuleViolationError(
          'project_submission',
          'Only draft projects can be submitted for review'
        );
      }

      // Validate project completeness
      this.validateProjectForSubmission(project);

      const updatedProject = await this.update(projectId, {
        status: 'submitted',
        submittedAt: new Date(),
        moderation: {
          ...project.moderation,
          reviewStatus: 'pending'
        },
        updatedBy: submittedBy
      });

      // Log submission
      await auditLogger.logUserAction(
        submittedBy,
        'update',
        'project',
        projectId,
        'success',
        {
          service: 'project-repository',
          action: 'submit_for_review',
          previousStatus: project.status
        }
      );

      // Record metrics
      await metricsCollector.recordCounter('projects.submitted', 1, {
        category: project.category,
        riskLevel: project.riskAssessment.level
      });

      await performanceMonitor.endTrace(traceId, 'success', { projectId });

      return updatedProject;

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });

      throw error;
    }
  }

  async publishProject(projectId: string, publishedBy: string): Promise<Project> {
    const traceId = await performanceMonitor.startTrace('project_publish', 'repository', {
      operation: 'publishProject',
      projectId
    });

    try {
      const project = await this.findByIdOrThrow(projectId);

      if (!['submitted', 'under_review'].includes(project.status)) {
        throw new BusinessRuleViolationError(
          'project_publishing',
          'Only reviewed projects can be published'
        );
      }

      if (project.moderation.reviewStatus !== 'approved') {
        throw new BusinessRuleViolationError(
          'project_publishing',
          'Project must be approved before publishing'
        );
      }

      const updatedProject = await this.update(projectId, {
        status: 'published',
        publishedAt: new Date(),
        updatedBy: publishedBy
      });

      // Log publishing
      await auditLogger.logUserAction(
        publishedBy,
        'update',
        'project',
        projectId,
        'success',
        {
          service: 'project-repository',
          action: 'publish',
          previousStatus: project.status
        }
      );

      // Record metrics
      await metricsCollector.recordCounter('projects.published', 1, {
        category: project.category,
        riskLevel: project.riskAssessment.level
      });

      await performanceMonitor.endTrace(traceId, 'success', { projectId });

      return updatedProject;

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });

      throw error;
    }
  }

  // ============================================================================
  // FUNDING MANAGEMENT
  // ============================================================================

  async updateFunding(
    projectId: string,
    donationAmount: number,
    isNewBacker: boolean = false
  ): Promise<Project> {
    const traceId = await performanceMonitor.startTrace('project_update_funding', 'repository', {
      operation: 'updateFunding',
      projectId,
      amount: donationAmount
    });

    try {
      return await this.runTransaction(async (transaction) => {
        const projectRef = this.getDocumentReference(projectId);
        const projectDoc = await transaction.get(projectRef);

        if (!projectDoc.exists) {
          throw new NotFoundError(`Project with ID '${projectId}' not found`);
        }

        const project = projectDoc.data() as Project;

        const newRaised = project.funding.raised + donationAmount;
        const newBackerCount = project.funding.backerCount + (isNewBacker ? 1 : 0);
        const newAverageDonation = newBackerCount > 0 ? newRaised / newBackerCount : 0;

        const updatedFunding = {
          ...project.funding,
          raised: newRaised,
          backerCount: newBackerCount,
          averageDonation: newAverageDonation
        };

        // Check if funding goal is reached
        let statusUpdate: Partial<Project> = {};
        if (newRaised >= project.funding.goal && project.status === 'published') {
          statusUpdate = {
            status: 'funded'
          };
        }

        const updates = {
          funding: updatedFunding,
          ...statusUpdate,
          updatedAt: new Date(),
          version: FieldValue.increment(1),
          updatedBy: 'system'
        };

        transaction.update(projectRef, updates);

        const updatedProject = { ...project, ...updates };

        // Log funding update
        await auditLogger.logUserAction(
          'system',
          'update',
          'project_funding',
          projectId,
          'success',
          {
            service: 'project-repository',
            donationAmount,
            newTotal: newRaised,
            goalReached: newRaised >= project.funding.goal
          }
        );

        return updatedProject as Project;
      });

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });

      throw error;
    } finally {
      await performanceMonitor.endTrace(traceId, 'success', { projectId });
    }
  }

  async updateMilestone(
    projectId: string,
    milestoneId: string,
    updates: Partial<Project['milestones'][0]>,
    updatedBy: string
  ): Promise<Project> {
    const project = await this.findByIdOrThrow(projectId);

    const milestoneIndex = project.milestones.findIndex(m => m.id === milestoneId);
    if (milestoneIndex === -1) {
      throw new NotFoundError(`Milestone with ID '${milestoneId}' not found`);
    }

    const updatedMilestones = [...project.milestones];
    updatedMilestones[milestoneIndex] = {
      ...updatedMilestones[milestoneIndex],
      ...updates
    };

    const updatedProject = await this.update(projectId, {
      milestones: updatedMilestones,
      updatedBy
    });

    // Log milestone update
    await auditLogger.logUserAction(
      updatedBy,
      'update',
      'project_milestone',
      projectId,
      'success',
      {
        service: 'project-repository',
        milestoneId,
        updates: Object.keys(updates)
      }
    );

    return updatedProject;
  }

  // ============================================================================
  // SEARCH AND DISCOVERY
  // ============================================================================

  async searchProjects(
    filters: ProjectSearchFilters,
    options?: QueryOptions
  ): Promise<PaginationResult<Project>> {
    const traceId = await performanceMonitor.startTrace('project_search', 'repository', {
      operation: 'searchProjects',
      filtersCount: Object.keys(filters).length
    });

    try {
      const whereConditions: QueryOptions['where'] = [];

      // Always exclude deleted projects
      whereConditions.push({ field: 'isDeleted', operator: '==', value: false });

      // Add filter conditions
      if (filters.category) {
        whereConditions.push({ field: 'category', operator: '==', value: filters.category });
      }

      if (filters.status) {
        whereConditions.push({ field: 'status', operator: '==', value: filters.status });
      }

      if (filters.creatorId) {
        whereConditions.push({ field: 'creatorId', operator: '==', value: filters.creatorId });
      }

      if (filters.country) {
        whereConditions.push({ field: 'location.country', operator: '==', value: filters.country });
      }

      if (filters.city) {
        whereConditions.push({ field: 'location.city', operator: '==', value: filters.city });
      }

      if (filters.fundingGoalMin) {
        whereConditions.push({ field: 'funding.goal', operator: '>=', value: filters.fundingGoalMin });
      }

      if (filters.fundingGoalMax) {
        whereConditions.push({ field: 'funding.goal', operator: '<=', value: filters.fundingGoalMax });
      }

      if (filters.raisedMin) {
        whereConditions.push({ field: 'funding.raised', operator: '>=', value: filters.raisedMin });
      }

      if (filters.raisedMax) {
        whereConditions.push({ field: 'funding.raised', operator: '<=', value: filters.raisedMax });
      }

      if (filters.endDateAfter) {
        whereConditions.push({ field: 'funding.endDate', operator: '>=', value: filters.endDateAfter });
      }

      if (filters.endDateBefore) {
        whereConditions.push({ field: 'funding.endDate', operator: '<=', value: filters.endDateBefore });
      }

      if (filters.riskLevel) {
        whereConditions.push({ field: 'riskAssessment.level', operator: '==', value: filters.riskLevel });
      }

      if (filters.reviewStatus) {
        whereConditions.push({ field: 'moderation.reviewStatus', operator: '==', value: filters.reviewStatus });
      }

      // Handle tags (array-contains)
      if (filters.tags && filters.tags.length > 0) {
        // For single tag
        if (filters.tags.length === 1) {
          whereConditions.push({ field: 'tags', operator: 'array-contains', value: filters.tags[0] });
        }
        // For multiple tags, we'll need to filter client-side
      }

      // Default ordering by published date for public searches
      const defaultOrderBy = options?.orderBy || [
        { field: 'publishedAt', direction: 'desc' as const }
      ];

      const queryOptions: QueryOptions = {
        ...options,
        where: whereConditions,
        orderBy: defaultOrderBy
      };

      const result = await this.paginate(queryOptions);

      // Client-side filtering for complex conditions
      if (filters.tags && filters.tags.length > 1) {
        result.data = result.data.filter(project => 
          filters.tags!.every(tag => project.tags.includes(tag))
        );
      }

      if (filters.fundingProgress) {
        result.data = result.data.filter(project => {
          const progress = project.funding.raised / project.funding.goal;
          switch (filters.fundingProgress) {
            case 'low': return progress < 0.33;
            case 'medium': return progress >= 0.33 && progress < 0.66;
            case 'high': return progress >= 0.66;
            default: return true;
          }
        });
      }

      // Text search (simple implementation)
      if (filters.textSearch) {
        const searchTerm = filters.textSearch.toLowerCase();
        result.data = result.data.filter(project =>
          project.title.toLowerCase().includes(searchTerm) ||
          project.shortDescription.toLowerCase().includes(searchTerm) ||
          project.tags.some(tag => tag.toLowerCase().includes(searchTerm))
        );
      }

      // Record search metrics
      await metricsCollector.recordCounter('projects.searches', 1, {
        category: filters.category || 'all',
        hasTextSearch: !!filters.textSearch,
        resultCount: result.data.length.toString()
      });

      await performanceMonitor.endTrace(traceId, 'success', {
        resultCount: result.data.length,
        hasMore: result.hasMore
      });

      return result;

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });

      throw error;
    }
  }

  async getFeaturedProjects(limit: number = 10): Promise<Project[]> {
    return await this.find({
      where: [
        { field: 'status', operator: '==', value: 'published' },
        { field: 'isDeleted', operator: '==', value: false }
      ],
      orderBy: [
        { field: 'analytics.viewCount', direction: 'desc' },
        { field: 'funding.raised', direction: 'desc' }
      ],
      limit
    });
  }

  async getTrendingProjects(limit: number = 10): Promise<Project[]> {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    return await this.find({
      where: [
        { field: 'status', operator: '==', value: 'published' },
        { field: 'publishedAt', operator: '>=', value: oneWeekAgo },
        { field: 'isDeleted', operator: '==', value: false }
      ],
      orderBy: [
        { field: 'analytics.shareCount', direction: 'desc' },
        { field: 'funding.backerCount', direction: 'desc' }
      ],
      limit
    });
  }

  async getProjectsByCreator(creatorId: string, includeDeleted: boolean = false): Promise<Project[]> {
    const whereConditions: QueryOptions['where'] = [
      { field: 'creatorId', operator: '==', value: creatorId }
    ];

    if (!includeDeleted) {
      whereConditions.push({ field: 'isDeleted', operator: '==', value: false });
    }

    return await this.find({
      where: whereConditions,
      orderBy: [{ field: 'createdAt', direction: 'desc' }]
    });
  }

  async findBySlug(slug: string): Promise<Project | null> {
    const projects = await this.find({
      where: [
        { field: 'slug', operator: '==', value: slug },
        { field: 'isDeleted', operator: '==', value: false }
      ],
      limit: 1
    });

    return projects.length > 0 ? projects[0] : null;
  }

  // ============================================================================
  // ANALYTICS AND TRACKING
  // ============================================================================

  async updateAnalytics(projectId: string, updates: Partial<Project['analytics']>): Promise<void> {
    const project = await this.findByIdOrThrow(projectId);

    await this.update(projectId, {
      analytics: {
        ...project.analytics,
        ...updates
      },
      updatedBy: 'system'
    });
  }

  async incrementViewCount(projectId: string): Promise<void> {
    await this.updateAnalytics(projectId, {
      viewCount: FieldValue.increment(1) as any
    });
  }

  async getProjectAnalytics(): Promise<ProjectAnalytics> {
    const traceId = await performanceMonitor.startTrace('project_analytics', 'repository', {
      operation: 'getProjectAnalytics'
    });

    try {
      const totalProjects = await this.count();
      
      const activeProjects = await this.count({
        where: [{ field: 'status', operator: '==', value: 'published' }]
      });

      const completedProjects = await this.count({
        where: [{ field: 'status', operator: '==', value: 'completed' }]
      });

      // This would require aggregation queries in a real implementation
      const analytics: ProjectAnalytics = {
        totalProjects,
        activeProjects,
        completedProjects,
        totalFunding: 0, // Would be calculated from all projects
        averageFundingGoal: 0, // Would be calculated from all projects
        averageCompletionRate: 0, // Would be calculated from funded projects
        topCategories: [], // Would be aggregated from project categories
        topCountries: [], // Would be aggregated from project locations
        fundingTrends: [] // Would be calculated from time-series data
      };

      await performanceMonitor.endTrace(traceId, 'success');

      return analytics;

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });

      throw error;
    }
  }

  // ============================================================================
  // MODERATION AND REVIEW
  // ============================================================================

  async updateModerationStatus(
    projectId: string,
    reviewStatus: Project['moderation']['reviewStatus'],
    reviewNotes?: string,
    reviewedBy?: string
  ): Promise<Project> {
    const project = await this.findByIdOrThrow(projectId);

    const moderationUpdates = {
      ...project.moderation,
      reviewStatus,
      reviewedBy,
      reviewedAt: new Date(),
      ...(reviewNotes && { reviewNotes })
    };

    // Update project status based on review
    let statusUpdate: Partial<Project> = {};
    if (reviewStatus === 'approved') {
      statusUpdate.status = 'under_review'; // Ready for publishing
    } else if (reviewStatus === 'rejected') {
      statusUpdate.status = 'suspended';
    }

    const updatedProject = await this.update(projectId, {
      moderation: moderationUpdates,
      ...statusUpdate,
      updatedBy: reviewedBy || 'system'
    });

    // Log moderation action
    await auditLogger.logUserAction(
      reviewedBy || 'system',
      'moderation',
      'project_review',
      projectId,
      'success',
      {
        service: 'project-repository',
        reviewStatus,
        previousStatus: project.moderation.reviewStatus,
        reviewNotes
      }
    );

    return updatedProject;
  }

  async getProjectsRequiringReview(): Promise<Project[]> {
    return await this.find({
      where: [
        { field: 'moderation.reviewStatus', operator: '==', value: 'pending' },
        { field: 'status', operator: '==', value: 'submitted' }
      ],
      orderBy: [{ field: 'submittedAt', direction: 'asc' }]
    });
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private async generateUniqueSlug(title: string): Promise<string> {
    let baseSlug = title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);

    let slug = baseSlug;
    let counter = 1;

    while (await this.findBySlug(slug)) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    return slug;
  }

  private generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private validateMilestones(
    milestones: Array<Omit<Project['milestones'][0], 'id' | 'status' | 'completedAt'>>,
    startDate: Date,
    endDate: Date
  ): void {
    if (milestones.length === 0) {
      throw new ValidationError('At least one milestone is required');
    }

    let totalPercentage = 0;
    for (const milestone of milestones) {
      if (milestone.targetDate < startDate || milestone.targetDate > endDate) {
        throw new ValidationError(`Milestone target date must be between project start and end dates`);
      }
      totalPercentage += milestone.fundingPercentage;
    }

    if (Math.abs(totalPercentage - 100) > 0.01) {
      throw new ValidationError('Milestone funding percentages must sum to 100%');
    }
  }

  private validateProjectForSubmission(project: Project): void {
    if (!project.title || project.title.length < 10) {
      throw new ValidationError('Project title must be at least 10 characters');
    }

    if (!project.shortDescription || project.shortDescription.length < 50) {
      throw new ValidationError('Project short description must be at least 50 characters');
    }

    if (!project.fullDescription || project.fullDescription.length < 200) {
      throw new ValidationError('Project full description must be at least 200 characters');
    }

    if (!project.media.coverImage?.url) {
      throw new ValidationError('Project must have a cover image');
    }

    if (project.milestones.length === 0) {
      throw new ValidationError('Project must have at least one milestone');
    }

    if (project.funding.goal < 100) {
      throw new ValidationError('Funding goal must be at least $1.00');
    }
  }

  private async assessProjectRisk(projectData: any): Promise<Project['riskAssessment']> {
    let score = 0;
    const factors: Array<{ category: string; description: string; weight: number }> = [];

    // Funding goal risk
    if (projectData.fundingGoal > 100000) {
      score += 20;
      factors.push({
        category: 'funding',
        description: 'High funding goal',
        weight: 20
      });
    }

    // Duration risk
    if (projectData.duration > 90) {
      score += 15;
      factors.push({
        category: 'timeline',
        description: 'Long project duration',
        weight: 15
      });
    }

    // Category risk
    const highRiskCategories = ['technology', 'other'];
    if (highRiskCategories.includes(projectData.category)) {
      score += 10;
      factors.push({
        category: 'category',
        description: 'High-risk category',
        weight: 10
      });
    }

    const level: Project['riskAssessment']['level'] = 
      score >= 40 ? 'critical' :
      score >= 25 ? 'high' :
      score >= 10 ? 'medium' : 'low';

    return {
      level,
      score,
      factors,
      assessedAt: new Date(),
      assessedBy: 'system'
    };
  }

  private getFundingGoalRange(amount: number): string {
    if (amount < 1000) return 'micro';
    if (amount < 10000) return 'small';
    if (amount < 50000) return 'medium';
    if (amount < 100000) return 'large';
    return 'mega';
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const projectRepository = new ProjectRepository();