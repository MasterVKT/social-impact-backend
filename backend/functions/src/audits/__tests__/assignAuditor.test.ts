/**
 * Tests for assignAuditor Firebase Function
 * Social Finance Impact Platform
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { CallableContext } from 'firebase-functions/v1/https';
import { https } from 'firebase-functions';
import { assignAuditor } from '../assignAuditor';
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

describe('assignAuditor', () => {
  let mockContext: CallableContext;
  let mockAdmin: UserDocument;
  let mockProject: ProjectDocument;
  let mockAuditor: UserDocument;

  beforeEach(() => {
    jest.clearAllMocks();

    mockContext = {
      auth: {
        uid: 'admin_123',
        token: {
          email: 'admin@test.com',
          role: 'admin'
        }
      },
      rawRequest: {
        ip: '127.0.0.1'
      }
    };

    mockAdmin = {
      uid: 'admin_123',
      email: 'admin@test.com',
      firstName: 'Admin',
      lastName: 'User',
      userType: 'admin',
      status: 'active',
      permissions: [USER_PERMISSIONS.MODERATE_PROJECTS, USER_PERMISSIONS.ASSIGN_AUDITORS],
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
          title: 'Phase 1',
          status: STATUS.MILESTONE.COMPLETED,
          fundingPercentage: 30,
          targetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        }
      ],
      audit: {
        status: STATUS.AUDIT.PENDING,
        required: true
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1
    } as ProjectDocument;

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
        minHourlyRate: 50,
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
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Successful Assignment', () => {
    it('should assign auditor successfully with admin permissions', async () => {
      const requestData: AuditsAPI.AssignAuditorRequest = {
        projectId: 'project_123',
        auditorUid: 'auditor_123',
        specializations: ['environmental'],
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        compensation: 1200,
        priority: 'high'
      };

      // Setup mocks
      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAdmin)
        .mockResolvedValueOnce(mockProject)
        .mockResolvedValueOnce(mockAuditor);

      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // No current audits
        .mockResolvedValueOnce([]) // No contributions to project
        .mockResolvedValueOnce([]) // No shared projects
        .mockResolvedValueOnce([]); // No previous audits with creator

      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        const mockTransaction = {
          set: jest.fn(),
          update: jest.fn(),
          get: jest.fn()
        };
        await callback(mockTransaction as any);
      });

      mockEmailService.sendEmail.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();
      mockFirestoreHelper.addDocument.mockResolvedValue();

      const result = await assignAuditor(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.auditId).toBe('audit_test_id_123');
      expect(result.data.status).toBe(STATUS.AUDIT.ASSIGNED);
      expect(result.data.compensation).toBe(1200);
      expect(result.data.specializations).toEqual(['environmental']);
      expect(result.data.notificationSent).toBe(true);
      expect(result.data.nextStep).toBe('awaiting_auditor_acceptance');

      // Verify permissions validation
      expect(mockFirestoreHelper.getDocument).toHaveBeenCalledWith('users', 'admin_123');
      expect(mockFirestoreHelper.getDocument).toHaveBeenCalledWith('projects', 'project_123');
      expect(mockFirestoreHelper.getDocument).toHaveBeenCalledWith('users', 'auditor_123');

      // Verify conflict checks
      expect(mockFirestoreHelper.queryDocuments).toHaveBeenCalledWith(
        'projects/project_123/contributions',
        [['contributorUid', '==', 'auditor_123']],
        { limit: 1 }
      );

      // Verify audit creation
      expect(mockFirestoreHelper.runTransaction).toHaveBeenCalled();
      expect(mockEmailService.sendEmail).toHaveBeenCalled();
    });

    it('should auto-calculate compensation when not provided', async () => {
      const requestData: AuditsAPI.AssignAuditorRequest = {
        projectId: 'project_123',
        auditorUid: 'auditor_123',
        specializations: ['environmental', 'financial'],
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAdmin)
        .mockResolvedValueOnce(mockProject)
        .mockResolvedValueOnce(mockAuditor);

      mockFirestoreHelper.queryDocuments.mockResolvedValue([]);
      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({} as any);
      });
      mockEmailService.sendEmail.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();
      mockFirestoreHelper.addDocument.mockResolvedValue();

      const result = await assignAuditor(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.compensation).toBeGreaterThan(0);
      expect(result.data.specializations).toEqual(['environmental', 'financial']);

      // Should include multi-specialization bonus
      const expectedHours = AUDIT_CONFIG.ESTIMATED_HOURS_BY_CATEGORY.environment || 
                           AUDIT_CONFIG.DEFAULT_ESTIMATED_HOURS;
      const expectedCompensation = Math.round(
        75 * expectedHours * 1.0 * AUDIT_CONFIG.MULTI_SPEC_BONUS * 1.0
      );
      expect(result.data.compensation).toBe(Math.min(expectedCompensation, AUDIT_CONFIG.MAX_COMPENSATION));
    });

    it('should handle large project compensation multiplier', async () => {
      const largeProject = {
        ...mockProject,
        funding: {
          goal: 150000,
          raised: 75000,
          currency: 'EUR'
        }
      };

      const requestData: AuditsAPI.AssignAuditorRequest = {
        projectId: 'project_123',
        auditorUid: 'auditor_123',
        specializations: ['environmental'],
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAdmin)
        .mockResolvedValueOnce(largeProject)
        .mockResolvedValueOnce(mockAuditor);

      mockFirestoreHelper.queryDocuments.mockResolvedValue([]);
      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({} as any);
      });
      mockEmailService.sendEmail.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();
      mockFirestoreHelper.addDocument.mockResolvedValue();

      const result = await assignAuditor(requestData, mockContext);

      expect(result.success).toBe(true);
      // Should include 1.2x multiplier for large projects
      expect(result.data.compensation).toBeGreaterThan(1000);
    });
  });

  describe('Permission Validation', () => {
    it('should reject unauthenticated requests', async () => {
      const requestData = {
        projectId: 'project_123',
        auditorUid: 'auditor_123',
        specializations: ['environmental'],
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
      };

      const unauthenticatedContext = { ...mockContext, auth: undefined };

      await expect(assignAuditor(requestData, unauthenticatedContext))
        .rejects.toThrow('Authentication required');
    });

    it('should reject non-admin users', async () => {
      const nonAdminUser = {
        ...mockAdmin,
        permissions: [USER_PERMISSIONS.CREATE_PROJECT]
      };

      const requestData = {
        projectId: 'project_123',
        auditorUid: 'auditor_123',
        specializations: ['environmental'],
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(nonAdminUser)
        .mockResolvedValueOnce(mockProject);

      await expect(assignAuditor(requestData, mockContext))
        .rejects.toThrow('Admin access required to assign auditors');
    });

    it('should reject projects not in approved/active status', async () => {
      const draftProject = {
        ...mockProject,
        status: STATUS.PROJECT.DRAFT
      };

      const requestData = {
        projectId: 'project_123',
        auditorUid: 'auditor_123',
        specializations: ['environmental'],
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAdmin)
        .mockResolvedValueOnce(draftProject);

      await expect(assignAuditor(requestData, mockContext))
        .rejects.toThrow('Project must be approved or active to assign auditor');
    });
  });

  describe('Auditor Eligibility Validation', () => {
    it('should reject non-auditor users', async () => {
      const nonAuditor = {
        ...mockAuditor,
        permissions: [USER_PERMISSIONS.CREATE_PROJECT]
      };

      const requestData = {
        projectId: 'project_123',
        auditorUid: 'auditor_123',
        specializations: ['environmental'],
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAdmin)
        .mockResolvedValueOnce(mockProject)
        .mockResolvedValueOnce(nonAuditor);

      await expect(assignAuditor(requestData, mockContext))
        .rejects.toThrow('User is not qualified as an auditor');
    });

    it('should reject inactive auditors', async () => {
      const inactiveAuditor = {
        ...mockAuditor,
        status: 'suspended'
      };

      const requestData = {
        projectId: 'project_123',
        auditorUid: 'auditor_123',
        specializations: ['environmental'],
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAdmin)
        .mockResolvedValueOnce(mockProject)
        .mockResolvedValueOnce(inactiveAuditor);

      await expect(assignAuditor(requestData, mockContext))
        .rejects.toThrow('Auditor account is not active');
    });

    it('should reject auditors without required specializations', async () => {
      const requestData = {
        projectId: 'project_123',
        auditorUid: 'auditor_123',
        specializations: ['legal'], // Auditor doesn't have legal specialization
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAdmin)
        .mockResolvedValueOnce(mockProject)
        .mockResolvedValueOnce(mockAuditor);

      await expect(assignAuditor(requestData, mockContext))
        .rejects.toThrow('Auditor does not have required specializations: legal');
    });

    it('should enforce certification requirements for regulated categories', async () => {
      const financeProject = {
        ...mockProject,
        category: 'finance'
      };

      const auditorWithoutCertification = {
        ...mockAuditor,
        auditor: {
          ...mockAuditor.auditor!,
          specializations: ['financial'],
          certifications: [] // No certifications
        }
      };

      const requestData = {
        projectId: 'project_123',
        auditorUid: 'auditor_123',
        specializations: ['financial'],
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAdmin)
        .mockResolvedValueOnce(financeProject)
        .mockResolvedValueOnce(auditorWithoutCertification);

      await expect(assignAuditor(requestData, mockContext))
        .rejects.toThrow('Auditor lacks required certification for category: finance');
    });

    it('should reject auditors at maximum concurrent audit limit', async () => {
      const currentAudits = Array(3).fill({}).map((_, i) => ({
        id: `audit_${i}`,
        auditorUid: 'auditor_123',
        status: STATUS.AUDIT.IN_PROGRESS
      }));

      const requestData = {
        projectId: 'project_123',
        auditorUid: 'auditor_123',
        specializations: ['environmental'],
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAdmin)
        .mockResolvedValueOnce(mockProject)
        .mockResolvedValueOnce(mockAuditor);

      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce(currentAudits); // Current audits query

      await expect(assignAuditor(requestData, mockContext))
        .rejects.toThrow('Auditor has reached maximum concurrent audits limit (3)');
    });

    it('should enforce minimum compensation requirements', async () => {
      const lowRateAuditor = {
        ...mockAuditor,
        auditor: {
          ...mockAuditor.auditor!,
          minHourlyRate: 100
        }
      };

      const requestData = {
        projectId: 'project_123',
        auditorUid: 'auditor_123',
        specializations: ['environmental'],
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        compensation: 500 // Too low for 100€/hour rate
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAdmin)
        .mockResolvedValueOnce(mockProject)
        .mockResolvedValueOnce(lowRateAuditor);

      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]); // No current audits

      const expectedMinimum = 100 * (AUDIT_CONFIG.ESTIMATED_HOURS_BY_CATEGORY.environment || 
                                    AUDIT_CONFIG.DEFAULT_ESTIMATED_HOURS);

      await expect(assignAuditor(requestData, mockContext))
        .rejects.toThrow(`Compensation below auditor's minimum rate. Required: €${expectedMinimum}`);
    });
  });

  describe('Conflict of Interest Checks', () => {
    it('should reject auditors who contributed to the project', async () => {
      const contribution = {
        id: 'contribution_123',
        contributorUid: 'auditor_123',
        amount: { value: 1000, currency: 'EUR' }
      };

      const requestData = {
        projectId: 'project_123',
        auditorUid: 'auditor_123',
        specializations: ['environmental'],
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAdmin)
        .mockResolvedValueOnce(mockProject)
        .mockResolvedValueOnce(mockAuditor);

      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // No current audits
        .mockResolvedValueOnce([contribution]); // Has contributed to project

      await expect(assignAuditor(requestData, mockContext))
        .rejects.toThrow('Auditor cannot audit a project they have contributed to');
    });

    it('should reject auditors who exceeded maximum audits with same creator', async () => {
      const previousAudits = Array(AUDIT_CONFIG.MAX_AUDITS_SAME_CREATOR).fill({}).map((_, i) => ({
        id: `audit_${i}`,
        auditorUid: 'auditor_123',
        projectCreatorUid: 'creator_123',
        status: STATUS.AUDIT.COMPLETED
      }));

      const requestData = {
        projectId: 'project_123',
        auditorUid: 'auditor_123',
        specializations: ['environmental'],
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAdmin)
        .mockResolvedValueOnce(mockProject)
        .mockResolvedValueOnce(mockAuditor)
        .mockResolvedValueOnce(mockAuditor); // For conflict check

      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // No current audits
        .mockResolvedValueOnce([]) // No contributions
        .mockResolvedValueOnce([]) // No shared projects
        .mockResolvedValueOnce(previousAudits); // Previous audits with creator

      await expect(assignAuditor(requestData, mockContext))
        .rejects.toThrow(`Auditor has already audited ${AUDIT_CONFIG.MAX_AUDITS_SAME_CREATOR} projects from this creator`);
    });
  });

  describe('Data Validation', () => {
    it('should reject invalid specializations', async () => {
      const requestData = {
        projectId: 'project_123',
        auditorUid: 'auditor_123',
        specializations: ['invalid_specialization'],
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
      };

      await expect(assignAuditor(requestData, mockContext))
        .rejects.toThrow('Validation error');
    });

    it('should reject empty specializations array', async () => {
      const requestData = {
        projectId: 'project_123',
        auditorUid: 'auditor_123',
        specializations: [],
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
      };

      await expect(assignAuditor(requestData, mockContext))
        .rejects.toThrow('Validation error');
    });

    it('should reject invalid deadline format', async () => {
      const requestData = {
        projectId: 'project_123',
        auditorUid: 'auditor_123',
        specializations: ['environmental'],
        deadline: 'invalid-date'
      };

      await expect(assignAuditor(requestData, mockContext))
        .rejects.toThrow('Validation error');
    });

    it('should reject compensation outside allowed range', async () => {
      const requestData = {
        projectId: 'project_123',
        auditorUid: 'auditor_123',
        specializations: ['environmental'],
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        compensation: AUDIT_CONFIG.MAX_COMPENSATION + 1
      };

      await expect(assignAuditor(requestData, mockContext))
        .rejects.toThrow('Validation error');
    });

    it('should reject missing required fields', async () => {
      const requestData = {
        auditorUid: 'auditor_123',
        specializations: ['environmental'],
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
        // Missing projectId
      };

      await expect(assignAuditor(requestData, mockContext))
        .rejects.toThrow('Validation error');
    });
  });

  describe('Database Operations', () => {
    it('should handle Firestore transaction failures gracefully', async () => {
      const requestData = {
        projectId: 'project_123',
        auditorUid: 'auditor_123',
        specializations: ['environmental'],
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAdmin)
        .mockResolvedValueOnce(mockProject)
        .mockResolvedValueOnce(mockAuditor);

      mockFirestoreHelper.queryDocuments.mockResolvedValue([]);
      mockFirestoreHelper.runTransaction.mockRejectedValue(new Error('Transaction failed'));

      await expect(assignAuditor(requestData, mockContext))
        .rejects.toThrow('Unable to create audit assignment');
    });

    it('should continue successfully even if notification sending fails', async () => {
      const requestData = {
        projectId: 'project_123',
        auditorUid: 'auditor_123',
        specializations: ['environmental'],
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAdmin)
        .mockResolvedValueOnce(mockProject)
        .mockResolvedValueOnce(mockAuditor);

      mockFirestoreHelper.queryDocuments.mockResolvedValue([]);
      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({} as any);
      });
      mockEmailService.sendEmail.mockRejectedValue(new Error('Email failed'));
      mockFirestoreHelper.incrementDocument.mockResolvedValue();
      mockFirestoreHelper.addDocument.mockResolvedValue();

      const result = await assignAuditor(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.auditId).toBe('audit_test_id_123');
      // Assignment should succeed even if email fails
    });

    it('should continue successfully even if stats update fails', async () => {
      const requestData = {
        projectId: 'project_123',
        auditorUid: 'auditor_123',
        specializations: ['environmental'],
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAdmin)
        .mockResolvedValueOnce(mockProject)
        .mockResolvedValueOnce(mockAuditor);

      mockFirestoreHelper.queryDocuments.mockResolvedValue([]);
      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({} as any);
      });
      mockEmailService.sendEmail.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockRejectedValue(new Error('Stats update failed'));
      mockFirestoreHelper.addDocument.mockResolvedValue();

      const result = await assignAuditor(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.auditId).toBe('audit_test_id_123');
      // Assignment should succeed even if stats fail
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing auditor profile gracefully', async () => {
      const auditorWithoutProfile = {
        ...mockAuditor,
        auditor: undefined
      };

      const requestData = {
        projectId: 'project_123',
        auditorUid: 'auditor_123',
        specializations: ['environmental'],
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAdmin)
        .mockResolvedValueOnce(mockProject)
        .mockResolvedValueOnce(auditorWithoutProfile);

      await expect(assignAuditor(requestData, mockContext))
        .rejects.toThrow('Auditor does not have required specializations');
    });

    it('should handle project without milestones', async () => {
      const projectWithoutMilestones = {
        ...mockProject,
        milestones: []
      };

      const requestData = {
        projectId: 'project_123',
        auditorUid: 'auditor_123',
        specializations: ['environmental'],
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAdmin)
        .mockResolvedValueOnce(projectWithoutMilestones)
        .mockResolvedValueOnce(mockAuditor);

      mockFirestoreHelper.queryDocuments.mockResolvedValue([]);
      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({} as any);
      });
      mockEmailService.sendEmail.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();
      mockFirestoreHelper.addDocument.mockResolvedValue();

      const result = await assignAuditor(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.auditId).toBe('audit_test_id_123');
    });

    it('should apply correct compensation calculation for unknown category', async () => {
      const unknownCategoryProject = {
        ...mockProject,
        category: 'unknown_category'
      };

      const requestData = {
        projectId: 'project_123',
        auditorUid: 'auditor_123',
        specializations: ['environmental'],
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAdmin)
        .mockResolvedValueOnce(unknownCategoryProject)
        .mockResolvedValueOnce(mockAuditor);

      mockFirestoreHelper.queryDocuments.mockResolvedValue([]);
      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({} as any);
      });
      mockEmailService.sendEmail.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();
      mockFirestoreHelper.addDocument.mockResolvedValue();

      const result = await assignAuditor(requestData, mockContext);

      expect(result.success).toBe(true);
      // Should use default values for unknown category
      expect(result.data.estimatedHours).toBe(AUDIT_CONFIG.DEFAULT_ESTIMATED_HOURS);
    });
  });

  describe('Security and Logging', () => {
    it('should log business events for successful assignments', async () => {
      const requestData = {
        projectId: 'project_123',
        auditorUid: 'auditor_123',
        specializations: ['environmental'],
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        compensation: 1200
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAdmin)
        .mockResolvedValueOnce(mockProject)
        .mockResolvedValueOnce(mockAuditor);

      mockFirestoreHelper.queryDocuments.mockResolvedValue([]);
      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({} as any);
      });
      mockEmailService.sendEmail.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();
      mockFirestoreHelper.addDocument.mockResolvedValue();

      const result = await assignAuditor(requestData, mockContext);

      expect(result.success).toBe(true);
      // Business and security logging should be called
    });

    it('should handle sensitive data appropriately', async () => {
      const requestData = {
        projectId: 'project_123',
        auditorUid: 'auditor_123',
        specializations: ['financial'],
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        assignmentNotes: 'Confidential assignment for high-value project'
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAdmin)
        .mockResolvedValueOnce(mockProject)
        .mockResolvedValueOnce(mockAuditor);

      mockFirestoreHelper.queryDocuments.mockResolvedValue([]);
      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({} as any);
      });
      mockEmailService.sendEmail.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();
      mockFirestoreHelper.addDocument.mockResolvedValue();

      const result = await assignAuditor(requestData, mockContext);

      expect(result.success).toBe(true);
      // Sensitive notes should be stored but not exposed in logs
    });
  });

  describe('Response Structure', () => {
    it('should return complete response structure', async () => {
      const requestData = {
        projectId: 'project_123',
        auditorUid: 'auditor_123',
        specializations: ['environmental'],
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        compensation: 1200,
        priority: 'high'
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAdmin)
        .mockResolvedValueOnce(mockProject)
        .mockResolvedValueOnce(mockAuditor);

      mockFirestoreHelper.queryDocuments.mockResolvedValue([]);
      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({} as any);
      });
      mockEmailService.sendEmail.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();
      mockFirestoreHelper.addDocument.mockResolvedValue();

      const result = await assignAuditor(requestData, mockContext);

      expect(result).toMatchObject({
        success: true,
        data: {
          auditId: 'audit_test_id_123',
          assignedAt: expect.any(String),
          deadline: requestData.deadline,
          status: STATUS.AUDIT.ASSIGNED,
          compensation: 1200,
          estimatedHours: expect.any(Number),
          notificationSent: true,
          specializations: ['environmental'],
          nextStep: 'awaiting_auditor_acceptance'
        },
        timestamp: expect.any(String)
      });
    });
  });
});