/**
 * Tests for Metrics Collector
 * Social Finance Impact Platform
 */

import { metricsCollector } from '../metricsCollector';
import { firestoreHelper } from '../../utils/firestore';
import { logger } from '../../utils/logger';

jest.mock('../../utils/firestore');
jest.mock('../../utils/logger');

const mockFirestoreHelper = jest.mocked(firestoreHelper);
const mockLogger = jest.mocked(logger);

describe('Metrics Collector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFirestoreHelper.countDocuments.mockResolvedValue(100);
    mockFirestoreHelper.queryDocuments.mockResolvedValue([]);
    mockFirestoreHelper.setDocument.mockResolvedValue();
  });

  describe('Platform Metrics', () => {
    it('should collect total user count', async () => {
      await metricsCollector.collectPlatformMetrics();

      expect(mockFirestoreHelper.countDocuments).toHaveBeenCalledWith(
        'users',
        expect.any(Array)
      );
    });

    it('should collect total project count', async () => {
      await metricsCollector.collectPlatformMetrics();

      expect(mockFirestoreHelper.countDocuments).toHaveBeenCalledWith(
        'projects',
        expect.any(Array)
      );
    });

    it('should calculate total funds raised', async () => {
      mockFirestoreHelper.queryDocuments.mockResolvedValue([
        { funding: { raised: 50000 } },
        { funding: { raised: 75000 } }
      ] as any);

      const metrics = await metricsCollector.collectPlatformMetrics();

      expect(metrics.totalFundsRaised).toBe(125000);
    });
  });

  describe('User Metrics', () => {
    it('should segment users by type', async () => {
      mockFirestoreHelper.countDocuments
        .mockResolvedValueOnce(50) // creators
        .mockResolvedValueOnce(200) // contributors
        .mockResolvedValueOnce(10); // auditors

      const metrics = await metricsCollector.collectUserMetrics();

      expect(metrics.byType.creators).toBe(50);
      expect(metrics.byType.contributors).toBe(200);
      expect(metrics.byType.auditors).toBe(10);
    });

    it('should track active vs inactive users', async () => {
      mockFirestoreHelper.countDocuments
        .mockResolvedValueOnce(150) // active
        .mockResolvedValueOnce(50); // inactive

      const metrics = await metricsCollector.collectUserMetrics();

      expect(metrics.activeUsers).toBe(150);
      expect(metrics.inactiveUsers).toBe(50);
    });
  });

  describe('Project Metrics', () => {
    it('should segment projects by status', async () => {
      mockFirestoreHelper.countDocuments
        .mockResolvedValueOnce(10) // draft
        .mockResolvedValueOnce(5) // live
        .mockResolvedValueOnce(20) // funded
        .mockResolvedValueOnce(15); // completed

      const metrics = await metricsCollector.collectProjectMetrics();

      expect(metrics.byStatus.draft).toBe(10);
      expect(metrics.byStatus.live).toBe(5);
      expect(metrics.byStatus.funded).toBe(20);
      expect(metrics.byStatus.completed).toBe(15);
    });

    it('should calculate average funding per project', async () => {
      mockFirestoreHelper.queryDocuments.mockResolvedValue([
        { funding: { raised: 100000 } },
        { funding: { raised: 200000 } },
        { funding: { raised: 300000 } }
      ] as any);

      const metrics = await metricsCollector.collectProjectMetrics();

      expect(metrics.averageFunding).toBe(200000);
    });
  });

  describe('Contribution Metrics', () => {
    it('should calculate total contribution volume', async () => {
      mockFirestoreHelper.queryDocuments.mockResolvedValue([
        { amount: 10000, status: 'confirmed' },
        { amount: 25000, status: 'confirmed' },
        { amount: 15000, status: 'confirmed' }
      ] as any);

      const metrics = await metricsCollector.collectContributionMetrics();

      expect(metrics.totalVolume).toBe(50000);
      expect(metrics.averageAmount).toBeCloseTo(16666.67, 2);
    });
  });

  describe('Time Series Data', () => {
    it('should collect daily metrics', async () => {
      await metricsCollector.collectDailyMetrics();

      expect(mockFirestoreHelper.setDocument).toHaveBeenCalledWith(
        expect.stringContaining('metrics'),
        expect.stringContaining(new Date().toISOString().split('T')[0]),
        expect.objectContaining({
          timestamp: expect.any(Object),
          period: 'daily'
        })
      );
    });

    it('should aggregate weekly metrics', async () => {
      mockFirestoreHelper.queryDocuments.mockResolvedValue(
        Array.from({ length: 7 }, (_, i) => ({
          totalUsers: 100 + i,
          totalProjects: 50 + i
        })) as any
      );

      const weeklyMetrics = await metricsCollector.aggregateWeeklyMetrics();

      expect(weeklyMetrics.averageUsers).toBeGreaterThan(100);
    });
  });

  describe('Alert Thresholds', () => {
    it('should trigger alerts on metric thresholds', async () => {
      mockFirestoreHelper.countDocuments.mockResolvedValue(10000); // High count

      await metricsCollector.collectPlatformMetrics();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Threshold exceeded'),
        expect.any(Object)
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle collection errors gracefully', async () => {
      mockFirestoreHelper.countDocuments.mockRejectedValue(
        new Error('Database error')
      );

      await expect(metricsCollector.collectPlatformMetrics()).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should continue partial collection on errors', async () => {
      mockFirestoreHelper.countDocuments
        .mockResolvedValueOnce(100)
        .mockRejectedValueOnce(new Error('Error'))
        .mockResolvedValueOnce(50);

      await expect(metricsCollector.collectPlatformMetrics()).resolves.not.toThrow();
    });
  });
});
