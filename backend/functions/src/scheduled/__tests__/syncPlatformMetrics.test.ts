/**
 * Tests for Sync Platform Metrics Scheduled Function
 * Social Finance Impact Platform
 */

import { syncPlatformMetrics } from '../syncPlatformMetrics';
import { firestoreHelper } from '../../utils/firestore';
import { logger } from '../../utils/logger';

jest.mock('../../utils/firestore');
jest.mock('../../utils/logger');

const mockFirestoreHelper = jest.mocked(firestoreHelper);
const mockLogger = jest.mocked(logger);

describe('syncPlatformMetrics Scheduled Function', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockFirestoreHelper.countDocuments.mockResolvedValue(100);
    mockFirestoreHelper.queryDocuments.mockResolvedValue([
      { id: 'project-1', funding: { raised: 50000 } },
      { id: 'project-2', funding: { raised: 75000 } }
    ] as any);
    mockFirestoreHelper.setDocument.mockResolvedValue();
  });

  it('should collect metrics from all collections', async () => {
    await syncPlatformMetrics();

    expect(mockFirestoreHelper.countDocuments).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array)
    );
  });

  it('should calculate aggregate platform statistics', async () => {
    await syncPlatformMetrics();

    expect(mockFirestoreHelper.setDocument).toHaveBeenCalledWith(
      'platformMetrics',
      expect.any(String),
      expect.objectContaining({
        totalProjects: expect.any(Number),
        totalFundsRaised: expect.any(Number),
        timestamp: expect.any(Object)
      })
    );
  });

  it('should log sync completion', async () => {
    await syncPlatformMetrics();

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Platform metrics synced'),
      expect.any(Object)
    );
  });

  it('should handle database errors', async () => {
    mockFirestoreHelper.countDocuments.mockRejectedValue(new Error('DB error'));

    await expect(syncPlatformMetrics()).rejects.toThrow();
    expect(mockLogger.error).toHaveBeenCalled();
  });
});
