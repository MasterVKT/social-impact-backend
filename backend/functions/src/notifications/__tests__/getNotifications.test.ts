/**
 * Tests for getNotifications Firebase Function
 * Social Finance Impact Platform
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { CallableContext } from 'firebase-functions/v1/https';
import { https } from 'firebase-functions';
import { getNotifications } from '../getNotifications';
import { firestoreHelper } from '../../utils/firestore';
import { UserDocument, NotificationDocument } from '../../types/firestore';
import { STATUS, NOTIFICATION_CONFIG } from '../../utils/constants';
import { NotificationsAPI } from '../../types/api';

// Mock dependencies
jest.mock('../../utils/firestore');
jest.mock('../../utils/logger');

const mockFirestoreHelper = firestoreHelper as jest.Mocked<typeof firestoreHelper>;

describe('getNotifications', () => {
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
      preferences: {
        notifications: {
          email: true,
          inApp: true,
          push: false
        }
      },
      notificationCounters: {
        unread: 8,
        total: 25,
        lastAccess: new Date(Date.now() - 2 * 60 * 60 * 1000)
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1
    } as UserDocument;

    mockNotifications = [
      {
        id: 'notif_123',
        recipientUid: 'user_123',
        senderUid: 'creator_456',
        type: 'project_update',
        title: 'Project Milestone Completed',
        message: 'Great news! The first milestone of your supported project has been completed.',
        data: {
          projectId: 'project_789',
          milestoneId: 'milestone_001',
          amount: 5000
        },
        priority: 'medium',
        actionUrl: 'https://platform.com/projects/project_789',
        read: false,
        readAt: null,
        delivered: true,
        deliveredAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        version: 1
      },
      {
        id: 'notif_456',
        recipientUid: 'user_123',
        senderUid: 'system',
        type: 'payment_processed',
        title: 'Payment Confirmation',
        message: 'Your contribution of €50.00 has been processed successfully.',
        data: {
          amount: 5000,
          transactionId: 'txn_123',
          contributionId: 'contrib_456'
        },
        priority: 'high',
        read: true,
        readAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
        delivered: true,
        deliveredAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
        expiresAt: null,
        version: 1
      },
      {
        id: 'notif_789',
        recipientUid: 'user_123',
        senderUid: 'auditor_789',
        type: 'audit_completed',
        title: 'Audit Report Available',
        message: 'The audit for your project has been completed. Review the findings.',
        data: {
          auditId: 'audit_999',
          projectId: 'project_789',
          score: 85,
          decision: 'approved'
        },
        priority: 'high',
        actionUrl: 'https://platform.com/audits/audit_999/report',
        read: false,
        readAt: null,
        delivered: true,
        deliveredAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
        createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        version: 1
      }
    ] as NotificationDocument[];
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Successful Notification Retrieval', () => {
    it('should return paginated notifications with enriched data', async () => {
      const requestData = {
        limit: 20,
        offset: 0,
        unreadOnly: false
      };

      // Setup mocks
      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockUser) // User validation
        .mockResolvedValueOnce({ // Project enrichment for project_update
          title: 'Environmental Restoration Project',
          slug: 'environmental-restoration'
        })
        .mockResolvedValueOnce({ // Audit enrichment for audit_completed
          projectTitle: 'Environmental Restoration Project',
          auditorName: 'Expert Auditor'
        });

      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // Expired notifications cleanup
        .mockResolvedValueOnce(mockNotifications) // Main notifications query
        .mockResolvedValueOnce(mockNotifications.filter(n => !n.read)); // Unread count query

      mockFirestoreHelper.updateDocument.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await getNotifications(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        unreadCount: 2,
        notifications: expect.arrayContaining([
          expect.objectContaining({
            id: 'notif_123',
            type: 'project_update',
            title: 'Project Milestone Completed',
            read: false,
            data: expect.objectContaining({
              projectTitle: 'Environmental Restoration Project',
              projectSlug: 'environmental-restoration'
            })
          }),
          expect.objectContaining({
            id: 'notif_456',
            type: 'payment_processed',
            title: 'Payment Confirmation',
            read: true,
            data: expect.objectContaining({
              formattedAmount: '€50.00'
            })
          }),
          expect.objectContaining({
            id: 'notif_789',
            type: 'audit_completed',
            title: 'Audit Report Available',
            read: false,
            data: expect.objectContaining({
              projectTitle: 'Environmental Restoration Project',
              auditorName: 'Expert Auditor'
            })
          })
        ]),
        hasMore: false,
        totalCount: expect.any(Number)
      });

      // Verify engagement metrics update
      expect(mockFirestoreHelper.updateDocument).toHaveBeenCalledWith('users', 'user_123',
        expect.objectContaining({
          'notificationCounters.lastAccess': expect.any(Date),
          'notificationCounters.totalAccesses': expect.any(Object)
        })
      );
    });

    it('should filter notifications by unread status', async () => {
      const requestData = {
        unreadOnly: true,
        limit: 10
      };

      const unreadNotifications = mockNotifications.filter(n => !n.read);

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockUser);
      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // Cleanup
        .mockResolvedValueOnce(unreadNotifications) // Unread only
        .mockResolvedValueOnce(unreadNotifications); // Unread count

      mockFirestoreHelper.updateDocument.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await getNotifications(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.notifications).toHaveLength(2);
      expect(result.data.notifications.every(n => !n.read)).toBe(true);
    });

    it('should filter notifications by type', async () => {
      const requestData = {
        types: ['project_update', 'audit_completed'],
        limit: 10
      };

      const filteredNotifications = mockNotifications.filter(n => 
        ['project_update', 'audit_completed'].includes(n.type)
      );

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce({ title: 'Test Project', slug: 'test' })
        .mockResolvedValueOnce({ projectTitle: 'Test Project', auditorName: 'Auditor' });

      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // Cleanup
        .mockResolvedValueOnce(filteredNotifications) // Filtered notifications
        .mockResolvedValueOnce(filteredNotifications.filter(n => !n.read)); // Unread count

      mockFirestoreHelper.updateDocument.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await getNotifications(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.notifications).toHaveLength(2);
      expect(result.data.notifications.every(n => 
        ['project_update', 'audit_completed'].includes(n.type)
      )).toBe(true);
    });

    it('should filter notifications by priority', async () => {
      const requestData = {
        priority: 'high',
        limit: 10
      };

      const highPriorityNotifications = mockNotifications.filter(n => n.priority === 'high');

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce({ projectTitle: 'Test Project', auditorName: 'Auditor' });

      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // Cleanup
        .mockResolvedValueOnce(highPriorityNotifications) // High priority only
        .mockResolvedValueOnce(highPriorityNotifications.filter(n => !n.read)); // Unread count

      mockFirestoreHelper.updateDocument.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await getNotifications(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.notifications).toHaveLength(2);
      expect(result.data.notifications.every(n => n.priority === 'high')).toBe(true);
    });

    it('should filter notifications by date range', async () => {
      const startDate = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
      const endDate = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();

      const requestData = {
        startDate,
        endDate,
        limit: 10
      };

      const dateFilteredNotifications = [mockNotifications[1]]; // Only payment notification in range

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockUser);
      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // Cleanup
        .mockResolvedValueOnce(dateFilteredNotifications) // Date filtered
        .mockResolvedValueOnce([]); // Unread count

      mockFirestoreHelper.updateDocument.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await getNotifications(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.notifications).toHaveLength(1);
      expect(result.data.filters.dateRange).toEqual({
        start: startDate,
        end: endDate
      });
    });
  });

  describe('Data Enrichment', () => {
    it('should enrich project-related notifications', async () => {
      const projectNotification = {
        ...mockNotifications[0],
        type: 'contribution_received',
        data: {
          projectId: 'project_789',
          amount: 5000
        }
      };

      const requestData = { limit: 1 };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce({ // Project enrichment
          title: 'Amazing Environmental Project',
          slug: 'amazing-environmental-project'
        });

      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // Cleanup
        .mockResolvedValueOnce([projectNotification]) // Notifications
        .mockResolvedValueOnce([]); // Unread count

      mockFirestoreHelper.updateDocument.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await getNotifications(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.notifications[0].data).toMatchObject({
        projectId: 'project_789',
        projectTitle: 'Amazing Environmental Project',
        projectSlug: 'amazing-environmental-project',
        amount: 5000
      });
    });

    it('should enrich payment notifications with formatted amounts', async () => {
      const paymentNotification = {
        ...mockNotifications[1],
        data: {
          amount: 7500, // €75.00
          transactionId: 'txn_789'
        }
      };

      const requestData = { limit: 1 };

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockUser);
      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // Cleanup
        .mockResolvedValueOnce([paymentNotification]) // Payment notification
        .mockResolvedValueOnce([]); // Unread count

      mockFirestoreHelper.updateDocument.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await getNotifications(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.notifications[0].data.formattedAmount).toBe('€75.00');
    });

    it('should enrich message notifications with sender info', async () => {
      const messageNotification = {
        ...mockNotifications[0],
        type: 'message_received',
        senderUid: 'sender_789',
        data: {
          messageId: 'msg_123',
          conversationId: 'conv_456'
        }
      };

      const requestData = { limit: 1 };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce({ // Sender enrichment
          firstName: 'Message',
          lastName: 'Sender',
          profilePicture: 'https://example.com/avatar.jpg'
        });

      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // Cleanup
        .mockResolvedValueOnce([messageNotification]) // Message notification
        .mockResolvedValueOnce([]); // Unread count

      mockFirestoreHelper.updateDocument.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await getNotifications(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.notifications[0].data).toMatchObject({
        senderName: 'Message Sender',
        senderProfilePicture: 'https://example.com/avatar.jpg'
      });
    });

    it('should handle enrichment failures gracefully', async () => {
      const projectNotification = {
        ...mockNotifications[0],
        data: {
          projectId: 'nonexistent_project'
        }
      };

      const requestData = { limit: 1 };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockUser)
        .mockRejectedValueOnce(new Error('Project not found')); // Enrichment fails

      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // Cleanup
        .mockResolvedValueOnce([projectNotification]) // Notification
        .mockResolvedValueOnce([]); // Unread count

      mockFirestoreHelper.updateDocument.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await getNotifications(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.notifications).toHaveLength(1);
      // Should return basic notification even if enrichment fails
      expect(result.data.notifications[0].data.projectId).toBe('nonexistent_project');
    });
  });

  describe('Expired Notification Cleanup', () => {
    it('should clean up expired notifications automatically', async () => {
      const expiredNotifications = [
        {
          id: 'expired_1',
          recipientUid: 'user_123',
          expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // Yesterday
          read: false
        },
        {
          id: 'expired_2',
          recipientUid: 'user_123',
          expiresAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
          read: false
        }
      ];

      const requestData = { limit: 20 };

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockUser);
      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce(expiredNotifications) // Expired notifications for cleanup
        .mockResolvedValueOnce(mockNotifications) // Main query
        .mockResolvedValueOnce(mockNotifications.filter(n => !n.read)); // Unread count

      mockFirestoreHelper.updateDocument.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await getNotifications(requestData, mockContext);

      expect(result.success).toBe(true);
      
      // Verify expired notifications were marked as expired
      expect(mockFirestoreHelper.updateDocument).toHaveBeenCalledWith('notifications', 'expired_1',
        expect.objectContaining({
          expired: true,
          expiredAt: expect.any(Date),
          read: true
        })
      );
      expect(mockFirestoreHelper.updateDocument).toHaveBeenCalledWith('notifications', 'expired_2',
        expect.objectContaining({
          expired: true,
          expiredAt: expect.any(Date),
          read: true
        })
      );

      // Verify user counter was updated
      expect(mockFirestoreHelper.updateDocument).toHaveBeenCalledWith('users', 'user_123',
        expect.objectContaining({
          'notificationCounters.unread': expect.any(Object),
          'notificationCounters.expired': expect.any(Object)
        })
      );
    });
  });

  describe('Permission Validation', () => {
    it('should reject unauthenticated requests', async () => {
      const requestData = { limit: 20 };
      const unauthenticatedContext = { ...mockContext, auth: undefined };

      await expect(getNotifications(requestData, unauthenticatedContext))
        .rejects.toThrow('Authentication required');
    });

    it('should reject inactive user accounts', async () => {
      const inactiveUser = {
        ...mockUser,
        status: 'suspended'
      };

      const requestData = { limit: 20 };

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(inactiveUser);

      await expect(getNotifications(requestData, mockContext))
        .rejects.toThrow('User account is not active');
    });
  });

  describe('Data Validation', () => {
    it('should use default values when no parameters provided', async () => {
      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockUser);
      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // Cleanup
        .mockResolvedValueOnce(mockNotifications.slice(0, 20)) // Should use default limit 20
        .mockResolvedValueOnce(mockNotifications.filter(n => !n.read));

      mockFirestoreHelper.updateDocument.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await getNotifications({}, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.pagination.limit).toBe(20);
      expect(result.data.pagination.offset).toBe(0);
    });

    it('should enforce maximum limit', async () => {
      const requestData = {
        limit: 150 // Above max of 100
      };

      await expect(getNotifications(requestData, mockContext))
        .rejects.toThrow('Validation error');
    });

    it('should reject invalid notification types in filter', async () => {
      const requestData = {
        types: ['invalid_type', 'project_update']
      };

      await expect(getNotifications(requestData, mockContext))
        .rejects.toThrow('Validation error');
    });

    it('should reject invalid date formats', async () => {
      const requestData = {
        startDate: 'invalid-date-format'
      };

      await expect(getNotifications(requestData, mockContext))
        .rejects.toThrow('Validation error');
    });
  });

  describe('Pagination', () => {
    it('should handle pagination correctly', async () => {
      const requestData = {
        limit: 2,
        offset: 1
      };

      const paginatedNotifications = mockNotifications.slice(1, 3); // Skip first, take 2

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockUser);
      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // Cleanup
        .mockResolvedValueOnce(paginatedNotifications) // Paginated results
        .mockResolvedValueOnce(mockNotifications.filter(n => !n.read)); // Unread count

      mockFirestoreHelper.updateDocument.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await getNotifications(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.notifications).toHaveLength(2);
      expect(result.data.pagination).toMatchObject({
        limit: 2,
        offset: 1,
        nextOffset: 3
      });
      expect(result.data.hasMore).toBe(true); // Since we got exactly the limit
    });

    it('should indicate no more results when fewer than limit returned', async () => {
      const requestData = {
        limit: 10,
        offset: 0
      };

      const fewNotifications = mockNotifications.slice(0, 2); // Only 2 notifications

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockUser);
      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // Cleanup
        .mockResolvedValueOnce(fewNotifications) // Fewer than limit
        .mockResolvedValueOnce(fewNotifications.filter(n => !n.read)); // Unread count

      mockFirestoreHelper.updateDocument.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await getNotifications(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.hasMore).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle database query failures', async () => {
      const requestData = { limit: 20 };

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockUser);
      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // Cleanup succeeds
        .mockRejectedValueOnce(new Error('Database connection failed')); // Main query fails

      await expect(getNotifications(requestData, mockContext))
        .rejects.toThrow('Database connection failed');
    });

    it('should continue if cleanup fails', async () => {
      const requestData = { limit: 20 };

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockUser);
      mockFirestoreHelper.queryDocuments
        .mockRejectedValueOnce(new Error('Cleanup failed')) // Cleanup fails
        .mockResolvedValueOnce(mockNotifications) // Main query succeeds
        .mockResolvedValueOnce(mockNotifications.filter(n => !n.read)); // Unread count

      mockFirestoreHelper.updateDocument.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await getNotifications(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.notifications).toHaveLength(3);
      // Should continue successfully even if cleanup fails
    });

    it('should continue if metrics update fails', async () => {
      const requestData = { limit: 20 };

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockUser);
      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // Cleanup
        .mockResolvedValueOnce(mockNotifications) // Notifications
        .mockResolvedValueOnce(mockNotifications.filter(n => !n.read)); // Unread count

      mockFirestoreHelper.updateDocument.mockRejectedValue(new Error('Metrics update failed'));
      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await getNotifications(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.notifications).toHaveLength(3);
      // Should continue successfully even if metrics fail
    });
  });

  describe('Response Structure', () => {
    it('should return complete response structure with metadata', async () => {
      const requestData = {
        limit: 10,
        offset: 5,
        unreadOnly: true,
        types: ['project_update'],
        priority: 'high'
      };

      const filteredNotifications = [mockNotifications[2]]; // One high priority unread notification

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce({ projectTitle: 'Test Project', auditorName: 'Test Auditor' });

      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // Cleanup
        .mockResolvedValueOnce(filteredNotifications) // Filtered notifications
        .mockResolvedValueOnce(filteredNotifications); // Unread count

      mockFirestoreHelper.updateDocument.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await getNotifications(requestData, mockContext);

      expect(result).toMatchObject({
        success: true,
        data: {
          unreadCount: 1,
          notifications: expect.arrayContaining([
            expect.objectContaining({
              id: 'notif_789',
              type: 'audit_completed',
              read: false
            })
          ]),
          hasMore: false,
          totalCount: expect.any(Number),
          filters: {
            unreadOnly: true,
            types: ['project_update'],
            priority: 'high',
            dateRange: null
          },
          pagination: {
            limit: 10,
            offset: 5,
            nextOffset: 6
          }
        },
        timestamp: expect.any(String)
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle user with no notifications', async () => {
      const requestData = { limit: 20 };

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockUser);
      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // No expired notifications
        .mockResolvedValueOnce([]) // No notifications
        .mockResolvedValueOnce([]); // No unread

      mockFirestoreHelper.updateDocument.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await getNotifications(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.notifications).toEqual([]);
      expect(result.data.unreadCount).toBe(0);
      expect(result.data.hasMore).toBe(false);
    });

    it('should handle large unread counts correctly', async () => {
      const largeUnreadCount = NOTIFICATION_CONFIG.MAX_UNREAD_COUNT + 50;
      const manyUnreadNotifications = Array(largeUnreadCount).fill({}).map((_, i) => ({
        id: `notif_${i}`,
        recipientUid: 'user_123',
        read: false,
        createdAt: new Date()
      }));

      const requestData = { unreadOnly: true };

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockUser);
      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // Cleanup
        .mockResolvedValueOnce(manyUnreadNotifications.slice(0, 20)) // Paginated results
        .mockResolvedValueOnce(manyUnreadNotifications.slice(0, NOTIFICATION_CONFIG.MAX_UNREAD_COUNT)); // Capped unread count

      mockFirestoreHelper.updateDocument.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await getNotifications(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.unreadCount).toBe(NOTIFICATION_CONFIG.MAX_UNREAD_COUNT);
      // Should cap at maximum to avoid performance issues
    });
  });
});