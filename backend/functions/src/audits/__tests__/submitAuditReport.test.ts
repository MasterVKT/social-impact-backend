/**
 * Tests for submitAuditReport Firebase Function
 * Social Finance Impact Platform
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { CallableContext } from 'firebase-functions/v1/https';
import { https } from 'firebase-functions';
import { submitAuditReport } from '../submitAuditReport';
import { firestoreHelper } from '../../utils/firestore';
import { emailService } from '../../integrations/sendgrid/emailService';
import { stripeService } from '../../integrations/stripe/stripeService';
import { UserDocument, ProjectDocument, AuditDocument } from '../../types/firestore';
import { STATUS, USER_PERMISSIONS, AUDIT_CONFIG } from '../../utils/constants';
import { AuditsAPI } from '../../types/api';

// Mock dependencies
jest.mock('../../utils/firestore');
jest.mock('../../utils/logger');
jest.mock('../../integrations/sendgrid/emailService');
jest.mock('../../integrations/stripe/stripeService');
jest.mock('../../utils/helpers', () => ({
  helpers: {
    string: {
      generateId: jest.fn((prefix: string) => `${prefix}_test_id_123`)
    }
  }
}));

const mockFirestoreHelper = firestoreHelper as jest.Mocked<typeof firestoreHelper>;
const mockEmailService = emailService as jest.Mocked<typeof emailService>;
const mockStripeService = stripeService as jest.Mocked<typeof stripeService>;

describe('submitAuditReport', () => {
  let mockContext: CallableContext;
  let mockAuditor: UserDocument;
  let mockProject: ProjectDocument;
  let mockAudit: AuditDocument;
  let mockMilestone: any;

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
        hourlyRate: 75,
        stats: {
          totalCompleted: 15,
          averageScore: 85
        }
      },
      preferences: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1
    } as UserDocument;

    mockMilestone = {
      id: 'milestone_1',
      title: 'Phase 1 - Environmental Assessment',
      status: STATUS.MILESTONE.COMPLETED,
      fundingPercentage: 30,
      targetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    };

    mockProject = {
      uid: 'project_123',
      title: 'Test Environmental Project',
      category: 'environment',
      status: STATUS.PROJECT.ACTIVE,
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
      milestones: [mockMilestone],
      settings: {
        autoReleaseOnAuditApproval: true
      },
      stripeConnectAccountId: 'acct_test123',
      audit: {
        status: STATUS.AUDIT.IN_PROGRESS,
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
      assignedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      acceptedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      status: STATUS.AUDIT.IN_PROGRESS,
      currentMilestone: 'milestone_1',
      compensation: {
        amount: 1200,
        currency: 'EUR',
        status: 'pending'
      },
      criteria: [
        {
          id: 'criterion_1',
          name: 'Environmental Impact Assessment',
          required: true,
          weight: 0.6
        },
        {
          id: 'criterion_2',
          name: 'Compliance Verification',
          required: true,
          weight: 0.4
        }
      ],
      requiredDocuments: ['environmental_study', 'permits'],
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1
    } as AuditDocument;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Successful Report Submission', () => {
    it('should submit approved audit report successfully', async () => {
      const requestData: AuditsAPI.SubmitReportRequest = {
        auditId: 'audit_123',
        milestoneId: 'milestone_1',
        decision: 'approved',
        score: 92,
        criteria: [
          {
            name: 'Environmental Impact Assessment',
            met: true,
            score: 95,
            comments: 'Excellent impact assessment with comprehensive data'
          },
          {
            name: 'Compliance Verification',
            met: true,
            score: 88,
            comments: 'All regulatory requirements met'
          }
        ],
        report: {
          summary: 'Comprehensive environmental audit conducted over 14 hours. Project demonstrates excellent environmental stewardship and compliance.',
          strengths: [
            'Thorough environmental impact assessment',
            'Strong compliance documentation',
            'Clear mitigation strategies'
          ],
          weaknesses: [],
          recommendations: [
            'Continue current environmental monitoring practices',
            'Document lessons learned for future phases'
          ],
          riskAssessment: 'low',
          confidenceLevel: 95,
          timeSpent: 14
        },
        evidence: [
          {
            type: 'document',
            name: 'Environmental Assessment Review',
            description: 'Detailed analysis of environmental impact',
            content: 'base64_encoded_document_content'
          },
          {
            type: 'image',
            name: 'Site Photos',
            description: 'Photos from site visit',
            content: 'base64_encoded_image_content'
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
        .mockResolvedValueOnce([{ // Mock contributions for escrow release
          id: 'contribution_123',
          amount: { value: 10000, currency: 'EUR' },
          status: 'confirmed',
          escrow: {
            held: true,
            releaseSchedule: [
              {
                index: 0,
                milestoneId: 'milestone_1',
                amount: 3000,
                released: false
              }
            ]
          }
        }]);

      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        const mockTransaction = {
          update: jest.fn(),
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ milestones: [mockMilestone] })
          })
        };
        await callback(mockTransaction as any);
      });

      mockFirestoreHelper.addDocument.mockResolvedValue();
      mockFirestoreHelper.updateDocument.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();
      
      mockStripeService.createTransfer.mockResolvedValue({
        id: 'tr_test123',
        amount: 3000,
        currency: 'eur'
      });

      mockEmailService.sendEmail.mockResolvedValue();

      const result = await submitAuditReport(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.reportId).toBe('report_test_id_123');
      expect(result.data.decision).toBe('approved');
      expect(result.data.score).toBe(92);
      expect(result.data.fundsReleased).toBeGreaterThan(0);
      expect(result.data.compensation.amount).toBeGreaterThan(1200); // Should include quality bonus
      expect(result.data.auditSummary.timeSpent).toBe(14);
      expect(result.data.auditSummary.criteriaEvaluated).toBe(2);
      expect(result.data.auditSummary.evidenceProvided).toBe(2);

      // Verify audit report creation
      expect(mockFirestoreHelper.addDocument).toHaveBeenCalledWith('audit_reports', expect.objectContaining({
        id: 'report_test_id_123',
        auditId: 'audit_123',
        decision: 'approved',
        overallScore: 92
      }));

      // Verify escrow release
      expect(mockStripeService.createTransfer).toHaveBeenCalled();
    });

    it('should submit rejected audit report successfully', async () => {
      const requestData: AuditsAPI.SubmitReportRequest = {
        auditId: 'audit_123',
        milestoneId: 'milestone_1',
        decision: 'rejected',
        score: 45,
        criteria: [
          {
            name: 'Environmental Impact Assessment',
            met: false,
            score: 40,
            comments: 'Insufficient environmental data provided'
          },
          {
            name: 'Compliance Verification',
            met: false,
            score: 50,
            comments: 'Missing critical regulatory approvals'
          }
        ],
        report: {
          summary: 'Audit revealed significant environmental compliance issues that must be addressed before proceeding.',
          strengths: [
            'Clear project objectives'
          ],
          weaknesses: [
            'Incomplete environmental impact assessment',
            'Missing regulatory approvals',
            'Insufficient mitigation strategies'
          ],
          recommendations: [
            'Complete comprehensive environmental impact study',
            'Obtain all required environmental permits',
            'Develop detailed mitigation plan for identified risks'
          ],
          riskAssessment: 'high',
          confidenceLevel: 90,
          timeSpent: 18
        },
        evidence: [
          {
            type: 'document',
            name: 'Compliance Gap Analysis',
            description: 'Analysis of missing compliance requirements',
            content: 'base64_encoded_analysis'
          }
        ],
        followUpRequired: true,
        followUpDeadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        additionalNotes: 'Project team should address compliance issues before resubmission'
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
        const mockTransaction = {
          update: jest.fn(),
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ milestones: [mockMilestone] })
          })
        };
        await callback(mockTransaction as any);
      });

      mockFirestoreHelper.addDocument.mockResolvedValue();
      mockFirestoreHelper.updateDocument.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();
      mockEmailService.sendEmail.mockResolvedValue();

      const result = await submitAuditReport(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.decision).toBe('rejected');
      expect(result.data.score).toBe(45);
      expect(result.data.fundsReleased).toBe(0); // No funds released for rejection
      expect(result.data.followUp?.required).toBe(true);
      expect(result.data.followUp?.deadline).toBe(requestData.followUpDeadline);
      expect(result.data.auditSummary.riskLevel).toBe('high');

      // No escrow release for rejected audits
      expect(mockStripeService.createTransfer).not.toHaveBeenCalled();
    });

    it('should handle needs revision decision', async () => {
      const requestData: AuditsAPI.SubmitReportRequest = {
        auditId: 'audit_123',
        milestoneId: 'milestone_1',
        decision: 'needs_revision',
        score: 68,
        criteria: [
          {
            name: 'Environmental Impact Assessment',
            met: true,
            score: 75,
            comments: 'Good assessment but needs more detail'
          },
          {
            name: 'Compliance Verification',
            met: false,
            score: 60,
            comments: 'Some permits need clarification'
          }
        ],
        report: {
          summary: 'Project shows promise but requires additional documentation and clarification in several areas.',
          strengths: [
            'Solid environmental framework',
            'Good initial assessment'
          ],
          weaknesses: [
            'Missing detailed implementation plans',
            'Unclear permit status'
          ],
          recommendations: [
            'Provide detailed implementation timeline',
            'Clarify permit application status',
            'Add specific measurable targets'
          ],
          riskAssessment: 'medium',
          confidenceLevel: 85,
          timeSpent: 12
        },
        followUpRequired: true,
        followUpDeadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
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
        const mockTransaction = {
          update: jest.fn(),
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ milestones: [mockMilestone] })
          })
        };
        await callback(mockTransaction as any);
      });

      mockFirestoreHelper.addDocument.mockResolvedValue();
      mockFirestoreHelper.updateDocument.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();
      mockEmailService.sendEmail.mockResolvedValue();

      const result = await submitAuditReport(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.decision).toBe('needs_revision');
      expect(result.data.score).toBe(68);
      expect(result.data.fundsReleased).toBe(0);
      expect(result.data.followUp?.required).toBe(true);
    });
  });

  describe('Permission Validation', () => {
    it('should reject unauthenticated requests', async () => {
      const requestData = {
        auditId: 'audit_123',
        milestoneId: 'milestone_1',
        decision: 'approved',
        score: 85,
        criteria: [{ name: 'Test', met: true, score: 85 }],
        report: {
          summary: 'Test summary with sufficient length for validation requirements',
          strengths: ['Good work'],
          recommendations: ['Keep it up'],
          riskAssessment: 'low',
          timeSpent: 10
        }
      };

      const unauthenticatedContext = { ...mockContext, auth: undefined };

      await expect(submitAuditReport(requestData, unauthenticatedContext))
        .rejects.toThrow('Authentication required');
    });

    it('should reject wrong auditor', async () => {
      const wrongAuditorContext = {
        ...mockContext,
        auth: { ...mockContext.auth!, uid: 'wrong_auditor_456' }
      };

      const requestData = {
        auditId: 'audit_123',
        milestoneId: 'milestone_1',
        decision: 'approved',
        score: 85,
        criteria: [{ name: 'Test', met: true, score: 85 }],
        report: {
          summary: 'Test summary with sufficient length for validation requirements',
          strengths: ['Good work'],
          recommendations: ['Keep it up'],
          riskAssessment: 'low',
          timeSpent: 10
        }
      };

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockAudit);

      await expect(submitAuditReport(requestData, wrongAuditorContext))
        .rejects.toThrow('You are not the assigned auditor for this audit');
    });

    it('should reject audits not in progress', async () => {
      const assignedAudit = {
        ...mockAudit,
        status: STATUS.AUDIT.ASSIGNED
      };

      const requestData = {
        auditId: 'audit_123',
        milestoneId: 'milestone_1',
        decision: 'approved',
        score: 85,
        criteria: [{ name: 'Test', met: true, score: 85 }],
        report: {
          summary: 'Test summary with sufficient length for validation requirements',
          strengths: ['Good work'],
          recommendations: ['Keep it up'],
          riskAssessment: 'low',
          timeSpent: 10
        }
      };

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(assignedAudit);

      await expect(submitAuditReport(requestData, mockContext))
        .rejects.toThrow('Cannot submit report for audit in status: assigned');
    });

    it('should reject milestone not found in project', async () => {
      const requestData = {
        auditId: 'audit_123',
        milestoneId: 'nonexistent_milestone',
        decision: 'approved',
        score: 85,
        criteria: [{ name: 'Test', met: true, score: 85 }],
        report: {
          summary: 'Test summary with sufficient length for validation requirements',
          strengths: ['Good work'],
          recommendations: ['Keep it up'],
          riskAssessment: 'low',
          timeSpent: 10
        }
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAudit)
        .mockResolvedValueOnce(mockAuditor)
        .mockResolvedValueOnce(mockProject);

      await expect(submitAuditReport(requestData, mockContext))
        .rejects.toThrow('Milestone not found in project');
    });

    it('should reject milestones not ready for audit', async () => {
      const projectWithPendingMilestone = {
        ...mockProject,
        milestones: [{
          ...mockMilestone,
          status: STATUS.MILESTONE.PENDING
        }]
      };

      const requestData = {
        auditId: 'audit_123',
        milestoneId: 'milestone_1',
        decision: 'approved',
        score: 85,
        criteria: [{ name: 'Test', met: true, score: 85 }],
        report: {
          summary: 'Test summary with sufficient length for validation requirements',
          strengths: ['Good work'],
          recommendations: ['Keep it up'],
          riskAssessment: 'low',
          timeSpent: 10
        }
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAudit)
        .mockResolvedValueOnce(mockAuditor)
        .mockResolvedValueOnce(projectWithPendingMilestone);

      await expect(submitAuditReport(requestData, mockContext))
        .rejects.toThrow('Milestone must be completed or submitted for audit');
    });
  });

  describe('Report Quality Validation', () => {
    it('should reject inconsistent overall score with criteria average', async () => {
      const requestData = {
        auditId: 'audit_123',
        milestoneId: 'milestone_1',
        decision: 'approved',
        score: 95, // Inconsistent with criteria average (67.5)
        criteria: [
          { name: 'Criterion 1', met: true, score: 75 },
          { name: 'Criterion 2', met: false, score: 60 }
        ],
        report: {
          summary: 'Test summary with sufficient length for validation requirements',
          strengths: ['Good work'],
          recommendations: ['Keep it up'],
          riskAssessment: 'low',
          timeSpent: 10
        }
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAudit)
        .mockResolvedValueOnce(mockAuditor)
        .mockResolvedValueOnce(mockProject);

      await expect(submitAuditReport(requestData, mockContext))
        .rejects.toThrow('Overall score (95) is inconsistent with criteria average');
    });

    it('should reject missing required criteria', async () => {
      const requestData = {
        auditId: 'audit_123',
        milestoneId: 'milestone_1',
        decision: 'approved',
        score: 85,
        criteria: [
          { name: 'Environmental Impact Assessment', met: true, score: 85 }
          // Missing 'Compliance Verification' which is required
        ],
        report: {
          summary: 'Test summary with sufficient length for validation requirements',
          strengths: ['Good work'],
          recommendations: ['Keep it up'],
          riskAssessment: 'low',
          timeSpent: 10
        }
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAudit)
        .mockResolvedValueOnce(mockAuditor)
        .mockResolvedValueOnce(mockProject);

      await expect(submitAuditReport(requestData, mockContext))
        .rejects.toThrow('Missing required criteria evaluations: Compliance Verification');
    });

    it('should reject low score for approval decision', async () => {
      const requestData = {
        auditId: 'audit_123',
        milestoneId: 'milestone_1',
        decision: 'approved',
        score: 65, // Below minimum approval score
        criteria: [
          { name: 'Environmental Impact Assessment', met: true, score: 65 },
          { name: 'Compliance Verification', met: true, score: 65 }
        ],
        report: {
          summary: 'Test summary with sufficient length for validation requirements',
          strengths: ['Good work'],
          recommendations: ['Keep it up'],
          riskAssessment: 'low',
          timeSpent: 10
        }
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAudit)
        .mockResolvedValueOnce(mockAuditor)
        .mockResolvedValueOnce(mockProject);

      await expect(submitAuditReport(requestData, mockContext))
        .rejects.toThrow(`Score too low for approval. Minimum required: ${AUDIT_CONFIG.MIN_APPROVAL_SCORE}`);
    });

    it('should reject high score for rejection decision', async () => {
      const requestData = {
        auditId: 'audit_123',
        milestoneId: 'milestone_1',
        decision: 'rejected',
        score: 85, // Too high for rejection
        criteria: [
          { name: 'Environmental Impact Assessment', met: true, score: 85 },
          { name: 'Compliance Verification', met: true, score: 85 }
        ],
        report: {
          summary: 'Test summary with sufficient length for validation requirements',
          strengths: ['Good work'],
          weaknesses: ['Some issue'],
          recommendations: ['Keep it up'],
          riskAssessment: 'low',
          timeSpent: 10
        }
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAudit)
        .mockResolvedValueOnce(mockAuditor)
        .mockResolvedValueOnce(mockProject);

      await expect(submitAuditReport(requestData, mockContext))
        .rejects.toThrow(`Score too high for rejection. Maximum for rejection: ${AUDIT_CONFIG.MAX_REJECTION_SCORE}`);
    });

    it('should require weaknesses documentation for low scores', async () => {
      const requestData = {
        auditId: 'audit_123',
        milestoneId: 'milestone_1',
        decision: 'needs_revision',
        score: 70,
        criteria: [
          { name: 'Environmental Impact Assessment', met: true, score: 70 },
          { name: 'Compliance Verification', met: true, score: 70 }
        ],
        report: {
          summary: 'Test summary with sufficient length for validation requirements',
          strengths: ['Good work'],
          weaknesses: [], // Missing weaknesses for low score
          recommendations: ['Keep it up'],
          riskAssessment: 'medium',
          timeSpent: 10
        }
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAudit)
        .mockResolvedValueOnce(mockAuditor)
        .mockResolvedValueOnce(mockProject);

      await expect(submitAuditReport(requestData, mockContext))
        .rejects.toThrow('Weaknesses must be documented for scores below 75');
    });

    it('should require sufficient recommendations for revision requests', async () => {
      const requestData = {
        auditId: 'audit_123',
        milestoneId: 'milestone_1',
        decision: 'needs_revision',
        score: 68,
        criteria: [
          { name: 'Environmental Impact Assessment', met: true, score: 68 },
          { name: 'Compliance Verification', met: true, score: 68 }
        ],
        report: {
          summary: 'Test summary with sufficient length for validation requirements',
          strengths: ['Good work'],
          weaknesses: ['Needs improvement'],
          recommendations: ['One recommendation only'], // Need at least 2
          riskAssessment: 'medium',
          timeSpent: 10
        }
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAudit)
        .mockResolvedValueOnce(mockAuditor)
        .mockResolvedValueOnce(mockProject);

      await expect(submitAuditReport(requestData, mockContext))
        .rejects.toThrow('At least 2 recommendations required when requesting revisions');
    });
  });

  describe('Data Validation', () => {
    it('should reject missing required fields', async () => {
      const requestData = {
        auditId: 'audit_123',
        // Missing milestoneId, decision, score, criteria, report
      };

      await expect(submitAuditReport(requestData, mockContext))
        .rejects.toThrow('Validation error');
    });

    it('should reject invalid score range', async () => {
      const requestData = {
        auditId: 'audit_123',
        milestoneId: 'milestone_1',
        decision: 'approved',
        score: 150, // Out of range
        criteria: [{ name: 'Test', met: true, score: 85 }],
        report: {
          summary: 'Test summary with sufficient length for validation requirements',
          strengths: ['Good work'],
          recommendations: ['Keep it up'],
          riskAssessment: 'low',
          timeSpent: 10
        }
      };

      await expect(submitAuditReport(requestData, mockContext))
        .rejects.toThrow('Validation error');
    });

    it('should reject invalid decision values', async () => {
      const requestData = {
        auditId: 'audit_123',
        milestoneId: 'milestone_1',
        decision: 'invalid_decision',
        score: 85,
        criteria: [{ name: 'Test', met: true, score: 85 }],
        report: {
          summary: 'Test summary with sufficient length for validation requirements',
          strengths: ['Good work'],
          recommendations: ['Keep it up'],
          riskAssessment: 'low',
          timeSpent: 10
        }
      };

      await expect(submitAuditReport(requestData, mockContext))
        .rejects.toThrow('Validation error');
    });

    it('should reject short report summary', async () => {
      const requestData = {
        auditId: 'audit_123',
        milestoneId: 'milestone_1',
        decision: 'approved',
        score: 85,
        criteria: [{ name: 'Test', met: true, score: 85 }],
        report: {
          summary: 'Too short', // Less than 50 characters
          strengths: ['Good work'],
          recommendations: ['Keep it up'],
          riskAssessment: 'low',
          timeSpent: 10
        }
      };

      await expect(submitAuditReport(requestData, mockContext))
        .rejects.toThrow('Validation error');
    });

    it('should enforce minimum confidence level', async () => {
      const requestData = {
        auditId: 'audit_123',
        milestoneId: 'milestone_1',
        decision: 'approved',
        score: 85,
        criteria: [{ name: 'Test', met: true, score: 85 }],
        report: {
          summary: 'Test summary with sufficient length for validation requirements',
          strengths: ['Good work'],
          recommendations: ['Keep it up'],
          riskAssessment: 'low',
          confidenceLevel: 60, // Below minimum of 70
          timeSpent: 10
        }
      };

      await expect(submitAuditReport(requestData, mockContext))
        .rejects.toThrow('Validation error');
    });
  });

  describe('Compensation Calculation', () => {
    it('should apply quality bonus for high scores', async () => {
      const requestData: AuditsAPI.SubmitReportRequest = {
        auditId: 'audit_123',
        milestoneId: 'milestone_1',
        decision: 'approved',
        score: 95, // High quality score
        criteria: [
          { name: 'Environmental Impact Assessment', met: true, score: 95 },
          { name: 'Compliance Verification', met: true, score: 95 }
        ],
        report: {
          summary: 'Exceptional audit work with comprehensive analysis and detailed findings throughout the assessment process.',
          strengths: ['Outstanding thoroughness', 'Excellent documentation', 'Clear recommendations'],
          recommendations: ['Maintain current standards', 'Document best practices'],
          riskAssessment: 'low',
          timeSpent: 12
        }
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
        const mockTransaction = {
          update: jest.fn(),
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ milestones: [mockMilestone] })
          })
        };
        await callback(mockTransaction as any);
      });

      mockFirestoreHelper.addDocument.mockResolvedValue();
      mockFirestoreHelper.updateDocument.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();
      mockEmailService.sendEmail.mockResolvedValue();

      const result = await submitAuditReport(requestData, mockContext);

      expect(result.success).toBe(true);
      // Should include 10% quality bonus for score >= 90
      expect(result.data.compensation.amount).toBeGreaterThan(1200);
    });

    it('should apply timing bonus for early completion', async () => {
      // Set audit with deadline far in future to simulate early completion
      const earlyAudit = {
        ...mockAudit,
        deadline: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString() // 10 days from now
      };

      const requestData: AuditsAPI.SubmitReportRequest = {
        auditId: 'audit_123',
        milestoneId: 'milestone_1',
        decision: 'approved',
        score: 85,
        criteria: [
          { name: 'Environmental Impact Assessment', met: true, score: 85 },
          { name: 'Compliance Verification', met: true, score: 85 }
        ],
        report: {
          summary: 'Comprehensive audit completed ahead of schedule with thorough analysis and clear recommendations.',
          strengths: ['Efficient completion', 'Thorough analysis'],
          recommendations: ['Continue best practices'],
          riskAssessment: 'low',
          timeSpent: 10
        }
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(earlyAudit)
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
        const mockTransaction = {
          update: jest.fn(),
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ milestones: [mockMilestone] })
          })
        };
        await callback(mockTransaction as any);
      });

      mockFirestoreHelper.addDocument.mockResolvedValue();
      mockFirestoreHelper.updateDocument.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();
      mockEmailService.sendEmail.mockResolvedValue();

      const result = await submitAuditReport(requestData, mockContext);

      expect(result.success).toBe(true);
      // Should include timing bonus for early completion
      expect(result.data.compensation.amount).toBeGreaterThan(1200);
    });

    it('should apply quality penalty for low scores', async () => {
      const requestData: AuditsAPI.SubmitReportRequest = {
        auditId: 'audit_123',
        milestoneId: 'milestone_1',
        decision: 'needs_revision',
        score: 70, // Low quality score
        criteria: [
          { name: 'Environmental Impact Assessment', met: true, score: 70 },
          { name: 'Compliance Verification', met: true, score: 70 }
        ],
        report: {
          summary: 'Audit completed but with some quality concerns that need to be addressed in future assessments.',
          strengths: ['Basic compliance'],
          weaknesses: ['Limited analysis depth'],
          recommendations: ['Improve analysis depth', 'Add more detailed documentation'],
          riskAssessment: 'medium',
          timeSpent: 8
        }
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
        const mockTransaction = {
          update: jest.fn(),
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ milestones: [mockMilestone] })
          })
        };
        await callback(mockTransaction as any);
      });

      mockFirestoreHelper.addDocument.mockResolvedValue();
      mockFirestoreHelper.updateDocument.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();
      mockEmailService.sendEmail.mockResolvedValue();

      const result = await submitAuditReport(requestData, mockContext);

      expect(result.success).toBe(true);
      // Should include quality penalty for score < 75
      expect(result.data.compensation.amount).toBeLessThan(1200);
    });
  });

  describe('Fund Release Processing', () => {
    it('should release funds automatically for approved audits', async () => {
      const requestData: AuditsAPI.SubmitReportRequest = {
        auditId: 'audit_123',
        milestoneId: 'milestone_1',
        decision: 'approved',
        score: 85,
        criteria: [
          { name: 'Environmental Impact Assessment', met: true, score: 85 },
          { name: 'Compliance Verification', met: true, score: 85 }
        ],
        report: {
          summary: 'Comprehensive audit with satisfactory results and clear recommendations for project continuation.',
          strengths: ['Good compliance', 'Clear documentation'],
          recommendations: ['Continue monitoring'],
          riskAssessment: 'low',
          timeSpent: 12
        }
      };

      const mockContributions = [
        {
          id: 'contribution_123',
          amount: { value: 10000, currency: 'EUR' },
          status: 'confirmed',
          escrow: {
            held: true,
            releaseSchedule: [
              {
                index: 0,
                milestoneId: 'milestone_1',
                amount: 3000,
                released: false
              }
            ]
          }
        }
      ];

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

      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // Admin users
        .mockResolvedValueOnce(mockContributions); // Contributions for escrow

      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        const mockTransaction = {
          update: jest.fn(),
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ milestones: [mockMilestone] })
          })
        };
        await callback(mockTransaction as any);
      });

      mockStripeService.createTransfer.mockResolvedValue({
        id: 'tr_test123',
        amount: 3000
      });

      mockFirestoreHelper.addDocument.mockResolvedValue();
      mockFirestoreHelper.updateDocument.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();
      mockEmailService.sendEmail.mockResolvedValue();

      const result = await submitAuditReport(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.fundsReleased).toBe(3000);
      expect(mockStripeService.createTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 3000,
          currency: 'eur',
          destination: 'acct_test123'
        })
      );
    });

    it('should skip fund release when auto-release is disabled', async () => {
      const projectWithoutAutoRelease = {
        ...mockProject,
        settings: {
          autoReleaseOnAuditApproval: false
        }
      };

      const requestData: AuditsAPI.SubmitReportRequest = {
        auditId: 'audit_123',
        milestoneId: 'milestone_1',
        decision: 'approved',
        score: 85,
        criteria: [
          { name: 'Environmental Impact Assessment', met: true, score: 85 },
          { name: 'Compliance Verification', met: true, score: 85 }
        ],
        report: {
          summary: 'Comprehensive audit with satisfactory results and clear recommendations for project continuation.',
          strengths: ['Good compliance'],
          recommendations: ['Continue monitoring'],
          riskAssessment: 'low',
          timeSpent: 12
        }
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAudit)
        .mockResolvedValueOnce(mockAuditor)
        .mockResolvedValueOnce(projectWithoutAutoRelease)
        .mockResolvedValueOnce({
          uid: 'creator_123',
          email: 'creator@test.com',
          firstName: 'Project',
          lastName: 'Creator'
        } as UserDocument);

      mockFirestoreHelper.queryDocuments.mockResolvedValue([]);
      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        const mockTransaction = {
          update: jest.fn(),
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ milestones: [mockMilestone] })
          })
        };
        await callback(mockTransaction as any);
      });

      mockFirestoreHelper.addDocument.mockResolvedValue();
      mockFirestoreHelper.updateDocument.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();
      mockEmailService.sendEmail.mockResolvedValue();

      const result = await submitAuditReport(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.fundsReleased).toBe(0);
      expect(mockStripeService.createTransfer).not.toHaveBeenCalled();
    });
  });

  describe('Response Structure', () => {
    it('should return complete response with all required fields', async () => {
      const requestData: AuditsAPI.SubmitReportRequest = {
        auditId: 'audit_123',
        milestoneId: 'milestone_1',
        decision: 'approved',
        score: 85,
        criteria: [
          { name: 'Environmental Impact Assessment', met: true, score: 85 },
          { name: 'Compliance Verification', met: true, score: 85 }
        ],
        report: {
          summary: 'Comprehensive environmental audit with satisfactory results and clear pathway forward.',
          strengths: ['Strong environmental framework', 'Good compliance'],
          recommendations: ['Continue monitoring', 'Document lessons learned'],
          riskAssessment: 'low',
          confidenceLevel: 90,
          timeSpent: 12
        },
        evidence: [
          {
            type: 'document',
            name: 'Audit Evidence',
            content: 'evidence_content'
          }
        ]
      };

      const nextMilestone = {
        id: 'milestone_2',
        title: 'Phase 2',
        status: STATUS.MILESTONE.COMPLETED,
        targetDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString()
      };

      const projectWithNextMilestone = {
        ...mockProject,
        milestones: [mockMilestone, nextMilestone]
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAudit)
        .mockResolvedValueOnce(mockAuditor)
        .mockResolvedValueOnce(projectWithNextMilestone)
        .mockResolvedValueOnce({
          uid: 'creator_123',
          email: 'creator@test.com',
          firstName: 'Project',
          lastName: 'Creator'
        } as UserDocument);

      mockFirestoreHelper.queryDocuments.mockResolvedValue([]);
      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        const mockTransaction = {
          update: jest.fn(),
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ milestones: [mockMilestone, nextMilestone] })
          })
        };
        await callback(mockTransaction as any);
      });

      mockFirestoreHelper.addDocument.mockResolvedValue();
      mockFirestoreHelper.updateDocument.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();
      mockEmailService.sendEmail.mockResolvedValue();

      const result = await submitAuditReport(requestData, mockContext);

      expect(result).toMatchObject({
        success: true,
        data: {
          reportId: 'report_test_id_123',
          submittedAt: expect.any(String),
          decision: 'approved',
          score: 85,
          fundsReleased: expect.any(Number),
          nextMilestone: {
            id: 'milestone_2',
            title: 'Phase 2',
            status: STATUS.MILESTONE.COMPLETED
          },
          compensation: {
            amount: expect.any(Number),
            status: 'calculated',
            estimatedPayment: expect.any(String)
          },
          auditSummary: {
            timeSpent: 12,
            criteriaEvaluated: 2,
            evidenceProvided: 1,
            riskLevel: 'low',
            confidenceLevel: 90
          }
        },
        timestamp: expect.any(String)
      });
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle late audit submission gracefully', async () => {
      const overdueAudit = {
        ...mockAudit,
        deadline: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() // Yesterday
      };

      const requestData: AuditsAPI.SubmitReportRequest = {
        auditId: 'audit_123',
        milestoneId: 'milestone_1',
        decision: 'approved',
        score: 85,
        criteria: [
          { name: 'Environmental Impact Assessment', met: true, score: 85 }
        ],
        report: {
          summary: 'Late audit submission but comprehensive analysis completed despite deadline.',
          strengths: ['Thorough work'],
          recommendations: ['Improve timing'],
          riskAssessment: 'low',
          timeSpent: 15
        }
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(overdueAudit)
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
        const mockTransaction = {
          update: jest.fn(),
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ milestones: [mockMilestone] })
          })
        };
        await callback(mockTransaction as any);
      });

      mockFirestoreHelper.addDocument.mockResolvedValue();
      mockFirestoreHelper.updateDocument.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();
      mockEmailService.sendEmail.mockResolvedValue();

      const result = await submitAuditReport(requestData, mockContext);

      expect(result.success).toBe(true);
      // Should process but log warning about late submission
    });

    it('should handle partial escrow release failures gracefully', async () => {
      const requestData: AuditsAPI.SubmitReportRequest = {
        auditId: 'audit_123',
        milestoneId: 'milestone_1',
        decision: 'approved',
        score: 85,
        criteria: [
          { name: 'Environmental Impact Assessment', met: true, score: 85 }
        ],
        report: {
          summary: 'Comprehensive audit with clear recommendations for continued progress.',
          strengths: ['Good work'],
          recommendations: ['Continue progress'],
          riskAssessment: 'low',
          timeSpent: 12
        }
      };

      const mockContributions = [
        {
          id: 'contribution_123',
          escrow: {
            releaseSchedule: [
              { index: 0, milestoneId: 'milestone_1', amount: 3000, released: false }
            ]
          }
        }
      ];

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

      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // Admin users
        .mockResolvedValueOnce(mockContributions); // Contributions

      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        const mockTransaction = {
          update: jest.fn(),
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ milestones: [mockMilestone] })
          })
        };
        await callback(mockTransaction as any);
      });

      // Stripe transfer fails
      mockStripeService.createTransfer.mockRejectedValue(new Error('Transfer failed'));

      mockFirestoreHelper.addDocument.mockResolvedValue();
      mockFirestoreHelper.updateDocument.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();
      mockEmailService.sendEmail.mockResolvedValue();

      const result = await submitAuditReport(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.fundsReleased).toBe(0); // Should be 0 due to transfer failure
      // Function should continue successfully even with transfer failures
    });

    it('should continue if compensation calculation fails', async () => {
      const requestData: AuditsAPI.SubmitReportRequest = {
        auditId: 'audit_123',
        milestoneId: 'milestone_1',
        decision: 'approved',
        score: 85,
        criteria: [
          { name: 'Environmental Impact Assessment', met: true, score: 85 }
        ],
        report: {
          summary: 'Audit completed successfully with clear findings and actionable recommendations.',
          strengths: ['Good work'],
          recommendations: ['Continue progress'],
          riskAssessment: 'low',
          timeSpent: 12
        }
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
        const mockTransaction = {
          update: jest.fn(),
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ milestones: [mockMilestone] })
          })
        };
        await callback(mockTransaction as any);
      });

      mockFirestoreHelper.addDocument
        .mockResolvedValueOnce() // Report creation
        .mockRejectedValueOnce(new Error('Compensation calc failed')); // Compensation fails

      mockFirestoreHelper.updateDocument.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();
      mockEmailService.sendEmail.mockResolvedValue();

      const result = await submitAuditReport(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.compensation.status).toBe('pending');
      expect(result.data.compensation.amount).toBe(1200); // Fallback to original amount
    });
  });
});