/**
 * Tests for Performance Monitor
 * Social Finance Impact Platform
 */

import { performanceMonitor } from '../performanceMonitor';
import { logger } from '../../utils/logger';

jest.mock('../../utils/logger');

const mockLogger = jest.mocked(logger);

describe('Performance Monitor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Trace Creation', () => {
    it('should create performance trace with unique ID', () => {
      const trace1 = performanceMonitor.startTrace('operation1');
      const trace2 = performanceMonitor.startTrace('operation2');

      expect(trace1.id).toBeDefined();
      expect(trace2.id).toBeDefined();
      expect(trace1.id).not.toBe(trace2.id);
    });

    it('should record trace start time', () => {
      const startTime = Date.now();
      const trace = performanceMonitor.startTrace('test-operation');

      expect(trace.startTime).toBeGreaterThanOrEqual(startTime);
    });
  });

  describe('Trace Completion', () => {
    it('should calculate duration when ending trace', () => {
      const trace = performanceMonitor.startTrace('test-operation');

      // Simulate some work
      const work = () => {
        let sum = 0;
        for (let i = 0; i < 1000; i++) {
          sum += i;
        }
        return sum;
      };
      work();

      performanceMonitor.endTrace(trace.id);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Performance trace completed'),
        expect.objectContaining({
          traceId: trace.id,
          duration: expect.any(Number)
        })
      );
    });

    it('should handle missing trace ID gracefully', () => {
      performanceMonitor.endTrace('non-existent-trace-id');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Trace not found'),
        expect.any(Object)
      );
    });
  });

  describe('Metrics Collection', () => {
    it('should collect custom metrics', () => {
      performanceMonitor.recordMetric('api_latency', 250, {
        endpoint: '/api/projects',
        method: 'GET'
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Metric recorded'),
        expect.objectContaining({
          metric: 'api_latency',
          value: 250
        })
      );
    });

    it('should aggregate metrics by key', () => {
      performanceMonitor.recordMetric('db_query_time', 100);
      performanceMonitor.recordMetric('db_query_time', 150);
      performanceMonitor.recordMetric('db_query_time', 200);

      const stats = performanceMonitor.getMetricStats('db_query_time');

      expect(stats.count).toBe(3);
      expect(stats.average).toBeCloseTo(150);
      expect(stats.min).toBe(100);
      expect(stats.max).toBe(200);
    });
  });

  describe('Slow Operation Detection', () => {
    it('should flag slow operations', () => {
      const trace = performanceMonitor.startTrace('slow-operation', {
        threshold: 100
      });

      // Simulate slow operation
      const slowWork = () => {
        const start = Date.now();
        while (Date.now() - start < 150) {
          // Busy wait
        }
      };
      slowWork();

      performanceMonitor.endTrace(trace.id);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Slow operation detected'),
        expect.any(Object)
      );
    });
  });

  describe('Memory Monitoring', () => {
    it('should track memory usage', () => {
      const memoryStats = performanceMonitor.getMemoryStats();

      expect(memoryStats).toHaveProperty('heapUsed');
      expect(memoryStats).toHaveProperty('heapTotal');
      expect(memoryStats).toHaveProperty('external');
    });

    it('should warn on high memory usage', () => {
      performanceMonitor.checkMemoryThreshold();

      // Should log current memory usage
      expect(mockLogger.info).toHaveBeenCalled();
    });
  });
});
