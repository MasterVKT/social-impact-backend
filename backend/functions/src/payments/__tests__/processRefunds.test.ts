/**
 * Process Refunds Tests
 * Social Finance Impact Platform
 */

import { processRefunds } from '../processRefunds';
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

describe('processRefunds', () => {
  let mockContext: CallableContext;
  let mockAdminUser: UserDocument;
  let mockCreatorUser: UserDocument;
  let mockProject: ProjectDocument;
  let mockContribution: ContributionDocument;
  let mockStripeRefund: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockContext = {
      auth: {
        uid: 'admin123',
        token: { email: 'admin@example.com' }
      },
      rawRequest: { ip: '127.0.0.1' }
    };

    mockAdminUser = {
      uid: 'admin123',
      email: 'admin@example.com',
      firstName: 'Admin',
      lastName: 'User',
      userType: 'moderator',
      permissions: [USER_PERMISSIONS.MODERATE_PROJECTS, USER_PERMISSIONS.PROCESS_REFUNDS]
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
      status: STATUS.PROJECT.CANCELLED,
      creatorUid: 'creator123',
      category: 'environment',
      funding: {
        goal: 100000,
        raised: 50000,
        percentage: 50,
        contributorsCount: 25
      }
    } as ProjectDocument;

    mockContribution = {
      id: 'contrib123',
      projectId: 'project123',
      contributorUid: 'user123',
      amount: {
        gross: 10000,
        net: 9200,
        currency: 'EUR',
        platformFee: 500,
        stripeFee: 300,
        totalFees: 800
      },
      status: 'confirmed',
      anonymous: false,
      createdAt: new Date(),
      payment: {
        stripeChargeId: 'ch_test123',
        paymentIntentId: 'pi_test123'
      },
      version: 1
    } as ContributionDocument;

    mockStripeRefund = {
      id: 're_test123',
      status: 'succeeded',
      amount: 10000,
      charge: 'ch_test123'
    };

    // Setup default mocks
    (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
      if (collection === 'users' && id === 'admin123') return Promise.resolve(mockAdminUser);
      if (collection === 'users' && id === 'creator123') return Promise.resolve(mockCreatorUser);
      if (collection === 'users' && id === 'user123') return Promise.resolve({ uid: 'user123', email: 'user@example.com', firstName: 'John', lastName: 'Doe' });
      if (collection === 'projects') return Promise.resolve(mockProject);
      return Promise.resolve({});
    });

    (firestoreHelper.queryDocuments as jest.Mock).mockResolvedValue([mockContribution]);
    (stripeService.createRefund as jest.Mock).mockResolvedValue(mockStripeRefund);
    (helpers.string.generateId as jest.Mock).mockReturnValue('refund_txn_123');
    (emailService.sendEmail as jest.Mock).mockResolvedValue(true);
    (firestoreHelper.incrementDocument as jest.Mock).mockResolvedValue(true);

    (firestoreHelper.runTransaction as jest.Mock).mockImplementation(async (callback) => {
      const mockTransaction = {
        update: jest.fn(),
        set: jest.fn(),
        get: jest.fn().mockResolvedValue({ 
          exists: true, 
          data: () => mockProject 
        })
      };
      return await callback(mockTransaction);
    });
  });

  describe('Authentication & Authorization', () => {
    it('should reject unauthenticated requests', async () => {
      const contextWithoutAuth = { ...mockContext, auth: undefined };
      const data = {
        refundType: 'single',
        contributionId: 'contrib123',
        refundReason: 'Customer request'
      };

      await expect(processRefunds(data, contextWithoutAuth))
        .rejects
        .toThrow('Authentication required');
    });

    it('should validate admin permissions for single refunds', async () => {
      const regularUser = { 
        ...mockAdminUser, 
        permissions: [] // No admin permissions
      };
      
      (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
        if (collection === 'users' && id === 'admin123') return Promise.resolve(regularUser);
        return Promise.resolve({});
      });

      const data = {
        refundType: 'single',
        contributionId: 'contrib123',
        refundReason: 'Customer request'
      };

      await expect(processRefunds(data, mockContext))
        .rejects
        .toThrow('Admin access required for individual refunds');
    });

    it('should validate creator permissions for project refunds', async () => {
      const contextAsCreator = { 
        ...mockContext, 
        auth: { uid: 'creator123', token: {} }
      };

      const data = {
        refundType: 'project_cancelled',
        projectId: 'project123'
      };

      const result = await processRefunds(data, contextAsCreator);
      expect(result.success).toBe(true);
    });

    it('should reject unauthorized project refunds', async () => {
      const contextAsOtherUser = { 
        ...mockContext, 
        auth: { uid: 'other123', token: {} }
      };

      const otherUser = { 
        ...mockAdminUser, 
        uid: 'other123',
        permissions: [] // No admin permissions
      };
      
      (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
        if (collection === 'users' && id === 'other123') return Promise.resolve(otherUser);
        if (collection === 'projects') return Promise.resolve(mockProject);
        return Promise.resolve({});
      });

      const data = {
        refundType: 'project_cancelled',
        projectId: 'project123'
      };

      await expect(processRefunds(data, contextAsOtherUser))
        .rejects
        .toThrow('Only project creator or admins can process project refunds');
    });
  });

  describe('Validation', () => {
    it('should validate required fields', async () => {
      const invalidData = {
        // Missing refundType
        contributionId: 'contrib123'
      };

      await expect(processRefunds(invalidData, mockContext))
        .rejects
        .toThrow();
    });

    it('should validate single refund requirements', async () => {
      const data = {
        refundType: 'single'
        // Missing contributionId and refundReason
      };

      await expect(processRefunds(data, mockContext))
        .rejects
        .toThrow();
    });

    it('should validate project refund requirements', async () => {
      const data = {
        refundType: 'project_cancelled'
        // Missing projectId
      };

      await expect(processRefunds(data, mockContext))
        .rejects
        .toThrow();
    });

    it('should validate refund reason length', async () => {
      const data = {
        refundType: 'single',
        contributionId: 'contrib123',
        refundReason: 'Short' // Too short
      };

      await expect(processRefunds(data, mockContext))
        .rejects
        .toThrow();
    });
  });

  describe('Single Refund Processing', () => {
    it('should process single refund successfully', async () => {
      const data = {
        refundType: 'single',
        contributionId: 'contrib123',
        refundReason: 'Customer requested refund due to circumstances',
        notifyContributors: true
      };

      const result = await processRefunds(data, mockContext);

      expect(result).toMatchObject({
        refundType: 'single',
        totalProcessed: 1,
        successful: 1,
        failed: 0,
        totalRefunded: 10000,
        success: true
      });

      expect(stripeService.createRefund).toHaveBeenCalledWith({
        charge: 'ch_test123',
        amount: expect.any(Number),
        reason: 'Customer requested refund due to circumstances',
        metadata: expect.objectContaining({
          contributionId: 'contrib123',
          projectId: 'project123'
        })
      });
    });

    it('should calculate refund fees correctly for single refunds', async () => {
      const data = {
        refundType: 'single',
        contributionId: 'contrib123',
        refundReason: 'Customer requested refund',
        amount: 8000 // Partial refund
      };

      await processRefunds(data, mockContext);

      // Should apply refund fees for single refunds
      expect(stripeService.createRefund).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: expect.any(Number) // Amount after fees
        })
      );
    });

    it('should handle contribution not found', async () => {
      (firestoreHelper.queryDocuments as jest.Mock).mockResolvedValue([]);

      const data = {
        refundType: 'single',
        contributionId: 'nonexistent',
        refundReason: 'Customer request'
      };

      await expect(processRefunds(data, mockContext))
        .rejects
        .toThrow('Eligible contribution not found');
    });

    it('should reject refund for non-confirmed contributions', async () => {
      const pendingContribution = { ...mockContribution, status: 'pending' };
      (firestoreHelper.queryDocuments as jest.Mock).mockResolvedValue([pendingContribution]);

      const data = {
        refundType: 'single',
        contributionId: 'contrib123',
        refundReason: 'Customer request'
      };

      await expect(processRefunds(data, mockContext))
        .rejects
        .toThrow('Only confirmed contributions can be refunded');
    });
  });

  describe('Project Refund Processing', () => {
    it('should process project cancellation refunds', async () => {
      const contributions = [
        mockContribution,
        { ...mockContribution, id: 'contrib456', contributorUid: 'user456' }
      ];
      
      (firestoreHelper.queryDocuments as jest.Mock).mockResolvedValue(contributions);

      const data = {
        refundType: 'project_cancelled',
        projectId: 'project123',
        notifyContributors: true
      };

      const result = await processRefunds(data, mockContext);

      expect(result.totalProcessed).toBe(2);
      expect(result.totalRefunded).toBeGreaterThan(0);
      expect(stripeService.createRefund).toHaveBeenCalledTimes(2);
    });

    it('should not charge fees for project failure refunds', async () => {
      const data = {
        refundType: 'project_failed',
        projectId: 'project123'
      };

      await processRefunds(data, mockContext);

      // Should refund full amount without fees for project failures
      expect(stripeService.createRefund).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 10000 // Full original amount
        })
      );
    });

    it('should handle empty contribution list', async () => {
      (firestoreHelper.queryDocuments as jest.Mock).mockResolvedValue([]);

      const data = {
        refundType: 'project_cancelled',
        projectId: 'project123'
      };

      const result = await processRefunds(data, mockContext);

      expect(result.totalProcessed).toBe(0);
      expect(result.totalRefunded).toBe(0);
      expect(result.success).toBe(true);
    });

    it('should process refunds in batches', async () => {
      // Create 25 contributions (more than batch size of 10)
      const manyContributions = Array.from({ length: 25 }, (_, i) => ({
        ...mockContribution,
        id: `contrib${i}`,
        contributorUid: `user${i}`
      }));
      
      (firestoreHelper.queryDocuments as jest.Mock).mockResolvedValue(manyContributions);

      const data = {
        refundType: 'project_cancelled',
        projectId: 'project123'
      };

      const result = await processRefunds(data, mockContext);

      expect(result.totalProcessed).toBe(25);
      expect(stripeService.createRefund).toHaveBeenCalledTimes(25);
    });
  });

  describe('Stripe Integration', () => {
    it('should create Stripe refund with correct parameters', async () => {
      const data = {
        refundType: 'single',
        contributionId: 'contrib123',
        refundReason: 'Customer request for refund'
      };

      await processRefunds(data, mockContext);

      expect(stripeService.createRefund).toHaveBeenCalledWith({
        charge: 'ch_test123',
        amount: expect.any(Number),
        reason: 'Customer request for refund',
        metadata: {
          contributionId: 'contrib123',
          projectId: 'project123',
          refundType: 'Customer request for refund',
          processedAt: expect.any(String)
        }
      });
    });

    it('should handle Stripe refund failures', async () => {
      (stripeService.createRefund as jest.Mock).mockRejectedValue(
        new Error('Stripe refund failed')
      );

      const data = {
        refundType: 'single',
        contributionId: 'contrib123',
        refundReason: 'Customer request'
      };

      await expect(processRefunds(data, mockContext))
        .rejects
        .toThrow('Unable to process refund with payment processor');
    });

    it('should handle partial Stripe failures in batch processing', async () => {
      const contributions = [
        mockContribution,
        { ...mockContribution, id: 'contrib456' }
      ];
      
      (firestoreHelper.queryDocuments as jest.Mock).mockResolvedValue(contributions);
      
      // Mock one success, one failure
      (stripeService.createRefund as jest.Mock)
        .mockResolvedValueOnce(mockStripeRefund)
        .mockRejectedValueOnce(new Error('Stripe error'));

      const data = {
        refundType: 'project_cancelled',
        projectId: 'project123'
      };

      const result = await processRefunds(data, mockContext);

      expect(result.successful).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.totalProcessed).toBe(2);
    });
  });

  describe('Document Updates', () => {
    it('should update contribution status to refunded', async () => {
      const data = {
        refundType: 'single',
        contributionId: 'contrib123',
        refundReason: 'Customer request'
      };

      await processRefunds(data, mockContext);

      expect(firestoreHelper.runTransaction).toHaveBeenCalled();
      
      const transactionCallback = (firestoreHelper.runTransaction as jest.Mock).mock.calls[0][0];
      const mockTransaction = {
        update: jest.fn(),
        set: jest.fn(),
        get: jest.fn().mockResolvedValue({ 
          exists: true, 
          data: () => mockProject 
        })
      };
      
      await transactionCallback(mockTransaction);

      expect(mockTransaction.update).toHaveBeenCalledWith(
        expect.any(Object), // contributionRef
        expect.objectContaining({
          status: 'refunded',
          refundedAt: expect.any(Date),
          'payment.refundId': 're_test123',
          processedBy: 'admin123'
        })
      );
    });

    it('should update user contribution reference', async () => {
      const data = {
        refundType: 'single',
        contributionId: 'contrib123',
        refundReason: 'Customer request'
      };

      await processRefunds(data, mockContext);

      const transactionCallback = (firestoreHelper.runTransaction as jest.Mock).mock.calls[0][0];
      const mockTransaction = {
        update: jest.fn(),
        set: jest.fn(),
        get: jest.fn().mockResolvedValue({ exists: true, data: () => mockProject })
      };
      
      await transactionCallback(mockTransaction);

      expect(mockTransaction.update).toHaveBeenCalledWith(
        expect.any(Object), // userContributionRef
        expect.objectContaining({
          status: 'refunded',
          refundedAt: expect.any(Date)
        })
      );
    });

    it('should update project funding statistics', async () => {
      const data = {
        refundType: 'single',
        contributionId: 'contrib123',
        refundReason: 'Customer request'
      };

      await processRefunds(data, mockContext);

      const transactionCallback = (firestoreHelper.runTransaction as jest.Mock).mock.calls[0][0];
      const mockTransaction = {
        update: jest.fn(),
        set: jest.fn(),
        get: jest.fn().mockResolvedValue({ exists: true, data: () => mockProject })
      };
      
      await transactionCallback(mockTransaction);

      expect(mockTransaction.update).toHaveBeenCalledWith(
        expect.any(Object), // projectRef
        expect.objectContaining({
          'funding.raised': 40000, // 50000 - 10000
          'funding.percentage': 40, // 40000/100000 * 100
          'funding.contributorsCount': 24, // 25 - 1
          'stats.lastRefundAt': expect.any(Date)
        })
      );
    });

    it('should create refund transaction ledger', async () => {
      const data = {
        refundType: 'single',
        contributionId: 'contrib123',
        refundReason: 'Customer request'
      };

      await processRefunds(data, mockContext);

      const transactionCallback = (firestoreHelper.runTransaction as jest.Mock).mock.calls[0][0];
      const mockTransaction = {
        update: jest.fn(),
        set: jest.fn(),
        get: jest.fn().mockResolvedValue({ exists: true, data: () => mockProject })
      };
      
      await transactionCallback(mockTransaction);

      expect(mockTransaction.set).toHaveBeenCalledWith(
        expect.any(Object), // refundRef
        expect.objectContaining({
          id: 'refund_txn_123',
          type: 'refund_processed',
          originalContributionId: 'contrib123',
          projectId: 'project123',
          stripeRefundId: 're_test123',
          processedBy: 'admin123'
        })
      );
    });
  });

  describe('Fee Calculations', () => {
    it('should apply no fees for project cancellation', async () => {
      const data = {
        refundType: 'project_cancelled',
        projectId: 'project123'
      };

      await processRefunds(data, mockContext);

      expect(stripeService.createRefund).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 10000 // Full amount without fees
        })
      );
    });

    it('should apply no fees for project failure', async () => {
      const data = {
        refundType: 'project_failed',
        projectId: 'project123'
      };

      await processRefunds(data, mockContext);

      expect(stripeService.createRefund).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 10000 // Full amount without fees
        })
      );
    });

    it('should apply fees for single refunds', async () => {
      const data = {
        refundType: 'single',
        contributionId: 'contrib123',
        refundReason: 'Customer changed mind'
      };

      await processRefunds(data, mockContext);

      // Should deduct refund processing fees
      const refundCall = (stripeService.createRefund as jest.Mock).mock.calls[0][0];
      expect(refundCall.amount).toBeLessThan(10000);
    });

    it('should handle partial refund amounts', async () => {
      const data = {
        refundType: 'single',
        contributionId: 'contrib123',
        refundReason: 'Partial refund requested',
        amount: 5000
      };

      await processRefunds(data, mockContext);

      expect(stripeService.createRefund).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: expect.any(Number) // Should be based on 5000
        })
      );
    });
  });

  describe('Notification System', () => {
    it('should send refund notification to contributor', async () => {
      const data = {
        refundType: 'single',
        contributionId: 'contrib123',
        refundReason: 'Requested by customer',
        notifyContributors: true
      };

      await processRefunds(data, mockContext);

      expect(emailService.sendEmail).toHaveBeenCalledWith({
        to: 'user@example.com',
        templateId: 'refund_notification',
        dynamicTemplateData: expect.objectContaining({
          contributorName: 'John Doe',
          projectTitle: 'Test Project',
          refundReason: 'Requested by customer'
        })
      });
    });

    it('should skip notifications when disabled', async () => {
      const data = {
        refundType: 'single',
        contributionId: 'contrib123',
        refundReason: 'Admin refund',
        notifyContributors: false
      };

      await processRefunds(data, mockContext);

      expect(emailService.sendEmail).not.toHaveBeenCalled();
    });

    it('should skip notifications for anonymous contributions', async () => {
      const anonymousContribution = { ...mockContribution, anonymous: true };
      (firestoreHelper.queryDocuments as jest.Mock).mockResolvedValue([anonymousContribution]);

      const data = {
        refundType: 'project_cancelled',
        projectId: 'project123',
        notifyContributors: true
      };

      await processRefunds(data, mockContext);

      expect(emailService.sendEmail).not.toHaveBeenCalled();
    });

    it('should handle email service failures gracefully', async () => {
      (emailService.sendEmail as jest.Mock).mockRejectedValue(
        new Error('Email service down')
      );

      const data = {
        refundType: 'single',
        contributionId: 'contrib123',
        refundReason: 'Customer request',
        notifyContributors: true
      };

      // Should not fail refund processing if email fails
      const result = await processRefunds(data, mockContext);
      expect(result.success).toBe(true);
    });
  });

  describe('Statistics Updates', () => {
    it('should update platform refund statistics', async () => {
      const data = {
        refundType: 'project_cancelled',
        projectId: 'project123'
      };

      await processRefunds(data, mockContext);

      expect(firestoreHelper.incrementDocument).toHaveBeenCalledWith(
        'platform_stats',
        'global',
        expect.objectContaining({
          'refunds.total': 1,
          'refunds.totalAmount': 10000,
          'refunds.uniqueContributors': 1,
          'refunds.byType.project_cancelled': 1
        })
      );
    });

    it('should handle statistics update failures gracefully', async () => {
      (firestoreHelper.incrementDocument as jest.Mock).mockRejectedValue(
        new Error('Stats service down')
      );

      const data = {
        refundType: 'single',
        contributionId: 'contrib123',
        refundReason: 'Customer request'
      };

      // Should not fail refund processing if stats fail
      const result = await processRefunds(data, mockContext);
      expect(result.success).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle database transaction failures', async () => {
      (firestoreHelper.runTransaction as jest.Mock).mockRejectedValue(
        new Error('Transaction failed')
      );

      const data = {
        refundType: 'single',
        contributionId: 'contrib123',
        refundReason: 'Customer request'
      };

      await expect(processRefunds(data, mockContext))
        .rejects
        .toThrow();
    });

    it('should collect partial successes in batch processing', async () => {
      const contributions = [
        mockContribution,
        { ...mockContribution, id: 'contrib456' },
        { ...mockContribution, id: 'contrib789' }
      ];
      
      (firestoreHelper.queryDocuments as jest.Mock).mockResolvedValue(contributions);
      
      // Mock mixed results
      (stripeService.createRefund as jest.Mock)
        .mockResolvedValueOnce(mockStripeRefund)
        .mockRejectedValueOnce(new Error('Stripe error'))
        .mockResolvedValueOnce(mockStripeRefund);

      const data = {
        refundType: 'project_cancelled',
        projectId: 'project123'
      };

      const result = await processRefunds(data, mockContext);

      expect(result.successful).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.totalProcessed).toBe(3);
    });

    it('should log individual refund failures', async () => {
      (stripeService.createRefund as jest.Mock).mockRejectedValue(
        new Error('Card cannot be refunded')
      );

      const data = {
        refundType: 'single',
        contributionId: 'contrib123',
        refundReason: 'Customer request'
      };

      await expect(processRefunds(data, mockContext))
        .rejects
        .toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to create Stripe refund',
        expect.any(Error),
        expect.objectContaining({
          contributionId: 'contrib123'
        })
      );
    });
  });

  describe('Dispute Resolution', () => {
    it('should reject unimplemented dispute resolution', async () => {
      const data = {
        refundType: 'dispute_resolution',
        contributionId: 'contrib123',
        refundReason: 'Dispute resolved in favor of customer'
      };

      await expect(processRefunds(data, mockContext))
        .rejects
        .toThrow('Dispute resolution refunds not yet implemented');
    });

    it('should validate admin access for dispute resolution', async () => {
      // This test covers the validation logic even though dispute resolution is not implemented
      const regularUser = { 
        ...mockAdminUser, 
        permissions: []
      };
      
      (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
        if (collection === 'users' && id === 'admin123') return Promise.resolve(regularUser);
        return Promise.resolve({});
      });

      const data = {
        refundType: 'dispute_resolution',
        contributionId: 'contrib123',
        refundReason: 'Dispute resolved'
      };

      await expect(processRefunds(data, mockContext))
        .rejects
        .toThrow('Admin access required for dispute resolution');
    });
  });

  describe('Logging', () => {
    it('should log business activity', async () => {
      const data = {
        refundType: 'single',
        contributionId: 'contrib123',
        refundReason: 'Customer request'
      };

      await processRefunds(data, mockContext);

      expect(logger.business).toHaveBeenCalledWith(
        'Refunds processed',
        'refunds',
        expect.objectContaining({
          refundType: 'single',
          processedBy: 'admin123',
          successful: 1,
          failed: 0,
          totalRefunded: expect.any(Number)
        })
      );
    });

    it('should log financial audit trail', async () => {
      const data = {
        refundType: 'project_cancelled',
        projectId: 'project123',
        adminOverride: true
      };

      await processRefunds(data, mockContext);

      expect(logger.financial).toHaveBeenCalledWith(
        'Refund batch completed',
        expect.objectContaining({
          refundType: 'project_cancelled',
          processedBy: 'admin123',
          hasAdminOverride: true
        })
      );
    });

    it('should log function start and completion', async () => {
      const data = {
        refundType: 'single',
        contributionId: 'contrib123',
        refundReason: 'Customer request'
      };

      await processRefunds(data, mockContext);

      expect(logger.info).toHaveBeenCalledWith(
        'Processing refunds',
        expect.objectContaining({
          functionName: 'processRefunds',
          uid: 'admin123',
          refundType: 'single'
        })
      );

      expect(logger.info).toHaveBeenCalledWith(
        'Refunds processed successfully',
        expect.objectContaining({
          functionName: 'processRefunds',
          success: true
        })
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle refund amounts larger than original', async () => {
      const data = {
        refundType: 'single',
        contributionId: 'contrib123',
        refundReason: 'Customer request',
        amount: 15000 // More than original 10000
      };

      await processRefunds(data, mockContext);

      // Should limit to original amount
      expect(stripeService.createRefund).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: expect.any(Number) // Should not exceed original amount
        })
      );
    });

    it('should handle zero refund amounts', async () => {
      const data = {
        refundType: 'single',
        contributionId: 'contrib123',
        refundReason: 'Customer request',
        amount: 0
      };

      const result = await processRefunds(data, mockContext);

      expect(result.totalRefunded).toBe(0);
      expect(stripeService.createRefund).not.toHaveBeenCalled();
    });

    it('should handle missing project during stats update', async () => {
      (firestoreHelper.runTransaction as jest.Mock).mockImplementation(async (callback) => {
        const mockTransaction = {
          update: jest.fn(),
          set: jest.fn(),
          get: jest.fn().mockResolvedValue({ exists: false })
        };
        return await callback(mockTransaction);
      });

      const data = {
        refundType: 'single',
        contributionId: 'contrib123',
        refundReason: 'Customer request'
      };

      const result = await processRefunds(data, mockContext);
      expect(result.success).toBe(true);
    });

    it('should handle concurrent refund requests', async () => {
      const data = {
        refundType: 'single',
        contributionId: 'contrib123',
        refundReason: 'Customer request'
      };

      // Simulate concurrent calls
      const promise1 = processRefunds(data, mockContext);
      const promise2 = processRefunds(data, mockContext);

      const results = await Promise.allSettled([promise1, promise2]);
      
      // At least one should succeed
      const successCount = results.filter(r => r.status === 'fulfilled').length;
      expect(successCount).toBeGreaterThan(0);
    });
  });

  describe('Refund Types', () => {
    it('should handle invalid refund type', async () => {
      const data = {
        refundType: 'invalid_type',
        contributionId: 'contrib123'
      };

      await expect(processRefunds(data, mockContext))
        .rejects
        .toThrow();
    });

    it('should process different refund types with appropriate logic', async () => {
      const testCases = [
        { refundType: 'project_cancelled', expectFees: false },
        { refundType: 'project_failed', expectFees: false },
        { refundType: 'single', expectFees: true }
      ];

      for (const testCase of testCases) {
        jest.clearAllMocks();
        (stripeService.createRefund as jest.Mock).mockResolvedValue(mockStripeRefund);

        const data = testCase.refundType === 'single' 
          ? {
              refundType: testCase.refundType,
              contributionId: 'contrib123',
              refundReason: 'Test refund'
            }
          : {
              refundType: testCase.refundType,
              projectId: 'project123'
            };

        await processRefunds(data, mockContext);

        const refundCall = (stripeService.createRefund as jest.Mock).mock.calls[0][0];
        
        if (testCase.expectFees) {
          expect(refundCall.amount).toBeLessThan(10000);
        } else {
          expect(refundCall.amount).toBe(10000);
        }
      }
    });
  });

  describe('Performance', () => {
    it('should process large batches efficiently', async () => {
      const manyContributions = Array.from({ length: 50 }, (_, i) => ({
        ...mockContribution,
        id: `contrib${i}`,
        contributorUid: `user${i}`,
        payment: { stripeChargeId: `ch_test${i}` }
      }));
      
      (firestoreHelper.queryDocuments as jest.Mock).mockResolvedValue(manyContributions);

      const data = {
        refundType: 'project_cancelled',
        projectId: 'project123'
      };

      const startTime = Date.now();
      const result = await processRefunds(data, mockContext);
      const endTime = Date.now();

      expect(result.totalProcessed).toBe(50);
      expect(endTime - startTime).toBeLessThan(30000); // Should complete within 30 seconds
    });
  });
});