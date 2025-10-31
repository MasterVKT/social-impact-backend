import { Request, Response } from 'express';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from '../../utils/logger';
import { firestoreHelper } from '../../utils/firestore';
import { accessControlSystem } from '../../security/accessControl';
import { dataEncryptionSystem } from '../../security/dataEncryption';
import { auditLogger } from '../../monitoring/auditLogger';
import { performanceMonitor } from '../../monitoring/performanceMonitor';
import { validateSchema } from '../../utils/validation';
import { generateProjectSlug } from '../../utils/validation';

export interface Project {
  id: string;
  slug: string;
  title: string;
  shortDescription: string;
  fullDescription: string;
  category: 'education' | 'health' | 'environment' | 'poverty' | 'disaster_relief' | 'community' | 'technology' | 'other';
  status: 'draft' | 'pending_review' | 'active' | 'funded' | 'completed' | 'cancelled' | 'suspended';
  
  creator: {
    userId: string;
    displayName: string;
    avatar?: string;
    verified: boolean;
  };
  
  funding: {
    goal: number;
    raised: number;
    currency: string;
    backers: number;
    progress: number; // percentage
    fees: {
      platform: number;
      processing: number;
      total: number;
    };
  };
  
  timeline: {
    createdAt: Date;
    publishedAt?: Date;
    startDate: Date;
    endDate: Date;
    duration: number; // days
    lastUpdated: Date;
  };
  
  location: {
    country: string;
    region?: string;
    city?: string;
    coordinates?: {
      lat: number;
      lng: number;
    };
  };
  
  media: {
    coverImage?: string;
    gallery: string[];
    videos: string[];
    documents: string[];
  };
  
  milestones: ProjectMilestone[];
  updates: ProjectUpdate[];
  tags: string[];
  
  verification: {
    status: 'pending' | 'verified' | 'rejected';
    verifiedAt?: Date;
    verifiedBy?: string;
    notes?: string;
  };
  
  social: {
    views: number;
    likes: number;
    shares: number;
    comments: number;
    followers: number;
  };
  
  compliance: {
    kycRequired: boolean;
    kycCompleted: boolean;
    documentsRequired: string[];
    documentsSubmitted: string[];
    auditRequired: boolean;
    auditCompleted: boolean;
  };
  
  metadata: {
    createdAt: Date;
    updatedAt: Date;
    lastModifiedBy: string;
    version: number;
    flags: string[];
    reviewNotes?: string;
  };
}

export interface ProjectMilestone {
  id: string;
  title: string;
  description: string;
  targetDate: Date;
  completedDate?: Date;
  status: 'pending' | 'in_progress' | 'completed' | 'delayed';
  fundingPercentage: number;
  deliverables: string[];
  evidence?: {
    description: string;
    files: string[];
    submittedAt: Date;
    verifiedAt?: Date;
    verifiedBy?: string;
  };
}

export interface ProjectUpdate {
  id: string;
  title: string;
  content: string;
  type: 'general' | 'milestone' | 'funding' | 'challenge' | 'success';
  visibility: 'public' | 'backers_only' | 'private';
  media: string[];
  reactions: {
    likes: number;
    comments: number;
  };
  createdAt: Date;
  createdBy: string;
}

export interface CreateProjectRequest {
  title: string;
  shortDescription: string;
  fullDescription: string;
  category: Project['category'];
  fundingGoal: number;
  currency: string;
  duration: number; // days
  startDate: Date;
  location: Project['location'];
  milestones: Omit<ProjectMilestone, 'id' | 'status' | 'completedDate' | 'evidence'>[];
  tags: string[];
  media?: {
    coverImage?: string;
    gallery?: string[];
    videos?: string[];
  };
}

export interface UpdateProjectRequest {
  title?: string;
  shortDescription?: string;
  fullDescription?: string;
  category?: Project['category'];
  location?: Project['location'];
  milestones?: Omit<ProjectMilestone, 'id' | 'status' | 'completedDate' | 'evidence'>[];
  tags?: string[];
  media?: Partial<Project['media']>;
}

export interface ProjectSearchFilters {
  category?: string;
  status?: string;
  country?: string;
  minGoal?: number;
  maxGoal?: number;
  fundingProgress?: 'all' | 'new' | 'trending' | 'almost_funded' | 'funded';
  createdAfter?: Date;
  createdBefore?: Date;
  verified?: boolean;
  tags?: string[];
  creator?: string;
  search?: string;
  sortBy?: 'created' | 'funding' | 'popular' | 'ending_soon';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

const projectCreateSchema = {
  type: 'object',
  required: ['title', 'shortDescription', 'fullDescription', 'category', 'fundingGoal', 'currency', 'duration', 'startDate', 'location', 'milestones'],
  properties: {
    title: { type: 'string', minLength: 10, maxLength: 100 },
    shortDescription: { type: 'string', minLength: 50, maxLength: 300 },
    fullDescription: { type: 'string', minLength: 200, maxLength: 5000 },
    category: { 
      type: 'string', 
      enum: ['education', 'health', 'environment', 'poverty', 'disaster_relief', 'community', 'technology', 'other'] 
    },
    fundingGoal: { type: 'number', minimum: 100, maximum: 1000000 },
    currency: { type: 'string', pattern: '^[A-Z]{3}$' },
    duration: { type: 'number', minimum: 7, maximum: 365 },
    startDate: { type: 'string', format: 'date-time' },
    location: {
      type: 'object',
      required: ['country'],
      properties: {
        country: { type: 'string', minLength: 2, maxLength: 100 },
        region: { type: 'string', maxLength: 100 },
        city: { type: 'string', maxLength: 100 },
        coordinates: {
          type: 'object',
          properties: {
            lat: { type: 'number', minimum: -90, maximum: 90 },
            lng: { type: 'number', minimum: -180, maximum: 180 }
          }
        }
      }
    },
    milestones: {
      type: 'array',
      minLength: 1,
      maxLength: 10,
      items: {
        type: 'object',
        required: ['title', 'description', 'targetDate', 'fundingPercentage', 'deliverables'],
        properties: {
          title: { type: 'string', minLength: 5, maxLength: 100 },
          description: { type: 'string', minLength: 20, maxLength: 500 },
          targetDate: { type: 'string', format: 'date-time' },
          fundingPercentage: { type: 'number', minimum: 1, maximum: 100 },
          deliverables: {
            type: 'array',
            minLength: 1,
            maxLength: 10,
            items: { type: 'string', minLength: 5, maxLength: 200 }
          }
        }
      }
    },
    tags: {
      type: 'array',
      maxLength: 10,
      items: { type: 'string', minLength: 2, maxLength: 30 }
    }
  }
};

const projectUpdateSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', minLength: 10, maxLength: 100 },
    shortDescription: { type: 'string', minLength: 50, maxLength: 300 },
    fullDescription: { type: 'string', minLength: 200, maxLength: 5000 },
    category: { 
      type: 'string', 
      enum: ['education', 'health', 'environment', 'poverty', 'disaster_relief', 'community', 'technology', 'other'] 
    },
    location: {
      type: 'object',
      properties: {
        country: { type: 'string', minLength: 2, maxLength: 100 },
        region: { type: 'string', maxLength: 100 },
        city: { type: 'string', maxLength: 100 },
        coordinates: {
          type: 'object',
          properties: {
            lat: { type: 'number', minimum: -90, maximum: 90 },
            lng: { type: 'number', minimum: -180, maximum: 180 }
          }
        }
      }
    },
    tags: {
      type: 'array',
      maxLength: 10,
      items: { type: 'string', minLength: 2, maxLength: 30 }
    }
  }
};

export class ProjectController {
  private db = getFirestore();

  async createProject(req: Request, res: Response): Promise<void> {
    const traceId = await performanceMonitor.startTrace('project_create', 'endpoint', {
      endpoint: '/api/projects',
      method: 'POST',
      userId: req.user?.uid,
      ip: req.ip
    });

    try {
      const userId = req.user?.uid;
      if (!userId) {
        res.status(401).json({ error: 'Authentication required' });
        await performanceMonitor.finishTrace(traceId, 'error', 'Not authenticated');
        return;
      }

      // Validate request
      const validation = validateSchema(req.body, projectCreateSchema);
      if (!validation.valid) {
        res.status(400).json({
          error: 'Invalid request data',
          details: validation.errors
        });
        await performanceMonitor.finishTrace(traceId, 'error', 'Validation failed');
        return;
      }

      const projectData: CreateProjectRequest = req.body;

      // Check if user can create projects
      const canCreate = await this.checkCreatePermissions(userId);
      if (!canCreate) {
        res.status(403).json({ error: 'Insufficient permissions to create projects' });
        await performanceMonitor.finishTrace(traceId, 'error', 'Access denied');
        return;
      }

      // Get user info for creator details
      const userDoc = await firestoreHelper.getDocumentOptional('users', userId);
      if (!userDoc) {
        res.status(404).json({ error: 'User profile not found' });
        await performanceMonitor.finishTrace(traceId, 'error', 'User not found');
        return;
      }

      // Generate unique slug
      const slug = await this.generateUniqueSlug(projectData.title);

      // Calculate end date
      const startDate = new Date(projectData.startDate);
      const endDate = new Date(startDate.getTime() + (projectData.duration * 24 * 60 * 60 * 1000));

      // Calculate platform fees
      const platformFee = Math.round(projectData.fundingGoal * 0.05); // 5%
      const processingFee = Math.round(projectData.fundingGoal * 0.029 + 30); // ~2.9% + 30 cents

      // Create project document
      const project: Project = {
        id: this.db.collection('projects').doc().id,
        slug,
        title: projectData.title,
        shortDescription: projectData.shortDescription,
        fullDescription: projectData.fullDescription,
        category: projectData.category,
        status: 'draft',
        
        creator: {
          userId: userId,
          displayName: userDoc.profile?.displayName || userDoc.profile?.firstName + ' ' + userDoc.profile?.lastName,
          avatar: userDoc.profile?.avatar,
          verified: userDoc.verification?.identity || false
        },
        
        funding: {
          goal: projectData.fundingGoal,
          raised: 0,
          currency: projectData.currency,
          backers: 0,
          progress: 0,
          fees: {
            platform: platformFee,
            processing: processingFee,
            total: platformFee + processingFee
          }
        },
        
        timeline: {
          createdAt: new Date(),
          startDate,
          endDate,
          duration: projectData.duration,
          lastUpdated: new Date()
        },
        
        location: projectData.location,
        
        media: {
          coverImage: projectData.media?.coverImage,
          gallery: projectData.media?.gallery || [],
          videos: projectData.media?.videos || [],
          documents: []
        },
        
        milestones: projectData.milestones.map((milestone, index) => ({
          id: `milestone_${index + 1}`,
          ...milestone,
          targetDate: new Date(milestone.targetDate),
          status: 'pending'
        })),
        
        updates: [],
        tags: projectData.tags || [],
        
        verification: {
          status: 'pending'
        },
        
        social: {
          views: 0,
          likes: 0,
          shares: 0,
          comments: 0,
          followers: 0
        },
        
        compliance: {
          kycRequired: projectData.fundingGoal > 10000, // Require KYC for large projects
          kycCompleted: false,
          documentsRequired: this.getRequiredDocuments(projectData.category, projectData.fundingGoal),
          documentsSubmitted: [],
          auditRequired: projectData.fundingGoal > 50000, // Require audit for very large projects
          auditCompleted: false
        },
        
        metadata: {
          createdAt: new Date(),
          updatedAt: new Date(),
          lastModifiedBy: userId,
          version: 1,
          flags: []
        }
      };

      // Encrypt sensitive data
      const encryptedProject = await this.encryptProjectData(project);

      // Store project
      await firestoreHelper.setDocument('projects', project.id, encryptedProject);

      // Update user's project count
      await this.updateUserProjectCount(userId, 'increment');

      // Log project creation
      await auditLogger.logUserAction(
        userId,
        'create',
        'project',
        project.id,
        'success',
        { service: 'project-api', endpoint: '/api/projects' }
      );

      // Return sanitized project
      const publicProject = this.sanitizeProjectForResponse(project);
      res.status(201).json({
        message: 'Project created successfully',
        project: publicProject
      });

      await performanceMonitor.finishTrace(traceId, 'success');

      logger.info('Project created successfully', {
        projectId: project.id,
        userId,
        title: project.title,
        category: project.category,
        fundingGoal: project.funding.goal
      });

    } catch (error) {
      await performanceMonitor.finishTrace(traceId, 'error', (error as Error).message);
      
      logger.error('Failed to create project', error as Error, {
        userId: req.user?.uid,
        title: req.body.title
      });

      res.status(500).json({
        error: 'Failed to create project',
        message: 'An internal error occurred'
      });
    }
  }

  async getProjectById(req: Request, res: Response): Promise<void> {
    const traceId = await performanceMonitor.startTrace('project_get_by_id', 'endpoint', {
      endpoint: `/api/projects/${req.params.id}`,
      method: 'GET',
      userId: req.user?.uid,
      ip: req.ip
    });

    try {
      const projectId = req.params.id;
      const userId = req.user?.uid;

      // Get project from database
      const encryptedProject = await firestoreHelper.getDocumentOptional('projects', projectId) as Project;
      if (!encryptedProject) {
        res.status(404).json({ error: 'Project not found' });
        await performanceMonitor.finishTrace(traceId, 'error', 'Project not found');
        return;
      }

      // Decrypt project data
      const project = await this.decryptProjectData(encryptedProject);

      // Check if user can view this project
      const canView = await this.checkViewPermissions(project, userId);
      if (!canView) {
        res.status(403).json({ error: 'Access denied' });
        await performanceMonitor.finishTrace(traceId, 'error', 'Access denied');
        return;
      }

      // Increment view count (only for non-owners)
      if (project.creator.userId !== userId) {
        project.social.views += 1;
        const encryptedUpdatedProject = await this.encryptProjectData(project);
        await firestoreHelper.updateDocument('projects', projectId, {
          'social.views': project.social.views
        });
      }

      // Log project access
      await auditLogger.logUserAction(
        userId || 'anonymous',
        'read',
        'project',
        projectId,
        'success',
        { service: 'project-api', endpoint: `/api/projects/${projectId}` }
      );

      // Return project with appropriate visibility
      const publicProject = this.applyVisibilitySettings(project, userId);
      res.json({ project: publicProject });

      await performanceMonitor.finishTrace(traceId, 'success');

    } catch (error) {
      await performanceMonitor.finishTrace(traceId, 'error', (error as Error).message);
      
      logger.error('Failed to get project', error as Error, {
        projectId: req.params.id,
        userId: req.user?.uid
      });

      res.status(500).json({
        error: 'Failed to retrieve project',
        message: 'An internal error occurred'
      });
    }
  }

  async updateProject(req: Request, res: Response): Promise<void> {
    const traceId = await performanceMonitor.startTrace('project_update', 'endpoint', {
      endpoint: `/api/projects/${req.params.id}`,
      method: 'PUT',
      userId: req.user?.uid,
      ip: req.ip
    });

    try {
      const projectId = req.params.id;
      const userId = req.user?.uid;

      if (!userId) {
        res.status(401).json({ error: 'Authentication required' });
        await performanceMonitor.finishTrace(traceId, 'error', 'Not authenticated');
        return;
      }

      // Validate request
      const validation = validateSchema(req.body, projectUpdateSchema);
      if (!validation.valid) {
        res.status(400).json({
          error: 'Invalid request data',
          details: validation.errors
        });
        await performanceMonitor.finishTrace(traceId, 'error', 'Validation failed');
        return;
      }

      // Get current project
      const encryptedProject = await firestoreHelper.getDocumentOptional('projects', projectId) as Project;
      if (!encryptedProject) {
        res.status(404).json({ error: 'Project not found' });
        await performanceMonitor.finishTrace(traceId, 'error', 'Project not found');
        return;
      }

      const project = await this.decryptProjectData(encryptedProject);

      // Check permissions
      const canUpdate = await this.checkUpdatePermissions(project, userId);
      if (!canUpdate) {
        res.status(403).json({ error: 'Access denied' });
        await performanceMonitor.finishTrace(traceId, 'error', 'Access denied');
        return;
      }

      // Check if project can be updated (not funded or completed)
      if (!this.canModifyProject(project)) {
        res.status(400).json({ 
          error: 'Project cannot be modified',
          message: 'Projects that are funded or completed cannot be modified'
        });
        await performanceMonitor.finishTrace(traceId, 'error', 'Project cannot be modified');
        return;
      }

      const updateData: UpdateProjectRequest = req.body;

      // Store changes for audit
      const changes = {
        before: { ...project },
        after: { ...project }
      };

      // Apply updates
      if (updateData.title) {
        project.title = updateData.title;
        // Regenerate slug if title changed
        project.slug = await this.generateUniqueSlug(updateData.title, projectId);
        changes.after.title = project.title;
        changes.after.slug = project.slug;
      }

      if (updateData.shortDescription) {
        project.shortDescription = updateData.shortDescription;
        changes.after.shortDescription = project.shortDescription;
      }

      if (updateData.fullDescription) {
        project.fullDescription = updateData.fullDescription;
        changes.after.fullDescription = project.fullDescription;
      }

      if (updateData.category) {
        project.category = updateData.category;
        changes.after.category = project.category;
      }

      if (updateData.location) {
        project.location = { ...project.location, ...updateData.location };
        changes.after.location = project.location;
      }

      if (updateData.tags) {
        project.tags = updateData.tags;
        changes.after.tags = project.tags;
      }

      if (updateData.media) {
        project.media = { ...project.media, ...updateData.media };
        changes.after.media = project.media;
      }

      if (updateData.milestones) {
        project.milestones = updateData.milestones.map((milestone, index) => ({
          id: project.milestones[index]?.id || `milestone_${index + 1}`,
          ...milestone,
          targetDate: new Date(milestone.targetDate),
          status: project.milestones[index]?.status || 'pending',
          completedDate: project.milestones[index]?.completedDate,
          evidence: project.milestones[index]?.evidence
        }));
        changes.after.milestones = project.milestones;
      }

      // Update metadata
      project.metadata.updatedAt = new Date();
      project.metadata.lastModifiedBy = userId;
      project.metadata.version += 1;
      project.timeline.lastUpdated = new Date();

      // If substantial changes, require re-verification
      if (updateData.title || updateData.fullDescription || updateData.category) {
        project.verification.status = 'pending';
      }

      // Encrypt and store
      const encryptedUpdatedProject = await this.encryptProjectData(project);
      await firestoreHelper.setDocument('projects', projectId, encryptedUpdatedProject);

      // Log update
      await auditLogger.logUserAction(
        userId,
        'update',
        'project',
        projectId,
        'success',
        { service: 'project-api', endpoint: `/api/projects/${projectId}` },
        { before: changes.before, after: changes.after, fields: Object.keys(updateData) }
      );

      // Return updated project
      const publicProject = this.sanitizeProjectForResponse(project);
      res.json({
        message: 'Project updated successfully',
        project: publicProject
      });

      await performanceMonitor.finishTrace(traceId, 'success');

      logger.info('Project updated successfully', {
        projectId,
        userId,
        fields: Object.keys(updateData)
      });

    } catch (error) {
      await performanceMonitor.finishTrace(traceId, 'error', (error as Error).message);
      
      logger.error('Failed to update project', error as Error, {
        projectId: req.params.id,
        userId: req.user?.uid
      });

      res.status(500).json({
        error: 'Failed to update project',
        message: 'An internal error occurred'
      });
    }
  }

  async searchProjects(req: Request, res: Response): Promise<void> {
    const traceId = await performanceMonitor.startTrace('project_search', 'endpoint', {
      endpoint: '/api/projects/search',
      method: 'GET',
      userId: req.user?.uid,
      ip: req.ip
    });

    try {
      const filters: ProjectSearchFilters = {
        category: req.query.category as string,
        status: req.query.status as string,
        country: req.query.country as string,
        minGoal: req.query.minGoal ? parseInt(req.query.minGoal as string) : undefined,
        maxGoal: req.query.maxGoal ? parseInt(req.query.maxGoal as string) : undefined,
        fundingProgress: req.query.fundingProgress as ProjectSearchFilters['fundingProgress'],
        createdAfter: req.query.createdAfter ? new Date(req.query.createdAfter as string) : undefined,
        createdBefore: req.query.createdBefore ? new Date(req.query.createdBefore as string) : undefined,
        verified: req.query.verified === 'true',
        tags: req.query.tags ? (req.query.tags as string).split(',') : undefined,
        creator: req.query.creator as string,
        search: req.query.search as string,
        sortBy: (req.query.sortBy as ProjectSearchFilters['sortBy']) || 'created',
        sortOrder: (req.query.sortOrder as ProjectSearchFilters['sortOrder']) || 'desc',
        limit: Math.min(parseInt(req.query.limit as string) || 20, 100),
        offset: parseInt(req.query.offset as string) || 0
      };

      // Build base query
      let query = this.db.collection('projects') as any;

      // Apply filters
      if (filters.category) {
        query = query.where('category', '==', filters.category);
      }

      if (filters.status) {
        query = query.where('status', '==', filters.status);
      } else {
        // Default to active projects only
        query = query.where('status', 'in', ['active', 'funded']);
      }

      if (filters.country) {
        query = query.where('location.country', '==', filters.country);
      }

      if (filters.creator) {
        query = query.where('creator.userId', '==', filters.creator);
      }

      if (filters.verified !== undefined) {
        query = query.where('verification.status', '==', filters.verified ? 'verified' : 'pending');
      }

      if (filters.createdAfter) {
        query = query.where('timeline.createdAt', '>=', filters.createdAfter);
      }

      if (filters.createdBefore) {
        query = query.where('timeline.createdAt', '<=', filters.createdBefore);
      }

      // Apply sorting
      let orderField = 'timeline.createdAt';
      switch (filters.sortBy) {
        case 'funding':
          orderField = 'funding.raised';
          break;
        case 'popular':
          orderField = 'social.views';
          break;
        case 'ending_soon':
          orderField = 'timeline.endDate';
          break;
      }

      query = query.orderBy(orderField, filters.sortOrder);

      // Apply pagination
      query = query.limit(filters.limit).offset(filters.offset);

      // Execute query
      const snapshot = await query.get();
      let projects = await Promise.all(
        snapshot.docs.map(async (doc: any) => {
          const encryptedProject = doc.data() as Project;
          const project = await this.decryptProjectData(encryptedProject);
          return this.applyVisibilitySettings(project, req.user?.uid);
        })
      );

      // Apply additional filters that require post-processing
      if (filters.minGoal) {
        projects = projects.filter(p => p.funding.goal >= filters.minGoal!);
      }

      if (filters.maxGoal) {
        projects = projects.filter(p => p.funding.goal <= filters.maxGoal!);
      }

      if (filters.fundingProgress && filters.fundingProgress !== 'all') {
        projects = projects.filter(p => {
          switch (filters.fundingProgress) {
            case 'new':
              return p.funding.progress < 25;
            case 'trending':
              return p.funding.progress >= 25 && p.funding.progress < 75;
            case 'almost_funded':
              return p.funding.progress >= 75 && p.funding.progress < 100;
            case 'funded':
              return p.funding.progress >= 100;
            default:
              return true;
          }
        });
      }

      if (filters.tags && filters.tags.length > 0) {
        projects = projects.filter(p => 
          filters.tags!.some(tag => p.tags.includes(tag))
        );
      }

      if (filters.search) {
        const searchTerm = filters.search.toLowerCase();
        projects = projects.filter(p =>
          p.title.toLowerCase().includes(searchTerm) ||
          p.shortDescription.toLowerCase().includes(searchTerm) ||
          p.tags.some(tag => tag.toLowerCase().includes(searchTerm))
        );
      }

      // Get total count for pagination
      const countQuery = this.db.collection('projects')
        .where('status', 'in', ['active', 'funded']);
      const totalCount = (await countQuery.count().get()).data().count;

      // Log search
      await auditLogger.logUserAction(
        req.user?.uid || 'anonymous',
        'read',
        'project',
        'search',
        'success',
        { service: 'project-api', endpoint: '/api/projects/search' }
      );

      res.json({
        projects,
        pagination: {
          total: totalCount,
          limit: filters.limit,
          offset: filters.offset,
          hasMore: (filters.offset + filters.limit) < totalCount
        },
        filters: {
          applied: Object.keys(filters).filter(key => filters[key as keyof ProjectSearchFilters] !== undefined),
          available: {
            categories: ['education', 'health', 'environment', 'poverty', 'disaster_relief', 'community', 'technology', 'other'],
            statuses: ['active', 'funded', 'completed'],
            sortOptions: ['created', 'funding', 'popular', 'ending_soon']
          }
        }
      });

      await performanceMonitor.finishTrace(traceId, 'success');

    } catch (error) {
      await performanceMonitor.finishTrace(traceId, 'error', (error as Error).message);
      
      logger.error('Failed to search projects', error as Error, {
        userId: req.user?.uid,
        filters: req.query
      });

      res.status(500).json({
        error: 'Failed to search projects',
        message: 'An internal error occurred'
      });
    }
  }

  async publishProject(req: Request, res: Response): Promise<void> {
    const traceId = await performanceMonitor.startTrace('project_publish', 'endpoint', {
      endpoint: `/api/projects/${req.params.id}/publish`,
      method: 'POST',
      userId: req.user?.uid,
      ip: req.ip
    });

    try {
      const projectId = req.params.id;
      const userId = req.user?.uid;

      if (!userId) {
        res.status(401).json({ error: 'Authentication required' });
        await performanceMonitor.finishTrace(traceId, 'error', 'Not authenticated');
        return;
      }

      // Get project
      const encryptedProject = await firestoreHelper.getDocumentOptional('projects', projectId) as Project;
      if (!encryptedProject) {
        res.status(404).json({ error: 'Project not found' });
        await performanceMonitor.finishTrace(traceId, 'error', 'Project not found');
        return;
      }

      const project = await this.decryptProjectData(encryptedProject);

      // Check permissions
      if (project.creator.userId !== userId) {
        res.status(403).json({ error: 'Only project creator can publish' });
        await performanceMonitor.finishTrace(traceId, 'error', 'Access denied');
        return;
      }

      // Check if project can be published
      if (project.status !== 'draft' && project.status !== 'pending_review') {
        res.status(400).json({ 
          error: 'Project cannot be published',
          message: 'Only draft projects can be published'
        });
        await performanceMonitor.finishTrace(traceId, 'error', 'Invalid status');
        return;
      }

      // Validate project completeness
      const validationErrors = await this.validateProjectForPublishing(project);
      if (validationErrors.length > 0) {
        res.status(400).json({
          error: 'Project is incomplete',
          message: 'Please complete all required fields before publishing',
          details: validationErrors
        });
        await performanceMonitor.finishTrace(traceId, 'error', 'Validation failed');
        return;
      }

      // Update project status
      project.status = 'pending_review';
      project.timeline.lastUpdated = new Date();
      project.metadata.updatedAt = new Date();
      project.metadata.lastModifiedBy = userId;
      project.metadata.version += 1;

      // Encrypt and store
      const encryptedUpdatedProject = await this.encryptProjectData(project);
      await firestoreHelper.setDocument('projects', projectId, encryptedUpdatedProject);

      // Log publish action
      await auditLogger.logUserAction(
        userId,
        'update',
        'project',
        projectId,
        'success',
        { service: 'project-api', endpoint: `/api/projects/${projectId}/publish` },
        { before: { status: 'draft' }, after: { status: 'pending_review' }, fields: ['status'] }
      );

      res.json({
        message: 'Project submitted for review',
        project: this.sanitizeProjectForResponse(project)
      });

      await performanceMonitor.finishTrace(traceId, 'success');

      logger.info('Project published for review', {
        projectId,
        userId,
        title: project.title
      });

    } catch (error) {
      await performanceMonitor.finishTrace(traceId, 'error', (error as Error).message);
      
      logger.error('Failed to publish project', error as Error, {
        projectId: req.params.id,
        userId: req.user?.uid
      });

      res.status(500).json({
        error: 'Failed to publish project',
        message: 'An internal error occurred'
      });
    }
  }

  // Helper methods
  private async generateUniqueSlug(title: string, excludeId?: string): Promise<string> {
    let baseSlug = generateProjectSlug(title);
    let slug = baseSlug;
    let counter = 1;

    while (true) {
      const existing = await this.db.collection('projects')
        .where('slug', '==', slug)
        .get();

      const hasConflict = existing.docs.some(doc => doc.id !== excludeId);
      
      if (!hasConflict) {
        break;
      }

      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    return slug;
  }

  private async encryptProjectData(project: Project): Promise<Project> {
    const sensitiveFields = ['creator.displayName', 'fullDescription'];
    return await dataEncryptionSystem.encryptPII(project, sensitiveFields.map(field => ({
      field,
      type: 'text'
    })));
  }

  private async decryptProjectData(encryptedProject: Project): Promise<Project> {
    const sensitiveFields = ['creator.displayName', 'fullDescription'];
    return await dataEncryptionSystem.decryptPII(encryptedProject, sensitiveFields.map(field => ({
      field,
      type: 'text'
    })));
  }

  private sanitizeProjectForResponse(project: Project): Partial<Project> {
    const { metadata, ...publicProject } = project;
    return {
      ...publicProject,
      metadata: {
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
        version: metadata.version
      }
    };
  }

  private applyVisibilitySettings(project: Project, userId?: string): Partial<Project> {
    const isOwner = project.creator.userId === userId;
    const isPublic = project.status === 'active' || project.status === 'funded' || project.status === 'completed';

    if (isOwner) {
      return this.sanitizeProjectForResponse(project);
    }

    if (!isPublic) {
      // Non-public projects only show basic info
      return {
        id: project.id,
        title: project.title,
        status: project.status,
        creator: {
          displayName: project.creator.displayName,
          verified: project.creator.verified
        }
      };
    }

    return this.sanitizeProjectForResponse(project);
  }

  private async checkCreatePermissions(userId: string): Promise<boolean> {
    try {
      const userRole = await accessControlSystem.getRoleDetails(userId);
      const allowedRoles = ['creator', 'admin', 'moderator'];
      return userRole?.roles.some(role => allowedRoles.includes(role)) || false;
    } catch (error) {
      logger.error('Failed to check create permissions', error as Error, { userId });
      return false;
    }
  }

  private async checkViewPermissions(project: Project, userId?: string): Promise<boolean> {
    // Public projects can be viewed by anyone
    if (project.status === 'active' || project.status === 'funded' || project.status === 'completed') {
      return true;
    }

    // Owner can always view their projects
    if (project.creator.userId === userId) {
      return true;
    }

    // Admins and moderators can view any project
    if (userId) {
      try {
        const userRole = await accessControlSystem.getRoleDetails(userId);
        return userRole?.roles.some(role => ['admin', 'moderator'].includes(role)) || false;
      } catch (error) {
        return false;
      }
    }

    return false;
  }

  private async checkUpdatePermissions(project: Project, userId: string): Promise<boolean> {
    // Owner can update their projects
    if (project.creator.userId === userId) {
      return true;
    }

    // Admins can update any project
    try {
      const userRole = await accessControlSystem.getRoleDetails(userId);
      return userRole?.roles.includes('admin') || false;
    } catch (error) {
      return false;
    }
  }

  private canModifyProject(project: Project): boolean {
    const modifiableStatuses = ['draft', 'pending_review', 'active'];
    return modifiableStatuses.includes(project.status);
  }

  private getRequiredDocuments(category: string, fundingGoal: number): string[] {
    const documents = ['identity_verification'];

    if (fundingGoal > 10000) {
      documents.push('business_plan', 'financial_statements');
    }

    if (category === 'health' || category === 'education') {
      documents.push('regulatory_compliance');
    }

    if (fundingGoal > 50000) {
      documents.push('audit_report', 'legal_opinion');
    }

    return documents;
  }

  private async updateUserProjectCount(userId: string, operation: 'increment' | 'decrement'): Promise<void> {
    try {
      const increment = operation === 'increment' ? 1 : -1;
      await firestoreHelper.updateDocument('users', userId, {
        'activity.totalProjectsCreated': operation === 'increment' 
          ? this.db.FieldValue.increment(increment)
          : this.db.FieldValue.increment(increment)
      });
    } catch (error) {
      logger.error('Failed to update user project count', error as Error, { userId, operation });
    }
  }

  private async validateProjectForPublishing(project: Project): Promise<string[]> {
    const errors: string[] = [];

    if (!project.title || project.title.length < 10) {
      errors.push('Title must be at least 10 characters long');
    }

    if (!project.shortDescription || project.shortDescription.length < 50) {
      errors.push('Short description must be at least 50 characters long');
    }

    if (!project.fullDescription || project.fullDescription.length < 200) {
      errors.push('Full description must be at least 200 characters long');
    }

    if (!project.milestones || project.milestones.length === 0) {
      errors.push('At least one milestone is required');
    }

    if (!project.media.coverImage) {
      errors.push('Cover image is required');
    }

    if (project.compliance.kycRequired && !project.compliance.kycCompleted) {
      errors.push('KYC verification is required for this project');
    }

    if (project.compliance.documentsRequired.length > project.compliance.documentsSubmitted.length) {
      errors.push('All required documents must be submitted');
    }

    return errors;
  }
}

export const projectController = new ProjectController();