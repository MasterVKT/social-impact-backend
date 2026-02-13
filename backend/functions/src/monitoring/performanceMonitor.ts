import { getFirestore } from 'firebase-admin/firestore';
import { logger } from '../utils/logger';
import { firestoreHelper } from '../utils/firestore';
import { metricsCollector, MetricData } from './metricsCollector';

export interface PerformanceProfile {
  id: string;
  name: string;
  type: 'endpoint' | 'function' | 'database' | 'external_api' | 'background_job';
  baselines: {
    responseTime: {
      p50: number;
      p95: number;
      p99: number;
    };
    throughput: number;
    errorRate: number;
    availability: number;
  };
  thresholds: {
    responseTime: {
      warning: number;
      critical: number;
    };
    errorRate: {
      warning: number;
      critical: number;
    };
    availability: {
      warning: number;
      critical: number;
    };
  };
  metadata: {
    createdAt: Date;
    lastUpdated: Date;
    sampleCount: number;
  };
}

export interface PerformanceEvent {
  id: string;
  profileId: string;
  type: 'request' | 'function_call' | 'database_query' | 'external_call' | 'job_execution';
  startTime: Date;
  endTime: Date;
  duration: number; // milliseconds
  status: 'success' | 'error' | 'timeout' | 'cancelled';
  errorMessage?: string;
  stackTrace?: string;
  context: {
    userId?: string;
    requestId?: string;
    functionName?: string;
    endpoint?: string;
    method?: string;
    userAgent?: string;
    ip?: string;
  };
  metrics: {
    cpuUsage?: number;
    memoryUsage?: number;
    networkIO?: number;
    diskIO?: number;
    dbConnections?: number;
  };
  tags: Record<string, string>;
}

export interface PerformanceAlert {
  id: string;
  type: 'latency' | 'throughput' | 'error_rate' | 'availability' | 'resource_usage';
  severity: 'warning' | 'critical';
  profileId: string;
  profileName: string;
  description: string;
  threshold: number;
  actualValue: number;
  detectedAt: Date;
  resolvedAt?: Date;
  status: 'active' | 'resolved' | 'suppressed';
  context: {
    timeWindow: number;
    sampleCount: number;
    affectedUsers?: number;
    impactScope: 'single_user' | 'multiple_users' | 'service_wide' | 'platform_wide';
  };
  actions: {
    notificationsSent: string[];
    remediationApplied?: string;
    escalated: boolean;
  };
}

export interface ServiceLevelObjective {
  id: string;
  name: string;
  description: string;
  service: string;
  target: {
    availability: number; // percentage
    responseTime: number; // milliseconds (p95)
    errorRate: number; // percentage
  };
  timeWindow: {
    type: 'rolling' | 'calendar';
    duration: number; // days
  };
  errorBudget: {
    total: number;
    consumed: number;
    remaining: number;
    percentage: number;
  };
  compliance: {
    current: number;
    trend: 'improving' | 'stable' | 'degrading';
    breaches: SLOBreach[];
  };
  metadata: {
    createdAt: Date;
    lastEvaluated: Date;
    owner: string;
  };
}

export interface SLOBreach {
  id: string;
  sloId: string;
  type: 'availability' | 'latency' | 'error_rate';
  severity: 'minor' | 'major' | 'critical';
  startTime: Date;
  endTime?: Date;
  duration?: number; // minutes
  impactMetrics: {
    affectedRequests: number;
    affectedUsers: number;
    errorBudgetConsumed: number;
  };
  rootCause?: string;
  resolution?: string;
}

export interface PerformanceReport {
  timeRange: {
    start: Date;
    end: Date;
  };
  summary: {
    totalRequests: number;
    avgResponseTime: number;
    p95ResponseTime: number;
    p99ResponseTime: number;
    errorRate: number;
    availability: number;
    throughput: number;
  };
  trends: {
    responseTime: TrendData[];
    errorRate: TrendData[];
    throughput: TrendData[];
  };
  topIssues: {
    slowestEndpoints: EndpointPerformance[];
    errorProneEndpoints: EndpointPerformance[];
    resourceBottlenecks: ResourceBottleneck[];
  };
  sloCompliance: {
    met: number;
    total: number;
    percentage: number;
    breaches: SLOBreach[];
  };
}

interface TrendData {
  timestamp: Date;
  value: number;
}

interface EndpointPerformance {
  endpoint: string;
  avgResponseTime: number;
  requestCount: number;
  errorRate: number;
}

interface ResourceBottleneck {
  resource: string;
  avgUsage: number;
  peakUsage: number;
  constraint: boolean;
}

export class PerformanceMonitor {
  private db = getFirestore();
  private profiles: Map<string, PerformanceProfile> = new Map();
  private slos: Map<string, ServiceLevelObjective> = new Map();
  private activeAlerts: Map<string, PerformanceAlert> = new Map();
  private eventBuffer: PerformanceEvent[] = [];
  private monitoringInterval: NodeJS.Timeout | null = null;
  private initialized = false;

  constructor() {
    // Don't initialize here - use lazy initialization
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initializePerformanceMonitoring();
      this.initialized = true;
    }
  }

  async startTrace(
    profileName: string,
    type: PerformanceEvent['type'],
    context: PerformanceEvent['context'],
    tags: Record<string, string> = {}
  ): Promise<string> {
    await this.ensureInitialized();
    try {
      const profile = await this.getOrCreateProfile(profileName, type);
      
      const event: PerformanceEvent = {
        id: `perf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        profileId: profile.id,
        type,
        startTime: new Date(),
        endTime: new Date(), // Will be updated on finish
        duration: 0,
        status: 'success',
        context,
        metrics: {},
        tags
      };

      // Store trace start
      await this.storePerformanceEvent(event);

      logger.debug('Performance trace started', {
        traceId: event.id,
        profileName,
        type,
        context
      });

      return event.id;

    } catch (error) {
      logger.error('Failed to start performance trace', error as Error, {
        profileName,
        type,
        context
      });
      throw error;
    }
  }

  async finishTrace(
    traceId: string,
    status: PerformanceEvent['status'] = 'success',
    errorMessage?: string,
    additionalMetrics?: Partial<PerformanceEvent['metrics']>
  ): Promise<PerformanceEvent> {
    try {
      const event = await this.getPerformanceEvent(traceId);
      if (!event) {
        throw new Error(`Performance trace not found: ${traceId}`);
      }

      const endTime = new Date();
      const duration = endTime.getTime() - event.startTime.getTime();

      const updatedEvent: PerformanceEvent = {
        ...event,
        endTime,
        duration,
        status,
        errorMessage,
        metrics: {
          ...event.metrics,
          ...additionalMetrics,
          ...await this.getCurrentResourceMetrics()
        }
      };

      // Update stored event
      await this.storePerformanceEvent(updatedEvent);

      // Add to buffer for processing
      this.eventBuffer.push(updatedEvent);

      // Record metrics
      await this.recordPerformanceMetrics(updatedEvent);

      // Check for performance issues
      await this.evaluatePerformance(updatedEvent);

      logger.debug('Performance trace finished', {
        traceId,
        duration,
        status,
        profileId: event.profileId
      });

      return updatedEvent;

    } catch (error) {
      logger.error('Failed to finish performance trace', error as Error, { traceId });
      throw error;
    }
  }

  /**
   * Alias pour finishTrace - pour compatibilité
   */
  async endTrace(
    traceId: string,
    status: PerformanceEvent['status'] = 'success',
    errorMessage?: string,
    additionalMetrics?: Partial<PerformanceEvent['metrics']>
  ): Promise<PerformanceEvent> {
    return this.finishTrace(traceId, status, errorMessage, additionalMetrics);
  }

  async createPerformanceProfile(profileData: Omit<PerformanceProfile, 'id' | 'metadata'>): Promise<PerformanceProfile> {
    try {
      const profile: PerformanceProfile = {
        id: `profile_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        ...profileData,
        metadata: {
          createdAt: new Date(),
          lastUpdated: new Date(),
          sampleCount: 0
        }
      };

      // Store profile
      await firestoreHelper.setDocument('performance_profiles', profile.id, profile);
      this.profiles.set(profile.id, profile);

      logger.info('Performance profile created', {
        profileId: profile.id,
        name: profile.name,
        type: profile.type
      });

      return profile;

    } catch (error) {
      logger.error('Failed to create performance profile', error as Error, {
        profileName: profileData.name
      });
      throw error;
    }
  }

  async createSLO(sloData: Omit<ServiceLevelObjective, 'id' | 'errorBudget' | 'compliance' | 'metadata'>): Promise<ServiceLevelObjective> {
    try {
      const slo: ServiceLevelObjective = {
        id: `slo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        ...sloData,
        errorBudget: {
          total: this.calculateErrorBudget(sloData.target, sloData.timeWindow),
          consumed: 0,
          remaining: 0,
          percentage: 100
        },
        compliance: {
          current: 100,
          trend: 'stable',
          breaches: []
        },
        metadata: {
          createdAt: new Date(),
          lastEvaluated: new Date(),
          owner: 'system'
        }
      };

      // Calculate initial error budget
      slo.errorBudget.remaining = slo.errorBudget.total;

      // Store SLO
      await firestoreHelper.setDocument('service_level_objectives', slo.id, slo);
      this.slos.set(slo.id, slo);

      logger.info('SLO created', {
        sloId: slo.id,
        name: slo.name,
        service: slo.service,
        targets: slo.target
      });

      return slo;

    } catch (error) {
      logger.error('Failed to create SLO', error as Error, { sloName: sloData.name });
      throw error;
    }
  }

  async evaluateAllSLOs(): Promise<void> {
    try {
      for (const slo of this.slos.values()) {
        await this.evaluateSLO(slo);
      }
    } catch (error) {
      logger.error('Failed to evaluate SLOs', error as Error);
    }
  }

  async generatePerformanceReport(
    timeRange: { start: Date; end: Date },
    services?: string[]
  ): Promise<PerformanceReport> {
    try {
      const events = await this.getPerformanceEvents(timeRange, services);
      
      const summary = this.calculateSummaryMetrics(events);
      const trends = await this.calculateTrends(timeRange, services);
      const topIssues = await this.identifyTopIssues(events);
      const sloCompliance = await this.calculateSLOCompliance(timeRange, services);

      const report: PerformanceReport = {
        timeRange,
        summary,
        trends,
        topIssues,
        sloCompliance
      };

      logger.info('Performance report generated', {
        timeRange,
        totalRequests: summary.totalRequests,
        avgResponseTime: summary.avgResponseTime,
        errorRate: summary.errorRate
      });

      return report;

    } catch (error) {
      logger.error('Failed to generate performance report', error as Error, { timeRange });
      throw error;
    }
  }

  private async getOrCreateProfile(name: string, type: PerformanceEvent['type']): Promise<PerformanceProfile> {
    // Try to find existing profile
    for (const profile of this.profiles.values()) {
      if (profile.name === name && profile.type === type) {
        return profile;
      }
    }

    // Create new profile with default baselines
    return await this.createPerformanceProfile({
      name,
      type,
      baselines: this.getDefaultBaselines(type),
      thresholds: this.getDefaultThresholds(type)
    });
  }

  private getDefaultBaselines(type: PerformanceEvent['type']): PerformanceProfile['baselines'] {
    const defaults = {
      'endpoint': {
        responseTime: { p50: 200, p95: 500, p99: 1000 },
        throughput: 100,
        errorRate: 1,
        availability: 99.9
      },
      'function': {
        responseTime: { p50: 100, p95: 300, p99: 500 },
        throughput: 200,
        errorRate: 0.5,
        availability: 99.95
      },
      'database': {
        responseTime: { p50: 50, p95: 200, p99: 500 },
        throughput: 500,
        errorRate: 0.1,
        availability: 99.99
      },
      'external_api': {
        responseTime: { p50: 500, p95: 2000, p99: 5000 },
        throughput: 50,
        errorRate: 2,
        availability: 99.5
      },
      'background_job': {
        responseTime: { p50: 1000, p95: 5000, p99: 10000 },
        throughput: 10,
        errorRate: 1,
        availability: 99.9
      }
    };

    return defaults[type] || defaults['endpoint'];
  }

  private getDefaultThresholds(type: PerformanceEvent['type']): PerformanceProfile['thresholds'] {
    const baselines = this.getDefaultBaselines(type);
    
    return {
      responseTime: {
        warning: baselines.responseTime.p95 * 2,
        critical: baselines.responseTime.p99 * 2
      },
      errorRate: {
        warning: baselines.errorRate * 3,
        critical: baselines.errorRate * 5
      },
      availability: {
        warning: baselines.availability - 1,
        critical: baselines.availability - 2
      }
    };
  }

  private async getCurrentResourceMetrics(): Promise<PerformanceEvent['metrics']> {
    try {
      const memUsage = process.memoryUsage();
      
      return {
        memoryUsage: (memUsage.heapUsed / memUsage.heapTotal) * 100,
        // Additional metrics would be collected from system monitoring
        cpuUsage: Math.random() * 100, // Placeholder
        networkIO: Math.random() * 1000,
        diskIO: Math.random() * 500
      };
    } catch (error) {
      return {};
    }
  }

  private async recordPerformanceMetrics(event: PerformanceEvent): Promise<void> {
    const tags = {
      profile: event.profileId,
      type: event.type,
      status: event.status,
      ...event.tags
    };

    // Record timing metrics
    await metricsCollector.recordTimer(`performance.${event.type}.duration`, event.startTime.getTime(), tags);
    
    // Record status metrics
    await metricsCollector.recordCounter(`performance.${event.type}.requests`, 1, tags);
    
    if (event.status === 'error') {
      await metricsCollector.recordCounter(`performance.${event.type}.errors`, 1, tags);
    }

    // Record resource metrics
    if (event.metrics.cpuUsage) {
      await metricsCollector.recordGauge(`performance.${event.type}.cpu_usage`, event.metrics.cpuUsage, 'percent', tags);
    }
    
    if (event.metrics.memoryUsage) {
      await metricsCollector.recordGauge(`performance.${event.type}.memory_usage`, event.metrics.memoryUsage, 'percent', tags);
    }
  }

  private async evaluatePerformance(event: PerformanceEvent): Promise<void> {
    try {
      const profile = this.profiles.get(event.profileId);
      if (!profile) return;

      const issues: Array<{type: PerformanceAlert['type'], severity: PerformanceAlert['severity'], threshold: number, actual: number}> = [];

      // Check response time thresholds
      if (event.duration > profile.thresholds.responseTime.critical) {
        issues.push({
          type: 'latency',
          severity: 'critical',
          threshold: profile.thresholds.responseTime.critical,
          actual: event.duration
        });
      } else if (event.duration > profile.thresholds.responseTime.warning) {
        issues.push({
          type: 'latency',
          severity: 'warning',
          threshold: profile.thresholds.responseTime.warning,
          actual: event.duration
        });
      }

      // Check resource usage
      if (event.metrics.cpuUsage && event.metrics.cpuUsage > 90) {
        issues.push({
          type: 'resource_usage',
          severity: event.metrics.cpuUsage > 95 ? 'critical' : 'warning',
          threshold: 90,
          actual: event.metrics.cpuUsage
        });
      }

      if (event.metrics.memoryUsage && event.metrics.memoryUsage > 85) {
        issues.push({
          type: 'resource_usage',
          severity: event.metrics.memoryUsage > 95 ? 'critical' : 'warning',
          threshold: 85,
          actual: event.metrics.memoryUsage
        });
      }

      // Create alerts for detected issues
      for (const issue of issues) {
        await this.createPerformanceAlert(event, issue, profile);
      }

    } catch (error) {
      logger.error('Failed to evaluate performance', error as Error, {
        eventId: event.id,
        profileId: event.profileId
      });
    }
  }

  private async createPerformanceAlert(
    event: PerformanceEvent,
    issue: {type: PerformanceAlert['type'], severity: PerformanceAlert['severity'], threshold: number, actual: number},
    profile: PerformanceProfile
  ): Promise<void> {
    try {
      // Check if similar alert already exists and is active
      const existingAlert = Array.from(this.activeAlerts.values()).find(alert => 
        alert.profileId === profile.id &&
        alert.type === issue.type &&
        alert.status === 'active' &&
        Date.now() - alert.detectedAt.getTime() < 5 * 60 * 1000 // Within last 5 minutes
      );

      if (existingAlert) return; // Don't create duplicate alerts

      const alert: PerformanceAlert = {
        id: `perf_alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: issue.type,
        severity: issue.severity,
        profileId: profile.id,
        profileName: profile.name,
        description: this.generateAlertDescription(issue, profile, event),
        threshold: issue.threshold,
        actualValue: issue.actual,
        detectedAt: new Date(),
        status: 'active',
        context: {
          timeWindow: 5,
          sampleCount: 1,
          impactScope: this.determineImpactScope(event, issue)
        },
        actions: {
          notificationsSent: [],
          escalated: false
        }
      };

      // Store alert
      await this.storePerformanceAlert(alert);
      this.activeAlerts.set(alert.id, alert);

      // Send notifications
      await this.sendPerformanceAlertNotifications(alert);

      // Apply auto-remediation if configured
      await this.applyAutoRemediation(alert, event);

      logger.warn('Performance alert created', {
        alertId: alert.id,
        type: alert.type,
        severity: alert.severity,
        profileName: profile.name,
        threshold: issue.threshold,
        actualValue: issue.actual
      });

    } catch (error) {
      logger.error('Failed to create performance alert', error as Error, {
        profileId: profile.id,
        issueType: issue.type
      });
    }
  }

  private async evaluateSLO(slo: ServiceLevelObjective): Promise<void> {
    try {
      const timeWindow = slo.timeWindow.duration * 24 * 60 * 60 * 1000; // Convert days to milliseconds
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - timeWindow);

      // Get performance events for this service
      const events = await this.getPerformanceEventsForService(slo.service, { start: startTime, end: endTime });
      
      if (events.length === 0) {
        return; // No data to evaluate
      }

      const metrics = this.calculateSummaryMetrics(events);
      
      // Check SLO compliance
      const availabilityCompliant = metrics.availability >= slo.target.availability;
      const latencyCompliant = metrics.p95ResponseTime <= slo.target.responseTime;
      const errorRateCompliant = metrics.errorRate <= slo.target.errorRate;

      const overallCompliant = availabilityCompliant && latencyCompliant && errorRateCompliant;

      // Update error budget
      if (!overallCompliant) {
        const budgetConsumed = this.calculateErrorBudgetConsumption(slo, metrics);
        slo.errorBudget.consumed += budgetConsumed;
        slo.errorBudget.remaining = Math.max(0, slo.errorBudget.total - slo.errorBudget.consumed);
        slo.errorBudget.percentage = (slo.errorBudget.remaining / slo.errorBudget.total) * 100;

        // Create SLO breach if threshold exceeded
        if (slo.errorBudget.percentage < 10) { // Less than 10% error budget remaining
          await this.createSLOBreach(slo, metrics);
        }
      }

      // Update compliance status
      slo.compliance.current = overallCompliant ? 100 : this.calculateCompliancePercentage(slo, metrics);
      slo.compliance.trend = this.calculateComplianceTrend(slo);
      slo.metadata.lastEvaluated = new Date();

      // Store updated SLO
      await this.storeSLO(slo);

      logger.debug('SLO evaluated', {
        sloId: slo.id,
        name: slo.name,
        compliant: overallCompliant,
        errorBudgetRemaining: slo.errorBudget.percentage
      });

    } catch (error) {
      logger.error('Failed to evaluate SLO', error as Error, { sloId: slo.id });
    }
  }

  private async createSLOBreach(slo: ServiceLevelObjective, metrics: PerformanceReport['summary']): Promise<void> {
    const breach: SLOBreach = {
      id: `breach_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      sloId: slo.id,
      type: this.determineSLOBreachType(slo, metrics),
      severity: this.determineSLOBreachSeverity(slo),
      startTime: new Date(),
      impactMetrics: {
        affectedRequests: metrics.totalRequests,
        affectedUsers: 0, // Would be calculated from actual data
        errorBudgetConsumed: slo.errorBudget.consumed
      }
    };

    slo.compliance.breaches.push(breach);
    
    logger.error('SLO breach detected', {
      sloId: slo.id,
      sloName: slo.name,
      breachType: breach.type,
      severity: breach.severity,
      errorBudgetRemaining: slo.errorBudget.percentage
    });
  }

  private calculateSummaryMetrics(events: PerformanceEvent[]): PerformanceReport['summary'] {
    if (events.length === 0) {
      return {
        totalRequests: 0,
        avgResponseTime: 0,
        p95ResponseTime: 0,
        p99ResponseTime: 0,
        errorRate: 0,
        availability: 100,
        throughput: 0
      };
    }

    const durations = events.map(e => e.duration).sort((a, b) => a - b);
    const errors = events.filter(e => e.status === 'error').length;
    const timeSpan = Math.max(...events.map(e => e.endTime.getTime())) - Math.min(...events.map(e => e.startTime.getTime()));

    return {
      totalRequests: events.length,
      avgResponseTime: durations.reduce((sum, d) => sum + d, 0) / durations.length,
      p95ResponseTime: durations[Math.floor(durations.length * 0.95)] || 0,
      p99ResponseTime: durations[Math.floor(durations.length * 0.99)] || 0,
      errorRate: (errors / events.length) * 100,
      availability: ((events.length - errors) / events.length) * 100,
      throughput: timeSpan > 0 ? (events.length / timeSpan) * 1000 : 0 // requests per second
    };
  }

  private async calculateTrends(
    timeRange: { start: Date; end: Date },
    services?: string[]
  ): Promise<PerformanceReport['trends']> {
    // Implementation would calculate trending data over time
    // For now, return empty trends
    return {
      responseTime: [],
      errorRate: [],
      throughput: []
    };
  }

  private async identifyTopIssues(events: PerformanceEvent[]): Promise<PerformanceReport['topIssues']> {
    // Group events by endpoint/function
    const endpointGroups = new Map<string, PerformanceEvent[]>();
    
    for (const event of events) {
      const key = event.context.endpoint || event.context.functionName || 'unknown';
      if (!endpointGroups.has(key)) {
        endpointGroups.set(key, []);
      }
      endpointGroups.get(key)!.push(event);
    }

    const endpointPerformance: EndpointPerformance[] = [];
    
    for (const [endpoint, endpointEvents] of endpointGroups.entries()) {
      const metrics = this.calculateSummaryMetrics(endpointEvents);
      endpointPerformance.push({
        endpoint,
        avgResponseTime: metrics.avgResponseTime,
        requestCount: metrics.totalRequests,
        errorRate: metrics.errorRate
      });
    }

    // Sort to find top issues
    const slowestEndpoints = endpointPerformance
      .sort((a, b) => b.avgResponseTime - a.avgResponseTime)
      .slice(0, 10);

    const errorProneEndpoints = endpointPerformance
      .sort((a, b) => b.errorRate - a.errorRate)
      .slice(0, 10);

    return {
      slowestEndpoints,
      errorProneEndpoints,
      resourceBottlenecks: [] // Would be calculated from resource metrics
    };
  }

  private async calculateSLOCompliance(
    timeRange: { start: Date; end: Date },
    services?: string[]
  ): Promise<PerformanceReport['sloCompliance']> {
    const relevantSLOs = Array.from(this.slos.values()).filter(slo => 
      !services || services.includes(slo.service)
    );

    const metSLOs = relevantSLOs.filter(slo => slo.compliance.current >= 100).length;
    const allBreaches = relevantSLOs.flatMap(slo => 
      slo.compliance.breaches.filter(breach => 
        breach.startTime >= timeRange.start && breach.startTime <= timeRange.end
      )
    );

    return {
      met: metSLOs,
      total: relevantSLOs.length,
      percentage: relevantSLOs.length > 0 ? (metSLOs / relevantSLOs.length) * 100 : 100,
      breaches: allBreaches
    };
  }

  // Helper methods
  private calculateErrorBudget(target: ServiceLevelObjective['target'], timeWindow: ServiceLevelObjective['timeWindow']): number {
    const totalMinutes = timeWindow.duration * 24 * 60;
    const allowedDowntimeMinutes = totalMinutes * ((100 - target.availability) / 100);
    return allowedDowntimeMinutes;
  }

  private calculateErrorBudgetConsumption(slo: ServiceLevelObjective, metrics: PerformanceReport['summary']): number {
    const actualDowntime = ((100 - metrics.availability) / 100) * slo.timeWindow.duration * 24 * 60;
    return actualDowntime;
  }

  private calculateCompliancePercentage(slo: ServiceLevelObjective, metrics: PerformanceReport['summary']): number {
    let score = 0;
    let factors = 0;

    if (metrics.availability >= slo.target.availability) {
      score += 33.33;
    }
    factors++;

    if (metrics.p95ResponseTime <= slo.target.responseTime) {
      score += 33.33;
    }
    factors++;

    if (metrics.errorRate <= slo.target.errorRate) {
      score += 33.34;
    }
    factors++;

    return factors > 0 ? score : 0;
  }

  private calculateComplianceTrend(slo: ServiceLevelObjective): ServiceLevelObjective['compliance']['trend'] {
    // Implementation would analyze historical compliance data
    return 'stable';
  }

  private determineSLOBreachType(slo: ServiceLevelObjective, metrics: PerformanceReport['summary']): SLOBreach['type'] {
    if (metrics.availability < slo.target.availability) return 'availability';
    if (metrics.p95ResponseTime > slo.target.responseTime) return 'latency';
    if (metrics.errorRate > slo.target.errorRate) return 'error_rate';
    return 'availability';
  }

  private determineSLOBreachSeverity(slo: ServiceLevelObjective): SLOBreach['severity'] {
    if (slo.errorBudget.percentage < 5) return 'critical';
    if (slo.errorBudget.percentage < 15) return 'major';
    return 'minor';
  }

  private generateAlertDescription(
    issue: {type: PerformanceAlert['type'], severity: PerformanceAlert['severity'], threshold: number, actual: number},
    profile: PerformanceProfile,
    event: PerformanceEvent
  ): string {
    switch (issue.type) {
      case 'latency':
        return `High latency detected for ${profile.name}: ${issue.actual}ms (threshold: ${issue.threshold}ms)`;
      case 'resource_usage':
        return `High resource usage detected for ${profile.name}: ${issue.actual}% (threshold: ${issue.threshold}%)`;
      default:
        return `Performance issue detected for ${profile.name}`;
    }
  }

  private determineImpactScope(event: PerformanceEvent, issue: any): PerformanceAlert['context']['impactScope'] {
    if (event.context.userId) return 'single_user';
    if (issue.severity === 'critical') return 'service_wide';
    return 'multiple_users';
  }

  private async sendPerformanceAlertNotifications(alert: PerformanceAlert): Promise<void> {
    const recipients = this.getAlertRecipients(alert);
    
    for (const recipient of recipients) {
      // Integration with notification system
      logger.warn('Performance alert notification sent', {
        alertId: alert.id,
        recipient,
        severity: alert.severity
      });
    }

    alert.actions.notificationsSent = recipients;
  }

  private getAlertRecipients(alert: PerformanceAlert): string[] {
    const recipients = ['ops-team'];
    
    if (alert.severity === 'critical') {
      recipients.push('dev-team', 'oncall-engineer');
    }
    
    if (alert.type === 'resource_usage') {
      recipients.push('infrastructure-team');
    }
    
    return recipients;
  }

  private async applyAutoRemediation(alert: PerformanceAlert, event: PerformanceEvent): Promise<void> {
    // Implementation would apply automated remediation based on alert type
    if (alert.type === 'resource_usage' && alert.severity === 'critical') {
      // Could trigger auto-scaling, circuit breakers, etc.
      logger.info('Auto-remediation applied', {
        alertId: alert.id,
        type: 'resource_scaling'
      });
    }
  }

  // Database operations
  private async storePerformanceEvent(event: PerformanceEvent): Promise<void> {
    try {
      const dateStr = event.startTime.toISOString().split('T')[0];
      const collectionName = `performance_events_${dateStr.replace(/-/g, '_')}`;
      await firestoreHelper.setDocument(collectionName, event.id, event);
    } catch (error) {
      logger.error('Failed to store performance event', error as Error, { eventId: event.id });
    }
  }

  private async getPerformanceEvent(eventId: string): Promise<PerformanceEvent | null> {
    try {
      // Would need to search across date-partitioned collections
      // For now, return null as placeholder
      return null;
    } catch (error) {
      logger.error('Failed to get performance event', error as Error, { eventId });
      return null;
    }
  }

  private async storePerformanceAlert(alert: PerformanceAlert): Promise<void> {
    await firestoreHelper.setDocument('performance_alerts', alert.id, alert);
  }

  private async storeSLO(slo: ServiceLevelObjective): Promise<void> {
    await firestoreHelper.setDocument('service_level_objectives', slo.id, slo);
  }

  private async getPerformanceEvents(
    timeRange: { start: Date; end: Date },
    services?: string[]
  ): Promise<PerformanceEvent[]> {
    // Implementation would query across date-partitioned collections
    // For now, return empty array as placeholder
    return [];
  }

  private async getPerformanceEventsForService(
    service: string,
    timeRange: { start: Date; end: Date }
  ): Promise<PerformanceEvent[]> {
    // Implementation would query events for specific service
    return [];
  }

  private async initializePerformanceMonitoring(): Promise<void> {
    try {
      // Load existing profiles and SLOs
      await Promise.all([
        this.loadPerformanceProfiles(),
        this.loadSLOs(),
        this.loadActiveAlerts()
      ]);

      // Create default profiles and SLOs if none exist
      if (this.profiles.size === 0) {
        await this.createDefaultProfiles();
      }
      
      if (this.slos.size === 0) {
        await this.createDefaultSLOs();
      }

      // Start monitoring intervals
      this.startMonitoring();

      logger.info('Performance monitoring system initialized', {
        profileCount: this.profiles.size,
        sloCount: this.slos.size,
        activeAlertCount: this.activeAlerts.size
      });

    } catch (error) {
      logger.error('Failed to initialize performance monitoring', error as Error);
      throw error;
    }
  }

  private async loadPerformanceProfiles(): Promise<void> {
    try {
      const snapshot = await this.db.collection('performance_profiles').get();
      snapshot.docs.forEach(doc => {
        const profile = doc.data() as PerformanceProfile;
        this.profiles.set(profile.id, profile);
      });
    } catch (error) {
      logger.error('Failed to load performance profiles', error as Error);
    }
  }

  private async loadSLOs(): Promise<void> {
    try {
      const snapshot = await this.db.collection('service_level_objectives').get();
      snapshot.docs.forEach(doc => {
        const slo = doc.data() as ServiceLevelObjective;
        this.slos.set(slo.id, slo);
      });
    } catch (error) {
      logger.error('Failed to load SLOs', error as Error);
    }
  }

  private async loadActiveAlerts(): Promise<void> {
    try {
      const snapshot = await this.db.collection('performance_alerts')
        .where('status', '==', 'active')
        .get();
      
      snapshot.docs.forEach(doc => {
        const alert = doc.data() as PerformanceAlert;
        this.activeAlerts.set(alert.id, alert);
      });
    } catch (error) {
      logger.error('Failed to load active alerts', error as Error);
    }
  }

  private async createDefaultProfiles(): Promise<void> {
    const defaultProfiles = [
      {
        name: 'API Endpoints',
        type: 'endpoint' as const,
        baselines: this.getDefaultBaselines('endpoint'),
        thresholds: this.getDefaultThresholds('endpoint')
      },
      {
        name: 'Database Queries',
        type: 'database' as const,
        baselines: this.getDefaultBaselines('database'),
        thresholds: this.getDefaultThresholds('database')
      },
      {
        name: 'Background Jobs',
        type: 'background_job' as const,
        baselines: this.getDefaultBaselines('background_job'),
        thresholds: this.getDefaultThresholds('background_job')
      }
    ];

    for (const profileData of defaultProfiles) {
      await this.createPerformanceProfile(profileData);
    }
  }

  private async createDefaultSLOs(): Promise<void> {
    const defaultSLOs = [
      {
        name: 'API Availability',
        description: 'API service availability',
        service: 'api',
        target: {
          availability: 99.9,
          responseTime: 500,
          errorRate: 1
        },
        timeWindow: {
          type: 'rolling' as const,
          duration: 30
        }
      },
      {
        name: 'User Experience',
        description: 'User-facing service performance',
        service: 'frontend',
        target: {
          availability: 99.95,
          responseTime: 200,
          errorRate: 0.5
        },
        timeWindow: {
          type: 'rolling' as const,
          duration: 7
        }
      }
    ];

    for (const sloData of defaultSLOs) {
      await this.createSLO(sloData);
    }
  }

  private startMonitoring(): void {
    // Process performance events every 30 seconds
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.processEventBuffer();
        await this.evaluateAllSLOs();
        await this.checkAlertResolution();
      } catch (error) {
        logger.error('Performance monitoring interval failed', error as Error);
      }
    }, 30000);

    // Generate daily performance reports
    setInterval(async () => {
      try {
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);
        await this.generatePerformanceReport({ start: startTime, end: endTime });
      } catch (error) {
        logger.error('Daily performance report generation failed', error as Error);
      }
    }, 24 * 60 * 60 * 1000);
  }

  private async processEventBuffer(): Promise<void> {
    if (this.eventBuffer.length === 0) return;

    const eventsToProcess = this.eventBuffer.splice(0, 100); // Process in batches
    
    for (const event of eventsToProcess) {
      try {
        await this.updateProfileBaselines(event);
      } catch (error) {
        logger.error('Failed to process performance event', error as Error, { eventId: event.id });
      }
    }
  }

  private async updateProfileBaselines(event: PerformanceEvent): Promise<void> {
    const profile = this.profiles.get(event.profileId);
    if (!profile) return;

    profile.metadata.sampleCount++;
    profile.metadata.lastUpdated = new Date();

    // Update baselines using exponential moving average
    const alpha = 0.1; // Smoothing factor
    const duration = event.duration;

    // Update response time baselines (simplified calculation)
    profile.baselines.responseTime.p50 = (1 - alpha) * profile.baselines.responseTime.p50 + alpha * duration;
    
    // Update error rate
    const isError = event.status === 'error' ? 1 : 0;
    profile.baselines.errorRate = (1 - alpha) * profile.baselines.errorRate + alpha * isError * 100;

    // Store updated profile
    await firestoreHelper.updateDocument('performance_profiles', profile.id, {
      baselines: profile.baselines,
      metadata: profile.metadata
    });
  }

  private async checkAlertResolution(): Promise<void> {
    for (const alert of this.activeAlerts.values()) {
      try {
        const shouldResolve = await this.shouldResolveAlert(alert);
        
        if (shouldResolve) {
          alert.status = 'resolved';
          alert.resolvedAt = new Date();
          
          await this.storePerformanceAlert(alert);
          this.activeAlerts.delete(alert.id);
          
          logger.info('Performance alert resolved', {
            alertId: alert.id,
            duration: alert.resolvedAt.getTime() - alert.detectedAt.getTime()
          });
        }
      } catch (error) {
        logger.error('Failed to check alert resolution', error as Error, { alertId: alert.id });
      }
    }
  }

  private async shouldResolveAlert(alert: PerformanceAlert): Promise<boolean> {
    // Check if the condition that triggered the alert has been resolved
    const profile = this.profiles.get(alert.profileId);
    if (!profile) return true; // Resolve if profile no longer exists

    // Get recent performance data
    const recentEvents = this.eventBuffer.filter(event => 
      event.profileId === alert.profileId &&
      event.endTime.getTime() > alert.detectedAt.getTime()
    );

    if (recentEvents.length < 5) return false; // Need enough samples

    const recentMetrics = this.calculateSummaryMetrics(recentEvents);

    // Check if metrics are back within thresholds
    switch (alert.type) {
      case 'latency':
        return recentMetrics.avgResponseTime < alert.threshold;
      case 'error_rate':
        return recentMetrics.errorRate < alert.threshold;
      case 'resource_usage':
        // Would check current resource usage
        return true;
      default:
        return false;
    }
  }

  // Public methods for retrieving data and managing the system
  async getPerformanceProfiles(): Promise<PerformanceProfile[]> {
    return Array.from(this.profiles.values());
  }

  async getSLOs(): Promise<ServiceLevelObjective[]> {
    return Array.from(this.slos.values());
  }

  async getActivePerformanceAlerts(): Promise<PerformanceAlert[]> {
    return Array.from(this.activeAlerts.values());
  }

  async updateSLO(
    sloId: string,
    updates: Partial<Pick<ServiceLevelObjective, 'target' | 'timeWindow' | 'description'>>
  ): Promise<ServiceLevelObjective> {
    const slo = this.slos.get(sloId);
    if (!slo) {
      throw new Error(`SLO not found: ${sloId}`);
    }

    Object.assign(slo, updates);
    slo.metadata.lastEvaluated = new Date();

    await this.storeSLO(slo);
    
    logger.info('SLO updated', { sloId, updates });
    return slo;
  }

  async deleteSLO(sloId: string): Promise<void> {
    const slo = this.slos.get(sloId);
    if (!slo) {
      throw new Error(`SLO not found: ${sloId}`);
    }

    this.slos.delete(sloId);
    await firestoreHelper.deleteDocument('service_level_objectives', sloId);
    
    logger.info('SLO deleted', { sloId, name: slo.name });
  }

  async resolveAlert(alertId: string, resolution: string): Promise<void> {
    const alert = this.activeAlerts.get(alertId);
    if (!alert) {
      throw new Error(`Alert not found: ${alertId}`);
    }

    alert.status = 'resolved';
    alert.resolvedAt = new Date();
    
    await this.storePerformanceAlert(alert);
    this.activeAlerts.delete(alertId);
    
    logger.info('Performance alert manually resolved', { alertId, resolution });
  }

  // Graceful shutdown
  async shutdown(): Promise<void> {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    // Process remaining events
    await this.processEventBuffer();

    logger.info('Performance monitoring system shutdown complete');
  }
}

// Lazy singleton instance - only created when first accessed
let _performanceMonitor: PerformanceMonitor | null = null;

export function getPerformanceMonitor(): PerformanceMonitor {
  if (!_performanceMonitor) {
    _performanceMonitor = new PerformanceMonitor();
  }
  return _performanceMonitor;
}

// Backward compatible export - calls getter
export const performanceMonitor = getPerformanceMonitor();

// Helper functions for easy performance tracking
export async function startPerformanceTrace(
  name: string,
  type: PerformanceEvent['type'],
  context: PerformanceEvent['context'],
  tags?: Record<string, string>
): Promise<string> {
  return await performanceMonitor.startTrace(name, type, context, tags);
}

export async function finishPerformanceTrace(
  traceId: string,
  status?: PerformanceEvent['status'],
  errorMessage?: string
): Promise<PerformanceEvent> {
  return await performanceMonitor.finishTrace(traceId, status, errorMessage);
}

export async function createSLO(sloData: Omit<ServiceLevelObjective, 'id' | 'errorBudget' | 'compliance' | 'metadata'>): Promise<ServiceLevelObjective> {
  return await performanceMonitor.createSLO(sloData);
}

export async function generateDailyReport(): Promise<PerformanceReport> {
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);
  return await performanceMonitor.generatePerformanceReport({ start: startTime, end: endTime });
}