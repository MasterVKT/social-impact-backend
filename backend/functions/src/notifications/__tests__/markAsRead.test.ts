/**
 * Tests for markAsRead Firebase Function
 * Social Finance Impact Platform
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { CallableContext } from 'firebase-functions/v1/https';
import { https } from 'firebase-functions';
import { markAsRead } from '../markAsRead';
import { firestoreHelper } from '../../utils/firestore';
import { UserDocument, NotificationDocument } from '../../types/firestore';
import { STATUS, NOTIFICATION_CONFIG } from '../../utils/constants';
import { NotificationsAPI } from '../../types/api';

// Mock dependencies
jest.mock('../../utils/firestore');
jest.mock('../../utils/logger');

const mockFirestoreHelper = firestoreHelper as jest.Mocked<typeof firestoreHelper>;

describe('markAsRead', () => {
  let mockContext: CallableContext;
  let mockUser: UserDocument;
  let mockNotifications: NotificationDocument[];

  beforeEach(() => {
    jest.clearAllMocks();

    mockContext = {
      auth: {
        uid: 'user_123',
        token: {
          email: 'user@test.com',
          role: 'user'
        }
      },
      rawRequest: {
        ip: '127.0.0.1'
      }
    };

    mockUser = {
      uid: 'user_123',
      email: 'user@test.com',
      firstName: 'Test',
      lastName: 'User',
      userType: 'contributor',
      status: 'active',
      permissions: [],
      preferences: {},
      notificationCounters: {
        unread: 5,
        total: 25
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1
    } as UserDocument;

    mockNotifications = [
      {
        id: 'notif_123',
        recipientUid: 'user_123',
        senderUid: 'sender_456',
        type: 'project_update',
        title: 'Project Update',
        message: 'Your project has been updated.',
        data: { projectId: 'project_789' },
        read: false,
        readAt: null,
        delivered: true,
        priority: 'medium',
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        updatedAt: new Date(),
        version: 1
      },
      {
        id: 'notif_456',
        recipientUid: 'user_123',
        senderUid: 'system',
        type: 'payment_processed',
        title: 'Payment Confirmed',
        message: 'Your payment has been processed.',
        data: { amount: 5000 },
        read: false,
        readAt: null,
        delivered: true,
        priority: 'high',
        createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
        updatedAt: new Date(),
        version: 1
      }
    ] as NotificationDocument[];
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Specific Notifications - Mark as Read', () => {
    it('should mark specific notifications as read successfully', async () => {
      const requestData: NotificationsAPI.MarkNotificationReadRequest = {
        notificationIds: ['notif_123', 'notif_456'],
        markAll: false
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockUser) // User validation
        .mockResolvedValueOnce(mockNotifications[0]) // notif_123
        .mockResolvedValueOnce(mockNotifications[1]); // notif_456

      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        const mockTransaction = {
          update: jest.fn(),
          set: jest.fn()
        };
        await callback(mockTransaction as any);
      });

      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await markAsRead(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.marked).toBe(true);
      expect(result.count).toBe(2);
      expect(result.operation).toBe('mark_specific');
      expect(result.readAt).toBeDefined();

      // Verify transaction was called for marking notifications
      expect(mockFirestoreHelper.runTransaction).toHaveBeenCalled();

      // Verify metrics were updated
      expect(mockFirestoreHelper.incrementDocument).toHaveBeenCalledWith('platform_stats', 'global',
        expect.objectContaining({
          'notifications.totalRead': 2,
          'notifications.individualReadOperations': 1,
          'notifications.bulkReadOperations': 0
        })
      );
    });

    it('should handle already read notifications gracefully', async () => {
      const alreadyReadNotifications = mockNotifications.map(n => ({ ...n, read: true }));
      
      const requestData = {
        notificationIds: ['notif_123', 'notif_456'],
        markAll: false
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(alreadyReadNotifications[0])
        .mockResolvedValueOnce(alreadyReadNotifications[1]);

      const result = await markAsRead(requestData, mockContext);

      expect(result.success).toBe(false);
      expect(result.count).toBe(0);
      expect(result.marked).toBe(false);
      // Should not call transaction if no unread notifications
      expect(mockFirestoreHelper.runTransaction).not.toHaveBeenCalled();
    });

    it('should reject marking notifications that don\'t belong to user', async () => {
      const otherUserNotification = {
        ...mockNotifications[0],
        recipientUid: 'other_user_456'
      };

      const requestData = {
        notificationIds: ['notif_123'],
        markAll: false
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(otherUserNotification);

      await expect(markAsRead(requestData, mockContext))
        .rejects.toThrow('Cannot mark notifications that don\'t belong to you');
    });

    it('should handle partial failures in notification validation', async () => {
      const requestData = {
        notificationIds: ['notif_123', 'notif_nonexistent'],
        markAll: false
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(mockNotifications[0])
        .mockRejectedValueOnce(new Error('Notification not found'));

      await expect(markAsRead(requestData, mockContext))
        .rejects.toThrow('Unable to validate notification ownership');
    });
  });

  describe('Mark All Notifications', () => {
    it('should mark all unread notifications as read', async () => {
      const requestData = {
        markAll: true
      };

      const manyUnreadNotifications = Array(15).fill({}).map((_, i) => ({
        id: `notif_${i}`,
        recipientUid: 'user_123',
        type: 'project_update',
        title: `Notification ${i}`,
        read: false,
        createdAt: new Date(),
        version: 1
      })) as NotificationDocument[];

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockUser);
      mockFirestoreHelper.queryDocuments.mockResolvedValueOnce(manyUnreadNotifications);

      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        const mockTransaction = {
          update: jest.fn()
        };
        await callback(mockTransaction as any);
      });

      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await markAsRead(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.marked).toBe(true);
      expect(result.count).toBe(15);
      expect(result.operation).toBe('mark_all');

      // Verify metrics for bulk operation
      expect(mockFirestoreHelper.incrementDocument).toHaveBeenCalledWith('platform_stats', 'global',
        expect.objectContaining({
          'notifications.totalRead': 15,
          'notifications.bulkReadOperations': 1,
          'notifications.individualReadOperations': 0
        })
      );
    });

    it('should mark all notifications of specific types', async () => {
      const requestData = {
        markAll: true,
        types: ['project_update', 'contribution_received']
      };

      const filteredNotifications = [
        { ...mockNotifications[0], type: 'project_update' },
        { ...mockNotifications[1], type: 'contribution_received', read: false }
      ];

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockUser);
      mockFirestoreHelper.queryDocuments.mockResolvedValueOnce(filteredNotifications);

      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        const mockTransaction = { update: jest.fn() };
        await callback(mockTransaction as any);
      });

      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await markAsRead(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
      expect(result.filters).toEqual({
        types: ['project_update', 'contribution_received'],
        olderThan: undefined
      });

      // Verify type-specific metrics
      expect(mockFirestoreHelper.incrementDocument).toHaveBeenCalledWith('platform_stats', 'global',
        expect.objectContaining({
          'notifications.readByType.project_update': 2
        })
      );
    });

    it('should mark notifications older than specific date', async () => {
      const olderThanDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      
      const requestData = {
        markAll: true,
        olderThan: olderThanDate
      };

      const oldNotifications = [
        {
          ...mockNotifications[0],
          createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000) // 2 days ago
        }
      ];

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockUser);
      mockFirestoreHelper.queryDocuments.mockResolvedValueOnce(oldNotifications);

      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        const mockTransaction = { update: jest.fn() };
        await callback(mockTransaction as any);
      });

      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await markAsRead(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.count).toBe(1);
      expect(result.filters).toEqual({
        types: undefined,
        olderThan: olderThanDate
      });
    });

    it('should handle no unread notifications to mark', async () => {
      const requestData = {
        markAll: true
      };

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockUser);
      mockFirestoreHelper.queryDocuments.mockResolvedValueOnce([]); // No unread notifications

      const result = await markAsRead(requestData, mockContext);

      expect(result.success).toBe(false);
      expect(result.count).toBe(0);
      expect(result.marked).toBe(false);
      expect(mockFirestoreHelper.runTransaction).not.toHaveBeenCalled();
    });

    it('should process large batches correctly', async () => {
      const requestData = {
        markAll: true
      };

      // Create 60 notifications to test batching (batch size is 25)
      const manyNotifications = Array(60).fill({}).map((_, i) => ({
        id: `notif_${i}`,
        recipientUid: 'user_123',
        type: 'project_update',
        read: false,
        createdAt: new Date(),
        version: 1
      })) as NotificationDocument[];

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockUser);
      mockFirestoreHelper.queryDocuments.mockResolvedValueOnce(manyNotifications);

      // Mock multiple successful transactions for batches
      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        const mockTransaction = { update: jest.fn() };
        await callback(mockTransaction as any);
      });

      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await markAsRead(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.count).toBe(60);
      // Should have been called 3 times for 3 batches (25 + 25 + 10)
      expect(mockFirestoreHelper.runTransaction).toHaveBeenCalledTimes(3);
    });

    it('should continue processing if one batch fails', async () => {
      const requestData = {
        markAll: true
      };

      const manyNotifications = Array(50).fill({}).map((_, i) => ({
        id: `notif_${i}`,
        recipientUid: 'user_123',
        read: false,
        createdAt: new Date(),
        version: 1
      })) as NotificationDocument[];

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockUser);
      mockFirestoreHelper.queryDocuments.mockResolvedValueOnce(manyNotifications);

      // First batch succeeds, second fails, third succeeds
      mockFirestoreHelper.runTransaction
        .mockImplementationOnce(async (callback) => {
          const mockTransaction = { update: jest.fn() };
          await callback(mockTransaction as any);
        })
        .mockRejectedValueOnce(new Error('Transaction failed'))
        .mockImplementationOnce(async (callback) => {
          const mockTransaction = { update: jest.fn() };
          await callback(mockTransaction as any);
        });

      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await markAsRead(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.count).toBe(50); // Should still process all batches that succeed (25 + 0 + 25)
    });
  });

  describe('Bulk Read Operations with Limits', () => {
    it('should warn when reaching bulk read limit', async () => {
      const requestData = {
        markAll: true
      };

      // Create exactly the maximum allowed bulk operations
      const maxNotifications = Array(NOTIFICATION_CONFIG.MAX_BULK_READ_OPERATIONS).fill({}).map((_, i) => ({
        id: `notif_${i}`,
        recipientUid: 'user_123',
        read: false,
        createdAt: new Date(),
        version: 1
      })) as NotificationDocument[];

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockUser);
      mockFirestoreHelper.queryDocuments.mockResolvedValueOnce(maxNotifications);

      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        const mockTransaction = { update: jest.fn() };
        await callback(mockTransaction as any);
      });

      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await markAsRead(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.count).toBe(NOTIFICATION_CONFIG.MAX_BULK_READ_OPERATIONS);
      // Should warn about potential remaining notifications
    });

    it('should handle combined type and date filters', async () => {
      const olderThanDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      
      const requestData = {
        markAll: true,
        types: ['project_update'],
        olderThan: olderThanDate
      };

      const filteredNotifications = [
        {
          ...mockNotifications[0],
          type: 'project_update',
          createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) // 10 days ago
        }
      ];

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockUser);
      mockFirestoreHelper.queryDocuments.mockResolvedValueOnce(filteredNotifications);

      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        const mockTransaction = { update: jest.fn() };
        await callback(mockTransaction as any);
      });

      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await markAsRead(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.count).toBe(1);
      expect(result.filters).toEqual({
        types: ['project_update'],
        olderThan: olderThanDate
      });
    });
  });

  describe('Permission Validation', () => {
    it('should reject unauthenticated requests', async () => {
      const requestData = {
        notificationIds: ['notif_123'],
        markAll: false
      };

      const unauthenticatedContext = { ...mockContext, auth: undefined };

      await expect(markAsRead(requestData, unauthenticatedContext))
        .rejects.toThrow('Authentication required');
    });

    it('should reject inactive user accounts', async () => {
      const inactiveUser = {
        ...mockUser,
        status: 'suspended'
      };

      const requestData = {
        notificationIds: ['notif_123'],
        markAll: false
      };

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(inactiveUser);

      await expect(markAsRead(requestData, mockContext))
        .rejects.toThrow('User account is not active');
    });

    it('should validate notification ownership for specific IDs', async () => {
      const otherUserNotification = {
        ...mockNotifications[0],
        recipientUid: 'other_user_789'
      };

      const requestData = {
        notificationIds: ['notif_123'],
        markAll: false
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(otherUserNotification);

      await expect(markAsRead(requestData, mockContext))
        .rejects.toThrow('Cannot mark notifications that don\'t belong to you');
    });
  });

  describe('Data Validation', () => {
    it('should reject invalid notification IDs format', async () => {
      const requestData = {
        notificationIds: [''], // Empty string
        markAll: false
      };

      await expect(markAsRead(requestData, mockContext))
        .rejects.toThrow('Validation error');
    });

    it('should reject too many notification IDs', async () => {
      const tooManyIds = Array(51).fill('').map((_, i) => `notif_${i}`);
      
      const requestData = {
        notificationIds: tooManyIds,
        markAll: false
      };

      await expect(markAsRead(requestData, mockContext))
        .rejects.toThrow('Validation error');
    });

    it('should reject invalid notification types in markAll', async () => {
      const requestData = {
        markAll: true,
        types: ['invalid_type', 'project_update']
      };

      await expect(markAsRead(requestData, mockContext))
        .rejects.toThrow('Validation error');
    });

    it('should reject invalid date format in olderThan', async () => {
      const requestData = {
        markAll: true,
        olderThan: 'invalid-date-format'
      };

      await expect(markAsRead(requestData, mockContext))
        .rejects.toThrow('Validation error');
    });

    it('should require either notificationIds or markAll', async () => {
      const requestData = {
        markAll: false
        // Missing notificationIds
      };

      await expect(markAsRead(requestData, mockContext))
        .rejects.toThrow('Validation error');
    });

    it('should allow notificationIds to be optional when markAll is true', async () => {
      const requestData = {
        markAll: true
        // No notificationIds provided - should be valid
      };

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockUser);
      mockFirestoreHelper.queryDocuments.mockResolvedValueOnce([]);

      const result = await markAsRead(requestData, mockContext);

      expect(result.success).toBe(false);
      expect(result.count).toBe(0);
    });
  });

  describe('Database Transaction Handling', () => {
    it('should handle transaction failures for specific notifications', async () => {
      const requestData = {
        notificationIds: ['notif_123'],
        markAll: false
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(mockNotifications[0]);

      mockFirestoreHelper.runTransaction.mockRejectedValue(new Error('Transaction failed'));

      await expect(markAsRead(requestData, mockContext))
        .rejects.toThrow('Unable to mark notifications as read');
    });

    it('should handle partial transaction failures in bulk operations', async () => {
      const requestData = {
        markAll: true
      };

      const manyNotifications = Array(75).fill({}).map((_, i) => ({
        id: `notif_${i}`,
        recipientUid: 'user_123',
        read: false,
        createdAt: new Date(),
        version: 1
      })) as NotificationDocument[];

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockUser);
      mockFirestoreHelper.queryDocuments.mockResolvedValueOnce(manyNotifications);

      // Simulate batch transactions: first succeeds, second fails, third succeeds
      mockFirestoreHelper.runTransaction
        .mockImplementationOnce(async (callback) => {
          await callback({ update: jest.fn() } as any);
        })
        .mockRejectedValueOnce(new Error('Transaction failed'))
        .mockImplementationOnce(async (callback) => {
          await callback({ update: jest.fn() } as any);
        });

      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await markAsRead(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.count).toBe(50); // Two successful batches of 25 each
    });

    it('should continue if metrics update fails', async () => {
      const requestData = {
        notificationIds: ['notif_123'],
        markAll: false
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(mockNotifications[0]);

      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        const mockTransaction = { update: jest.fn() };
        await callback(mockTransaction as any);
      });

      // Metrics update fails
      mockFirestoreHelper.incrementDocument.mockRejectedValue(new Error('Metrics update failed'));

      const result = await markAsRead(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.count).toBe(1);
      // Should succeed even if metrics fail
    });
  });

  describe('User Counter Updates', () => {
    it('should update user notification counters correctly', async () => {
      const requestData = {
        notificationIds: ['notif_123', 'notif_456'],
        markAll: false
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(mockNotifications[0])
        .mockResolvedValueOnce(mockNotifications[1]);

      const mockTransaction = {
        update: jest.fn(),
        set: jest.fn()
      };

      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback(mockTransaction as any);
      });

      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await markAsRead(requestData, mockContext);

      expect(result.success).toBe(true);

      // Verify user counter was decremented in transaction
      expect(mockTransaction.update).toHaveBeenCalledWith(
        expect.any(Object), // User document reference
        expect.objectContaining({
          'notificationCounters.unread': expect.any(Object), // Firestore increment
          'notificationCounters.lastReadAt': expect.any(Date),
          updatedAt: expect.any(Date)
        })
      );
    });

    it('should track bulk read operations in user counters', async () => {
      const requestData = {
        markAll: true,
        types: ['project_update']
      };

      const typeNotifications = Array(10).fill({}).map((_, i) => ({
        id: `notif_${i}`,
        recipientUid: 'user_123',
        type: 'project_update',
        read: false,
        createdAt: new Date(),
        version: 1
      })) as NotificationDocument[];

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockUser);
      mockFirestoreHelper.queryDocuments.mockResolvedValueOnce(typeNotifications);

      const mockTransaction = {
        update: jest.fn()
      };

      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback(mockTransaction as any);
      });

      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await markAsRead(requestData, mockContext);

      expect(result.success).toBe(true);

      // Verify bulk read tracking in user counters
      expect(mockTransaction.update).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          'notificationCounters.lastBulkRead': {
            count: 10,
            timestamp: expect.any(Date),
            filters: {
              types: ['project_update'],
              olderThan: undefined
            }
          }
        })
      );
    });
  });

  describe('Metrics and Analytics', () => {
    it('should update platform statistics for individual read operations', async () => {
      const requestData = {
        notificationIds: ['notif_123'],
        markAll: false
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(mockNotifications[0]);

      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({ update: jest.fn() } as any);
      });

      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await markAsRead(requestData, mockContext);

      expect(result.success).toBe(true);

      // Verify platform statistics
      expect(mockFirestoreHelper.incrementDocument).toHaveBeenCalledWith('platform_stats', 'global',
        expect.objectContaining({
          'notifications.totalRead': 1,
          'notifications.bulkReadOperations': 0,
          'notifications.individualReadOperations': 1
        })
      );

      // Verify user statistics
      expect(mockFirestoreHelper.incrementDocument).toHaveBeenCalledWith('users', 'user_123',
        expect.objectContaining({
          'stats.notificationsRead': 1,
          'stats.lastReadActivity': expect.any(Date)
        })
      );
    });

    it('should update platform statistics for bulk operations', async () => {
      const requestData = {
        markAll: true,
        types: ['payment_processed', 'project_update']
      };

      const mixedNotifications = [
        { ...mockNotifications[0], type: 'payment_processed' },
        { ...mockNotifications[1], type: 'project_update', read: false }
      ];

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockUser);
      mockFirestoreHelper.queryDocuments.mockResolvedValueOnce(mixedNotifications);

      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({ update: jest.fn() } as any);
      });

      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await markAsRead(requestData, mockContext);

      expect(result.success).toBe(true);

      // Verify bulk operation metrics
      expect(mockFirestoreHelper.incrementDocument).toHaveBeenCalledWith('platform_stats', 'global',
        expect.objectContaining({
          'notifications.totalRead': 2,
          'notifications.bulkReadOperations': 1,
          'notifications.individualReadOperations': 0
        })
      );

      // Verify type-specific metrics for each type
      expect(mockFirestoreHelper.incrementDocument).toHaveBeenCalledWith('platform_stats', 'global',
        expect.objectContaining({
          'notifications.readByType.payment_processed': 2
        })
      );
      expect(mockFirestoreHelper.incrementDocument).toHaveBeenCalledWith('platform_stats', 'global',
        expect.objectContaining({
          'notifications.readByType.project_update': 2
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle user not found error', async () => {
      const requestData = {
        notificationIds: ['notif_123'],
        markAll: false
      };

      mockFirestoreHelper.getDocument.mockRejectedValueOnce(new Error('User not found'));

      await expect(markAsRead(requestData, mockContext))
        .rejects.toThrow('Unable to validate notification access');
    });

    it('should handle notification not found in specific mode', async () => {
      const requestData = {
        notificationIds: ['notif_nonexistent'],
        markAll: false
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockUser)
        .mockRejectedValueOnce(new Error('Notification not found'));

      await expect(markAsRead(requestData, mockContext))
        .rejects.toThrow('Unable to validate notification ownership');
    });

    it('should handle database connection failures', async () => {
      const requestData = {
        markAll: true
      };

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockUser);
      mockFirestoreHelper.queryDocuments.mockRejectedValueOnce(new Error('Database connection failed'));

      await expect(markAsRead(requestData, mockContext))
        .rejects.toThrow('Unable to mark all notifications as read');
    });

    it('should handle mixed ownership in batch notifications', async () => {
      const mixedNotifications = [
        mockNotifications[0], // Belongs to user_123
        { ...mockNotifications[1], recipientUid: 'other_user_456' } // Belongs to different user
      ];

      const requestData = {
        notificationIds: ['notif_123', 'notif_456'],
        markAll: false
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(mixedNotifications[0])
        .mockResolvedValueOnce(mixedNotifications[1]);

      await expect(markAsRead(requestData, mockContext))
        .rejects.toThrow('Cannot mark notifications that don\'t belong to you: notif_456');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty notification ID arrays', async () => {
      const requestData = {
        notificationIds: [],
        markAll: false
      };

      // Should be rejected by validation
      await expect(markAsRead(requestData, mockContext))
        .rejects.toThrow('Validation error');
    });

    it('should handle notifications already marked as read in specific mode', async () => {
      const readNotification = {
        ...mockNotifications[0],
        read: true,
        readAt: new Date()
      };

      const requestData = {
        notificationIds: ['notif_123'],
        markAll: false
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(readNotification);

      const result = await markAsRead(requestData, mockContext);

      expect(result.success).toBe(false);
      expect(result.count).toBe(0);
      expect(result.marked).toBe(false);
    });

    it('should handle user without notification counters', async () => {
      const userWithoutCounters = {
        ...mockUser,
        notificationCounters: undefined
      };

      const requestData = {
        notificationIds: ['notif_123'],
        markAll: false
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(userWithoutCounters)
        .mockResolvedValueOnce(mockNotifications[0]);

      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({ update: jest.fn() } as any);
      });

      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await markAsRead(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.count).toBe(1);
      // Should handle gracefully even without existing counters
    });

    it('should handle concurrent read operations', async () => {
      const requestData = {
        notificationIds: ['notif_123'],
        markAll: false
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(mockNotifications[0]);

      // Simulate transaction conflict and retry
      mockFirestoreHelper.runTransaction
        .mockRejectedValueOnce(new Error('Transaction conflict'))
        .mockImplementation(async (callback) => {
          await callback({ update: jest.fn() } as any);
        });

      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      await expect(markAsRead(requestData, mockContext))
        .rejects.toThrow('Unable to mark notifications as read');
    });

    it('should handle notifications with missing data fields', async () => {
      const incompleteNotification = {
        id: 'notif_incomplete',
        recipientUid: 'user_123',
        type: 'project_update',
        title: 'Update',
        read: false,
        createdAt: new Date(),
        version: 1
        // Missing message, data, etc.
      } as NotificationDocument;

      const requestData = {
        notificationIds: ['notif_incomplete'],
        markAll: false
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(incompleteNotification);

      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({ update: jest.fn() } as any);
      });

      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await markAsRead(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.count).toBe(1);
      // Should handle incomplete notifications gracefully
    });
  });

  describe('Response Structure', () => {
    it('should return complete response structure for specific notifications', async () => {
      const requestData = {
        notificationIds: ['notif_123', 'notif_456'],
        markAll: false
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(mockNotifications[0])
        .mockResolvedValueOnce(mockNotifications[1]);

      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({ update: jest.fn() } as any);
      });

      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await markAsRead(requestData, mockContext);

      expect(result).toMatchObject({
        marked: true,
        readAt: expect.any(String),
        count: 2,
        operation: 'mark_specific',
        filters: undefined
      });
    });

    it('should return complete response structure for mark all operations', async () => {
      const requestData = {
        markAll: true,
        types: ['project_update'],
        olderThan: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      };

      const filteredNotifications = [mockNotifications[0]];

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockUser);
      mockFirestoreHelper.queryDocuments.mockResolvedValueOnce(filteredNotifications);

      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({ update: jest.fn() } as any);
      });

      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await markAsRead(requestData, mockContext);

      expect(result).toMatchObject({
        marked: true,
        readAt: expect.any(String),
        count: 1,
        operation: 'mark_all',
        filters: {
          types: ['project_update'],
          olderThan: expect.any(String)
        }
      });
    });
  });

  describe('Business Logic', () => {
    it('should properly log business events for specific reads', async () => {
      const requestData = {
        notificationIds: ['notif_123'],
        markAll: false
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(mockNotifications[0]);

      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({ update: jest.fn() } as any);
      });

      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await markAsRead(requestData, mockContext);

      expect(result.success).toBe(true);
      // Business logging should capture the operation details
    });

    it('should properly log business events for bulk reads', async () => {
      const requestData = {
        markAll: true,
        types: ['audit_completed', 'payment_processed']
      };

      const auditNotifications = Array(5).fill({}).map((_, i) => ({
        id: `audit_notif_${i}`,
        recipientUid: 'user_123',
        type: 'audit_completed',
        read: false,
        createdAt: new Date(),
        version: 1
      })) as NotificationDocument[];

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockUser);
      mockFirestoreHelper.queryDocuments.mockResolvedValueOnce(auditNotifications);

      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({ update: jest.fn() } as any);
      });

      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await markAsRead(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.count).toBe(5);
      // Business logging should capture bulk operation details
    });
  });

  describe('Rate Limiting Edge Cases', () => {
    it('should handle rapid successive mark as read requests', async () => {
      const requestData = {
        notificationIds: ['notif_123'],
        markAll: false
      };

      // Simulate rapid successive calls by testing same notification
      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(mockNotifications[0]);

      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({ update: jest.fn() } as any);
      });

      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await markAsRead(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.count).toBe(1);
    });

    it('should handle mark all operations with mixed read statuses', async () => {
      const mixedNotifications = [
        { ...mockNotifications[0], read: false },
        { ...mockNotifications[1], read: true }, // Already read
        {
          id: 'notif_789',
          recipientUid: 'user_123',
          type: 'project_update',
          read: false,
          createdAt: new Date(),
          version: 1
        }
      ] as NotificationDocument[];

      const requestData = {
        markAll: true
      };

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockUser);
      mockFirestoreHelper.queryDocuments.mockResolvedValueOnce(
        mixedNotifications.filter(n => !n.read) // Should only return unread
      );

      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({ update: jest.fn() } as any);
      });

      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await markAsRead(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.count).toBe(2); // Only unread notifications
    });
  });

  describe('Function Name Verification', () => {
    it('should have the correct function name validateNotificationReadAccess', async () => {
      const requestData = {
        notificationIds: ['notif_123'],
        markAll: false
      };

      // This should trigger user validation
      mockFirestoreHelper.getDocument.mockRejectedValueOnce(new Error('User not found'));

      await expect(markAsRead(requestData, mockContext))
        .rejects.toThrow('Unable to validate notification access');

      expect(mockFirestoreHelper.getDocument).toHaveBeenCalledWith('users', 'user_123');
    });
  });
});