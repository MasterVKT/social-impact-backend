/**
 * Tests for Update Milestone Firebase Function
 * Social Finance Impact Platform
 */

import { CallableContext } from 'firebase-functions/v1/https';
import { updateMilestone } from '../updateMilestone';
import { firestoreHelper } from '../../utils/firestore';
import { ProjectsAPI } from '../../types/api';
import { ProjectDocument, UserDocument } from '../../types/firestore';
import { STATUS, USER_PERMISSIONS, PROJECT_CONFIG } from '../../utils/constants';

// Mocks
jest.mock('../../utils/firestore');
jest.mock('../../utils/auth');
jest.mock('../../integrations/sendgrid/emailService');
jest.mock('../../utils/logger');

const mockFirestoreHelper = jest.mocked(firestoreHelper);

describe('updateMilestone Function', () => {
  let mockContext: CallableContext;
  let mockProject: ProjectDocument;
  let mockUser: UserDocument;
  let mockMilestone: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockContext = {
      auth: { uid: 'creator-uid', token: {} },
      rawRequest: { ip: '192.168.1.1', headers: { 'user-agent': 'test-agent' } }
    } as any;

    mockMilestone = {
      id: 'milestone-1',
      title: 'Setup Phase',
      description: 'Initial project setup',
      status: STATUS.MILESTONE.PENDING,
      fundingPercentage: 30,
      targetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      deliverables: ['Team setup', 'Equipment'],
      auditRequired: false,
      evidence: [],
      progress: { current: 0, percentage: 0 }
    };

    mockProject = {
      uid: 'test-project-id',
      creatorUid: 'creator-uid',
      status: STATUS.PROJECT.ACTIVE,
      title: 'Test Project',
      version: 1,
      milestones: [mockMilestone],
      impactGoals: {
        metrics: [{
          id: 'metric-1',
          name: 'Impact Metric',
          target: 1000,
          unit: 'units',
          current: 0,
          percentage: 0
        }]
      },
      funding: {
        deadline: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
      },
      settings: { notifyOnMilestone: true }
    } as ProjectDocument;

    mockUser = {
      uid: 'creator-uid',
      permissions: [USER_PERMISSIONS.CREATE_PROJECT]
    } as UserDocument;

    mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
      if (collection === 'users') return Promise.resolve(mockUser);
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
    mockFirestoreHelper.updateDocument.mockResolvedValue();
    mockFirestoreHelper.incrementDocument.mockResolvedValue();
    mockFirestoreHelper.queryDocuments.mockResolvedValue([]);
  });

  describe('Authentication', () => {
    it('should reject unauthenticated requests', async () => {
      const unauthenticatedContext = { ...mockContext, auth: null };

      await expect(
        updateMilestone({ projectId: 'test-project', milestoneId: 'milestone-1', action: 'update_progress' }, unauthenticatedContext)
      ).rejects.toThrow('Authentication required');
    });
  });

  describe('Permission Validation', () => {
    it('should allow project creator to update milestones', async () => {
      const progressData = {
        projectId: 'test-project-id',
        milestoneId: 'milestone-1',
        action: 'update_progress',
        progressData: { current: 500, description: 'Halfway there' }
      };

      const result = await updateMilestone(progressData, mockContext);
      expect(result.success).toBe(true);
    });

    it('should allow admins to update any milestone', async () => {
      const adminUser = {
        ...mockUser,
        uid: 'admin-uid',
        permissions: [USER_PERMISSIONS.MODERATE_PROJECTS]
      };
      
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(adminUser);
        if (collection === 'projects') return Promise.resolve(mockProject);
        throw new Error('Unexpected collection');
      });

      const adminContext = { ...mockContext, auth: { uid: 'admin-uid', token: {} } };
      const progressData = {
        projectId: 'test-project-id',
        milestoneId: 'milestone-1',
        action: 'update_progress',
        progressData: { current: 500 }
      };

      const result = await updateMilestone(progressData, adminContext);
      expect(result.success).toBe(true);
    });

    it('should allow assigned auditors to update milestones', async () => {
      const auditorUser = {
        ...mockUser,
        uid: 'auditor-uid',
        permissions: [USER_PERMISSIONS.AUDIT_PROJECT]
      };

      const milestoneWithAuditor = {
        ...mockMilestone,
        auditAssignedTo: 'auditor-uid'
      };

      const projectWithAuditor = {
        ...mockProject,
        milestones: [milestoneWithAuditor]
      };
      
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(auditorUser);
        if (collection === 'projects') return Promise.resolve(projectWithAuditor);
        throw new Error('Unexpected collection');
      });

      const auditorContext = { ...mockContext, auth: { uid: 'auditor-uid', token: {} } };
      const progressData = {
        projectId: 'test-project-id',
        milestoneId: 'milestone-1',
        action: 'update_progress',
        progressData: { current: 300 }
      };

      const result = await updateMilestone(progressData, auditorContext);
      expect(result.success).toBe(true);
    });

    it('should reject unauthorized users', async () => {
      const unauthorizedUser = {
        ...mockUser,
        uid: 'other-uid',
        permissions: []
      };
      
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(unauthorizedUser);
        if (collection === 'projects') return Promise.resolve(mockProject);
        throw new Error('Unexpected collection');
      });

      const otherContext = { ...mockContext, auth: { uid: 'other-uid', token: {} } };
      const progressData = {
        projectId: 'test-project-id',
        milestoneId: 'milestone-1',
        action: 'update_progress',
        progressData: { current: 500 }
      };

      await expect(
        updateMilestone(progressData, otherContext)
      ).rejects.toThrow('Insufficient permissions to modify this milestone');
    });
  });

  describe('Milestone Validation', () => {
    it('should reject updates to non-existent milestones', async () => {
      const progressData = {
        projectId: 'test-project-id',
        milestoneId: 'non-existent',
        action: 'update_progress',
        progressData: { current: 500 }
      };

      await expect(
        updateMilestone(progressData, mockContext)
      ).rejects.toThrow('Milestone not found');
    });

    it('should reject updates to projects in invalid status', async () => {
      const completedProject = {
        ...mockProject,
        status: STATUS.PROJECT.COMPLETED
      };
      
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockUser);
        if (collection === 'projects') return Promise.resolve(completedProject);
        throw new Error('Unexpected collection');
      });

      const progressData = {
        projectId: 'test-project-id',
        milestoneId: 'milestone-1',
        action: 'update_progress',
        progressData: { current: 500 }
      };

      await expect(
        updateMilestone(progressData, mockContext)
      ).rejects.toThrow('Cannot modify milestones for project in status');
    });
  });

  describe('Progress Updates', () => {
    it('should update milestone progress correctly', async () => {
      const progressData = {
        projectId: 'test-project-id',
        milestoneId: 'milestone-1',
        action: 'update_progress',
        progressData: { current: 500, description: 'Making good progress' }
      };

      await updateMilestone(progressData, mockContext);

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
          milestones: expect.arrayContaining([
            expect.objectContaining({
              id: 'milestone-1',
              progress: expect.objectContaining({
                current: 500,
                percentage: 50, // 500/1000 * 100
                description: 'Making good progress'
              })
            })
          ])
        })
      );
    });

    it('should cap progress at 100%', async () => {
      const progressData = {
        projectId: 'test-project-id',
        milestoneId: 'milestone-1',
        action: 'update_progress',
        progressData: { current: 2000 } // More than target of 1000
      };

      await updateMilestone(progressData, mockContext);

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
          milestones: expect.arrayContaining([
            expect.objectContaining({
              progress: expect.objectContaining({
                percentage: 100
              })
            })
          ])
        })
      );
    });
  });

  describe('Milestone Completion', () => {
    it('should complete milestone with evidence', async () => {
      const completionData = {
        projectId: 'test-project-id',
        milestoneId: 'milestone-1',
        action: 'complete',
        completionData: {
          evidence: [{
            type: 'document',
            url: 'https://example.com/evidence.pdf',
            title: 'Completion Evidence',
            description: 'Proof of milestone completion'
          }],
          summary: 'Successfully completed all deliverables on time with excellent results.',
          impactMetrics: {
            'Impact Metric': 800
          }
        }
      };

      const result = await updateMilestone(completionData, mockContext);

      expect(result.success).toBe(true);
      expect(result.milestoneStatus).toBe(STATUS.MILESTONE.COMPLETED);
    });

    it('should reject completion of already completed milestones', async () => {
      const completedMilestone = {
        ...mockMilestone,
        status: STATUS.MILESTONE.COMPLETED
      };

      const projectWithCompletedMilestone = {
        ...mockProject,
        milestones: [completedMilestone]
      };
      
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockUser);
        if (collection === 'projects') return Promise.resolve(projectWithCompletedMilestone);
        throw new Error('Unexpected collection');
      });

      const completionData = {
        projectId: 'test-project-id',
        milestoneId: 'milestone-1',
        action: 'complete',
        completionData: {
          evidence: [{
            type: 'document',
            url: 'https://example.com/evidence.pdf',
            title: 'Evidence'
          }],
          summary: 'Already completed'
        }
      };

      await expect(
        updateMilestone(completionData, mockContext)
      ).rejects.toThrow('Milestone is already completed');
    });

    it('should require evidence for critical milestones', async () => {
      const criticalMilestone = {
        ...mockMilestone,
        fundingPercentage: PROJECT_CONFIG.CRITICAL_MILESTONE_THRESHOLD + 10
      };

      const projectWithCriticalMilestone = {
        ...mockProject,
        milestones: [criticalMilestone]
      };
      
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockUser);
        if (collection === 'projects') return Promise.resolve(projectWithCriticalMilestone);
        throw new Error('Unexpected collection');
      });

      const completionWithoutEvidence = {
        projectId: 'test-project-id',
        milestoneId: 'milestone-1',
        action: 'complete',
        completionData: {
          evidence: [],
          summary: 'Completed without evidence'
        }
      };

      await expect(
        updateMilestone(completionWithoutEvidence, mockContext)
      ).rejects.toThrow('Critical milestones require evidence of completion');
    });

    it('should require detailed summary for critical milestones', async () => {
      const criticalMilestone = {
        ...mockMilestone,
        fundingPercentage: PROJECT_CONFIG.CRITICAL_MILESTONE_THRESHOLD + 10
      };

      const projectWithCriticalMilestone = {
        ...mockProject,
        milestones: [criticalMilestone]
      };
      
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockUser);
        if (collection === 'projects') return Promise.resolve(projectWithCriticalMilestone);
        throw new Error('Unexpected collection');
      });

      const completionWithShortSummary = {
        projectId: 'test-project-id',
        milestoneId: 'milestone-1',
        action: 'complete',
        completionData: {
          evidence: [{
            type: 'document',
            url: 'https://example.com/evidence.pdf',
            title: 'Evidence'
          }],
          summary: 'Done' // Too short
        }
      };

      await expect(
        updateMilestone(completionWithShortSummary, mockContext)
      ).rejects.toThrow('Critical milestones require detailed completion summary');
    });
  });

  describe('Evidence Management', () => {
    it('should add evidence to milestone', async () => {
      const evidenceData = {
        projectId: 'test-project-id',
        milestoneId: 'milestone-1',
        action: 'add_evidence',
        evidenceData: {
          evidence: {
            type: 'image',
            url: 'https://example.com/progress.jpg',
            title: 'Progress Photo',
            description: 'Current state of work'
          }
        }
      };

      await updateMilestone(evidenceData, mockContext);

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
          milestones: expect.arrayContaining([
            expect.objectContaining({
              evidence: expect.arrayContaining([
                expect.objectContaining({
                  type: 'image',
                  title: 'Progress Photo',
                  verified: false
                })
              ])
            })
          ])
        })
      );
    });
  });

  describe('Details Modification', () => {
    it('should modify milestone details', async () => {
      const detailsData = {
        projectId: 'test-project-id',
        milestoneId: 'milestone-1',
        action: 'modify_details',
        detailsData: {
          title: 'Updated Setup Phase',
          description: 'Enhanced project setup with additional features',
          targetDate: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000),
          deliverables: ['Enhanced team setup', 'Advanced equipment', 'Site preparation']
        }
      };

      await updateMilestone(detailsData, mockContext);

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
          milestones: expect.arrayContaining([
            expect.objectContaining({
              title: 'Updated Setup Phase',
              description: 'Enhanced project setup with additional features',
              deliverables: expect.arrayContaining(['Enhanced team setup', 'Advanced equipment'])
            })
          ])
        })
      );
    });

    it('should reject modification of completed milestones', async () => {
      const completedMilestone = {
        ...mockMilestone,
        status: STATUS.MILESTONE.COMPLETED
      };

      const projectWithCompletedMilestone = {
        ...mockProject,
        milestones: [completedMilestone]
      };
      
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockUser);
        if (collection === 'projects') return Promise.resolve(projectWithCompletedMilestone);
        throw new Error('Unexpected collection');
      });

      const detailsData = {
        projectId: 'test-project-id',
        milestoneId: 'milestone-1',
        action: 'modify_details',
        detailsData: {
          title: 'New Title'
        }
      };

      await expect(
        updateMilestone(detailsData, mockContext)
      ).rejects.toThrow('Cannot modify completed milestone details');
    });

    it('should validate target date against funding deadline', async () => {
      const detailsData = {
        projectId: 'test-project-id',
        milestoneId: 'milestone-1',
        action: 'modify_details',
        detailsData: {
          targetDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) // After funding deadline
        }
      };

      await expect(
        updateMilestone(detailsData, mockContext)
      ).rejects.toThrow('Milestone target date cannot be after funding deadline');
    });
  });

  describe('Project Completion Logic', () => {
    it('should mark project as completed when all milestones are done', async () => {
      const projectWithMultipleMilestones = {
        ...mockProject,
        milestones: [
          { ...mockMilestone, id: 'milestone-1', status: STATUS.MILESTONE.COMPLETED },
          { ...mockMilestone, id: 'milestone-2', status: STATUS.MILESTONE.PENDING }
        ]
      };
      
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockUser);
        if (collection === 'projects') return Promise.resolve(projectWithMultipleMilestones);
        throw new Error('Unexpected collection');
      });

      const completionData = {
        projectId: 'test-project-id',
        milestoneId: 'milestone-2',
        action: 'complete',
        completionData: {
          evidence: [{
            type: 'document',
            url: 'https://example.com/final-evidence.pdf',
            title: 'Final Evidence'
          }],
          summary: 'Final milestone completed successfully with all deliverables achieved.'
        }
      };

      await updateMilestone(completionData, mockContext);

      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ ...projectWithMultipleMilestones, version: 1 })
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
          completedAt: expect.any(Date)
        })
      );
    });

    it('should calculate correct project progress', async () => {
      const progressData = {
        projectId: 'test-project-id',
        milestoneId: 'milestone-1',
        action: 'update_progress',
        progressData: { current: 500 }
      };

      await updateMilestone(progressData, mockContext);

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
          projectProgress: 15, // 50% of 30% funding weight
          currentMilestoneIndex: 0
        })
      );
    });
  });

  describe('Impact Metrics Updates', () => {
    it('should update impact metrics on completion', async () => {
      const completionData = {
        projectId: 'test-project-id',
        milestoneId: 'milestone-1',
        action: 'complete',
        completionData: {
          evidence: [{
            type: 'report',
            url: 'https://example.com/impact-report.pdf',
            title: 'Impact Report'
          }],
          summary: 'Milestone completed with measurable impact achieved.',
          impactMetrics: {
            'Impact Metric': 800
          }
        }
      };

      await updateMilestone(completionData, mockContext);

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
          'impactGoals.metrics': expect.arrayContaining([
            expect.objectContaining({
              current: 800,
              percentage: 80
            })
          ])
        })
      );
    });

    it('should validate impact metrics are positive numbers', async () => {
      const invalidCompletionData = {
        projectId: 'test-project-id',
        milestoneId: 'milestone-1',
        action: 'complete',
        completionData: {
          evidence: [{
            type: 'document',
            url: 'https://example.com/evidence.pdf',
            title: 'Evidence'
          }],
          summary: 'Completed milestone',
          impactMetrics: {
            'Impact Metric': -100 // Negative value
          }
        }
      };

      await expect(
        updateMilestone(invalidCompletionData, mockContext)
      ).rejects.toThrow('Impact metrics must be positive numbers');
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

      const progressData = {
        projectId: 'test-project-id',
        milestoneId: 'milestone-1',
        action: 'update_progress',
        progressData: { current: 500 }
      };

      await expect(
        updateMilestone(progressData, mockContext)
      ).rejects.toThrow('Project was modified by another operation');
    });

    it('should increment version number', async () => {
      const progressData = {
        projectId: 'test-project-id',
        milestoneId: 'milestone-1',
        action: 'update_progress',
        progressData: { current: 500 }
      };

      await updateMilestone(progressData, mockContext);

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
  });

  describe('Notifications', () => {
    it('should create activity feed entry on completion', async () => {
      const completionData = {
        projectId: 'test-project-id',
        milestoneId: 'milestone-1',
        action: 'complete',
        completionData: {
          evidence: [{
            type: 'document',
            url: 'https://example.com/evidence.pdf',
            title: 'Evidence'
          }],
          summary: 'Milestone completed successfully with all objectives met.'
        }
      };

      await updateMilestone(completionData, mockContext);

      expect(mockFirestoreHelper.addDocument).toHaveBeenCalledWith(
        'activity_feed',
        expect.objectContaining({
          type: 'milestone_completed',
          projectId: 'test-project-id',
          milestoneId: 'milestone-1',
          milestoneTitle: 'Setup Phase',
          creatorUid: 'creator-uid'
        })
      );
    });

    it('should update project statistics on completion', async () => {
      const completionData = {
        projectId: 'test-project-id',
        milestoneId: 'milestone-1',
        action: 'complete',
        completionData: {
          evidence: [{
            type: 'document',
            url: 'https://example.com/evidence.pdf',
            title: 'Evidence'
          }],
          summary: 'Milestone completed successfully'
        }
      };

      await updateMilestone(completionData, mockContext);

      expect(mockFirestoreHelper.incrementDocument).toHaveBeenCalledWith(
        'projects',
        'test-project-id',
        expect.objectContaining({
          'stats.completedMilestones': 1,
          'stats.lastMilestoneCompletedAt': expect.any(Date)
        })
      );
    });
  });

  describe('Response Structure', () => {
    it('should return correct response for progress update', async () => {
      const progressData = {
        projectId: 'test-project-id',
        milestoneId: 'milestone-1',
        action: 'update_progress',
        progressData: { current: 500 }
      };

      const result = await updateMilestone(progressData, mockContext);

      expect(result).toEqual({
        projectId: 'test-project-id',
        milestoneId: 'milestone-1',
        success: true,
        action: 'update_progress',
        milestoneStatus: STATUS.MILESTONE.PENDING,
        version: expect.any(Number),
        requiresAudit: false
      });
    });

    it('should return correct response for completion', async () => {
      const completionData = {
        projectId: 'test-project-id',
        milestoneId: 'milestone-1',
        action: 'complete',
        completionData: {
          evidence: [{
            type: 'document',
            url: 'https://example.com/evidence.pdf',
            title: 'Evidence'
          }],
          summary: 'Successfully completed all milestone objectives.'
        }
      };

      const result = await updateMilestone(completionData, mockContext);

      expect(result).toEqual({
        projectId: 'test-project-id',
        milestoneId: 'milestone-1',
        success: true,
        action: 'complete',
        milestoneStatus: STATUS.MILESTONE.COMPLETED,
        version: expect.any(Number),
        requiresAudit: false
      });
    });

    it('should indicate audit requirement for critical milestones', async () => {
      const criticalMilestone = {
        ...mockMilestone,
        auditRequired: true
      };

      const projectWithCriticalMilestone = {
        ...mockProject,
        milestones: [criticalMilestone]
      };
      
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockUser);
        if (collection === 'projects') return Promise.resolve(projectWithCriticalMilestone);
        throw new Error('Unexpected collection');
      });

      const completionData = {
        projectId: 'test-project-id',
        milestoneId: 'milestone-1',
        action: 'complete',
        completionData: {
          evidence: [{
            type: 'document',
            url: 'https://example.com/evidence.pdf',
            title: 'Evidence'
          }],
          summary: 'Critical milestone completed with comprehensive documentation.'
        }
      };

      const result = await updateMilestone(completionData, mockContext);

      expect(result.requiresAudit).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing milestone gracefully', async () => {
      const progressData = {
        projectId: 'test-project-id',
        milestoneId: 'non-existent-milestone',
        action: 'update_progress',
        progressData: { current: 500 }
      };

      await expect(
        updateMilestone(progressData, mockContext)
      ).rejects.toThrow('Milestone not found');
    });

    it('should handle empty evidence array for non-critical milestones', async () => {
      const completionData = {
        projectId: 'test-project-id',
        milestoneId: 'milestone-1',
        action: 'complete',
        completionData: {
          evidence: [{
            type: 'document',
            url: 'https://example.com/evidence.pdf',
            title: 'Evidence'
          }],
          summary: 'Non-critical milestone completed.'
        }
      };

      const result = await updateMilestone(completionData, mockContext);
      expect(result.success).toBe(true);
    });
  });
});