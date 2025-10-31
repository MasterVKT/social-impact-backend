/**
 * Tests for Get Projects by Creator Firebase Function
 * Social Finance Impact Platform
 */

import { CallableContext } from 'firebase-functions/v1/https';
import { getProjectsByCreator } from '../getProjectsByCreator';
import { firestoreHelper } from '../../utils/firestore';
import { ProjectsAPI } from '../../types/api';
import { ProjectDocument, UserDocument, ContributionDocument } from '../../types/firestore';
import { STATUS, USER_PERMISSIONS } from '../../utils/constants';

// Mocks
jest.mock('../../utils/firestore');
jest.mock('../../utils/auth');
jest.mock('../../utils/logger');

const mockFirestoreHelper = jest.mocked(firestoreHelper);

describe('getProjectsByCreator Function', () => {
  let mockContext: CallableContext;
  let mockCreator: UserDocument;
  let mockProjects: ProjectDocument[];
  let mockContributions: ContributionDocument[];
  let validRequestData: ProjectsAPI.GetProjectsByCreatorRequest;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockContext = {
      auth: { uid: 'viewer-uid', token: {} },
      rawRequest: { ip: '192.168.1.1', headers: { 'user-agent': 'test-agent' } }
    } as any;

    mockCreator = {
      uid: 'creator-uid',
      displayName: 'John Creator',
      profilePicture: 'https://example.com/profile.jpg',
      bio: 'Experienced project creator',
      kyc: { status: STATUS.KYC.APPROVED },
      createdAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
      stats: {
        projectsCreated: 3,
        totalFundsRaised: 2500000,
        successfulProjects: 2,
        averageProjectSize: 833333,
        lastLoginAt: new Date()
      }
    } as UserDocument;

    mockProjects = [
      {
        uid: 'project-1',
        creatorUid: 'creator-uid',
        title: 'Active Project',
        status: STATUS.PROJECT.ACTIVE,
        visibility: 'public',
        category: 'environment',
        funding: {
          goal: 1000000,
          raised: 500000,
          percentage: 50,
          deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        },
        milestones: [
          { id: 'milestone-1', status: STATUS.MILESTONE.COMPLETED },
          { id: 'milestone-2', status: STATUS.MILESTONE.PENDING }
        ],
        publishedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(),
        stats: { views: 500 }
      },
      {
        uid: 'project-2',
        creatorUid: 'creator-uid',
        title: 'Draft Project',
        status: STATUS.PROJECT.DRAFT,
        visibility: 'private',
        category: 'education',
        funding: {
          goal: 500000,
          raised: 0,
          percentage: 0,
          deadline: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
        },
        milestones: [
          { id: 'milestone-1', status: STATUS.MILESTONE.PENDING }
        ],
        updatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        stats: { views: 5 }
      },
      {
        uid: 'project-3',
        creatorUid: 'creator-uid',
        title: 'Completed Project',
        status: STATUS.PROJECT.COMPLETED,
        visibility: 'public',
        category: 'environment',
        funding: {
          goal: 1000000,
          raised: 1000000,
          percentage: 100,
          deadline: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        },
        milestones: [
          { id: 'milestone-1', status: STATUS.MILESTONE.COMPLETED },
          { id: 'milestone-2', status: STATUS.MILESTONE.COMPLETED }
        ],
        publishedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        completedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        stats: { views: 2000 }
      }
    ] as ProjectDocument[];

    mockContributions = [
      {
        id: 'contrib-1',
        contributorUid: 'contributor-1',
        contributorName: 'John Doe',
        amount: { gross: 10000, currency: 'EUR' },
        status: 'confirmed',
        anonymous: false,
        message: 'Great project!',
        createdAt: new Date()
      }
    ] as ContributionDocument[];

    validRequestData = {
      creatorUid: 'creator-uid',
      status: 'all',
      includeStats: true,
      includeContributions: false,
      sortBy: 'updated',
      sortOrder: 'desc',
      page: 1,
      limit: 20
    };

    mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
      if (collection === 'users' && id === 'creator-uid') return Promise.resolve(mockCreator);
      if (collection === 'users' && id === 'viewer-uid') return Promise.resolve({ ...mockCreator, uid: 'viewer-uid', permissions: [] });
      throw new Error('Unexpected collection/id');
    });

    mockFirestoreHelper.queryDocuments.mockImplementation((collection, filters, options) => {
      if (collection === 'projects') return Promise.resolve(mockProjects);
      if (collection.includes('contributions')) return Promise.resolve(mockContributions);
      return Promise.resolve([]);
    });
  });

  describe('Creator Access Validation', () => {
    it('should allow users to view their own projects', async () => {
      const selfContext = { ...mockContext, auth: { uid: 'creator-uid', token: {} } };
      const selfRequestData = { ...validRequestData, creatorUid: undefined }; // Omit to use auth uid
      
      const result = await getProjectsByCreator(selfRequestData, selfContext);
      
      expect(result.success).toBe(true);
      expect(result.creator.uid).toBe('creator-uid');
      expect(result.projects).toHaveLength(3);
      expect(result.filters.canViewPrivate).toBe(true);
    });

    it('should allow admins to view any creator projects', async () => {
      const adminUser = { ...mockCreator, uid: 'admin-uid', permissions: [USER_PERMISSIONS.MODERATE_PROJECTS] };
      
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users' && id === 'creator-uid') return Promise.resolve(mockCreator);
        if (collection === 'users' && id === 'admin-uid') return Promise.resolve(adminUser);
        throw new Error('Unexpected collection/id');
      });

      const adminContext = { ...mockContext, auth: { uid: 'admin-uid', token: {} } };
      
      const result = await getProjectsByCreator(validRequestData, adminContext);
      
      expect(result.success).toBe(true);
      expect(result.filters.canViewPrivate).toBe(true);
    });

    it('should allow public access to public projects only', async () => {
      const publicContext = { ...mockContext, auth: null };
      
      const result = await getProjectsByCreator(validRequestData, publicContext);
      
      expect(result.success).toBe(true);
      expect(result.filters.canViewPrivate).toBe(false);
      expect(result.projects.length).toBeLessThan(3); // Should exclude draft projects
    });

    it('should filter private projects for external viewers', async () => {
      const externalContext = { ...mockContext, auth: { uid: 'external-uid', token: {} } };
      
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users' && id === 'creator-uid') return Promise.resolve(mockCreator);
        if (collection === 'users' && id === 'external-uid') return Promise.resolve({ ...mockCreator, uid: 'external-uid', permissions: [] });
        throw new Error('Unexpected collection/id');
      });
      
      const result = await getProjectsByCreator(validRequestData, externalContext);
      
      expect(result.success).toBe(true);
      expect(result.filters.canViewPrivate).toBe(false);
    });
  });

  describe('Status Filtering', () => {
    it('should filter by active status', async () => {
      const activeRequestData = { ...validRequestData, status: 'active' };
      
      const result = await getProjectsByCreator(activeRequestData, mockContext);
      
      expect(mockFirestoreHelper.queryDocuments).toHaveBeenCalledWith(
        'projects',
        expect.arrayContaining([
          ['creatorUid', '==', 'creator-uid'],
          ['status', '==', STATUS.PROJECT.ACTIVE]
        ]),
        expect.any(Object)
      );
    });

    it('should filter by completed status', async () => {
      const completedRequestData = { ...validRequestData, status: 'completed' };
      
      const result = await getProjectsByCreator(completedRequestData, mockContext);
      
      expect(mockFirestoreHelper.queryDocuments).toHaveBeenCalledWith(
        'projects',
        expect.arrayContaining([
          ['creatorUid', '==', 'creator-uid'],
          ['status', '==', STATUS.PROJECT.COMPLETED]
        ]),
        expect.any(Object)
      );
    });

    it('should return all projects when status is "all"', async () => {
      const allRequestData = { ...validRequestData, status: 'all' };
      
      const result = await getProjectsByCreator(allRequestData, mockContext);
      
      expect(mockFirestoreHelper.queryDocuments).toHaveBeenCalledWith(
        'projects',
        expect.arrayContaining([
          ['creatorUid', '==', 'creator-uid']
        ]),
        expect.any(Object)
      );
    });
  });

  describe('Sorting Options', () => {
    it('should sort by creation date', async () => {
      const sortedRequestData = { ...validRequestData, sortBy: 'created', sortOrder: 'asc' };
      
      const result = await getProjectsByCreator(sortedRequestData, mockContext);
      
      expect(mockFirestoreHelper.queryDocuments).toHaveBeenCalledWith(
        'projects',
        expect.any(Array),
        expect.objectContaining({
          orderBy: [{ field: 'createdAt', direction: 'asc' }]
        })
      );
    });

    it('should sort by update date', async () => {
      const sortedRequestData = { ...validRequestData, sortBy: 'updated', sortOrder: 'desc' };
      
      const result = await getProjectsByCreator(sortedRequestData, mockContext);
      
      expect(mockFirestoreHelper.queryDocuments).toHaveBeenCalledWith(
        'projects',
        expect.any(Array),
        expect.objectContaining({
          orderBy: [{ field: 'updatedAt', direction: 'desc' }]
        })
      );
    });

    it('should sort by deadline', async () => {
      const sortedRequestData = { ...validRequestData, sortBy: 'deadline' };
      
      const result = await getProjectsByCreator(sortedRequestData, mockContext);
      
      expect(mockFirestoreHelper.queryDocuments).toHaveBeenCalledWith(
        'projects',
        expect.any(Array),
        expect.objectContaining({
          orderBy: [{ field: 'funding.deadline', direction: 'desc' }]
        })
      );
    });

    it('should handle client-side sorting for funding progress', async () => {
      const progressRequestData = { ...validRequestData, sortBy: 'funding_progress' };
      
      const result = await getProjectsByCreator(progressRequestData, mockContext);
      
      expect(result.success).toBe(true);
      // Verify client-side sorting was applied (projects should be sorted by funding percentage)
    });
  });

  describe('Statistics Enrichment', () => {
    it('should include enriched statistics when requested', async () => {
      const statsRequestData = { ...validRequestData, includeStats: true };
      
      const result = await getProjectsByCreator(statsRequestData, mockContext);
      
      expect(result.projects[0].enrichedStats).toBeDefined();
      expect(result.projects[0].enrichedStats.daysRemaining).toBeGreaterThan(0);
      expect(result.projects[0].enrichedStats.fundingVelocity).toBeGreaterThanOrEqual(0);
    });

    it('should skip statistics when not requested', async () => {
      const noStatsRequestData = { ...validRequestData, includeStats: false };
      
      const result = await getProjectsByCreator(noStatsRequestData, mockContext);
      
      expect(result.projects[0].enrichedStats).toBeUndefined();
    });

    it('should calculate correct aggregate statistics', async () => {
      const result = await getProjectsByCreator(validRequestData, mockContext);
      
      expect(result.aggregateStats).toEqual({
        totalProjects: 3,
        activeProjects: 1,
        completedProjects: 1,
        draftProjects: 1,
        totalFundingGoal: 2500000,
        totalFundingRaised: 1500000,
        averageProjectSize: 833333,
        totalMilestones: 5,
        completedMilestones: 3,
        successRate: 33, // 1 completed out of 3 total
        averageFundingDuration: expect.any(Number)
      });
    });
  });

  describe('Contributions Data', () => {
    it('should include contributions when requested with private access', async () => {
      const creatorContext = { ...mockContext, auth: { uid: 'creator-uid', token: {} } };
      const contributionsRequestData = { ...validRequestData, includeContributions: true };
      
      const result = await getProjectsByCreator(contributionsRequestData, creatorContext);
      
      expect(result.projects[0].recentContributions).toBeDefined();
      expect(result.projects[0].recentContributions[0].contributorName).toBe('John Doe');
    });

    it('should anonymize contributions for public access', async () => {
      const publicContext = { ...mockContext, auth: null };
      const contributionsRequestData = { ...validRequestData, includeContributions: true };
      
      const result = await getProjectsByCreator(contributionsRequestData, publicContext);
      
      if (result.projects[0]?.recentContributions) {
        expect(result.projects[0].recentContributions[0].contributorName).toBe('Contributeur');
      }
    });

    it('should skip contributions when not requested', async () => {
      const noContributionsRequestData = { ...validRequestData, includeContributions: false };
      
      const result = await getProjectsByCreator(noContributionsRequestData, mockContext);
      
      expect(result.projects[0].recentContributions).toBeUndefined();
    });
  });

  describe('Data Filtering', () => {
    it('should filter sensitive data for external viewers', async () => {
      const externalContext = { ...mockContext, auth: { uid: 'external-uid', token: {} } };
      
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users' && id === 'creator-uid') return Promise.resolve(mockCreator);
        if (collection === 'users' && id === 'external-uid') return Promise.resolve({ ...mockCreator, uid: 'external-uid', permissions: [] });
        throw new Error('Unexpected collection/id');
      });
      
      const result = await getProjectsByCreator(validRequestData, externalContext);
      
      expect(result.projects[0].funding.platformFees).toBeUndefined();
      expect(result.projects[0].complianceChecks).toBeUndefined();
      expect(result.projects[0].auditStatus).toBeUndefined();
    });

    it('should preserve sensitive data for creator', async () => {
      const creatorContext = { ...mockContext, auth: { uid: 'creator-uid', token: {} } };
      
      const projectWithSensitiveData = {
        ...mockProjects[0],
        funding: {
          ...mockProjects[0].funding,
          platformFees: { estimated: 50000 },
          netGoal: 950000
        },
        complianceChecks: { contentModeration: STATUS.MODERATION.APPROVED }
      };

      mockFirestoreHelper.queryDocuments.mockResolvedValue([projectWithSensitiveData]);
      
      const result = await getProjectsByCreator(validRequestData, creatorContext);
      
      expect(result.projects[0].funding.platformFees).toBeDefined();
      expect(result.projects[0].complianceChecks).toBeDefined();
    });

    it('should preserve sensitive data for admins', async () => {
      const adminUser = { ...mockCreator, uid: 'admin-uid', permissions: [USER_PERMISSIONS.MODERATE_PROJECTS] };
      
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users' && id === 'creator-uid') return Promise.resolve(mockCreator);
        if (collection === 'users' && id === 'admin-uid') return Promise.resolve(adminUser);
        throw new Error('Unexpected collection/id');
      });

      const adminContext = { ...mockContext, auth: { uid: 'admin-uid', token: {} } };
      
      const projectWithSensitiveData = {
        ...mockProjects[0],
        funding: {
          ...mockProjects[0].funding,
          platformFees: { estimated: 50000 }
        }
      };

      mockFirestoreHelper.queryDocuments.mockResolvedValue([projectWithSensitiveData]);
      
      const result = await getProjectsByCreator(validRequestData, adminContext);
      
      expect(result.projects[0].funding.platformFees).toBeDefined();
    });
  });

  describe('Pagination', () => {
    it('should handle pagination correctly', async () => {
      const paginatedRequestData = { ...validRequestData, page: 2, limit: 1 };
      
      const result = await getProjectsByCreator(paginatedRequestData, mockContext);
      
      expect(result.pagination).toEqual({
        currentPage: 2,
        totalPages: 3,
        totalItems: 3,
        itemsPerPage: 1,
        hasNextPage: true,
        hasPreviousPage: true
      });
      expect(result.projects).toHaveLength(1);
    });

    it('should handle first page correctly', async () => {
      const firstPageRequestData = { ...validRequestData, page: 1, limit: 2 };
      
      const result = await getProjectsByCreator(firstPageRequestData, mockContext);
      
      expect(result.pagination).toEqual({
        currentPage: 1,
        totalPages: 2,
        totalItems: 3,
        itemsPerPage: 2,
        hasNextPage: true,
        hasPreviousPage: false
      });
      expect(result.projects).toHaveLength(2);
    });

    it('should handle last page correctly', async () => {
      const lastPageRequestData = { ...validRequestData, page: 3, limit: 1 };
      
      const result = await getProjectsByCreator(lastPageRequestData, mockContext);
      
      expect(result.pagination).toEqual({
        currentPage: 3,
        totalPages: 3,
        totalItems: 3,
        itemsPerPage: 1,
        hasNextPage: false,
        hasPreviousPage: true
      });
      expect(result.projects).toHaveLength(1);
    });
  });

  describe('Creator Information', () => {
    it('should include public creator information for external viewers', async () => {
      const result = await getProjectsByCreator(validRequestData, mockContext);
      
      expect(result.creator).toEqual({
        uid: 'creator-uid',
        displayName: 'John Creator',
        profilePicture: 'https://example.com/profile.jpg',
        bio: undefined, // Hidden for external viewers
        verified: true,
        joinedAt: expect.any(Date),
        lastActiveAt: undefined, // Hidden for external viewers
        stats: undefined // Hidden for external viewers
      });
    });

    it('should include full creator information for self-access', async () => {
      const selfContext = { ...mockContext, auth: { uid: 'creator-uid', token: {} } };
      
      const result = await getProjectsByCreator(validRequestData, selfContext);
      
      expect(result.creator).toEqual({
        uid: 'creator-uid',
        displayName: 'John Creator',
        profilePicture: 'https://example.com/profile.jpg',
        bio: 'Experienced project creator',
        verified: true,
        joinedAt: expect.any(Date),
        lastActiveAt: expect.any(Date),
        stats: {
          projectsCreated: 3,
          totalFundsRaised: 2500000,
          successfulProjects: 2,
          averageProjectSize: 833333
        }
      });
    });

    it('should show verification status correctly', async () => {
      const unverifiedCreator = {
        ...mockCreator,
        kyc: { status: STATUS.KYC.PENDING }
      };
      
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users' && id === 'creator-uid') return Promise.resolve(unverifiedCreator);
        if (collection === 'users' && id === 'viewer-uid') return Promise.resolve({ ...mockCreator, uid: 'viewer-uid', permissions: [] });
        throw new Error('Unexpected collection/id');
      });
      
      const result = await getProjectsByCreator(validRequestData, mockContext);
      
      expect(result.creator.verified).toBe(false);
    });
  });

  describe('Default Parameters', () => {
    it('should use authenticated user UID when creatorUid is omitted', async () => {
      const selfContext = { ...mockContext, auth: { uid: 'creator-uid', token: {} } };
      const requestWithoutCreatorUid = {
        status: 'all',
        includeStats: true,
        includeContributions: false,
        sortBy: 'updated',
        sortOrder: 'desc',
        page: 1,
        limit: 20
      };
      
      const result = await getProjectsByCreator(requestWithoutCreatorUid, selfContext);
      
      expect(result.success).toBe(true);
      expect(result.creator.uid).toBe('creator-uid');
    });

    it('should apply default values correctly', async () => {
      const minimalRequestData = { creatorUid: 'creator-uid' };
      
      const result = await getProjectsByCreator(minimalRequestData, mockContext);
      
      expect(result.pagination.currentPage).toBe(1);
      expect(result.pagination.itemsPerPage).toBe(20);
      expect(result.filters.status).toBe('all');
    });

    it('should require creatorUid for unauthenticated requests', async () => {
      const unauthenticatedContext = { ...mockContext, auth: null };
      const requestWithoutCreatorUid = { status: 'all' };

      await expect(
        getProjectsByCreator(requestWithoutCreatorUid, unauthenticatedContext)
      ).rejects.toThrow('Creator UID is required');
    });
  });

  describe('Performance Optimization', () => {
    it('should limit Firestore queries appropriately', async () => {
      const result = await getProjectsByCreator(validRequestData, mockContext);
      
      expect(mockFirestoreHelper.queryDocuments).toHaveBeenCalledWith(
        'projects',
        expect.any(Array),
        expect.objectContaining({
          limit: 1000 // High limit for client-side pagination
        })
      );
    });

    it('should handle large datasets gracefully', async () => {
      const largeProjectsList = Array(100).fill(mockProjects[0]).map((p, i) => ({
        ...p,
        uid: `project-${i}`,
        title: `Project ${i}`
      }));
      
      mockFirestoreHelper.queryDocuments.mockResolvedValue(largeProjectsList);
      
      const result = await getProjectsByCreator(validRequestData, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.projects).toHaveLength(20); // Limited by page size
      expect(result.pagination.totalItems).toBe(100);
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent creator', async () => {
      mockFirestoreHelper.getDocument.mockRejectedValue(new Error('User not found'));

      await expect(
        getProjectsByCreator(validRequestData, mockContext)
      ).rejects.toThrow();
    });

    it('should handle Firestore query errors', async () => {
      mockFirestoreHelper.queryDocuments.mockRejectedValue(new Error('Query failed'));

      await expect(
        getProjectsByCreator(validRequestData, mockContext)
      ).rejects.toThrow();
    });

    it('should handle stats enrichment errors gracefully', async () => {
      mockFirestoreHelper.queryDocuments.mockImplementation((collection, filters, options) => {
        if (collection === 'projects') return Promise.resolve(mockProjects);
        if (collection.includes('contributions')) return Promise.reject(new Error('Contributions query failed'));
        return Promise.resolve([]);
      });
      
      const result = await getProjectsByCreator(validRequestData, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.projects).toHaveLength(3); // Should still return projects without enrichment
    });
  });

  describe('Response Structure', () => {
    it('should return complete response structure', async () => {
      const result = await getProjectsByCreator(validRequestData, mockContext);
      
      expect(result).toEqual({
        projects: expect.arrayContaining([
          expect.objectContaining({
            uid: expect.any(String),
            title: expect.any(String),
            status: expect.any(String)
          })
        ]),
        creator: expect.objectContaining({
          uid: 'creator-uid',
          displayName: 'John Creator',
          verified: true
        }),
        aggregateStats: expect.objectContaining({
          totalProjects: expect.any(Number),
          activeProjects: expect.any(Number),
          completedProjects: expect.any(Number)
        }),
        pagination: expect.objectContaining({
          currentPage: 1,
          totalPages: expect.any(Number),
          totalItems: expect.any(Number),
          hasNextPage: expect.any(Boolean),
          hasPreviousPage: expect.any(Boolean)
        }),
        filters: expect.objectContaining({
          status: 'all',
          canViewPrivate: expect.any(Boolean)
        }),
        success: true
      });
    });

    it('should handle empty project list', async () => {
      mockFirestoreHelper.queryDocuments.mockResolvedValue([]);
      
      const result = await getProjectsByCreator(validRequestData, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.projects).toHaveLength(0);
      expect(result.aggregateStats.totalProjects).toBe(0);
      expect(result.pagination.totalItems).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle projects with missing optional fields', async () => {
      const minimalProject = {
        uid: 'minimal-project',
        creatorUid: 'creator-uid',
        title: 'Minimal Project',
        status: STATUS.PROJECT.DRAFT,
        funding: { goal: 100000, raised: 0, percentage: 0 },
        milestones: [],
        stats: {}
      } as ProjectDocument;
      
      mockFirestoreHelper.queryDocuments.mockResolvedValue([minimalProject]);
      
      const result = await getProjectsByCreator(validRequestData, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.projects[0].title).toBe('Minimal Project');
      expect(result.aggregateStats.totalMilestones).toBe(0);
    });

    it('should handle very high page numbers', async () => {
      const highPageRequestData = { ...validRequestData, page: 999 };
      
      const result = await getProjectsByCreator(highPageRequestData, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.projects).toHaveLength(0);
      expect(result.pagination.currentPage).toBe(999);
      expect(result.pagination.hasNextPage).toBe(false);
    });

    it('should handle zero contributions gracefully', async () => {
      mockFirestoreHelper.queryDocuments.mockImplementation((collection, filters, options) => {
        if (collection === 'projects') return Promise.resolve(mockProjects);
        if (collection.includes('contributions')) return Promise.resolve([]);
        return Promise.resolve([]);
      });
      
      const result = await getProjectsByCreator(validRequestData, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.projects[0].enrichedStats.uniqueContributorsCount).toBe(0);
      expect(result.projects[0].enrichedStats.averageContribution).toBe(0);
    });
  });

  describe('Validation', () => {
    it('should validate request parameters', async () => {
      const invalidRequestData = {
        creatorUid: 'creator-uid',
        status: 'invalid-status', // Invalid status
        page: 0, // Invalid page
        limit: 100 // Too high limit
      };

      await expect(
        getProjectsByCreator(invalidRequestData, mockContext)
      ).rejects.toThrow();
    });

    it('should validate page and limit bounds', async () => {
      const invalidPaginationData = {
        creatorUid: 'creator-uid',
        page: -1,
        limit: 51 // Exceeds max limit
      };

      await expect(
        getProjectsByCreator(invalidPaginationData, mockContext)
      ).rejects.toThrow();
    });

    it('should validate sort parameters', async () => {
      const invalidSortData = {
        creatorUid: 'creator-uid',
        sortBy: 'invalid-field',
        sortOrder: 'invalid-order'
      };

      await expect(
        getProjectsByCreator(invalidSortData, mockContext)
      ).rejects.toThrow();
    });
  });
});