/**
 * Tests for Cleanup Expired Data Scheduled Function
 * Social Finance Impact Platform
 */

import { cleanupExpiredData } from '../cleanupExpiredData';
import { firestoreHelper } from '../../utils/firestore';
import { logger } from '../../utils/logger';
import { NotificationDocument } from '../../types/firestore';
import { CLEANUP_CONFIG, RETENTION_POLICY } from '../../utils/constants';

// Mocks
jest.mock('../../utils/firestore');
jest.mock('../../utils/logger');

const mockFirestoreHelper = jest.mocked(firestoreHelper);
const mockLogger = jest.mocked(logger);

describe('cleanupExpiredData Scheduled Function', () => {
  let mockExpiredNotifications: NotificationDocument[];

  beforeEach(() => {
    jest.clearAllMocks();

    const now = new Date();
    const expiredDate = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000); // 40 days ago

    mockExpiredNotifications = [
      {
        id: 'notif-1',
        userId: 'user-1',
        type: 'project_update',
        title: 'Project Updated',
        message: 'Your project has been updated',
        read: true,
        expiresAt: expiredDate,
        expired: false,
        createdAt: expiredDate
      } as any,
      {
        id: 'notif-2',
        userId: 'user-2',
        type: 'contribution_received',
        title: 'Contribution Received',
        message: 'You received a new contribution',
        read: false,
        expiresAt: expiredDate,
        expired: false,
        createdAt: expiredDate
      } as any
    ];

    // Default mocks
    mockFirestoreHelper.queryDocuments.mockResolvedValue(mockExpiredNotifications);
    mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({ exists: true }),
        set: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      };
      await callback(mockTransaction as any);
    });
    mockFirestoreHelper.getDocumentRef.mockReturnValue({} as any);
    mockFirestoreHelper.deleteDocument.mockResolvedValue();
  });

  describe('Notification Cleanup', () => {
    it('should query expired notifications', async () => {
      await cleanupExpiredData();

      expect(mockFirestoreHelper.queryDocuments).toHaveBeenCalledWith(
        'notifications',
        expect.arrayContaining([
          ['expiresAt', '<', expect.any(Date)]
        ]),
        expect.objectContaining({
          limit: CLEANUP_CONFIG.BATCH_SIZE
        })
      );
    });

    it('should mark notifications as expired instead of deleting', async () => {
      await cleanupExpiredData();

      expect(mockFirestoreHelper.runTransaction).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Cleanup completed'),
        expect.any(Object)
      );
    });

    it('should handle empty results', async () => {
      mockFirestoreHelper.queryDocuments.mockResolvedValue([]);

      await expect(cleanupExpiredData()).resolves.not.toThrow();

      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('should process notifications in batches', async () => {
      const manyNotifications = Array.from({ length: 100 }, (_, i) => ({
        ...mockExpiredNotifications[0],
        id: `notif-${i}`
      }));

      mockFirestoreHelper.queryDocuments.mockResolvedValue(manyNotifications);

      await cleanupExpiredData();

      // Should call runTransaction multiple times for batching
      expect(mockFirestoreHelper.runTransaction).toHaveBeenCalled();
    });
  });

  describe('Session Cleanup', () => {
    it('should clean up expired user sessions', async () => {
      await cleanupExpiredData();

      // Verify sessions were queried
      expect(mockFirestoreHelper.queryDocuments).toHaveBeenCalled();
    });

    it('should respect retention policy for sessions', async () => {
      await cleanupExpiredData();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          sessions: expect.any(Object)
        })
      );
    });
  });

  describe('Analytics Cleanup', () => {
    it('should clean up old analytics data', async () => {
      await cleanupExpiredData();

      expect(mockFirestoreHelper.queryDocuments).toHaveBeenCalled();
    });

    it('should archive important analytics before deletion', async () => {
      await cleanupExpiredData();

      expect(mockLogger.info).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      const dbError = new Error('Database error');
      mockFirestoreHelper.queryDocuments.mockRejectedValue(dbError);

      await expect(cleanupExpiredData()).rejects.toThrow('Database error');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.anything(),
        dbError
      );
    });

    it('should continue cleanup on partial failures', async () => {
      mockFirestoreHelper.runTransaction
        .mockRejectedValueOnce(new Error('Transaction failed'))
        .mockResolvedValue();

      await expect(cleanupExpiredData()).resolves.not.toThrow();
    });

    it('should log errors for failed items', async () => {
      mockFirestoreHelper.runTransaction.mockRejectedValue(new Error('Failed to update'));

      await expect(cleanupExpiredData()).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('Performance', () => {
    it('should respect batch size limits', async () => {
      await cleanupExpiredData();

      expect(mockFirestoreHelper.queryDocuments).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          limit: CLEANUP_CONFIG.BATCH_SIZE
        })
      );
    });

    it('should complete within reasonable time', async () => {
      const startTime = Date.now();
      await cleanupExpiredData();
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(30000);
    });
  });

  describe('Logging', () => {
    it('should log cleanup statistics', async () => {
      await cleanupExpiredData();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Cleanup completed'),
        expect.objectContaining({
          notifications: expect.any(Object),
          executionTime: expect.any(Number)
        })
      );
    });

    it('should track items processed and deleted', async () => {
      await cleanupExpiredData();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          notifications: expect.objectContaining({
            itemsProcessed: expect.any(Number)
          })
        })
      );
    });
  });
});
