/**
 * Tests for Update Recommendations Scheduled Function
 * Social Finance Impact Platform
 */

import { updateRecommendations } from '../updateRecommendations';
import { firestoreHelper } from '../../utils/firestore';
import { logger } from '../../utils/logger';

jest.mock('../../utils/firestore');
jest.mock('../../utils/logger');

const mockFirestoreHelper = jest.mocked(firestoreHelper);
const mockLogger = jest.mocked(logger);

describe('updateRecommendations Scheduled Function', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockFirestoreHelper.queryDocuments.mockResolvedValue([
      {
        id: 'user-1',
        preferences: { interests: ['environment'], categories: ['sustainability'] },
        contributions: ['project-1']
      }
    ] as any);

    mockFirestoreHelper.setDocument.mockResolvedValue();
  });

  it('should generate recommendations for all users', async () => {
    await updateRecommendations();

    expect(mockFirestoreHelper.queryDocuments).toHaveBeenCalledWith(
      'users',
      expect.any(Array),
      expect.any(Object)
    );
  });

  it('should store personalized recommendations', async () => {
    await updateRecommendations();

    expect(mockFirestoreHelper.setDocument).toHaveBeenCalledWith(
      expect.stringContaining('recommendations'),
      expect.any(String),
      expect.objectContaining({
        userId: expect.any(String),
        projects: expect.any(Array),
        updatedAt: expect.any(Object)
      })
    );
  });

  it('should handle users with no activity', async () => {
    mockFirestoreHelper.queryDocuments.mockResolvedValue([
      { id: 'user-2', contributions: [] }
    ] as any);

    await expect(updateRecommendations()).resolves.not.toThrow();
  });

  it('should log update completion', async () => {
    await updateRecommendations();

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Recommendations updated'),
      expect.any(Object)
    );
  });
});
