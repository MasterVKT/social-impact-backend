import { getFirestore } from 'firebase-admin/firestore';
import { logger } from '../utils/logger';
import { firestoreHelper } from '../utils/firestore';

export interface MetricData {
  id: string;
  name: string;
  type: 'counter' | 'gauge' | 'histogram' | 'timer' | 'rate';
  value: number;
  unit: string;
  tags: Record<string, string>;
  timestamp: Date;
  source: {
    service: string;
    instance: string;
    version?: string;
  };
  metadata?: Record<string, any>;
}

export interface MetricAggregation {
  metricName: string;
  timeWindow: number; // minutes
  aggregationType: 'sum' | 'avg' | 'min' | 'max' | 'count' | 'p50' | 'p95' | 'p99';
  value: number;
  timestamp: Date;
  sampleCount: number;
}

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  metricName: string;
  condition: {
    operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
    threshold: number;
    timeWindow: number; // minutes
    evaluationInterval: number; // seconds
  };
  severity: 'info' | 'warning' | 'critical';
  actions: {
    notifications: string[];
    webhooks: string[];
    autoRemediation?: string;
  };
  metadata: {
    createdAt: Date;
    lastTriggered?: Date;
    triggerCount: number;
  };
}

export interface SystemMetrics {
  cpu: {
    usage: number;
    cores: number;
    loadAverage: number[];
  };
  memory: {
    used: number;
    total: number;
    usage: number;
    heapUsed?: number;
    heapTotal?: number;
  };
  disk: {
    used: number;
    total: number;
    usage: number;
    iops?: number;
  };
  network: {
    bytesIn: number;
    bytesOut: number;
    packetsIn: number;
    packetsOut: number;
    connections: number;
  };
  gc?: {
    collections: number;
    duration: number;
    heapSize: number;
  };
}

export interface ApplicationMetrics {
  requests: {
    total: number;
    rate: number;
    errors: number;
    errorRate: number;
    avgResponseTime: number;
    p95ResponseTime: number;
    p99ResponseTime: number;
  };
  database: {
    queries: number;
    queryRate: number;
    avgQueryTime: number;
    connectionPool: number;
    errors: number;
  };
  cache: {
    hits: number;
    misses: number;
    hitRate: number;
    evictions: number;
    size: number;
  };
  background: {
    jobs: number;
    failures: number;
    avgDuration: number;
    queueSize: number;
  };
}

export interface BusinessMetrics {
  users: {
    active: number;
    new: number;
    retained: number;
    churn: number;
  };
  projects: {
    created: number;
    active: number;
    completed: number;
    funding: number;
  };
  donations: {
    total: number;
    count: number;
    average: number;
    successful: number;
    failed: number;
  };
  engagement: {
    sessions: number;
    avgSessionDuration: number;
    pageViews: number;
    interactions: number;
  };
}

export interface SecurityMetrics {
  threats: {
    detected: number;
    blocked: number;
    riskScore: number;
  };
  authentication: {
    successful: number;
    failed: number;
    attempts: number;
    mfaUsage: number;
  };
  authorization: {
    allowed: number;
    denied: number;
    violations: number;
  };
  incidents: {
    active: number;
    resolved: number;
    avgResolutionTime: number;
    escalations: number;
  };
}

export class MetricsCollector {
  private db = getFirestore();
  private metrics: Map<string, MetricData[]> = new Map();
  private aggregations: Map<string, MetricAggregation[]> = new Map();
  private alertRules: Map<string, AlertRule> = new Map();
  private collectionInterval: NodeJS.Timeout | null = null;
  private aggregationInterval: NodeJS.Timeout | null = null;
  private alertEvaluationInterval: NodeJS.Timeout | null = null;

  private systemMetricsHistory: SystemMetrics[] = [];
  private applicationMetricsHistory: ApplicationMetrics[] = [];
  private businessMetricsHistory: BusinessMetrics[] = [];
  private securityMetricsHistory: SecurityMetrics[] = [];

  constructor() {
    this.initializeMetricsCollection();
  }

  async recordMetric(metricData: Omit<MetricData, 'id' | 'timestamp'>): Promise<void> {
    try {
      const metric: MetricData = {
        id: `metric_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
        ...metricData
      };

      // Add to in-memory collection
      if (!this.metrics.has(metric.name)) {
        this.metrics.set(metric.name, []);
      }
      this.metrics.get(metric.name)!.push(metric);

      // Store in database for persistence
      await this.storeMetric(metric);

      // Check against alert rules
      await this.evaluateAlertRules(metric);

    } catch (error) {
      logger.error('Failed to record metric', error as Error, {
        metricName: metricData.name,
        value: metricData.value
      });
    }
  }

  async recordTimer(name: string, startTime: number, tags: Record<string, string> = {}): Promise<void> {
    const duration = Date.now() - startTime;
    await this.recordMetric({
      name,
      type: 'timer',
      value: duration,
      unit: 'milliseconds',
      tags,
      source: {
        service: 'social-impact-platform',
        instance: process.env.INSTANCE_ID || 'default'
      }
    });
  }

  async recordCounter(name: string, value: number = 1, tags: Record<string, string> = {}): Promise<void> {
    await this.recordMetric({
      name,
      type: 'counter',
      value,
      unit: 'count',
      tags,
      source: {
        service: 'social-impact-platform',
        instance: process.env.INSTANCE_ID || 'default'
      }
    });
  }

  async recordGauge(name: string, value: number, unit: string, tags: Record<string, string> = {}): Promise<void> {
    await this.recordMetric({
      name,
      type: 'gauge',
      value,
      unit,
      tags,
      source: {
        service: 'social-impact-platform',
        instance: process.env.INSTANCE_ID || 'default'
      }
    });
  }

  async recordHistogram(name: string, value: number, unit: string, tags: Record<string, string> = {}): Promise<void> {
    await this.recordMetric({
      name,
      type: 'histogram',
      value,
      unit,
      tags,
      source: {
        service: 'social-impact-platform',
        instance: process.env.INSTANCE_ID || 'default'
      }
    });
  }

  async collectSystemMetrics(): Promise<SystemMetrics> {
    try {
      const metrics: SystemMetrics = {
        cpu: await this.getCPUMetrics(),
        memory: await this.getMemoryMetrics(),
        disk: await this.getDiskMetrics(),
        network: await this.getNetworkMetrics(),
        gc: await this.getGCMetrics()
      };

      // Record individual metrics
      await this.recordGauge('system.cpu.usage', metrics.cpu.usage, 'percent');
      await this.recordGauge('system.memory.usage', metrics.memory.usage, 'percent');
      await this.recordGauge('system.disk.usage', metrics.disk.usage, 'percent');
      await this.recordGauge('system.network.connections', metrics.network.connections, 'count');

      // Store in history
      this.systemMetricsHistory.push(metrics);
      if (this.systemMetricsHistory.length > 1000) {
        this.systemMetricsHistory.shift();
      }

      return metrics;

    } catch (error) {
      logger.error('Failed to collect system metrics', error as Error);
      throw error;
    }
  }

  async collectApplicationMetrics(): Promise<ApplicationMetrics> {
    try {
      const metrics: ApplicationMetrics = {
        requests: await this.getRequestMetrics(),
        database: await this.getDatabaseMetrics(),
        cache: await this.getCacheMetrics(),
        background: await this.getBackgroundJobMetrics()
      };

      // Record individual metrics
      await this.recordGauge('app.requests.rate', metrics.requests.rate, 'requests_per_second');
      await this.recordGauge('app.requests.error_rate', metrics.requests.errorRate, 'percent');
      await this.recordGauge('app.requests.avg_response_time', metrics.requests.avgResponseTime, 'milliseconds');
      await this.recordGauge('app.database.query_rate', metrics.database.queryRate, 'queries_per_second');
      await this.recordGauge('app.cache.hit_rate', metrics.cache.hitRate, 'percent');

      // Store in history
      this.applicationMetricsHistory.push(metrics);
      if (this.applicationMetricsHistory.length > 1000) {
        this.applicationMetricsHistory.shift();
      }

      return metrics;

    } catch (error) {
      logger.error('Failed to collect application metrics', error as Error);
      throw error;
    }
  }

  async collectBusinessMetrics(): Promise<BusinessMetrics> {
    try {
      const metrics: BusinessMetrics = {
        users: await this.getUserMetrics(),
        projects: await this.getProjectMetrics(),
        donations: await this.getDonationMetrics(),
        engagement: await this.getEngagementMetrics()
      };

      // Record individual metrics
      await this.recordGauge('business.users.active', metrics.users.active, 'count');
      await this.recordGauge('business.projects.active', metrics.projects.active, 'count');
      await this.recordGauge('business.donations.total', metrics.donations.total, 'currency');
      await this.recordGauge('business.engagement.sessions', metrics.engagement.sessions, 'count');

      // Store in history
      this.businessMetricsHistory.push(metrics);
      if (this.businessMetricsHistory.length > 1000) {
        this.businessMetricsHistory.shift();
      }

      return metrics;

    } catch (error) {
      logger.error('Failed to collect business metrics', error as Error);
      throw error;
    }
  }

  async collectSecurityMetrics(): Promise<SecurityMetrics> {
    try {
      const metrics: SecurityMetrics = {
        threats: await this.getThreatMetrics(),
        authentication: await this.getAuthMetrics(),
        authorization: await this.getAuthzMetrics(),
        incidents: await this.getIncidentMetrics()
      };

      // Record individual metrics
      await this.recordGauge('security.threats.detected', metrics.threats.detected, 'count');
      await this.recordGauge('security.threats.risk_score', metrics.threats.riskScore, 'score');
      await this.recordGauge('security.auth.failed', metrics.authentication.failed, 'count');
      await this.recordGauge('security.incidents.active', metrics.incidents.active, 'count');

      // Store in history
      this.securityMetricsHistory.push(metrics);
      if (this.securityMetricsHistory.length > 1000) {
        this.securityMetricsHistory.shift();
      }

      return metrics;

    } catch (error) {
      logger.error('Failed to collect security metrics', error as Error);
      throw error;
    }
  }

  async createAlertRule(ruleData: Omit<AlertRule, 'id' | 'metadata'>): Promise<AlertRule> {
    try {
      const rule: AlertRule = {
        id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        ...ruleData,
        metadata: {
          createdAt: new Date(),
          triggerCount: 0
        }
      };

      // Store rule
      await firestoreHelper.setDocument('alert_rules', rule.id, rule);
      this.alertRules.set(rule.id, rule);

      logger.info('Alert rule created', {
        ruleId: rule.id,
        name: rule.name,
        metricName: rule.metricName,
        threshold: rule.condition.threshold
      });

      return rule;

    } catch (error) {
      logger.error('Failed to create alert rule', error as Error, { ruleName: ruleData.name });
      throw error;
    }
  }

  async aggregateMetrics(metricName: string, timeWindow: number, aggregationType: MetricAggregation['aggregationType']): Promise<MetricAggregation> {
    try {
      const cutoffTime = new Date(Date.now() - (timeWindow * 60 * 1000));
      const recentMetrics = this.metrics.get(metricName)?.filter(m => m.timestamp >= cutoffTime) || [];

      if (recentMetrics.length === 0) {
        throw new Error(`No metrics found for ${metricName} in the last ${timeWindow} minutes`);
      }

      const values = recentMetrics.map(m => m.value);
      let aggregatedValue: number;

      switch (aggregationType) {
        case 'sum':
          aggregatedValue = values.reduce((sum, val) => sum + val, 0);
          break;
        case 'avg':
          aggregatedValue = values.reduce((sum, val) => sum + val, 0) / values.length;
          break;
        case 'min':
          aggregatedValue = Math.min(...values);
          break;
        case 'max':
          aggregatedValue = Math.max(...values);
          break;
        case 'count':
          aggregatedValue = values.length;
          break;
        case 'p50':
          aggregatedValue = this.calculatePercentile(values, 50);
          break;
        case 'p95':
          aggregatedValue = this.calculatePercentile(values, 95);
          break;
        case 'p99':
          aggregatedValue = this.calculatePercentile(values, 99);
          break;
        default:
          throw new Error(`Unsupported aggregation type: ${aggregationType}`);
      }

      const aggregation: MetricAggregation = {
        metricName,
        timeWindow,
        aggregationType,
        value: aggregatedValue,
        timestamp: new Date(),
        sampleCount: values.length
      };

      // Store aggregation
      if (!this.aggregations.has(metricName)) {
        this.aggregations.set(metricName, []);
      }
      this.aggregations.get(metricName)!.push(aggregation);

      return aggregation;

    } catch (error) {
      logger.error('Failed to aggregate metrics', error as Error, {
        metricName,
        timeWindow,
        aggregationType
      });
      throw error;
    }
  }

  private async getCPUMetrics(): Promise<SystemMetrics['cpu']> {
    // Implementation would use system monitoring libraries
    return {
      usage: Math.random() * 100, // Placeholder
      cores: 4,
      loadAverage: [1.2, 1.5, 1.8]
    };
  }

  private async getMemoryMetrics(): Promise<SystemMetrics['memory']> {
    const memoryUsage = process.memoryUsage();
    return {
      used: memoryUsage.rss,
      total: memoryUsage.rss * 2, // Simplified
      usage: (memoryUsage.rss / (memoryUsage.rss * 2)) * 100,
      heapUsed: memoryUsage.heapUsed,
      heapTotal: memoryUsage.heapTotal
    };
  }

  private async getDiskMetrics(): Promise<SystemMetrics['disk']> {
    // Implementation would use system monitoring
    return {
      used: 50 * 1024 * 1024 * 1024, // 50GB
      total: 100 * 1024 * 1024 * 1024, // 100GB
      usage: 50,
      iops: 1000
    };
  }

  private async getNetworkMetrics(): Promise<SystemMetrics['network']> {
    // Implementation would use system monitoring
    return {
      bytesIn: 1024 * 1024,
      bytesOut: 512 * 1024,
      packetsIn: 1000,
      packetsOut: 800,
      connections: 50
    };
  }

  private async getGCMetrics(): Promise<SystemMetrics['gc']> {
    // Implementation would use V8 GC monitoring
    return {
      collections: 10,
      duration: 50,
      heapSize: 128 * 1024 * 1024
    };
  }

  private async getRequestMetrics(): Promise<ApplicationMetrics['requests']> {
    // Implementation would aggregate from request logs
    return {
      total: 10000,
      rate: 100,
      errors: 50,
      errorRate: 0.5,
      avgResponseTime: 250,
      p95ResponseTime: 800,
      p99ResponseTime: 1500
    };
  }

  private async getDatabaseMetrics(): Promise<ApplicationMetrics['database']> {
    // Implementation would query database statistics
    return {
      queries: 5000,
      queryRate: 50,
      avgQueryTime: 25,
      connectionPool: 10,
      errors: 5
    };
  }

  private async getCacheMetrics(): Promise<ApplicationMetrics['cache']> {
    // Implementation would query cache statistics
    return {
      hits: 8000,
      misses: 2000,
      hitRate: 80,
      evictions: 100,
      size: 500 * 1024 * 1024
    };
  }

  private async getBackgroundJobMetrics(): Promise<ApplicationMetrics['background']> {
    // Implementation would query job queue statistics
    return {
      jobs: 1000,
      failures: 10,
      avgDuration: 5000,
      queueSize: 50
    };
  }

  private async getUserMetrics(): Promise<BusinessMetrics['users']> {
    try {
      const now = new Date();
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const [activeUsers, newUsers, allUsers] = await Promise.all([
        this.db.collection('users').where('lastActive', '>=', dayAgo).count().get(),
        this.db.collection('users').where('createdAt', '>=', dayAgo).count().get(),
        this.db.collection('users').count().get()
      ]);

      return {
        active: activeUsers.data().count,
        new: newUsers.data().count,
        retained: Math.round(activeUsers.data().count * 0.8), // Simplified calculation
        churn: Math.round(allUsers.data().count * 0.02) // Simplified calculation
      };

    } catch (error) {
      logger.error('Failed to get user metrics', error as Error);
      return { active: 0, new: 0, retained: 0, churn: 0 };
    }
  }

  private async getProjectMetrics(): Promise<BusinessMetrics['projects']> {
    try {
      const now = new Date();
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const [createdToday, activeProjects, completedProjects, totalFunding] = await Promise.all([
        this.db.collection('projects').where('createdAt', '>=', dayAgo).count().get(),
        this.db.collection('projects').where('status', '==', 'active').count().get(),
        this.db.collection('projects').where('status', '==', 'completed').count().get(),
        this.db.collection('projects').where('status', '==', 'active').get()
      ]);

      const funding = totalFunding.docs.reduce((sum, doc) => {
        const project = doc.data();
        return sum + (project.fundingGoal || 0);
      }, 0);

      return {
        created: createdToday.data().count,
        active: activeProjects.data().count,
        completed: completedProjects.data().count,
        funding
      };

    } catch (error) {
      logger.error('Failed to get project metrics', error as Error);
      return { created: 0, active: 0, completed: 0, funding: 0 };
    }
  }

  private async getDonationMetrics(): Promise<BusinessMetrics['donations']> {
    try {
      const now = new Date();
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const donationsSnapshot = await this.db.collection('donations')
        .where('createdAt', '>=', dayAgo)
        .get();

      const donations = donationsSnapshot.docs.map(doc => doc.data());
      const successful = donations.filter(d => d.status === 'completed');
      const failed = donations.filter(d => d.status === 'failed');

      const total = successful.reduce((sum, d) => sum + (d.amount || 0), 0);
      const average = successful.length > 0 ? total / successful.length : 0;

      return {
        total,
        count: donations.length,
        average,
        successful: successful.length,
        failed: failed.length
      };

    } catch (error) {
      logger.error('Failed to get donation metrics', error as Error);
      return { total: 0, count: 0, average: 0, successful: 0, failed: 0 };
    }
  }

  private async getEngagementMetrics(): Promise<BusinessMetrics['engagement']> {
    // Implementation would integrate with analytics system
    return {
      sessions: 5000,
      avgSessionDuration: 300000, // 5 minutes in milliseconds
      pageViews: 25000,
      interactions: 15000
    };
  }

  private async getThreatMetrics(): Promise<SecurityMetrics['threats']> {
    try {
      const now = new Date();
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const threatsSnapshot = await this.db.collection('security_events')
        .where('type', '==', 'threat_detected')
        .where('timestamp', '>=', dayAgo)
        .get();

      const threats = threatsSnapshot.docs.map(doc => doc.data());
      const blocked = threats.filter(t => t.details.outcome === 'blocked').length;
      const avgRiskScore = threats.length > 0 
        ? threats.reduce((sum, t) => sum + (t.risk?.score || 0), 0) / threats.length 
        : 0;

      return {
        detected: threats.length,
        blocked,
        riskScore: avgRiskScore
      };

    } catch (error) {
      logger.error('Failed to get threat metrics', error as Error);
      return { detected: 0, blocked: 0, riskScore: 0 };
    }
  }

  private async getAuthMetrics(): Promise<SecurityMetrics['authentication']> {
    try {
      const now = new Date();
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const authEventsSnapshot = await this.db.collection('security_events')
        .where('type', '==', 'authentication')
        .where('timestamp', '>=', dayAgo)
        .get();

      const authEvents = authEventsSnapshot.docs.map(doc => doc.data());
      const successful = authEvents.filter(e => e.details.outcome === 'success').length;
      const failed = authEvents.filter(e => e.details.outcome === 'failure').length;
      const mfaUsage = authEvents.filter(e => e.details.metadata?.mfa === true).length;

      return {
        successful,
        failed,
        attempts: authEvents.length,
        mfaUsage
      };

    } catch (error) {
      logger.error('Failed to get auth metrics', error as Error);
      return { successful: 0, failed: 0, attempts: 0, mfaUsage: 0 };
    }
  }

  private async getAuthzMetrics(): Promise<SecurityMetrics['authorization']> {
    try {
      const now = new Date();
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const authzEventsSnapshot = await this.db.collection('security_events')
        .where('type', '==', 'authorization')
        .where('timestamp', '>=', dayAgo)
        .get();

      const authzEvents = authzEventsSnapshot.docs.map(doc => doc.data());
      const allowed = authzEvents.filter(e => e.details.outcome === 'success').length;
      const denied = authzEvents.filter(e => e.details.outcome === 'failure').length;
      const violations = authzEvents.filter(e => e.details.outcome === 'blocked').length;

      return {
        allowed,
        denied,
        violations
      };

    } catch (error) {
      logger.error('Failed to get authz metrics', error as Error);
      return { allowed: 0, denied: 0, violations: 0 };
    }
  }

  private async getIncidentMetrics(): Promise<SecurityMetrics['incidents']> {
    try {
      const activeIncidentsSnapshot = await this.db.collection('security_incidents')
        .where('status', 'in', ['new', 'assigned', 'investigating', 'contained'])
        .get();

      const resolvedIncidentsSnapshot = await this.db.collection('security_incidents')
        .where('status', '==', 'resolved')
        .where('timeline.resolved', '>=', new Date(Date.now() - 24 * 60 * 60 * 1000))
        .get();

      const escalatedIncidentsSnapshot = await this.db.collection('security_incidents')
        .where('metadata.priority', '>=', 8)
        .where('timeline.detected', '>=', new Date(Date.now() - 24 * 60 * 60 * 1000))
        .get();

      const resolvedIncidents = resolvedIncidentsSnapshot.docs.map(doc => doc.data());
      const avgResolutionTime = resolvedIncidents.length > 0
        ? resolvedIncidents.reduce((sum, incident) => {
            const detection = incident.timeline.detected?.getTime() || 0;
            const resolution = incident.timeline.resolved?.getTime() || 0;
            return sum + (resolution - detection);
          }, 0) / resolvedIncidents.length
        : 0;

      return {
        active: activeIncidentsSnapshot.size,
        resolved: resolvedIncidentsSnapshot.size,
        avgResolutionTime: avgResolutionTime / (60 * 1000), // Convert to minutes
        escalations: escalatedIncidentsSnapshot.size
      };

    } catch (error) {
      logger.error('Failed to get incident metrics', error as Error);
      return { active: 0, resolved: 0, avgResolutionTime: 0, escalations: 0 };
    }
  }

  private async evaluateAlertRules(metric: MetricData): Promise<void> {
    for (const rule of this.alertRules.values()) {
      if (!rule.enabled || rule.metricName !== metric.name) continue;

      try {
        const shouldTrigger = await this.evaluateRuleCondition(rule, metric);
        
        if (shouldTrigger) {
          await this.triggerAlert(rule, metric);
          rule.metadata.lastTriggered = new Date();
          rule.metadata.triggerCount++;
          await this.updateAlertRule(rule);
        }

      } catch (error) {
        logger.error('Failed to evaluate alert rule', error as Error, {
          ruleId: rule.id,
          ruleName: rule.name
        });
      }
    }
  }

  private async evaluateRuleCondition(rule: AlertRule, metric: MetricData): Promise<boolean> {
    const { operator, threshold, timeWindow } = rule.condition;
    
    // For single metric evaluation
    if (timeWindow === 0) {
      return this.compareValue(metric.value, operator, threshold);
    }

    // For time window evaluation, get aggregated value
    try {
      const aggregation = await this.aggregateMetrics(rule.metricName, timeWindow, 'avg');
      return this.compareValue(aggregation.value, operator, threshold);
    } catch (error) {
      // If aggregation fails, fall back to single metric
      return this.compareValue(metric.value, operator, threshold);
    }
  }

  private compareValue(value: number, operator: AlertRule['condition']['operator'], threshold: number): boolean {
    switch (operator) {
      case 'gt': return value > threshold;
      case 'gte': return value >= threshold;
      case 'lt': return value < threshold;
      case 'lte': return value <= threshold;
      case 'eq': return value === threshold;
      default: return false;
    }
  }

  private async triggerAlert(rule: AlertRule, metric: MetricData): Promise<void> {
    const alertData = {
      ruleId: rule.id,
      ruleName: rule.name,
      severity: rule.severity,
      metricName: metric.name,
      metricValue: metric.value,
      threshold: rule.condition.threshold,
      timestamp: new Date(),
      message: `Alert: ${rule.name} - ${metric.name} (${metric.value}) ${rule.condition.operator} ${rule.condition.threshold}`
    };

    // Send notifications
    for (const recipient of rule.actions.notifications) {
      await this.sendNotification(recipient, alertData);
    }

    // Call webhooks
    for (const webhook of rule.actions.webhooks) {
      await this.callWebhook(webhook, alertData);
    }

    // Execute auto-remediation if configured
    if (rule.actions.autoRemediation) {
      await this.executeRemediation(rule.actions.autoRemediation, alertData);
    }

    logger.warn('Alert triggered', {
      ruleId: rule.id,
      ruleName: rule.name,
      metricName: metric.name,
      value: metric.value,
      threshold: rule.condition.threshold
    });
  }

  private async sendNotification(recipient: string, alertData: any): Promise<void> {
    // Implementation would integrate with notification system
    logger.info('Alert notification sent', { recipient, alert: alertData.message });
  }

  private async callWebhook(webhook: string, alertData: any): Promise<void> {
    // Implementation would make HTTP request to webhook
    logger.info('Alert webhook called', { webhook, alert: alertData.message });
  }

  private async executeRemediation(remediationId: string, alertData: any): Promise<void> {
    // Implementation would execute automated remediation actions
    logger.info('Auto-remediation executed', { remediationId, alert: alertData.message });
  }

  private calculatePercentile(values: number[], percentile: number): number {
    const sorted = values.sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  private async storeMetric(metric: MetricData): Promise<void> {
    try {
      // Store in time-series collection with date-based partitioning
      const dateStr = metric.timestamp.toISOString().split('T')[0];
      const collectionName = `metrics_${dateStr.replace(/-/g, '_')}`;
      
      await firestoreHelper.setDocument(collectionName, metric.id, metric);
    } catch (error) {
      logger.error('Failed to store metric', error as Error, { metricId: metric.id });
    }
  }

  private async updateAlertRule(rule: AlertRule): Promise<void> {
    await firestoreHelper.updateDocument('alert_rules', rule.id, {
      'metadata.lastTriggered': rule.metadata.lastTriggered,
      'metadata.triggerCount': rule.metadata.triggerCount
    });
  }

  private async initializeMetricsCollection(): Promise<void> {
    try {
      // Load existing alert rules
      await this.loadAlertRules();

      // Create default alert rules if none exist
      if (this.alertRules.size === 0) {
        await this.createDefaultAlertRules();
      }

      // Start collection intervals
      this.startMetricsCollection();

      logger.info('Metrics collection system initialized', {
        alertRuleCount: this.alertRules.size
      });

    } catch (error) {
      logger.error('Failed to initialize metrics collection', error as Error);
      throw error;
    }
  }

  private async loadAlertRules(): Promise<void> {
    try {
      const snapshot = await this.db.collection('alert_rules')
        .where('enabled', '==', true)
        .get();

      snapshot.docs.forEach(doc => {
        const rule = doc.data() as AlertRule;
        this.alertRules.set(rule.id, rule);
      });

    } catch (error) {
      logger.error('Failed to load alert rules', error as Error);
    }
  }

  private async createDefaultAlertRules(): Promise<void> {
    const defaultRules = [
      {
        name: 'High CPU Usage',
        description: 'Alert when CPU usage exceeds 80%',
        enabled: true,
        metricName: 'system.cpu.usage',
        condition: {
          operator: 'gt' as const,
          threshold: 80,
          timeWindow: 5,
          evaluationInterval: 60
        },
        severity: 'warning' as const,
        actions: {
          notifications: ['ops-team'],
          webhooks: [],
          autoRemediation: 'scale-up'
        }
      },
      {
        name: 'High Error Rate',
        description: 'Alert when error rate exceeds 5%',
        enabled: true,
        metricName: 'app.requests.error_rate',
        condition: {
          operator: 'gt' as const,
          threshold: 5,
          timeWindow: 10,
          evaluationInterval: 30
        },
        severity: 'critical' as const,
        actions: {
          notifications: ['dev-team', 'ops-team'],
          webhooks: ['incident-webhook'],
          autoRemediation: 'circuit-breaker'
        }
      },
      {
        name: 'Security Threats Detected',
        description: 'Alert when multiple threats detected',
        enabled: true,
        metricName: 'security.threats.detected',
        condition: {
          operator: 'gt' as const,
          threshold: 10,
          timeWindow: 15,
          evaluationInterval: 60
        },
        severity: 'critical' as const,
        actions: {
          notifications: ['security-team', 'ops-team'],
          webhooks: ['security-webhook'],
          autoRemediation: 'enhance-security'
        }
      }
    ];

    for (const ruleData of defaultRules) {
      await this.createAlertRule(ruleData);
    }
  }

  private startMetricsCollection(): void {
    // Collect system metrics every 30 seconds
    this.collectionInterval = setInterval(async () => {
      try {
        await Promise.all([
          this.collectSystemMetrics(),
          this.collectApplicationMetrics(),
          this.collectSecurityMetrics()
        ]);
      } catch (error) {
        logger.error('Metrics collection failed', error as Error);
      }
    }, 30000);

    // Collect business metrics every 5 minutes
    setInterval(async () => {
      try {
        await this.collectBusinessMetrics();
      } catch (error) {
        logger.error('Business metrics collection failed', error as Error);
      }
    }, 5 * 60 * 1000);

    // Process aggregations every minute
    this.aggregationInterval = setInterval(async () => {
      try {
        await this.processAggregations();
      } catch (error) {
        logger.error('Metrics aggregation failed', error as Error);
      }
    }, 60000);

    // Evaluate alerts every 30 seconds
    this.alertEvaluationInterval = setInterval(async () => {
      try {
        await this.evaluateAllAlerts();
      } catch (error) {
        logger.error('Alert evaluation failed', error as Error);
      }
    }, 30000);

    // Clean up old metrics every hour
    setInterval(async () => {
      try {
        await this.cleanupOldMetrics();
      } catch (error) {
        logger.error('Metrics cleanup failed', error as Error);
      }
    }, 60 * 60 * 1000);
  }

  private async processAggregations(): Promise<void> {
    const metricsToAggregate = [
      'system.cpu.usage',
      'system.memory.usage',
      'app.requests.rate',
      'app.requests.error_rate',
      'security.threats.detected'
    ];

    for (const metricName of metricsToAggregate) {
      try {
        await Promise.all([
          this.aggregateMetrics(metricName, 5, 'avg'),   // 5-minute average
          this.aggregateMetrics(metricName, 15, 'avg'),  // 15-minute average
          this.aggregateMetrics(metricName, 60, 'avg')   // 1-hour average
        ]);
      } catch (error) {
        // Continue with other metrics if one fails
        logger.error('Failed to aggregate metric', error as Error, { metricName });
      }
    }
  }

  private async evaluateAllAlerts(): Promise<void> {
    // This method would evaluate time-based alerts that don't trigger on individual metrics
    for (const rule of this.alertRules.values()) {
      if (!rule.enabled) continue;

      try {
        // Get recent metrics for evaluation
        const recentMetrics = this.metrics.get(rule.metricName)?.slice(-10) || [];
        
        if (recentMetrics.length > 0) {
          const latestMetric = recentMetrics[recentMetrics.length - 1];
          const shouldTrigger = await this.evaluateRuleCondition(rule, latestMetric);
          
          if (shouldTrigger) {
            const timeSinceLastTrigger = rule.metadata.lastTriggered 
              ? Date.now() - rule.metadata.lastTriggered.getTime()
              : Infinity;
            
            // Prevent alert spam - only trigger if enough time has passed
            if (timeSinceLastTrigger > (rule.condition.evaluationInterval * 1000)) {
              await this.triggerAlert(rule, latestMetric);
              rule.metadata.lastTriggered = new Date();
              rule.metadata.triggerCount++;
              await this.updateAlertRule(rule);
            }
          }
        }

      } catch (error) {
        logger.error('Failed to evaluate alert rule', error as Error, {
          ruleId: rule.id,
          ruleName: rule.name
        });
      }
    }
  }

  private async cleanupOldMetrics(): Promise<void> {
    const retentionPeriod = 30 * 24 * 60 * 60 * 1000; // 30 days
    const cutoffTime = new Date(Date.now() - retentionPeriod);

    for (const [metricName, metrics] of this.metrics.entries()) {
      const filteredMetrics = metrics.filter(m => m.timestamp >= cutoffTime);
      this.metrics.set(metricName, filteredMetrics);
    }

    // Cleanup aggregations
    for (const [metricName, aggregations] of this.aggregations.entries()) {
      const filteredAggregations = aggregations.filter(a => a.timestamp >= cutoffTime);
      this.aggregations.set(metricName, filteredAggregations);
    }

    // Cleanup history arrays
    const historyRetention = 1000; // Keep last 1000 entries
    if (this.systemMetricsHistory.length > historyRetention) {
      this.systemMetricsHistory = this.systemMetricsHistory.slice(-historyRetention);
    }
    if (this.applicationMetricsHistory.length > historyRetention) {
      this.applicationMetricsHistory = this.applicationMetricsHistory.slice(-historyRetention);
    }
    if (this.businessMetricsHistory.length > historyRetention) {
      this.businessMetricsHistory = this.businessMetricsHistory.slice(-historyRetention);
    }
    if (this.securityMetricsHistory.length > historyRetention) {
      this.securityMetricsHistory = this.securityMetricsHistory.slice(-historyRetention);
    }
  }

  // Public methods for retrieving metrics and managing the system
  async getMetrics(metricName: string, timeWindow?: number): Promise<MetricData[]> {
    const metrics = this.metrics.get(metricName) || [];
    
    if (timeWindow) {
      const cutoffTime = new Date(Date.now() - (timeWindow * 60 * 1000));
      return metrics.filter(m => m.timestamp >= cutoffTime);
    }
    
    return metrics;
  }

  async getAggregations(metricName: string): Promise<MetricAggregation[]> {
    return this.aggregations.get(metricName) || [];
  }

  async getAllMetrics(): Promise<{
    system: SystemMetrics[];
    application: ApplicationMetrics[];
    business: BusinessMetrics[];
    security: SecurityMetrics[];
  }> {
    return {
      system: this.systemMetricsHistory.slice(-100),
      application: this.applicationMetricsHistory.slice(-100),
      business: this.businessMetricsHistory.slice(-100),
      security: this.securityMetricsHistory.slice(-100)
    };
  }

  async getAlertRules(): Promise<AlertRule[]> {
    return Array.from(this.alertRules.values());
  }

  async updateAlertRuleStatus(ruleId: string, enabled: boolean): Promise<void> {
    const rule = this.alertRules.get(ruleId);
    if (!rule) {
      throw new Error(`Alert rule not found: ${ruleId}`);
    }

    rule.enabled = enabled;
    await firestoreHelper.updateDocument('alert_rules', ruleId, { enabled });
    
    logger.info('Alert rule status updated', { ruleId, enabled });
  }

  async deleteAlertRule(ruleId: string): Promise<void> {
    const rule = this.alertRules.get(ruleId);
    if (!rule) {
      throw new Error(`Alert rule not found: ${ruleId}`);
    }

    this.alertRules.delete(ruleId);
    await firestoreHelper.deleteDocument('alert_rules', ruleId);
    
    logger.info('Alert rule deleted', { ruleId, name: rule.name });
  }

  // Graceful shutdown
  async shutdown(): Promise<void> {
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
    }
    if (this.aggregationInterval) {
      clearInterval(this.aggregationInterval);
    }
    if (this.alertEvaluationInterval) {
      clearInterval(this.alertEvaluationInterval);
    }

    logger.info('Metrics collection system shutdown complete');
  }
}

// Singleton instance
export const metricsCollector = new MetricsCollector();

// Helper functions for easy metric recording
export async function recordTimer(name: string, startTime: number, tags?: Record<string, string>): Promise<void> {
  return await metricsCollector.recordTimer(name, startTime, tags);
}

export async function recordCounter(name: string, value?: number, tags?: Record<string, string>): Promise<void> {
  return await metricsCollector.recordCounter(name, value, tags);
}

export async function recordGauge(name: string, value: number, unit: string, tags?: Record<string, string>): Promise<void> {
  return await metricsCollector.recordGauge(name, value, unit, tags);
}

export async function createAlert(ruleData: Omit<AlertRule, 'id' | 'metadata'>): Promise<AlertRule> {
  return await metricsCollector.createAlertRule(ruleData);
}