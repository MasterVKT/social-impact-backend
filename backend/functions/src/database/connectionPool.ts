/**
 * Database Connection Pool Manager
 * Social Finance Impact Platform
 * 
 * Manages Firestore connections, connection pooling,
 * and database health monitoring for optimal performance
 */

import { Firestore, Settings } from 'firebase-admin/firestore';
import { initializeApp, getApps, App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from '../utils/logger';
import { metricsCollector } from '../monitoring/metricsCollector';
import { performanceMonitor } from '../monitoring/performanceMonitor';

// ============================================================================
// CONNECTION POOL CONFIGURATION
// ============================================================================

export interface ConnectionPoolConfig {
  // Connection settings
  maxConnections: number;
  minConnections: number;
  connectionTimeout: number; // milliseconds
  idleTimeout: number; // milliseconds
  
  // Health check settings
  healthCheckInterval: number; // milliseconds
  maxHealthCheckFailures: number;
  
  // Performance settings
  enableCompression: boolean;
  maxRetries: number;
  retryDelayMs: number;
  
  // Monitoring settings
  enableMetrics: boolean;
  metricsInterval: number; // milliseconds
}

export interface ConnectionStats {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  waitingRequests: number;
  totalRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  lastHealthCheck: Date;
  healthStatus: 'healthy' | 'degraded' | 'unhealthy';
}

export interface DatabaseConnectionInfo {
  id: string;
  firestore: Firestore;
  createdAt: Date;
  lastUsed: Date;
  requestCount: number;
  isHealthy: boolean;
  responseTime: number;
}

// ============================================================================
// CONNECTION POOL MANAGER
// ============================================================================

export class DatabaseConnectionPool {
  private config: ConnectionPoolConfig;
  private connections: Map<string, DatabaseConnectionInfo>;
  private availableConnections: string[];
  private activeConnections: Set<string>;
  private waitingQueue: Array<{
    resolve: (connection: DatabaseConnectionInfo) => void;
    reject: (error: Error) => void;
    requestedAt: Date;
  }>;
  private stats: ConnectionStats;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private metricsInterval: NodeJS.Timeout | null = null;
  private isShuttingDown = false;

  constructor(config?: Partial<ConnectionPoolConfig>) {
    this.config = {
      maxConnections: 10,
      minConnections: 2,
      connectionTimeout: 30000, // 30 seconds
      idleTimeout: 300000, // 5 minutes
      healthCheckInterval: 60000, // 1 minute
      maxHealthCheckFailures: 3,
      enableCompression: true,
      maxRetries: 3,
      retryDelayMs: 1000,
      enableMetrics: true,
      metricsInterval: 30000, // 30 seconds
      ...config
    };

    this.connections = new Map();
    this.availableConnections = [];
    this.activeConnections = new Set();
    this.waitingQueue = [];

    this.stats = {
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      waitingRequests: 0,
      totalRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      lastHealthCheck: new Date(),
      healthStatus: 'healthy'
    };

    this.initialize();
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  private async initialize(): Promise<void> {
    try {
      logger.info('Initializing database connection pool', {
        maxConnections: this.config.maxConnections,
        minConnections: this.config.minConnections
      });

      // Create initial connections
      await this.createInitialConnections();

      // Start health check monitoring
      this.startHealthChecking();

      // Start metrics collection
      if (this.config.enableMetrics) {
        this.startMetricsCollection();
      }

      logger.info('Database connection pool initialized successfully');

    } catch (error) {
      logger.error('Failed to initialize database connection pool', error as Error);
      throw error;
    }
  }

  private async createInitialConnections(): Promise<void> {
    const promises = [];
    
    for (let i = 0; i < this.config.minConnections; i++) {
      promises.push(this.createConnection());
    }

    await Promise.all(promises);
  }

  // ============================================================================
  // CONNECTION MANAGEMENT
  // ============================================================================

  private async createConnection(): Promise<DatabaseConnectionInfo> {
    const traceId = await performanceMonitor.startTrace('db_pool_create_connection', 'database');

    try {
      const id = `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Initialize Firebase app if not already done
      let app: App;
      const existingApps = getApps();
      
      if (existingApps.length === 0) {
        app = initializeApp();
      } else {
        app = existingApps[0];
      }

      // Create Firestore instance with optimized settings
      const firestore = getFirestore(app);
      
      const settings: Settings = {
        // Connection settings
        maxIdleChannels: this.config.maxConnections,
        keepAliveIntervalMillis: 30000,
        keepAliveTimeoutMillis: 5000,
        
        // Performance settings
        ignoreUndefinedProperties: true,
        
        // Retry settings
        // Note: Firestore Admin SDK handles retries internally
      };

      firestore.settings(settings);

      const connectionInfo: DatabaseConnectionInfo = {
        id,
        firestore,
        createdAt: new Date(),
        lastUsed: new Date(),
        requestCount: 0,
        isHealthy: true,
        responseTime: 0
      };

      // Test the connection
      await this.testConnection(connectionInfo);

      this.connections.set(id, connectionInfo);
      this.availableConnections.push(id);
      this.stats.totalConnections++;

      await performanceMonitor.endTrace(traceId, 'success', { connectionId: id });

      logger.info('Database connection created', { connectionId: id });

      return connectionInfo;

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });

      logger.error('Failed to create database connection', error as Error);
      throw error;
    }
  }

  private async testConnection(connection: DatabaseConnectionInfo): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Simple health check query
      await connection.firestore.collection('_health_check').limit(1).get();
      
      connection.responseTime = Date.now() - startTime;
      connection.isHealthy = true;

    } catch (error) {
      connection.responseTime = Date.now() - startTime;
      connection.isHealthy = false;
      
      logger.warn('Connection health check failed', {
        connectionId: connection.id,
        error: (error as Error).message
      });

      throw error;
    }
  }

  // ============================================================================
  // CONNECTION ACQUISITION
  // ============================================================================

  async getConnection(): Promise<DatabaseConnectionInfo> {
    const requestStartTime = Date.now();
    this.stats.totalRequests++;
    this.stats.waitingRequests++;

    const traceId = await performanceMonitor.startTrace('db_pool_get_connection', 'database');

    try {
      // Check if we have available connections
      if (this.availableConnections.length > 0) {
        const connectionId = this.availableConnections.shift()!;
        const connection = this.connections.get(connectionId)!;
        
        this.activeConnections.add(connectionId);
        connection.lastUsed = new Date();
        connection.requestCount++;
        
        this.updateStats();

        await performanceMonitor.endTrace(traceId, 'success', {
          connectionId,
          waitTime: Date.now() - requestStartTime
        });

        this.stats.waitingRequests--;
        return connection;
      }

      // If we can create more connections, create one
      if (this.connections.size < this.config.maxConnections) {
        const connection = await this.createConnection();
        const connectionId = connection.id;
        
        // Remove from available and add to active
        const index = this.availableConnections.indexOf(connectionId);
        if (index > -1) {
          this.availableConnections.splice(index, 1);
        }
        
        this.activeConnections.add(connectionId);
        connection.lastUsed = new Date();
        connection.requestCount++;
        
        this.updateStats();

        await performanceMonitor.endTrace(traceId, 'success', {
          connectionId,
          waitTime: Date.now() - requestStartTime,
          newConnection: true
        });

        this.stats.waitingRequests--;
        return connection;
      }

      // Wait for an available connection
      const connection = await this.waitForConnection();
      
      await performanceMonitor.endTrace(traceId, 'success', {
        connectionId: connection.id,
        waitTime: Date.now() - requestStartTime,
        waited: true
      });

      this.stats.waitingRequests--;
      return connection;

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message,
        waitTime: Date.now() - requestStartTime
      });

      this.stats.failedRequests++;
      this.stats.waitingRequests--;
      
      logger.error('Failed to acquire database connection', error as Error);
      throw error;
    }
  }

  private async waitForConnection(): Promise<DatabaseConnectionInfo> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        // Remove from waiting queue
        const index = this.waitingQueue.findIndex(item => item.resolve === resolve);
        if (index > -1) {
          this.waitingQueue.splice(index, 1);
        }
        
        reject(new Error('Connection timeout: No connections available'));
      }, this.config.connectionTimeout);

      this.waitingQueue.push({
        resolve: (connection) => {
          clearTimeout(timeout);
          resolve(connection);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
        requestedAt: new Date()
      });
    });
  }

  // ============================================================================
  // CONNECTION RELEASE
  // ============================================================================

  releaseConnection(connection: DatabaseConnectionInfo): void {
    const connectionId = connection.id;
    
    if (!this.activeConnections.has(connectionId)) {
      logger.warn('Attempting to release connection that is not active', {
        connectionId
      });
      return;
    }

    this.activeConnections.delete(connectionId);
    
    // Check if connection is still healthy
    if (connection.isHealthy) {
      this.availableConnections.push(connectionId);
      
      // Process waiting queue
      this.processWaitingQueue();
    } else {
      // Remove unhealthy connection
      this.connections.delete(connectionId);
      this.stats.totalConnections--;
      
      logger.info('Removed unhealthy connection', { connectionId });
      
      // Create a new connection if we're below minimum
      if (this.connections.size < this.config.minConnections) {
        this.createConnection().catch(error => {
          logger.error('Failed to create replacement connection', error);
        });
      }
    }

    this.updateStats();
  }

  private processWaitingQueue(): void {
    if (this.waitingQueue.length > 0 && this.availableConnections.length > 0) {
      const waiter = this.waitingQueue.shift()!;
      const connectionId = this.availableConnections.shift()!;
      const connection = this.connections.get(connectionId)!;
      
      this.activeConnections.add(connectionId);
      connection.lastUsed = new Date();
      connection.requestCount++;
      
      waiter.resolve(connection);
      
      this.updateStats();
    }
  }

  // ============================================================================
  // HEALTH MONITORING
  // ============================================================================

  private startHealthChecking(): void {
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthCheck();
    }, this.config.healthCheckInterval);
  }

  private async performHealthCheck(): Promise<void> {
    const traceId = await performanceMonitor.startTrace('db_pool_health_check', 'database');

    try {
      const healthPromises: Promise<void>[] = [];
      
      for (const [connectionId, connection] of this.connections.entries()) {
        if (!this.activeConnections.has(connectionId)) {
          healthPromises.push(this.checkConnectionHealth(connection));
        }
      }

      await Promise.allSettled(healthPromises);
      
      // Update overall health status
      const healthyConnections = Array.from(this.connections.values()).filter(conn => conn.isHealthy);
      const healthyPercentage = this.connections.size > 0 ? healthyConnections.length / this.connections.size : 1;
      
      if (healthyPercentage >= 0.8) {
        this.stats.healthStatus = 'healthy';
      } else if (healthyPercentage >= 0.5) {
        this.stats.healthStatus = 'degraded';
      } else {
        this.stats.healthStatus = 'unhealthy';
      }

      this.stats.lastHealthCheck = new Date();
      
      await performanceMonitor.endTrace(traceId, 'success', {
        totalConnections: this.connections.size,
        healthyConnections: healthyConnections.length,
        healthStatus: this.stats.healthStatus
      });

      // Record health metrics
      if (this.config.enableMetrics) {
        await metricsCollector.recordGauge('database.pool.healthy_connections', healthyConnections.length);
        await metricsCollector.recordGauge('database.pool.total_connections', this.connections.size);
      }

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });

      logger.error('Health check failed', error as Error);
    }
  }

  private async checkConnectionHealth(connection: DatabaseConnectionInfo): Promise<void> {
    try {
      await this.testConnection(connection);
    } catch (error) {
      logger.warn('Connection failed health check', {
        connectionId: connection.id,
        error: (error as Error).message
      });
    }
  }

  // ============================================================================
  // METRICS COLLECTION
  // ============================================================================

  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(async () => {
      await this.collectMetrics();
    }, this.config.metricsInterval);
  }

  private async collectMetrics(): Promise<void> {
    try {
      // Connection pool metrics
      await metricsCollector.recordGauge('database.pool.total_connections', this.stats.totalConnections);
      await metricsCollector.recordGauge('database.pool.active_connections', this.stats.activeConnections);
      await metricsCollector.recordGauge('database.pool.idle_connections', this.stats.idleConnections);
      await metricsCollector.recordGauge('database.pool.waiting_requests', this.stats.waitingRequests);
      
      // Performance metrics
      await metricsCollector.recordCounter('database.pool.total_requests', this.stats.totalRequests);
      await metricsCollector.recordCounter('database.pool.failed_requests', this.stats.failedRequests);
      await metricsCollector.recordGauge('database.pool.average_response_time', this.stats.averageResponseTime);
      
      // Health metrics
      await metricsCollector.recordGauge('database.pool.health_status', 
        this.stats.healthStatus === 'healthy' ? 1 : 
        this.stats.healthStatus === 'degraded' ? 0.5 : 0
      );

    } catch (error) {
      logger.error('Failed to collect connection pool metrics', error as Error);
    }
  }

  private updateStats(): void {
    this.stats.activeConnections = this.activeConnections.size;
    this.stats.idleConnections = this.availableConnections.length;
    
    // Calculate average response time
    const connections = Array.from(this.connections.values());
    if (connections.length > 0) {
      const totalResponseTime = connections.reduce((sum, conn) => sum + conn.responseTime, 0);
      this.stats.averageResponseTime = totalResponseTime / connections.length;
    }
  }

  // ============================================================================
  // CLEANUP AND SHUTDOWN
  // ============================================================================

  private async cleanupIdleConnections(): Promise<void> {
    const now = Date.now();
    const connectionsToRemove: string[] = [];

    for (const connectionId of this.availableConnections) {
      const connection = this.connections.get(connectionId);
      if (connection && (now - connection.lastUsed.getTime()) > this.config.idleTimeout) {
        connectionsToRemove.push(connectionId);
      }
    }

    // Keep minimum connections
    const canRemove = Math.max(0, this.connections.size - this.config.minConnections);
    const toRemove = connectionsToRemove.slice(0, canRemove);

    for (const connectionId of toRemove) {
      this.connections.delete(connectionId);
      const index = this.availableConnections.indexOf(connectionId);
      if (index > -1) {
        this.availableConnections.splice(index, 1);
      }
      this.stats.totalConnections--;
      
      logger.info('Removed idle connection', { connectionId });
    }
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    
    logger.info('Shutting down database connection pool');

    // Stop intervals
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }

    // Reject all waiting requests
    for (const waiter of this.waitingQueue) {
      waiter.reject(new Error('Connection pool shutting down'));
    }
    this.waitingQueue.length = 0;

    // Wait for active connections to finish (with timeout)
    const shutdownTimeout = 30000; // 30 seconds
    const startTime = Date.now();
    
    while (this.activeConnections.size > 0 && (Date.now() - startTime) < shutdownTimeout) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Force close remaining connections
    this.connections.clear();
    this.availableConnections.length = 0;
    this.activeConnections.clear();

    logger.info('Database connection pool shutdown complete');
  }

  // ============================================================================
  // PUBLIC INTERFACE
  // ============================================================================

  getStats(): ConnectionStats {
    return { ...this.stats };
  }

  getConnectionCount(): number {
    return this.connections.size;
  }

  getActiveConnectionCount(): number {
    return this.activeConnections.size;
  }

  getWaitingRequestCount(): number {
    return this.waitingQueue.length;
  }

  async executeWithConnection<T>(operation: (firestore: Firestore) => Promise<T>): Promise<T> {
    const connection = await this.getConnection();
    
    try {
      const result = await operation(connection.firestore);
      return result;
    } finally {
      this.releaseConnection(connection);
    }
  }

  // Start cleanup interval
  startCleanup(): void {
    setInterval(async () => {
      if (!this.isShuttingDown) {
        await this.cleanupIdleConnections();
      }
    }, this.config.idleTimeout / 2); // Check every half of idle timeout
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let connectionPool: DatabaseConnectionPool | null = null;

export function getConnectionPool(config?: Partial<ConnectionPoolConfig>): DatabaseConnectionPool {
  if (!connectionPool) {
    connectionPool = new DatabaseConnectionPool(config);
    
    // Start cleanup process
    connectionPool.startCleanup();
    
    // Handle graceful shutdown
    process.on('SIGTERM', async () => {
      if (connectionPool) {
        await connectionPool.shutdown();
      }
    });
    
    process.on('SIGINT', async () => {
      if (connectionPool) {
        await connectionPool.shutdown();
      }
    });
  }
  
  return connectionPool;
}

export default {
  DatabaseConnectionPool,
  getConnectionPool
};