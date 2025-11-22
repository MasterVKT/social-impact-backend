/**
 * Tests for Calculate Interest Scheduled Function
 * Social Finance Impact Platform
 */

import { calculateInterest } from '../calculateInterest';
import { firestoreHelper } from '../../utils/firestore';
import { logger } from '../../utils/logger';
import { ProjectDocument } from '../../types/firestore';

jest.mock('../../utils/firestore');
jest.mock('../../utils/logger');

const mockFirestoreHelper = jest.mocked(firestoreHelper);
const mockLogger = jest.mocked(logger);

describe('calculateInterest Scheduled Function', () => {
  let mockProjects: ProjectDocument[];

  beforeEach(() => {
    jest.clearAllMocks();

    mockProjects = [
      {
        id: 'project-1',
        title: 'Project One',
        status: 'funded',
        funding: {
          raised: 100000,
          goal: 100000,
          currency: 'EUR'
        }
      } as any
    ];

    mockFirestoreHelper.queryDocuments.mockResolvedValue(mockProjects);
    mockFirestoreHelper.updateDocument.mockResolvedValue();
  });

  it('should calculate interest for funded projects', async () => {
    await calculateInterest();

    expect(mockFirestoreHelper.queryDocuments).toHaveBeenCalledWith(
      'projects',
      expect.arrayContaining([
        ['status', '==', 'funded']
      ]),
      expect.any(Object)
    );
  });

  it('should update project documents with calculated interest', async () => {
    await calculateInterest();

    expect(mockFirestoreHelper.updateDocument).toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Interest calculation completed'),
      expect.any(Object)
    );
  });

  it('should handle empty projects list', async () => {
    mockFirestoreHelper.queryDocuments.mockResolvedValue([]);

    await expect(calculateInterest()).resolves.not.toThrow();
  });

  it('should handle calculation errors gracefully', async () => {
    mockFirestoreHelper.updateDocument.mockRejectedValue(new Error('Update failed'));

    await expect(calculateInterest()).rejects.toThrow();
    expect(mockLogger.error).toHaveBeenCalled();
  });
});
