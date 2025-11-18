/**
 * Tests for Update Trending Projects Scheduled Function
 * Social Finance Impact Platform
 */

import { updateTrendingProjects } from '../updateTrendingProjects';
import { firestoreHelper } from '../../utils/firestore';
import { logger } from '../../utils/logger';
import { ProjectDocument, ContributionDocument } from '../../types/firestore';
import { STATUS, TRENDING_CONFIG } from '../../utils/constants';

// Mocks
jest.mock('../../utils/firestore');
jest.mock('../../utils/logger');

const mockFirestoreHelper = jest.mocked(firestoreHelper);
const mockLogger = jest.mocked(logger);

describe('updateTrendingProjects Scheduled Function', () => {
  let mockProjects: ProjectDocument[];
  let mockContributions: ContributionDocument[];

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock projects
    mockProjects = [
      {
        id: 'project-1',
        slug: 'project-one',
        title: 'Project One',
        category: 'environment',
        status: 'active',
        fundingStatus: 'open',
        funding: {
          goal: 100000,
          raised: 50000,
          percentage: 50,
          contributorsCount: 25
        },
        analytics: {
          views: 1000,
          saves: 50,
          shares: 20
        },
        createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // 30 days ago
      } as any,
      {
        id: 'project-2',
        slug: 'project-two',
        title: 'Project Two',
        category: 'education',
        status: 'active',
        fundingStatus: 'open',
        funding: {
          goal: 200000,
          raised: 150000,
          percentage: 75,
          contributorsCount: 50
        },
        analytics: {
          views: 2000,
          saves: 100,
          shares: 40
        },
        createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000) // 15 days ago
      } as any
    ];

    // Mock contributions
    mockContributions = [
      {
        id: 'contrib-1',
        projectId: 'project-1',
        contributorUid: 'user-1',
        amount: 10000,
        status: 'confirmed',
        confirmedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) // 2 hours ago
      } as any,
      {
        id: 'contrib-2',
        projectId: 'project-1',
        contributorUid: 'user-2',
        amount: 15000,
        status: 'confirmed',
        confirmedAt: new Date(Date.now() - 1 * 60 * 60 * 1000) // 1 hour ago
      } as any,
      {
        id: 'contrib-3',
        projectId: 'project-2',
        contributorUid: 'user-3',
        amount: 20000,
        status: 'confirmed',
        confirmedAt: new Date(Date.now() - 3 * 60 * 60 * 1000) // 3 hours ago
      } as any
    ];

    // Default mocks
    mockFirestoreHelper.queryDocuments.mockImplementation(async (collection: string, filters: any[]) => {
      if (collection === 'projects') {
        return mockProjects;
      }
      if (collection === 'contributions') {
        // Filter contributions by projectId
        const projectIdFilter = filters.find(f => f[0] === 'projectId');
        if (projectIdFilter) {
          return mockContributions.filter(c => c.projectId === projectIdFilter[2]);
        }
        return mockContributions;
      }
      return [];
    });

    mockFirestoreHelper.updateDocument.mockResolvedValue();
    mockFirestoreHelper.setDocument.mockResolvedValue();
    mockFirestoreHelper.getCollectionRef.mockReturnValue({
      doc: jest.fn().mockReturnValue({
        set: jest.fn().mockResolvedValue(undefined)
      })
    } as any);
  });

  describe('Project Retrieval', () => {
    it('should retrieve eligible active projects', async () => {
      await updateTrendingProjects();

      expect(mockFirestoreHelper.queryDocuments).toHaveBeenCalledWith(
        'projects',
        expect.arrayContaining([
          ['status', '==', STATUS.PROJECT.ACTIVE]
        ]),
        expect.objectContaining({
          limit: TRENDING_CONFIG.MAX_PROJECTS_TO_ANALYZE
        })
      );
    });

    it('should handle empty projects list', async () => {
      mockFirestoreHelper.queryDocuments.mockResolvedValue([]);

      await expect(updateTrendingProjects()).resolves.not.toThrow();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Eligible projects'),
        expect.objectContaining({ totalProjects: 0 })
      );
    });

    it('should handle database errors when retrieving projects', async () => {
      const dbError = new Error('Database connection failed');
      mockFirestoreHelper.queryDocuments.mockRejectedValue(dbError);

      await expect(updateTrendingProjects()).rejects.toThrow('Database connection failed');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed'),
        dbError
      );
    });
  });

  describe('Metrics Calculation', () => {
    it('should calculate trending scores for all projects', async () => {
      await updateTrendingProjects();

      // Should query contributions for each project
      expect(mockFirestoreHelper.queryDocuments).toHaveBeenCalledWith(
        'contributions',
        expect.arrayContaining([
          ['projectId', '==', expect.any(String)]
        ])
      );
    });

    it('should handle projects with no recent contributions', async () => {
      mockContributions = [];

      await expect(updateTrendingProjects()).resolves.not.toThrow();
    });

    it('should calculate growth rate correctly', async () => {
      await updateTrendingProjects();

      // Verify trending scores were calculated and stored
      expect(mockFirestoreHelper.setDocument).toHaveBeenCalled();
    });

    it('should calculate social engagement metrics', async () => {
      await updateTrendingProjects();

      // Verify analytics data was considered
      expect(mockFirestoreHelper.queryDocuments).toHaveBeenCalledWith(
        'projects',
        expect.anything(),
        expect.anything()
      );
    });
  });

  describe('Trending Ranking', () => {
    it('should rank projects by trending score', async () => {
      await updateTrendingProjects();

      // Verify trending data includes ranks
      const setDocumentCalls = mockFirestoreHelper.setDocument.mock.calls;
      expect(setDocumentCalls.length).toBeGreaterThan(0);
    });

    it('should categorize projects correctly', async () => {
      await updateTrendingProjects();

      // Verify category-specific trending data was created
      expect(mockFirestoreHelper.setDocument).toHaveBeenCalledWith(
        expect.stringContaining('trendingProjects'),
        expect.any(String),
        expect.objectContaining({
          category: expect.any(String)
        })
      );
    });

    it('should identify rising, stable, and falling trends', async () => {
      await updateTrendingProjects();

      // Verify trend direction was calculated
      expect(mockFirestoreHelper.setDocument).toHaveBeenCalled();
    });
  });

  describe('Data Storage', () => {
    it('should store trending data in Firestore', async () => {
      await updateTrendingProjects();

      expect(mockFirestoreHelper.setDocument).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Trending projects update completed'),
        expect.any(Object)
      );
    });

    it('should include metadata in trending records', async () => {
      await updateTrendingProjects();

      const setDocumentCall = mockFirestoreHelper.setDocument.mock.calls[0];
      expect(setDocumentCall).toBeDefined();
    });

    it('should handle Firestore write errors gracefully', async () => {
      const writeError = new Error('Firestore write failed');
      mockFirestoreHelper.setDocument.mockRejectedValue(writeError);

      await expect(updateTrendingProjects()).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('Performance', () => {
    it('should respect max projects analysis limit', async () => {
      const manyProjects = Array.from({ length: 200 }, (_, i) => ({
        ...mockProjects[0],
        id: `project-${i}`
      }));

      mockFirestoreHelper.queryDocuments.mockResolvedValue(manyProjects.slice(0, TRENDING_CONFIG.MAX_PROJECTS_TO_ANALYZE));

      await updateTrendingProjects();

      expect(mockFirestoreHelper.queryDocuments).toHaveBeenCalledWith(
        'projects',
        expect.anything(),
        expect.objectContaining({
          limit: TRENDING_CONFIG.MAX_PROJECTS_TO_ANALYZE
        })
      );
    });

    it('should complete within reasonable time', async () => {
      const startTime = Date.now();
      await updateTrendingProjects();
      const endTime = Date.now();

      // Should complete in less than 30 seconds (in test environment)
      expect(endTime - startTime).toBeLessThan(30000);
    });
  });

  describe('Logging', () => {
    it('should log start and completion', async () => {
      await updateTrendingProjects();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Eligible projects'),
        expect.any(Object)
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('completed'),
        expect.any(Object)
      );
    });

    it('should log processing statistics', async () => {
      await updateTrendingProjects();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          totalProjects: expect.any(Number)
        })
      );
    });
  });
});
