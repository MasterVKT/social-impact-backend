/**
 * Tests for Create Project Firebase Function
 * Social Finance Impact Platform
 */

import { CallableContext } from 'firebase-functions/v1/https';
import { createProject } from '../createProject';
import { firestoreHelper } from '../../utils/firestore';
import { authHelper } from '../../utils/auth';
import { ProjectsAPI } from '../../types/api';
import { UserDocument } from '../../types/firestore';
import { STATUS, USER_PERMISSIONS, PROJECT_CONFIG, USER_TYPES } from '../../utils/constants';

// Mocks
jest.mock('../../utils/firestore');
jest.mock('../../utils/auth');
jest.mock('../../utils/logger');

const mockFirestoreHelper = jest.mocked(firestoreHelper);
const mockAuthHelper = jest.mocked(authHelper);

describe('createProject Function', () => {
  let mockContext: CallableContext;
  let validProjectData: ProjectsAPI.CreateProjectRequest;
  let mockUser: UserDocument;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockContext = {
      auth: {
        uid: 'creator-uid',
        token: {}
      },
      rawRequest: {
        ip: '192.168.1.1',
        headers: {
          'user-agent': 'test-agent'
        }
      }
    } as any;

    validProjectData = {
      title: 'Clean Ocean Initiative',
      description: 'A comprehensive project to reduce plastic pollution in coastal areas through community engagement and innovative cleanup technologies.',
      shortDescription: 'Reducing plastic pollution through community action and technology innovation.',
      category: 'environment',
      tags: ['ocean', 'plastic', 'cleanup', 'community'],
      
      impactGoals: {
        primary: 'Remove 10,000 kg of plastic waste from coastal areas within 12 months',
        secondary: ['Engage 500 volunteers', 'Install 20 cleanup stations'],
        metrics: [
          {
            name: 'Plastic Removed',
            target: 10000,
            unit: 'kg',
            description: 'Total plastic waste collected and properly disposed'
          },
          {
            name: 'Volunteers Engaged',
            target: 500,
            unit: 'people',
            description: 'Community members actively participating'
          }
        ]
      },

      funding: {
        goal: 2500000, // 25,000 EUR in cents
        currency: 'EUR',
        deadline: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
        minContribution: 1000, // 10 EUR in cents
      },

      milestones: [
        {
          title: 'Setup Phase',
          description: 'Establish infrastructure and recruit initial team',
          targetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          fundingPercentage: 30,
          deliverables: ['Team recruitment', 'Equipment procurement', 'Site preparation']
        },
        {
          title: 'Implementation Phase',
          description: 'Begin active cleanup operations',
          targetDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
          fundingPercentage: 50,
          deliverables: ['Cleanup operations', 'Community engagement', 'Progress monitoring']
        },
        {
          title: 'Completion Phase',
          description: 'Finalize project and measure impact',
          targetDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
          fundingPercentage: 20,
          deliverables: ['Final cleanup', 'Impact assessment', 'Community celebration']
        }
      ],

      media: {
        coverImage: 'https://example.com/cover.jpg',
        gallery: ['https://example.com/gallery1.jpg'],
        video: 'https://example.com/intro-video.mp4',
        documents: [
          {
            name: 'Project Plan',
            url: 'https://example.com/plan.pdf',
            type: 'pdf',
            size: 1024000
          }
        ]
      },

      location: {
        country: 'FR',
        region: 'Provence-Alpes-Côte d\'Azur',
        city: 'Marseille',
        coordinates: {
          lat: 43.2965,
          lng: 5.3698
        }
      },

      team: [
        {
          name: 'Jean Dupont',
          role: 'Project Leader',
          bio: 'Environmental scientist with 10 years experience',
          avatar: 'https://example.com/jean.jpg',
          linkedin: 'https://linkedin.com/in/jean-dupont'
        }
      ],

      settings: {
        allowPublicComments: true,
        requireIdentityVerification: false,
        autoApproveContributions: true,
        notifyOnMilestone: true,
        visibility: 'public'
      }
    };

    mockUser = {
      uid: 'creator-uid',
      email: 'creator@example.com',
      firstName: 'Jean',
      lastName: 'Dupont',
      displayName: 'Jean Dupont',
      userType: 'creator',
      profileComplete: true,
      accountStatus: STATUS.USER.ACTIVE,
      permissions: USER_TYPES.CREATOR.permissions,
      kyc: {
        status: STATUS.KYC.APPROVED,
        level: 1,
        provider: 'sumsub'
      },
      stats: {
        projectsCreated: 0,
        totalFundsRaised: 0,
        successfulProjects: 0
      }
    } as UserDocument;

    // Mocks par défaut
    mockFirestoreHelper.getDocument.mockResolvedValue(mockUser);
    mockFirestoreHelper.countDocuments.mockResolvedValue(0);
    mockFirestoreHelper.getDocumentByField.mockResolvedValue(null);
    mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({ exists: false }),
        set: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      };
      await callback(mockTransaction as any);
      return 'generated-project-id';
    });
    mockFirestoreHelper.getDocumentRef.mockReturnValue({} as any);
    mockFirestoreHelper.addDocument.mockResolvedValue();
    mockFirestoreHelper.incrementDocument.mockResolvedValue();
  });

  describe('Authentication Validation', () => {
    it('should reject unauthenticated requests', async () => {
      const unauthenticatedContext = { ...mockContext, auth: null };

      await expect(
        createProject(validProjectData, unauthenticatedContext)
      ).rejects.toThrow('Authentication required');
    });
  });

  describe('User Validation', () => {
    it('should reject users with incomplete profiles', async () => {
      const incompleteUser = { ...mockUser, profileComplete: false };
      mockFirestoreHelper.getDocument.mockResolvedValue(incompleteUser);

      await expect(
        createProject(validProjectData, mockContext)
      ).rejects.toThrow('Profile must be completed first');
    });

    it('should reject inactive users', async () => {
      const inactiveUser = { ...mockUser, accountStatus: STATUS.USER.SUSPENDED };
      mockFirestoreHelper.getDocument.mockResolvedValue(inactiveUser);

      await expect(
        createProject(validProjectData, mockContext)
      ).rejects.toThrow('Account is not active');
    });

    it('should reject users without create project permissions', async () => {
      const userWithoutPermissions = { 
        ...mockUser, 
        permissions: [] 
      };
      mockFirestoreHelper.getDocument.mockResolvedValue(userWithoutPermissions);

      await expect(
        createProject(validProjectData, mockContext)
      ).rejects.toThrow('User does not have permission to create projects');
    });

    it('should reject users without KYC approval', async () => {
      const unverifiedUser = { 
        ...mockUser, 
        kyc: { ...mockUser.kyc, status: STATUS.KYC.PENDING }
      };
      mockFirestoreHelper.getDocument.mockResolvedValue(unverifiedUser);

      await expect(
        createProject(validProjectData, mockContext)
      ).rejects.toThrow('KYC verification required to create projects');
    });

    it('should reject users who have reached max active projects', async () => {
      mockFirestoreHelper.countDocuments.mockResolvedValue(PROJECT_CONFIG.MAX_ACTIVE_PROJECTS_BASIC);

      await expect(
        createProject(validProjectData, mockContext)
      ).rejects.toThrow('Maximum number of active projects reached');
    });
  });

  describe('Data Validation', () => {
    it('should validate milestone funding percentages sum to 100%', async () => {
      const invalidData = {
        ...validProjectData,
        milestones: [
          { ...validProjectData.milestones[0], fundingPercentage: 50 },
          { ...validProjectData.milestones[1], fundingPercentage: 30 },
          { ...validProjectData.milestones[2], fundingPercentage: 10 } // Total = 90%
        ]
      };

      await expect(
        createProject(invalidData, mockContext)
      ).rejects.toThrow('Milestone funding percentages must sum to 100%');
    });

    it('should validate milestone dates are before funding deadline', async () => {
      const futureDeadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const invalidData = {
        ...validProjectData,
        funding: { ...validProjectData.funding, deadline: futureDeadline },
        milestones: [
          { 
            ...validProjectData.milestones[0], 
            targetDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000) // After deadline
          }
        ]
      };

      await expect(
        createProject(invalidData, mockContext)
      ).rejects.toThrow('target date cannot be after funding deadline');
    });

    it('should validate funding goal bounds', async () => {
      const invalidLowGoal = {
        ...validProjectData,
        funding: { ...validProjectData.funding, goal: 100 } // Too low
      };

      await expect(
        createProject(invalidLowGoal, mockContext)
      ).rejects.toThrow();

      const invalidHighGoal = {
        ...validProjectData,
        funding: { ...validProjectData.funding, goal: PROJECT_CONFIG.MAX_FUNDING_GOAL + 1 }
      };

      await expect(
        createProject(invalidHighGoal, mockContext)
      ).rejects.toThrow();
    });

    it('should validate impact metrics have unique names', async () => {
      const duplicateMetrics = {
        ...validProjectData,
        impactGoals: {
          ...validProjectData.impactGoals,
          metrics: [
            { name: 'Plastic Removed', target: 1000, unit: 'kg' },
            { name: 'Plastic Removed', target: 2000, unit: 'kg' } // Duplicate
          ]
        }
      };

      await expect(
        createProject(duplicateMetrics, mockContext)
      ).rejects.toThrow('Impact metric names must be unique');
    });

    it('should require at least one team member', async () => {
      const noTeamData = {
        ...validProjectData,
        team: []
      };

      await expect(
        createProject(noTeamData, mockContext)
      ).rejects.toThrow('At least one team member is required');
    });
  });

  describe('Project Document Creation', () => {
    it('should create correct project document structure', async () => {
      const result = await createProject(validProjectData, mockContext);

      expect(mockFirestoreHelper.runTransaction).toHaveBeenCalled();
      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({ exists: false }),
        set: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.set).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          title: 'Clean Ocean Initiative',
          description: validProjectData.description,
          category: 'environment',
          creatorUid: 'creator-uid',
          status: STATUS.PROJECT.DRAFT,
          profileComplete: undefined, // Should not inherit user fields
          funding: expect.objectContaining({
            goal: 2500000,
            raised: 0,
            currency: 'EUR',
            contributorsCount: 0,
            percentage: 0
          }),
          milestones: expect.arrayContaining([
            expect.objectContaining({
              title: 'Setup Phase',
              fundingPercentage: 30,
              status: STATUS.MILESTONE.PENDING
            })
          ])
        })
      );
    });

    it('should generate unique project ID and slug', async () => {
      await createProject(validProjectData, mockContext);

      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({ exists: false }),
        set: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.set).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          uid: expect.stringMatching(/^proj_/),
          slug: expect.stringContaining('clean-ocean-initiative')
        })
      );
    });

    it('should calculate correct platform fees', async () => {
      await createProject(validProjectData, mockContext);

      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({ exists: false }),
        set: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      const expectedPlatformFees = Math.round(2500000 * PROJECT_CONFIG.PLATFORM_FEE_RATE);
      const expectedNetGoal = 2500000 - expectedPlatformFees;

      expect(mockTransaction.set).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          funding: expect.objectContaining({
            platformFees: expect.objectContaining({
              estimated: expectedPlatformFees,
              rate: PROJECT_CONFIG.PLATFORM_FEE_RATE
            }),
            netGoal: expectedNetGoal
          })
        })
      );
    });

    it('should set correct audit requirements', async () => {
      // Test avec un montant nécessitant un audit
      const highValueProject = {
        ...validProjectData,
        funding: { ...validProjectData.funding, goal: PROJECT_CONFIG.AUDIT_THRESHOLD_AMOUNT + 1000 }
      };

      await createProject(highValueProject, mockContext);

      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({ exists: false }),
        set: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.set).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          auditRequired: true,
          auditStatus: STATUS.AUDIT.PENDING
        })
      );
    });
  });

  describe('Risk Level Calculation', () => {
    it('should calculate low risk for simple projects', async () => {
      const simpleProject = {
        ...validProjectData,
        funding: { ...validProjectData.funding, goal: 500000 }, // 5,000 EUR
        milestones: [validProjectData.milestones[0]], // 1 milestone
        team: [validProjectData.team[0]] // 1 team member
      };

      await createProject(simpleProject, mockContext);

      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({ exists: false }),
        set: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.set).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          riskLevel: 'low'
        })
      );
    });

    it('should calculate high risk for complex projects', async () => {
      const complexProject = {
        ...validProjectData,
        funding: { ...validProjectData.funding, goal: 10000000 }, // 100,000 EUR
        milestones: Array(8).fill(validProjectData.milestones[0]), // 8 milestones
        impactGoals: {
          ...validProjectData.impactGoals,
          metrics: Array(8).fill(validProjectData.impactGoals.metrics[0]) // 8 metrics
        }
      };

      await createProject(complexProject, mockContext);

      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({ exists: false }),
        set: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.set).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          riskLevel: 'high'
        })
      );
    });
  });

  describe('Slug Generation', () => {
    it('should handle duplicate slugs', async () => {
      mockFirestoreHelper.getDocumentByField
        .mockResolvedValueOnce({ exists: true }) // First attempt exists
        .mockResolvedValueOnce(null); // Second attempt is unique

      await createProject(validProjectData, mockContext);

      expect(mockFirestoreHelper.getDocumentByField).toHaveBeenCalledTimes(2);
      expect(mockFirestoreHelper.getDocumentByField).toHaveBeenNthCalledWith(
        1, 'projects', 'slug', 'clean-ocean-initiative'
      );
      expect(mockFirestoreHelper.getDocumentByField).toHaveBeenNthCalledWith(
        2, 'projects', 'slug', 'clean-ocean-initiative-1'
      );
    });

    it('should create fallback slug with timestamp after max retries', async () => {
      // Mock que tous les slugs jusqu'à 10 existent
      mockFirestoreHelper.getDocumentByField.mockResolvedValue({ exists: true });

      await createProject(validProjectData, mockContext);

      expect(mockFirestoreHelper.getDocumentByField).toHaveBeenCalledTimes(10);
    });
  });

  describe('Team Member Processing', () => {
    it('should set first team member as lead', async () => {
      await createProject(validProjectData, mockContext);

      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({ exists: false }),
        set: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.set).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          team: expect.arrayContaining([
            expect.objectContaining({
              name: 'Jean Dupont',
              role: 'Project Leader',
              isLead: true
            })
          ])
        })
      );
    });

    it('should generate unique IDs for team members', async () => {
      const multiTeamProject = {
        ...validProjectData,
        team: [
          { name: 'Jean Dupont', role: 'Leader' },
          { name: 'Marie Martin', role: 'Coordinator' },
          { name: 'Pierre Durand', role: 'Specialist' }
        ]
      };

      await createProject(multiTeamProject, mockContext);

      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({ exists: false }),
        set: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.set).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          team: expect.arrayContaining([
            expect.objectContaining({ isLead: true }), // First member
            expect.objectContaining({ isLead: false }), // Second member
            expect.objectContaining({ isLead: false }) // Third member
          ])
        })
      );
    });
  });

  describe('Milestone Processing', () => {
    it('should generate unique IDs for milestones', async () => {
      await createProject(validProjectData, mockContext);

      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({ exists: false }),
        set: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.set).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          milestones: expect.arrayContaining([
            expect.objectContaining({
              id: expect.stringMatching(/^milestone_/),
              order: 1,
              status: STATUS.MILESTONE.PENDING
            }),
            expect.objectContaining({
              id: expect.stringMatching(/^milestone_/),
              order: 2,
              status: STATUS.MILESTONE.PENDING
            })
          ])
        })
      );
    });

    it('should set audit requirements for important milestones', async () => {
      const highPercentageMilestone = {
        ...validProjectData,
        milestones: [{
          title: 'Major Milestone',
          description: 'Critical project phase',
          targetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          fundingPercentage: 100,
          deliverables: ['Major deliverable']
        }]
      };

      await createProject(highPercentageMilestone, mockContext);

      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({ exists: false }),
        set: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.set).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          milestones: expect.arrayContaining([
            expect.objectContaining({
              auditRequired: true
            })
          ])
        })
      );
    });
  });

  describe('Creator Stats Update', () => {
    it('should update creator project count', async () => {
      await createProject(validProjectData, mockContext);

      expect(mockFirestoreHelper.runTransaction).toHaveBeenCalledTimes(2); // Project creation + stats update
      
      // Vérifier que les stats du créateur sont mises à jour
      const statsUpdateCallback = mockFirestoreHelper.runTransaction.mock.calls[1][0];
      const mockStatsTransaction = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ stats: { projectsCreated: 0 } })
        }),
        update: jest.fn(),
        set: jest.fn(),
        delete: jest.fn()
      };

      await statsUpdateCallback(mockStatsTransaction);

      expect(mockStatsTransaction.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          'stats.projectsCreated': 1,
          'stats.lastProjectAt': expect.any(Date)
        })
      );
    });
  });

  describe('Response Structure', () => {
    it('should return correct response structure', async () => {
      const result = await createProject(validProjectData, mockContext);

      expect(result).toEqual({
        projectId: expect.stringMatching(/^proj_/),
        slug: expect.stringContaining('clean-ocean-initiative'),
        status: STATUS.PROJECT.DRAFT,
        auditRequired: false, // Low funding amount
        estimatedDuration: expect.any(Number),
        riskLevel: expect.stringMatching(/^(low|medium|high)$/),
        nextSteps: expect.arrayContaining([
          'content_moderation_review'
        ])
      });
    });

    it('should include audit in next steps for high-value projects', async () => {
      const highValueProject = {
        ...validProjectData,
        funding: { ...validProjectData.funding, goal: PROJECT_CONFIG.AUDIT_THRESHOLD_AMOUNT + 1000 }
      };

      const result = await createProject(highValueProject, mockContext);

      expect(result.auditRequired).toBe(true);
      expect(result.nextSteps).toContain('audit_assignment');
    });
  });

  describe('Compliance Checks', () => {
    it('should set correct compliance status for regular projects', async () => {
      await createProject(validProjectData, mockContext);

      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({ exists: false }),
        set: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.set).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          complianceChecks: {
            contentModeration: STATUS.MODERATION.PENDING,
            legalReview: STATUS.MODERATION.APPROVED, // Auto-approved for low amounts
            financialReview: STATUS.MODERATION.PENDING
          }
        })
      );
    });

    it('should require legal review for high-value projects', async () => {
      const highValueProject = {
        ...validProjectData,
        funding: { ...validProjectData.funding, goal: PROJECT_CONFIG.LEGAL_REVIEW_THRESHOLD + 1000 }
      };

      await createProject(highValueProject, mockContext);

      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({ exists: false }),
        set: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.set).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          complianceChecks: expect.objectContaining({
            legalReview: STATUS.MODERATION.PENDING
          })
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle Firestore transaction errors', async () => {
      mockFirestoreHelper.runTransaction.mockRejectedValue(new Error('Transaction failed'));

      await expect(
        createProject(validProjectData, mockContext)
      ).rejects.toThrow();
    });

    it('should handle duplicate project ID collision', async () => {
      // Premier appel - projet existe déjà
      const mockTransactionWithCollision = {
        get: jest.fn().mockResolvedValue({ exists: true }),
        set: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      };

      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback(mockTransactionWithCollision as any);
      });

      await expect(
        createProject(validProjectData, mockContext)
      ).rejects.toThrow('Project ID already exists');
    });
  });

  describe('Context Metadata', () => {
    it('should capture IP address and user agent', async () => {
      await createProject(validProjectData, mockContext);

      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({ exists: false }),
        set: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.set).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          ipAddress: '192.168.1.1',
          userAgent: 'test-agent',
          lastModifiedBy: 'creator-uid'
        })
      );
    });
  });

  describe('Activity Feed Creation', () => {
    it('should create activity feed entry', async () => {
      await createProject(validProjectData, mockContext);

      expect(mockFirestoreHelper.addDocument).toHaveBeenCalledWith(
        'activity_feed',
        expect.objectContaining({
          type: 'project_published',
          projectId: expect.stringMatching(/^proj_/),
          projectTitle: 'Clean Ocean Initiative',
          creatorUid: 'creator-uid',
          category: 'environment'
        })
      );
    });
  });

  describe('Platform Stats Update', () => {
    it('should update platform statistics', async () => {
      await createProject(validProjectData, mockContext);

      expect(mockFirestoreHelper.incrementDocument).toHaveBeenCalledWith(
        'platform_stats',
        'global',
        expect.objectContaining({
          'categories.environment.projectsCount': 1,
          'categories.environment.totalFunding': 2500000,
          'projects.total': 1
        })
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle minimal required data', async () => {
      const minimalProject = {
        title: 'Min Project',
        description: 'Minimal project description with required length',
        shortDescription: 'Short description',
        category: 'community',
        tags: ['minimal'],
        impactGoals: {
          primary: 'Primary impact goal',
          metrics: [{
            name: 'Basic Metric',
            target: 100,
            unit: 'units'
          }]
        },
        funding: {
          goal: PROJECT_CONFIG.MIN_FUNDING_GOAL,
          currency: 'EUR',
          deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        },
        milestones: [{
          title: 'Only Milestone',
          description: 'Single milestone description',
          targetDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
          fundingPercentage: 100,
          deliverables: ['Single deliverable']
        }],
        media: {
          coverImage: 'https://example.com/cover.jpg'
        },
        location: {
          country: 'FR'
        },
        team: [{
          name: 'Solo Creator',
          role: 'Everything'
        }]
      };

      const result = await createProject(minimalProject, mockContext);

      expect(result.projectId).toBeDefined();
      expect(result.success).toBe(true);
    });

    it('should handle maximum allowed data', async () => {
      const maximalProject = {
        ...validProjectData,
        tags: Array(10).fill('tag').map((t, i) => `${t}${i}`),
        impactGoals: {
          ...validProjectData.impactGoals,
          secondary: Array(5).fill('Secondary goal'),
          metrics: Array(10).fill(validProjectData.impactGoals.metrics[0])
        },
        milestones: Array(10).fill(validProjectData.milestones[0]).map((m, i) => ({
          ...m,
          title: `Milestone ${i + 1}`,
          fundingPercentage: 10
        })),
        team: Array(10).fill(validProjectData.team[0]).map((t, i) => ({
          ...t,
          name: `Team Member ${i + 1}`
        })),
        media: {
          ...validProjectData.media,
          gallery: Array(20).fill('https://example.com/image.jpg'),
          documents: Array(10).fill(validProjectData.media.documents![0])
        }
      };

      const result = await createProject(maximalProject, mockContext);

      expect(result.projectId).toBeDefined();
      expect(result.success).toBe(true);
    });
  });
});