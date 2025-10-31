import { getFirestore } from 'firebase-admin/firestore';
import { logger } from '../utils/logger';
import { firestoreHelper } from '../utils/firestore';
import { securityMonitoringSystem } from '../security/securityMonitoring';

export interface AuditEvent {
  id: string;
  timestamp: Date;
  eventType: 'create' | 'read' | 'update' | 'delete' | 'login' | 'logout' | 'access' | 'admin' | 'system' | 'compliance';
  category: 'user_management' | 'data_access' | 'system_config' | 'security' | 'financial' | 'project_management' | 'authentication' | 'authorization';
  actor: {
    type: 'user' | 'system' | 'service' | 'anonymous';
    id: string;
    name?: string;
    email?: string;
    roles?: string[];
    ip?: string;
    userAgent?: string;
  };
  target: {
    type: 'user' | 'project' | 'donation' | 'document' | 'setting' | 'role' | 'permission' | 'system';
    id: string;
    name?: string;
    classification?: 'public' | 'internal' | 'confidential' | 'restricted';
  };
  action: {
    operation: string;
    description: string;
    outcome: 'success' | 'failure' | 'partial';
    reason?: string;
  };
  context: {
    sessionId?: string;
    requestId?: string;
    service: string;
    endpoint?: string;
    method?: string;
    source: 'web' | 'mobile' | 'api' | 'admin' | 'system' | 'background';
  };
  changes?: {
    before?: any;
    after?: any;
    fields?: string[];
  };
  compliance: {
    regulations: string[]; // GDPR, PCI DSS, SOX, etc.
    retention: {
      period: number; // days
      reason: string;
    };
    sensitivity: 'low' | 'medium' | 'high' | 'critical';
  };
  metadata: {
    correlationId?: string;
    parentEventId?: string;
    businessProcess?: string;
    tags: string[];
  };
}

export interface ComplianceReport {
  id: string;
  type: 'gdpr' | 'pci_dss' | 'sox' | 'custom';
  title: string;
  description: string;
  timeRange: {
    start: Date;
    end: Date;
  };
  generatedAt: Date;
  generatedBy: string;
  status: 'draft' | 'completed' | 'approved' | 'archived';
  
  summary: {
    totalEvents: number;
    eventsByCategory: Record<string, number>;
    complianceViolations: number;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
  };
  
  findings: ComplianceFinding[];
  recommendations: ComplianceRecommendation[];
  
  evidence: {
    auditTrail: string[]; // Audit event IDs
    documents: string[];
    screenshots: string[];
  };
  
  attestation?: {
    attestedBy: string;
    attestedAt: Date;
    signature: string;
    comments?: string;
  };
}

export interface ComplianceFinding {
  id: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  type: 'violation' | 'risk' | 'gap' | 'observation';
  regulation: string;
  requirement: string;
  description: string;
  evidence: string[];
  impact: string;
  likelihood: 'low' | 'medium' | 'high';
  status: 'open' | 'in_progress' | 'resolved' | 'accepted_risk';
  assignedTo?: string;
  dueDate?: Date;
}

export interface ComplianceRecommendation {
  id: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  category: 'technical' | 'procedural' | 'training' | 'policy';
  title: string;
  description: string;
  implementation: {
    effort: 'low' | 'medium' | 'high';
    cost: 'low' | 'medium' | 'high';
    timeframe: string;
    resources: string[];
  };
  benefits: string[];
  risks: string[];
}

export interface DataSubjectRequest {
  id: string;
  type: 'access' | 'rectification' | 'erasure' | 'portability' | 'restriction' | 'objection';
  status: 'received' | 'verified' | 'processing' | 'completed' | 'rejected';
  requestDate: Date;
  completionDate?: Date;
  
  subject: {
    id: string;
    email: string;
    name?: string;
    identityVerified: boolean;
  };
  
  details: {
    description: string;
    scope: string[];
    reason?: string;
    legalBasis?: string;
  };
  
  processing: {
    assignedTo?: string;
    estimatedCompletion: Date;
    actualEffort?: number; // hours
    complications?: string[];
  };
  
  response: {
    outcome: 'granted' | 'denied' | 'partial';
    reason?: string;
    data?: any;
    format?: 'json' | 'csv' | 'pdf';
    deliveryMethod: 'email' | 'portal' | 'mail';
  };
  
  auditTrail: string[]; // Related audit event IDs
}

export interface RetentionPolicy {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  
  scope: {
    dataTypes: string[];
    categories: string[];
    sources: string[];
  };
  
  retention: {
    period: number; // days
    trigger: 'creation_date' | 'last_access' | 'user_deletion' | 'custom';
    exceptions: RetentionException[];
  };
  
  actions: {
    warning: {
      enabled: boolean;
      daysBeforeExpiry: number;
      recipients: string[];
    };
    deletion: {
      method: 'soft_delete' | 'hard_delete' | 'anonymize';
      verification: boolean;
      backupBeforeDeletion: boolean;
    };
  };
  
  compliance: {
    regulations: string[];
    legalBasis: string;
    justification: string;
  };
  
  metadata: {
    createdAt: Date;
    lastModified: Date;
    version: number;
    approvedBy: string;
  };
}

export interface RetentionException {
  id: string;
  reason: string;
  dataId: string;
  extendedUntil: Date;
  approvedBy: string;
  createdAt: Date;
}

export class AuditLogger {
  private db = getFirestore();
  private eventBuffer: AuditEvent[] = [];
  private retentionPolicies: Map<string, RetentionPolicy> = new Map();
  private processingInterval: NodeJS.Timeout | null = null;

  private auditStats = {
    totalEvents: 0,
    eventsToday: 0,
    highRiskEvents: 0,
    complianceViolations: 0
  };

  constructor() {
    this.initializeAuditLogger();
  }

  async logEvent(eventData: Omit<AuditEvent, 'id' | 'timestamp'>): Promise<AuditEvent> {
    try {
      const auditEvent: AuditEvent = {
        id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
        ...eventData
      };

      // Add to buffer for batch processing
      this.eventBuffer.push(auditEvent);

      // Store immediately for critical events
      if (auditEvent.compliance.sensitivity === 'critical' || 
          auditEvent.action.outcome === 'failure') {
        await this.storeAuditEvent(auditEvent);
      }

      // Update statistics
      this.updateAuditStats(auditEvent);

      // Check for compliance violations
      await this.checkComplianceViolations(auditEvent);

      logger.debug('Audit event logged', {
        eventId: auditEvent.id,
        eventType: auditEvent.eventType,
        category: auditEvent.category,
        actor: auditEvent.actor.id,
        target: auditEvent.target.id
      });

      return auditEvent;

    } catch (error) {
      logger.error('Failed to log audit event', error as Error, {
        eventType: eventData.eventType,
        category: eventData.category
      });
      throw error;
    }
  }

  async logUserAction(
    userId: string,
    action: string,
    targetType: string,
    targetId: string,
    outcome: 'success' | 'failure',
    context: Partial<AuditEvent['context']> = {},
    changes?: AuditEvent['changes']
  ): Promise<AuditEvent> {
    return await this.logEvent({
      eventType: this.getEventTypeFromAction(action),
      category: this.getCategoryFromTarget(targetType),
      actor: {
        type: 'user',
        id: userId,
        ip: context.source === 'web' ? '127.0.0.1' : undefined // Would get from request
      },
      target: {
        type: targetType as AuditEvent['target']['type'],
        id: targetId,
        classification: this.getDataClassification(targetType)
      },
      action: {
        operation: action,
        description: `User ${action} ${targetType}`,
        outcome,
        reason: outcome === 'failure' ? 'Operation failed' : undefined
      },
      context: {
        service: 'social-impact-platform',
        source: 'web',
        ...context
      },
      changes,
      compliance: {
        regulations: this.getApplicableRegulations(targetType, action),
        retention: {
          period: this.getRetentionPeriod(targetType),
          reason: 'Business and legal requirements'
        },
        sensitivity: this.getSensitivityLevel(targetType, action)
      },
      metadata: {
        tags: [action, targetType, outcome]
      }
    });
  }

  async logSystemEvent(
    service: string,
    operation: string,
    targetType: string,
    targetId: string,
    outcome: 'success' | 'failure',
    details?: any
  ): Promise<AuditEvent> {
    return await this.logEvent({
      eventType: 'system',
      category: 'system_config',
      actor: {
        type: 'system',
        id: service,
        name: service
      },
      target: {
        type: targetType as AuditEvent['target']['type'],
        id: targetId
      },
      action: {
        operation,
        description: `System ${operation} on ${targetType}`,
        outcome
      },
      context: {
        service,
        source: 'system'
      },
      compliance: {
        regulations: ['SOX'],
        retention: {
          period: 2555, // 7 years for SOX
          reason: 'SOX compliance requirement'
        },
        sensitivity: 'medium'
      },
      metadata: {
        tags: ['system', operation, targetType],
        businessProcess: details?.process
      }
    });
  }

  async logComplianceEvent(
    regulation: string,
    requirement: string,
    status: 'compliant' | 'violation' | 'risk',
    details: any
  ): Promise<AuditEvent> {
    return await this.logEvent({
      eventType: 'compliance',
      category: 'security',
      actor: {
        type: 'system',
        id: 'compliance-monitor'
      },
      target: {
        type: 'system',
        id: regulation,
        name: requirement
      },
      action: {
        operation: 'compliance_check',
        description: `${regulation} compliance check: ${requirement}`,
        outcome: status === 'compliant' ? 'success' : 'failure'
      },
      context: {
        service: 'compliance-system',
        source: 'system'
      },
      compliance: {
        regulations: [regulation],
        retention: {
          period: this.getComplianceRetentionPeriod(regulation),
          reason: `${regulation} audit trail requirement`
        },
        sensitivity: status === 'violation' ? 'critical' : 'medium'
      },
      metadata: {
        tags: ['compliance', regulation, status],
        businessProcess: 'compliance-monitoring'
      }
    });
  }

  async generateComplianceReport(
    type: ComplianceReport['type'],
    timeRange: { start: Date; end: Date },
    generatedBy: string
  ): Promise<ComplianceReport> {
    try {
      const reportId = `report_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Get relevant audit events
      const auditEvents = await this.getAuditEvents(timeRange, type);
      
      // Analyze events for compliance
      const findings = await this.analyzeCompliance(auditEvents, type);
      const recommendations = await this.generateRecommendations(findings);
      
      const report: ComplianceReport = {
        id: reportId,
        type,
        title: `${type.toUpperCase()} Compliance Report`,
        description: `Compliance report for ${type} covering ${timeRange.start.toISOString().split('T')[0]} to ${timeRange.end.toISOString().split('T')[0]}`,
        timeRange,
        generatedAt: new Date(),
        generatedBy,
        status: 'completed',
        
        summary: {
          totalEvents: auditEvents.length,
          eventsByCategory: this.categorizeEvents(auditEvents),
          complianceViolations: findings.filter(f => f.type === 'violation').length,
          riskLevel: this.calculateOverallRisk(findings)
        },
        
        findings,
        recommendations,
        
        evidence: {
          auditTrail: auditEvents.map(e => e.id),
          documents: [],
          screenshots: []
        }
      };

      // Store report
      await this.storeComplianceReport(report);

      // Log report generation
      await this.logSystemEvent(
        'audit-system',
        'generate_compliance_report',
        'document',
        reportId,
        'success',
        { reportType: type, timeRange }
      );

      logger.info('Compliance report generated', {
        reportId,
        type,
        timeRange,
        eventCount: auditEvents.length,
        findingCount: findings.length
      });

      return report;

    } catch (error) {
      logger.error('Failed to generate compliance report', error as Error, { type, timeRange });
      throw error;
    }
  }

  async handleDataSubjectRequest(requestData: Omit<DataSubjectRequest, 'id' | 'requestDate' | 'status' | 'auditTrail'>): Promise<DataSubjectRequest> {
    try {
      const request: DataSubjectRequest = {
        id: `dsr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        requestDate: new Date(),
        status: 'received',
        auditTrail: [],
        ...requestData
      };

      // Store request
      await this.storeDataSubjectRequest(request);

      // Log the request
      const auditEvent = await this.logEvent({
        eventType: 'read',
        category: 'data_access',
        actor: {
          type: 'user',
          id: request.subject.id,
          email: request.subject.email
        },
        target: {
          type: 'user',
          id: request.subject.id,
          classification: 'confidential'
        },
        action: {
          operation: `data_subject_request_${request.type}`,
          description: `Data subject ${request.type} request submitted`,
          outcome: 'success'
        },
        context: {
          service: 'privacy-system',
          source: 'web'
        },
        compliance: {
          regulations: ['GDPR'],
          retention: {
            period: 2555, // 7 years
            reason: 'GDPR audit trail requirement'
          },
          sensitivity: 'high'
        },
        metadata: {
          tags: ['data_subject_request', request.type, 'gdpr'],
          correlationId: request.id
        }
      });

      request.auditTrail.push(auditEvent.id);

      // Auto-assign based on request type
      await this.assignDataSubjectRequest(request);

      logger.info('Data subject request received', {
        requestId: request.id,
        type: request.type,
        subjectId: request.subject.id
      });

      return request;

    } catch (error) {
      logger.error('Failed to handle data subject request', error as Error, {
        requestType: requestData.type,
        subjectId: requestData.subject.id
      });
      throw error;
    }
  }

  async createRetentionPolicy(policyData: Omit<RetentionPolicy, 'id' | 'metadata'>): Promise<RetentionPolicy> {
    try {
      const policy: RetentionPolicy = {
        id: `retention_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        ...policyData,
        metadata: {
          createdAt: new Date(),
          lastModified: new Date(),
          version: 1,
          approvedBy: 'system-admin'
        }
      };

      // Store policy
      await this.storeRetentionPolicy(policy);
      this.retentionPolicies.set(policy.id, policy);

      // Log policy creation
      await this.logSystemEvent(
        'audit-system',
        'create_retention_policy',
        'document',
        policy.id,
        'success',
        { policyName: policy.name }
      );

      logger.info('Retention policy created', {
        policyId: policy.id,
        name: policy.name,
        retentionPeriod: policy.retention.period
      });

      return policy;

    } catch (error) {
      logger.error('Failed to create retention policy', error as Error, {
        policyName: policyData.name
      });
      throw error;
    }
  }

  async executeRetentionPolicies(): Promise<void> {
    try {
      let processedRecords = 0;
      let deletedRecords = 0;

      for (const policy of this.retentionPolicies.values()) {
        if (!policy.enabled) continue;

        const expiredData = await this.findExpiredData(policy);
        processedRecords += expiredData.length;

        for (const dataRecord of expiredData) {
          try {
            // Send warning if configured
            if (policy.actions.warning.enabled) {
              await this.sendRetentionWarning(policy, dataRecord);
            }

            // Execute deletion
            const deleted = await this.executeDataDeletion(policy, dataRecord);
            if (deleted) {
              deletedRecords++;
            }

            // Log retention action
            await this.logSystemEvent(
              'retention-system',
              'data_retention_action',
              'data',
              dataRecord.id,
              deleted ? 'success' : 'failure',
              { policyId: policy.id, action: policy.actions.deletion.method }
            );

          } catch (error) {
            logger.error('Failed to execute retention action', error as Error, {
              policyId: policy.id,
              dataId: dataRecord.id
            });
          }
        }
      }

      logger.info('Retention policies executed', {
        processedRecords,
        deletedRecords,
        activePolicies: Array.from(this.retentionPolicies.values()).filter(p => p.enabled).length
      });

    } catch (error) {
      logger.error('Failed to execute retention policies', error as Error);
    }
  }

  async searchAuditEvents(criteria: {
    actor?: string;
    eventType?: string;
    category?: string;
    targetType?: string;
    targetId?: string;
    timeRange?: { start: Date; end: Date };
    outcome?: string;
    regulations?: string[];
    limit?: number;
  }): Promise<AuditEvent[]> {
    try {
      let query = this.db.collection('audit_events') as any;

      if (criteria.actor) {
        query = query.where('actor.id', '==', criteria.actor);
      }
      if (criteria.eventType) {
        query = query.where('eventType', '==', criteria.eventType);
      }
      if (criteria.category) {
        query = query.where('category', '==', criteria.category);
      }
      if (criteria.targetType) {
        query = query.where('target.type', '==', criteria.targetType);
      }
      if (criteria.targetId) {
        query = query.where('target.id', '==', criteria.targetId);
      }
      if (criteria.timeRange) {
        query = query.where('timestamp', '>=', criteria.timeRange.start)
                    .where('timestamp', '<=', criteria.timeRange.end);
      }
      if (criteria.outcome) {
        query = query.where('action.outcome', '==', criteria.outcome);
      }

      query = query.orderBy('timestamp', 'desc').limit(criteria.limit || 100);

      const snapshot = await query.get();
      return snapshot.docs.map((doc: any) => doc.data() as AuditEvent);

    } catch (error) {
      logger.error('Failed to search audit events', error as Error, { criteria });
      return [];
    }
  }

  private async updateAuditStats(event: AuditEvent): Promise<void> {
    this.auditStats.totalEvents++;
    
    const today = new Date().toISOString().split('T')[0];
    const eventDate = event.timestamp.toISOString().split('T')[0];
    
    if (eventDate === today) {
      this.auditStats.eventsToday++;
    }

    if (event.compliance.sensitivity === 'critical' || 
        event.compliance.sensitivity === 'high') {
      this.auditStats.highRiskEvents++;
    }

    if (event.action.outcome === 'failure') {
      this.auditStats.complianceViolations++;
    }
  }

  private async checkComplianceViolations(event: AuditEvent): Promise<void> {
    // Check for suspicious patterns
    if (event.action.outcome === 'failure' && 
        event.compliance.sensitivity === 'critical') {
      
      await securityMonitoringSystem.logSecurityEvent({
        type: 'security_violation',
        severity: 'high',
        source: {
          userId: event.actor.id,
          ip: event.actor.ip || '127.0.0.1',
          service: event.context.service
        },
        details: {
          action: event.action.operation,
          outcome: 'blocked',
          resource: event.target.id,
          metadata: {
            auditEventId: event.id,
            regulations: event.compliance.regulations
          }
        },
        risk: {
          score: 80,
          factors: ['compliance_violation', 'critical_data_access'],
          confidence: 0.9
        }
      });
    }

    // Check for data access violations
    if (event.category === 'data_access' && 
        event.target.classification === 'restricted' &&
        !event.actor.roles?.includes('admin')) {
      
      this.auditStats.complianceViolations++;
      
      logger.warn('Potential compliance violation detected', {
        eventId: event.id,
        actor: event.actor.id,
        target: event.target.id,
        classification: event.target.classification
      });
    }
  }

  private getEventTypeFromAction(action: string): AuditEvent['eventType'] {
    const actionMap: Record<string, AuditEvent['eventType']> = {
      'create': 'create',
      'read': 'read',
      'update': 'update',
      'delete': 'delete',
      'login': 'login',
      'logout': 'logout',
      'access': 'access',
      'admin': 'admin'
    };
    
    return actionMap[action] || 'access';
  }

  private getCategoryFromTarget(targetType: string): AuditEvent['category'] {
    const categoryMap: Record<string, AuditEvent['category']> = {
      'user': 'user_management',
      'project': 'project_management',
      'donation': 'financial',
      'document': 'data_access',
      'setting': 'system_config',
      'role': 'security',
      'permission': 'security'
    };
    
    return categoryMap[targetType] || 'data_access';
  }

  private getDataClassification(targetType: string): AuditEvent['target']['classification'] {
    const classificationMap: Record<string, AuditEvent['target']['classification']> = {
      'user': 'confidential',
      'donation': 'confidential',
      'project': 'internal',
      'document': 'internal',
      'setting': 'restricted'
    };
    
    return classificationMap[targetType] || 'internal';
  }

  private getApplicableRegulations(targetType: string, action: string): string[] {
    const regulations: string[] = [];
    
    if (targetType === 'user' || targetType === 'donation') {
      regulations.push('GDPR');
    }
    
    if (targetType === 'donation') {
      regulations.push('PCI DSS');
    }
    
    if (action === 'admin' || targetType === 'setting') {
      regulations.push('SOX');
    }
    
    return regulations;
  }

  private getRetentionPeriod(targetType: string): number {
    const retentionMap: Record<string, number> = {
      'user': 2555, // 7 years
      'donation': 2555, // 7 years for financial records
      'project': 1825, // 5 years
      'document': 1095, // 3 years
      'setting': 2555 // 7 years for system changes
    };
    
    return retentionMap[targetType] || 1095; // Default 3 years
  }

  private getSensitivityLevel(targetType: string, action: string): AuditEvent['compliance']['sensitivity'] {
    if (targetType === 'donation' || action === 'delete') {
      return 'critical';
    }
    
    if (targetType === 'user' || action === 'admin') {
      return 'high';
    }
    
    if (targetType === 'project' || action === 'update') {
      return 'medium';
    }
    
    return 'low';
  }

  private getComplianceRetentionPeriod(regulation: string): number {
    const retentionMap: Record<string, number> = {
      'GDPR': 2555, // 7 years
      'PCI DSS': 365, // 1 year
      'SOX': 2555, // 7 years
      'HIPAA': 2190 // 6 years
    };
    
    return retentionMap[regulation] || 1095; // Default 3 years
  }

  private async analyzeCompliance(events: AuditEvent[], reportType: string): Promise<ComplianceFinding[]> {
    const findings: ComplianceFinding[] = [];

    // Analyze based on report type
    switch (reportType) {
      case 'gdpr':
        findings.push(...await this.analyzeGDPRCompliance(events));
        break;
      case 'pci_dss':
        findings.push(...await this.analyzePCIDSSCompliance(events));
        break;
      case 'sox':
        findings.push(...await this.analyzeSOXCompliance(events));
        break;
    }

    return findings;
  }

  private async analyzeGDPRCompliance(events: AuditEvent[]): Promise<ComplianceFinding[]> {
    const findings: ComplianceFinding[] = [];

    // Check for data access without legal basis
    const unauthorizedAccess = events.filter(event => 
      event.category === 'data_access' &&
      event.target.classification === 'confidential' &&
      event.action.outcome === 'failure'
    );

    if (unauthorizedAccess.length > 0) {
      findings.push({
        id: `finding_${Date.now()}_1`,
        severity: 'high',
        type: 'violation',
        regulation: 'GDPR',
        requirement: 'Article 6 - Lawfulness of processing',
        description: `${unauthorizedAccess.length} unauthorized access attempts to personal data`,
        evidence: unauthorizedAccess.map(e => e.id),
        impact: 'Potential GDPR violation with regulatory fines',
        likelihood: 'medium',
        status: 'open'
      });
    }

    // Check for excessive data retention
    const oldDataAccess = events.filter(event =>
      event.target.classification === 'confidential' &&
      Date.now() - event.timestamp.getTime() > (7 * 365 * 24 * 60 * 60 * 1000) // 7 years
    );

    if (oldDataAccess.length > 0) {
      findings.push({
        id: `finding_${Date.now()}_2`,
        severity: 'medium',
        type: 'risk',
        regulation: 'GDPR',
        requirement: 'Article 5 - Storage limitation',
        description: 'Personal data retained beyond necessary period',
        evidence: oldDataAccess.map(e => e.id),
        impact: 'Violation of data minimization principle',
        likelihood: 'high',
        status: 'open'
      });
    }

    return findings;
  }

  private async analyzePCIDSSCompliance(events: AuditEvent[]): Promise<ComplianceFinding[]> {
    const findings: ComplianceFinding[] = [];

    // Check for failed payment processing attempts
    const failedPayments = events.filter(event =>
      event.category === 'financial' &&
      event.action.outcome === 'failure'
    );

    if (failedPayments.length > 10) {
      findings.push({
        id: `finding_${Date.now()}_3`,
        severity: 'high',
        type: 'risk',
        regulation: 'PCI DSS',
        requirement: 'Requirement 8 - Identify and authenticate access',
        description: `High number of failed payment attempts: ${failedPayments.length}`,
        evidence: failedPayments.map(e => e.id),
        impact: 'Potential card testing or fraud attempts',
        likelihood: 'medium',
        status: 'open'
      });
    }

    return findings;
  }

  private async analyzeSOXCompliance(events: AuditEvent[]): Promise<ComplianceFinding[]> {
    const findings: ComplianceFinding[] = [];

    // Check for administrative changes without proper approval
    const adminChanges = events.filter(event =>
      event.eventType === 'admin' &&
      !event.metadata.tags.includes('approved')
    );

    if (adminChanges.length > 0) {
      findings.push({
        id: `finding_${Date.now()}_4`,
        severity: 'medium',
        type: 'gap',
        regulation: 'SOX',
        requirement: 'Section 404 - Internal controls',
        description: 'Administrative changes without documented approval process',
        evidence: adminChanges.map(e => e.id),
        impact: 'Lack of proper internal controls over financial reporting',
        likelihood: 'high',
        status: 'open'
      });
    }

    return findings;
  }

  private async generateRecommendations(findings: ComplianceFinding[]): Promise<ComplianceRecommendation[]> {
    const recommendations: ComplianceRecommendation[] = [];

    const highSeverityFindings = findings.filter(f => f.severity === 'high' || f.severity === 'critical');
    
    if (highSeverityFindings.length > 0) {
      recommendations.push({
        id: `rec_${Date.now()}_1`,
        priority: 'high',
        category: 'technical',
        title: 'Implement Enhanced Access Controls',
        description: 'Strengthen access controls and monitoring for sensitive data',
        implementation: {
          effort: 'medium',
          cost: 'medium',
          timeframe: '2-4 weeks',
          resources: ['security-team', 'dev-team']
        },
        benefits: ['Reduced compliance violations', 'Better data protection'],
        risks: ['Initial user friction', 'Implementation complexity']
      });
    }

    const gdprFindings = findings.filter(f => f.regulation === 'GDPR');
    
    if (gdprFindings.length > 0) {
      recommendations.push({
        id: `rec_${Date.now()}_2`,
        priority: 'medium',
        category: 'procedural',
        title: 'Implement Data Retention Automation',
        description: 'Automate data retention and deletion processes',
        implementation: {
          effort: 'high',
          cost: 'medium',
          timeframe: '4-8 weeks',
          resources: ['privacy-team', 'dev-team']
        },
        benefits: ['Automated compliance', 'Reduced manual effort'],
        risks: ['Data loss risk', 'Complex implementation']
      });
    }

    return recommendations;
  }

  private categorizeEvents(events: AuditEvent[]): Record<string, number> {
    const categories: Record<string, number> = {};
    
    for (const event of events) {
      categories[event.category] = (categories[event.category] || 0) + 1;
    }
    
    return categories;
  }

  private calculateOverallRisk(findings: ComplianceFinding[]): ComplianceReport['summary']['riskLevel'] {
    const criticalCount = findings.filter(f => f.severity === 'critical').length;
    const highCount = findings.filter(f => f.severity === 'high').length;
    const mediumCount = findings.filter(f => f.severity === 'medium').length;

    if (criticalCount > 0) return 'critical';
    if (highCount > 3) return 'high';
    if (highCount > 0 || mediumCount > 5) return 'medium';
    return 'low';
  }

  private async assignDataSubjectRequest(request: DataSubjectRequest): Promise<void> {
    // Auto-assign based on request type and workload
    const assigneeMap: Record<string, string> = {
      'access': 'privacy-officer',
      'rectification': 'data-controller',
      'erasure': 'privacy-officer',
      'portability': 'data-controller',
      'restriction': 'privacy-officer',
      'objection': 'privacy-officer'
    };

    request.processing.assignedTo = assigneeMap[request.type] || 'privacy-officer';
    request.processing.estimatedCompletion = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    request.status = 'verified';

    await this.updateDataSubjectRequest(request);

    // Log assignment
    const auditEvent = await this.logSystemEvent(
      'privacy-system',
      'assign_data_subject_request',
      'user',
      request.id,
      'success',
      { assignedTo: request.processing.assignedTo }
    );

    request.auditTrail.push(auditEvent.id);
  }

  private async findExpiredData(policy: RetentionPolicy): Promise<any[]> {
    // Implementation would query data based on policy scope and retention period
    // For now, return empty array as placeholder
    return [];
  }

  private async sendRetentionWarning(policy: RetentionPolicy, dataRecord: any): Promise<void> {
    // Implementation would send notification to recipients
    logger.info('Retention warning sent', {
      policyId: policy.id,
      dataId: dataRecord.id,
      recipients: policy.actions.warning.recipients
    });
  }

  private async executeDataDeletion(policy: RetentionPolicy, dataRecord: any): Promise<boolean> {
    try {
      // Implementation would execute deletion based on policy method
      switch (policy.actions.deletion.method) {
        case 'soft_delete':
          // Mark as deleted but keep data
          break;
        case 'hard_delete':
          // Permanently delete data
          break;
        case 'anonymize':
          // Remove PII but keep anonymized data
          break;
      }

      return true;
    } catch (error) {
      logger.error('Failed to execute data deletion', error as Error, {
        policyId: policy.id,
        dataId: dataRecord.id
      });
      return false;
    }
  }

  // Database operations
  private async storeAuditEvent(event: AuditEvent): Promise<void> {
    try {
      // Store in date-partitioned collection for better performance
      const dateStr = event.timestamp.toISOString().split('T')[0];
      const collectionName = `audit_events_${dateStr.replace(/-/g, '_')}`;
      
      await firestoreHelper.setDocument(collectionName, event.id, event);
      
      // Also store in main collection for queries
      await firestoreHelper.setDocument('audit_events', event.id, event);
    } catch (error) {
      logger.error('Failed to store audit event', error as Error, { eventId: event.id });
    }
  }

  private async storeComplianceReport(report: ComplianceReport): Promise<void> {
    await firestoreHelper.setDocument('compliance_reports', report.id, report);
  }

  private async storeDataSubjectRequest(request: DataSubjectRequest): Promise<void> {
    await firestoreHelper.setDocument('data_subject_requests', request.id, request);
  }

  private async updateDataSubjectRequest(request: DataSubjectRequest): Promise<void> {
    await firestoreHelper.updateDocument('data_subject_requests', request.id, {
      status: request.status,
      processing: request.processing,
      auditTrail: request.auditTrail
    });
  }

  private async storeRetentionPolicy(policy: RetentionPolicy): Promise<void> {
    await firestoreHelper.setDocument('retention_policies', policy.id, policy);
  }

  private async getAuditEvents(timeRange: { start: Date; end: Date }, regulation?: string): Promise<AuditEvent[]> {
    try {
      let query = this.db.collection('audit_events') as any;

      query = query.where('timestamp', '>=', timeRange.start)
                  .where('timestamp', '<=', timeRange.end);

      if (regulation) {
        query = query.where('compliance.regulations', 'array-contains', regulation.toUpperCase());
      }

      query = query.orderBy('timestamp', 'desc').limit(10000);

      const snapshot = await query.get();
      return snapshot.docs.map((doc: any) => doc.data() as AuditEvent);

    } catch (error) {
      logger.error('Failed to get audit events', error as Error, { timeRange, regulation });
      return [];
    }
  }

  private async initializeAuditLogger(): Promise<void> {
    try {
      // Load retention policies
      await this.loadRetentionPolicies();

      // Create default retention policies if none exist
      if (this.retentionPolicies.size === 0) {
        await this.createDefaultRetentionPolicies();
      }

      // Start background processing
      this.startAuditProcessing();

      logger.info('Audit logger initialized', {
        retentionPolicyCount: this.retentionPolicies.size
      });

    } catch (error) {
      logger.error('Failed to initialize audit logger', error as Error);
      throw error;
    }
  }

  private async loadRetentionPolicies(): Promise<void> {
    try {
      const snapshot = await this.db.collection('retention_policies')
        .where('enabled', '==', true)
        .get();

      snapshot.docs.forEach(doc => {
        const policy = doc.data() as RetentionPolicy;
        this.retentionPolicies.set(policy.id, policy);
      });

    } catch (error) {
      logger.error('Failed to load retention policies', error as Error);
    }
  }

  private async createDefaultRetentionPolicies(): Promise<void> {
    const defaultPolicies = [
      {
        name: 'User Data Retention',
        description: 'GDPR compliant user data retention',
        enabled: true,
        scope: {
          dataTypes: ['personal_data', 'profile_data'],
          categories: ['user_management'],
          sources: ['web', 'mobile', 'api']
        },
        retention: {
          period: 2555, // 7 years
          trigger: 'user_deletion' as const,
          exceptions: []
        },
        actions: {
          warning: {
            enabled: true,
            daysBeforeExpiry: 30,
            recipients: ['privacy-officer']
          },
          deletion: {
            method: 'anonymize' as const,
            verification: true,
            backupBeforeDeletion: true
          }
        },
        compliance: {
          regulations: ['GDPR'],
          legalBasis: 'Data minimization principle',
          justification: 'GDPR Article 5(1)(e) storage limitation'
        }
      },
      {
        name: 'Financial Records Retention',
        description: 'Financial data retention for compliance',
        enabled: true,
        scope: {
          dataTypes: ['financial_data', 'transaction_data'],
          categories: ['financial'],
          sources: ['api', 'system']
        },
        retention: {
          period: 2555, // 7 years
          trigger: 'creation_date' as const,
          exceptions: []
        },
        actions: {
          warning: {
            enabled: true,
            daysBeforeExpiry: 90,
            recipients: ['finance-team', 'compliance-officer']
          },
          deletion: {
            method: 'hard_delete' as const,
            verification: true,
            backupBeforeDeletion: true
          }
        },
        compliance: {
          regulations: ['SOX', 'PCI DSS'],
          legalBasis: 'Legal retention requirements',
          justification: 'SOX Section 404 and PCI DSS requirements'
        }
      }
    ];

    for (const policyData of defaultPolicies) {
      await this.createRetentionPolicy(policyData);
    }
  }

  private startAuditProcessing(): void {
    // Process audit event buffer every 10 seconds
    this.processingInterval = setInterval(async () => {
      if (this.eventBuffer.length > 0) {
        const eventsToProcess = this.eventBuffer.splice(0, 100); // Process in batches
        
        for (const event of eventsToProcess) {
          try {
            await this.storeAuditEvent(event);
          } catch (error) {
            logger.error('Failed to process audit event', error as Error, { eventId: event.id });
          }
        }
      }
    }, 10000);

    // Execute retention policies daily
    setInterval(async () => {
      try {
        await this.executeRetentionPolicies();
      } catch (error) {
        logger.error('Daily retention policy execution failed', error as Error);
      }
    }, 24 * 60 * 60 * 1000);

    // Generate compliance reports weekly
    setInterval(async () => {
      try {
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000);
        
        await this.generateComplianceReport('gdpr', { start: startTime, end: endTime }, 'system');
      } catch (error) {
        logger.error('Weekly compliance report generation failed', error as Error);
      }
    }, 7 * 24 * 60 * 60 * 1000);
  }

  // Public methods for retrieving data and managing the system
  async getAuditStats(): Promise<typeof this.auditStats> {
    return { ...this.auditStats };
  }

  async getComplianceReports(timeRange?: { start: Date; end: Date }): Promise<ComplianceReport[]> {
    try {
      let query = this.db.collection('compliance_reports') as any;

      if (timeRange) {
        query = query.where('timeRange.start', '>=', timeRange.start)
                    .where('timeRange.end', '<=', timeRange.end);
      }

      query = query.orderBy('generatedAt', 'desc').limit(50);

      const snapshot = await query.get();
      return snapshot.docs.map((doc: any) => doc.data() as ComplianceReport);

    } catch (error) {
      logger.error('Failed to get compliance reports', error as Error);
      return [];
    }
  }

  async getDataSubjectRequests(status?: DataSubjectRequest['status']): Promise<DataSubjectRequest[]> {
    try {
      let query = this.db.collection('data_subject_requests') as any;

      if (status) {
        query = query.where('status', '==', status);
      }

      query = query.orderBy('requestDate', 'desc').limit(100);

      const snapshot = await query.get();
      return snapshot.docs.map((doc: any) => doc.data() as DataSubjectRequest);

    } catch (error) {
      logger.error('Failed to get data subject requests', error as Error);
      return [];
    }
  }

  async getRetentionPolicies(): Promise<RetentionPolicy[]> {
    return Array.from(this.retentionPolicies.values());
  }

  async updateDataSubjectRequestStatus(
    requestId: string,
    status: DataSubjectRequest['status'],
    response?: Partial<DataSubjectRequest['response']>
  ): Promise<void> {
    try {
      const request = await firestoreHelper.getDocumentOptional('data_subject_requests', requestId) as DataSubjectRequest;
      if (!request) {
        throw new Error(`Data subject request not found: ${requestId}`);
      }

      request.status = status;
      if (response) {
        request.response = { ...request.response, ...response };
      }
      if (status === 'completed') {
        request.completionDate = new Date();
      }

      await this.updateDataSubjectRequest(request);

      // Log status update
      const auditEvent = await this.logSystemEvent(
        'privacy-system',
        'update_data_subject_request_status',
        'user',
        requestId,
        'success',
        { newStatus: status }
      );

      request.auditTrail.push(auditEvent.id);

      logger.info('Data subject request status updated', {
        requestId,
        status,
        subjectId: request.subject.id
      });

    } catch (error) {
      logger.error('Failed to update data subject request status', error as Error, { requestId, status });
      throw error;
    }
  }

  // Graceful shutdown
  async shutdown(): Promise<void> {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }

    // Process remaining events
    if (this.eventBuffer.length > 0) {
      for (const event of this.eventBuffer) {
        try {
          await this.storeAuditEvent(event);
        } catch (error) {
          logger.error('Failed to process final audit event', error as Error, { eventId: event.id });
        }
      }
    }

    logger.info('Audit logger shutdown complete');
  }
}

// Singleton instance
export const auditLogger = new AuditLogger();

// Helper functions for easy audit logging
export async function logUserAction(
  userId: string,
  action: string,
  targetType: string,
  targetId: string,
  outcome: 'success' | 'failure' = 'success',
  context?: Partial<AuditEvent['context']>,
  changes?: AuditEvent['changes']
): Promise<AuditEvent> {
  return await auditLogger.logUserAction(userId, action, targetType, targetId, outcome, context, changes);
}

export async function logSystemAction(
  service: string,
  operation: string,
  targetType: string,
  targetId: string,
  outcome: 'success' | 'failure' = 'success',
  details?: any
): Promise<AuditEvent> {
  return await auditLogger.logSystemEvent(service, operation, targetType, targetId, outcome, details);
}

export async function logComplianceEvent(
  regulation: string,
  requirement: string,
  status: 'compliant' | 'violation' | 'risk',
  details: any
): Promise<AuditEvent> {
  return await auditLogger.logComplianceEvent(regulation, requirement, status, details);
}

export async function generateComplianceReport(
  type: ComplianceReport['type'],
  timeRange: { start: Date; end: Date },
  generatedBy: string
): Promise<ComplianceReport> {
  return await auditLogger.generateComplianceReport(type, timeRange, generatedBy);
}

export async function handleDataSubjectRequest(
  requestData: Omit<DataSubjectRequest, 'id' | 'requestDate' | 'status' | 'auditTrail'>
): Promise<DataSubjectRequest> {
  return await auditLogger.handleDataSubjectRequest(requestData);
}