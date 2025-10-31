/**
 * Confirm Payment Tests
 * Social Finance Impact Platform
 */

import { confirmPayment } from '../confirmPayment';
import { CallableContext } from 'firebase-functions/v1/https';
import { https } from 'firebase-functions';
import { logger } from '../../utils/logger';
import { firestoreHelper } from '../../utils/firestore';
import { stripeService } from '../../integrations/stripe/stripeService';
import { emailService } from '../../integrations/sendgrid/emailService';
import { helpers } from '../../utils/helpers';
import { STATUS, PAYMENT_CONFIG } from '../../utils/constants';
import { ContributionsAPI } from '../../types/api';
import { UserDocument, ProjectDocument, ContributionDocument } from '../../types/firestore';

// Mocks
jest.mock('../../utils/logger');
jest.mock('../../utils/firestore');
jest.mock('../../integrations/stripe/stripeService');
jest.mock('../../integrations/sendgrid/emailService');
jest.mock('../../utils/helpers');

describe('confirmPayment', () => {
  let mockContext: CallableContext;
  let mockUser: UserDocument;
  let mockProject: ProjectDocument;
  let mockContribution: ContributionDocument;
  let mockPaymentIntent: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockContext = {
      auth: {
        uid: 'user123',
        token: { email: 'test@example.com' }
      },
      rawRequest: { ip: '127.0.0.1' }
    };

    mockUser = {
      uid: 'user123',
      email: 'test@example.com',
      firstName: 'John',
      lastName: 'Doe',
      userType: 'contributor'
    } as UserDocument;

    mockProject = {
      uid: 'project123',
      title: 'Test Project',
      slug: 'test-project',
      status: STATUS.PROJECT.ACTIVE,
      creatorUid: 'creator123',
      category: 'environment',
      funding: {
        goal: 100000,
        raised: 25000,
        percentage: 25,
        contributorsCount: 10
      },
      version: 1
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
      status: 'pending',
      createdAt: new Date(),
      anonymous: false,
      message: 'Great project!',
      escrow: {
        held: true,
        heldAmount: 9200,
        expectedReleaseDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
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
      payment: {
        paymentIntentId: 'pi_test123'
      },
      version: 1
    } as ContributionDocument;

    mockPaymentIntent = {
      id: 'pi_test123',
      status: 'succeeded',
      amount: 10000,
      currency: 'eur',
      client_secret: 'pi_test123_secret_xyz',
      charges: {
        data: [{
          id: 'ch_test123',
          receipt_url: 'https://stripe.com/receipt123'
        }]
      }
    };

    // Setup default mocks
    (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
      if (collection.includes('contributions')) return Promise.resolve(mockContribution);
      if (collection === 'users') return Promise.resolve(mockUser);
      if (collection === 'projects') return Promise.resolve(mockProject);
      return Promise.resolve({});
    });

    (stripeService.retrievePaymentIntent as jest.Mock).mockResolvedValue(mockPaymentIntent);
    (helpers.string.generateId as jest.Mock).mockReturnValue('txn123');
    (emailService.sendEmail as jest.Mock).mockResolvedValue(true);
    (firestoreHelper.addDocument as jest.Mock).mockResolvedValue('feed123');
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

  describe('Authentication', () => {
    it('should reject unauthenticated requests', async () => {
      const contextWithoutAuth = { ...mockContext, auth: undefined };
      const data = {
        contributionId: 'contrib123',
        paymentIntentId: 'pi_test123',
        stripeClientSecret: 'pi_test123_secret_xyz'
      };

      await expect(confirmPayment(data, contextWithoutAuth))
        .rejects
        .toThrow('Authentication required');
    });

    it('should require contribution ID', async () => {
      const data = {
        paymentIntentId: 'pi_test123',
        stripeClientSecret: 'pi_test123_secret_xyz'
      };

      await expect(confirmPayment(data, mockContext))
        .rejects
        .toThrow();
    });
  });

  describe('Validation', () => {
    it('should validate required fields', async () => {
      const invalidData = {
        contributionId: 'contrib123'
        // Missing paymentIntentId and clientSecret
      };

      await expect(confirmPayment(invalidData, mockContext))
        .rejects
        .toThrow();
    });

    it('should validate contribution ownership', async () => {
      const otherUserContribution = { 
        ...mockContribution, 
        contributorUid: 'otheruser123' 
      };
      
      (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
        if (collection.includes('contributions')) return Promise.resolve(otherUserContribution);
        if (collection === 'users') return Promise.resolve(mockUser);
        if (collection === 'projects') return Promise.resolve(mockProject);
        return Promise.resolve({});
      });

      const data = {
        contributionId: 'contrib123',
        paymentIntentId: 'pi_test123',
        stripeClientSecret: 'pi_test123_secret_xyz'
      };

      await expect(confirmPayment(data, mockContext))
        .rejects
        .toThrow('Access denied to this contribution');
    });

    it('should validate PaymentIntent ID match', async () => {
      const contributionWithDifferentPI = { 
        ...mockContribution, 
        payment: { paymentIntentId: 'pi_different123' }
      };
      
      (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
        if (collection.includes('contributions')) return Promise.resolve(contributionWithDifferentPI);
        return Promise.resolve({});
      });

      const data = {
        contributionId: 'contrib123',
        paymentIntentId: 'pi_test123',
        stripeClientSecret: 'pi_test123_secret_xyz'
      };

      await expect(confirmPayment(data, mockContext))
        .rejects
        .toThrow('PaymentIntent does not match contribution');
    });

    it('should reject already confirmed contributions', async () => {
      const confirmedContribution = { 
        ...mockContribution, 
        status: 'confirmed' 
      };
      
      (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
        if (collection.includes('contributions')) return Promise.resolve(confirmedContribution);
        return Promise.resolve({});
      });

      const data = {
        contributionId: 'contrib123',
        paymentIntentId: 'pi_test123',
        stripeClientSecret: 'pi_test123_secret_xyz'
      };

      await expect(confirmPayment(data, mockContext))
        .rejects
        .toThrow('Contribution is in status: confirmed');
    });
  });

  describe('Stripe Payment Verification', () => {
    it('should verify payment with Stripe', async () => {
      const data = {
        contributionId: 'contrib123',
        paymentIntentId: 'pi_test123',
        stripeClientSecret: 'pi_test123_secret_xyz'
      };

      await confirmPayment(data, mockContext);

      expect(stripeService.retrievePaymentIntent).toHaveBeenCalledWith('pi_test123');
    });

    it('should validate client secret format', async () => {
      const invalidPaymentIntent = {
        ...mockPaymentIntent,
        client_secret: 'different_secret'
      };
      
      (stripeService.retrievePaymentIntent as jest.Mock).mockResolvedValue(invalidPaymentIntent);

      const data = {
        contributionId: 'contrib123',
        paymentIntentId: 'pi_test123',
        stripeClientSecret: 'pi_test123_secret_xyz'
      };

      await expect(confirmPayment(data, mockContext))
        .rejects
        .toThrow('Invalid client secret');
    });

    it('should reject failed payments', async () => {
      const failedPaymentIntent = {
        ...mockPaymentIntent,
        status: 'failed'
      };
      
      (stripeService.retrievePaymentIntent as jest.Mock).mockResolvedValue(failedPaymentIntent);

      const data = {
        contributionId: 'contrib123',
        paymentIntentId: 'pi_test123',
        stripeClientSecret: 'pi_test123_secret_xyz'
      };

      await expect(confirmPayment(data, mockContext))
        .rejects
        .toThrow('Payment not successful. Status: failed');
    });

    it('should validate payment amount', async () => {
      const wrongAmountPaymentIntent = {
        ...mockPaymentIntent,
        amount: 5000 // Different from contribution amount
      };
      
      (stripeService.retrievePaymentIntent as jest.Mock).mockResolvedValue(wrongAmountPaymentIntent);

      const data = {
        contributionId: 'contrib123',
        paymentIntentId: 'pi_test123',
        stripeClientSecret: 'pi_test123_secret_xyz'
      };

      await expect(confirmPayment(data, mockContext))
        .rejects
        .toThrow('Payment amount mismatch');
    });
  });

  describe('Transaction Processing', () => {
    it('should update contribution status to confirmed', async () => {
      const data = {
        contributionId: 'contrib123',
        paymentIntentId: 'pi_test123',
        stripeClientSecret: 'pi_test123_secret_xyz'
      };

      await confirmPayment(data, mockContext);

      expect(firestoreHelper.runTransaction).toHaveBeenCalled();
      
      const transactionCallback = (firestoreHelper.runTransaction as jest.Mock).mock.calls[0][0];
      const mockTransaction = {
        update: jest.fn(),
        set: jest.fn(),
        get: jest.fn().mockResolvedValue({ exists: true, data: () => mockProject })
      };
      
      await transactionCallback(mockTransaction);

      expect(mockTransaction.update).toHaveBeenCalledWith(
        expect.any(Object), // contributionRef
        expect.objectContaining({
          status: 'confirmed',
          confirmedAt: expect.any(Date),
          transactionId: 'txn123',
          'payment.confirmedPaymentIntentId': 'pi_test123',
          'payment.stripeChargeId': 'ch_test123',
          'payment.receiptUrl': 'https://stripe.com/receipt123'
        })
      );
    });

    it('should update user contribution reference', async () => {
      const data = {
        contributionId: 'contrib123',
        paymentIntentId: 'pi_test123',
        stripeClientSecret: 'pi_test123_secret_xyz'
      };

      await confirmPayment(data, mockContext);

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
          status: 'confirmed',
          confirmedAt: expect.any(Date),
          transactionId: 'txn123'
        })
      );
    });

    it('should update project funding statistics', async () => {
      const data = {
        contributionId: 'contrib123',
        paymentIntentId: 'pi_test123',
        stripeClientSecret: 'pi_test123_secret_xyz'
      };

      await confirmPayment(data, mockContext);

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
          'funding.raised': 35000, // 25000 + 10000
          'funding.percentage': 35, // 35000/100000 * 100
          'funding.contributorsCount': 11, // 10 + 1
          'stats.lastContributionAt': expect.any(Date)
        })
      );
    });

    it('should update project status when funding goal reached', async () => {
      const projectNearGoal = {
        ...mockProject,
        funding: { goal: 100000, raised: 95000, percentage: 95, contributorsCount: 19 }
      };

      (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
        if (collection.includes('contributions')) return Promise.resolve(mockContribution);
        if (collection === 'users') return Promise.resolve(mockUser);
        if (collection === 'projects') return Promise.resolve(projectNearGoal);
        return Promise.resolve({});
      });

      const data = {
        contributionId: 'contrib123',
        paymentIntentId: 'pi_test123',
        stripeClientSecret: 'pi_test123_secret_xyz'
      };

      await confirmPayment(data, mockContext);

      const transactionCallback = (firestoreHelper.runTransaction as jest.Mock).mock.calls[0][0];
      const mockTransaction = {
        update: jest.fn(),
        set: jest.fn(),
        get: jest.fn().mockResolvedValue({ exists: true, data: () => projectNearGoal })
      };
      
      await transactionCallback(mockTransaction);

      expect(mockTransaction.update).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          'funding.percentage': 105, // 105000/100000 * 100
          status: STATUS.PROJECT.FUNDING_COMPLETE
        })
      );
    });

    it('should create transaction ledger entry', async () => {
      const data = {
        contributionId: 'contrib123',
        paymentIntentId: 'pi_test123',
        stripeClientSecret: 'pi_test123_secret_xyz'
      };

      await confirmPayment(data, mockContext);

      const transactionCallback = (firestoreHelper.runTransaction as jest.Mock).mock.calls[0][0];
      const mockTransaction = {
        update: jest.fn(),
        set: jest.fn(),
        get: jest.fn().mockResolvedValue({ exists: true, data: () => mockProject })
      };
      
      await transactionCallback(mockTransaction);

      expect(mockTransaction.set).toHaveBeenCalledWith(
        expect.any(Object), // transactionRef
        expect.objectContaining({
          id: 'txn123',
          type: 'contribution_confirmed',
          contributionId: 'contrib123',
          projectId: 'project123',
          contributorUid: 'user123',
          amount: mockContribution.amount,
          escrow: expect.objectContaining({
            held: true,
            amount: 9200
          })
        })
      );
    });
  });

  describe('Receipt Generation', () => {
    it('should send receipt email for non-anonymous contributions', async () => {
      const data = {
        contributionId: 'contrib123',
        paymentIntentId: 'pi_test123',
        stripeClientSecret: 'pi_test123_secret_xyz'
      };

      await confirmPayment(data, mockContext);

      expect(emailService.sendEmail).toHaveBeenCalledWith({
        to: 'test@example.com',
        templateId: 'contribution_receipt',
        dynamicTemplateData: expect.objectContaining({
          contributorName: 'John Doe',
          projectTitle: 'Test Project',
          contributionAmount: '100.00',
          currency: 'EUR',
          receiptUrl: 'https://stripe.com/receipt123',
          transactionId: 'pi_test123'
        })
      });
    });

    it('should skip receipt for anonymous contributions', async () => {
      const anonymousContribution = { ...mockContribution, anonymous: true };
      (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
        if (collection.includes('contributions')) return Promise.resolve(anonymousContribution);
        if (collection === 'users') return Promise.resolve(mockUser);
        if (collection === 'projects') return Promise.resolve(mockProject);
        return Promise.resolve({});
      });

      const data = {
        contributionId: 'contrib123',
        paymentIntentId: 'pi_test123',
        stripeClientSecret: 'pi_test123_secret_xyz'
      };

      await confirmPayment(data, mockContext);

      expect(emailService.sendEmail).not.toHaveBeenCalled();
    });

    it('should handle email service failures gracefully', async () => {
      (emailService.sendEmail as jest.Mock).mockRejectedValue(
        new Error('Email service unavailable')
      );

      const data = {
        contributionId: 'contrib123',
        paymentIntentId: 'pi_test123',
        stripeClientSecret: 'pi_test123_secret_xyz'
      };

      // Should not fail confirmation if email fails
      const result = await confirmPayment(data, mockContext);
      expect(result.status).toBe('confirmed');
    });
  });

  describe('Statistics Updates', () => {
    it('should update platform statistics', async () => {
      const data = {
        contributionId: 'contrib123',
        paymentIntentId: 'pi_test123',
        stripeClientSecret: 'pi_test123_secret_xyz'
      };

      await confirmPayment(data, mockContext);

      expect(firestoreHelper.incrementDocument).toHaveBeenCalledWith(
        'platform_stats',
        'global',
        expect.objectContaining({
          'contributions.total': 1,
          'contributions.totalAmount': 10000,
          'contributions.platformRevenue': 500,
          'categories.environment.totalContributions': 1,
          'categories.environment.totalAmount': 10000
        })
      );
    });

    it('should handle statistics update failures gracefully', async () => {
      (firestoreHelper.incrementDocument as jest.Mock).mockRejectedValue(
        new Error('Stats update failed')
      );

      const data = {
        contributionId: 'contrib123',
        paymentIntentId: 'pi_test123',
        stripeClientSecret: 'pi_test123_secret_xyz'
      };

      // Should not fail confirmation if stats fail
      const result = await confirmPayment(data, mockContext);
      expect(result.status).toBe('confirmed');
    });
  });

  describe('Activity Feed', () => {
    it('should create activity feed entry for public contributions', async () => {
      const data = {
        contributionId: 'contrib123',
        paymentIntentId: 'pi_test123',
        stripeClientSecret: 'pi_test123_secret_xyz'
      };

      await confirmPayment(data, mockContext);

      expect(firestoreHelper.addDocument).toHaveBeenCalledWith(
        'activity_feed',
        expect.objectContaining({
          type: 'contribution_confirmed',
          contributionId: 'contrib123',
          projectId: 'project123',
          contributorName: 'John Doe',
          amount: 10000,
          anonymous: false,
          visibility: 'public'
        })
      );
    });

    it('should create anonymous activity feed entry', async () => {
      const anonymousContribution = { ...mockContribution, anonymous: true };
      (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
        if (collection.includes('contributions')) return Promise.resolve(anonymousContribution);
        if (collection === 'users') return Promise.resolve(mockUser);
        if (collection === 'projects') return Promise.resolve(mockProject);
        return Promise.resolve({});
      });

      const data = {
        contributionId: 'contrib123',
        paymentIntentId: 'pi_test123',
        stripeClientSecret: 'pi_test123_secret_xyz'
      };

      await confirmPayment(data, mockContext);

      expect(firestoreHelper.addDocument).toHaveBeenCalledWith(
        'activity_feed',
        expect.objectContaining({
          contributorName: 'Contributeur anonyme',
          contributorUid: '',
          anonymous: true
        })
      );
    });

    it('should handle activity creation failures gracefully', async () => {
      (firestoreHelper.addDocument as jest.Mock).mockRejectedValue(
        new Error('Activity feed failed')
      );

      const data = {
        contributionId: 'contrib123',
        paymentIntentId: 'pi_test123',
        stripeClientSecret: 'pi_test123_secret_xyz'
      };

      // Should not fail confirmation if activity fails
      const result = await confirmPayment(data, mockContext);
      expect(result.status).toBe('confirmed');
    });
  });

  describe('Success Response', () => {
    it('should return complete confirmation response', async () => {
      const data = {
        contributionId: 'contrib123',
        paymentIntentId: 'pi_test123',
        stripeClientSecret: 'pi_test123_secret_xyz'
      };

      const result = await confirmPayment(data, mockContext);

      expect(result).toMatchObject({
        status: 'confirmed',
        receiptUrl: 'https://stripe.com/receipt123',
        transactionId: 'txn123',
        escrowDetails: {
          amount: 9200,
          heldUntil: expect.any(String),
          releaseSchedule: [
            {
              milestoneId: 'milestone1',
              amount: 3680,
              conditions: 'milestone_completion'
            },
            {
              milestoneId: 'milestone2',
              amount: 5520,
              conditions: 'milestone_completion'
            }
          ]
        },
        success: true
      });
    });

    it('should include transaction ID in response', async () => {
      (helpers.string.generateId as jest.Mock).mockReturnValue('unique_txn_456');

      const data = {
        contributionId: 'contrib123',
        paymentIntentId: 'pi_test123',
        stripeClientSecret: 'pi_test123_secret_xyz'
      };

      const result = await confirmPayment(data, mockContext);

      expect(result.transactionId).toBe('unique_txn_456');
    });
  });

  describe('Error Handling', () => {
    it('should handle Stripe API errors', async () => {
      (stripeService.retrievePaymentIntent as jest.Mock).mockRejectedValue(
        new Error('Stripe service unavailable')
      );

      const data = {
        contributionId: 'contrib123',
        paymentIntentId: 'pi_test123',
        stripeClientSecret: 'pi_test123_secret_xyz'
      };

      await expect(confirmPayment(data, mockContext))
        .rejects
        .toThrow('Unable to verify payment with Stripe');
    });

    it('should handle database transaction failures', async () => {
      (firestoreHelper.runTransaction as jest.Mock).mockRejectedValue(
        new Error('Transaction failed')
      );

      const data = {
        contributionId: 'contrib123',
        paymentIntentId: 'pi_test123',
        stripeClientSecret: 'pi_test123_secret_xyz'
      };

      await expect(confirmPayment(data, mockContext))
        .rejects
        .toThrow('Unable to confirm contribution');
    });

    it('should log all errors appropriately', async () => {
      (stripeService.retrievePaymentIntent as jest.Mock).mockRejectedValue(
        new Error('Test error')
      );

      const data = {
        contributionId: 'contrib123',
        paymentIntentId: 'pi_test123',
        stripeClientSecret: 'pi_test123_secret_xyz'
      };

      await expect(confirmPayment(data, mockContext))
        .rejects
        .toThrow();

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('Logging', () => {
    it('should log business activity', async () => {
      const data = {
        contributionId: 'contrib123',
        paymentIntentId: 'pi_test123',
        stripeClientSecret: 'pi_test123_secret_xyz'
      };

      await confirmPayment(data, mockContext);

      expect(logger.business).toHaveBeenCalledWith(
        'Contribution confirmed',
        'contributions',
        expect.objectContaining({
          contributionId: 'contrib123',
          paymentIntentId: 'pi_test123',
          contributorUid: 'user123',
          amount: 10000,
          netAmount: 9200,
          anonymous: false
        })
      );
    });

    it('should log financial transaction', async () => {
      const data = {
        contributionId: 'contrib123',
        paymentIntentId: 'pi_test123',
        stripeClientSecret: 'pi_test123_secret_xyz'
      };

      await confirmPayment(data, mockContext);

      expect(logger.financial).toHaveBeenCalledWith(
        'Payment confirmed and processed',
        expect.objectContaining({
          contributionId: 'contrib123',
          paymentIntentId: 'pi_test123',
          stripeChargeId: 'ch_test123',
          grossAmount: 10000,
          netAmount: 9200,
          platformRevenue: 500,
          escrowHeld: true,
          escrowAmount: 9200
        })
      );
    });

    it('should log function start and completion', async () => {
      const data = {
        contributionId: 'contrib123',
        paymentIntentId: 'pi_test123',
        stripeClientSecret: 'pi_test123_secret_xyz'
      };

      await confirmPayment(data, mockContext);

      expect(logger.info).toHaveBeenCalledWith(
        'Confirming payment',
        expect.objectContaining({
          functionName: 'confirmPayment',
          uid: 'user123',
          contributionId: 'contrib123'
        })
      );

      expect(logger.info).toHaveBeenCalledWith(
        'Payment confirmed successfully',
        expect.objectContaining({
          functionName: 'confirmPayment',
          success: true
        })
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing charge data', async () => {
      const paymentIntentWithoutCharges = {
        ...mockPaymentIntent,
        charges: { data: [] }
      };
      
      (stripeService.retrievePaymentIntent as jest.Mock).mockResolvedValue(paymentIntentWithoutCharges);

      const data = {
        contributionId: 'contrib123',
        paymentIntentId: 'pi_test123',
        stripeClientSecret: 'pi_test123_secret_xyz'
      };

      const result = await confirmPayment(data, mockContext);

      expect(result.status).toBe('confirmed');
      expect(result.receiptUrl).toBe('');
    });

    it('should handle project not found during update', async () => {
      (firestoreHelper.runTransaction as jest.Mock).mockImplementation(async (callback) => {
        const mockTransaction = {
          update: jest.fn(),
          set: jest.fn(),
          get: jest.fn().mockResolvedValue({ exists: false })
        };
        return await callback(mockTransaction);
      });

      const data = {
        contributionId: 'contrib123',
        paymentIntentId: 'pi_test123',
        stripeClientSecret: 'pi_test123_secret_xyz'
      };

      const result = await confirmPayment(data, mockContext);
      expect(result.status).toBe('confirmed');
    });

    it('should handle concurrent confirmations', async () => {
      const data = {
        contributionId: 'contrib123',
        paymentIntentId: 'pi_test123',
        stripeClientSecret: 'pi_test123_secret_xyz'
      };

      // Simulate two concurrent calls
      const promise1 = confirmPayment(data, mockContext);
      const promise2 = confirmPayment(data, mockContext);

      const results = await Promise.allSettled([promise1, promise2]);
      
      // At least one should succeed
      const successCount = results.filter(r => r.status === 'fulfilled').length;
      expect(successCount).toBeGreaterThan(0);
    });

    it('should handle very large contribution amounts', async () => {
      const largeContribution = {
        ...mockContribution,
        amount: {
          gross: 50000,
          net: 46000,
          currency: 'EUR',
          platformFee: 2500,
          stripeFee: 1500,
          totalFees: 4000
        }
      };

      (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
        if (collection.includes('contributions')) return Promise.resolve(largeContribution);
        if (collection === 'users') return Promise.resolve(mockUser);
        if (collection === 'projects') return Promise.resolve(mockProject);
        return Promise.resolve({});
      });

      const largePaymentIntent = { ...mockPaymentIntent, amount: 50000 };
      (stripeService.retrievePaymentIntent as jest.Mock).mockResolvedValue(largePaymentIntent);

      const data = {
        contributionId: 'contrib123',
        paymentIntentId: 'pi_test123',
        stripeClientSecret: 'pi_test123_secret_xyz'
      };

      const result = await confirmPayment(data, mockContext);

      expect(result.status).toBe('confirmed');
      expect(result.escrowDetails.amount).toBe(46000);
    });
  });
});