/**
 * Tests for User Creation Trigger Function
 * Social Finance Impact Platform
 */

import { onUserCreate } from '../onUserCreate';
import { firestoreHelper } from '../../utils/firestore';
import { logger } from '../../utils/logger';
import { emailService } from '../../integrations/sendgrid/emailService';

jest.mock('../../utils/firestore');
jest.mock('../../utils/logger');
jest.mock('../../integrations/sendgrid/emailService');

const mockFirestoreHelper = jest.mocked(firestoreHelper);
const mockLogger = jest.mocked(logger);
const mockEmailService = jest.mocked(emailService);

describe('onUserCreate Trigger Function', () => {
  let mockSnapshot: any;
  let mockContext: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockSnapshot = {
      id: 'user-123',
      data: () => ({
        uid: 'user-123',
        email: 'newuser@test.com',
        userType: 'creator',
        createdAt: new Date(),
        emailVerified: false
      }),
      ref: {
        update: jest.fn().mockResolvedValue(undefined)
      }
    };

    mockContext = {
      eventId: 'event-123',
      timestamp: new Date().toISOString(),
      resource: 'projects/test/databases/(default)/documents/users/user-123'
    };

    mockFirestoreHelper.updateDocument.mockResolvedValue();
    mockFirestoreHelper.setDocument.mockResolvedValue();
    mockEmailService.sendWelcomeEmail.mockResolvedValue();
  });

  describe('User Profile Initialization', () => {
    it('should initialize default user profile on creation', async () => {
      await onUserCreate(mockSnapshot, mockContext);

      expect(mockFirestoreHelper.updateDocument).toHaveBeenCalledWith(
        'users',
        'user-123',
        expect.objectContaining({
          preferences: expect.any(Object),
          stats: expect.any(Object),
          notificationCounters: expect.any(Object)
        })
      );
    });

    it('should set correct permissions for creator type', async () => {
      mockSnapshot.data = () => ({ ...mockSnapshot.data(), userType: 'creator' });

      await onUserCreate(mockSnapshot, mockContext);

      expect(mockFirestoreHelper.updateDocument).toHaveBeenCalledWith(
        'users',
        'user-123',
        expect.objectContaining({
          permissions: expect.arrayContaining(['create:project'])
        })
      );
    });

    it('should set correct permissions for contributor type', async () => {
      mockSnapshot.data = () => ({ ...mockSnapshot.data(), userType: 'contributor' });

      await onUserCreate(mockSnapshot, mockContext);

      expect(mockFirestoreHelper.updateDocument).toHaveBeenCalledWith(
        'users',
        'user-123',
        expect.objectContaining({
          permissions: expect.any(Array)
        })
      );
    });

    it('should set correct permissions for auditor type', async () => {
      mockSnapshot.data = () => ({ ...mockSnapshot.data(), userType: 'auditor' });

      await onUserCreate(mockSnapshot, mockContext);

      expect(mockFirestoreHelper.updateDocument).toHaveBeenCalledWith(
        'users',
        'user-123',
        expect.objectContaining({
          permissions: expect.any(Array)
        })
      );
    });
  });

  describe('Welcome Email', () => {
    it('should send welcome email to new user', async () => {
      await onUserCreate(mockSnapshot, mockContext);

      expect(mockEmailService.sendWelcomeEmail).toHaveBeenCalledWith(
        'newuser@test.com',
        expect.objectContaining({
          firstName: expect.any(String),
          userType: 'creator'
        })
      );
    });

    it('should handle email sending failure gracefully', async () => {
      mockEmailService.sendWelcomeEmail.mockRejectedValue(new Error('Email failed'));

      await expect(onUserCreate(mockSnapshot, mockContext)).resolves.not.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to send welcome email'),
        expect.any(Error)
      );
    });
  });

  describe('Initial Notifications', () => {
    it('should create welcome notification for new user', async () => {
      await onUserCreate(mockSnapshot, mockContext);

      expect(mockFirestoreHelper.setDocument).toHaveBeenCalledWith(
        expect.stringContaining('notifications'),
        expect.any(String),
        expect.objectContaining({
          userId: 'user-123',
          type: 'welcome',
          read: false
        })
      );
    });
  });

  describe('Referral Tracking', () => {
    it('should track referral when referredBy is present', async () => {
      mockSnapshot.data = () => ({
        ...mockSnapshot.data(),
        referredBy: 'referrer-user-id'
      });

      await onUserCreate(mockSnapshot, mockContext);

      expect(mockFirestoreHelper.updateDocument).toHaveBeenCalledWith(
        'users',
        'referrer-user-id',
        expect.objectContaining({
          'stats.referralsCount': expect.anything()
        })
      );
    });

    it('should not fail if referrer does not exist', async () => {
      mockSnapshot.data = () => ({
        ...mockSnapshot.data(),
        referredBy: 'non-existent-user'
      });

      mockFirestoreHelper.updateDocument.mockRejectedValue(new Error('User not found'));

      await expect(onUserCreate(mockSnapshot, mockContext)).resolves.not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should handle Firestore errors gracefully', async () => {
      mockFirestoreHelper.updateDocument.mockRejectedValue(new Error('Firestore error'));

      await expect(onUserCreate(mockSnapshot, mockContext)).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Error)
      );
    });

    it('should log trigger execution', async () => {
      await onUserCreate(mockSnapshot, mockContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('User created'),
        expect.objectContaining({
          userId: 'user-123',
          userType: 'creator'
        })
      );
    });
  });
});
