/**
 * Tests for Get Project Details Firebase Function
 * Social Finance Impact Platform
 */

import { CallableContext } from 'firebase-functions/v1/https';
import { getProjectDetails } from '../getProjectDetails';
import { firestoreHelper } from '../../utils/firestore';
import { ProjectsAPI } from '../../types/api';
import { ProjectDocument, UserDocument, ContributionDocument } from '../../types/firestore';
import { STATUS, USER_PERMISSIONS } from '../../utils/constants';

// Mocks
jest.mock('../../utils/firestore');
jest.mock('../../utils/auth');
jest.mock('../../utils/logger');

const mockFirestoreHelper = jest.mocked(firestoreHelper);

describe('getProjectDetails Function', () => {
  let mockContext: CallableContext;
  let mockProject: ProjectDocument;
  let mockUser: UserDocument;
  let mockContributions: ContributionDocument[];
  let validRequestData: ProjectsAPI.GetProjectDetailsRequest;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockContext = {
      auth: { uid: 'viewer-uid', token: {} },
      rawRequest: { ip: '192.168.1.1', headers: { 'user-agent': 'test-agent' } }
    } as any;

    mockProject = {
      uid: 'test-project-id',
      creatorUid: 'creator-uid',
      status: STATUS.PROJECT.ACTIVE,
      title: 'Test Project',
      description: 'Test project description',
      category: 'environment',
      visibility: 'public',
      version: 1,
      
      funding: {
        goal: 1000000,
        raised: 500000,
        currency: 'EUR',
        deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        percentage: 50,
        contributorsCount: 25,
        platformFees: { estimated: 50000, rate: 0.05 },
        netGoal: 950000,
        netRaised: 475000
      },

      team: [
        {
          id: 'team-1',
          name: 'Project Leader',
          role: 'Leader',
          bio: 'Experienced leader',
          isLead: true,
          linkedin: 'https://linkedin.com/in/leader'
        }
      ],

      milestones: [
        {
          id: 'milestone-1',
          title: 'Phase 1',
          status: STATUS.MILESTONE.COMPLETED,
          fundingPercentage: 50,
          evidence: [
            { id: 'evidence-1', type: 'document', verified: true, title: 'Evidence 1' },
            { id: 'evidence-2', type: 'image', verified: false, title: 'Evidence 2' }
          ],
          auditStatus: STATUS.AUDIT.APPROVED,
          auditAssignedTo: 'auditor-uid'
        },
        {
          id: 'milestone-2',
          title: 'Phase 2',
          status: STATUS.MILESTONE.PENDING,
          fundingPercentage: 50,
          evidence: []
        }
      ],

      publishedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      stats: {
        views: 1000,
        shares: 50
      }
    } as ProjectDocument;

    mockUser = {
      uid: 'viewer-uid',
      permissions: []
    } as UserDocument;

    mockContributions = [
      {
        id: 'contrib-1',
        contributorUid: 'contributor-1',
        contributorName: 'John Doe',
        amount: { gross: 10000, currency: 'EUR' },
        status: 'confirmed',
        anonymous: false,
        payment: { paymentMethod: 'card', paymentIntentId: 'pi_123' },
        createdAt: new Date()
      },
      {
        id: 'contrib-2',
        contributorUid: 'contributor-2',
        contributorName: 'Anonymous',
        amount: { gross: 5000, currency: 'EUR' },
        status: 'confirmed',
        anonymous: true,
        payment: { paymentMethod: 'card', paymentIntentId: 'pi_456' },
        createdAt: new Date()
      }
    ] as ContributionDocument[];

    validRequestData = {
      projectId: 'test-project-id',
      includeStats: true,
      includeContributions: false,
      includeTeamDetails: true,
      includeMilestoneDetails: true
    };

    mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
      if (collection === 'users') return Promise.resolve(mockUser);
      if (collection === 'projects') return Promise.resolve(mockProject);
      throw new Error('Unexpected collection');
    });

    mockFirestoreHelper.countDocuments.mockResolvedValue(25);
    mockFirestoreHelper.queryDocuments.mockResolvedValue(mockContributions);
    mockFirestoreHelper.incrementDocument.mockResolvedValue();
  });

  describe('Public Access', () => {
    it('should allow public access to public projects', async () => {
      const publicContext = { ...mockContext, auth: null };
      
      const result = await getProjectDetails(validRequestData, publicContext);
      
      expect(result.success).toBe(true);
      expect(result.project.title).toBe('Test Project');
      expect(result.viewerPermissions.canViewPrivateData).toBe(false);
    });

    it('should filter sensitive data for public viewers', async () => {
      const publicContext = { ...mockContext, auth: null };
      
      const result = await getProjectDetails(validRequestData, publicContext);
      
      expect(result.project.funding.platformFees).toBeUndefined();
      expect(result.project.funding.netGoal).toBeUndefined();
      expect(result.project.auditStatus).toBeUndefined();
      expect(result.project.complianceChecks).toBeUndefined();
    });

    it('should show only verified evidence to public viewers', async () => {
      const publicContext = { ...mockContext, auth: null };
      
      const result = await getProjectDetails(validRequestData, publicContext);
      
      const milestone1 = result.milestones?.find(m => m.id === 'milestone-1');
      expect(milestone1?.evidence).toHaveLength(1); // Only verified evidence
      expect(milestone1?.evidence[0].verified).toBe(true);
    });
  });

  describe('Private Project Access', () => {
    it('should reject public access to private projects', async () => {
      const privateProject = { ...mockProject, visibility: 'private' };
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockUser);
        if (collection === 'projects') return Promise.resolve(privateProject);
        throw new Error('Unexpected collection');
      });

      const publicContext = { ...mockContext, auth: null };

      await expect(
        getProjectDetails(validRequestData, publicContext)
      ).rejects.toThrow('Authentication required for private project');
    });

    it('should allow creator access to private projects', async () => {
      const privateProject = { ...mockProject, visibility: 'private' };
      const creatorContext = { ...mockContext, auth: { uid: 'creator-uid', token: {} } };
      
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve({ ...mockUser, uid: 'creator-uid' });
        if (collection === 'projects') return Promise.resolve(privateProject);
        throw new Error('Unexpected collection');
      });

      const result = await getProjectDetails(validRequestData, creatorContext);
      
      expect(result.success).toBe(true);
      expect(result.viewerPermissions.canViewPrivateData).toBe(true);
    });

    it('should allow admin access to private projects', async () => {
      const privateProject = { ...mockProject, visibility: 'private' };
      const adminUser = { ...mockUser, permissions: [USER_PERMISSIONS.MODERATE_PROJECTS] };
      
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(adminUser);
        if (collection === 'projects') return Promise.resolve(privateProject);
        throw new Error('Unexpected collection');
      });

      const result = await getProjectDetails(validRequestData, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.viewerPermissions.canViewPrivateData).toBe(true);
    });

    it('should reject unauthorized access to private projects', async () => {
      const privateProject = { ...mockProject, visibility: 'private' };
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockUser);
        if (collection === 'projects') return Promise.resolve(privateProject);
        throw new Error('Unexpected collection');
      });

      await expect(
        getProjectDetails(validRequestData, mockContext)
      ).rejects.toThrow('Access denied to private project');
    });
  });

  describe('Project Status Filtering', () => {
    it('should allow access to active projects', async () => {
      const result = await getProjectDetails(validRequestData, mockContext);
      expect(result.success).toBe(true);
    });

    it('should allow access to funding projects', async () => {
      const fundingProject = { ...mockProject, status: STATUS.PROJECT.FUNDING };
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockUser);
        if (collection === 'projects') return Promise.resolve(fundingProject);
        throw new Error('Unexpected collection');
      });

      const result = await getProjectDetails(validRequestData, mockContext);
      expect(result.success).toBe(true);
    });

    it('should allow access to completed projects', async () => {
      const completedProject = { ...mockProject, status: STATUS.PROJECT.COMPLETED };
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockUser);
        if (collection === 'projects') return Promise.resolve(completedProject);
        throw new Error('Unexpected collection');
      });

      const result = await getProjectDetails(validRequestData, mockContext);
      expect(result.success).toBe(true);
    });

    it('should reject access to draft projects for non-creators', async () => {
      const draftProject = { ...mockProject, status: STATUS.PROJECT.DRAFT };
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockUser);
        if (collection === 'projects') return Promise.resolve(draftProject);
        throw new Error('Unexpected collection');
      });

      await expect(
        getProjectDetails(validRequestData, mockContext)
      ).rejects.toThrow('Project not found or not available');
    });
  });

  describe('Statistics Enrichment', () => {
    it('should include enriched statistics when requested', async () => {
      const statsRequestData = { ...validRequestData, includeStats: true };
      
      const result = await getProjectDetails(statsRequestData, mockContext);
      
      expect(result.project.enrichedStats).toBeDefined();
      expect(result.project.enrichedStats.contributionsCount).toBe(25);
      expect(result.project.enrichedStats.uniqueContributorsCount).toBe(2);
      expect(result.project.enrichedStats.daysRemaining).toBeGreaterThan(0);
      expect(result.project.enrichedStats.momentum).toMatch(/^(low|medium|high)$/);
    });

    it('should skip statistics when not requested', async () => {
      const noStatsRequestData = { ...validRequestData, includeStats: false };
      
      const result = await getProjectDetails(noStatsRequestData, mockContext);
      
      expect(result.project.enrichedStats).toBeUndefined();
    });

    it('should calculate correct funding velocity', async () => {
      const result = await getProjectDetails(validRequestData, mockContext);
      
      expect(result.project.enrichedStats.fundingVelocity).toBeGreaterThan(0);
      expect(typeof result.project.enrichedStats.fundingVelocity).toBe('number');
    });
  });

  describe('Contributions Data', () => {
    it('should include contributions when requested with private access', async () => {
      const creatorContext = { ...mockContext, auth: { uid: 'creator-uid', token: {} } };
      const contributionsRequestData = { ...validRequestData, includeContributions: true };
      
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve({ ...mockUser, uid: 'creator-uid' });
        if (collection === 'projects') return Promise.resolve(mockProject);
        throw new Error('Unexpected collection');
      });
      
      const result = await getProjectDetails(contributionsRequestData, creatorContext);
      
      expect(result.contributions).toBeDefined();
      expect(result.contributions).toHaveLength(2);
      expect(result.contributions![0].contributorUid).toBeDefined(); // Private access shows UIDs
    });

    it('should filter contribution data for public access', async () => {
      const publicContext = { ...mockContext, auth: null };
      const contributionsRequestData = { ...validRequestData, includeContributions: true };
      
      const result = await getProjectDetails(contributionsRequestData, publicContext);
      
      expect(result.contributions).toBeDefined();
      expect(result.contributions![0].contributorUid).toBeUndefined(); // Public access hides UIDs
      expect(result.contributions![0].payment.paymentIntentId).toBeUndefined(); // Hide payment details
    });

    it('should skip contributions when not requested', async () => {
      const noContributionsRequestData = { ...validRequestData, includeContributions: false };
      
      const result = await getProjectDetails(noContributionsRequestData, mockContext);
      
      expect(result.contributions).toBeUndefined();
    });
  });

  describe('Team Data', () => {
    it('should include team details when requested', async () => {
      const result = await getProjectDetails(validRequestData, mockContext);
      
      expect(result.team).toBeDefined();
      expect(result.team).toHaveLength(1);
      expect(result.team![0].name).toBe('Project Leader');
    });

    it('should filter team LinkedIn for public access', async () => {
      const publicContext = { ...mockContext, auth: null };
      
      const result = await getProjectDetails(validRequestData, publicContext);
      
      expect(result.team![0].linkedin).toBeUndefined();
    });

    it('should show full team details for private access', async () => {
      const creatorContext = { ...mockContext, auth: { uid: 'creator-uid', token: {} } };
      
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve({ ...mockUser, uid: 'creator-uid' });
        if (collection === 'projects') return Promise.resolve(mockProject);
        throw new Error('Unexpected collection');
      });
      
      const result = await getProjectDetails(validRequestData, creatorContext);
      
      expect(result.team![0].linkedin).toBe('https://linkedin.com/in/leader');
    });

    it('should skip team details when not requested', async () => {
      const noTeamRequestData = { ...validRequestData, includeTeamDetails: false };
      
      const result = await getProjectDetails(noTeamRequestData, mockContext);
      
      expect(result.team).toBeUndefined();
    });
  });

  describe('Milestone Data', () => {
    it('should include milestone details when requested', async () => {
      const result = await getProjectDetails(validRequestData, mockContext);
      
      expect(result.milestones).toBeDefined();
      expect(result.milestones).toHaveLength(2);
      expect(result.milestones![0].title).toBe('Phase 1');
    });

    it('should filter milestone audit data for public access', async () => {
      const publicContext = { ...mockContext, auth: null };
      
      const result = await getProjectDetails(validRequestData, publicContext);
      
      expect(result.milestones![0].auditStatus).toBeUndefined();
      expect(result.milestones![0].auditAssignedTo).toBeUndefined();
      expect(result.milestones![0].evidence).toHaveLength(1); // Only verified evidence
    });

    it('should show full milestone details for private access', async () => {
      const creatorContext = { ...mockContext, auth: { uid: 'creator-uid', token: {} } };
      
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve({ ...mockUser, uid: 'creator-uid' });
        if (collection === 'projects') return Promise.resolve(mockProject);
        throw new Error('Unexpected collection');
      });
      
      const result = await getProjectDetails(validRequestData, creatorContext);
      
      expect(result.milestones![0].auditStatus).toBe(STATUS.AUDIT.APPROVED);
      expect(result.milestones![0].auditAssignedTo).toBe('auditor-uid');
      expect(result.milestones![0].evidence).toHaveLength(2); // All evidence
    });

    it('should skip milestone details when not requested', async () => {
      const noMilestonesRequestData = { ...validRequestData, includeMilestoneDetails: false };
      
      const result = await getProjectDetails(noMilestonesRequestData, mockContext);
      
      expect(result.milestones).toBeUndefined();
    });
  });

  describe('Viewer Permissions', () => {
    it('should set correct permissions for project creator', async () => {
      const creatorContext = { ...mockContext, auth: { uid: 'creator-uid', token: {} } };
      
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve({ ...mockUser, uid: 'creator-uid' });
        if (collection === 'projects') return Promise.resolve(mockProject);
        throw new Error('Unexpected collection');
      });
      
      const result = await getProjectDetails(validRequestData, creatorContext);
      
      expect(result.viewerPermissions).toEqual({
        canEdit: true,
        canViewPrivateData: true,
        canContribute: false, // Creator can't contribute to own project
        canComment: true
      });
    });

    it('should set correct permissions for regular authenticated user', async () => {
      const result = await getProjectDetails(validRequestData, mockContext);
      
      expect(result.viewerPermissions).toEqual({
        canEdit: false,
        canViewPrivateData: false,
        canContribute: true,
        canComment: true
      });
    });

    it('should set correct permissions for public visitor', async () => {
      const publicContext = { ...mockContext, auth: null };
      
      const result = await getProjectDetails(validRequestData, publicContext);
      
      expect(result.viewerPermissions).toEqual({
        canEdit: false,
        canViewPrivateData: false,
        canContribute: true,
        canComment: false // No auth, can't comment
      });
    });

    it('should set correct permissions for admin', async () => {
      const adminUser = { ...mockUser, permissions: [USER_PERMISSIONS.MODERATE_PROJECTS] };
      
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(adminUser);
        if (collection === 'projects') return Promise.resolve(mockProject);
        throw new Error('Unexpected collection');
      });
      
      const result = await getProjectDetails(validRequestData, mockContext);
      
      expect(result.viewerPermissions).toEqual({
        canEdit: false, // Admin is not creator
        canViewPrivateData: true,
        canContribute: true,
        canComment: true
      });
    });
  });

  describe('View Tracking', () => {
    it('should increment view count for external viewers', async () => {
      await getProjectDetails(validRequestData, mockContext);
      
      expect(mockFirestoreHelper.incrementDocument).toHaveBeenCalledWith(
        'projects',
        'test-project-id',
        expect.objectContaining({
          'stats.views': 1,
          lastViewedAt: expect.any(Date)
        })
      );
    });

    it('should not increment view count for project creator', async () => {
      const creatorContext = { ...mockContext, auth: { uid: 'creator-uid', token: {} } };
      
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve({ ...mockUser, uid: 'creator-uid' });
        if (collection === 'projects') return Promise.resolve(mockProject);
        throw new Error('Unexpected collection');
      });
      
      await getProjectDetails(validRequestData, creatorContext);
      
      expect(mockFirestoreHelper.incrementDocument).not.toHaveBeenCalled();
    });

    it('should track views for anonymous users', async () => {
      const anonymousContext = { ...mockContext, auth: null };
      
      await getProjectDetails(validRequestData, anonymousContext);
      
      expect(mockFirestoreHelper.incrementDocument).toHaveBeenCalledWith(
        'projects',
        'test-project-id',
        expect.objectContaining({
          'stats.views': 1
        })
      );
    });
  });

  describe('Momentum Calculation', () => {
    it('should calculate high momentum for active projects', async () => {
      mockFirestoreHelper.queryDocuments.mockImplementation((collection, filters, options) => {
        // Simulate recent high activity
        if (collection.includes('contributions') && filters.some(f => f[0] === 'createdAt')) {
          return Promise.resolve(Array(20).fill(mockContributions[0])); // 20 recent contributions
        }
        return Promise.resolve(mockContributions);
      });
      
      const result = await getProjectDetails(validRequestData, mockContext);
      
      expect(result.project.enrichedStats.momentum).toBe('high');
    });

    it('should calculate low momentum for slow projects', async () => {
      mockFirestoreHelper.queryDocuments.mockImplementation((collection, filters, options) => {
        // Simulate low recent activity
        if (collection.includes('contributions') && filters.some(f => f[0] === 'createdAt')) {
          return Promise.resolve([]); // No recent contributions
        }
        return Promise.resolve(mockContributions);
      });
      
      const result = await getProjectDetails(validRequestData, mockContext);
      
      expect(result.project.enrichedStats.momentum).toBe('low');
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent projects', async () => {
      mockFirestoreHelper.getDocument.mockRejectedValue(new Error('Document not found'));

      await expect(
        getProjectDetails(validRequestData, mockContext)
      ).rejects.toThrow();
    });

    it('should handle Firestore errors gracefully', async () => {
      mockFirestoreHelper.queryDocuments.mockRejectedValue(new Error('Firestore error'));
      
      const result = await getProjectDetails(validRequestData, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.project.enrichedStats).toBeUndefined(); // Stats enrichment failed
    });

    it('should continue when view increment fails', async () => {
      mockFirestoreHelper.incrementDocument.mockRejectedValue(new Error('Increment failed'));
      
      const result = await getProjectDetails(validRequestData, mockContext);
      
      expect(result.success).toBe(true); // Should not fail the entire function
    });
  });

  describe('Response Structure', () => {
    it('should return complete response structure', async () => {
      const result = await getProjectDetails(validRequestData, mockContext);
      
      expect(result).toEqual({
        project: expect.objectContaining({
          uid: 'test-project-id',
          title: 'Test Project',
          enrichedStats: expect.any(Object)
        }),
        team: expect.arrayContaining([
          expect.objectContaining({
            name: 'Project Leader',
            role: 'Leader'
          })
        ]),
        milestones: expect.arrayContaining([
          expect.objectContaining({
            id: 'milestone-1',
            title: 'Phase 1'
          })
        ]),
        contributions: undefined,
        viewerPermissions: expect.objectContaining({
          canEdit: false,
          canViewPrivateData: false,
          canContribute: true,
          canComment: true
        }),
        success: true
      });
    });

    it('should handle minimal data gracefully', async () => {
      const minimalProject = {
        ...mockProject,
        team: [],
        milestones: [],
        stats: {}
      };
      
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockUser);
        if (collection === 'projects') return Promise.resolve(minimalProject);
        throw new Error('Unexpected collection');
      });
      
      const result = await getProjectDetails(validRequestData, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.team).toHaveLength(0);
      expect(result.milestones).toHaveLength(0);
    });
  });
});