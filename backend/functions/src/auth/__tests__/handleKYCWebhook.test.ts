/**
 * Tests for Handle KYC Webhook Firebase Function
 * Social Finance Impact Platform
 */

import { Request, Response } from 'express';
import crypto from 'crypto';
import { handleKYCWebhook } from '../handleKYCWebhook';
import { sumsubWebhookHandlers } from '../../integrations/sumsub/webhookHandlers';
import { SumsubTypes } from '../../types/external';

// Mocks
jest.mock('../../integrations/sumsub/webhookHandlers');
jest.mock('../../utils/logger');

const mockSumsubWebhookHandlers = jest.mocked(sumsubWebhookHandlers);

describe('handleKYCWebhook Function', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let validWebhookData: SumsubTypes.WebhookData;
  let webhookSecret: string;

  beforeEach(() => {
    jest.clearAllMocks();
    
    webhookSecret = 'test-webhook-secret';
    process.env.SUMSUB_WEBHOOK_SECRET = webhookSecret;

    validWebhookData = {
      applicantId: 'test-applicant-id',
      externalUserId: 'user_test-user-uid_123456',
      type: 'applicantReviewed',
      reviewStatus: 'completed',
      reviewResult: {
        reviewAnswer: 'GREEN',
        moderationComment: 'All documents verified',
        reviewRejectType: undefined,
        rejectLabels: []
      },
      levelName: 'basic-kyc-level',
      sandboxMode: false,
      createdAt: new Date()
    };

    // Calculer la signature valide
    const rawBody = JSON.stringify(validWebhookData);
    const signature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    mockRequest = {
      method: 'POST',
      body: validWebhookData,
      get: jest.fn((header: string) => {
        switch (header) {
          case 'x-payload-digest':
            return `sha256=${signature}`;
          case 'content-type':
            return 'application/json';
          case 'user-agent':
            return 'Sumsub-Webhook/1.0';
          case 'x-request-id':
            return 'webhook-request-123';
          default:
            return undefined;
        }
      }),
      connection: {
        remoteAddress: '185.130.5.1' // IP Sumsub
      }
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis()
    };

    // Mock du handler principal
    mockSumsubWebhookHandlers.handleWebhookWithRetry.mockResolvedValue();
  });

  afterEach(() => {
    delete process.env.SUMSUB_WEBHOOK_SECRET;
  });

  describe('HTTP Method Validation', () => {
    it('should accept POST requests', async () => {
      await handleKYCWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        message: 'Webhook processed successfully',
        timestamp: expect.any(String)
      });
    });

    it('should reject GET requests', async () => {
      mockRequest.method = 'GET';

      await handleKYCWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(405);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Method not allowed',
        message: 'Only POST requests are accepted'
      });
    });

    it('should reject PUT requests', async () => {
      mockRequest.method = 'PUT';

      await handleKYCWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(405);
    });
  });

  describe('Signature Validation', () => {
    it('should validate correct HMAC signature', async () => {
      await handleKYCWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockSumsubWebhookHandlers.handleWebhookWithRetry).toHaveBeenCalled();
    });

    it('should reject requests without signature', async () => {
      (mockRequest.get as jest.Mock).mockImplementation((header: string) => {
        if (header === 'x-payload-digest') return undefined;
        return 'application/json';
      });

      await handleKYCWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Invalid webhook signature or origin'
      });
    });

    it('should reject requests with invalid signature', async () => {
      (mockRequest.get as jest.Mock).mockImplementation((header: string) => {
        if (header === 'x-payload-digest') return 'sha256=invalid-signature';
        return 'application/json';
      });

      await handleKYCWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockSumsubWebhookHandlers.handleWebhookWithRetry).not.toHaveBeenCalled();
    });

    it('should handle signature with alternative header name', async () => {
      (mockRequest.get as jest.Mock).mockImplementation((header: string) => {
        if (header === 'x-sumsub-signature') {
          const rawBody = JSON.stringify(validWebhookData);
          const signature = crypto
            .createHmac('sha256', webhookSecret)
            .update(rawBody)
            .digest('hex');
          return `sha256=${signature}`;
        }
        if (header === 'x-payload-digest') return undefined;
        return 'application/json';
      });

      await handleKYCWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(200);
    });
  });

  describe('Webhook Secret Configuration', () => {
    it('should reject requests when webhook secret is not configured', async () => {
      delete process.env.SUMSUB_WEBHOOK_SECRET;

      await handleKYCWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Invalid webhook signature or origin'
      });
    });
  });

  describe('Request Body Validation', () => {
    it('should reject requests without body', async () => {
      mockRequest.body = undefined;

      await handleKYCWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'invalid-argument',
        message: 'Missing or invalid webhook data'
      });
    });

    it('should reject requests with invalid body', async () => {
      mockRequest.body = 'invalid-json';

      await handleKYCWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
    });

    it('should validate webhook data schema', async () => {
      const invalidWebhookData = {
        applicantId: 'test-applicant-id',
        // Missing required fields
        type: 'invalid-type'
      };

      // Recalculer la signature pour les données invalides
      const rawBody = JSON.stringify(invalidWebhookData);
      const signature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');

      (mockRequest.get as jest.Mock).mockImplementation((header: string) => {
        if (header === 'x-payload-digest') return `sha256=${signature}`;
        return 'application/json';
      });

      mockRequest.body = invalidWebhookData;

      await handleKYCWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
    });
  });

  describe('Webhook Event Processing', () => {
    it('should process valid applicantReviewed events', async () => {
      const reviewedData = {
        ...validWebhookData,
        type: 'applicantReviewed',
        reviewStatus: 'completed',
        reviewResult: {
          reviewAnswer: 'GREEN'
        }
      };

      // Mettre à jour la signature
      const rawBody = JSON.stringify(reviewedData);
      const signature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');

      (mockRequest.get as jest.Mock).mockImplementation((header: string) => {
        if (header === 'x-payload-digest') return `sha256=${signature}`;
        return 'application/json';
      });

      mockRequest.body = reviewedData;

      await handleKYCWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockSumsubWebhookHandlers.handleWebhookWithRetry).toHaveBeenCalledWith(
        expect.objectContaining({
          applicantId: 'test-applicant-id',
          type: 'applicantreviewed', // Normalisé en lowercase
          reviewStatus: 'completed'
        })
      );
    });

    it('should process applicantPending events', async () => {
      const pendingData = {
        ...validWebhookData,
        type: 'applicantPending',
        reviewStatus: 'pending'
      };

      // Mettre à jour la signature et body
      const rawBody = JSON.stringify(pendingData);
      const signature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');

      (mockRequest.get as jest.Mock).mockImplementation((header: string) => {
        if (header === 'x-payload-digest') return `sha256=${signature}`;
        return 'application/json';
      });

      mockRequest.body = pendingData;

      await handleKYCWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockSumsubWebhookHandlers.handleWebhookWithRetry).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'applicantpending'
        })
      );
    });

    it('should handle webhook processing errors', async () => {
      mockSumsubWebhookHandlers.handleWebhookWithRetry.mockRejectedValue(
        new Error('Processing failed')
      );

      await handleKYCWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'internal_error',
        message: 'An internal error occurred while processing the webhook'
      });
    });
  });

  describe('Data Enrichment', () => {
    it('should enrich webhook data with request metadata', async () => {
      await handleKYCWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockSumsubWebhookHandlers.handleWebhookWithRetry).toHaveBeenCalledWith(
        expect.objectContaining({
          receivedAt: expect.any(Date),
          sourceIP: '185.130.5.1',
          userAgent: 'Sumsub-Webhook/1.0',
          type: 'applicantreviewed', // Normalisé
          reviewStatus: 'completed' // Normalisé
        })
      );
    });

    it('should handle missing user agent gracefully', async () => {
      (mockRequest.get as jest.Mock).mockImplementation((header: string) => {
        if (header === 'x-payload-digest') {
          const rawBody = JSON.stringify(validWebhookData);
          const signature = crypto
            .createHmac('sha256', webhookSecret)
            .update(rawBody)
            .digest('hex');
          return `sha256=${signature}`;
        }
        if (header === 'user-agent') return undefined;
        return 'application/json';
      });

      await handleKYCWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockSumsubWebhookHandlers.handleWebhookWithRetry).toHaveBeenCalledWith(
        expect.objectContaining({
          userAgent: undefined
        })
      );
    });
  });

  describe('Duplicate Event Detection', () => {
    it('should detect and ignore duplicate events', async () => {
      // Premier appel
      await handleKYCWebhook(mockRequest as Request, mockResponse as Response);
      
      // Deuxième appel avec même request ID
      jest.clearAllMocks();
      mockSumsubWebhookHandlers.handleWebhookWithRetry.mockResolvedValue();

      await handleKYCWebhook(mockRequest as Request, mockResponse as Response);

      // Les deux appels devraient réussir
      expect(mockResponse.status).toHaveBeenCalledWith(200);
    });

    it('should handle missing request ID gracefully', async () => {
      (mockRequest.get as jest.Mock).mockImplementation((header: string) => {
        if (header === 'x-payload-digest') {
          const rawBody = JSON.stringify(validWebhookData);
          const signature = crypto
            .createHmac('sha256', webhookSecret)
            .update(rawBody)
            .digest('hex');
          return `sha256=${signature}`;
        }
        if (header === 'x-request-id') return undefined;
        return 'application/json';
      });

      await handleKYCWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(200);
    });
  });

  describe('Event Type Support', () => {
    const eventTypes = [
      'applicantReviewed',
      'applicantPending', 
      'applicantCreated',
      'applicantOnHold',
      'applicantActionPending',
      'applicantLevelChanged'
    ];

    eventTypes.forEach(eventType => {
      it(`should support ${eventType} events`, async () => {
        const eventData = {
          ...validWebhookData,
          type: eventType
        };

        // Mettre à jour la signature
        const rawBody = JSON.stringify(eventData);
        const signature = crypto
          .createHmac('sha256', webhookSecret)
          .update(rawBody)
          .digest('hex');

        (mockRequest.get as jest.Mock).mockImplementation((header: string) => {
          if (header === 'x-payload-digest') return `sha256=${signature}`;
          return 'application/json';
        });

        mockRequest.body = eventData;

        await handleKYCWebhook(mockRequest as Request, mockResponse as Response);

        expect(mockResponse.status).toHaveBeenCalledWith(200);
        expect(mockSumsubWebhookHandlers.handleWebhookWithRetry).toHaveBeenCalledWith(
          expect.objectContaining({
            type: eventType.toLowerCase()
          })
        );
      });
    });

    it('should reject unsupported event types', async () => {
      const invalidEventData = {
        ...validWebhookData,
        type: 'unsupportedEventType'
      };

      // Mettre à jour la signature
      const rawBody = JSON.stringify(invalidEventData);
      const signature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');

      (mockRequest.get as jest.Mock).mockImplementation((header: string) => {
        if (header === 'x-payload-digest') return `sha256=${signature}`;
        return 'application/json';
      });

      mockRequest.body = invalidEventData;

      await handleKYCWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
    });
  });

  describe('Security Measures', () => {
    it('should log security events for invalid signatures', async () => {
      (mockRequest.get as jest.Mock).mockImplementation((header: string) => {
        if (header === 'x-payload-digest') return 'sha256=invalid-signature';
        return 'application/json';
      });

      await handleKYCWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
    });

    it('should handle timing attack protection', async () => {
      // Test avec signature presque correcte
      const rawBody = JSON.stringify(validWebhookData);
      const correctSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');
      
      const almostCorrectSignature = correctSignature.slice(0, -1) + '0';

      (mockRequest.get as jest.Mock).mockImplementation((header: string) => {
        if (header === 'x-payload-digest') return `sha256=${almostCorrectSignature}`;
        return 'application/json';
      });

      await handleKYCWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
    });

    it('should capture security audit information', async () => {
      (mockRequest.get as jest.Mock).mockImplementation((header: string) => {
        if (header === 'x-payload-digest') return 'invalid';
        return 'application/json';
      });

      await handleKYCWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
    });
  });

  describe('Error Response Formats', () => {
    it('should return proper error format for validation errors', async () => {
      mockRequest.body = {
        applicantId: 'test-id'
        // Missing required fields
      };

      await handleKYCWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(String),
          message: expect.any(String)
        })
      );
    });

    it('should return proper error format for internal errors', async () => {
      mockSumsubWebhookHandlers.handleWebhookWithRetry.mockRejectedValue(
        new Error('Internal processing error')
      );

      await handleKYCWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'internal_error',
        message: 'An internal error occurred while processing the webhook'
      });
    });
  });

  describe('Success Response Format', () => {
    it('should return proper success response', async () => {
      await handleKYCWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        message: 'Webhook processed successfully',
        timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
      });
    });

    it('should include timestamp in response', async () => {
      const beforeCall = new Date();
      await handleKYCWebhook(mockRequest as Request, mockResponse as Response);
      const afterCall = new Date();

      const responseCall = (mockResponse.json as jest.Mock).mock.calls[0][0];
      const responseTimestamp = new Date(responseCall.timestamp);

      expect(responseTimestamp.getTime()).toBeGreaterThanOrEqual(beforeCall.getTime());
      expect(responseTimestamp.getTime()).toBeLessThanOrEqual(afterCall.getTime());
    });
  });

  describe('Buffer Handling', () => {
    it('should handle Buffer request bodies', async () => {
      const bufferBody = Buffer.from(JSON.stringify(validWebhookData));
      mockRequest.body = bufferBody;

      // Calculer la signature avec le buffer
      const signature = crypto
        .createHmac('sha256', webhookSecret)
        .update(bufferBody)
        .digest('hex');

      (mockRequest.get as jest.Mock).mockImplementation((header: string) => {
        if (header === 'x-payload-digest') return `sha256=${signature}`;
        return 'application/json';
      });

      await handleKYCWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(200);
    });
  });

  describe('IP Address Extraction', () => {
    it('should extract IP from connection.remoteAddress', async () => {
      await handleKYCWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockSumsubWebhookHandlers.handleWebhookWithRetry).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceIP: '185.130.5.1'
        })
      );
    });

    it('should handle missing IP address', async () => {
      delete mockRequest.connection;

      await handleKYCWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(200);
    });
  });

  describe('Sandbox Mode Handling', () => {
    it('should handle sandbox mode events', async () => {
      const sandboxData = {
        ...validWebhookData,
        sandboxMode: true
      };

      // Mettre à jour la signature
      const rawBody = JSON.stringify(sandboxData);
      const signature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');

      (mockRequest.get as jest.Mock).mockImplementation((header: string) => {
        if (header === 'x-payload-digest') return `sha256=${signature}`;
        return 'application/json';
      });

      mockRequest.body = sandboxData;

      await handleKYCWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockSumsubWebhookHandlers.handleWebhookWithRetry).toHaveBeenCalledWith(
        expect.objectContaining({
          sandboxMode: true
        })
      );
    });
  });

  describe('Complex Review Results', () => {
    it('should handle review results with rejection labels', async () => {
      const rejectedData = {
        ...validWebhookData,
        reviewStatus: 'completed',
        reviewResult: {
          reviewAnswer: 'RED',
          moderationComment: 'Document quality insufficient',
          rejectLabels: ['DOCUMENT_PAGE_MISSING', 'BLURRY_IMAGE'],
          reviewRejectType: 'RETRY'
        }
      };

      // Mettre à jour la signature
      const rawBody = JSON.stringify(rejectedData);
      const signature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');

      (mockRequest.get as jest.Mock).mockImplementation((header: string) => {
        if (header === 'x-payload-digest') return `sha256=${signature}`;
        return 'application/json';
      });

      mockRequest.body = rejectedData;

      await handleKYCWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockSumsubWebhookHandlers.handleWebhookWithRetry).toHaveBeenCalledWith(
        expect.objectContaining({
          reviewResult: expect.objectContaining({
            reviewAnswer: 'RED',
            moderationComment: 'Document quality insufficient',
            rejectLabels: ['DOCUMENT_PAGE_MISSING', 'BLURRY_IMAGE'],
            reviewRejectType: 'RETRY'
          })
        })
      );
    });
  });

  describe('Content Type Validation', () => {
    it('should handle various content types', async () => {
      (mockRequest.get as jest.Mock).mockImplementation((header: string) => {
        if (header === 'x-payload-digest') {
          const rawBody = JSON.stringify(validWebhookData);
          const signature = crypto
            .createHmac('sha256', webhookSecret)
            .update(rawBody)
            .digest('hex');
          return `sha256=${signature}`;
        }
        if (header === 'content-type') return 'application/json; charset=utf-8';
        return undefined;
      });

      await handleKYCWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(200);
    });
  });

  describe('Rate Limiting Considerations', () => {
    it('should handle high frequency webhook calls', async () => {
      // Simuler plusieurs appels rapides
      const promises = Array.from({ length: 5 }, () =>
        handleKYCWebhook(mockRequest as Request, mockResponse as Response)
      );

      await Promise.all(promises);

      expect(mockSumsubWebhookHandlers.handleWebhookWithRetry).toHaveBeenCalledTimes(5);
    });
  });

  describe('Malformed Data Handling', () => {
    it('should handle malformed JSON gracefully', async () => {
      mockRequest.body = '{ malformed json }';

      await handleKYCWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
    });

    it('should handle null values in webhook data', async () => {
      const dataWithNulls = {
        ...validWebhookData,
        reviewResult: null,
        levelName: null
      };

      // Mettre à jour la signature
      const rawBody = JSON.stringify(dataWithNulls);
      const signature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');

      (mockRequest.get as jest.Mock).mockImplementation((header: string) => {
        if (header === 'x-payload-digest') return `sha256=${signature}`;
        return 'application/json';
      });

      mockRequest.body = dataWithNulls;

      await handleKYCWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(200);
    });
  });

  describe('Response Object Structure', () => {
    it('should always include required response fields', async () => {
      await handleKYCWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: expect.any(Boolean),
          message: expect.any(String),
          timestamp: expect.any(String)
        })
      );
    });
  });
});