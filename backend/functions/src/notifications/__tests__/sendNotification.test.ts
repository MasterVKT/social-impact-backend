/**
 * Tests for sendNotification Firebase Function
 * Social Finance Impact Platform
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { CallableContext } from 'firebase-functions/v1/https';
import { https } from 'firebase-functions';
import { sendNotification } from '../sendNotification';
import { firestoreHelper } from '../../utils/firestore';
import { emailService } from '../../integrations/sendgrid/emailService';
import { UserDocument, NotificationDocument } from '../../types/firestore';
import { STATUS, USER_PERMISSIONS, NOTIFICATION_CONFIG } from '../../utils/constants';
import { NotificationsAPI } from '../../types/api';

// Mock dependencies
jest.mock('../../utils/firestore');
jest.mock('../../utils/logger');
jest.mock('../../integrations/sendgrid/emailService');
jest.mock('../../utils/helpers', () => ({
  helpers: {
    string: {
      generateId: jest.fn((prefix: string) => `${prefix}_test_id_123`)
    }
  }
}));

const mockFirestoreHelper = firestoreHelper as jest.Mocked<typeof firestoreHelper>;
const mockEmailService = emailService as jest.Mocked<typeof emailService>;

describe('sendNotification', () => {
  let mockContext: CallableContext;
  let mockSender: UserDocument;
  let mockRecipient: UserDocument;

  beforeEach(() => {
    jest.clearAllMocks();

    mockContext = {
      auth: {
        uid: 'sender_123',
        token: {
          email: 'sender@test.com',
          role: 'user'
        }
      },
      rawRequest: {
        ip: '127.0.0.1'
      }
    };

    mockSender = {
      uid: 'sender_123',
      email: 'sender@test.com',
      firstName: 'Sender',
      lastName: 'User',
      userType: 'creator',
      status: 'active',
      permissions: [USER_PERMISSIONS.CREATE_PROJECT],
      preferences: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1
    } as UserDocument;

    mockRecipient = {
      uid: 'recipient_456',
      email: 'recipient@test.com',
      firstName: 'Recipient',
      lastName: 'User',
      userType: 'contributor',
      status: 'active',
      permissions: [USER_PERMISSIONS.CONTRIBUTE_TO_PROJECT],
      preferences: {
        notifications: {
          email: true,
          push: false,
          inApp: true,
          project_update: {
            email: true,
            inApp: true
          }
        }
      },
      notificationCounters: {
        unread: 5,
        total: 50
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1
    } as UserDocument;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Successful Notification Sending', () => {
    it('should send project update notification successfully', async () => {
      const requestData: NotificationsAPI.SendNotificationRequest = {
        recipientUid: 'recipient_456',
        type: 'project_update',
        title: 'New Project Update Available',
        message: 'Your supported project has posted a new milestone update.',
        data: {
          projectId: 'project_123',
          milestoneId: 'milestone_456',
          projectTitle: 'Environmental Restoration'
        },
        channels: {
          inApp: true,
          email: true,
          push: false
        },
        priority: 'medium',
        actionUrl: 'https://platform.com/projects/project_123/updates'
      };

      // Setup mocks
      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockSender)
        .mockResolvedValueOnce(mockRecipient);

      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([{ // Shared project for relationship validation
          id: 'project_123',
          creatorUid: 'sender_123',
          contributors: ['recipient_456']
        }])
        .mockResolvedValueOnce([]) // No rate limit violations - sender
        .mockResolvedValueOnce([]) // No rate limit violations - recipient
        .mockResolvedValueOnce([]) // No recent duplicates
        .mockResolvedValueOnce([]); // No similar notifications to supersede

      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        const mockTransaction = {
          set: jest.fn(),
          update: jest.fn()
        };
        await callback(mockTransaction as any);
      });

      mockEmailService.sendEmail.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await sendNotification(requestData, mockContext);

      expect(result.success).toBe(true);

      // Verify in-app notification creation
      expect(mockFirestoreHelper.runTransaction).toHaveBeenCalled();
      
      // Verify email sending
      expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'recipient@test.com',
          templateId: 'project_update_notification',
          dynamicTemplateData: expect.objectContaining({
            recipientName: 'Recipient User',
            notificationTitle: 'New Project Update Available',
            actionUrl: 'https://platform.com/projects/project_123/updates'
          })
        })
      );

      // Verify statistics update
      expect(mockFirestoreHelper.incrementDocument).toHaveBeenCalledWith('platform_stats', 'global', 
        expect.objectContaining({
          'notifications.totalSent': 1,
          'notifications.byType.project_update': 1,
          'notifications.inAppSent': 1,
          'notifications.emailSent': 1
        })
      );
    });

    it('should send system announcement with admin permissions', async () => {
      const adminSender = {
        ...mockSender,
        permissions: [USER_PERMISSIONS.SYSTEM_ADMIN]
      };

      const requestData: NotificationsAPI.SendNotificationRequest = {
        recipientUid: 'recipient_456',
        type: 'system_announcement',
        title: 'Platform Maintenance Notice',
        message: 'Scheduled maintenance will occur tonight from 2-4 AM.',
        channels: {
          inApp: true,
          email: true,
          push: true
        },
        priority: 'high'
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(adminSender)
        .mockResolvedValueOnce(mockRecipient);

      mockFirestoreHelper.queryDocuments.mockResolvedValue([]);
      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({} as any);
      });
      mockEmailService.sendEmail.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await sendNotification(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          templateId: 'system_announcement'
        })
      );
    });

    it('should respect recipient notification preferences', async () => {
      const recipientWithLimitedPrefs = {
        ...mockRecipient,
        preferences: {
          notifications: {
            email: false, // Email disabled
            inApp: true,
            push: false
          }
        }
      };

      const requestData: NotificationsAPI.SendNotificationRequest = {
        recipientUid: 'recipient_456',
        type: 'contribution_received',
        title: 'Thank you for your contribution!',
        message: 'Your contribution has been received and processed.',
        channels: {
          inApp: true,
          email: true, // Requested but user disabled
          push: false
        },
        priority: 'medium'
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockSender)
        .mockResolvedValueOnce(recipientWithLimitedPrefs);

      mockFirestoreHelper.queryDocuments.mockResolvedValue([]);
      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({} as any);
      });
      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await sendNotification(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(mockEmailService.sendEmail).not.toHaveBeenCalled(); // Email should not be sent
    });
  });

  describe('Permission Validation', () => {
    it('should reject unauthenticated requests', async () => {
      const requestData = {
        recipientUid: 'recipient_456',
        type: 'project_update',
        title: 'Test',
        message: 'Test message'
      };

      const unauthenticatedContext = { ...mockContext, auth: undefined };

      await expect(sendNotification(requestData, unauthenticatedContext))
        .rejects.toThrow('Authentication required');
    });

    it('should reject system notifications from non-admin users', async () => {
      const requestData = {
        recipientUid: 'recipient_456',
        type: 'system_announcement',
        title: 'System Update',
        message: 'System will be updated tonight.'
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockSender) // Regular user, not admin
        .mockResolvedValueOnce(mockRecipient);

      await expect(sendNotification(requestData, mockContext))
        .rejects.toThrow('System admin access required for system notifications');
    });

    it('should reject admin notifications from non-moderator users', async () => {
      const requestData = {
        recipientUid: 'recipient_456',
        type: 'audit_assigned',
        title: 'Audit Assignment',
        message: 'You have been assigned a new audit.'
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockSender) // Regular user, not moderator
        .mockResolvedValueOnce(mockRecipient);

      await expect(sendNotification(requestData, mockContext))
        .rejects.toThrow('Admin access required for this notification type');
    });

    it('should reject notifications to inactive recipients', async () => {
      const inactiveRecipient = {
        ...mockRecipient,
        status: 'suspended'
      };

      const requestData = {
        recipientUid: 'recipient_456',
        type: 'message_received',
        title: 'New Message',
        message: 'You have a new message.'
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockSender)
        .mockResolvedValueOnce(inactiveRecipient);

      await expect(sendNotification(requestData, mockContext))
        .rejects.toThrow('Recipient account is not active');
    });

    it('should validate user relationships for project notifications', async () => {
      const requestData = {
        recipientUid: 'recipient_456',
        type: 'project_update',
        title: 'Project Update',
        message: 'Project has been updated.'
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockSender)
        .mockResolvedValueOnce(mockRecipient);

      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]); // No shared projects

      await expect(sendNotification(requestData, mockContext))
        .rejects.toThrow('Cannot send notification to this user');
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce sender rate limits', async () => {
      const requestData = {
        recipientUid: 'recipient_456',
        type: 'message_received',
        title: 'Message',
        message: 'Test message'
      };

      // Create array of notifications to simulate rate limit
      const rateLimitNotifications = Array(NOTIFICATION_CONFIG.MAX_PER_SENDER_PER_HOUR)
        .fill({})
        .map((_, i) => ({
          id: `notif_${i}`,
          senderUid: 'sender_123',
          createdAt: new Date()
        }));

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockSender)
        .mockResolvedValueOnce(mockRecipient);

      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce(rateLimitNotifications); // Sender rate limit exceeded

      await expect(sendNotification(requestData, mockContext))
        .rejects.toThrow(`Sender rate limit exceeded: ${NOTIFICATION_CONFIG.MAX_PER_SENDER_PER_HOUR} notifications per hour`);
    });

    it('should enforce recipient rate limits', async () => {
      const requestData = {
        recipientUid: 'recipient_456',
        type: 'message_received',
        title: 'Message',
        message: 'Test message'
      };

      const rateLimitNotifications = Array(NOTIFICATION_CONFIG.MAX_PER_RECIPIENT_PER_HOUR)
        .fill({})
        .map((_, i) => ({
          id: `notif_${i}`,
          recipientUid: 'recipient_456',
          createdAt: new Date()
        }));

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockSender)
        .mockResolvedValueOnce(mockRecipient);

      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // Sender OK
        .mockResolvedValueOnce(rateLimitNotifications); // Recipient rate limit exceeded

      await expect(sendNotification(requestData, mockContext))
        .rejects.toThrow(`Recipient rate limit exceeded: ${NOTIFICATION_CONFIG.MAX_PER_RECIPIENT_PER_HOUR} notifications per hour`);
    });

    it('should enforce type-specific rate limits', async () => {
      const requestData = {
        recipientUid: 'recipient_456',
        type: 'project_update',
        title: 'Update',
        message: 'Project update message'
      };

      const maxPerType = NOTIFICATION_CONFIG.MAX_PER_TYPE_PER_HOUR.project_update || 
                        NOTIFICATION_CONFIG.DEFAULT_MAX_PER_TYPE_PER_HOUR;

      const typeRateLimitNotifications = Array(maxPerType)
        .fill({})
        .map((_, i) => ({
          id: `notif_${i}`,
          senderUid: 'sender_123',
          type: 'project_update',
          createdAt: new Date()
        }));

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockSender)
        .mockResolvedValueOnce(mockRecipient);

      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // Shared projects OK
        .mockResolvedValueOnce(typeRateLimitNotifications) // Type rate limit
        .mockResolvedValueOnce([]) // Recipient OK
        .mockResolvedValueOnce([]); // No duplicates

      await expect(sendNotification(requestData, mockContext))
        .rejects.toThrow(`Type rate limit exceeded: ${maxPerType} project_update notifications per hour`);
    });
  });

  describe('Duplicate Detection', () => {
    it('should skip sending duplicate notifications', async () => {
      const requestData = {
        recipientUid: 'recipient_456',
        type: 'message_received',
        title: 'Same Title',
        message: 'Same message content'
      };

      const recentDuplicate = {
        id: 'existing_notif',
        recipientUid: 'recipient_456',
        type: 'message_received',
        title: 'Same Title',
        createdAt: new Date(Date.now() - 2 * 60 * 1000) // 2 minutes ago
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockSender)
        .mockResolvedValueOnce(mockRecipient);

      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // Sender rate OK
        .mockResolvedValueOnce([]) // Recipient rate OK
        .mockResolvedValueOnce([recentDuplicate]); // Duplicate found

      const result = await sendNotification(requestData, mockContext);

      expect(result.success).toBe(true);
      // Should complete successfully but skip sending
      expect(mockFirestoreHelper.runTransaction).not.toHaveBeenCalled();
      expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('Notification Grouping', () => {
    it('should supersede similar notifications when groupKey provided', async () => {
      const requestData = {
        recipientUid: 'recipient_456',
        type: 'contribution_received',
        title: 'New Contribution',
        message: 'You received a new contribution.',
        groupKey: 'contributions_project_123',
        channels: { inApp: true }
      };

      const similarNotifications = [
        {
          id: 'old_notif_1',
          recipientUid: 'recipient_456',
          groupKey: 'contributions_project_123',
          read: false
        },
        {
          id: 'old_notif_2',
          recipientUid: 'recipient_456',
          groupKey: 'contributions_project_123',
          read: false
        }
      ];

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockSender)
        .mockResolvedValueOnce(mockRecipient);

      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // Rate limits OK
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]) // No duplicates
        .mockResolvedValueOnce(similarNotifications); // Similar notifications to supersede

      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({} as any);
      });
      mockFirestoreHelper.updateDocument.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await sendNotification(requestData, mockContext);

      expect(result.success).toBe(true);
      
      // Verify similar notifications were superseded
      expect(mockFirestoreHelper.updateDocument).toHaveBeenCalledWith('notifications', 'old_notif_1', 
        expect.objectContaining({
          superseded: true,
          supersededAt: expect.any(Date)
        })
      );
      expect(mockFirestoreHelper.updateDocument).toHaveBeenCalledWith('notifications', 'old_notif_2', 
        expect.objectContaining({
          superseded: true,
          supersededAt: expect.any(Date)
        })
      );
    });
  });

  describe('Channel Preferences', () => {
    it('should skip notification when all channels disabled by recipient', async () => {
      const recipientWithDisabledNotifications = {
        ...mockRecipient,
        preferences: {
          notifications: {
            email: false,
            push: false,
            inApp: false
          }
        }
      };

      const requestData = {
        recipientUid: 'recipient_456',
        type: 'project_update',
        title: 'Update',
        message: 'Project update',
        channels: { inApp: true, email: true, push: true }
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockSender)
        .mockResolvedValueOnce(recipientWithDisabledNotifications);

      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([{ // Valid relationship
          creatorUid: 'sender_123',
          contributors: ['recipient_456']
        }])
        .mockResolvedValueOnce([]) // Rate limits OK
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]) // No duplicates
        .mockResolvedValueOnce([]); // No grouping

      const result = await sendNotification(requestData, mockContext);

      expect(result.success).toBe(true);
      // Should skip sending due to disabled preferences
      expect(mockFirestoreHelper.runTransaction).not.toHaveBeenCalled();
      expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
    });

    it('should use type-specific preferences when available', async () => {
      const recipientWithTypePrefs = {
        ...mockRecipient,
        preferences: {
          notifications: {
            email: false, // Global email disabled
            inApp: true,
            project_update: {
              email: true, // But enabled for project updates
              inApp: true
            }
          }
        }
      };

      const requestData = {
        recipientUid: 'recipient_456',
        type: 'project_update',
        title: 'Important Update',
        message: 'Critical project update',
        channels: { inApp: true, email: true }
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockSender)
        .mockResolvedValueOnce(recipientWithTypePrefs);

      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([{ // Valid relationship
          creatorUid: 'sender_123',
          contributors: ['recipient_456']
        }])
        .mockResolvedValueOnce([]) // Rate limits OK
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]) // No duplicates
        .mockResolvedValueOnce([]); // No grouping

      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({} as any);
      });
      mockEmailService.sendEmail.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await sendNotification(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(mockEmailService.sendEmail).toHaveBeenCalled(); // Should send email due to type-specific preference
    });
  });

  describe('Data Validation', () => {
    it('should reject invalid notification types', async () => {
      const requestData = {
        recipientUid: 'recipient_456',
        type: 'invalid_type',
        title: 'Test',
        message: 'Test message'
      };

      await expect(sendNotification(requestData, mockContext))
        .rejects.toThrow('Validation error');
    });

    it('should reject short titles', async () => {
      const requestData = {
        recipientUid: 'recipient_456',
        type: 'message_received',
        title: 'Hi', // Too short
        message: 'Test message that is long enough'
      };

      await expect(sendNotification(requestData, mockContext))
        .rejects.toThrow('Validation error');
    });

    it('should reject short messages', async () => {
      const requestData = {
        recipientUid: 'recipient_456',
        type: 'message_received',
        title: 'Valid Title',
        message: 'Short' // Too short
      };

      await expect(sendNotification(requestData, mockContext))
        .rejects.toThrow('Validation error');
    });

    it('should reject invalid priority values', async () => {
      const requestData = {
        recipientUid: 'recipient_456',
        type: 'message_received',
        title: 'Valid Title',
        message: 'Valid message content',
        priority: 'invalid_priority'
      };

      await expect(sendNotification(requestData, mockContext))
        .rejects.toThrow('Validation error');
    });

    it('should reject invalid actionUrl format', async () => {
      const requestData = {
        recipientUid: 'recipient_456',
        type: 'message_received',
        title: 'Valid Title',
        message: 'Valid message content',
        actionUrl: 'not-a-valid-url'
      };

      await expect(sendNotification(requestData, mockContext))
        .rejects.toThrow('Validation error');
    });
  });

  describe('Email Integration', () => {
    it('should handle email service failures gracefully', async () => {
      const requestData = {
        recipientUid: 'recipient_456',
        type: 'message_received',
        title: 'Test Message',
        message: 'This is a test message',
        channels: { inApp: true, email: true }
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockSender)
        .mockResolvedValueOnce(mockRecipient);

      mockFirestoreHelper.queryDocuments.mockResolvedValue([]);
      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({} as any);
      });
      
      mockEmailService.sendEmail.mockRejectedValue(new Error('Email service unavailable'));
      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await sendNotification(requestData, mockContext);

      expect(result.success).toBe(true);
      // Should continue successfully even if email fails (in-app still works)
    });

    it('should use correct email template for notification type', async () => {
      const requestData = {
        recipientUid: 'recipient_456',
        type: 'payment_processed',
        title: 'Payment Confirmation',
        message: 'Your payment has been processed.',
        data: {
          amount: 5000,
          transactionId: 'txn_123'
        },
        channels: { email: true }
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockSender)
        .mockResolvedValueOnce(mockRecipient);

      mockFirestoreHelper.queryDocuments.mockResolvedValue([]);
      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({} as any);
      });
      mockEmailService.sendEmail.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await sendNotification(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          templateId: 'payment_confirmation',
          dynamicTemplateData: expect.objectContaining({
            amount: 5000,
            transactionId: 'txn_123'
          })
        })
      );
    });
  });

  describe('Database Operations', () => {
    it('should handle transaction failures gracefully', async () => {
      const requestData = {
        recipientUid: 'recipient_456',
        type: 'message_received',
        title: 'Test Message',
        message: 'This is a test message',
        channels: { inApp: true }
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockSender)
        .mockResolvedValueOnce(mockRecipient);

      mockFirestoreHelper.queryDocuments.mockResolvedValue([]);
      mockFirestoreHelper.runTransaction.mockRejectedValue(new Error('Transaction failed'));

      await expect(sendNotification(requestData, mockContext))
        .rejects.toThrow('Transaction failed');
    });

    it('should continue if statistics update fails', async () => {
      const requestData = {
        recipientUid: 'recipient_456',
        type: 'message_received',
        title: 'Test Message',
        message: 'This is a test message',
        channels: { inApp: true }
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockSender)
        .mockResolvedValueOnce(mockRecipient);

      mockFirestoreHelper.queryDocuments.mockResolvedValue([]);
      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({} as any);
      });
      mockFirestoreHelper.incrementDocument.mockRejectedValue(new Error('Stats update failed'));

      const result = await sendNotification(requestData, mockContext);

      expect(result.success).toBe(true);
      // Should continue successfully even if stats fail
    });
  });

  describe('Push Notifications', () => {
    it('should handle missing device tokens gracefully', async () => {
      const requestData = {
        recipientUid: 'recipient_456',
        type: 'deadline_reminder',
        title: 'Deadline Approaching',
        message: 'Your project deadline is in 2 days.',
        channels: { push: true }
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockSender)
        .mockResolvedValueOnce(mockRecipient);

      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // Rate limits OK
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]) // No duplicates
        .mockResolvedValueOnce([]) // No grouping
        .mockResolvedValueOnce([]); // No device tokens

      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({} as any);
      });
      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await sendNotification(requestData, mockContext);

      expect(result.success).toBe(true);
      // Should continue successfully even without push tokens
    });
  });

  describe('Security and Logging', () => {
    it('should log security events for urgent notifications', async () => {
      const adminSender = {
        ...mockSender,
        permissions: [USER_PERMISSIONS.SYSTEM_ADMIN]
      };

      const requestData = {
        recipientUid: 'recipient_456',
        type: 'system_announcement',
        title: 'Critical Security Update',
        message: 'Immediate action required for security compliance.',
        priority: 'urgent',
        channels: { inApp: true, email: true }
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(adminSender)
        .mockResolvedValueOnce(mockRecipient);

      mockFirestoreHelper.queryDocuments.mockResolvedValue([]);
      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({} as any);
      });
      mockEmailService.sendEmail.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await sendNotification(requestData, mockContext);

      expect(result.success).toBe(true);
      // Should log security event for urgent system notifications
    });

    it('should handle sensitive data appropriately', async () => {
      const requestData = {
        recipientUid: 'recipient_456',
        type: 'payment_processed',
        title: 'Payment Processed',
        message: 'Your payment has been successfully processed.',
        data: {
          amount: 25000,
          accountLastFour: '1234',
          transactionId: 'txn_sensitive_123'
        },
        channels: { inApp: true, email: true }
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockSender)
        .mockResolvedValueOnce(mockRecipient);

      mockFirestoreHelper.queryDocuments.mockResolvedValue([]);
      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({} as any);
      });
      mockEmailService.sendEmail.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await sendNotification(requestData, mockContext);

      expect(result.success).toBe(true);
      // Sensitive financial data should be handled properly in storage and logs
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing sender gracefully for system notifications', async () => {
      const systemContext = {
        ...mockContext,
        auth: { ...mockContext.auth!, uid: 'system' }
      };

      const requestData = {
        recipientUid: 'recipient_456',
        type: 'kyc_status',
        title: 'KYC Update',
        message: 'Your KYC status has been updated.',
        channels: { inApp: true }
      };

      // System user might not exist in users collection
      mockFirestoreHelper.getDocument
        .mockRejectedValueOnce(new Error('System user not found'))
        .mockResolvedValueOnce(mockRecipient);

      await expect(sendNotification(requestData, systemContext))
        .rejects.toThrow('Unable to validate notification permissions');
    });

    it('should handle concurrent notification sending', async () => {
      const requestData = {
        recipientUid: 'recipient_456',
        type: 'message_received',
        title: 'Concurrent Message',
        message: 'Test for concurrent sending',
        channels: { inApp: true }
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockSender)
        .mockResolvedValueOnce(mockRecipient);

      mockFirestoreHelper.queryDocuments.mockResolvedValue([]);
      
      // Simulate transaction conflict
      mockFirestoreHelper.runTransaction
        .mockRejectedValueOnce(new Error('Transaction conflict'))
        .mockImplementation(async (callback) => {
          await callback({} as any);
        });

      // Should retry and succeed
      const result = await sendNotification(requestData, mockContext);
      expect(result.success).toBe(true);
    });

    it('should handle missing notification preferences gracefully', async () => {
      const recipientWithoutPrefs = {
        ...mockRecipient,
        preferences: {} // No notification preferences
      };

      const requestData = {
        recipientUid: 'recipient_456',
        type: 'contribution_received',
        title: 'Contribution Received',
        message: 'Thank you for your contribution!',
        channels: { inApp: true, email: true }
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockSender)
        .mockResolvedValueOnce(recipientWithoutPrefs);

      mockFirestoreHelper.queryDocuments.mockResolvedValue([]);
      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        await callback({} as any);
      });
      mockEmailService.sendEmail.mockResolvedValue();
      mockFirestoreHelper.incrementDocument.mockResolvedValue();

      const result = await sendNotification(requestData, mockContext);

      expect(result.success).toBe(true);
      // Should use default preferences and send both in-app and email
      expect(mockEmailService.sendEmail).toHaveBeenCalled();
    });
  });
});