/**
 * Create Contribution Tests
 * Social Finance Impact Platform
 */

import { createContribution } from '../createContribution';
import { CallableContext } from 'firebase-functions/v1/https';
import { https } from 'firebase-functions';
import { logger } from '../../utils/logger';
import { firestoreHelper } from '../../utils/firestore';
import { stripeService } from '../../integrations/stripe/stripeService';
import { sumsubService } from '../../integrations/sumsub/sumsubService';
import { helpers } from '../../utils/helpers';
import { STATUS, PAYMENT_CONFIG } from '../../utils/constants';
import { ContributionsAPI } from '../../types/api';
import { UserDocument, ProjectDocument, ContributionDocument } from '../../types/firestore';

// Mocks
jest.mock('../../utils/logger');
jest.mock('../../utils/firestore');
jest.mock('../../integrations/stripe/stripeService');
jest.mock('../../integrations/sumsub/sumsubService');
jest.mock('../../utils/helpers');

describe('createContribution', () => {
  let mockContext: CallableContext;
  let mockUser: UserDocument;
  let mockProject: ProjectDocument;
  let mockContribution: ContributionDocument;

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
      userType: 'contributor',
      kyc: {
        status: 'approved',
        level: 2,
        verifiedAt: new Date(),
        externalId: 'sumsub123'
      },
      preferences: {
        currency: 'EUR',
        language: 'fr'
      },
      stats: {
        totalContributed: 50000,
        projectsSupported: 5
      }
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
      timeline: {
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
      },
      milestones: [
        {
          id: 'milestone1',
          title: 'Phase 1',
          fundingPercentage: 40,
          status: STATUS.MILESTONE.PLANNED
        },
        {
          id: 'milestone2',
          title: 'Phase 2',
          fundingPercentage: 60,
          status: STATUS.MILESTONE.PLANNED
        }
      ]
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
      escrow: {
        held: true,
        heldAmount: 9200,
        expectedReleaseDate: new Date(),
        releaseSchedule: []
      },
      payment: {
        paymentIntentId: 'pi_test123'
      }
    } as ContributionDocument;

    // Setup default mocks
    (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
      if (collection === 'users') return Promise.resolve(mockUser);
      if (collection === 'projects') return Promise.resolve(mockProject);
      return Promise.resolve({});
    });

    (helpers.string.generateId as jest.Mock).mockReturnValue('contrib123');
    (helpers.calculations.calculateContributionFees as jest.Mock).mockReturnValue({
      gross: 10000,
      net: 9200,
      platformFee: 500,
      stripeFee: 300,
      totalFees: 800
    });

    (stripeService.createPaymentIntent as jest.Mock).mockResolvedValue({
      id: 'pi_test123',
      client_secret: 'pi_test123_secret_xyz',
      amount: 10000,
      currency: 'eur',
      status: 'requires_payment_method'
    });

    (firestoreHelper.addDocument as jest.Mock).mockResolvedValue('contrib123');
    (firestoreHelper.runTransaction as jest.Mock).mockImplementation(async (callback) => {
      const mockTransaction = {
        set: jest.fn(),
        update: jest.fn(),
        get: jest.fn().mockResolvedValue({ exists: true, data: () => mockProject })
      };
      return await callback(mockTransaction);
    });
  });

  describe('Validation', () => {
    it('should reject unauthenticated requests', async () => {
      const contextWithoutAuth = { ...mockContext, auth: undefined };
      const data = {
        projectId: 'project123',
        amount: 10000,
        anonymous: false,
        paymentMethod: { type: 'card', source: 'form' }
      };

      await expect(createContribution(data, contextWithoutAuth))
        .rejects
        .toThrow('Authentication required');
    });

    it('should validate required fields', async () => {
      const invalidData = {
        amount: 10000,
        anonymous: false
      };

      await expect(createContribution(invalidData, mockContext))
        .rejects
        .toThrow();
    });

    it('should reject negative amounts', async () => {
      const data = {
        projectId: 'project123',
        amount: -100,
        anonymous: false,
        paymentMethod: { type: 'card', source: 'form' }
      };

      await expect(createContribution(data, mockContext))
        .rejects
        .toThrow();
    });

    it('should reject amounts below minimum', async () => {
      const data = {
        projectId: 'project123',
        amount: PAYMENT_CONFIG.MIN_CONTRIBUTION_AMOUNT - 1,
        anonymous: false,
        paymentMethod: { type: 'card', source: 'form' }
      };

      await expect(createContribution(data, mockContext))
        .rejects
        .toThrow();
    });

    it('should reject amounts above maximum', async () => {
      const data = {
        projectId: 'project123',
        amount: PAYMENT_CONFIG.MAX_CONTRIBUTION_AMOUNT + 1,
        anonymous: false,
        paymentMethod: { type: 'card', source: 'form' }
      };

      await expect(createContribution(data, mockContext))
        .rejects
        .toThrow();
    });
  });

  describe('User Eligibility', () => {
    it('should check user KYC status', async () => {
      const userWithoutKYC = { ...mockUser, kyc: { status: 'pending' } };
      (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(userWithoutKYC);
        if (collection === 'projects') return Promise.resolve(mockProject);
        return Promise.resolve({});
      });

      const data = {
        projectId: 'project123',
        amount: 10000,
        anonymous: false,
        paymentMethod: { type: 'card', source: 'form' }
      };

      await expect(createContribution(data, mockContext))
        .rejects
        .toThrow('KYC verification required');
    });

    it('should enforce contribution limits based on KYC level', async () => {
      const userLevel1 = { 
        ...mockUser, 
        kyc: { status: 'approved', level: 1 }
      };
      
      (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(userLevel1);
        if (collection === 'projects') return Promise.resolve(mockProject);
        return Promise.resolve({});
      });

      const data = {
        projectId: 'project123',
        amount: 50000, // Above level 1 limit
        anonymous: false,
        paymentMethod: { type: 'card', source: 'form' }
      };

      await expect(createContribution(data, mockContext))
        .rejects
        .toThrow('Contribution amount exceeds KYC limit');
    });

    it('should prevent self-contribution', async () => {
      const projectWithSameCreator = { ...mockProject, creatorUid: 'user123' };
      (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockUser);
        if (collection === 'projects') return Promise.resolve(projectWithSameCreator);
        return Promise.resolve({});
      });

      const data = {
        projectId: 'project123',
        amount: 10000,
        anonymous: false,
        paymentMethod: { type: 'card', source: 'form' }
      };

      await expect(createContribution(data, mockContext))
        .rejects
        .toThrow('Cannot contribute to your own project');
    });
  });

  describe('Project Status Validation', () => {
    it('should reject contributions to inactive projects', async () => {
      const inactiveProject = { ...mockProject, status: STATUS.PROJECT.DRAFT };
      (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockUser);
        if (collection === 'projects') return Promise.resolve(inactiveProject);
        return Promise.resolve({});
      });

      const data = {
        projectId: 'project123',
        amount: 10000,
        anonymous: false,
        paymentMethod: { type: 'card', source: 'form' }
      };

      await expect(createContribution(data, mockContext))
        .rejects
        .toThrow('Project is not accepting contributions');
    });

    it('should reject contributions to completed projects', async () => {
      const completedProject = { ...mockProject, status: STATUS.PROJECT.COMPLETED };
      (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockUser);
        if (collection === 'projects') return Promise.resolve(completedProject);
        return Promise.resolve({});
      });

      const data = {
        projectId: 'project123',
        amount: 10000,
        anonymous: false,
        paymentMethod: { type: 'card', source: 'form' }
      };

      await expect(createContribution(data, mockContext))
        .rejects
        .toThrow('Project is not accepting contributions');
    });

    it('should reject contributions to expired projects', async () => {
      const expiredProject = { 
        ...mockProject, 
        timeline: { 
          endDate: new Date(Date.now() - 24 * 60 * 60 * 1000) // Yesterday
        }
      };
      
      (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockUser);
        if (collection === 'projects') return Promise.resolve(expiredProject);
        return Promise.resolve({});
      });

      const data = {
        projectId: 'project123',
        amount: 10000,
        anonymous: false,
        paymentMethod: { type: 'card', source: 'form' }
      };

      await expect(createContribution(data, mockContext))
        .rejects
        .toThrow('Project funding period has ended');
    });

    it('should reject over-funding', async () => {
      const nearlyFundedProject = { 
        ...mockProject, 
        funding: { 
          goal: 100000, 
          raised: 95000, 
          percentage: 95 
        }
      };
      
      (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockUser);
        if (collection === 'projects') return Promise.resolve(nearlyFundedProject);
        return Promise.resolve({});
      });

      const data = {
        projectId: 'project123',
        amount: 10000, // Would exceed goal
        anonymous: false,
        paymentMethod: { type: 'card', source: 'form' }
      };

      await expect(createContribution(data, mockContext))
        .rejects
        .toThrow('Contribution would exceed project funding goal');
    });
  });

  describe('Payment Intent Creation', () => {
    it('should create Stripe PaymentIntent successfully', async () => {
      const data = {
        projectId: 'project123',
        amount: 10000,
        anonymous: false,
        paymentMethod: { type: 'card', source: 'form' }
      };

      const result = await createContribution(data, mockContext);

      expect(stripeService.createPaymentIntent).toHaveBeenCalledWith({
        amount: 10000,
        currency: 'eur',
        metadata: {
          contributionId: 'contrib123',
          projectId: 'project123',
          contributorUid: 'user123',
          projectTitle: 'Test Project',
          isAnonymous: 'false'
        },
        automatic_payment_methods: { enabled: true },
        confirmation_method: 'manual',
        confirm: false,
        capture_method: 'automatic'
      });

      expect(result.contributionId).toBe('contrib123');
      expect(result.paymentIntent.id).toBe('pi_test123');
      expect(result.paymentIntent.clientSecret).toBe('pi_test123_secret_xyz');
    });

    it('should handle Stripe errors gracefully', async () => {
      (stripeService.createPaymentIntent as jest.Mock).mockRejectedValue(
        new Error('Stripe API error')
      );

      const data = {
        projectId: 'project123',
        amount: 10000,
        anonymous: false,
        paymentMethod: { type: 'card', source: 'form' }
      };

      await expect(createContribution(data, mockContext))
        .rejects
        .toThrow('Unable to create payment intent');
    });
  });

  describe('Contribution Creation', () => {
    it('should create contribution document with correct structure', async () => {
      const data = {
        projectId: 'project123',
        amount: 10000,
        message: 'Great project!',
        anonymous: false,
        paymentMethod: { type: 'card', source: 'form' }
      };

      await createContribution(data, mockContext);

      expect(firestoreHelper.addDocument).toHaveBeenCalledWith(
        'projects/project123/contributions',
        expect.objectContaining({
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
          message: 'Great project!',
          anonymous: false,
          status: 'pending',
          escrow: expect.objectContaining({
            held: true,
            heldAmount: 9200
          }),
          payment: expect.objectContaining({
            paymentIntentId: 'pi_test123'
          })
        })
      );
    });

    it('should create user contribution reference', async () => {
      const data = {
        projectId: 'project123',
        amount: 10000,
        anonymous: false,
        paymentMethod: { type: 'card', source: 'form' }
      };

      await createContribution(data, mockContext);

      expect(firestoreHelper.addDocument).toHaveBeenCalledWith(
        'users/user123/contributions',
        expect.objectContaining({
          id: 'contrib123',
          projectId: 'project123',
          amount: 10000,
          status: 'pending'
        })
      );
    });

    it('should handle anonymous contributions', async () => {
      const data = {
        projectId: 'project123',
        amount: 10000,
        anonymous: true,
        paymentMethod: { type: 'card', source: 'form' }
      };

      await createContribution(data, mockContext);

      expect(firestoreHelper.addDocument).toHaveBeenCalledWith(
        'projects/project123/contributions',
        expect.objectContaining({
          anonymous: true,
          message: ''
        })
      );
    });
  });

  describe('Escrow Schedule Generation', () => {
    it('should generate escrow schedule based on milestones', async () => {
      const data = {
        projectId: 'project123',
        amount: 10000,
        anonymous: false,
        paymentMethod: { type: 'card', source: 'form' }
      };

      await createContribution(data, mockContext);

      const contributionCall = (firestoreHelper.addDocument as jest.Mock).mock.calls
        .find(call => call[0] === 'projects/project123/contributions');
      
      const contribution = contributionCall[1];
      expect(contribution.escrow.releaseSchedule).toHaveLength(2);
      expect(contribution.escrow.releaseSchedule[0]).toMatchObject({
        milestoneId: 'milestone1',
        amount: expect.any(Number),
        releaseCondition: 'milestone_completion'
      });
    });

    it('should calculate milestone release amounts correctly', async () => {
      const data = {
        projectId: 'project123',
        amount: 10000,
        anonymous: false,
        paymentMethod: { type: 'card', source: 'form' }
      };

      await createContribution(data, mockContext);

      const contributionCall = (firestoreHelper.addDocument as jest.Mock).mock.calls
        .find(call => call[0] === 'projects/project123/contributions');
      
      const contribution = contributionCall[1];
      const schedule = contribution.escrow.releaseSchedule;
      
      // 40% for milestone 1, 60% for milestone 2 of net amount (9200)
      expect(schedule[0].amount).toBe(Math.round(9200 * 0.40));
      expect(schedule[1].amount).toBe(Math.round(9200 * 0.60));
    });
  });

  describe('Fee Calculations', () => {
    it('should calculate fees correctly', async () => {
      const data = {
        projectId: 'project123',
        amount: 10000,
        anonymous: false,
        paymentMethod: { type: 'card', source: 'form' }
      };

      await createContribution(data, mockContext);

      expect(helpers.calculations.calculateContributionFees).toHaveBeenCalledWith(
        10000,
        'EUR',
        mockProject.category
      );
    });

    it('should handle different currencies', async () => {
      const userUSD = { ...mockUser, preferences: { currency: 'USD' } };
      (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(userUSD);
        if (collection === 'projects') return Promise.resolve(mockProject);
        return Promise.resolve({});
      });

      const data = {
        projectId: 'project123',
        amount: 10000,
        anonymous: false,
        paymentMethod: { type: 'card', source: 'form' }
      };

      await createContribution(data, mockContext);

      expect(helpers.calculations.calculateContributionFees).toHaveBeenCalledWith(
        10000,
        'USD',
        mockProject.category
      );
    });
  });

  describe('KYC Integration', () => {
    it('should check KYC status with Sumsub', async () => {
      (sumsubService.getApplicantStatus as jest.Mock).mockResolvedValue({
        status: 'approved',
        level: 2
      });

      const data = {
        projectId: 'project123',
        amount: 10000,
        anonymous: false,
        paymentMethod: { type: 'card', source: 'form' }
      };

      await createContribution(data, mockContext);

      expect(sumsubService.getApplicantStatus).toHaveBeenCalledWith('sumsub123');
    });

    it('should handle Sumsub API errors', async () => {
      (sumsubService.getApplicantStatus as jest.Mock).mockRejectedValue(
        new Error('Sumsub API error')
      );

      const data = {
        projectId: 'project123',
        amount: 10000,
        anonymous: false,
        paymentMethod: { type: 'card', source: 'form' }
      };

      // Should not fail if Sumsub is unavailable, but use local KYC status
      const result = await createContribution(data, mockContext);
      expect(result.contributionId).toBe('contrib123');
    });
  });

  describe('Transaction Handling', () => {
    it('should use Firestore transactions for data consistency', async () => {
      const data = {
        projectId: 'project123',
        amount: 10000,
        anonymous: false,
        paymentMethod: { type: 'card', source: 'form' }
      };

      await createContribution(data, mockContext);

      expect(firestoreHelper.runTransaction).toHaveBeenCalled();
    });

    it('should rollback on transaction failure', async () => {
      (firestoreHelper.runTransaction as jest.Mock).mockRejectedValue(
        new Error('Transaction failed')
      );

      const data = {
        projectId: 'project123',
        amount: 10000,
        anonymous: false,
        paymentMethod: { type: 'card', source: 'form' }
      };

      await expect(createContribution(data, mockContext))
        .rejects
        .toThrow('Unable to create contribution');
    });
  });

  describe('Success Response', () => {
    it('should return complete contribution response', async () => {
      const data = {
        projectId: 'project123',
        amount: 10000,
        message: 'Supporting this cause',
        anonymous: false,
        paymentMethod: { type: 'card', source: 'form' }
      };

      const result = await createContribution(data, mockContext);

      expect(result).toMatchObject({
        contributionId: 'contrib123',
        paymentIntent: {
          id: 'pi_test123',
          clientSecret: 'pi_test123_secret_xyz',
          amount: 10000,
          currency: 'eur'
        },
        fees: {
          platformFee: 500,
          stripeFee: 300,
          total: 800
        },
        escrow: {
          holdUntil: expect.any(String),
          releaseConditions: expect.any(Array)
        }
      });
    });

    it('should include correct escrow details', async () => {
      const data = {
        projectId: 'project123',
        amount: 10000,
        anonymous: false,
        paymentMethod: { type: 'card', source: 'form' }
      };

      const result = await createContribution(data, mockContext);

      expect(result.escrow.releaseConditions).toContain('milestone_completion');
      expect(result.escrow.holdUntil).toBeTruthy();
    });
  });

  describe('Logging', () => {
    it('should log business activity', async () => {
      const data = {
        projectId: 'project123',
        amount: 10000,
        anonymous: false,
        paymentMethod: { type: 'card', source: 'form' }
      };

      await createContribution(data, mockContext);

      expect(logger.business).toHaveBeenCalledWith(
        'Contribution created',
        'contributions',
        expect.objectContaining({
          contributionId: 'contrib123',
          projectId: 'project123',
          contributorUid: 'user123',
          amount: 10000
        })
      );
    });

    it('should log financial transaction', async () => {
      const data = {
        projectId: 'project123',
        amount: 10000,
        anonymous: false,
        paymentMethod: { type: 'card', source: 'form' }
      };

      await createContribution(data, mockContext);

      expect(logger.financial).toHaveBeenCalledWith(
        'Payment intent created for contribution',
        expect.objectContaining({
          paymentIntentId: 'pi_test123',
          grossAmount: 10000,
          netAmount: 9200,
          platformRevenue: 500
        })
      );
    });

    it('should log errors properly', async () => {
      (stripeService.createPaymentIntent as jest.Mock).mockRejectedValue(
        new Error('Payment processor error')
      );

      const data = {
        projectId: 'project123',
        amount: 10000,
        anonymous: false,
        paymentMethod: { type: 'card', source: 'form' }
      };

      await expect(createContribution(data, mockContext))
        .rejects
        .toThrow();

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing project', async () => {
      (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockUser);
        if (collection === 'projects') throw new Error('Project not found');
        return Promise.resolve({});
      });

      const data = {
        projectId: 'nonexistent',
        amount: 10000,
        anonymous: false,
        paymentMethod: { type: 'card', source: 'form' }
      };

      await expect(createContribution(data, mockContext))
        .rejects
        .toThrow();
    });

    it('should handle missing user', async () => {
      (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
        if (collection === 'users') throw new Error('User not found');
        if (collection === 'projects') return Promise.resolve(mockProject);
        return Promise.resolve({});
      });

      const data = {
        projectId: 'project123',
        amount: 10000,
        anonymous: false,
        paymentMethod: { type: 'card', source: 'form' }
      };

      await expect(createContribution(data, mockContext))
        .rejects
        .toThrow();
    });

    it('should handle very large contribution amounts', async () => {
      const data = {
        projectId: 'project123',
        amount: 75000, // Large but under goal
        anonymous: false,
        paymentMethod: { type: 'card', source: 'form' }
      };

      const result = await createContribution(data, mockContext);

      expect(result.contributionId).toBe('contrib123');
      expect(result.paymentIntent.amount).toBe(75000);
    });

    it('should handle contributions with maximum allowed message length', async () => {
      const longMessage = 'A'.repeat(500); // Max length
      
      const data = {
        projectId: 'project123',
        amount: 10000,
        message: longMessage,
        anonymous: false,
        paymentMethod: { type: 'card', source: 'form' }
      };

      const result = await createContribution(data, mockContext);
      expect(result.contributionId).toBe('contrib123');
    });
  });

  describe('Currency Handling', () => {
    it('should respect user currency preference', async () => {
      const data = {
        projectId: 'project123',
        amount: 10000,
        anonymous: false,
        paymentMethod: { type: 'card', source: 'form' }
      };

      await createContribution(data, mockContext);

      expect(stripeService.createPaymentIntent).toHaveBeenCalledWith(
        expect.objectContaining({
          currency: 'eur' // Lowercase version of user's EUR preference
        })
      );
    });

    it('should handle different currency formats', async () => {
      const userGBP = { 
        ...mockUser, 
        preferences: { currency: 'GBP' }
      };
      
      (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(userGBP);
        if (collection === 'projects') return Promise.resolve(mockProject);
        return Promise.resolve({});
      });

      const data = {
        projectId: 'project123',
        amount: 10000,
        anonymous: false,
        paymentMethod: { type: 'card', source: 'form' }
      };

      await createContribution(data, mockContext);

      expect(stripeService.createPaymentIntent).toHaveBeenCalledWith(
        expect.objectContaining({
          currency: 'gbp'
        })
      );
    });
  });
});