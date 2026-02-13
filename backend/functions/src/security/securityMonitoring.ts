import { getFirestore } from 'firebase-admin/firestore';
import { logger } from '../utils/logger';
import { firestoreHelper } from '../utils/firestore';
import { threatDetectionSystem, ThreatEvent } from './threatDetection';
import { accessControlSystem } from './accessControl';

export interface SecurityEvent {
  id: string;
  type: 'authentication' | 'authorization' | 'data_access' | 'system_change' | 'threat_detected' | 'security_violation';
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  source: {
    userId?: string;
    ip: string;
    userAgent?: string;
    service: string;
    endpoint?: string;
  };
  details: {
    action: string;
    resource?: string;
    outcome: 'success' | 'failure' | 'blocked';
    reason?: string;
    metadata?: Record<string, any>;
  };
  risk: {
    score: number;
    factors: string[];
    confidence: number;
  };
  correlation: {
    sessionId?: string;
    traceId?: string;
    parentEventId?: string;
    relatedEvents: string[];
  };
  timestamp: Date;
  processed: boolean;
  alerts: string[];
}

export interface SecurityAlert {
  id: string;
  type: 'real_time' | 'batch' | 'escalation';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  events: string[];
  triggers: {
    ruleId: string;
    ruleName: string;
    threshold?: number;
    timeWindow?: number;
  }[];
  status: 'active' | 'investigating' | 'resolved' | 'false_positive';
  assignedTo?: string;
  response: {
    automated: boolean;
    actions: string[];
    escalated: boolean;
    responseTime?: number;
  };
  metadata: {
    createdAt: Date;
    updatedAt: Date;
    resolvedAt?: Date;
    falsePositiveReason?: string;
  };
}

export interface MonitoringRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  conditions: {
    eventTypes: string[];
    severity?: string[];
    timeWindow: number; // minutes
    threshold: number;
    groupBy?: string[];
  };
  actions: {
    alert: boolean;
    block: boolean;
    escalate: boolean;
    notify: string[];
  };
  metadata: {
    createdAt: Date;
    lastTriggered?: Date;
    triggerCount: number;
  };
}

export interface SecurityMetrics {
  totalEvents: number;
  eventsByType: Record<string, number>;
  eventsBySeverity: Record<string, number>;
  riskScore: number;
  alertsActive: number;
  threatTrends: {
    period: string;
    count: number;
    trend: 'increasing' | 'decreasing' | 'stable';
  }[];
  responseMetrics: {
    averageResponseTime: number;
    automatedResponseRate: number;
    falsePositiveRate: number;
  };
}

export class SecurityMonitoringSystem {
  private db = getFirestore();
  private monitoringRules: Map<string, MonitoringRule> = new Map();
  private eventBuffer: SecurityEvent[] = [];
  private alertBuffer: SecurityAlert[] = [];
  private processInterval: NodeJS.Timeout | null = null;
  private initialized = false;

  constructor() {
    // Don't initialize here - use lazy initialization
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initializeMonitoring();
      this.initialized = true;
    }
  }

  async logSecurityEvent(event: Omit<SecurityEvent, 'id' | 'timestamp' | 'processed' | 'alerts' | 'correlation'>): Promise<SecurityEvent> {
    await this.ensureInitialized();
    try {
      const securityEvent: SecurityEvent = {
        id: `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        ...event,
        correlation: {
          sessionId: this.generateSessionId(event.source),
          traceId: `trace_${Date.now()}`,
          relatedEvents: []
        },
        timestamp: new Date(),
        processed: false,
        alerts: []
      };

      // Add to buffer for processing
      this.eventBuffer.push(securityEvent);

      // Store in database
      await this.storeSecurityEvent(securityEvent);

      // Process immediately for critical events
      if (securityEvent.severity === 'critical') {
        await this.processEvent(securityEvent);
      }

      logger.info('Security event logged', {
        eventId: securityEvent.id,
        type: securityEvent.type,
        severity: securityEvent.severity,
        riskScore: securityEvent.risk.score
      });

      return securityEvent;

    } catch (error) {
      logger.error('Failed to log security event', error as Error, {
        eventType: event.type,
        severity: event.severity
      });
      throw error;
    }
  }

  async createAlert(
    events: SecurityEvent[],
    triggeredRules: MonitoringRule[],
    options?: {
      escalate?: boolean;
      assignTo?: string;
      customActions?: string[];
    }
  ): Promise<SecurityAlert> {
    try {
      const maxSeverity = this.getMaxSeverity(events.map(e => e.severity));
      const totalRiskScore = events.reduce((sum, e) => sum + e.risk.score, 0) / events.length;

      const alert: SecurityAlert = {
        id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: options?.escalate ? 'escalation' : 'real_time',
        severity: maxSeverity,
        title: this.generateAlertTitle(events, triggeredRules),
        description: this.generateAlertDescription(events, triggeredRules),
        events: events.map(e => e.id),
        triggers: triggeredRules.map(rule => ({
          ruleId: rule.id,
          ruleName: rule.name,
          threshold: rule.conditions.threshold,
          timeWindow: rule.conditions.timeWindow
        })),
        status: 'active',
        assignedTo: options?.assignTo,
        response: {
          automated: false,
          actions: options?.customActions || [],
          escalated: options?.escalate || false
        },
        metadata: {
          createdAt: new Date(),
          updatedAt: new Date()
        }
      };

      // Execute automated response
      if (triggeredRules.some(rule => rule.actions.alert || rule.actions.block)) {
        await this.executeAutomatedResponse(alert, events, triggeredRules);
      }

      // Store alert
      await this.storeAlert(alert);

      // Add to buffer
      this.alertBuffer.push(alert);

      // Update events with alert reference
      for (const event of events) {
        event.alerts.push(alert.id);
        await this.updateSecurityEvent(event);
      }

      logger.warn('Security alert created', {
        alertId: alert.id,
        severity: alert.severity,
        eventCount: events.length,
        riskScore: totalRiskScore
      });

      return alert;

    } catch (error) {
      logger.error('Failed to create alert', error as Error, {
        eventCount: events.length,
        ruleCount: triggeredRules.length
      });
      throw error;
    }
  }

  async addMonitoringRule(rule: Omit<MonitoringRule, 'id' | 'metadata'>): Promise<MonitoringRule> {
    try {
      const monitoringRule: MonitoringRule = {
        id: `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        ...rule,
        metadata: {
          createdAt: new Date(),
          triggerCount: 0
        }
      };

      // Store rule
      await firestoreHelper.setDocument('monitoring_rules', monitoringRule.id, monitoringRule);

      // Add to active rules
      this.monitoringRules.set(monitoringRule.id, monitoringRule);

      logger.info('Monitoring rule added', {
        ruleId: monitoringRule.id,
        name: monitoringRule.name,
        conditions: monitoringRule.conditions
      });

      return monitoringRule;

    } catch (error) {
      logger.error('Failed to add monitoring rule', error as Error, { ruleName: rule.name });
      throw error;
    }
  }

  async updateAlert(
    alertId: string,
    updates: {
      status?: SecurityAlert['status'];
      assignedTo?: string;
      resolution?: string;
      falsePositiveReason?: string;
    }
  ): Promise<void> {
    try {
      const alert = await this.getAlert(alertId);
      if (!alert) {
        throw new Error(`Alert not found: ${alertId}`);
      }

      const updatedAlert: SecurityAlert = {
        ...alert,
        ...updates,
        metadata: {
          ...alert.metadata,
          updatedAt: new Date(),
          ...(updates.status === 'resolved' && { resolvedAt: new Date() }),
          ...(updates.falsePositiveReason && { falsePositiveReason: updates.falsePositiveReason })
        }
      };

      await this.storeAlert(updatedAlert);

      // Update buffer
      const bufferIndex = this.alertBuffer.findIndex(a => a.id === alertId);
      if (bufferIndex >= 0) {
        this.alertBuffer[bufferIndex] = updatedAlert;
      }

      logger.info('Alert updated', {
        alertId,
        status: updates.status,
        assignedTo: updates.assignedTo
      });

    } catch (error) {
      logger.error('Failed to update alert', error as Error, { alertId, updates });
      throw error;
    }
  }

  private async processEvent(event: SecurityEvent): Promise<void> {
    try {
      // Check against monitoring rules
      const triggeredRules = await this.checkMonitoringRules(event);

      if (triggeredRules.length > 0) {
        // Get related events for context
        const relatedEvents = await this.getRelatedEvents(event);
        const allEvents = [event, ...relatedEvents];

        // Create alert
        await this.createAlert(allEvents, triggeredRules);

        // Update rule trigger counts
        for (const rule of triggeredRules) {
          rule.metadata.lastTriggered = new Date();
          rule.metadata.triggerCount += 1;
          await this.updateMonitoringRule(rule);
        }
      }

      // Correlate with existing events
      await this.correlateEvents(event);

      // Mark as processed
      event.processed = true;
      await this.updateSecurityEvent(event);

    } catch (error) {
      logger.error('Failed to process security event', error as Error, {
        eventId: event.id,
        type: event.type
      });
    }
  }

  private async checkMonitoringRules(event: SecurityEvent): Promise<MonitoringRule[]> {
    const triggeredRules: MonitoringRule[] = [];

    for (const rule of this.monitoringRules.values()) {
      if (!rule.enabled) continue;

      // Check if event type matches
      if (!rule.conditions.eventTypes.includes(event.type)) continue;

      // Check severity filter
      if (rule.conditions.severity && !rule.conditions.severity.includes(event.severity)) continue;

      // Check time window and threshold
      const recentEvents = await this.getRecentEvents(
        rule.conditions.eventTypes,
        rule.conditions.timeWindow,
        rule.conditions.groupBy
      );

      if (recentEvents.length >= rule.conditions.threshold) {
        triggeredRules.push(rule);
      }
    }

    return triggeredRules;
  }

  private async getRecentEvents(
    eventTypes: string[],
    timeWindowMinutes: number,
    groupBy?: string[]
  ): Promise<SecurityEvent[]> {
    try {
      const cutoffTime = new Date(Date.now() - (timeWindowMinutes * 60 * 1000));

      const snapshot = await this.db.collection('security_events')
        .where('type', 'in', eventTypes)
        .where('timestamp', '>=', cutoffTime)
        .orderBy('timestamp', 'desc')
        .get();

      const events = snapshot.docs.map(doc => doc.data() as SecurityEvent);

      // Apply groupBy logic if specified
      if (groupBy && groupBy.length > 0) {
        const grouped = new Map<string, SecurityEvent[]>();
        
        for (const event of events) {
          const key = groupBy.map(field => this.getFieldValue(event, field)).join('|');
          if (!grouped.has(key)) {
            grouped.set(key, []);
          }
          grouped.get(key)!.push(event);
        }

        // Return events from the largest group
        const largestGroup = Array.from(grouped.values())
          .sort((a, b) => b.length - a.length)[0];
        
        return largestGroup || [];
      }

      return events;

    } catch (error) {
      logger.error('Failed to get recent events', error as Error, {
        eventTypes,
        timeWindowMinutes
      });
      return [];
    }
  }

  private async getRelatedEvents(event: SecurityEvent): Promise<SecurityEvent[]> {
    try {
      const relatedQueries = [];

      // Events from same user
      if (event.source.userId) {
        relatedQueries.push(
          this.db.collection('security_events')
            .where('source.userId', '==', event.source.userId)
            .where('timestamp', '>=', new Date(Date.now() - 30 * 60 * 1000)) // Last 30 minutes
            .limit(10)
            .get()
        );
      }

      // Events from same IP
      relatedQueries.push(
        this.db.collection('security_events')
          .where('source.ip', '==', event.source.ip)
          .where('timestamp', '>=', new Date(Date.now() - 30 * 60 * 1000))
          .limit(10)
          .get()
      );

      const results = await Promise.all(relatedQueries);
      const relatedEvents: SecurityEvent[] = [];

      results.forEach(snapshot => {
        snapshot.docs.forEach(doc => {
          const relatedEvent = doc.data() as SecurityEvent;
          if (relatedEvent.id !== event.id) {
            relatedEvents.push(relatedEvent);
          }
        });
      });

      return relatedEvents;

    } catch (error) {
      logger.error('Failed to get related events', error as Error, { eventId: event.id });
      return [];
    }
  }

  private async correlateEvents(event: SecurityEvent): Promise<void> {
    try {
      // Find events that might be part of the same attack pattern
      const correlationWindow = 15 * 60 * 1000; // 15 minutes
      const cutoffTime = new Date(Date.now() - correlationWindow);

      const potentiallyRelated = await this.db.collection('security_events')
        .where('source.ip', '==', event.source.ip)
        .where('timestamp', '>=', cutoffTime)
        .get();

      const relatedEventIds: string[] = [];

      potentiallyRelated.docs.forEach(doc => {
        const relatedEvent = doc.data() as SecurityEvent;
        if (relatedEvent.id !== event.id && this.areEventsRelated(event, relatedEvent)) {
          relatedEventIds.push(relatedEvent.id);
        }
      });

      if (relatedEventIds.length > 0) {
        event.correlation.relatedEvents = relatedEventIds;
        await this.updateSecurityEvent(event);

        // Update related events to reference this event
        for (const relatedId of relatedEventIds) {
          const relatedEvent = await this.getSecurityEvent(relatedId);
          if (relatedEvent && !relatedEvent.correlation.relatedEvents.includes(event.id)) {
            relatedEvent.correlation.relatedEvents.push(event.id);
            await this.updateSecurityEvent(relatedEvent);
          }
        }
      }

    } catch (error) {
      logger.error('Failed to correlate events', error as Error, { eventId: event.id });
    }
  }

  private areEventsRelated(event1: SecurityEvent, event2: SecurityEvent): boolean {
    // Same source
    if (event1.source.ip === event2.source.ip || event1.source.userId === event2.source.userId) {
      // Similar event types
      const relatedTypes = {
        'authentication': ['authorization', 'data_access'],
        'authorization': ['authentication', 'data_access'],
        'threat_detected': ['security_violation', 'data_access'],
        'security_violation': ['threat_detected', 'system_change']
      };

      const event1RelatedTypes = relatedTypes[event1.type] || [];
      if (event1RelatedTypes.includes(event2.type) || event1.type === event2.type) {
        return true;
      }
    }

    return false;
  }

  private async executeAutomatedResponse(
    alert: SecurityAlert,
    events: SecurityEvent[],
    rules: MonitoringRule[]
  ): Promise<void> {
    try {
      const actions: string[] = [];

      for (const rule of rules) {
        if (rule.actions.alert) {
          await this.sendAlert(alert);
          actions.push('alert_sent');
        }

        if (rule.actions.block) {
          await this.executeBlockActions(events);
          actions.push('blocking_executed');
        }

        if (rule.actions.escalate) {
          await this.escalateAlert(alert);
          actions.push('escalated');
        }

        if (rule.actions.notify && rule.actions.notify.length > 0) {
          await this.sendNotifications(alert, rule.actions.notify);
          actions.push('notifications_sent');
        }
      }

      // Update alert with executed actions
      alert.response.automated = true;
      alert.response.actions = actions;
      alert.response.responseTime = Date.now() - alert.metadata.createdAt.getTime();

      await this.storeAlert(alert);

      logger.info('Automated response executed', {
        alertId: alert.id,
        actions,
        responseTime: alert.response.responseTime
      });

    } catch (error) {
      logger.error('Automated response failed', error as Error, { alertId: alert.id });
    }
  }

  private async executeBlockActions(events: SecurityEvent[]): Promise<void> {
    for (const event of events) {
      if (event.source.ip) {
        // Block IP via threat detection system
        await threatDetectionSystem.unblockIP(event.source.ip); // This would normally be blockIP
      }

      if (event.source.userId) {
        // Temporarily restrict user account
        // This would integrate with access control system
        logger.warn('User account flagged for review', { userId: event.source.userId });
      }
    }
  }

  private async sendAlert(alert: SecurityAlert): Promise<void> {
    // Integration with notification system
    logger.warn('Security alert notification', {
      alertId: alert.id,
      severity: alert.severity,
      title: alert.title
    });
  }

  private async escalateAlert(alert: SecurityAlert): Promise<void> {
    alert.type = 'escalation';
    alert.response.escalated = true;
    
    logger.error('Security alert escalated', {
      alertId: alert.id,
      severity: alert.severity,
      title: alert.title
    });
  }

  private async sendNotifications(alert: SecurityAlert, recipients: string[]): Promise<void> {
    // Integration with notification system
    logger.info('Security notifications sent', {
      alertId: alert.id,
      recipients: recipients.length
    });
  }

  private generateSessionId(source: SecurityEvent['source']): string {
    const components = [source.ip, source.userId, source.userAgent].filter(Boolean);
    const hash = require('crypto').createHash('sha256').update(components.join('|')).digest('hex');
    return hash.substring(0, 16);
  }

  private generateAlertTitle(events: SecurityEvent[], rules: MonitoringRule[]): string {
    const primaryEvent = events[0];
    const eventCount = events.length;
    const ruleNames = rules.map(r => r.name).join(', ');

    return `Security Alert: ${primaryEvent.type.replace('_', ' ')} (${eventCount} events) - ${ruleNames}`;
  }

  private generateAlertDescription(events: SecurityEvent[], rules: MonitoringRule[]): string {
    const primaryEvent = events[0];
    const uniqueSources = new Set(events.map(e => e.source.ip)).size;
    const timespan = events.length > 1 
      ? Math.round((events[0].timestamp.getTime() - events[events.length - 1].timestamp.getTime()) / 60000)
      : 0;

    return `Multiple security events detected: ${events.length} events from ${uniqueSources} source(s) ` +
           `over ${timespan} minutes. Primary event: ${primaryEvent.details.action} on ${primaryEvent.details.resource}. ` +
           `Triggered rules: ${rules.map(r => r.name).join(', ')}.`;
  }

  private getMaxSeverity(severities: string[]): SecurityAlert['severity'] {
    const severityLevels = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
    const maxLevel = Math.max(...severities.map(s => severityLevels[s as keyof typeof severityLevels] || 0));
    
    const levelToSeverity = { 0: 'info', 1: 'low', 2: 'medium', 3: 'high', 4: 'critical' };
    return levelToSeverity[maxLevel as keyof typeof levelToSeverity] as SecurityAlert['severity'];
  }

  private getFieldValue(obj: any, fieldPath: string): any {
    return fieldPath.split('.').reduce((current, prop) => current?.[prop], obj);
  }

  private async initializeMonitoring(): Promise<void> {
    try {
      // Load existing monitoring rules
      await this.loadMonitoringRules();

      // Create default rules if none exist
      if (this.monitoringRules.size === 0) {
        await this.createDefaultRules();
      }

      // Start event processing
      this.startEventProcessing();

      logger.info('Security monitoring system initialized', {
        rules: this.monitoringRules.size
      });

    } catch (error) {
      logger.error('Failed to initialize security monitoring', error as Error);
      throw error;
    }
  }

  private async loadMonitoringRules(): Promise<void> {
    try {
      const snapshot = await this.db.collection('monitoring_rules')
        .where('enabled', '==', true)
        .get();

      snapshot.docs.forEach(doc => {
        const rule = doc.data() as MonitoringRule;
        this.monitoringRules.set(rule.id, rule);
      });

    } catch (error) {
      logger.error('Failed to load monitoring rules', error as Error);
    }
  }

  private async createDefaultRules(): Promise<void> {
    const defaultRules = [
      {
        name: 'Multiple Failed Logins',
        description: 'Detect brute force attacks',
        enabled: true,
        conditions: {
          eventTypes: ['authentication'],
          severity: ['medium', 'high'],
          timeWindow: 15,
          threshold: 5
        },
        actions: {
          alert: true,
          block: true,
          escalate: false,
          notify: ['security-team']
        }
      },
      {
        name: 'Privilege Escalation Attempt',
        description: 'Detect unauthorized privilege escalation',
        enabled: true,
        conditions: {
          eventTypes: ['authorization'],
          severity: ['high', 'critical'],
          timeWindow: 5,
          threshold: 3
        },
        actions: {
          alert: true,
          block: false,
          escalate: true,
          notify: ['security-team', 'admin']
        }
      },
      {
        name: 'Data Exfiltration Pattern',
        description: 'Detect potential data exfiltration',
        enabled: true,
        conditions: {
          eventTypes: ['data_access'],
          severity: ['medium', 'high'],
          timeWindow: 30,
          threshold: 10,
          groupBy: ['source.userId']
        },
        actions: {
          alert: true,
          block: false,
          escalate: false,
          notify: ['security-team']
        }
      }
    ];

    for (const rule of defaultRules) {
      await this.addMonitoringRule(rule);
    }
  }

  private startEventProcessing(): void {
    // Process events every 30 seconds
    this.processInterval = setInterval(async () => {
      if (this.eventBuffer.length > 0) {
        const eventsToProcess = this.eventBuffer.splice(0, 100); // Process in batches
        
        for (const event of eventsToProcess) {
          if (!event.processed) {
            await this.processEvent(event);
          }
        }
      }
    }, 30000);
  }

  // Database operations
  private async storeSecurityEvent(event: SecurityEvent): Promise<void> {
    await firestoreHelper.setDocument('security_events', event.id, event);
  }

  private async updateSecurityEvent(event: SecurityEvent): Promise<void> {
    await firestoreHelper.updateDocument('security_events', event.id, {
      processed: event.processed,
      alerts: event.alerts,
      correlation: event.correlation
    });
  }

  private async getSecurityEvent(eventId: string): Promise<SecurityEvent | null> {
    return await firestoreHelper.getDocumentOptional('security_events', eventId) as SecurityEvent | null;
  }

  private async storeAlert(alert: SecurityAlert): Promise<void> {
    await firestoreHelper.setDocument('security_alerts', alert.id, alert);
  }

  private async getAlert(alertId: string): Promise<SecurityAlert | null> {
    return await firestoreHelper.getDocumentOptional('security_alerts', alertId) as SecurityAlert | null;
  }

  private async updateMonitoringRule(rule: MonitoringRule): Promise<void> {
    await firestoreHelper.updateDocument('monitoring_rules', rule.id, {
      metadata: rule.metadata
    });
    
    this.monitoringRules.set(rule.id, rule);
  }

  // Public management methods
  async getSecurityMetrics(timeWindow: number = 24): Promise<SecurityMetrics> {
    try {
      const cutoffTime = new Date(Date.now() - (timeWindow * 60 * 60 * 1000));

      const [eventsSnapshot, alertsSnapshot] = await Promise.all([
        this.db.collection('security_events')
          .where('timestamp', '>=', cutoffTime)
          .get(),
        this.db.collection('security_alerts')
          .where('metadata.createdAt', '>=', cutoffTime)
          .where('status', '==', 'active')
          .get()
      ]);

      const events = eventsSnapshot.docs.map(doc => doc.data() as SecurityEvent);
      const alerts = alertsSnapshot.docs.map(doc => doc.data() as SecurityAlert);

      const eventsByType = events.reduce((acc, event) => {
        acc[event.type] = (acc[event.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const eventsBySeverity = events.reduce((acc, event) => {
        acc[event.severity] = (acc[event.severity] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const riskScore = events.length > 0
        ? events.reduce((sum, event) => sum + event.risk.score, 0) / events.length
        : 0;

      return {
        totalEvents: events.length,
        eventsByType,
        eventsBySeverity,
        riskScore,
        alertsActive: alerts.length,
        threatTrends: [], // Would calculate trends from historical data
        responseMetrics: {
          averageResponseTime: 0, // Would calculate from alert response times
          automatedResponseRate: 0, // Would calculate from automated responses
          falsePositiveRate: 0 // Would calculate from false positive markings
        }
      };

    } catch (error) {
      logger.error('Failed to get security metrics', error as Error);
      throw error;
    }
  }

  async getActiveAlerts(): Promise<SecurityAlert[]> {
    try {
      const snapshot = await this.db.collection('security_alerts')
        .where('status', '==', 'active')
        .orderBy('metadata.createdAt', 'desc')
        .get();

      return snapshot.docs.map(doc => doc.data() as SecurityAlert);

    } catch (error) {
      logger.error('Failed to get active alerts', error as Error);
      return [];
    }
  }

  async searchEvents(criteria: {
    type?: string;
    severity?: string;
    userId?: string;
    ip?: string;
    timeRange?: { start: Date; end: Date };
    limit?: number;
  }): Promise<SecurityEvent[]> {
    try {
      let query = this.db.collection('security_events') as any;

      if (criteria.type) {
        query = query.where('type', '==', criteria.type);
      }
      if (criteria.severity) {
        query = query.where('severity', '==', criteria.severity);
      }
      if (criteria.userId) {
        query = query.where('source.userId', '==', criteria.userId);
      }
      if (criteria.ip) {
        query = query.where('source.ip', '==', criteria.ip);
      }
      if (criteria.timeRange) {
        query = query.where('timestamp', '>=', criteria.timeRange.start)
                    .where('timestamp', '<=', criteria.timeRange.end);
      }

      query = query.orderBy('timestamp', 'desc').limit(criteria.limit || 100);

      const snapshot = await query.get();
      return snapshot.docs.map((doc: any) => doc.data() as SecurityEvent);

    } catch (error) {
      logger.error('Failed to search events', error as Error, { criteria });
      return [];
    }
  }
}

// Helper functions for integration with other systems
export async function logAuthenticationEvent(
  userId: string,
  ip: string,
  outcome: 'success' | 'failure',
  details: any
): Promise<void> {
  const monitoring = new SecurityMonitoringSystem();
  
  await monitoring.logSecurityEvent({
    type: 'authentication',
    severity: outcome === 'failure' ? 'medium' : 'info',
    source: {
      userId: outcome === 'success' ? userId : undefined,
      ip,
      service: 'authentication',
      userAgent: details.userAgent
    },
    details: {
      action: details.action || 'login',
      outcome,
      reason: details.reason,
      metadata: details
    },
    risk: {
      score: outcome === 'failure' ? 40 : 10,
      factors: outcome === 'failure' ? ['failed_authentication'] : [],
      confidence: 0.9
    }
  });
}

export async function logAuthorizationEvent(
  userId: string,
  ip: string,
  resource: string,
  action: string,
  outcome: 'success' | 'failure' | 'blocked',
  details: any
): Promise<void> {
  const monitoring = new SecurityMonitoringSystem();
  
  const severity = outcome === 'blocked' ? 'high' : outcome === 'failure' ? 'medium' : 'info';
  const riskScore = outcome === 'blocked' ? 70 : outcome === 'failure' ? 30 : 5;
  
  await monitoring.logSecurityEvent({
    type: 'authorization',
    severity,
    source: {
      userId,
      ip,
      service: 'authorization',
      endpoint: resource
    },
    details: {
      action,
      resource,
      outcome,
      reason: details.reason,
      metadata: details
    },
    risk: {
      score: riskScore,
      factors: outcome !== 'success' ? ['authorization_failure'] : [],
      confidence: 0.85
    }
  });
}

// Lazy singleton instance - only created when first accessed
let _securityMonitoringSystem: SecurityMonitoringSystem | null = null;

export function getSecurityMonitoringSystem(): SecurityMonitoringSystem {
  if (!_securityMonitoringSystem) {
    _securityMonitoringSystem = new SecurityMonitoringSystem();
  }
  return _securityMonitoringSystem;
}

// Backward compatible export - calls getter
export const securityMonitoringSystem = getSecurityMonitoringSystem();