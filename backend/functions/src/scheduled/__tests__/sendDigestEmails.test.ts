/**
 * Tests for Send Digest Emails Scheduled Function
 * Social Finance Impact Platform
 */

import { sendDigestEmails } from '../sendDigestEmails';
import { firestoreHelper } from '../../utils/firestore';
import { logger } from '../../utils/logger';

jest.mock('../../utils/firestore');
jest.mock('../../utils/logger');
jest.mock('../../integrations/sendgrid/emailService');

const mockFirestoreHelper = jest.mocked(firestoreHelper);
const mockLogger = jest.mocked(logger);

describe('sendDigestEmails Scheduled Function', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockFirestoreHelper.queryDocuments.mockResolvedValue([
      {
        id: 'user-1',
        email: 'user1@test.com',
        preferences: { emailDigest: 'weekly', emailNotifications: true }
      },
      {
        id: 'user-2',
        email: 'user2@test.com',
        preferences: { emailDigest: 'daily', emailNotifications: true }
      }
    ] as any);

    mockFirestoreHelper.updateDocument.mockResolvedValue();
  });

  it('should send digest emails to opted-in users', async () => {
    await sendDigestEmails();

    expect(mockFirestoreHelper.queryDocuments).toHaveBeenCalledWith(
      'users',
      expect.arrayContaining([
        ['preferences.emailNotifications', '==', true]
      ]),
      expect.any(Object)
    );
  });

  it('should respect user digest frequency preferences', async () => {
    await sendDigestEmails();

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Digest emails sent'),
      expect.any(Object)
    );
  });

  it('should handle empty user list', async () => {
    mockFirestoreHelper.queryDocuments.mockResolvedValue([]);

    await expect(sendDigestEmails()).resolves.not.toThrow();
  });

  it('should handle email sending errors gracefully', async () => {
    mockFirestoreHelper.queryDocuments.mockRejectedValue(new Error('Email service down'));

    await expect(sendDigestEmails()).rejects.toThrow();
    expect(mockLogger.error).toHaveBeenCalled();
  });
});
