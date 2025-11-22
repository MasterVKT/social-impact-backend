/**
 * Tests for Generate Monthly Reports Scheduled Function
 * Social Finance Impact Platform
 */

import { generateMonthlyReports } from '../generateMonthlyReports';
import { firestoreHelper } from '../../utils/firestore';
import { logger } from '../../utils/logger';

jest.mock('../../utils/firestore');
jest.mock('../../utils/logger');
jest.mock('../../integrations/sendgrid/emailService');

const mockFirestoreHelper = jest.mocked(firestoreHelper);
const mockLogger = jest.mocked(logger);

describe('generateMonthlyReports Scheduled Function', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockFirestoreHelper.queryDocuments.mockResolvedValue([
      { id: 'user-1', email: 'user1@test.com', userType: 'creator' },
      { id: 'user-2', email: 'user2@test.com', userType: 'contributor' }
    ] as any);

    mockFirestoreHelper.setDocument.mockResolvedValue();
  });

  it('should generate reports for all active users', async () => {
    await generateMonthlyReports();

    expect(mockFirestoreHelper.queryDocuments).toHaveBeenCalledWith(
      'users',
      expect.anything(),
      expect.any(Object)
    );
  });

  it('should store generated reports in Firestore', async () => {
    await generateMonthlyReports();

    expect(mockFirestoreHelper.setDocument).toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Monthly reports generated'),
      expect.any(Object)
    );
  });

  it('should handle empty user list', async () => {
    mockFirestoreHelper.queryDocuments.mockResolvedValue([]);

    await expect(generateMonthlyReports()).resolves.not.toThrow();
  });

  it('should handle report generation errors', async () => {
    mockFirestoreHelper.setDocument.mockRejectedValue(new Error('Storage failed'));

    await expect(generateMonthlyReports()).rejects.toThrow();
    expect(mockLogger.error).toHaveBeenCalled();
  });
});
