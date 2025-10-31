/**
 * Tests for Publish Project Firebase Function
 * Social Finance Impact Platform
 */

import { CallableContext } from 'firebase-functions/v1/https';
import { publishProject } from '../publishProject';
import { firestoreHelper } from '../../utils/firestore';
import { ProjectsAPI } from '../../types/api';
import { ProjectDocument, UserDocument } from '../../types/firestore';
import { STATUS, PROJECT_CONFIG } from '../../utils/constants';

// Mocks
jest.mock('../../utils/firestore');
jest.mock('../../utils/auth');
jest.mock('../../integrations/sendgrid/emailService');
jest.mock('../../utils/logger');

const mockFirestoreHelper = jest.mocked(firestoreHelper);

describe('publishProject Function', () => {
  let mockContext: CallableContext;
  let mockProject: ProjectDocument;
  let mockUser: UserDocument;
  let validPublishData: ProjectsAPI.PublishProjectRequest;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockContext = {
      auth: { uid: 'creator-uid', token: {} },
      rawRequest: { ip: '192.168.1.1', headers: { 'user-agent': 'test-agent' } }
    } as any;

    mockProject = {
      uid: 'test-project-id',
      creatorUid: 'creator-uid',
      status: STATUS.PROJECT.DRAFT,
      title: 'Test Project',
      slug: 'test-project',
      version: 1,
      complianceChecks: {
        contentModeration: STATUS.MODERATION.APPROVED,
        legalReview: STATUS.MODERATION.APPROVED,
        financialReview: STATUS.MODERATION.APPROVED
      },
      auditRequired: false,
      funding: {
        goal: 1000000,
        deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      },
      milestones: [{ id: 'milestone-1', fundingPercentage: 100 }],
      team: [{ id: 'team-1', name: 'Leader' }],
      media: { coverImage: 'https://example.com/cover.jpg' },
      impactGoals: { metrics: [{ id: 'metric-1', name: 'Impact', target: 100 }] }
    } as ProjectDocument;

    mockUser = {
      uid: 'creator-uid',
      kyc: { level: 1 }
    } as UserDocument;

    validPublishData = {
      projectId: 'test-project-id',
      confirmTerms: true,
      marketingConsent: false
    };

    mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
      if (collection === 'users') return Promise.resolve(mockUser);
      if (collection === 'projects') return Promise.resolve(mockProject);
      throw new Error('Unexpected collection');
    });

    mockFirestoreHelper.countDocuments.mockResolvedValue(0);
    mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ ...mockProject, version: 1 })
        }),
        update: jest.fn(),
        set: jest.fn(),
        delete: jest.fn()
      };
      await callback(mockTransaction as any);
    });
    mockFirestoreHelper.addDocument.mockResolvedValue();
    mockFirestoreHelper.incrementDocument.mockResolvedValue();
  });

  describe('Authentication', () => {
    it('should reject unauthenticated requests', async () => {
      const unauthenticatedContext = { ...mockContext, auth: null };

      await expect(
        publishProject(validPublishData, unauthenticatedContext)
      ).rejects.toThrow('Authentication required');
    });
  });

  describe('Permission Validation', () => {
    it('should allow project creator to publish', async () => {
      const result = await publishProject(validPublishData, mockContext);
      expect(result.success).toBe(true);
    });

    it('should reject non-creators', async () => {
      const nonCreatorProject = { ...mockProject, creatorUid: 'other-uid' };
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockUser);
        if (collection === 'projects') return Promise.resolve(nonCreatorProject);
        throw new Error('Unexpected collection');
      });

      await expect(
        publishProject(validPublishData, mockContext)
      ).rejects.toThrow('Only the project creator can publish this project');
    });
  });

  describe('Status Validation', () => {
    it('should allow publishing from DRAFT status', async () => {
      const result = await publishProject(validPublishData, mockContext);
      expect(result.status).toBe(STATUS.PROJECT.ACTIVE);
    });

    it('should allow publishing from UNDER_REVIEW status', async () => {
      const reviewProject = { ...mockProject, status: STATUS.PROJECT.UNDER_REVIEW };
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockUser);
        if (collection === 'projects') return Promise.resolve(reviewProject);
        throw new Error('Unexpected collection');
      });

      const result = await publishProject(validPublishData, mockContext);
      expect(result.success).toBe(true);
    });

    it('should reject publishing from invalid statuses', async () => {
      const activeProject = { ...mockProject, status: STATUS.PROJECT.ACTIVE };
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockUser);
        if (collection === 'projects') return Promise.resolve(activeProject);
        throw new Error('Unexpected collection');
      });

      await expect(
        publishProject(validPublishData, mockContext)
      ).rejects.toThrow('Project cannot be published from status');
    });
  });

  describe('Compliance Validation', () => {
    it('should require all compliance checks to be approved', async () => {
      const pendingComplianceProject = {
        ...mockProject,
        complianceChecks: {
          contentModeration: STATUS.MODERATION.PENDING,
          legalReview: STATUS.MODERATION.APPROVED,
          financialReview: STATUS.MODERATION.APPROVED
        }
      };
      
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockUser);
        if (collection === 'projects') return Promise.resolve(pendingComplianceProject);
        throw new Error('Unexpected collection');
      });

      await expect(
        publishProject(validPublishData, mockContext)
      ).rejects.toThrow('All compliance checks must be approved before publication');
    });

    it('should require completed audit for auditable projects', async () => {
      const auditRequiredProject = {
        ...mockProject,
        auditRequired: true,
        auditStatus: STATUS.AUDIT.IN_PROGRESS
      };
      
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockUser);
        if (collection === 'projects') return Promise.resolve(auditRequiredProject);
        throw new Error('Unexpected collection');
      });

      await expect(
        publishProject(validPublishData, mockContext)
      ).rejects.toThrow('Audit must be completed before publication');
    });
  });

  describe('Deadline Validation', () => {
    it('should reject projects with past deadlines', async () => {
      const pastDeadlineProject = {
        ...mockProject,
        funding: {
          ...mockProject.funding,
          deadline: new Date(Date.now() - 24 * 60 * 60 * 1000) // Yesterday
        }
      };
      
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockUser);
        if (collection === 'projects') return Promise.resolve(pastDeadlineProject);
        throw new Error('Unexpected collection');
      });

      await expect(
        publishProject(validPublishData, mockContext)
      ).rejects.toThrow('Funding deadline has passed');
    });

    it('should require minimum funding duration', async () => {
      const shortDurationProject = {
        ...mockProject,
        funding: {
          ...mockProject.funding,
          deadline: new Date(Date.now() + (PROJECT_CONFIG.MIN_FUNDING_DURATION_DAYS - 1) * 24 * 60 * 60 * 1000)
        }
      };
      
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockUser);
        if (collection === 'projects') return Promise.resolve(shortDurationProject);
        throw new Error('Unexpected collection');
      });

      await expect(
        publishProject(validPublishData, mockContext)
      ).rejects.toThrow('Funding period must be at least');
    });
  });

  describe('Project Limits', () => {
    it('should enforce active project limits', async () => {
      mockFirestoreHelper.countDocuments.mockResolvedValue(PROJECT_CONFIG.MAX_ACTIVE_PROJECTS_BASIC);

      await expect(
        publishProject(validPublishData, mockContext)
      ).rejects.toThrow('Maximum number of active projects reached');
    });

    it('should allow higher limits for enhanced KYC users', async () => {
      const enhancedUser = {
        ...mockUser,
        kyc: { level: PROJECT_CONFIG.ENHANCED_KYC_LEVEL }
      };
      
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(enhancedUser);
        if (collection === 'projects') return Promise.resolve(mockProject);
        throw new Error('Unexpected collection');
      });

      mockFirestoreHelper.countDocuments.mockResolvedValue(PROJECT_CONFIG.MAX_ACTIVE_PROJECTS_BASIC);

      const result = await publishProject(validPublishData, mockContext);
      expect(result.success).toBe(true);
    });
  });

  describe('Project Structure Validation', () => {
    it('should validate milestone percentage total', async () => {
      const invalidMilestonesProject = {
        ...mockProject,
        milestones: [
          { id: 'milestone-1', fundingPercentage: 60 },
          { id: 'milestone-2', fundingPercentage: 30 }
          // Total = 90%, not 100%
        ]
      };
      
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockUser);
        if (collection === 'projects') return Promise.resolve(invalidMilestonesProject);
        throw new Error('Unexpected collection');
      });

      await expect(
        publishProject(validPublishData, mockContext)
      ).rejects.toThrow('Milestone funding percentages must sum to 100%');
    });

    it('should require at least one milestone', async () => {
      const noMilestonesProject = { ...mockProject, milestones: [] };
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockUser);
        if (collection === 'projects') return Promise.resolve(noMilestonesProject);
        throw new Error('Unexpected collection');
      });

      await expect(
        publishProject(validPublishData, mockContext)
      ).rejects.toThrow('Project must have at least one milestone');
    });

    it('should require cover image', async () => {
      const noCoverProject = {
        ...mockProject,
        media: { ...mockProject.media, coverImage: undefined }
      };
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockUser);
        if (collection === 'projects') return Promise.resolve(noCoverProject);
        throw new Error('Unexpected collection');
      });

      await expect(
        publishProject(validPublishData, mockContext)
      ).rejects.toThrow('Project must have a cover image');
    });
  });

  describe('Publication Process', () => {
    it('should update project status to ACTIVE', async () => {
      await publishProject(validPublishData, mockContext);

      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ ...mockProject, version: 1 })
        }),
        update: jest.fn(),
        set: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          status: STATUS.PROJECT.ACTIVE,
          publishedAt: expect.any(Date),
          fundingStartsAt: expect.any(Date)
        })
      );
    });

    it('should create activity feed entry', async () => {
      await publishProject(validPublishData, mockContext);

      expect(mockFirestoreHelper.addDocument).toHaveBeenCalledWith(
        'activity_feed',
        expect.objectContaining({
          type: 'project_published',
          projectId: 'test-project-id',
          projectTitle: 'Test Project'
        })
      );
    });

    it('should update platform statistics', async () => {
      await publishProject(validPublishData, mockContext);

      expect(mockFirestoreHelper.incrementDocument).toHaveBeenCalledWith(
        'platform_stats',
        'global',
        expect.objectContaining({
          'projects.total': 1,
          'projects.active': 1
        })
      );
    });
  });

  describe('Response Structure', () => {
    it('should return correct response format', async () => {
      const result = await publishProject(validPublishData, mockContext);

      expect(result).toEqual({
        projectId: 'test-project-id',
        status: STATUS.PROJECT.ACTIVE,
        publishedAt: expect.any(String),
        fundingStartsAt: expect.any(String),
        fundingEndsAt: expect.any(String),
        fundingDurationDays: expect.any(Number),
        projectUrl: expect.stringContaining('/projects/test-project'),
        shareUrl: expect.stringContaining('/projects/test-project?share=true'),
        success: true
      });
    });

    it('should calculate correct funding duration', async () => {
      const result = await publishProject(validPublishData, mockContext);

      expect(result.fundingDurationDays).toBeGreaterThan(0);
      expect(result.fundingDurationDays).toBeLessThanOrEqual(31);
    });
  });

  describe('Terms Confirmation', () => {
    it('should require terms confirmation', async () => {
      const noTermsData = { ...validPublishData, confirmTerms: false };

      await expect(
        publishProject(noTermsData, mockContext)
      ).rejects.toThrow();
    });

    it('should handle marketing consent', async () => {
      const withMarketingConsent = { ...validPublishData, marketingConsent: true };
      
      const result = await publishProject(withMarketingConsent, mockContext);
      expect(result.success).toBe(true);
    });
  });
});