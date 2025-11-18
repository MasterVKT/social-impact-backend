/**
 * Tests for Monitoring Integration
 * Social Finance Impact Platform
 */

import { monitoringIntegration } from '../monitoringIntegration';
import { logger } from '../../utils/logger';

jest.mock('../../utils/logger');

const mockLogger = jest.mocked(logger);

describe('Monitoring Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize monitoring systems', () => {
      monitoringIntegration.initialize({
        enablePerformanceMonitoring: true,
        enableErrorTracking: true,
        enableMetrics: true
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Monitoring initialized'),
        expect.any(Object)
      );
    });

    it('should handle initialization errors', () => {
      expect(() => {
        monitoringIntegration.initialize({} as any);
      }).not.toThrow();
    });
  });

  describe('Error Tracking', () => {
    it('should capture and report errors', () => {
      const error = new Error('Test error');

      monitoringIntegration.captureError(error, {
        context: 'test',
        severity: 'error'
      });

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error captured'),
        expect.objectContaining({
          error: expect.any(Error),
          context: 'test'
        })
      );
    });

    it('should group similar errors', () => {
      const error1 = new Error('Same error');
      const error2 = new Error('Same error');

      monitoringIntegration.captureError(error1);
      monitoringIntegration.captureError(error2);

      // Should recognize as duplicate
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Duplicate error detected'),
        expect.any(Object)
      );
    });
  });

  describe('Custom Events', () => {
    it('should track custom events', () => {
      monitoringIntegration.trackEvent('user_signup', {
        userType: 'creator',
        source: 'web'
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Event tracked'),
        expect.objectContaining({
          event: 'user_signup',
          properties: expect.any(Object)
        })
      );
    });
  });

  describe('Health Checks', () => {
    it('should perform system health check', async () => {
      const health = await monitoringIntegration.getHealthStatus();

      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('uptime');
      expect(health).toHaveProperty('memory');
      expect(health).toHaveProperty('services');
    });

    it('should report degraded status on issues', async () => {
      // Simulate high memory usage
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = jest.fn().mockReturnValue({
        heapUsed: 900 * 1024 * 1024, // 900 MB
        heapTotal: 1000 * 1024 * 1024,
        external: 0,
        arrayBuffers: 0
      });

      const health = await monitoringIntegration.getHealthStatus();

      expect(health.status).toBe('degraded');

      process.memoryUsage = originalMemoryUsage;
    });
  });

  describe('Alert Notifications', () => {
    it('should send alerts on critical issues', async () => {
      await monitoringIntegration.sendAlert({
        severity: 'critical',
        title: 'Database Connection Lost',
        message: 'Unable to connect to Firestore',
        details: {}
      });

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Critical alert'),
        expect.any(Object)
      );
    });

    it('should throttle duplicate alerts', async () => {
      await monitoringIntegration.sendAlert({
        severity: 'warning',
        title: 'High Memory',
        message: 'Memory usage above 80%'
      });

      await monitoringIntegration.sendAlert({
        severity: 'warning',
        title: 'High Memory',
        message: 'Memory usage above 80%'
      });

      // Second alert should be throttled
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Alert throttled'),
        expect.any(Object)
      );
    });
  });

  describe('Performance Benchmarks', () => {
    it('should track function execution time', async () => {
      const result = await monitoringIntegration.benchmark('test-operation', async () => {
        return new Promise(resolve => setTimeout(() => resolve('done'), 100));
      });

      expect(result).toBe('done');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Benchmark completed'),
        expect.objectContaining({
          operation: 'test-operation',
          duration: expect.any(Number)
        })
      );
    });
  });

  describe('Cleanup', () => {
    it('should gracefully shutdown monitoring', async () => {
      await monitoringIntegration.shutdown();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Monitoring shutdown'),
        expect.any(Object)
      );
    });
  });
});
