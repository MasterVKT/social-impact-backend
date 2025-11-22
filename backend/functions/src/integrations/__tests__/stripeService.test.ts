/**
 * Tests for Stripe Service Integration
 * Social Finance Impact Platform
 */

import { stripeService } from '../stripe/stripeService';
import { logger } from '../../utils/logger';

jest.mock('stripe');
jest.mock('../../utils/logger');

const mockLogger = jest.mocked(logger);

describe('Stripe Service Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Payment Intent Creation', () => {
    it('should create payment intent with correct amount', async () => {
      const mockCreatePaymentIntent = jest.fn().mockResolvedValue({
        id: 'pi_123',
        client_secret: 'secret_123',
        amount: 10000,
        currency: 'eur',
        status: 'requires_payment_method'
      });

      (stripeService as any).stripe = {
        paymentIntents: {
          create: mockCreatePaymentIntent
        }
      };

      const result = await stripeService.createPaymentIntent({
        amount: 10000,
        currency: 'EUR',
        metadata: {
          projectId: 'project-123',
          contributorId: 'user-456'
        }
      });

      expect(result.id).toBe('pi_123');
      expect(mockCreatePaymentIntent).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 10000,
          currency: 'eur'
        })
      );
    });

    it('should handle Stripe API errors', async () => {
      const mockCreatePaymentIntent = jest.fn().mockRejectedValue(
        new Error('Stripe API error')
      );

      (stripeService as any).stripe = {
        paymentIntents: {
          create: mockCreatePaymentIntent
        }
      };

      await expect(
        stripeService.createPaymentIntent({
          amount: 10000,
          currency: 'EUR',
          metadata: {}
        })
      ).rejects.toThrow('Stripe API error');

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('Payment Confirmation', () => {
    it('should retrieve payment intent', async () => {
      const mockRetrieve = jest.fn().mockResolvedValue({
        id: 'pi_123',
        status: 'succeeded',
        amount: 10000
      });

      (stripeService as any).stripe = {
        paymentIntents: {
          retrieve: mockRetrieve
        }
      };

      const result = await stripeService.retrievePaymentIntent('pi_123');

      expect(result.status).toBe('succeeded');
      expect(mockRetrieve).toHaveBeenCalledWith('pi_123');
    });
  });

  describe('Refund Processing', () => {
    it('should create refund for payment intent', async () => {
      const mockCreateRefund = jest.fn().mockResolvedValue({
        id: 're_123',
        amount: 10000,
        status: 'succeeded'
      });

      (stripeService as any).stripe = {
        refunds: {
          create: mockCreateRefund
        }
      };

      const result = await stripeService.createRefund({
        paymentIntentId: 'pi_123',
        amount: 10000
      });

      expect(result.id).toBe('re_123');
      expect(mockCreateRefund).toHaveBeenCalled();
    });

    it('should handle refund failures', async () => {
      const mockCreateRefund = jest.fn().mockRejectedValue(
        new Error('Refund failed')
      );

      (stripeService as any).stripe = {
        refunds: {
          create: mockCreateRefund
        }
      };

      await expect(
        stripeService.createRefund({
          paymentIntentId: 'pi_123',
          amount: 10000
        })
      ).rejects.toThrow('Refund failed');
    });
  });

  describe('Webhook Verification', () => {
    it('should verify webhook signature', () => {
      const mockVerify = jest.fn().mockReturnValue({
        id: 'evt_123',
        type: 'payment_intent.succeeded'
      });

      (stripeService as any).stripe = {
        webhooks: {
          constructEvent: mockVerify
        }
      };

      const event = stripeService.verifyWebhookSignature(
        'payload',
        'signature',
        'secret'
      );

      expect(event.type).toBe('payment_intent.succeeded');
    });

    it('should throw on invalid signature', () => {
      const mockVerify = jest.fn().mockImplementation(() => {
        throw new Error('Invalid signature');
      });

      (stripeService as any).stripe = {
        webhooks: {
          constructEvent: mockVerify
        }
      };

      expect(() => {
        stripeService.verifyWebhookSignature('payload', 'bad-sig', 'secret');
      }).toThrow('Invalid signature');
    });
  });
});
