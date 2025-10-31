/**
 * Tests for acceptAudit Firebase Function
 * Social Finance Impact Platform
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { CallableContext } from 'firebase-functions/v1/https';
import { https } from 'firebase-functions';
import { acceptAudit } from '../acceptAudit';
import { firestoreHelper } from '../../utils/firestore';
import { emailService } from '../../integrations/sendgrid/emailService';
import { UserDocument, ProjectDocument, AuditDocument } from '../../types/firestore';
import { STATUS, USER_PERMISSIONS, AUDIT_CONFIG } from '../../utils/constants';
import { AuditsAPI } from '../../types/api';

// Mock dependencies
jest.mock('../../utils/firestore');
jest.mock('../../utils/logger');
jest.mock('../../integrations/sendgrid/emailService');
jest.mock('../../utils/helpers', () => ({
  helpers: {
    string: {
      generateId: jest.fn((prefix: string) => `${prefix}_test_id_123`)
    }
  }
}));

const mockFirestoreHelper = firestoreHelper as jest.Mocked<typeof firestoreHelper>;
const mockEmailService = emailService as jest.Mocked<typeof emailService>;

describe('acceptAudit', () => {
  let mockContext: CallableContext;
  let mockAuditor: UserDocument;
  let mockProject: ProjectDocument;
  let mockAudit: AuditDocument;

  beforeEach(() => {
    jest.clearAllMocks();

    mockContext = {
      auth: {
        uid: 'auditor_123',
        token: {
          email: 'auditor@test.com',
          role: 'auditor'
        }
      },
      rawRequest: {
        ip: '127.0.0.1'
      }
    };

    mockAuditor = {
      uid: 'auditor_123',
      email: 'auditor@test.com',
      firstName: 'Expert',
      lastName: 'Auditor',
      userType: 'auditor',
      status: 'active',
      permissions: [USER_PERMISSIONS.AUDIT_PROJECT],
      auditor: {
        specializations: ['environmental', 'financial'],
        certifications: [
          {
            category: 'environment',
            name: 'Environmental Audit Certification',
            status: 'active',
            issuedAt: new Date(),
            expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
          }
        ],
        hourlyRate: 75,
        maxConcurrentAudits: 3,
        stats: {
          totalCompleted: 15,
          averageScore: 85,
          activeAudits: 1
        }
      },
      preferences: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1
    } as UserDocument;

    mockProject = {
      uid: 'project_123',
      title: 'Test Environmental Project',
      category: 'environment',
      status: STATUS.PROJECT.APPROVED,
      creatorUid: 'creator_123',
      creatorName: 'Project Creator',
      slug: 'test-environmental-project',
      funding: {
        goal: 50000,
        raised: 25000,
        currency: 'EUR'
      },
      timeline: {
        createdAt: new Date(),
        endDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
      },
      milestones: [
        {
          id: 'milestone_1',
          title: 'Phase 1 - Environmental Assessment',
          status: STATUS.MILESTONE.COMPLETED,
          fundingPercentage: 30,
          targetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        },
        {
          id: 'milestone_2',
          title: 'Phase 2 - Implementation',
          status: STATUS.MILESTONE.SUBMITTED,
          fundingPercentage: 50,
          targetDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString()
        }
      ],
      audit: {
        status: STATUS.AUDIT.ASSIGNED,
        auditorUid: 'auditor_123'
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1
    } as ProjectDocument;

    mockAudit = {
      id: 'audit_123',
      projectId: 'project_123',
      projectTitle: 'Test Environmental Project',
      projectCategory: 'environment',
      projectCreatorUid: 'creator_123',
      auditorUid: 'auditor_123',
      auditorName: 'Expert Auditor',
      auditorEmail: 'auditor@test.com',
      specializations: ['environmental'],
      priority: 'medium',
      estimatedHours: 16,
      assignedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      deadline: new Date(Date.now() + 12 * 24 * 60 * 60 * 1000).toISOString(),
      status: STATUS.AUDIT.ASSIGNED,
      currentMilestone: 'milestone_1',
      compensation: {
        amount: 1200,
        currency: 'EUR',
        status: 'pending',
        terms: 'payment_on_completion'
      },
      criteria: [
        {
          id: 'criterion_1',
          name: 'Environmental Impact Assessment',
          required: true,
          weight: 0.4
        },
        {
          id: 'criterion_2',
          name: 'Compliance Verification',
          required: true,
          weight: 0.3
        }
      ],
      requiredDocuments: ['environmental_study', 'permits', 'impact_assessment'],
      assignedBy: 'admin_123',
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1
    } as AuditDocument;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Successful Acceptance', () => {
    it('should accept audit assignment successfully', async () => {
      const requestData: AuditsAPI.AcceptAuditRequest = {
        auditId: 'audit_123',
        acceptanceNote: 'Ready to begin environmental assessment',
        estimatedCompletionDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
        proposedTimeline: [
          {
            phase: 'initial_review',
            description: 'Review project documentation and setup',
            estimatedDays: 2
          },
          {
            phase: 'detailed_analysis',
            description: 'Conduct detailed environmental analysis',
            estimatedDays: 6
          },
          {
            phase: 'final_report',
            description: 'Compile final audit report',
            estimatedDays: 2
          }
        ],
        requestedResources: [
          {
            type: 'document',
            description: 'Latest environmental impact assessment',
            required: true
          },
          {
            type: 'meeting',
            description: 'Site visit planning meeting',
            required: false
          }
        ]
      };

      // Setup mocks
      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAudit)
        .mockResolvedValueOnce(mockAuditor)
        .mockResolvedValueOnce(mockProject)
        .mockResolvedValueOnce({ // Creator for notification
          uid: 'creator_123',
          email: 'creator@test.com',
          firstName: 'Project',
          lastName: 'Creator'
        } as UserDocument);

      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // Admin users query
        .mockResolvedValueOnce([]); // Any additional queries

      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        const mockTransaction = {
          update: jest.fn()
        };
        await callback(mockTransaction as any);
      });

      mockEmailService.sendEmail.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();
      mockFirestoreHelper.addDocument.mockResolvedValue();

      const result = await acceptAudit(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.status).toBe(STATUS.AUDIT.IN_PROGRESS);
      expect(result.data.acceptedAt).toBeDefined();
      expect(result.data.estimatedCompletion).toBe(requestData.estimatedCompletionDate);
      expect(result.data.project.id).toBe('project_123');
      expect(result.data.project.title).toBe('Test Environmental Project');
      expect(result.data.compensation.amount).toBe(1200);
      expect(result.data.workspace.documentsRequired).toBe(3);
      expect(result.data.nextSteps).toHaveLength(4);

      // Verify transaction updates
      expect(mockFirestoreHelper.runTransaction).toHaveBeenCalled();
      expect(mockEmailService.sendEmail).toHaveBeenCalled();
    });

    it('should accept audit without optional fields', async () => {
      const requestData: AuditsAPI.AcceptAuditRequest = {
        auditId: 'audit_123',
        estimatedCompletionDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString()
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAudit)
        .mockResolvedValueOnce(mockAuditor)
        .mockResolvedValueOnce(mockProject)
        .mockResolvedValueOnce({
          uid: 'creator_123',
          email: 'creator@test.com',
          firstName: 'Project',
          lastName: 'Creator'
        } as UserDocument);

      mockFirestoreHelper.queryDocuments.mockResolvedValue([]);
      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({} as any);
      });
      mockEmailService.sendEmail.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();
      mockFirestoreHelper.addDocument.mockResolvedValue();

      const result = await acceptAudit(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.status).toBe(STATUS.AUDIT.IN_PROGRESS);
      expect(result.data.workspace.url).toContain('/auditor/workspace/audit_123');
    });
  });

  describe('Permission Validation', () => {
    it('should reject unauthenticated requests', async () => {
      const requestData = {
        auditId: 'audit_123',
        estimatedCompletionDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString()
      };

      const unauthenticatedContext = { ...mockContext, auth: undefined };

      await expect(acceptAudit(requestData, unauthenticatedContext))
        .rejects.toThrow('Authentication required');
    });

    it('should reject non-assigned auditors', async () => {
      const wrongAuditorContext = {
        ...mockContext,
        auth: { ...mockContext.auth!, uid: 'wrong_auditor_456' }
      };

      const requestData = {
        auditId: 'audit_123',
        estimatedCompletionDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString()
      };

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockAudit);

      await expect(acceptAudit(requestData, wrongAuditorContext))
        .rejects.toThrow('You are not the assigned auditor for this audit');
    });

    it('should reject audits not in assigned status', async () => {
      const completedAudit = {
        ...mockAudit,
        status: STATUS.AUDIT.COMPLETED
      };

      const requestData = {
        auditId: 'audit_123',
        estimatedCompletionDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString()
      };

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(completedAudit);

      await expect(acceptAudit(requestData, mockContext))
        .rejects.toThrow('Audit cannot be accepted in current status: completed');
    });

    it('should reject expired audit assignments', async () => {
      const expiredAudit = {
        ...mockAudit,
        deadline: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() // Yesterday
      };

      const requestData = {
        auditId: 'audit_123',
        estimatedCompletionDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString()
      };

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(expiredAudit);

      await expect(acceptAudit(requestData, mockContext))
        .rejects.toThrow('Audit assignment has expired');
    });

    it('should reject auditors with revoked permissions', async () => {
      const revokedAuditor = {
        ...mockAuditor,
        permissions: [USER_PERMISSIONS.CREATE_PROJECT] // No audit permission
      };

      const requestData = {
        auditId: 'audit_123',
        estimatedCompletionDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString()
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAudit)
        .mockResolvedValueOnce(revokedAuditor)
        .mockResolvedValueOnce(mockProject);

      await expect(acceptAudit(requestData, mockContext))
        .rejects.toThrow('Auditor permissions have been revoked');
    });

    it('should reject inactive auditor accounts', async () => {
      const inactiveAuditor = {
        ...mockAuditor,
        status: 'suspended'
      };

      const requestData = {
        auditId: 'audit_123',
        estimatedCompletionDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString()
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAudit)
        .mockResolvedValueOnce(inactiveAuditor)
        .mockResolvedValueOnce(mockProject);

      await expect(acceptAudit(requestData, mockContext))
        .rejects.toThrow('Auditor account is not active');
    });
  });

  describe('Timeline Validation', () => {
    it('should reject completion date after deadline', async () => {
      const requestData = {
        auditId: 'audit_123',
        estimatedCompletionDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString() // After deadline
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAudit)
        .mockResolvedValueOnce(mockAuditor)
        .mockResolvedValueOnce(mockProject);

      await expect(acceptAudit(requestData, mockContext))
        .rejects.toThrow('Estimated completion date must be before the audit deadline');
    });

    it('should reject timeline that exceeds estimated completion', async () => {
      const requestData = {
        auditId: 'audit_123',
        estimatedCompletionDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
        proposedTimeline: [
          {
            phase: 'initial_review',
            description: 'Initial review',
            estimatedDays: 3
          },
          {
            phase: 'detailed_analysis',
            description: 'Detailed analysis',
            estimatedDays: 4
          },
          {
            phase: 'final_report',
            description: 'Final report',
            estimatedDays: 2
          }
        ] // Total: 9 days, but completion is in 5 days
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAudit)
        .mockResolvedValueOnce(mockAuditor)
        .mockResolvedValueOnce(mockProject);

      await expect(acceptAudit(requestData, mockContext))
        .rejects.toThrow('Proposed timeline exceeds estimated completion date');
    });

    it('should require mandatory timeline phases', async () => {
      const requestData = {
        auditId: 'audit_123',
        estimatedCompletionDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
        proposedTimeline: [
          {
            phase: 'initial_review',
            description: 'Initial review',
            estimatedDays: 3
          }
          // Missing 'detailed_analysis' and 'final_report' phases
        ]
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAudit)
        .mockResolvedValueOnce(mockAuditor)
        .mockResolvedValueOnce(mockProject);

      await expect(acceptAudit(requestData, mockContext))
        .rejects.toThrow('Missing required phases: detailed_analysis, final_report');
    });

    it('should accept valid timeline with all required phases', async () => {
      const requestData = {
        auditId: 'audit_123',
        estimatedCompletionDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
        proposedTimeline: [
          {
            phase: 'initial_review',
            description: 'Initial review',
            estimatedDays: 2
          },
          {
            phase: 'detailed_analysis',
            description: 'Detailed analysis',
            estimatedDays: 6
          },
          {
            phase: 'final_report',
            description: 'Final report',
            estimatedDays: 2
          }
        ]
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAudit)
        .mockResolvedValueOnce(mockAuditor)
        .mockResolvedValueOnce(mockProject)
        .mockResolvedValueOnce({
          uid: 'creator_123',
          email: 'creator@test.com',
          firstName: 'Project',
          lastName: 'Creator'
        } as UserDocument);

      mockFirestoreHelper.queryDocuments.mockResolvedValue([]);
      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({} as any);
      });
      mockEmailService.sendEmail.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();
      mockFirestoreHelper.addDocument.mockResolvedValue();

      const result = await acceptAudit(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.status).toBe(STATUS.AUDIT.IN_PROGRESS);
    });
  });

  describe('Data Validation', () => {
    it('should reject missing auditId', async () => {
      const requestData = {
        estimatedCompletionDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString()
        // Missing auditId
      };

      await expect(acceptAudit(requestData, mockContext))
        .rejects.toThrow('Validation error');
    });

    it('should reject invalid estimated completion date format', async () => {
      const requestData = {
        auditId: 'audit_123',
        estimatedCompletionDate: 'invalid-date-format'
      };

      await expect(acceptAudit(requestData, mockContext))
        .rejects.toThrow('Validation error');
    });

    it('should reject invalid timeline phase names', async () => {
      const requestData = {
        auditId: 'audit_123',
        estimatedCompletionDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
        proposedTimeline: [
          {
            phase: 'invalid_phase',
            description: 'Invalid phase',
            estimatedDays: 2
          }
        ]
      };

      // This should pass validation but fail timeline validation
      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAudit)
        .mockResolvedValueOnce(mockAuditor)
        .mockResolvedValueOnce(mockProject);

      await expect(acceptAudit(requestData, mockContext))
        .rejects.toThrow('Missing required phases');
    });

    it('should reject invalid resource types', async () => {
      const requestData = {
        auditId: 'audit_123',
        estimatedCompletionDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
        requestedResources: [
          {
            type: 'invalid_type',
            description: 'Invalid resource type',
            required: true
          }
        ]
      };

      await expect(acceptAudit(requestData, mockContext))
        .rejects.toThrow('Validation error');
    });

    it('should enforce maximum acceptance note length', async () => {
      const requestData = {
        auditId: 'audit_123',
        acceptanceNote: 'x'.repeat(501), // Too long
        estimatedCompletionDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString()
      };

      await expect(acceptAudit(requestData, mockContext))
        .rejects.toThrow('Validation error');
    });
  });

  describe('Database Operations', () => {
    it('should handle transaction failures gracefully', async () => {
      const requestData = {
        auditId: 'audit_123',
        estimatedCompletionDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString()
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAudit)
        .mockResolvedValueOnce(mockAuditor)
        .mockResolvedValueOnce(mockProject);

      mockFirestoreHelper.runTransaction.mockRejectedValue(new Error('Transaction failed'));

      await expect(acceptAudit(requestData, mockContext))
        .rejects.toThrow('Unable to update audit status');
    });

    it('should handle missing project documents', async () => {
      const requestData = {
        auditId: 'audit_123',
        estimatedCompletionDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString()
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAudit)
        .mockResolvedValueOnce(mockAuditor)
        .mockRejectedValueOnce(new Error('Project not found'));

      await expect(acceptAudit(requestData, mockContext))
        .rejects.toThrow('Unable to validate audit acceptance permissions');
    });

    it('should continue if notification sending fails', async () => {
      const requestData = {
        auditId: 'audit_123',
        estimatedCompletionDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString()
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAudit)
        .mockResolvedValueOnce(mockAuditor)
        .mockResolvedValueOnce(mockProject)
        .mockResolvedValueOnce({
          uid: 'creator_123',
          email: 'creator@test.com',
          firstName: 'Project',
          lastName: 'Creator'
        } as UserDocument);

      mockFirestoreHelper.queryDocuments.mockResolvedValue([]);
      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({} as any);
      });
      mockEmailService.sendEmail.mockRejectedValue(new Error('Email service down'));
      mockFirestoreHelper.incrementDocument.mockResolvedValue();
      mockFirestoreHelper.addDocument.mockResolvedValue();

      const result = await acceptAudit(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.status).toBe(STATUS.AUDIT.IN_PROGRESS);
      // Should continue successfully even if notifications fail
    });
  });

  describe('Workspace Initialization', () => {
    it('should initialize workspace with proper structure', async () => {
      const requestData = {
        auditId: 'audit_123',
        estimatedCompletionDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
        requestedResources: [
          {
            type: 'document',
            description: 'Additional environmental data',
            required: true
          }
        ]
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAudit)
        .mockResolvedValueOnce(mockAuditor)
        .mockResolvedValueOnce(mockProject)
        .mockResolvedValueOnce({
          uid: 'creator_123',
          email: 'creator@test.com',
          firstName: 'Project',
          lastName: 'Creator'
        } as UserDocument);

      mockFirestoreHelper.queryDocuments.mockResolvedValue([]);
      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({} as any);
      });
      mockEmailService.sendEmail.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();
      
      let workspaceData: any;
      mockFirestoreHelper.addDocument.mockImplementation(async (collection, data) => {
        if (collection === 'audit_workspaces') {
          workspaceData = data;
        }
      });

      const result = await acceptAudit(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(mockFirestoreHelper.addDocument).toHaveBeenCalledWith('audit_workspaces', expect.any(Object));
      
      // Verify workspace structure
      expect(workspaceData).toMatchObject({
        id: 'workspace_test_id_123',
        auditId: 'audit_123',
        projectId: 'project_123',
        auditorUid: 'auditor_123'
      });
    });

    it('should continue if workspace initialization fails', async () => {
      const requestData = {
        auditId: 'audit_123',
        estimatedCompletionDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString()
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAudit)
        .mockResolvedValueOnce(mockAuditor)
        .mockResolvedValueOnce(mockProject)
        .mockResolvedValueOnce({
          uid: 'creator_123',
          email: 'creator@test.com',
          firstName: 'Project',
          lastName: 'Creator'
        } as UserDocument);

      mockFirestoreHelper.queryDocuments.mockResolvedValue([]);
      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({} as any);
      });
      mockEmailService.sendEmail.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();
      mockFirestoreHelper.addDocument.mockRejectedValue(new Error('Workspace creation failed'));

      const result = await acceptAudit(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.status).toBe(STATUS.AUDIT.IN_PROGRESS);
      // Should continue successfully even if workspace initialization fails
    });
  });

  describe('Response Structure', () => {
    it('should return complete response structure with all fields', async () => {
      const requestData = {
        auditId: 'audit_123',
        acceptanceNote: 'Ready to proceed with audit',
        estimatedCompletionDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
        proposedTimeline: [
          {
            phase: 'initial_review',
            description: 'Initial review phase',
            estimatedDays: 2
          },
          {
            phase: 'detailed_analysis',
            description: 'Detailed analysis phase',
            estimatedDays: 6
          },
          {
            phase: 'final_report',
            description: 'Final report phase',
            estimatedDays: 2
          }
        ]
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAudit)
        .mockResolvedValueOnce(mockAuditor)
        .mockResolvedValueOnce(mockProject)
        .mockResolvedValueOnce({
          uid: 'creator_123',
          email: 'creator@test.com',
          firstName: 'Project',
          lastName: 'Creator'
        } as UserDocument);

      mockFirestoreHelper.queryDocuments.mockResolvedValue([]);
      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({} as any);
      });
      mockEmailService.sendEmail.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();
      mockFirestoreHelper.addDocument.mockResolvedValue();

      const result = await acceptAudit(requestData, mockContext);

      expect(result).toMatchObject({
        success: true,
        data: {
          status: STATUS.AUDIT.IN_PROGRESS,
          acceptedAt: expect.any(String),
          deadline: mockAudit.deadline,
          estimatedCompletion: requestData.estimatedCompletionDate,
          project: {
            id: 'project_123',
            title: 'Test Environmental Project',
            creator: 'Project Creator',
            category: 'environment',
            milestones: expect.arrayContaining([
              expect.objectContaining({
                id: 'milestone_1',
                title: 'Phase 1 - Environmental Assessment',
                status: STATUS.MILESTONE.COMPLETED,
                fundingPercentage: 30
              })
            ])
          },
          compensation: {
            amount: 1200,
            currency: 'EUR',
            terms: 'payment_on_completion'
          },
          workspace: {
            url: expect.stringContaining('/auditor/workspace/audit_123'),
            documentsRequired: 3,
            milestonesToReview: 2
          },
          nextSteps: expect.arrayContaining([
            'Review project documentation and milestones',
            'Set up audit workspace and timeline',
            'Begin initial project assessment',
            'Request additional resources if needed'
          ])
        },
        timestamp: expect.any(String)
      });
    });
  });

  describe('Statistics and Activity Tracking', () => {
    it('should update auditor statistics correctly', async () => {
      const requestData = {
        auditId: 'audit_123',
        estimatedCompletionDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString()
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAudit)
        .mockResolvedValueOnce(mockAuditor)
        .mockResolvedValueOnce(mockProject)
        .mockResolvedValueOnce({
          uid: 'creator_123',
          email: 'creator@test.com',
          firstName: 'Project',
          lastName: 'Creator'
        } as UserDocument);

      mockFirestoreHelper.queryDocuments.mockResolvedValue([]);
      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({} as any);
      });
      mockEmailService.sendEmail.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();
      mockFirestoreHelper.addDocument.mockResolvedValue();

      const result = await acceptAudit(requestData, mockContext);

      expect(result.success).toBe(true);

      // Verify stats updates
      expect(mockFirestoreHelper.incrementDocument).toHaveBeenCalledWith('platform_stats', 'global', {
        'audits.totalAccepted': 1,
        'audits.acceptanceTimeHours': expect.any(Number),
        [`categories.${mockProject.category}.auditsAccepted`]: 1
      });

      expect(mockFirestoreHelper.incrementDocument).toHaveBeenCalledWith('users', 'auditor_123', {
        'auditor.stats.totalAccepted': 1,
        'auditor.stats.averageAcceptanceTime': expect.any(Number),
        'auditor.stats.activeAudits': 1
      });
    });

    it('should create activity feed entry', async () => {
      const requestData = {
        auditId: 'audit_123',
        estimatedCompletionDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString()
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAudit)
        .mockResolvedValueOnce(mockAuditor)
        .mockResolvedValueOnce(mockProject)
        .mockResolvedValueOnce({
          uid: 'creator_123',
          email: 'creator@test.com',
          firstName: 'Project',
          lastName: 'Creator'
        } as UserDocument);

      mockFirestoreHelper.queryDocuments.mockResolvedValue([]);
      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({} as any);
      });
      mockEmailService.sendEmail.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();
      
      let activityData: any;
      mockFirestoreHelper.addDocument.mockImplementation(async (collection, data) => {
        if (collection === 'activity_feed') {
          activityData = data;
        }
      });

      const result = await acceptAudit(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(mockFirestoreHelper.addDocument).toHaveBeenCalledWith('activity_feed', expect.any(Object));
      
      expect(activityData).toMatchObject({
        type: 'audit_accepted',
        auditId: 'audit_123',
        projectId: 'project_123',
        auditorUid: 'auditor_123',
        auditorName: 'Expert Auditor',
        visibility: 'project_team'
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle audit with missing project creator gracefully', async () => {
      const requestData = {
        auditId: 'audit_123',
        estimatedCompletionDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString()
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAudit)
        .mockResolvedValueOnce(mockAuditor)
        .mockResolvedValueOnce(mockProject)
        .mockRejectedValueOnce(new Error('Creator not found')); // Creator lookup fails

      mockFirestoreHelper.queryDocuments.mockResolvedValue([]);
      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({} as any);
      });
      mockEmailService.sendEmail.mockRejectedValue(new Error('Creator email failed'));
      mockFirestoreHelper.incrementDocument.mockResolvedValue();
      mockFirestoreHelper.addDocument.mockResolvedValue();

      const result = await acceptAudit(requestData, mockContext);

      expect(result.success).toBe(true);
      // Should continue even if creator notification fails
    });

    it('should handle completion date exactly at deadline boundary', async () => {
      const deadline = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      const auditWithDeadline = {
        ...mockAudit,
        deadline: deadline.toISOString()
      };

      const requestData = {
        auditId: 'audit_123',
        estimatedCompletionDate: new Date(deadline.getTime() - 60 * 1000).toISOString() // 1 minute before
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(auditWithDeadline)
        .mockResolvedValueOnce(mockAuditor)
        .mockResolvedValueOnce(mockProject)
        .mockResolvedValueOnce({
          uid: 'creator_123',
          email: 'creator@test.com',
          firstName: 'Project',
          lastName: 'Creator'
        } as UserDocument);

      mockFirestoreHelper.queryDocuments.mockResolvedValue([]);
      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({} as any);
      });
      mockEmailService.sendEmail.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();
      mockFirestoreHelper.addDocument.mockResolvedValue();

      const result = await acceptAudit(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.status).toBe(STATUS.AUDIT.IN_PROGRESS);
    });
  });
});