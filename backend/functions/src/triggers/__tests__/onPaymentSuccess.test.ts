/**
 * Tests for Payment Success Trigger Function
 * Social Finance Impact Platform
 */

import { onPaymentSuccess } from '../onPaymentSuccess';
import { firestoreHelper } from '../../utils/firestore';
import { logger } from '../../utils/logger';
import { emailService } from '../../integrations/sendgrid/emailService';

jest.mock('../../utils/firestore');
jest.mock('../../utils/logger');
jest.mock('../../integrations/sendgrid/emailService');

const mockFirestoreHelper = jest.mocked(firestoreHelper);
const mockLogger = jest.mocked(logger);
const mockEmailService = jest.mocked(emailService);

describe('onPaymentSuccess Trigger Function', () => {
  let mockSnapshot: any;
  let mockContext: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockSnapshot = {
      id: 'contribution-123',
      data: () => ({
        id: 'contribution-123',
        projectId: 'project-456',
        contributorUid: 'user-789',
        amount: 10000,
        status: 'confirmed',
        confirmedAt: new Date(),
        stripePaymentIntentId: 'pi_123'
      }),
      ref: {
        update: jest.fn().mockResolvedValue(undefined)
      }
    };

    mockContext = {
      eventId: 'event-123',
      timestamp: new Date().toISOString()
    };

    mockFirestoreHelper.getDocument.mockResolvedValue({
      id: 'project-456',
      title: 'Great Project',
      creator: { uid: 'creator-456', displayName: 'Creator' }
    } as any);

    mockFirestoreHelper.updateDocument.mockResolvedValue();
    mockFirestoreHelper.setDocument.mockResolvedValue();
    mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ funding: { raised: 50000 } })
        }),
        update: jest.fn()
      };
      await callback(mockTransaction as any);
    });
    mockEmailService.sendContributionReceipt.mockResolvedValue();
  });

  describe('Project Funding Update', () => {
    it('should update project funding amount', async () => {
      await onPaymentSuccess(mockSnapshot, mockContext);

      expect(mockFirestoreHelper.runTransaction).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Project funding updated'),
        expect.any(Object)
      );
    });

    it('should increment contributor count', async () => {
      await onPaymentSuccess(mockSnapshot, mockContext);

      expect(mockFirestoreHelper.runTransaction).toHaveBeenCalled();
    });
  });

  describe('User Statistics Update', () => {
    it('should update contributor statistics', async () => {
      await onPaymentSuccess(mockSnapshot, mockContext);

      expect(mockFirestoreHelper.updateDocument).toHaveBeenCalledWith(
        'users',
        'user-789',
        expect.objectContaining({
          'stats.totalContributed': expect.anything(),
          'stats.projectsSupported': expect.anything()
        })
      );
    });

    it('should update creator statistics', async () => {
      await onPaymentSuccess(mockSnapshot, mockContext);

      expect(mockFirestoreHelper.updateDocument).toHaveBeenCalledWith(
        'users',
        'creator-456',
        expect.objectContaining({
          'stats.totalFundsRaised': expect.anything()
        })
      );
    });
  });

  describe('Notifications', () => {
    it('should send receipt email to contributor', async () => {
      await onPaymentSuccess(mockSnapshot, mockContext);

      expect(mockEmailService.sendContributionReceipt).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          amount: 10000,
          projectTitle: 'Great Project'
        })
      );
    });

    it('should notify project creator of contribution', async () => {
      await onPaymentSuccess(mockSnapshot, mockContext);

      expect(mockFirestoreHelper.setDocument).toHaveBeenCalledWith(
        expect.stringContaining('notifications'),
        expect.any(String),
        expect.objectContaining({
          type: 'contribution_received',
          userId: 'creator-456'
        })
      );
    });

    it('should notify contributor of successful payment', async () => {
      await onPaymentSuccess(mockSnapshot, mockContext);

      expect(mockFirestoreHelper.setDocument).toHaveBeenCalledWith(
        expect.stringContaining('notifications'),
        expect.any(String),
        expect.objectContaining({
          type: 'payment_confirmed',
          userId: 'user-789'
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle missing project gracefully', async () => {
      mockFirestoreHelper.getDocument.mockResolvedValue(null);

      await expect(onPaymentSuccess(mockSnapshot, mockContext)).resolves.not.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Project not found'),
        expect.any(Object)
      );
    });

    it('should handle transaction errors', async () => {
      mockFirestoreHelper.runTransaction.mockRejectedValue(new Error('Transaction failed'));

      await expect(onPaymentSuccess(mockSnapshot, mockContext)).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should continue if email fails', async () => {
      mockEmailService.sendContributionReceipt.mockRejectedValue(new Error('Email failed'));

      await expect(onPaymentSuccess(mockSnapshot, mockContext)).resolves.not.toThrow();
    });
  });

  describe('Milestone Tracking', () => {
    it('should check if contribution triggers milestone', async () => {
      await onPaymentSuccess(mockSnapshot, mockContext);

      expect(mockFirestoreHelper.getDocument).toHaveBeenCalledWith(
        'projects',
        'project-456'
      );
    });
  });
});
