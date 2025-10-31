/**
 * Handle Stripe Webhook Tests
 * Social Finance Impact Platform
 */

import { handleStripeWebhook } from '../handleStripeWebhook';
import { Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { firestoreHelper } from '../../utils/firestore';
import { stripeService } from '../../integrations/stripe/stripeService';
import { emailService } from '../../integrations/sendgrid/emailService';
import { helpers } from '../../utils/helpers';
import { STATUS } from '../../utils/constants';
import { ContributionDocument, ProjectDocument, UserDocument } from '../../types/firestore';

// Mocks
jest.mock('../../utils/logger');
jest.mock('../../utils/firestore');
jest.mock('../../integrations/stripe/stripeService');
jest.mock('../../integrations/sendgrid/emailService');
jest.mock('../../utils/helpers');

describe('handleStripeWebhook', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockContribution: ContributionDocument;
  let mockProject: ProjectDocument;
  let mockUser: UserDocument;

  beforeEach(() => {
    jest.clearAllMocks();

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };

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
      anonymous: false,
      createdAt: new Date(),
      payment: {
        paymentIntentId: 'pi_test123'
      },
      version: 1
    } as ContributionDocument;

    mockProject = {
      uid: 'project123',
      title: 'Test Project',
      slug: 'test-project',
      category: 'environment',
      funding: {
        goal: 100000,
        raised: 25000,
        percentage: 25,
        contributorsCount: 10
      }
    } as ProjectDocument;

    mockUser = {
      uid: 'user123',
      email: 'test@example.com',
      firstName: 'John',
      lastName: 'Doe'
    } as UserDocument;

    // Setup default mocks
    (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
      if (collection.includes('contributions')) return Promise.resolve(mockContribution);
      if (collection === 'projects') return Promise.resolve(mockProject);
      if (collection === 'users') return Promise.resolve(mockUser);
      return Promise.resolve({});
    });

    (firestoreHelper.updateDocument as jest.Mock).mockResolvedValue(true);
    (firestoreHelper.runTransaction as jest.Mock).mockImplementation(async (callback) => {
      const mockTransaction = {
        update: jest.fn(),
        get: jest.fn().mockResolvedValue({ 
          exists: true, 
          data: () => mockProject 
        })
      };
      return await callback(mockTransaction);
    });

    (helpers.string.generateId as jest.Mock).mockReturnValue('txn123');
    (emailService.sendEmail as jest.Mock).mockResolvedValue(true);
  });

  describe('HTTP Method Validation', () => {
    it('should reject non-POST requests', async () => {
      mockRequest = {
        method: 'GET',
        get: jest.fn(),
        body: {}
      };

      await handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(405);
      expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Method not allowed' });
    });

    it('should accept POST requests', async () => {
      const mockEvent = {
        id: 'evt_test123',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test123',
            status: 'succeeded',
            metadata: {
              contributionId: 'contrib123',
              projectId: 'project123'
            },
            charges: {
              data: [{
                id: 'ch_test123',
                receipt_url: 'https://stripe.com/receipt123'
              }]
            }
          }
        }
      };

      mockRequest = {
        method: 'POST',
        get: jest.fn().mockReturnValue('stripe_signature'),
        body: JSON.stringify(mockEvent)
      };

      (stripeService.constructWebhookEvent as jest.Mock).mockReturnValue(mockEvent);

      await handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(200);
    });
  });

  describe('Webhook Signature Validation', () => {
    it('should validate Stripe webhook signature', async () => {
      const mockEvent = {
        id: 'evt_test123',
        type: 'payment_intent.succeeded',
        data: { object: {} }
      };

      mockRequest = {
        method: 'POST',
        get: jest.fn().mockReturnValue('valid_signature'),
        body: JSON.stringify(mockEvent)
      };

      (stripeService.constructWebhookEvent as jest.Mock).mockReturnValue(mockEvent);

      await handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(stripeService.constructWebhookEvent).toHaveBeenCalledWith(
        mockRequest.body,
        'valid_signature',
        process.env.STRIPE_WEBHOOK_SECRET
      );
    });

    it('should reject requests without signature', async () => {
      mockRequest = {
        method: 'POST',
        get: jest.fn().mockReturnValue(undefined),
        body: {}
      };

      await handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    });

    it('should reject invalid signatures', async () => {
      mockRequest = {
        method: 'POST',
        get: jest.fn().mockReturnValue('invalid_signature'),
        body: {}
      };

      (stripeService.constructWebhookEvent as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid signature');
      });

      await handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
    });
  });

  describe('PaymentIntent Events', () => {
    it('should handle payment_intent.succeeded', async () => {
      const successEvent = {
        id: 'evt_test123',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test123',
            status: 'succeeded',
            metadata: {
              contributionId: 'contrib123',
              projectId: 'project123'
            },
            charges: {
              data: [{
                id: 'ch_test123',
                receipt_url: 'https://stripe.com/receipt123'
              }]
            }
          }
        }
      };

      mockRequest = {
        method: 'POST',
        get: jest.fn().mockReturnValue('valid_signature'),
        body: JSON.stringify(successEvent)
      };

      (stripeService.constructWebhookEvent as jest.Mock).mockReturnValue(successEvent);

      await handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(firestoreHelper.runTransaction).toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(200);
    });

    it('should handle payment_intent.payment_failed', async () => {
      const failureEvent = {
        id: 'evt_test123',
        type: 'payment_intent.payment_failed',
        data: {
          object: {
            id: 'pi_test123',
            status: 'failed',
            metadata: {
              contributionId: 'contrib123',
              projectId: 'project123'
            },
            last_payment_error: {
              message: 'Your card was declined',
              code: 'card_declined'
            }
          }
        }
      };

      mockRequest = {
        method: 'POST',
        get: jest.fn().mockReturnValue('valid_signature'),
        body: JSON.stringify(failureEvent)
      };

      (stripeService.constructWebhookEvent as jest.Mock).mockReturnValue(failureEvent);

      await handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(firestoreHelper.updateDocument).toHaveBeenCalledWith(
        'projects/project123/contributions',
        'contrib123',
        expect.objectContaining({
          status: 'failed',
          'payment.failureReason': 'Your card was declined',
          'payment.failureCode': 'card_declined'
        })
      );
    });

    it('should handle payment_intent.canceled', async () => {
      const cancelEvent = {
        id: 'evt_test123',
        type: 'payment_intent.canceled',
        data: {
          object: {
            id: 'pi_test123',
            status: 'canceled',
            metadata: {
              contributionId: 'contrib123',
              projectId: 'project123'
            }
          }
        }
      };

      mockRequest = {
        method: 'POST',
        get: jest.fn().mockReturnValue('valid_signature'),
        body: JSON.stringify(cancelEvent)
      };

      (stripeService.constructWebhookEvent as jest.Mock).mockReturnValue(cancelEvent);

      await handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(firestoreHelper.updateDocument).toHaveBeenCalledWith(
        'projects/project123/contributions',
        'contrib123',
        expect.objectContaining({
          status: 'cancelled',
          cancelledAt: expect.any(Date)
        })
      );
    });

    it('should handle payment_intent.requires_action', async () => {
      const actionRequiredEvent = {
        id: 'evt_test123',
        type: 'payment_intent.requires_action',
        data: {
          object: {
            id: 'pi_test123',
            status: 'requires_action',
            metadata: {
              contributionId: 'contrib123',
              projectId: 'project123'
            },
            next_action: {
              type: 'use_stripe_sdk'
            }
          }
        }
      };

      mockRequest = {
        method: 'POST',
        get: jest.fn().mockReturnValue('valid_signature'),
        body: JSON.stringify(actionRequiredEvent)
      };

      (stripeService.constructWebhookEvent as jest.Mock).mockReturnValue(actionRequiredEvent);

      await handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(firestoreHelper.updateDocument).toHaveBeenCalledWith(
        'projects/project123/contributions',
        'contrib123',
        expect.objectContaining({
          'payment.requiresAction': true,
          'payment.nextActionType': 'use_stripe_sdk'
        })
      );
    });
  });

  describe('Charge Events', () => {
    it('should handle charge.succeeded', async () => {
      const chargeSuccessEvent = {
        id: 'evt_test123',
        type: 'charge.succeeded',
        data: {
          object: {
            id: 'ch_test123',
            status: 'succeeded',
            payment_intent: 'pi_test123',
            amount: 10000
          }
        }
      };

      mockRequest = {
        method: 'POST',
        get: jest.fn().mockReturnValue('valid_signature'),
        body: JSON.stringify(chargeSuccessEvent)
      };

      (stripeService.constructWebhookEvent as jest.Mock).mockReturnValue(chargeSuccessEvent);

      await handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(logger.info).toHaveBeenCalledWith(
        'Charge succeeded (handled by PaymentIntent events)',
        expect.objectContaining({
          chargeId: 'ch_test123'
        })
      );
    });

    it('should handle charge.dispute.created', async () => {
      const disputeEvent = {
        id: 'evt_test123',
        type: 'charge.dispute.created',
        data: {
          object: {
            id: 'dp_test123',
            reason: 'fraudulent',
            status: 'warning_needs_response'
          }
        }
      };

      const chargeWithMetadata = {
        id: 'ch_test123',
        payment_intent: 'pi_test123',
        metadata: {
          contributionId: 'contrib123',
          projectId: 'project123',
          contributorUid: 'user123'
        }
      };

      mockRequest = {
        method: 'POST',
        get: jest.fn().mockReturnValue('valid_signature'),
        body: JSON.stringify(disputeEvent)
      };

      (stripeService.constructWebhookEvent as jest.Mock).mockReturnValue({
        ...disputeEvent,
        data: {
          object: disputeEvent.data.object,
          previous_attributes: {},
          charge: chargeWithMetadata
        }
      });

      await handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(firestoreHelper.updateDocument).toHaveBeenCalledWith(
        'projects/project123/contributions',
        'contrib123',
        expect.objectContaining({
          status: 'disputed',
          'payment.disputeId': 'dp_test123',
          'payment.disputeReason': 'fraudulent'
        })
      );

      expect(logger.security).toHaveBeenCalledWith(
        'Payment dispute created',
        'high',
        expect.objectContaining({
          disputeId: 'dp_test123',
          disputeReason: 'fraudulent'
        })
      );
    });

    it('should handle charge.refunded', async () => {
      const refundEvent = {
        id: 'evt_test123',
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_test123',
            refunds: {
              data: [{
                id: 're_test123',
                amount: 10000,
                reason: 'requested_by_customer'
              }]
            },
            metadata: {
              contributionId: 'contrib123',
              projectId: 'project123'
            }
          }
        }
      };

      mockRequest = {
        method: 'POST',
        get: jest.fn().mockReturnValue('valid_signature'),
        body: JSON.stringify(refundEvent)
      };

      (stripeService.constructWebhookEvent as jest.Mock).mockReturnValue(refundEvent);

      await handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(firestoreHelper.updateDocument).toHaveBeenCalledWith(
        'projects/project123/contributions',
        'contrib123',
        expect.objectContaining({
          status: 'refunded',
          'payment.refundId': 're_test123',
          'payment.refundAmount': 10000
        })
      );
    });
  });

  describe('Payment Success Processing', () => {
    it('should skip already confirmed contributions', async () => {
      const confirmedContribution = { ...mockContribution, status: 'confirmed' };
      (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
        if (collection.includes('contributions')) return Promise.resolve(confirmedContribution);
        return Promise.resolve({});
      });

      const successEvent = {
        id: 'evt_test123',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test123',
            status: 'succeeded',
            metadata: {
              contributionId: 'contrib123',
              projectId: 'project123'
            }
          }
        }
      };

      mockRequest = {
        method: 'POST',
        get: jest.fn().mockReturnValue('valid_signature'),
        body: JSON.stringify(successEvent)
      };

      (stripeService.constructWebhookEvent as jest.Mock).mockReturnValue(successEvent);

      await handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(logger.info).toHaveBeenCalledWith(
        'Contribution already confirmed, skipping',
        expect.objectContaining({
          contributionId: 'contrib123'
        })
      );
    });

    it('should update project funding statistics', async () => {
      const successEvent = {
        id: 'evt_test123',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test123',
            status: 'succeeded',
            metadata: {
              contributionId: 'contrib123',
              projectId: 'project123'
            },
            charges: {
              data: [{
                id: 'ch_test123',
                receipt_url: 'https://stripe.com/receipt123'
              }]
            }
          }
        }
      };

      mockRequest = {
        method: 'POST',
        get: jest.fn().mockReturnValue('valid_signature'),
        body: JSON.stringify(successEvent)
      };

      (stripeService.constructWebhookEvent as jest.Mock).mockReturnValue(successEvent);

      await handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(firestoreHelper.runTransaction).toHaveBeenCalled();
    });

    it('should send receipt email for non-anonymous contributions', async () => {
      const successEvent = {
        id: 'evt_test123',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test123',
            status: 'succeeded',
            metadata: {
              contributionId: 'contrib123',
              projectId: 'project123'
            },
            charges: {
              data: [{
                id: 'ch_test123',
                receipt_url: 'https://stripe.com/receipt123'
              }]
            }
          }
        }
      };

      mockRequest = {
        method: 'POST',
        get: jest.fn().mockReturnValue('valid_signature'),
        body: JSON.stringify(successEvent)
      };

      (stripeService.constructWebhookEvent as jest.Mock).mockReturnValue(successEvent);

      await handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(emailService.sendEmail).toHaveBeenCalledWith({
        to: 'test@example.com',
        templateId: 'contribution_receipt_webhook',
        dynamicTemplateData: expect.objectContaining({
          contributorName: 'John Doe',
          projectTitle: 'Test Project',
          receiptUrl: 'https://stripe.com/receipt123'
        })
      });
    });

    it('should skip receipt for anonymous contributions', async () => {
      const anonymousContribution = { ...mockContribution, anonymous: true };
      (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
        if (collection.includes('contributions')) return Promise.resolve(anonymousContribution);
        return Promise.resolve({});
      });

      const successEvent = {
        id: 'evt_test123',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test123',
            status: 'succeeded',
            metadata: {
              contributionId: 'contrib123',
              projectId: 'project123'
            },
            charges: {
              data: [{
                id: 'ch_test123',
                receipt_url: 'https://stripe.com/receipt123'
              }]
            }
          }
        }
      };

      mockRequest = {
        method: 'POST',
        get: jest.fn().mockReturnValue('valid_signature'),
        body: JSON.stringify(successEvent)
      };

      (stripeService.constructWebhookEvent as jest.Mock).mockReturnValue(successEvent);

      await handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(emailService.sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('Missing Metadata Handling', () => {
    it('should handle events without contribution metadata', async () => {
      const eventWithoutMetadata = {
        id: 'evt_test123',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test123',
            status: 'succeeded',
            metadata: {} // No contributionId or projectId
          }
        }
      };

      mockRequest = {
        method: 'POST',
        get: jest.fn().mockReturnValue('valid_signature'),
        body: JSON.stringify(eventWithoutMetadata)
      };

      (stripeService.constructWebhookEvent as jest.Mock).mockReturnValue(eventWithoutMetadata);

      await handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(logger.warn).toHaveBeenCalledWith(
        'PaymentIntent missing required metadata',
        expect.objectContaining({
          paymentIntentId: 'pi_test123'
        })
      );

      expect(mockResponse.status).toHaveBeenCalledWith(200);
    });

    it('should handle charge events without metadata', async () => {
      const chargeWithoutMetadata = {
        id: 'evt_test123',
        type: 'charge.dispute.created',
        data: {
          object: {
            id: 'dp_test123',
            reason: 'fraudulent'
          },
          charge: {
            id: 'ch_test123',
            metadata: {} // No contributionId
          }
        }
      };

      mockRequest = {
        method: 'POST',
        get: jest.fn().mockReturnValue('valid_signature'),
        body: JSON.stringify(chargeWithoutMetadata)
      };

      (stripeService.constructWebhookEvent as jest.Mock).mockReturnValue(chargeWithoutMetadata);

      await handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(logger.warn).toHaveBeenCalledWith(
        'Charge dispute without contribution metadata',
        expect.objectContaining({
          chargeId: 'ch_test123'
        })
      );
    });
  });

  describe('Unhandled Event Types', () => {
    it('should log unhandled PaymentIntent events', async () => {
      const unknownEvent = {
        id: 'evt_test123',
        type: 'payment_intent.unknown_event',
        data: {
          object: {
            id: 'pi_test123',
            metadata: {
              contributionId: 'contrib123',
              projectId: 'project123'
            }
          }
        }
      };

      mockRequest = {
        method: 'POST',
        get: jest.fn().mockReturnValue('valid_signature'),
        body: JSON.stringify(unknownEvent)
      };

      (stripeService.constructWebhookEvent as jest.Mock).mockReturnValue(unknownEvent);

      await handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(logger.info).toHaveBeenCalledWith(
        'Unhandled PaymentIntent event type',
        expect.objectContaining({
          eventType: 'payment_intent.unknown_event'
        })
      );
    });

    it('should log unhandled webhook event types', async () => {
      const unknownEvent = {
        id: 'evt_test123',
        type: 'customer.created',
        data: { object: {} }
      };

      mockRequest = {
        method: 'POST',
        get: jest.fn().mockReturnValue('valid_signature'),
        body: JSON.stringify(unknownEvent)
      };

      (stripeService.constructWebhookEvent as jest.Mock).mockReturnValue(unknownEvent);

      await handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(logger.info).toHaveBeenCalledWith(
        'Unhandled Stripe webhook event type',
        expect.objectContaining({
          eventType: 'customer.created'
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should return 500 for processing errors', async () => {
      const successEvent = {
        id: 'evt_test123',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test123',
            metadata: {
              contributionId: 'contrib123',
              projectId: 'project123'
            }
          }
        }
      };

      mockRequest = {
        method: 'POST',
        get: jest.fn().mockReturnValue('valid_signature'),
        body: JSON.stringify(successEvent)
      };

      (stripeService.constructWebhookEvent as jest.Mock).mockReturnValue(successEvent);
      (firestoreHelper.getDocument as jest.Mock).mockRejectedValue(new Error('Database error'));

      await handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Webhook processing failed' });
    });

    it('should handle Firestore transaction failures', async () => {
      (firestoreHelper.runTransaction as jest.Mock).mockRejectedValue(
        new Error('Transaction failed')
      );

      const successEvent = {
        id: 'evt_test123',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test123',
            status: 'succeeded',
            metadata: {
              contributionId: 'contrib123',
              projectId: 'project123'
            },
            charges: {
              data: [{
                id: 'ch_test123',
                receipt_url: 'https://stripe.com/receipt123'
              }]
            }
          }
        }
      };

      mockRequest = {
        method: 'POST',
        get: jest.fn().mockReturnValue('valid_signature'),
        body: JSON.stringify(successEvent)
      };

      (stripeService.constructWebhookEvent as jest.Mock).mockReturnValue(successEvent);

      await handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
    });

    it('should not fail webhook for email errors', async () => {
      (emailService.sendEmail as jest.Mock).mockRejectedValue(
        new Error('Email service down')
      );

      const successEvent = {
        id: 'evt_test123',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test123',
            status: 'succeeded',
            metadata: {
              contributionId: 'contrib123',
              projectId: 'project123'
            },
            charges: {
              data: [{
                id: 'ch_test123',
                receipt_url: 'https://stripe.com/receipt123'
              }]
            }
          }
        }
      };

      mockRequest = {
        method: 'POST',
        get: jest.fn().mockReturnValue('valid_signature'),
        body: JSON.stringify(successEvent)
      };

      (stripeService.constructWebhookEvent as jest.Mock).mockReturnValue(successEvent);

      await handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(200);
    });
  });

  describe('Business Logic', () => {
    it('should generate transaction ID for successful payments', async () => {
      const successEvent = {
        id: 'evt_test123',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test123',
            status: 'succeeded',
            metadata: {
              contributionId: 'contrib123',
              projectId: 'project123'
            },
            charges: {
              data: [{
                id: 'ch_test123',
                receipt_url: 'https://stripe.com/receipt123'
              }]
            }
          }
        }
      };

      mockRequest = {
        method: 'POST',
        get: jest.fn().mockReturnValue('valid_signature'),
        body: JSON.stringify(successEvent)
      };

      (stripeService.constructWebhookEvent as jest.Mock).mockReturnValue(successEvent);

      await handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(helpers.string.generateId).toHaveBeenCalledWith('txn');
    });

    it('should log business events for payments', async () => {
      const successEvent = {
        id: 'evt_test123',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test123',
            status: 'succeeded',
            metadata: {
              contributionId: 'contrib123',
              projectId: 'project123'
            },
            charges: {
              data: [{
                id: 'ch_test123',
                receipt_url: 'https://stripe.com/receipt123'
              }]
            }
          }
        }
      };

      mockRequest = {
        method: 'POST',
        get: jest.fn().mockReturnValue('valid_signature'),
        body: JSON.stringify(successEvent)
      };

      (stripeService.constructWebhookEvent as jest.Mock).mockReturnValue(successEvent);

      await handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(logger.business).toHaveBeenCalledWith(
        'Payment confirmed via webhook',
        'payments',
        expect.objectContaining({
          contributionId: 'contrib123',
          paymentIntentId: 'pi_test123',
          amount: 10000
        })
      );
    });
  });

  describe('Response Format', () => {
    it('should return success response with event details', async () => {
      const testEvent = {
        id: 'evt_test123',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test123',
            metadata: {
              contributionId: 'contrib123',
              projectId: 'project123'
            }
          }
        }
      };

      mockRequest = {
        method: 'POST',
        get: jest.fn().mockReturnValue('valid_signature'),
        body: JSON.stringify(testEvent)
      };

      (stripeService.constructWebhookEvent as jest.Mock).mockReturnValue(testEvent);

      await handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.json).toHaveBeenCalledWith({
        received: true,
        eventType: 'payment_intent.succeeded',
        eventId: 'evt_test123',
        processed: true
      });
    });

    it('should handle events without charges data', async () => {
      const eventWithoutCharges = {
        id: 'evt_test123',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test123',
            status: 'succeeded',
            metadata: {
              contributionId: 'contrib123',
              projectId: 'project123'
            }
            // No charges data
          }
        }
      };

      mockRequest = {
        method: 'POST',
        get: jest.fn().mockReturnValue('valid_signature'),
        body: JSON.stringify(eventWithoutCharges)
      };

      (stripeService.constructWebhookEvent as jest.Mock).mockReturnValue(eventWithoutCharges);

      await handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(200);
    });
  });

  describe('Account Events', () => {
    it('should handle account events', async () => {
      const accountEvent = {
        id: 'evt_test123',
        type: 'account.updated',
        data: {
          object: {
            id: 'acct_test123',
            charges_enabled: true,
            payouts_enabled: true
          }
        }
      };

      mockRequest = {
        method: 'POST',
        get: jest.fn().mockReturnValue('valid_signature'),
        body: JSON.stringify(accountEvent)
      };

      (stripeService.constructWebhookEvent as jest.Mock).mockReturnValue(accountEvent);

      await handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(logger.info).toHaveBeenCalledWith(
        'Processing Account event',
        expect.objectContaining({
          eventType: 'account.updated',
          accountId: 'acct_test123'
        })
      );

      expect(mockResponse.status).toHaveBeenCalledWith(200);
    });
  });

  describe('Webhook Reliability', () => {
    it('should handle duplicate webhook deliveries', async () => {
      const duplicateEvent = {
        id: 'evt_test123', // Same ID as previous
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test123',
            status: 'succeeded',
            metadata: {
              contributionId: 'contrib123',
              projectId: 'project123'
            }
          }
        }
      };

      mockRequest = {
        method: 'POST',
        get: jest.fn().mockReturnValue('valid_signature'),
        body: JSON.stringify(duplicateEvent)
      };

      (stripeService.constructWebhookEvent as jest.Mock).mockReturnValue(duplicateEvent);

      // Process the same event twice
      await handleStripeWebhook(mockRequest as Request, mockResponse as Response);
      await handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(200);
    });

    it('should ensure idempotent processing', async () => {
      const confirmedContribution = { ...mockContribution, status: 'confirmed' };
      (firestoreHelper.getDocument as jest.Mock).mockImplementation((collection, id) => {
        if (collection.includes('contributions')) return Promise.resolve(confirmedContribution);
        return Promise.resolve({});
      });

      const successEvent = {
        id: 'evt_test123',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test123',
            status: 'succeeded',
            metadata: {
              contributionId: 'contrib123',
              projectId: 'project123'
            }
          }
        }
      };

      mockRequest = {
        method: 'POST',
        get: jest.fn().mockReturnValue('valid_signature'),
        body: JSON.stringify(successEvent)
      };

      (stripeService.constructWebhookEvent as jest.Mock).mockReturnValue(successEvent);

      await handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      // Should not attempt to update already confirmed contribution
      expect(firestoreHelper.runTransaction).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(200);
    });
  });

  describe('Performance', () => {
    it('should handle high-volume webhook processing', async () => {
      const events = Array.from({ length: 100 }, (_, i) => ({
        id: `evt_test${i}`,
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: `pi_test${i}`,
            status: 'succeeded',
            metadata: {
              contributionId: `contrib${i}`,
              projectId: 'project123'
            }
          }
        }
      }));

      const promises = events.map(async (event) => {
        mockRequest = {
          method: 'POST',
          get: jest.fn().mockReturnValue('valid_signature'),
          body: JSON.stringify(event)
        };

        (stripeService.constructWebhookEvent as jest.Mock).mockReturnValue(event);

        return handleStripeWebhook(mockRequest as Request, mockResponse as Response);
      });

      await Promise.all(promises);

      expect(mockResponse.status).toHaveBeenCalledWith(200);
    });
  });
});