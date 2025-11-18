/**
 * Tests for Email Service Integration (SendGrid)
 * Social Finance Impact Platform
 */

import { emailService } from '../sendgrid/emailService';
import { logger } from '../../utils/logger';

jest.mock('@sendgrid/mail');
jest.mock('../../utils/logger');

const mockLogger = jest.mocked(logger);

describe('Email Service Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Welcome Email', () => {
    it('should send welcome email to new users', async () => {
      const mockSend = jest.fn().mockResolvedValue([{ statusCode: 202 }]);

      (emailService as any).sgMail = {
        send: mockSend
      };

      await emailService.sendWelcomeEmail('user@test.com', {
        firstName: 'John',
        userType: 'creator'
      });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@test.com',
          subject: expect.stringContaining('Welcome'),
          html: expect.any(String)
        })
      );
    });

    it('should handle SendGrid API errors', async () => {
      const mockSend = jest.fn().mockRejectedValue(new Error('SendGrid error'));

      (emailService as any).sgMail = {
        send: mockSend
      };

      await expect(
        emailService.sendWelcomeEmail('user@test.com', { firstName: 'John' })
      ).rejects.toThrow('SendGrid error');

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('Contribution Receipt', () => {
    it('should send contribution receipt email', async () => {
      const mockSend = jest.fn().mockResolvedValue([{ statusCode: 202 }]);

      (emailService as any).sgMail = {
        send: mockSend
      };

      await emailService.sendContributionReceipt('user@test.com', {
        amount: 10000,
        projectTitle: 'Great Project',
        contributionDate: new Date()
      });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@test.com',
          subject: expect.stringContaining('Receipt'),
          html: expect.stringContaining('€100.00')
        })
      );
    });
  });

  describe('Notification Digest', () => {
    it('should send digest email with multiple notifications', async () => {
      const mockSend = jest.fn().mockResolvedValue([{ statusCode: 202 }]);

      (emailService as any).sgMail = {
        send: mockSend
      };

      await emailService.sendDigest('user@test.com', {
        notifications: [
          { type: 'project_update', title: 'Update 1' },
          { type: 'contribution_received', title: 'Update 2' }
        ],
        period: 'weekly'
      });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@test.com',
          subject: expect.stringContaining('Digest')
        })
      );
    });
  });

  describe('Email Validation', () => {
    it('should reject invalid email addresses', async () => {
      await expect(
        emailService.sendWelcomeEmail('invalid-email', {})
      ).rejects.toThrow();
    });
  });
});
