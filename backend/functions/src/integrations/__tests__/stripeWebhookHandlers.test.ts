/**
 * Tests for Stripe Webhook Handlers
 * Social Finance Impact Platform
 */

import { handleStripeWebhook } from '../stripe/webhookHandlers';
import { firestoreHelper } from '../../utils/firestore';
import { logger } from '../../utils/logger';

jest.mock('../../utils/firestore');
jest.mock('../../utils/logger');

const mockFirestoreHelper = jest.mocked(firestoreHelper);
const mockLogger = jest.mocked(logger);

describe('Stripe Webhook Handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFirestoreHelper.updateDocument.mockResolvedValue();
    mockFirestoreHelper.getDocument.mockResolvedValue({
      id: 'contrib-123',
      projectId: 'project-456',
      contributorUid: 'user-789',
      amount: 10000
    } as any);
  });

  describe('Payment Intent Succeeded', () => {
    it('should update contribution status on successful payment', async () => {
      const event = {
        id: 'evt_123',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_123',
            amount: 10000,
            metadata: {
              contributionId: 'contrib-123'
            }
          }
        }
      };

      await handleStripeWebhook(event);

      expect(mockFirestoreHelper.updateDocument).toHaveBeenCalledWith(
        'contributions',
        'contrib-123',
        expect.objectContaining({
          status: 'confirmed',
          confirmedAt: expect.any(Object)
        })
      );
    });
  });

  describe('Payment Intent Failed', () => {
    it('should update contribution status on failed payment', async () => {
      const event = {
        id: 'evt_124',
        type: 'payment_intent.payment_failed',
        data: {
          object: {
            id: 'pi_124',
            last_payment_error: {
              message: 'Card declined'
            },
            metadata: {
              contributionId: 'contrib-124'
            }
          }
        }
      };

      await handleStripeWebhook(event);

      expect(mockFirestoreHelper.updateDocument).toHaveBeenCalledWith(
        'contributions',
        'contrib-124',
        expect.objectContaining({
          status: 'failed',
          failureReason: expect.any(String)
        })
      );
    });
  });

  describe('Refund Processed', () => {
    it('should update contribution on refund', async () => {
      const event = {
        id: 'evt_125',
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_123',
            payment_intent: 'pi_123',
            refunded: true
          }
        }
      };

      await handleStripeWebhook(event);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Webhook processed'),
        expect.any(Object)
      );
    });
  });

  describe('Unknown Event Types', () => {
    it('should log and ignore unknown event types', async () => {
      const event = {
        id: 'evt_126',
        type: 'unknown.event.type',
        data: { object: {} }
      };

      await handleStripeWebhook(event);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Unhandled webhook event'),
        expect.any(Object)
      );
    });
  });
});
