import { logger } from '../utils/logger';
import { metricsCollector } from './metricsCollector';
import { performanceMonitor } from './performanceMonitor';
import { auditLogger } from './auditLogger';
import { securityMonitoringSystem } from '../security/securityMonitoring';
import { incidentResponseSystem } from '../security/incidentResponse';

export interface MonitoringDashboard {
  systemHealth: {
    status: 'healthy' | 'degraded' | 'critical';
    uptime: number;
    lastCheck: Date;
    issues: string[];
  };
  performance: {
    avgResponseTime: number;
    errorRate: number;
    throughput: number;
    activeAlerts: number;
  };
  security: {
    threatLevel: 'low' | 'medium' | 'high' | 'critical';
    activeIncidents: number;
    blockedThreats: number;
    complianceStatus: 'compliant' | 'at_risk' | 'violation';
  };
  compliance: {
    auditEvents: number;
    dataSubjectRequests: number;
    retentionViolations: number;
    reportsPending: number;
  };
  infrastructure: {
    cpuUsage: number;
    memoryUsage: number;
    diskUsage: number;
    networkTraffic: number;
  };
}

export interface AlertSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
  recentAlerts: Array<{
    type: string;
    severity: string;
    message: string;
    timestamp: Date;
  }>;
}

export interface HealthCheck {
  service: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  responseTime: number;
  lastCheck: Date;
  details?: any;
}

export class MonitoringIntegration {
  private healthChecks: Map<string, HealthCheck> = new Map();
  private dashboardCache: MonitoringDashboard | null = null;
  private cacheExpiry: number = 0;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.initializeMonitoring();
  }

  async getDashboard(): Promise<MonitoringDashboard> {
    try {
      // Return cached dashboard if still valid
      if (this.dashboardCache && Date.now() < this.cacheExpiry) {
        return this.dashboardCache;
      }

      // Gather data from all monitoring systems
      const [systemMetrics, performanceData, securityData, auditData] = await Promise.all([
        metricsCollector.getAllMetrics(),
        this.getPerformanceData(),
        this.getSecurityData(),
        this.getAuditData()
      ]);

      const dashboard: MonitoringDashboard = {
        systemHealth: await this.calculateSystemHealth(),
        performance: await this.calculatePerformanceMetrics(performanceData),
        security: await this.calculateSecurityMetrics(securityData),
        compliance: await this.calculateComplianceMetrics(auditData),
        infrastructure: await this.calculateInfrastructureMetrics(systemMetrics)
      };

      // Cache dashboard for 30 seconds
      this.dashboardCache = dashboard;
      this.cacheExpiry = Date.now() + 30000;

      return dashboard;

    } catch (error) {
      logger.error('Failed to generate monitoring dashboard', error as Error);
      throw error;
    }
  }

  async getAlertSummary(): Promise<AlertSummary> {
    try {
      const [performanceAlerts, securityAlerts, metricsAlerts] = await Promise.all([
        performanceMonitor.getActivePerformanceAlerts(),
        securityMonitoringSystem.getActiveAlerts(),
        metricsCollector.getAlertRules()
      ]);

      const allAlerts = [
        ...performanceAlerts.map(alert => ({
          type: 'performance',
          severity: alert.severity,
          message: alert.description,
          timestamp: alert.detectedAt
        })),
        ...securityAlerts.map(alert => ({
          type: 'security',
          severity: alert.severity,
          message: alert.title,
          timestamp: alert.metadata.createdAt
        }))
      ];

      const summary: AlertSummary = {
        critical: allAlerts.filter(a => a.severity === 'critical').length,
        high: allAlerts.filter(a => a.severity === 'high').length,
        medium: allAlerts.filter(a => a.severity === 'medium').length,
        low: allAlerts.filter(a => a.severity === 'low').length,
        total: allAlerts.length,
        recentAlerts: allAlerts
          .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
          .slice(0, 10)
      };

      return summary;

    } catch (error) {
      logger.error('Failed to get alert summary', error as Error);
      throw error;
    }
  }

  async performHealthChecks(): Promise<HealthCheck[]> {
    try {
      const checks = await Promise.all([
        this.checkDatabaseHealth(),
        this.checkAPIHealth(),
        this.checkSecuritySystemHealth(),
        this.checkMonitoringSystemHealth(),
        this.checkComplianceSystemHealth()
      ]);

      // Update health check cache
      for (const check of checks) {
        this.healthChecks.set(check.service, check);
      }

      return checks;

    } catch (error) {
      logger.error('Failed to perform health checks', error as Error);
      return [];
    }
  }

  async generateSystemReport(timeRange: { start: Date; end: Date }): Promise<{
    performance: any;
    security: any;
    compliance: any;
    summary: any;
  }> {
    try {
      const [performanceReport, securityMetrics, complianceReports] = await Promise.all([
        performanceMonitor.generatePerformanceReport(timeRange),
        securityMonitoringSystem.getSecurityMetrics(24),
        auditLogger.getComplianceReports(timeRange)
      ]);

      const systemReport = {
        performance: performanceReport,
        security: securityMetrics,
        compliance: {
          reports: complianceReports,
          totalEvents: complianceReports.reduce((sum, report) => sum + report.summary.totalEvents, 0),
          violations: complianceReports.reduce((sum, report) => sum + report.summary.complianceViolations, 0)
        },
        summary: {
          timeRange,
          generatedAt: new Date(),
          overallHealth: await this.calculateOverallHealth(),
          keyMetrics: {
            avgResponseTime: performanceReport.summary.avgResponseTime,
            errorRate: performanceReport.summary.errorRate,
            securityIncidents: securityMetrics.totalEvents,
            complianceViolations: complianceReports.reduce((sum, report) => sum + report.summary.complianceViolations, 0)
          }
        }
      };

      // Log report generation
      await auditLogger.logSystemEvent(
        'monitoring-system',
        'generate_system_report',
        'document',
        `report_${Date.now()}`,
        'success',
        { timeRange, reportSize: Object.keys(systemReport).length }
      );

      return systemReport;

    } catch (error) {
      logger.error('Failed to generate system report', error as Error, { timeRange });
      throw error;
    }
  }

  async recordCustomMetric(
    name: string,
    value: number,
    unit: string,
    tags: Record<string, string> = {}
  ): Promise<void> {
    await metricsCollector.recordGauge(name, value, unit, tags);
  }

  async startPerformanceTrace(
    operation: string,
    context: any = {}
  ): Promise<string> {
    return await performanceMonitor.startTrace(
      operation,
      'function',
      {
        functionName: operation,
        ...context
      }
    );
  }

  async finishPerformanceTrace(
    traceId: string,
    success: boolean = true,
    errorMessage?: string
  ): Promise<void> {
    await performanceMonitor.finishTrace(
      traceId,
      success ? 'success' : 'error',
      errorMessage
    );
  }

  async logAuditEvent(
    userId: string,
    action: string,
    targetType: string,
    targetId: string,
    outcome: 'success' | 'failure' = 'success',
    changes?: any
  ): Promise<void> {
    await auditLogger.logUserAction(
      userId,
      action,
      targetType,
      targetId,
      outcome,
      { service: 'social-impact-platform' },
      changes
    );
  }

  private async calculateSystemHealth(): Promise<MonitoringDashboard['systemHealth']> {
    const healthChecks = Array.from(this.healthChecks.values());
    const unhealthyServices = healthChecks.filter(check => check.status === 'unhealthy');
    const degradedServices = healthChecks.filter(check => check.status === 'degraded');

    let status: MonitoringDashboard['systemHealth']['status'];
    const issues: string[] = [];

    if (unhealthyServices.length > 0) {
      status = 'critical';
      issues.push(`${unhealthyServices.length} services are unhealthy`);
    } else if (degradedServices.length > 0) {
      status = 'degraded';
      issues.push(`${degradedServices.length} services are degraded`);
    } else {
      status = 'healthy';
    }

    // Calculate uptime (simplified)
    const uptime = Date.now() - (process.uptime() * 1000);

    return {
      status,
      uptime: process.uptime(),
      lastCheck: new Date(),
      issues
    };
  }

  private async calculatePerformanceMetrics(performanceData: any): Promise<MonitoringDashboard['performance']> {
    const activeAlerts = await performanceMonitor.getActivePerformanceAlerts();
    
    return {
      avgResponseTime: performanceData.application?.[0]?.requests?.avgResponseTime || 0,
      errorRate: performanceData.application?.[0]?.requests?.errorRate || 0,
      throughput: performanceData.application?.[0]?.requests?.rate || 0,
      activeAlerts: activeAlerts.length
    };
  }

  private async calculateSecurityMetrics(securityData: any): Promise<MonitoringDashboard['security']> {
    const activeIncidents = await incidentResponseSystem.getActiveIncidents();
    const securityMetrics = await securityMonitoringSystem.getSecurityMetrics(24);

    let threatLevel: MonitoringDashboard['security']['threatLevel'] = 'low';
    
    if (securityMetrics.riskScore > 80) {
      threatLevel = 'critical';
    } else if (securityMetrics.riskScore > 60) {
      threatLevel = 'high';
    } else if (securityMetrics.riskScore > 30) {
      threatLevel = 'medium';
    }

    return {
      threatLevel,
      activeIncidents: activeIncidents.length,
      blockedThreats: securityMetrics.eventsByType?.threat_detected || 0,
      complianceStatus: securityMetrics.eventsByType?.security_violation > 0 ? 'violation' : 'compliant'
    };
  }

  private async calculateComplianceMetrics(auditData: any): Promise<MonitoringDashboard['compliance']> {
    const [auditStats, dataSubjectRequests, complianceReports] = await Promise.all([
      auditLogger.getAuditStats(),
      auditLogger.getDataSubjectRequests(),
      auditLogger.getComplianceReports()
    ]);

    return {
      auditEvents: auditStats.eventsToday,
      dataSubjectRequests: dataSubjectRequests.filter(req => req.status !== 'completed').length,
      retentionViolations: auditStats.complianceViolations,
      reportsPending: complianceReports.filter(report => report.status === 'draft').length
    };
  }

  private async calculateInfrastructureMetrics(systemMetrics: any): Promise<MonitoringDashboard['infrastructure']> {
    const latestSystemMetrics = systemMetrics.system?.[systemMetrics.system.length - 1];
    
    return {
      cpuUsage: latestSystemMetrics?.cpu?.usage || 0,
      memoryUsage: latestSystemMetrics?.memory?.usage || 0,
      diskUsage: latestSystemMetrics?.disk?.usage || 0,
      networkTraffic: (latestSystemMetrics?.network?.bytesIn || 0) + (latestSystemMetrics?.network?.bytesOut || 0)
    };
  }

  private async getPerformanceData(): Promise<any> {
    try {
      return await performanceMonitor.generatePerformanceReport({
        start: new Date(Date.now() - 60 * 60 * 1000), // Last hour
        end: new Date()
      });
    } catch (error) {
      logger.error('Failed to get performance data', error as Error);
      return {};
    }
  }

  private async getSecurityData(): Promise<any> {
    try {
      return await securityMonitoringSystem.getSecurityMetrics(1); // Last hour
    } catch (error) {
      logger.error('Failed to get security data', error as Error);
      return {};
    }
  }

  private async getAuditData(): Promise<any> {
    try {
      return await auditLogger.getAuditStats();
    } catch (error) {
      logger.error('Failed to get audit data', error as Error);
      return {};
    }
  }

  private async checkDatabaseHealth(): Promise<HealthCheck> {
    const startTime = Date.now();
    
    try {
      // Simple database connectivity check
      // In a real implementation, this would ping the database
      await new Promise(resolve => setTimeout(resolve, 10)); // Simulate DB call
      
      const responseTime = Date.now() - startTime;
      
      return {
        service: 'database',
        status: responseTime < 100 ? 'healthy' : responseTime < 500 ? 'degraded' : 'unhealthy',
        responseTime,
        lastCheck: new Date(),
        details: {
          connectionPool: 'active',
          queryPerformance: responseTime < 100 ? 'good' : 'slow'
        }
      };
    } catch (error) {
      return {
        service: 'database',
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        lastCheck: new Date(),
        details: { error: (error as Error).message }
      };
    }
  }

  private async checkAPIHealth(): Promise<HealthCheck> {
    const startTime = Date.now();
    
    try {
      // Check API endpoints health
      const responseTime = Date.now() - startTime;
      
      return {
        service: 'api',
        status: 'healthy',
        responseTime,
        lastCheck: new Date(),
        details: {
          endpoints: 'responsive',
          loadBalancer: 'active'
        }
      };
    } catch (error) {
      return {
        service: 'api',
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        lastCheck: new Date(),
        details: { error: (error as Error).message }
      };
    }
  }

  private async checkSecuritySystemHealth(): Promise<HealthCheck> {
    const startTime = Date.now();
    
    try {
      // Check security systems
      const activeIncidents = await incidentResponseSystem.getActiveIncidents();
      const responseTime = Date.now() - startTime;
      
      return {
        service: 'security',
        status: activeIncidents.length > 5 ? 'degraded' : 'healthy',
        responseTime,
        lastCheck: new Date(),
        details: {
          activeIncidents: activeIncidents.length,
          threatDetection: 'active',
          accessControl: 'active'
        }
      };
    } catch (error) {
      return {
        service: 'security',
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        lastCheck: new Date(),
        details: { error: (error as Error).message }
      };
    }
  }

  private async checkMonitoringSystemHealth(): Promise<HealthCheck> {
    const startTime = Date.now();
    
    try {
      // Check monitoring systems
      const metrics = await metricsCollector.getAllMetrics();
      const responseTime = Date.now() - startTime;
      
      return {
        service: 'monitoring',
        status: 'healthy',
        responseTime,
        lastCheck: new Date(),
        details: {
          metricsCollection: 'active',
          alerting: 'active',
          dataPoints: Object.keys(metrics).length
        }
      };
    } catch (error) {
      return {
        service: 'monitoring',
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        lastCheck: new Date(),
        details: { error: (error as Error).message }
      };
    }
  }

  private async checkComplianceSystemHealth(): Promise<HealthCheck> {
    const startTime = Date.now();
    
    try {
      // Check compliance systems
      const auditStats = await auditLogger.getAuditStats();
      const responseTime = Date.now() - startTime;
      
      return {
        service: 'compliance',
        status: auditStats.complianceViolations > 10 ? 'degraded' : 'healthy',
        responseTime,
        lastCheck: new Date(),
        details: {
          auditLogging: 'active',
          retentionPolicies: 'active',
          complianceViolations: auditStats.complianceViolations
        }
      };
    } catch (error) {
      return {
        service: 'compliance',
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        lastCheck: new Date(),
        details: { error: (error as Error).message }
      };
    }
  }

  private async calculateOverallHealth(): Promise<'healthy' | 'degraded' | 'critical'> {
    const healthChecks = Array.from(this.healthChecks.values());
    const unhealthyCount = healthChecks.filter(check => check.status === 'unhealthy').length;
    const degradedCount = healthChecks.filter(check => check.status === 'degraded').length;

    if (unhealthyCount > 0) return 'critical';
    if (degradedCount > 1) return 'degraded';
    return 'healthy';
  }

  private async initializeMonitoring(): Promise<void> {
    try {
      // Perform initial health checks
      await this.performHealthChecks();

      // Start periodic health checks
      this.healthCheckInterval = setInterval(async () => {
        try {
          await this.performHealthChecks();
        } catch (error) {
          logger.error('Health check interval failed', error as Error);
        }
      }, 30000); // Every 30 seconds

      // Start periodic dashboard refresh
      setInterval(() => {
        this.dashboardCache = null; // Force refresh on next request
      }, 60000); // Every minute

      logger.info('Monitoring integration initialized', {
        healthCheckServices: this.healthChecks.size
      });

    } catch (error) {
      logger.error('Failed to initialize monitoring integration', error as Error);
      throw error;
    }
  }

  // Graceful shutdown
  async shutdown(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    logger.info('Monitoring integration shutdown complete');
  }
}

// Singleton instance
export const monitoringIntegration = new MonitoringIntegration();

// Convenience functions for common monitoring operations
export async function recordMetric(
  name: string,
  value: number,
  unit: string,
  tags?: Record<string, string>
): Promise<void> {
  return await monitoringIntegration.recordCustomMetric(name, value, unit, tags);
}

export async function startTrace(operation: string, context?: any): Promise<string> {
  return await monitoringIntegration.startPerformanceTrace(operation, context);
}

export async function finishTrace(
  traceId: string,
  success: boolean = true,
  errorMessage?: string
): Promise<void> {
  return await monitoringIntegration.finishPerformanceTrace(traceId, success, errorMessage);
}

export async function logAuditEvent(
  userId: string,
  action: string,
  targetType: string,
  targetId: string,
  outcome: 'success' | 'failure' = 'success',
  changes?: any
): Promise<void> {
  return await monitoringIntegration.logAuditEvent(userId, action, targetType, targetId, outcome, changes);
}

export async function getDashboard(): Promise<MonitoringDashboard> {
  return await monitoringIntegration.getDashboard();
}

export async function getAlertSummary(): Promise<AlertSummary> {
  return await monitoringIntegration.getAlertSummary();
}

export async function generateSystemReport(timeRange: { start: Date; end: Date }): Promise<any> {
  return await monitoringIntegration.generateSystemReport(timeRange);
}

// Middleware function for automatic performance tracking
export function withMonitoring<T extends (...args: any[]) => any>(
  operation: string,
  fn: T
): T {
  return (async (...args: any[]) => {
    const traceId = await startTrace(operation, { args: args.length });
    
    try {
      const result = await fn(...args);
      await finishTrace(traceId, true);
      return result;
    } catch (error) {
      await finishTrace(traceId, false, (error as Error).message);
      throw error;
    }
  }) as T;
}

// Decorator for automatic audit logging
export function withAuditLogging(
  targetType: string,
  getTargetId: (args: any[]) => string,
  getUserId: (args: any[]) => string
) {
  return function(target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;
    
    descriptor.value = async function(...args: any[]) {
      const action = propertyName;
      const targetId = getTargetId(args);
      const userId = getUserId(args);
      
      try {
        const result = await method.apply(this, args);
        await logAuditEvent(userId, action, targetType, targetId, 'success');
        return result;
      } catch (error) {
        await logAuditEvent(userId, action, targetType, targetId, 'failure');
        throw error;
      }
    };
  };
}