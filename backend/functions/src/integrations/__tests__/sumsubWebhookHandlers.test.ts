/**
 * Tests for Sumsub Webhook Handlers
 * Social Finance Impact Platform
 */

import { handleSumsubWebhook } from '../sumsub/webhookHandlers';
import { firestoreHelper } from '../../utils/firestore';
import { logger } from '../../utils/logger';

jest.mock('../../utils/firestore');
jest.mock('../../utils/logger');

const mockFirestoreHelper = jest.mocked(firestoreHelper);
const mockLogger = jest.mocked(logger);

describe('Sumsub Webhook Handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFirestoreHelper.updateDocument.mockResolvedValue();
    mockFirestoreHelper.getDocument.mockResolvedValue({
      id: 'user-123',
      kyc: {
        provider: 'sumsub',
        applicantId: 'applicant-123'
      }
    } as any);
  });

  describe('Applicant Reviewed', () => {
    it('should update user KYC status on GREEN review', async () => {
      const webhook = {
        type: 'applicantReviewed',
        applicantId: 'applicant-123',
        externalUserId: 'user-123',
        reviewResult: {
          reviewAnswer: 'GREEN'
        }
      };

      await handleSumsubWebhook(webhook);

      expect(mockFirestoreHelper.updateDocument).toHaveBeenCalledWith(
        'users',
        'user-123',
        expect.objectContaining({
          'kyc.status': 'approved',
          'kyc.level': expect.any(Number),
          'kyc.verifiedAt': expect.any(Object)
        })
      );
    });

    it('should handle RED review result', async () => {
      const webhook = {
        type: 'applicantReviewed',
        applicantId: 'applicant-123',
        externalUserId: 'user-123',
        reviewResult: {
          reviewAnswer: 'RED',
          rejectLabels: ['FRAUDULENT_PATTERNS']
        }
      };

      await handleSumsubWebhook(webhook);

      expect(mockFirestoreHelper.updateDocument).toHaveBeenCalledWith(
        'users',
        'user-123',
        expect.objectContaining({
          'kyc.status': 'rejected',
          'kyc.rejectionReason': expect.any(String)
        })
      );
    });
  });

  describe('Document Verification', () => {
    it('should handle document verification events', async () => {
      const webhook = {
        type: 'applicantPending',
        applicantId: 'applicant-123',
        externalUserId: 'user-123'
      };

      await handleSumsubWebhook(webhook);

      expect(mockFirestoreHelper.updateDocument).toHaveBeenCalledWith(
        'users',
        'user-123',
        expect.objectContaining({
          'kyc.status': 'pending'
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle missing user gracefully', async () => {
      mockFirestoreHelper.getDocument.mockResolvedValue(null);

      const webhook = {
        type: 'applicantReviewed',
        externalUserId: 'non-existent-user'
      };

      await expect(handleSumsubWebhook(webhook)).resolves.not.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('User not found'),
        expect.any(Object)
      );
    });
  });
});
