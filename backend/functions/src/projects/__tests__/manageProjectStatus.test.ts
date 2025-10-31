/**
 * Tests for Manage Project Status Firebase Function
 * Social Finance Impact Platform
 */

import { CallableContext } from 'firebase-functions/v1/https';
import { manageProjectStatus } from '../manageProjectStatus';
import { firestoreHelper } from '../../utils/firestore';
import { ProjectsAPI } from '../../types/api';
import { ProjectDocument, UserDocument } from '../../types/firestore';
import { STATUS, USER_PERMISSIONS, PROJECT_CONFIG } from '../../utils/constants';

// Mocks
jest.mock('../../utils/firestore');
jest.mock('../../utils/auth');
jest.mock('../../integrations/sendgrid/emailService');
jest.mock('../../integrations/stripe/stripeService');
jest.mock('../../utils/logger');

const mockFirestoreHelper = jest.mocked(firestoreHelper);

describe('manageProjectStatus Function', () => {
  let mockContext: CallableContext;
  let mockProject: ProjectDocument;
  let mockCreatorUser: UserDocument;
  let mockAdminUser: UserDocument;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockContext = {
      auth: { uid: 'admin-uid', token: {} },
      rawRequest: { ip: '192.168.1.1', headers: { 'user-agent': 'test-agent' } }
    } as any;

    mockProject = {
      uid: 'test-project-id',
      creatorUid: 'creator-uid',
      title: 'Test Project',
      status: STATUS.PROJECT.DRAFT,
      version: 1,
      category: 'environment',
      funding: {
        goal: 1000000,
        raised: 500000,
        deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        contributorsCount: 25
      },
      milestones: [
        { id: 'milestone-1', status: STATUS.MILESTONE.COMPLETED },
        { id: 'milestone-2', status: STATUS.MILESTONE.PENDING }
      ],
      publishedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      creatorDisplayName: 'John Creator'
    } as ProjectDocument;

    mockCreatorUser = {
      uid: 'creator-uid',
      permissions: [USER_PERMISSIONS.CREATE_PROJECT]
    } as UserDocument;

    mockAdminUser = {
      uid: 'admin-uid',
      displayName: 'Admin User',
      permissions: [USER_PERMISSIONS.MODERATE_PROJECTS]
    } as UserDocument;

    mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
      if (collection === 'users' && id === 'creator-uid') return Promise.resolve(mockCreatorUser);
      if (collection === 'users' && id === 'admin-uid') return Promise.resolve(mockAdminUser);
      if (collection === 'projects') return Promise.resolve(mockProject);
      throw new Error('Unexpected collection');
    });

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

    mockFirestoreHelper.getDocumentRef.mockReturnValue({} as any);
    mockFirestoreHelper.addDocument.mockResolvedValue();
    mockFirestoreHelper.incrementDocument.mockResolvedValue();
    mockFirestoreHelper.queryDocuments.mockResolvedValue([]);
  });

  describe('Authentication', () => {
    it('should reject unauthenticated requests', async () => {
      const unauthenticatedContext = { ...mockContext, auth: null };

      await expect(
        manageProjectStatus({ projectId: 'test-project', action: 'approve' }, unauthenticatedContext)
      ).rejects.toThrow('Authentication required');
    });
  });

  describe('Admin-Only Actions', () => {
    it('should allow admins to approve projects', async () => {
      const approveData = {
        projectId: 'test-project-id',
        action: 'approve',
        actionData: {
          moderatorNotes: 'Project meets all requirements',
          notifyCreator: true
        }
      };

      const result = await manageProjectStatus(approveData, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.action).toBe('approve');
      expect(result.newStatus).toBe(STATUS.PROJECT.ACTIVE);
    });

    it('should allow admins to reject projects', async () => {
      const rejectData = {
        projectId: 'test-project-id',
        action: 'reject',
        actionData: {
          reason: 'Does not meet platform standards',
          notifyCreator: true
        }
      };

      const result = await manageProjectStatus(rejectData, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.action).toBe('reject');
      expect(result.newStatus).toBe(STATUS.PROJECT.REJECTED);
    });

    it('should allow admins to suspend projects', async () => {
      const activeProject = { ...mockProject, status: STATUS.PROJECT.ACTIVE };
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users' && id === 'admin-uid') return Promise.resolve(mockAdminUser);
        if (collection === 'projects') return Promise.resolve(activeProject);
        throw new Error('Unexpected collection');
      });

      const suspendData = {
        projectId: 'test-project-id',
        action: 'suspend',
        actionData: {
          reason: 'Policy violation detected',
          notifyCreator: true,
          notifyContributors: true
        }
      };

      const result = await manageProjectStatus(suspendData, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.action).toBe('suspend');
      expect(result.newStatus).toBe(STATUS.PROJECT.SUSPENDED);
    });

    it('should allow admins to reactivate projects', async () => {
      const suspendedProject = { ...mockProject, status: STATUS.PROJECT.SUSPENDED };
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users' && id === 'admin-uid') return Promise.resolve(mockAdminUser);
        if (collection === 'projects') return Promise.resolve(suspendedProject);
        throw new Error('Unexpected collection');
      });

      const reactivateData = {
        projectId: 'test-project-id',
        action: 'reactivate',
        actionData: {
          notifyCreator: true
        }
      };

      const result = await manageProjectStatus(reactivateData, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.action).toBe('reactivate');
      expect(result.newStatus).toBe(STATUS.PROJECT.ACTIVE);
    });

    it('should reject non-admin users for admin-only actions', async () => {
      const creatorContext = { ...mockContext, auth: { uid: 'creator-uid', token: {} } };

      const approveData = {
        projectId: 'test-project-id',
        action: 'approve'
      };

      await expect(
        manageProjectStatus(approveData, creatorContext)
      ).rejects.toThrow('Insufficient permissions for this action');
    });
  });

  describe('Creator Actions', () => {
    it('should allow creators to cancel their projects', async () => {
      const activeProject = { ...mockProject, status: STATUS.PROJECT.ACTIVE };
      const creatorContext = { ...mockContext, auth: { uid: 'creator-uid', token: {} } };

      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users' && id === 'creator-uid') return Promise.resolve(mockCreatorUser);
        if (collection === 'projects') return Promise.resolve(activeProject);
        throw new Error('Unexpected collection');
      });

      const cancelData = {
        projectId: 'test-project-id',
        action: 'cancel',
        actionData: {
          reason: 'Unable to complete project due to unforeseen circumstances'
        }
      };

      const result = await manageProjectStatus(cancelData, creatorContext);
      
      expect(result.success).toBe(true);
      expect(result.action).toBe('cancel');
      expect(result.newStatus).toBe(STATUS.PROJECT.CANCELLED);
      expect(result.requiresFollowUp).toBe(true); // Has funding raised
    });

    it('should allow creators to complete their projects', async () => {
      const activeProject = { ...mockProject, status: STATUS.PROJECT.ACTIVE };
      const creatorContext = { ...mockContext, auth: { uid: 'creator-uid', token: {} } };

      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users' && id === 'creator-uid') return Promise.resolve(mockCreatorUser);
        if (collection === 'projects') return Promise.resolve(activeProject);
        throw new Error('Unexpected collection');
      });

      const completeData = {
        projectId: 'test-project-id',
        action: 'complete'
      };

      const result = await manageProjectStatus(completeData, creatorContext);
      
      expect(result.success).toBe(true);
      expect(result.action).toBe('complete');
      expect(result.newStatus).toBe(STATUS.PROJECT.COMPLETED);
    });

    it('should allow creators to extend deadlines', async () => {
      const activeProject = { ...mockProject, status: STATUS.PROJECT.FUNDING };
      const creatorContext = { ...mockContext, auth: { uid: 'creator-uid', token: {} } };

      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users' && id === 'creator-uid') return Promise.resolve(mockCreatorUser);
        if (collection === 'projects') return Promise.resolve(activeProject);
        throw new Error('Unexpected collection');
      });

      const extendData = {
        projectId: 'test-project-id',
        action: 'extend_deadline',
        actionData: {
          newDeadline: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
        }
      };

      const result = await manageProjectStatus(extendData, creatorContext);
      
      expect(result.success).toBe(true);
      expect(result.action).toBe('extend_deadline');
    });

    it('should allow creators to pause funding', async () => {
      const fundingProject = { ...mockProject, status: STATUS.PROJECT.FUNDING };
      const creatorContext = { ...mockContext, auth: { uid: 'creator-uid', token: {} } };

      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users' && id === 'creator-uid') return Promise.resolve(mockCreatorUser);
        if (collection === 'projects') return Promise.resolve(fundingProject);
        throw new Error('Unexpected collection');
      });

      const pauseData = {
        projectId: 'test-project-id',
        action: 'pause_funding',
        actionData: {
          reason: 'Need to make adjustments'
        }
      };

      const result = await manageProjectStatus(pauseData, creatorContext);
      
      expect(result.success).toBe(true);
      expect(result.action).toBe('pause_funding');
      expect(result.newStatus).toBe(STATUS.PROJECT.PAUSED);
    });

    it('should reject unauthorized users for creator actions', async () => {
      const otherUserContext = { ...mockContext, auth: { uid: 'other-user', token: {} } };
      
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users' && id === 'other-user') return Promise.resolve({ ...mockCreatorUser, uid: 'other-user', permissions: [] });
        if (collection === 'projects') return Promise.resolve(mockProject);
        throw new Error('Unexpected collection');
      });

      const cancelData = {
        projectId: 'test-project-id',
        action: 'cancel'
      };

      await expect(
        manageProjectStatus(cancelData, otherUserContext)
      ).rejects.toThrow('Only the project creator or admins can perform this action');
    });
  });

  describe('Status Transition Validation', () => {
    it('should validate allowed transitions from DRAFT', async () => {
      const draftProject = { ...mockProject, status: STATUS.PROJECT.DRAFT };
      
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockAdminUser);
        if (collection === 'projects') return Promise.resolve(draftProject);
        throw new Error('Unexpected collection');
      });

      // Valid transition
      const approveData = { projectId: 'test-project-id', action: 'approve' };
      const result = await manageProjectStatus(approveData, mockContext);
      expect(result.success).toBe(true);
    });

    it('should reject invalid transitions', async () => {
      const completedProject = { ...mockProject, status: STATUS.PROJECT.COMPLETED };
      
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockAdminUser);
        if (collection === 'projects') return Promise.resolve(completedProject);
        throw new Error('Unexpected collection');
      });

      const invalidActionData = { projectId: 'test-project-id', action: 'approve' };

      await expect(
        manageProjectStatus(invalidActionData, mockContext)
      ).rejects.toThrow('Cannot approve project in status');
    });

    it('should validate completion requirements', async () => {
      const activeProject = {
        ...mockProject,
        status: STATUS.PROJECT.ACTIVE,
        funding: {
          ...mockProject.funding,
          deadline: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // Future deadline
          raised: 300000 // Less than goal
        }
      };
      
      const creatorContext = { ...mockContext, auth: { uid: 'creator-uid', token: {} } };

      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users' && id === 'creator-uid') return Promise.resolve(mockCreatorUser);
        if (collection === 'projects') return Promise.resolve(activeProject);
        throw new Error('Unexpected collection');
      });

      const completeData = { projectId: 'test-project-id', action: 'complete' };

      await expect(
        manageProjectStatus(completeData, creatorContext)
      ).rejects.toThrow('Project can only be completed after deadline or when funding goal is reached');
    });

    it('should validate deadline extension requirements', async () => {
      const pastDeadlineProject = {
        ...mockProject,
        status: STATUS.PROJECT.FUNDING,
        funding: {
          ...mockProject.funding,
          deadline: new Date(Date.now() - 24 * 60 * 60 * 1000) // Past deadline
        }
      };
      
      const creatorContext = { ...mockContext, auth: { uid: 'creator-uid', token: {} } };

      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users' && id === 'creator-uid') return Promise.resolve(mockCreatorUser);
        if (collection === 'projects') return Promise.resolve(pastDeadlineProject);
        throw new Error('Unexpected collection');
      });

      const extendData = {
        projectId: 'test-project-id',
        action: 'extend_deadline',
        actionData: {
          newDeadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
      };

      await expect(
        manageProjectStatus(extendData, creatorContext)
      ).rejects.toThrow('Cannot extend deadline after it has passed');
    });
  });

  describe('Status Update Actions', () => {
    it('should update project status to ACTIVE when approved', async () => {
      const approveData = {
        projectId: 'test-project-id',
        action: 'approve',
        actionData: {
          moderatorNotes: 'Excellent project proposal'
        }
      };

      await manageProjectStatus(approveData, mockContext);

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
          fundingStartsAt: expect.any(Date),
          'complianceChecks.contentModeration': STATUS.MODERATION.APPROVED,
          'complianceChecks.legalReview': STATUS.MODERATION.APPROVED,
          'complianceChecks.financialReview': STATUS.MODERATION.APPROVED,
          moderatorNotes: 'Excellent project proposal'
        })
      );
    });

    it('should update project status to REJECTED when rejected', async () => {
      const rejectData = {
        projectId: 'test-project-id',
        action: 'reject',
        actionData: {
          reason: 'Missing required documentation'
        }
      };

      await manageProjectStatus(rejectData, mockContext);

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
          status: STATUS.PROJECT.REJECTED,
          rejectedAt: expect.any(Date),
          rejectionReason: 'Missing required documentation'
        })
      );
    });

    it('should handle deadline extension', async () => {
      const fundingProject = { ...mockProject, status: STATUS.PROJECT.FUNDING };
      const creatorContext = { ...mockContext, auth: { uid: 'creator-uid', token: {} } };

      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users' && id === 'creator-uid') return Promise.resolve(mockCreatorUser);
        if (collection === 'projects') return Promise.resolve(fundingProject);
        throw new Error('Unexpected collection');
      });

      const newDeadline = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
      const extendData = {
        projectId: 'test-project-id',
        action: 'extend_deadline',
        actionData: {
          newDeadline
        }
      };

      await manageProjectStatus(extendData, creatorContext);

      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ ...fundingProject, version: 1 })
        }),
        update: jest.fn(),
        set: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          'funding.deadline': newDeadline,
          deadlineExtended: true,
          originalDeadline: fundingProject.funding.deadline
        })
      );
    });

    it('should reject excessive deadline extensions', async () => {
      const fundingProject = { ...mockProject, status: STATUS.PROJECT.FUNDING };
      const creatorContext = { ...mockContext, auth: { uid: 'creator-uid', token: {} } };

      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users' && id === 'creator-uid') return Promise.resolve(mockCreatorUser);
        if (collection === 'projects') return Promise.resolve(fundingProject);
        throw new Error('Unexpected collection');
      });

      const excessiveDeadline = new Date(Date.now() + (PROJECT_CONFIG.MAX_DURATION_MONTHS + 1) * 30 * 24 * 60 * 60 * 1000);
      const extendData = {
        projectId: 'test-project-id',
        action: 'extend_deadline',
        actionData: {
          newDeadline: excessiveDeadline
        }
      };

      await expect(
        manageProjectStatus(extendData, creatorContext)
      ).rejects.toThrow(`Deadline cannot be extended beyond ${PROJECT_CONFIG.MAX_DURATION_MONTHS} months`);
    });
  });

  describe('Post-Status Change Processing', () => {
    it('should create activity feed entry on approval', async () => {
      const approveData = {
        projectId: 'test-project-id',
        action: 'approve'
      };

      await manageProjectStatus(approveData, mockContext);

      expect(mockFirestoreHelper.addDocument).toHaveBeenCalledWith(
        'activity_feed',
        expect.objectContaining({
          type: 'project_approved',
          projectId: 'test-project-id',
          projectTitle: 'Test Project',
          creatorUid: 'creator-uid',
          category: 'environment'
        })
      );
    });

    it('should update platform statistics on completion', async () => {
      const activeProject = { ...mockProject, status: STATUS.PROJECT.ACTIVE };
      const creatorContext = { ...mockContext, auth: { uid: 'creator-uid', token: {} } };

      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users' && id === 'creator-uid') return Promise.resolve(mockCreatorUser);
        if (collection === 'projects') return Promise.resolve(activeProject);
        throw new Error('Unexpected collection');
      });

      const completeData = {
        projectId: 'test-project-id',
        action: 'complete'
      };

      await manageProjectStatus(completeData, creatorContext);

      expect(mockFirestoreHelper.incrementDocument).toHaveBeenCalledWith(
        'platform_stats',
        'global',
        expect.objectContaining({
          'projects.completed': 1,
          'categories.environment.completedProjects': 1,
          'categories.environment.totalRaised': mockProject.funding.raised
        })
      );
    });

    it('should update creator statistics on completion', async () => {
      const activeProject = { ...mockProject, status: STATUS.PROJECT.ACTIVE };
      const creatorContext = { ...mockContext, auth: { uid: 'creator-uid', token: {} } };

      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users' && id === 'creator-uid') return Promise.resolve(mockCreatorUser);
        if (collection === 'projects') return Promise.resolve(activeProject);
        throw new Error('Unexpected collection');
      });

      const completeData = {
        projectId: 'test-project-id',
        action: 'complete'
      };

      await manageProjectStatus(completeData, creatorContext);

      // Verify creator stats transaction was called
      expect(mockFirestoreHelper.runTransaction).toHaveBeenCalledTimes(2); // Project update + creator stats update
    });

    it('should update cancellation statistics', async () => {
      const activeProject = { ...mockProject, status: STATUS.PROJECT.ACTIVE };
      const creatorContext = { ...mockContext, auth: { uid: 'creator-uid', token: {} } };

      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users' && id === 'creator-uid') return Promise.resolve(mockCreatorUser);
        if (collection === 'projects') return Promise.resolve(activeProject);
        throw new Error('Unexpected collection');
      });

      const cancelData = {
        projectId: 'test-project-id',
        action: 'cancel',
        actionData: {
          reason: 'Project cancelled'
        }
      };

      await manageProjectStatus(cancelData, creatorContext);

      expect(mockFirestoreHelper.incrementDocument).toHaveBeenCalledWith(
        'platform_stats',
        'global',
        expect.objectContaining({
          'projects.cancelled': 1,
          'categories.environment.cancelledProjects': 1
        })
      );
    });
  });

  describe('Version Control', () => {
    it('should handle version conflicts', async () => {
      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        const mockTransaction = {
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ ...mockProject, version: 2 }) // Different version
          }),
          update: jest.fn(),
          set: jest.fn(),
          delete: jest.fn()
        };
        await callback(mockTransaction as any);
      });

      const approveData = { projectId: 'test-project-id', action: 'approve' };

      await expect(
        manageProjectStatus(approveData, mockContext)
      ).rejects.toThrow('Project was modified by another operation');
    });

    it('should increment version number', async () => {
      const approveData = { projectId: 'test-project-id', action: 'approve' };

      await manageProjectStatus(approveData, mockContext);

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
          version: 2
        })
      );
    });

    it('should handle missing project', async () => {
      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        const mockTransaction = {
          get: jest.fn().mockResolvedValue({ exists: false }),
          update: jest.fn(),
          set: jest.fn(),
          delete: jest.fn()
        };
        await callback(mockTransaction as any);
      });

      const approveData = { projectId: 'non-existent', action: 'approve' };

      await expect(
        manageProjectStatus(approveData, mockContext)
      ).rejects.toThrow('Project not found');
    });
  });

  describe('Action Data Validation', () => {
    it('should require reason for reject action', async () => {
      const rejectWithoutReason = {
        projectId: 'test-project-id',
        action: 'reject'
        // Missing actionData.reason
      };

      const result = await manageProjectStatus(rejectWithoutReason, mockContext);
      
      // Should use default reason
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
          rejectionReason: 'Project does not meet platform standards'
        })
      );
    });

    it('should require newDeadline for extend_deadline action', async () => {
      const creatorContext = { ...mockContext, auth: { uid: 'creator-uid', token: {} } };
      
      const extendWithoutDeadline = {
        projectId: 'test-project-id',
        action: 'extend_deadline'
        // Missing actionData.newDeadline
      };

      await expect(
        manageProjectStatus(extendWithoutDeadline, creatorContext)
      ).rejects.toThrow('New deadline is required');
    });

    it('should handle force completion by admin', async () => {
      const activeProject = { ...mockProject, status: STATUS.PROJECT.ACTIVE };

      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockAdminUser);
        if (collection === 'projects') return Promise.resolve(activeProject);
        throw new Error('Unexpected collection');
      });

      const forceCompleteData = {
        projectId: 'test-project-id',
        action: 'complete',
        actionData: {
          forceComplete: true,
          completionReason: 'Admin override due to special circumstances'
        }
      };

      await manageProjectStatus(forceCompleteData, mockContext);

      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ ...activeProject, version: 1 })
        }),
        update: jest.fn(),
        set: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          status: STATUS.PROJECT.COMPLETED,
          forceCompletedBy: 'admin-uid',
          forceCompletionReason: 'Admin override due to special circumstances'
        })
      );
    });
  });

  describe('Notification Settings', () => {
    it('should respect notification preferences', async () => {
      const approveData = {
        projectId: 'test-project-id',
        action: 'approve',
        actionData: {
          notifyCreator: false,
          notifyContributors: true
        }
      };

      const result = await manageProjectStatus(approveData, mockContext);
      expect(result.success).toBe(true);
    });

    it('should default to notifying creator', async () => {
      const approveData = {
        projectId: 'test-project-id',
        action: 'approve'
        // No notification preferences specified
      };

      const result = await manageProjectStatus(approveData, mockContext);
      expect(result.success).toBe(true);
    });
  });

  describe('Audit Logging', () => {
    it('should log sensitive actions with high severity', async () => {
      const suspendData = {
        projectId: 'test-project-id',
        action: 'suspend',
        actionData: {
          reason: 'Policy violation'
        }
      };

      const activeProject = { ...mockProject, status: STATUS.PROJECT.ACTIVE };

      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockAdminUser);
        if (collection === 'projects') return Promise.resolve(activeProject);
        throw new Error('Unexpected collection');
      });

      const result = await manageProjectStatus(suspendData, mockContext);
      expect(result.success).toBe(true);
    });

    it('should log business operations', async () => {
      const approveData = { projectId: 'test-project-id', action: 'approve' };

      const result = await manageProjectStatus(approveData, mockContext);
      expect(result.success).toBe(true);
    });
  });

  describe('Response Structure', () => {
    it('should return correct response structure', async () => {
      const approveData = { projectId: 'test-project-id', action: 'approve' };

      const result = await manageProjectStatus(approveData, mockContext);

      expect(result).toEqual({
        projectId: 'test-project-id',
        previousStatus: STATUS.PROJECT.DRAFT,
        newStatus: STATUS.PROJECT.ACTIVE,
        action: 'approve',
        version: 2,
        updatedAt: expect.any(String),
        requiresFollowUp: false,
        success: true
      });
    });

    it('should indicate follow-up required for cancellation with funding', async () => {
      const activeProject = { ...mockProject, status: STATUS.PROJECT.ACTIVE };
      const creatorContext = { ...mockContext, auth: { uid: 'creator-uid', token: {} } };

      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users' && id === 'creator-uid') return Promise.resolve(mockCreatorUser);
        if (collection === 'projects') return Promise.resolve(activeProject);
        throw new Error('Unexpected collection');
      });

      const cancelData = {
        projectId: 'test-project-id',
        action: 'cancel'
      };

      const result = await manageProjectStatus(cancelData, creatorContext);

      expect(result.requiresFollowUp).toBe(true); // Project has funding raised
    });

    it('should not require follow-up for projects without funding', async () => {
      const unfundedProject = {
        ...mockProject,
        status: STATUS.PROJECT.ACTIVE,
        funding: { ...mockProject.funding, raised: 0 }
      };
      const creatorContext = { ...mockContext, auth: { uid: 'creator-uid', token: {} } };

      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users' && id === 'creator-uid') return Promise.resolve(mockCreatorUser);
        if (collection === 'projects') return Promise.resolve(unfundedProject);
        throw new Error('Unexpected collection');
      });

      const cancelData = {
        projectId: 'test-project-id',
        action: 'cancel'
      };

      const result = await manageProjectStatus(cancelData, creatorContext);

      expect(result.requiresFollowUp).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle Firestore transaction errors', async () => {
      mockFirestoreHelper.runTransaction.mockRejectedValue(new Error('Transaction failed'));

      const approveData = { projectId: 'test-project-id', action: 'approve' };

      await expect(
        manageProjectStatus(approveData, mockContext)
      ).rejects.toThrow();
    });

    it('should handle invalid action types', async () => {
      const invalidActionData = {
        projectId: 'test-project-id',
        action: 'invalid-action'
      };

      await expect(
        manageProjectStatus(invalidActionData, mockContext)
      ).rejects.toThrow();
    });

    it('should handle missing project', async () => {
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockAdminUser);
        if (collection === 'projects') return Promise.reject(new Error('Project not found'));
        throw new Error('Unexpected collection');
      });

      const approveData = { projectId: 'non-existent', action: 'approve' };

      await expect(
        manageProjectStatus(approveData, mockContext)
      ).rejects.toThrow();
    });
  });

  describe('Context Metadata', () => {
    it('should capture IP address and user agent', async () => {
      const approveData = { projectId: 'test-project-id', action: 'approve' };

      await manageProjectStatus(approveData, mockContext);

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
          ipAddress: '192.168.1.1',
          userAgent: 'test-agent',
          lastModifiedBy: 'admin-uid'
        })
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle projects without funding', async () => {
      const unfundedProject = {
        ...mockProject,
        funding: { ...mockProject.funding, raised: 0, contributorsCount: 0 }
      };
      const creatorContext = { ...mockContext, auth: { uid: 'creator-uid', token: {} } };

      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users' && id === 'creator-uid') return Promise.resolve(mockCreatorUser);
        if (collection === 'projects') return Promise.resolve(unfundedProject);
        throw new Error('Unexpected collection');
      });

      const cancelData = {
        projectId: 'test-project-id',
        action: 'cancel'
      };

      const result = await manageProjectStatus(cancelData, creatorContext);
      expect(result.success).toBe(true);
      expect(result.requiresFollowUp).toBe(false);
    });

    it('should handle reactivation from cancelled status', async () => {
      const cancelledProject = { ...mockProject, status: STATUS.PROJECT.CANCELLED };

      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockAdminUser);
        if (collection === 'projects') return Promise.resolve(cancelledProject);
        throw new Error('Unexpected collection');
      });

      const reactivateData = {
        projectId: 'test-project-id',
        action: 'reactivate'
      };

      const result = await manageProjectStatus(reactivateData, mockContext);
      
      expect(result.success).toBe(true);
      expect(result.newStatus).toBe(STATUS.PROJECT.ACTIVE);
    });
  });
});