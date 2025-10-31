/**
 * Release Escrow Tests
 * Social Finance Impact Platform
 */

import { releaseEscrow } from '../releaseEscrow';
import { CallableContext } from 'firebase-functions/v1/https';
import { https } from 'firebase-functions';
import { logger } from '../../utils/logger';
import { firestoreHelper } from '../../utils/firestore';
import { stripeService } from '../../integrations/stripe/stripeService';
import { emailService } from '../../integrations/sendgrid/emailService';
import { helpers } from '../../utils/helpers';
import { STATUS, USER_PERMISSIONS, PAYMENT_CONFIG } from '../../utils/constants';
import { PaymentsAPI } from '../../types/api';
import { UserDocument, ProjectDocument, ContributionDocument } from '../../types/firestore';

// Mocks
jest.mock('../../utils/logger');
jest.mock('../../utils/firestore');
jest.mock('../../integrations/stripe/stripeService');
jest.mock('../../integrations/sendgrid/emailService');
jest.mock('../../utils/helpers');

describe('releaseEscrow', () => {
  let mockContext: CallableContext;
  let mockAdminUser: UserDocument;
  let mockCreatorUser: UserDocument;
  let mockProject: ProjectDocument;
  let mockContributions: ContributionDocument[];
  let mockStripeTransfer: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockContext = {
      auth: {
        uid: 'creator123',
        token: { email: 'creator@example.com' }
      },
      rawRequest: { ip: '127.0.0.1' }
    };

    mockAdminUser = {
      uid: 'admin123',
      email: 'admin@example.com',
      firstName: 'Admin',
      lastName: 'User',
      permissions: [USER_PERMISSIONS.MODERATE_PROJECTS, USER_PERMISSIONS.RELEASE_ESCROW]
    } as UserDocument;

    mockCreatorUser = {
      uid: 'creator123',
      email: 'creator@example.com',
      firstName: 'Creator',
      lastName: 'User',
      userType: 'creator',
      permissions: []
    } as UserDocument;

    mockProject = {
      uid: 'project123',
      title: 'Test Project',
      slug: 'test-project',
      status: STATUS.PROJECT.ACTIVE,
      creatorUid: 'creator123',
      category: 'environment',
      stripeConnectAccountId: 'acct_creator123',
      funding: {
        raised: 50000,
        currency: 'EUR'
      },
      milestones: [
        {
          id: 'milestone1',
          title: 'Phase 1',
          status: STATUS.MILESTONE.COMPLETED,
          fundingPercentage: 40,
          auditRequired: true,
          auditStatus: STATUS.AUDIT.APPROVED
        },
        {
          id: 'milestone2',
          title: 'Phase 2',
          status: STATUS.MILESTONE.IN_PROGRESS,
          fundingPercentage: 60,
          auditRequired: false
        }
      ]
    } as ProjectDocument;

    mockContributions = [
      {
        id: 'contrib123',
        projectId: 'project123',
        contributorUid: 'user123',
        amount: {
          gross: 10000,
          net: 9200,
          currency: 'EUR'
        },
        status: 'confirmed',
        escrow: {
          held: true,
          heldAmount: 9200,
          releaseSchedule: [
            {
              milestoneId: 'milestone1',
              amount: 3680,
              releaseCondition: 'milestone_completion',
              released: false
            },
            {
              milestoneId: 'milestone2',
              amount: 5520,
              releaseCondition: 'milestone_completion',
              released: false
            }
          ]
        },
        anonymous: false
      },
      {
        id: 'contrib456',
        projectId: 'project123',
        contributorUid: 'user456',
        amount: {
          gross: 5000,
          net: 4600,
          currency: 'EUR'
        },
        status: 'confirmed',
        escrow: {
          held: true,
          heldAmount: 4600,
          releaseSchedule: [
            {
              milestoneId: 'milestone1',
              amount: 1840,
              releaseCondition: 'milestone_completion',
              released: false
            },
            {
              milestoneId: 'milestone2',
              amount: 2760,
              releaseCondition: 'milestone_completion',
              released: false
            }
          ]
        },
        anonymous: true
      }
    ] as ContributionDocument[];

    mockStripeTransfer = {
      id: 'tr_test123',
      status: 'paid',
      amount: 3680,
      destination: 'acct_creator123'
    };

    // Setup default mocks
    (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
      if (collection === 'users' && id === 'creator123') return Promise.resolve(mockCreatorUser);
      if (collection === 'users' && id === 'admin123') return Promise.resolve(mockAdminUser);
      if (collection === 'users' && id === 'user123') return Promise.resolve({ uid: 'user123', email: 'user@example.com', firstName: 'John', lastName: 'Doe' });
      if (collection === 'projects') return Promise.resolve(mockProject);
      return Promise.resolve({});
    });

    (firestoreHelper.queryDocuments as jest.Mock).mockResolvedValue(mockContributions);
    (stripeService.createTransfer as jest.Mock).mockResolvedValue(mockStripeTransfer);
    (helpers.string.generateId as jest.Mock).mockReturnValue('release123');
    (emailService.sendEmail as jest.Mock).mockResolvedValue(true);
    (firestoreHelper.incrementDocument as jest.Mock).mockResolvedValue(true);

    (firestoreHelper.runTransaction as jest.Mock).mockImplementation(async (callback) => {
      const mockTransaction = {
        update: jest.fn(),
        set: jest.fn()
      };
      return await callback(mockTransaction);
    });
  });

  describe('Authentication & Authorization', () => {
    it('should reject unauthenticated requests', async () => {
      const contextWithoutAuth = { ...mockContext, auth: undefined };
      const data = {
        releaseType: 'milestone_completion',
        projectId: 'project123',
        milestoneId: 'milestone1'
      };

      await expect(releaseEscrow(data, contextWithoutAuth))
        .rejects
        .toThrow('Authentication required');
    });

    it('should validate creator permissions for milestone releases', async () => {
      const data = {
        releaseType: 'milestone_completion',
        projectId: 'project123',
        milestoneId: 'milestone1'
      };

      const result = await releaseEscrow(data, mockContext);
      expect(result.success).toBe(true);
    });

    it('should validate admin permissions for emergency releases', async () => {
      const contextAsAdmin = { 
        ...mockContext, 
        auth: { uid: 'admin123', token: {} }
      };

      const data = {
        releaseType: 'emergency_release',
        projectId: 'project123',
        releaseReason: 'Emergency situation requires immediate fund release'
      };

      const result = await releaseEscrow(data, contextAsAdmin);
      expect(result.success).toBe(true);
    });

    it('should reject emergency release without admin access', async () => {
      const data = {
        releaseType: 'emergency_release',
        projectId: 'project123',
        releaseReason: 'Emergency situation'
      };

      await expect(releaseEscrow(data, mockContext))
        .rejects
        .toThrow('Admin access required for emergency escrow release');
    });

    it('should validate auditor permissions for milestone releases', async () => {
      const auditorUser = {
        ...mockCreatorUser,
        uid: 'auditor123',
        permissions: [USER_PERMISSIONS.AUDIT_PROJECT]
      };

      const contextAsAuditor = { 
        ...mockContext, 
        auth: { uid: 'auditor123', token: {} }
      };

      (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
        if (collection === 'users' && id === 'auditor123') return Promise.resolve(auditorUser);
        if (collection === 'projects') return Promise.resolve(mockProject);
        return Promise.resolve({});
      });

      const data = {
        releaseType: 'milestone_completion',
        projectId: 'project123',
        milestoneId: 'milestone1'
      };

      const result = await releaseEscrow(data, contextAsAuditor);
      expect(result.success).toBe(true);
    });
  });

  describe('Validation', () => {
    it('should validate required fields', async () => {
      const invalidData = {
        projectId: 'project123'
        // Missing releaseType
      };

      await expect(releaseEscrow(invalidData, mockContext))
        .rejects
        .toThrow();
    });

    it('should require milestone ID for milestone releases', async () => {
      const data = {
        releaseType: 'milestone_completion',
        projectId: 'project123'
        // Missing milestoneId
      };

      await expect(releaseEscrow(data, mockContext))
        .rejects
        .toThrow();
    });

    it('should require release reason for emergency releases', async () => {
      const contextAsAdmin = { 
        ...mockContext, 
        auth: { uid: 'admin123', token: {} }
      };

      const data = {
        releaseType: 'emergency_release',
        projectId: 'project123'
        // Missing releaseReason
      };

      await expect(releaseEscrow(data, contextAsAdmin))
        .rejects
        .toThrow();
    });

    it('should validate release reason length', async () => {
      const contextAsAdmin = { 
        ...mockContext, 
        auth: { uid: 'admin123', token: {} }
      };

      const data = {
        releaseType: 'emergency_release',
        projectId: 'project123',
        releaseReason: 'Short' // Too short
      };

      await expect(releaseEscrow(data, contextAsAdmin))
        .rejects
        .toThrow();
    });
  });

  describe('Milestone Release Conditions', () => {
    it('should release escrow for completed milestone', async () => {
      const data = {
        releaseType: 'milestone_completion',
        projectId: 'project123',
        milestoneId: 'milestone1'
      };

      const result = await releaseEscrow(data, mockContext);

      expect(result.totalReleased).toBeGreaterThan(0);
      expect(result.successful).toBe(2); // Two contributions
      expect(stripeService.createTransfer).toHaveBeenCalledTimes(2);
    });

    it('should reject release for incomplete milestone', async () => {
      const projectWithIncompleteMilestone = {
        ...mockProject,
        milestones: [
          {
            id: 'milestone1',
            title: 'Phase 1',
            status: STATUS.MILESTONE.IN_PROGRESS, // Not completed
            fundingPercentage: 40
          }
        ]
      };

      (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
        if (collection === 'projects') return Promise.resolve(projectWithIncompleteMilestone);
        return Promise.resolve(mockCreatorUser);
      });

      const data = {
        releaseType: 'milestone_completion',
        projectId: 'project123',
        milestoneId: 'milestone1'
      };

      await expect(releaseEscrow(data, mockContext))
        .rejects
        .toThrow('Milestone must be completed before escrow release');
    });

    it('should check audit status for audited milestones', async () => {
      const projectWithPendingAudit = {
        ...mockProject,
        milestones: [
          {
            id: 'milestone1',
            title: 'Phase 1',
            status: STATUS.MILESTONE.COMPLETED,
            fundingPercentage: 40,
            auditRequired: true,
            auditStatus: STATUS.AUDIT.PENDING // Not approved
          }
        ]
      };

      (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
        if (collection === 'projects') return Promise.resolve(projectWithPendingAudit);
        return Promise.resolve(mockCreatorUser);
      });

      const data = {
        releaseType: 'milestone_completion',
        projectId: 'project123',
        milestoneId: 'milestone1'
      };

      await expect(releaseEscrow(data, mockContext))
        .rejects
        .toThrow('Milestone audit must be approved before escrow release');
    });

    it('should allow bypass of audit checks with admin override', async () => {
      const contextAsAdmin = { 
        ...mockContext, 
        auth: { uid: 'admin123', token: {} }
      };

      const projectWithPendingAudit = {
        ...mockProject,
        milestones: [
          {
            id: 'milestone1',
            title: 'Phase 1',
            status: STATUS.MILESTONE.COMPLETED,
            fundingPercentage: 40,
            auditRequired: true,
            auditStatus: STATUS.AUDIT.PENDING
          }
        ]
      };

      (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
        if (collection === 'users' && id === 'admin123') return Promise.resolve(mockAdminUser);
        if (collection === 'projects') return Promise.resolve(projectWithPendingAudit);
        return Promise.resolve({});
      });

      const data = {
        releaseType: 'milestone_completion',
        projectId: 'project123',
        milestoneId: 'milestone1',
        bypassSafetyChecks: true
      };

      const result = await releaseEscrow(data, contextAsAdmin);
      expect(result.success).toBe(true);
    });

    it('should handle milestone not found', async () => {
      const data = {
        releaseType: 'milestone_completion',
        projectId: 'project123',
        milestoneId: 'nonexistent_milestone'
      };

      await expect(releaseEscrow(data, mockContext))
        .rejects
        .toThrow('Milestone not found');
    });
  });

  describe('Project Completion Release', () => {
    it('should release all escrow on project completion', async () => {
      const completedProject = { 
        ...mockProject, 
        status: STATUS.PROJECT.COMPLETED,
        milestones: mockProject.milestones.map(m => ({ 
          ...m, 
          status: STATUS.MILESTONE.COMPLETED 
        }))
      };

      (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
        if (collection === 'projects') return Promise.resolve(completedProject);
        return Promise.resolve(mockCreatorUser);
      });

      const data = {
        releaseType: 'project_completion',
        projectId: 'project123'
      };

      const result = await releaseEscrow(data, mockContext);

      expect(result.totalReleased).toBeGreaterThan(0);
      expect(result.successful).toBe(2);
    });

    it('should reject release for incomplete project', async () => {
      const incompleteProject = { 
        ...mockProject, 
        status: STATUS.PROJECT.ACTIVE // Not completed
      };

      (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
        if (collection === 'projects') return Promise.resolve(incompleteProject);
        return Promise.resolve(mockCreatorUser);
      });

      const data = {
        releaseType: 'project_completion',
        projectId: 'project123'
      };

      await expect(releaseEscrow(data, mockContext))
        .rejects
        .toThrow('Project must be completed before full escrow release');
    });

    it('should check all milestones are completed', async () => {
      const projectWithIncompleteMilestones = {
        ...mockProject,
        status: STATUS.PROJECT.COMPLETED,
        milestones: [
          { ...mockProject.milestones[0], status: STATUS.MILESTONE.COMPLETED },
          { ...mockProject.milestones[1], status: STATUS.MILESTONE.IN_PROGRESS }
        ]
      };

      (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
        if (collection === 'projects') return Promise.resolve(projectWithIncompleteMilestones);
        return Promise.resolve(mockCreatorUser);
      });

      const data = {
        releaseType: 'project_completion',
        projectId: 'project123'
      };

      await expect(releaseEscrow(data, mockContext))
        .rejects
        .toThrow('All milestones must be completed before full escrow release');
    });
  });

  describe('Emergency Release', () => {
    it('should allow emergency release with admin access', async () => {
      const contextAsAdmin = { 
        ...mockContext, 
        auth: { uid: 'admin123', token: {} }
      };

      const data = {
        releaseType: 'emergency_release',
        projectId: 'project123',
        releaseReason: 'Emergency situation requiring immediate fund access'
      };

      const result = await releaseEscrow(data, contextAsAdmin);

      expect(result.success).toBe(true);
      expect(result.totalReleased).toBeGreaterThan(0);
    });

    it('should allow admin override without safety checks', async () => {
      const contextAsAdmin = { 
        ...mockContext, 
        auth: { uid: 'admin123', token: {} }
      };

      const data = {
        releaseType: 'admin_override',
        projectId: 'project123',
        releaseReason: 'Administrative override for special circumstances',
        bypassSafetyChecks: true
      };

      const result = await releaseEscrow(data, contextAsAdmin);

      expect(result.success).toBe(true);
    });
  });

  describe('Stripe Transfer Creation', () => {
    it('should create Stripe transfers for each contribution', async () => {
      const data = {
        releaseType: 'milestone_completion',
        projectId: 'project123',
        milestoneId: 'milestone1'
      };

      await releaseEscrow(data, mockContext);

      expect(stripeService.createTransfer).toHaveBeenCalledTimes(2);
      expect(stripeService.createTransfer).toHaveBeenCalledWith({
        amount: 3680, // 40% of first contribution
        currency: 'eur',
        destination: 'acct_creator123',
        description: 'Escrow release: Test Project - milestone_completion',
        metadata: expect.objectContaining({
          contributionId: 'contrib123',
          projectId: 'project123',
          releaseType: 'milestone_completion',
          milestoneId: 'milestone1'
        })
      });
    });

    it('should handle transfer batch processing', async () => {
      // Create many contributions
      const manyContributions = Array.from({ length: 12 }, (_, i) => ({
        ...mockContributions[0],
        id: `contrib${i}`,
        contributorUid: `user${i}`
      }));
      
      (firestoreHelper.queryDocuments as jest.Mock).mockResolvedValue(manyContributions);

      const data = {
        releaseType: 'milestone_completion',
        projectId: 'project123',
        milestoneId: 'milestone1'
      };

      const result = await releaseEscrow(data, mockContext);

      expect(result.successful).toBe(12);
      expect(stripeService.createTransfer).toHaveBeenCalledTimes(12);
    });

    it('should handle transfer failures gracefully', async () => {
      (stripeService.createTransfer as jest.Mock)
        .mockResolvedValueOnce(mockStripeTransfer)
        .mockRejectedValueOnce(new Error('Transfer failed'));

      const data = {
        releaseType: 'milestone_completion',
        projectId: 'project123',
        milestoneId: 'milestone1'
      };

      const result = await releaseEscrow(data, mockContext);

      expect(result.successful).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.totalProcessed).toBe(2);
    });

    it('should use fallback account if no Connect account', async () => {
      const projectWithoutConnect = { 
        ...mockProject, 
        stripeConnectAccountId: undefined 
      };

      (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
        if (collection === 'projects') return Promise.resolve(projectWithoutConnect);
        return Promise.resolve(mockCreatorUser);
      });

      const data = {
        releaseType: 'milestone_completion',
        projectId: 'project123',
        milestoneId: 'milestone1'
      };

      await releaseEscrow(data, mockContext);

      expect(stripeService.createTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          destination: process.env.STRIPE_CREATOR_ACCOUNT_ID
        })
      );
    });
  });

  describe('Document Updates', () => {
    it('should update contribution escrow schedule', async () => {
      const data = {
        releaseType: 'milestone_completion',
        projectId: 'project123',
        milestoneId: 'milestone1'
      };

      await releaseEscrow(data, mockContext);

      expect(firestoreHelper.runTransaction).toHaveBeenCalled();
      
      const transactionCallback = (firestoreHelper.runTransaction as jest.Mock).mock.calls[0][0];
      const mockTransaction = {
        update: jest.fn(),
        set: jest.fn()
      };
      
      await transactionCallback(mockTransaction);

      expect(mockTransaction.update).toHaveBeenCalledWith(
        expect.any(Object), // contributionRef
        expect.objectContaining({
          'escrow.releaseSchedule': expect.arrayContaining([
            expect.objectContaining({
              milestoneId: 'milestone1',
              released: true,
              releasedAt: expect.any(Date),
              transferId: 'tr_test123',
              releasedBy: 'creator123'
            })
          ])
        })
      );
    });

    it('should mark escrow as fully released when all milestones done', async () => {
      const contributionsWithPartialRelease = mockContributions.map(c => ({
        ...c,
        escrow: {
          ...c.escrow,
          releaseSchedule: c.escrow.releaseSchedule.map((schedule, index) => ({
            ...schedule,
            released: index === 0 // First milestone already released
          }))
        }
      }));

      (firestoreHelper.queryDocuments as jest.Mock).mockResolvedValue(contributionsWithPartialRelease);

      const data = {
        releaseType: 'milestone_completion',
        projectId: 'project123',
        milestoneId: 'milestone2' // Releasing second milestone
      };

      await releaseEscrow(data, mockContext);

      const transactionCallback = (firestoreHelper.runTransaction as jest.Mock).mock.calls[0][0];
      const mockTransaction = {
        update: jest.fn(),
        set: jest.fn()
      };
      
      await transactionCallback(mockTransaction);

      expect(mockTransaction.update).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          'escrow.held': false,
          'escrow.fullyReleasedAt': expect.any(Date)
        })
      );
    });

    it('should create escrow release ledger entry', async () => {
      const data = {
        releaseType: 'milestone_completion',
        projectId: 'project123',
        milestoneId: 'milestone1'
      };

      await releaseEscrow(data, mockContext);

      const transactionCallback = (firestoreHelper.runTransaction as jest.Mock).mock.calls[0][0];
      const mockTransaction = {
        update: jest.fn(),
        set: jest.fn()
      };
      
      await transactionCallback(mockTransaction);

      expect(mockTransaction.set).toHaveBeenCalledWith(
        expect.any(Object), // releaseRef
        expect.objectContaining({
          id: 'release123',
          type: 'escrow_release',
          releaseType: 'milestone_completion',
          milestoneId: 'milestone1',
          amount: expect.any(Number),
          transferId: 'tr_test123',
          releasedBy: 'creator123'
        })
      );
    });
  });

  describe('Notification System', () => {
    it('should notify creator of escrow release', async () => {
      const data = {
        releaseType: 'milestone_completion',
        projectId: 'project123',
        milestoneId: 'milestone1',
        notifyCreator: true
      };

      await releaseEscrow(data, mockContext);

      expect(emailService.sendEmail).toHaveBeenCalledWith({
        to: 'creator@example.com',
        templateId: 'escrow_release_creator',
        dynamicTemplateData: expect.objectContaining({
          creatorName: 'Creator User',
          projectTitle: 'Test Project',
          releaseType: 'milestone_completion',
          totalReleased: expect.any(String),
          contributionsCount: 2
        })
      });
    });

    it('should notify contributors of escrow release', async () => {
      const data = {
        releaseType: 'milestone_completion',
        projectId: 'project123',
        milestoneId: 'milestone1',
        notifyContributors: true
      };

      await releaseEscrow(data, mockContext);

      expect(emailService.sendEmail).toHaveBeenCalledWith({
        to: 'user@example.com',
        templateId: 'escrow_release_contributor',
        dynamicTemplateData: expect.objectContaining({
          contributorName: 'John Doe',
          projectTitle: 'Test Project',
          releaseType: 'milestone_completion'
        })
      });
    });

    it('should skip notifications when disabled', async () => {
      const data = {
        releaseType: 'milestone_completion',
        projectId: 'project123',
        milestoneId: 'milestone1',
        notifyCreator: false,
        notifyContributors: false
      };

      await releaseEscrow(data, mockContext);

      expect(emailService.sendEmail).not.toHaveBeenCalled();
    });

    it('should skip notifications for anonymous contributors', async () => {
      const data = {
        releaseType: 'milestone_completion',
        projectId: 'project123',
        milestoneId: 'milestone1',
        notifyContributors: true
      };

      await releaseEscrow(data, mockContext);

      // Should only send one email (to non-anonymous contributor)
      const contributorEmails = (emailService.sendEmail as jest.Mock).mock.calls
        .filter(call => call[0].templateId === 'escrow_release_contributor');
      
      expect(contributorEmails).toHaveLength(1);
    });

    it('should handle notification failures gracefully', async () => {
      (emailService.sendEmail as jest.Mock).mockRejectedValue(
        new Error('Email service down')
      );

      const data = {
        releaseType: 'milestone_completion',
        projectId: 'project123',
        milestoneId: 'milestone1',
        notifyCreator: true
      };

      // Should not fail release if notifications fail
      const result = await releaseEscrow(data, mockContext);
      expect(result.success).toBe(true);
    });
  });

  describe('Statistics Updates', () => {
    it('should update escrow statistics', async () => {
      const data = {
        releaseType: 'milestone_completion',
        projectId: 'project123',
        milestoneId: 'milestone1'
      };

      await releaseEscrow(data, mockContext);

      expect(firestoreHelper.incrementDocument).toHaveBeenCalledWith(
        'platform_stats',
        'global',
        expect.objectContaining({
          'escrow.totalReleased': expect.any(Number),
          'escrow.releasesCount': 2,
          'escrow.uniqueContributors': 2,
          'escrow.byType.milestone_completion': 2,
          'categories.environment.escrowReleased': expect.any(Number)
        })
      );
    });

    it('should handle statistics update failures gracefully', async () => {
      (firestoreHelper.incrementDocument as jest.Mock).mockRejectedValue(
        new Error('Stats service down')
      );

      const data = {
        releaseType: 'milestone_completion',
        projectId: 'project123',
        milestoneId: 'milestone1'
      };

      // Should not fail release if stats fail
      const result = await releaseEscrow(data, mockContext);
      expect(result.success).toBe(true);
    });
  });

  describe('Percentage-based Releases', () => {
    it('should release specified percentage of escrow', async () => {
      const data = {
        releaseType: 'admin_override',
        projectId: 'project123',
        releaseReason: 'Partial release authorized',
        releasePercentage: 50
      };

      const contextAsAdmin = { 
        ...mockContext, 
        auth: { uid: 'admin123', token: {} }
      };

      await releaseEscrow(data, contextAsAdmin);

      // Should release 50% of remaining escrow
      expect(result.totalReleased).toBeGreaterThan(0);
    });

    it('should validate percentage range', async () => {
      const contextAsAdmin = { 
        ...mockContext, 
        auth: { uid: 'admin123', token: {} }
      };

      const data = {
        releaseType: 'admin_override',
        projectId: 'project123',
        releaseReason: 'Override test',
        releasePercentage: 150 // Invalid percentage
      };

      await expect(releaseEscrow(data, contextAsAdmin))
        .rejects
        .toThrow();
    });
  });

  describe('No Eligible Contributions', () => {
    it('should handle no contributions with held escrow', async () => {
      (firestoreHelper.queryDocuments as jest.Mock).mockResolvedValue([]);

      const data = {
        releaseType: 'milestone_completion',
        projectId: 'project123',
        milestoneId: 'milestone1'
      };

      const result = await releaseEscrow(data, mockContext);

      expect(result.totalReleased).toBe(0);
      expect(result.contributionsProcessed).toBe(0);
      expect(result.success).toBe(true);
    });

    it('should handle contributions with zero release amounts', async () => {
      const contributionsAlreadyReleased = mockContributions.map(c => ({
        ...c,
        escrow: {
          ...c.escrow,
          releaseSchedule: c.escrow.releaseSchedule.map(schedule => ({
            ...schedule,
            released: true // Already released
          }))
        }
      }));

      (firestoreHelper.queryDocuments as jest.Mock).mockResolvedValue(contributionsAlreadyReleased);

      const data = {
        releaseType: 'milestone_completion',
        projectId: 'project123',
        milestoneId: 'milestone1'
      };

      const result = await releaseEscrow(data, mockContext);

      expect(result.totalReleased).toBe(0);
      expect(stripeService.createTransfer).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle missing project', async () => {
      (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
        if (collection === 'projects') throw new Error('Project not found');
        return Promise.resolve({});
      });

      const data = {
        releaseType: 'milestone_completion',
        projectId: 'nonexistent',
        milestoneId: 'milestone1'
      };

      await expect(releaseEscrow(data, mockContext))
        .rejects
        .toThrow();
    });

    it('should handle database transaction failures', async () => {
      (firestoreHelper.runTransaction as jest.Mock).mockRejectedValue(
        new Error('Transaction failed')
      );

      const data = {
        releaseType: 'milestone_completion',
        projectId: 'project123',
        milestoneId: 'milestone1'
      };

      await expect(releaseEscrow(data, mockContext))
        .rejects
        .toThrow();
    });

    it('should log all errors appropriately', async () => {
      (stripeService.createTransfer as jest.Mock).mockRejectedValue(
        new Error('Stripe transfer failed')
      );

      const data = {
        releaseType: 'milestone_completion',
        projectId: 'project123',
        milestoneId: 'milestone1'
      };

      const result = await releaseEscrow(data, mockContext);

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to create Stripe transfer',
        expect.any(Error),
        expect.objectContaining({
          contributionId: expect.any(String)
        })
      );
    });
  });

  describe('Logging', () => {
    it('should log business activity', async () => {
      const data = {
        releaseType: 'milestone_completion',
        projectId: 'project123',
        milestoneId: 'milestone1'
      };

      await releaseEscrow(data, mockContext);

      expect(logger.business).toHaveBeenCalledWith(
        'Escrow released',
        'escrow',
        expect.objectContaining({
          projectId: 'project123',
          releaseType: 'milestone_completion',
          milestoneId: 'milestone1',
          releasedBy: 'creator123',
          totalReleased: expect.any(Number),
          successful: expect.any(Number)
        })
      );
    });

    it('should log financial audit trail', async () => {
      const data = {
        releaseType: 'milestone_completion',
        projectId: 'project123',
        milestoneId: 'milestone1'
      };

      await releaseEscrow(data, mockContext);

      expect(logger.financial).toHaveBeenCalledWith(
        'Escrow funds released',
        expect.objectContaining({
          projectId: 'project123',
          releaseType: 'milestone_completion',
          totalReleased: expect.any(Number),
          transfersCreated: expect.any(Number),
          releasedBy: 'creator123',
          milestoneId: 'milestone1'
        })
      );
    });

    it('should log function execution details', async () => {
      const data = {
        releaseType: 'milestone_completion',
        projectId: 'project123',
        milestoneId: 'milestone1'
      };

      await releaseEscrow(data, mockContext);

      expect(logger.info).toHaveBeenCalledWith(
        'Releasing escrow',
        expect.objectContaining({
          functionName: 'releaseEscrow',
          uid: 'creator123',
          projectId: 'project123',
          releaseType: 'milestone_completion'
        })
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle contributions with zero escrow amounts', async () => {
      const zeroEscrowContributions = mockContributions.map(c => ({
        ...c,
        escrow: {
          ...c.escrow,
          heldAmount: 0,
          releaseSchedule: []
        }
      }));

      (firestoreHelper.queryDocuments as jest.Mock).mockResolvedValue(zeroEscrowContributions);

      const data = {
        releaseType: 'milestone_completion',
        projectId: 'project123',
        milestoneId: 'milestone1'
      };

      const result = await releaseEscrow(data, mockContext);

      expect(result.totalReleased).toBe(0);
      expect(stripeService.createTransfer).not.toHaveBeenCalled();
    });

    it('should handle very large escrow amounts', async () => {
      const largeContributions = mockContributions.map(c => ({
        ...c,
        amount: { ...c.amount, gross: 100000, net: 92000 },
        escrow: {
          ...c.escrow,
          heldAmount: 92000,
          releaseSchedule: [
            {
              milestoneId: 'milestone1',
              amount: 36800,
              releaseCondition: 'milestone_completion',
              released: false
            }
          ]
        }
      }));

      (firestoreHelper.queryDocuments as jest.Mock).mockResolvedValue(largeContributions);

      const data = {
        releaseType: 'milestone_completion',
        projectId: 'project123',
        milestoneId: 'milestone1'
      };

      const result = await releaseEscrow(data, mockContext);

      expect(result.totalReleased).toBeGreaterThan(50000);
      expect(stripeService.createTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 36800
        })
      );
    });

    it('should handle concurrent release requests', async () => {
      const data = {
        releaseType: 'milestone_completion',
        projectId: 'project123',
        milestoneId: 'milestone1'
      };

      // Simulate concurrent calls
      const promise1 = releaseEscrow(data, mockContext);
      const promise2 = releaseEscrow(data, mockContext);

      const results = await Promise.allSettled([promise1, promise2]);
      
      // At least one should succeed
      const successCount = results.filter(r => r.status === 'fulfilled').length;
      expect(successCount).toBeGreaterThan(0);
    });
  });

  describe('Response Format', () => {
    it('should return complete release response', async () => {
      const data = {
        releaseType: 'milestone_completion',
        projectId: 'project123',
        milestoneId: 'milestone1'
      };

      const result = await releaseEscrow(data, mockContext);

      expect(result).toMatchObject({
        releaseType: 'milestone_completion',
        projectId: 'project123',
        milestoneId: 'milestone1',
        totalReleased: expect.any(Number),
        contributionsProcessed: 2,
        successful: 2,
        failed: 0,
        results: expect.any(Array),
        processedAt: expect.any(String),
        success: true
      });
    });

    it('should include transfer details in results', async () => {
      const data = {
        releaseType: 'milestone_completion',
        projectId: 'project123',
        milestoneId: 'milestone1'
      };

      const result = await releaseEscrow(data, mockContext);

      expect(result.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            contributionId: expect.any(String),
            transferId: 'tr_test123',
            releaseAmount: expect.any(Number),
            status: 'paid',
            success: true
          })
        ])
      );
    });
  });

  describe('Security', () => {
    it('should validate release type permissions strictly', async () => {
      const unauthorizedUser = {
        ...mockCreatorUser,
        uid: 'unauthorized123',
        permissions: []
      };

      const contextAsUnauthorized = { 
        ...mockContext, 
        auth: { uid: 'unauthorized123', token: {} }
      };

      const projectWithDifferentCreator = {
        ...mockProject,
        creatorUid: 'different_creator123'
      };

      (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
        if (collection === 'users' && id === 'unauthorized123') return Promise.resolve(unauthorizedUser);
        if (collection === 'projects') return Promise.resolve(projectWithDifferentCreator);
        return Promise.resolve({});
      });

      const data = {
        releaseType: 'milestone_completion',
        projectId: 'project123',
        milestoneId: 'milestone1'
      };

      await expect(releaseEscrow(data, contextAsUnauthorized))
        .rejects
        .toThrow('Insufficient permissions for milestone escrow release');
    });

    it('should log security events for admin overrides', async () => {
      const contextAsAdmin = { 
        ...mockContext, 
        auth: { uid: 'admin123', token: {} }
      };

      const data = {
        releaseType: 'admin_override',
        projectId: 'project123',
        releaseReason: 'Emergency administrative override',
        bypassSafetyChecks: true
      };

      await releaseEscrow(data, contextAsAdmin);

      expect(logger.business).toHaveBeenCalledWith(
        'Escrow released',
        'escrow',
        expect.objectContaining({
          isAdminRelease: true
        })
      );

      expect(logger.financial).toHaveBeenCalledWith(
        'Escrow funds released',
        expect.objectContaining({
          bypassedSafetyChecks: true
        })
      );
    });
  });
});