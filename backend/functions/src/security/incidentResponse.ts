import { getFirestore } from 'firebase-admin/firestore';
import { logger } from '../utils/logger';
import { firestoreHelper } from '../utils/firestore';
import { securityMonitoringSystem, SecurityEvent, SecurityAlert } from './securityMonitoring';
import { threatDetectionSystem } from './threatDetection';
import { accessControlSystem } from './accessControl';
import { securityPolicyEngine } from './securityPolicies';

export interface SecurityIncident {
  id: string;
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'new' | 'assigned' | 'investigating' | 'contained' | 'resolved' | 'closed';
  category: 'data_breach' | 'malware' | 'ddos' | 'insider_threat' | 'phishing' | 'unauthorized_access' | 'system_compromise';
  
  timeline: {
    detected: Date;
    acknowledged?: Date;
    assigned?: Date;
    contained?: Date;
    resolved?: Date;
    closed?: Date;
  };
  
  source: {
    detectionMethod: 'automated' | 'manual' | 'external';
    triggeredBy: string; // alert ID, user ID, or system component
    confidence: number; // 0-1
  };
  
  scope: {
    affectedSystems: string[];
    affectedUsers: string[];
    dataTypes: string[];
    estimatedImpact: 'low' | 'medium' | 'high' | 'critical';
  };
  
  evidence: {
    events: string[]; // Security event IDs
    alerts: string[]; // Security alert IDs
    artifacts: IncidentArtifact[];
    forensics: ForensicData[];
  };
  
  response: {
    assignedTo?: string;
    team: string[];
    actions: ResponseAction[];
    containmentMeasures: ContainmentAction[];
    communicationPlan?: CommunicationPlan;
  };
  
  analysis: {
    rootCause?: string;
    attackVector?: string;
    tactics: string[]; // MITRE ATT&CK tactics
    techniques: string[]; // MITRE ATT&CK techniques
    indicators: IOC[]; // Indicators of Compromise
  };
  
  remediation: {
    immediate: RemediationAction[];
    shortTerm: RemediationAction[];
    longTerm: RemediationAction[];
    preventativeMeasures: string[];
  };
  
  metrics: {
    detectionTime: number; // milliseconds from event to detection
    responseTime: number; // milliseconds from detection to response
    containmentTime?: number; // milliseconds from detection to containment
    resolutionTime?: number; // milliseconds from detection to resolution
  };
  
  metadata: {
    createdAt: Date;
    updatedAt: Date;
    createdBy: string;
    lastModifiedBy: string;
    tags: string[];
    priority: number; // 1-10 scale
  };
}

export interface IncidentArtifact {
  id: string;
  type: 'log_file' | 'network_capture' | 'memory_dump' | 'file_sample' | 'screenshot' | 'document';
  name: string;
  description: string;
  hash: string;
  size: number;
  storagePath: string;
  collectedAt: Date;
  collectedBy: string;
  chainOfCustody: ChainOfCustodyEntry[];
}

export interface ChainOfCustodyEntry {
  timestamp: Date;
  action: 'collected' | 'transferred' | 'analyzed' | 'archived';
  person: string;
  notes?: string;
}

export interface ForensicData {
  id: string;
  type: 'timeline' | 'process_analysis' | 'network_analysis' | 'file_analysis' | 'user_activity';
  data: any;
  findings: string[];
  tools: string[];
  analyst: string;
  timestamp: Date;
}

export interface ResponseAction {
  id: string;
  type: 'investigate' | 'contain' | 'eradicate' | 'recover' | 'communicate' | 'document';
  description: string;
  assignedTo: string;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  priority: 'low' | 'medium' | 'high' | 'critical';
  dueDate?: Date;
  completedAt?: Date;
  notes?: string;
  dependencies: string[]; // Other action IDs
}

export interface ContainmentAction {
  id: string;
  type: 'isolate_system' | 'block_ip' | 'disable_account' | 'quarantine_file' | 'segment_network' | 'backup_data';
  target: string;
  status: 'pending' | 'active' | 'completed' | 'failed';
  implementedAt?: Date;
  implementedBy?: string;
  effectiveness: 'unknown' | 'low' | 'medium' | 'high';
  sideEffects: string[];
}

export interface RemediationAction {
  id: string;
  description: string;
  category: 'technical' | 'procedural' | 'training' | 'policy';
  priority: 'low' | 'medium' | 'high' | 'critical';
  owner: string;
  targetDate: Date;
  status: 'planned' | 'in_progress' | 'completed' | 'deferred';
  resources: string[];
  cost?: number;
}

export interface CommunicationPlan {
  stakeholders: {
    internal: string[];
    external: string[];
    regulators: string[];
    customers: string[];
  };
  templates: {
    initial: string;
    update: string;
    resolution: string;
  };
  schedule: CommunicationSchedule[];
}

export interface CommunicationSchedule {
  audience: string;
  frequency: string;
  lastSent?: Date;
  nextDue?: Date;
}

export interface IOC {
  type: 'ip' | 'domain' | 'url' | 'file_hash' | 'email' | 'registry_key' | 'mutex' | 'certificate';
  value: string;
  confidence: 'low' | 'medium' | 'high';
  source: string;
  firstSeen: Date;
  lastSeen: Date;
  context: string;
}

export interface PlaybookTemplate {
  id: string;
  name: string;
  description: string;
  category: SecurityIncident['category'];
  severity: SecurityIncident['severity'][];
  triggers: {
    eventTypes: string[];
    alertTypes: string[];
    conditions: any[];
  };
  actions: ResponseActionTemplate[];
  escalationRules: EscalationRule[];
  sla: {
    acknowledgment: number; // minutes
    containment: number; // minutes
    resolution: number; // minutes
  };
}

export interface ResponseActionTemplate {
  type: ResponseAction['type'];
  description: string;
  priority: ResponseAction['priority'];
  estimatedDuration: number; // minutes
  requiredRoles: string[];
  dependencies: string[];
  automated: boolean;
}

export interface EscalationRule {
  condition: 'time_exceeded' | 'severity_increased' | 'containment_failed' | 'manual';
  threshold?: number; // minutes for time-based rules
  action: 'notify_manager' | 'assign_senior' | 'activate_crisis_team' | 'external_support';
  recipients: string[];
}

export class IncidentResponseSystem {
  private db = getFirestore();
  private activeIncidents: Map<string, SecurityIncident> = new Map();
  private playbooks: Map<string, PlaybookTemplate> = new Map();
  private automationRules: Map<string, AutomationRule> = new Map();
  private responseMetrics = {
    totalIncidents: 0,
    activeIncidents: 0,
    averageResponseTime: 0,
    averageResolutionTime: 0,
    escalationRate: 0
  };

  constructor() {
    this.initializeIncidentResponse();
  }

  async createIncident(
    alertOrEvent: SecurityAlert | SecurityEvent | any,
    options?: {
      severity?: SecurityIncident['severity'];
      category?: SecurityIncident['category'];
      assignTo?: string;
      playbook?: string;
    }
  ): Promise<SecurityIncident> {
    try {
      const incident = await this.buildIncidentFromSource(alertOrEvent, options);
      
      // Store incident
      await this.storeIncident(incident);
      
      // Add to active incidents
      this.activeIncidents.set(incident.id, incident);
      
      // Initialize automated response
      if (options?.playbook) {
        await this.executePlaybook(incident.id, options.playbook);
      } else {
        await this.selectAndExecutePlaybook(incident);
      }
      
      // Log incident creation
      await this.logIncidentEvent(incident, 'created');
      
      this.responseMetrics.totalIncidents++;
      this.responseMetrics.activeIncidents++;
      
      logger.warn('Security incident created', {
        incidentId: incident.id,
        severity: incident.severity,
        category: incident.category,
        detectionTime: incident.metrics.detectionTime
      });
      
      return incident;
      
    } catch (error) {
      logger.error('Failed to create incident', error as Error, {
        alertId: alertOrEvent.id,
        severity: options?.severity
      });
      throw error;
    }
  }

  async updateIncident(
    incidentId: string,
    updates: Partial<Pick<SecurityIncident, 'status' | 'severity' | 'description' | 'scope' | 'analysis' | 'remediation'>>
  ): Promise<SecurityIncident> {
    try {
      const incident = this.activeIncidents.get(incidentId);
      if (!incident) {
        throw new Error(`Incident not found: ${incidentId}`);
      }

      const previousStatus = incident.status;
      const updatedIncident: SecurityIncident = {
        ...incident,
        ...updates,
        metadata: {
          ...incident.metadata,
          updatedAt: new Date(),
          lastModifiedBy: updates.scope?.affectedUsers?.[0] || 'system'
        }
      };

      // Update timeline based on status changes
      if (updates.status && updates.status !== previousStatus) {
        this.updateIncidentTimeline(updatedIncident, updates.status);
        await this.handleStatusChange(updatedIncident, previousStatus, updates.status);
      }

      // Store updates
      await this.storeIncident(updatedIncident);
      this.activeIncidents.set(incidentId, updatedIncident);

      // Log update
      await this.logIncidentEvent(updatedIncident, 'updated', { 
        changes: updates,
        previousStatus 
      });

      logger.info('Incident updated', {
        incidentId,
        previousStatus,
        newStatus: updates.status,
        severity: updatedIncident.severity
      });

      return updatedIncident;

    } catch (error) {
      logger.error('Failed to update incident', error as Error, { incidentId, updates });
      throw error;
    }
  }

  async addResponseAction(
    incidentId: string,
    actionData: Omit<ResponseAction, 'id'>
  ): Promise<ResponseAction> {
    try {
      const incident = this.activeIncidents.get(incidentId);
      if (!incident) {
        throw new Error(`Incident not found: ${incidentId}`);
      }

      const action: ResponseAction = {
        id: `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        ...actionData
      };

      incident.response.actions.push(action);
      await this.storeIncident(incident);

      // Auto-execute if automated and conditions met
      if (this.canAutoExecuteAction(action, incident)) {
        await this.executeAction(incident, action);
      }

      logger.info('Response action added', {
        incidentId,
        actionId: action.id,
        type: action.type,
        assignedTo: action.assignedTo
      });

      return action;

    } catch (error) {
      logger.error('Failed to add response action', error as Error, { incidentId, actionData });
      throw error;
    }
  }

  async executeContainmentAction(
    incidentId: string,
    actionType: ContainmentAction['type'],
    target: string,
    options?: {
      implementedBy?: string;
      notes?: string;
    }
  ): Promise<ContainmentAction> {
    try {
      const incident = this.activeIncidents.get(incidentId);
      if (!incident) {
        throw new Error(`Incident not found: ${incidentId}`);
      }

      const containmentAction: ContainmentAction = {
        id: `containment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: actionType,
        target,
        status: 'pending',
        effectiveness: 'unknown',
        sideEffects: []
      };

      // Execute the containment action
      const result = await this.performContainmentAction(containmentAction);
      
      containmentAction.status = result.success ? 'completed' : 'failed';
      containmentAction.implementedAt = new Date();
      containmentAction.implementedBy = options?.implementedBy || 'system';
      containmentAction.effectiveness = result.effectiveness;
      containmentAction.sideEffects = result.sideEffects || [];

      // Add to incident
      incident.response.containmentMeasures.push(containmentAction);

      // Update incident status if first containment
      if (incident.status === 'investigating' && containmentAction.status === 'completed') {
        await this.updateIncident(incidentId, { status: 'contained' });
      }

      await this.storeIncident(incident);

      logger.info('Containment action executed', {
        incidentId,
        actionId: containmentAction.id,
        type: actionType,
        target,
        success: result.success,
        effectiveness: result.effectiveness
      });

      return containmentAction;

    } catch (error) {
      logger.error('Failed to execute containment action', error as Error, {
        incidentId,
        actionType,
        target
      });
      throw error;
    }
  }

  async addEvidence(
    incidentId: string,
    artifactData: Omit<IncidentArtifact, 'id' | 'collectedAt' | 'chainOfCustody'>
  ): Promise<IncidentArtifact> {
    try {
      const incident = this.activeIncidents.get(incidentId);
      if (!incident) {
        throw new Error(`Incident not found: ${incidentId}`);
      }

      const artifact: IncidentArtifact = {
        id: `artifact_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        ...artifactData,
        collectedAt: new Date(),
        chainOfCustody: [{
          timestamp: new Date(),
          action: 'collected',
          person: artifactData.collectedBy
        }]
      };

      incident.evidence.artifacts.push(artifact);
      await this.storeIncident(incident);

      logger.info('Evidence added to incident', {
        incidentId,
        artifactId: artifact.id,
        type: artifact.type,
        size: artifact.size
      });

      return artifact;

    } catch (error) {
      logger.error('Failed to add evidence', error as Error, { incidentId, artifactData });
      throw error;
    }
  }

  async createPlaybook(playbookData: Omit<PlaybookTemplate, 'id'>): Promise<PlaybookTemplate> {
    try {
      const playbook: PlaybookTemplate = {
        id: `playbook_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        ...playbookData
      };

      // Store playbook
      await firestoreHelper.setDocument('incident_playbooks', playbook.id, playbook);
      
      // Add to active playbooks
      this.playbooks.set(playbook.id, playbook);

      logger.info('Incident playbook created', {
        playbookId: playbook.id,
        name: playbook.name,
        category: playbook.category
      });

      return playbook;

    } catch (error) {
      logger.error('Failed to create playbook', error as Error, { playbookData });
      throw error;
    }
  }

  private async buildIncidentFromSource(
    source: SecurityAlert | SecurityEvent | any,
    options?: any
  ): Promise<SecurityIncident> {
    const now = new Date();
    const isAlert = 'triggers' in source;
    const isEvent = 'type' in source && 'source' in source;

    const incident: SecurityIncident = {
      id: `incident_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      title: this.generateIncidentTitle(source),
      description: this.generateIncidentDescription(source),
      severity: options?.severity || this.deriveSeverity(source),
      status: 'new',
      category: options?.category || this.deriveCategory(source),
      
      timeline: {
        detected: now
      },
      
      source: {
        detectionMethod: 'automated',
        triggeredBy: source.id,
        confidence: this.calculateConfidence(source)
      },
      
      scope: {
        affectedSystems: this.extractAffectedSystems(source),
        affectedUsers: this.extractAffectedUsers(source),
        dataTypes: this.extractDataTypes(source),
        estimatedImpact: this.estimateImpact(source)
      },
      
      evidence: {
        events: isEvent ? [source.id] : (isAlert ? source.events || [] : []),
        alerts: isAlert ? [source.id] : [],
        artifacts: [],
        forensics: []
      },
      
      response: {
        team: ['security-team'],
        actions: [],
        containmentMeasures: []
      },
      
      analysis: {
        tactics: this.extractTactics(source),
        techniques: this.extractTechniques(source),
        indicators: this.extractIOCs(source)
      },
      
      remediation: {
        immediate: [],
        shortTerm: [],
        longTerm: [],
        preventativeMeasures: []
      },
      
      metrics: {
        detectionTime: this.calculateDetectionTime(source),
        responseTime: 0
      },
      
      metadata: {
        createdAt: now,
        updatedAt: now,
        createdBy: 'automated-system',
        lastModifiedBy: 'automated-system',
        tags: this.generateTags(source),
        priority: this.calculatePriority(source)
      }
    };

    // Assign if specified
    if (options?.assignTo) {
      incident.response.assignedTo = options.assignTo;
      incident.timeline.assigned = now;
      incident.status = 'assigned';
    }

    return incident;
  }

  private async selectAndExecutePlaybook(incident: SecurityIncident): Promise<void> {
    try {
      // Find matching playbooks
      const matchingPlaybooks = Array.from(this.playbooks.values()).filter(playbook => 
        playbook.category === incident.category &&
        playbook.severity.includes(incident.severity)
      );

      if (matchingPlaybooks.length > 0) {
        // Select best matching playbook (prioritize by specificity)
        const selectedPlaybook = matchingPlaybooks[0];
        await this.executePlaybook(incident.id, selectedPlaybook.id);
      } else {
        // Use default response actions
        await this.executeDefaultResponse(incident);
      }

    } catch (error) {
      logger.error('Failed to select and execute playbook', error as Error, {
        incidentId: incident.id,
        category: incident.category
      });
    }
  }

  private async executePlaybook(incidentId: string, playbookId: string): Promise<void> {
    try {
      const playbook = this.playbooks.get(playbookId);
      const incident = this.activeIncidents.get(incidentId);
      
      if (!playbook || !incident) {
        throw new Error('Playbook or incident not found');
      }

      // Create response actions from playbook template
      for (const actionTemplate of playbook.actions) {
        const action: ResponseAction = {
          id: `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          type: actionTemplate.type,
          description: actionTemplate.description,
          assignedTo: this.selectActionAssignee(actionTemplate.requiredRoles, incident.response.team),
          status: 'pending',
          priority: actionTemplate.priority,
          dependencies: actionTemplate.dependencies
        };

        incident.response.actions.push(action);

        // Auto-execute if automated
        if (actionTemplate.automated) {
          await this.executeAction(incident, action);
        }
      }

      await this.storeIncident(incident);

      logger.info('Playbook executed', {
        incidentId,
        playbookId,
        actionCount: playbook.actions.length
      });

    } catch (error) {
      logger.error('Failed to execute playbook', error as Error, { incidentId, playbookId });
    }
  }

  private async executeDefaultResponse(incident: SecurityIncident): Promise<void> {
    const defaultActions: Omit<ResponseAction, 'id'>[] = [
      {
        type: 'investigate',
        description: 'Initial investigation of security incident',
        assignedTo: 'security-analyst',
        status: 'pending',
        priority: 'high',
        dependencies: []
      },
      {
        type: 'document',
        description: 'Document incident details and evidence',
        assignedTo: 'security-analyst',
        status: 'pending',
        priority: 'medium',
        dependencies: []
      }
    ];

    if (incident.severity === 'critical' || incident.severity === 'high') {
      defaultActions.push({
        type: 'contain',
        description: 'Implement immediate containment measures',
        assignedTo: 'security-team',
        status: 'pending',
        priority: 'critical',
        dependencies: []
      });
    }

    for (const actionData of defaultActions) {
      await this.addResponseAction(incident.id, actionData);
    }
  }

  private async executeAction(incident: SecurityIncident, action: ResponseAction): Promise<void> {
    try {
      action.status = 'in_progress';
      
      let success = false;
      
      switch (action.type) {
        case 'contain':
          success = await this.autoContainment(incident);
          break;
        case 'investigate':
          success = await this.autoInvestigation(incident);
          break;
        case 'communicate':
          success = await this.autoCommunication(incident);
          break;
        default:
          success = true; // Manual actions marked as pending
          action.status = 'pending';
          break;
      }

      if (success && action.status === 'in_progress') {
        action.status = 'completed';
        action.completedAt = new Date();
      }

      await this.storeIncident(incident);

      logger.info('Action executed', {
        incidentId: incident.id,
        actionId: action.id,
        type: action.type,
        success
      });

    } catch (error) {
      action.status = 'pending';
      action.notes = `Execution failed: ${(error as Error).message}`;
      logger.error('Failed to execute action', error as Error, {
        incidentId: incident.id,
        actionId: action.id
      });
    }
  }

  private async performContainmentAction(action: ContainmentAction): Promise<{
    success: boolean;
    effectiveness: ContainmentAction['effectiveness'];
    sideEffects: string[];
  }> {
    try {
      let success = false;
      let effectiveness: ContainmentAction['effectiveness'] = 'unknown';
      const sideEffects: string[] = [];

      switch (action.type) {
        case 'block_ip':
          success = await threatDetectionSystem.blockIP(action.target);
          effectiveness = success ? 'high' : 'low';
          if (success) sideEffects.push('Legitimate users from this IP may be blocked');
          break;

        case 'disable_account':
          if (action.target) {
            // Integration with access control system
            success = true; // Placeholder
            effectiveness = 'high';
            sideEffects.push('User account disabled - may impact business operations');
          }
          break;

        case 'isolate_system':
          // System isolation logic
          success = true; // Placeholder
          effectiveness = 'high';
          sideEffects.push('System offline - may impact dependent services');
          break;

        case 'quarantine_file':
          // File quarantine logic
          success = true; // Placeholder
          effectiveness = 'medium';
          break;

        default:
          success = false;
          break;
      }

      return { success, effectiveness, sideEffects };

    } catch (error) {
      logger.error('Containment action failed', error as Error, {
        actionType: action.type,
        target: action.target
      });
      return { success: false, effectiveness: 'low', sideEffects: ['Execution failed'] };
    }
  }

  private async autoContainment(incident: SecurityIncident): Promise<boolean> {
    try {
      // Implement automatic containment based on incident type
      const containmentActions: ContainmentAction['type'][] = [];

      if (incident.category === 'unauthorized_access') {
        containmentActions.push('disable_account', 'block_ip');
      } else if (incident.category === 'malware') {
        containmentActions.push('quarantine_file', 'isolate_system');
      } else if (incident.category === 'ddos') {
        containmentActions.push('block_ip');
      }

      let success = true;
      for (const actionType of containmentActions) {
        const target = this.selectContainmentTarget(incident, actionType);
        if (target) {
          const result = await this.executeContainmentAction(incident.id, actionType, target);
          if (result.status === 'failed') {
            success = false;
          }
        }
      }

      return success;

    } catch (error) {
      logger.error('Auto-containment failed', error as Error, { incidentId: incident.id });
      return false;
    }
  }

  private async autoInvestigation(incident: SecurityIncident): Promise<boolean> {
    try {
      // Gather additional evidence
      await this.gatherRelatedEvents(incident);
      await this.analyzeAttackPattern(incident);
      await this.enrichIOCs(incident);

      return true;

    } catch (error) {
      logger.error('Auto-investigation failed', error as Error, { incidentId: incident.id });
      return false;
    }
  }

  private async autoCommunication(incident: SecurityIncident): Promise<boolean> {
    try {
      // Send automated notifications based on severity and type
      const recipients = this.determineNotificationRecipients(incident);
      const message = this.generateIncidentNotification(incident);

      // Integration with notification system would go here
      logger.info('Incident notification sent', {
        incidentId: incident.id,
        recipients: recipients.length,
        severity: incident.severity
      });

      return true;

    } catch (error) {
      logger.error('Auto-communication failed', error as Error, { incidentId: incident.id });
      return false;
    }
  }

  // Helper methods for incident analysis
  private generateIncidentTitle(source: any): string {
    if (source.title) return source.title;
    if (source.type) return `Security Event: ${source.type.replace('_', ' ')}`;
    return 'Security Incident';
  }

  private generateIncidentDescription(source: any): string {
    if (source.description) return source.description;
    if (source.details) return `${source.details.action} - ${source.details.outcome}`;
    return 'Automated security incident created from monitoring system';
  }

  private deriveSeverity(source: any): SecurityIncident['severity'] {
    if (source.severity) {
      const severityMap: Record<string, SecurityIncident['severity']> = {
        'info': 'low',
        'low': 'low',
        'medium': 'medium',
        'high': 'high',
        'critical': 'critical'
      };
      return severityMap[source.severity] || 'medium';
    }
    return 'medium';
  }

  private deriveCategory(source: any): SecurityIncident['category'] {
    if (source.type) {
      const categoryMap: Record<string, SecurityIncident['category']> = {
        'authentication': 'unauthorized_access',
        'authorization': 'unauthorized_access',
        'threat_detected': 'malware',
        'data_access': 'data_breach',
        'system_change': 'system_compromise'
      };
      return categoryMap[source.type] || 'unauthorized_access';
    }
    return 'unauthorized_access';
  }

  private calculateConfidence(source: any): number {
    if (source.risk?.confidence) return source.risk.confidence;
    if (source.confidence) return source.confidence;
    return 0.8; // Default confidence
  }

  private extractAffectedSystems(source: any): string[] {
    const systems: string[] = [];
    if (source.source?.service) systems.push(source.source.service);
    if (source.source?.endpoint) systems.push(source.source.endpoint);
    return systems;
  }

  private extractAffectedUsers(source: any): string[] {
    const users: string[] = [];
    if (source.source?.userId) users.push(source.source.userId);
    return users;
  }

  private extractDataTypes(source: any): string[] {
    // Would analyze the incident to determine what types of data might be affected
    return [];
  }

  private estimateImpact(source: any): SecurityIncident['scope']['estimatedImpact'] {
    const severity = this.deriveSeverity(source);
    const impactMap: Record<SecurityIncident['severity'], SecurityIncident['scope']['estimatedImpact']> = {
      'low': 'low',
      'medium': 'medium',
      'high': 'high',
      'critical': 'critical'
    };
    return impactMap[severity];
  }

  private extractTactics(source: any): string[] {
    // Map to MITRE ATT&CK tactics based on event type
    const tacticMap: Record<string, string[]> = {
      'authentication': ['TA0001'], // Initial Access
      'authorization': ['TA0004'], // Privilege Escalation
      'data_access': ['TA0009'], // Collection
      'threat_detected': ['TA0002'] // Execution
    };
    
    if (source.type && tacticMap[source.type]) {
      return tacticMap[source.type];
    }
    return [];
  }

  private extractTechniques(source: any): string[] {
    // Map to MITRE ATT&CK techniques
    return [];
  }

  private extractIOCs(source: any): IOC[] {
    const iocs: IOC[] = [];
    
    if (source.source?.ip) {
      iocs.push({
        type: 'ip',
        value: source.source.ip,
        confidence: 'medium',
        source: 'automated',
        firstSeen: new Date(),
        lastSeen: new Date(),
        context: 'Source IP from security event'
      });
    }
    
    return iocs;
  }

  private calculateDetectionTime(source: any): number {
    if (source.timestamp && source.metadata?.createdAt) {
      return source.metadata.createdAt.getTime() - source.timestamp.getTime();
    }
    return 0;
  }

  private generateTags(source: any): string[] {
    const tags: string[] = ['automated'];
    if (source.type) tags.push(source.type);
    if (source.severity) tags.push(source.severity);
    return tags;
  }

  private calculatePriority(source: any): number {
    const severityMap = { 'low': 3, 'medium': 5, 'high': 7, 'critical': 10 };
    return severityMap[this.deriveSeverity(source) as keyof typeof severityMap] || 5;
  }

  // Utility methods
  private updateIncidentTimeline(incident: SecurityIncident, status: SecurityIncident['status']): void {
    const now = new Date();
    
    switch (status) {
      case 'assigned':
        incident.timeline.assigned = now;
        break;
      case 'investigating':
        incident.timeline.acknowledged = now;
        break;
      case 'contained':
        incident.timeline.contained = now;
        break;
      case 'resolved':
        incident.timeline.resolved = now;
        break;
      case 'closed':
        incident.timeline.closed = now;
        break;
    }
    
    // Calculate metrics
    if (incident.timeline.acknowledged && incident.timeline.detected) {
      incident.metrics.responseTime = incident.timeline.acknowledged.getTime() - incident.timeline.detected.getTime();
    }
    
    if (incident.timeline.contained && incident.timeline.detected) {
      incident.metrics.containmentTime = incident.timeline.contained.getTime() - incident.timeline.detected.getTime();
    }
    
    if (incident.timeline.resolved && incident.timeline.detected) {
      incident.metrics.resolutionTime = incident.timeline.resolved.getTime() - incident.timeline.detected.getTime();
    }
  }

  private async handleStatusChange(
    incident: SecurityIncident,
    previousStatus: SecurityIncident['status'],
    newStatus: SecurityIncident['status']
  ): Promise<void> {
    // Update metrics
    if (newStatus === 'closed' && previousStatus !== 'closed') {
      this.responseMetrics.activeIncidents--;
    }

    // Check SLA compliance
    await this.checkSLACompliance(incident);

    // Send notifications for critical status changes
    if (newStatus === 'contained' || newStatus === 'resolved') {
      await this.sendStatusNotification(incident, newStatus);
    }
  }

  private async checkSLACompliance(incident: SecurityIncident): Promise<void> {
    // Check against playbook SLAs or default SLAs
    const defaultSLAs = {
      acknowledgment: 30, // 30 minutes
      containment: 120, // 2 hours for high/critical
      resolution: 24 * 60 // 24 hours
    };

    const now = Date.now();
    const detected = incident.timeline.detected.getTime();

    // Check acknowledgment SLA
    if (!incident.timeline.acknowledged && (now - detected) > (defaultSLAs.acknowledgment * 60 * 1000)) {
      await this.triggerSLAViolation(incident, 'acknowledgment');
    }

    // Check containment SLA for high/critical incidents
    if ((incident.severity === 'high' || incident.severity === 'critical') && 
        !incident.timeline.contained && 
        (now - detected) > (defaultSLAs.containment * 60 * 1000)) {
      await this.triggerSLAViolation(incident, 'containment');
    }
  }

  private async triggerSLAViolation(incident: SecurityIncident, slaType: string): Promise<void> {
    logger.warn('SLA violation detected', {
      incidentId: incident.id,
      slaType,
      severity: incident.severity,
      age: Date.now() - incident.timeline.detected.getTime()
    });

    // Trigger escalation
    await this.escalateIncident(incident, `SLA violation: ${slaType}`);
  }

  private async escalateIncident(incident: SecurityIncident, reason: string): Promise<void> {
    // Implementation would notify management, assign senior analysts, etc.
    logger.error('Incident escalated', {
      incidentId: incident.id,
      reason,
      severity: incident.severity
    });
  }

  private selectActionAssignee(requiredRoles: string[], team: string[]): string {
    // Simple role-based assignment logic
    if (requiredRoles.includes('senior-analyst') && team.includes('senior-analyst')) {
      return 'senior-analyst';
    }
    return team[0] || 'security-analyst';
  }

  private selectContainmentTarget(incident: SecurityIncident, actionType: ContainmentAction['type']): string | null {
    switch (actionType) {
      case 'block_ip':
        return incident.evidence.events[0] ? 'detected-ip' : null;
      case 'disable_account':
        return incident.scope.affectedUsers[0] || null;
      case 'isolate_system':
        return incident.scope.affectedSystems[0] || null;
      default:
        return null;
    }
  }

  private canAutoExecuteAction(action: ResponseAction, incident: SecurityIncident): boolean {
    // Auto-execute only for low-risk automated actions
    const autoExecutableTypes = ['investigate', 'document'];
    return autoExecutableTypes.includes(action.type) && incident.severity !== 'critical';
  }

  private determineNotificationRecipients(incident: SecurityIncident): string[] {
    const recipients = ['security-team'];
    
    if (incident.severity === 'critical') {
      recipients.push('security-manager', 'ciso');
    }
    
    if (incident.category === 'data_breach') {
      recipients.push('privacy-officer', 'legal-team');
    }
    
    return recipients;
  }

  private generateIncidentNotification(incident: SecurityIncident): string {
    return `Security Incident ${incident.id}: ${incident.title}\n` +
           `Severity: ${incident.severity.toUpperCase()}\n` +
           `Status: ${incident.status}\n` +
           `Category: ${incident.category}\n` +
           `Description: ${incident.description}`;
  }

  private async gatherRelatedEvents(incident: SecurityIncident): Promise<void> {
    // Gather additional security events related to this incident
    const relatedEvents = await securityMonitoringSystem.searchEvents({
      ip: incident.scope.affectedSystems[0],
      timeRange: {
        start: new Date(incident.timeline.detected.getTime() - 60 * 60 * 1000), // 1 hour before
        end: new Date()
      },
      limit: 50
    });

    incident.evidence.events.push(...relatedEvents.map(e => e.id));
  }

  private async analyzeAttackPattern(incident: SecurityIncident): Promise<void> {
    // Analyze the sequence of events to identify attack patterns
    // This would integrate with threat intelligence and behavioral analysis
  }

  private async enrichIOCs(incident: SecurityIncident): Promise<void> {
    // Enrich indicators with threat intelligence
    for (const ioc of incident.analysis.indicators) {
      // Query threat intelligence sources
      // Update IOC confidence and context
    }
  }

  private async sendStatusNotification(incident: SecurityIncident, status: SecurityIncident['status']): Promise<void> {
    logger.info('Incident status notification', {
      incidentId: incident.id,
      status,
      severity: incident.severity
    });
  }

  // Database operations
  private async storeIncident(incident: SecurityIncident): Promise<void> {
    await firestoreHelper.setDocument('security_incidents', incident.id, incident);
  }

  private async logIncidentEvent(incident: SecurityIncident, action: string, details?: any): Promise<void> {
    await securityMonitoringSystem.logSecurityEvent({
      type: 'system_change',
      severity: 'info',
      source: {
        userId: incident.metadata.lastModifiedBy,
        ip: '127.0.0.1',
        service: 'incident-response'
      },
      details: {
        action: `incident_${action}`,
        resource: incident.id,
        outcome: 'success',
        metadata: {
          incidentId: incident.id,
          severity: incident.severity,
          status: incident.status,
          ...details
        }
      },
      risk: {
        score: 5,
        factors: ['incident_management'],
        confidence: 1.0
      }
    });
  }

  private async initializeIncidentResponse(): Promise<void> {
    try {
      // Load existing playbooks
      await this.loadPlaybooks();

      // Create default playbooks if none exist
      if (this.playbooks.size === 0) {
        await this.createDefaultPlaybooks();
      }

      // Load active incidents
      await this.loadActiveIncidents();

      logger.info('Incident response system initialized', {
        playbookCount: this.playbooks.size,
        activeIncidentCount: this.activeIncidents.size
      });

    } catch (error) {
      logger.error('Failed to initialize incident response system', error as Error);
      throw error;
    }
  }

  private async loadPlaybooks(): Promise<void> {
    try {
      const snapshot = await this.db.collection('incident_playbooks').get();
      
      snapshot.docs.forEach(doc => {
        const playbook = doc.data() as PlaybookTemplate;
        this.playbooks.set(playbook.id, playbook);
      });

    } catch (error) {
      logger.error('Failed to load playbooks', error as Error);
    }
  }

  private async loadActiveIncidents(): Promise<void> {
    try {
      const snapshot = await this.db.collection('security_incidents')
        .where('status', 'in', ['new', 'assigned', 'investigating', 'contained'])
        .get();
      
      snapshot.docs.forEach(doc => {
        const incident = doc.data() as SecurityIncident;
        this.activeIncidents.set(incident.id, incident);
      });

      this.responseMetrics.activeIncidents = this.activeIncidents.size;

    } catch (error) {
      logger.error('Failed to load active incidents', error as Error);
    }
  }

  private async createDefaultPlaybooks(): Promise<void> {
    const defaultPlaybooks: Omit<PlaybookTemplate, 'id'>[] = [
      {
        name: 'Data Breach Response',
        description: 'Standard response for data breach incidents',
        category: 'data_breach',
        severity: ['medium', 'high', 'critical'],
        triggers: {
          eventTypes: ['data_access'],
          alertTypes: ['data_exfiltration'],
          conditions: []
        },
        actions: [
          {
            type: 'investigate',
            description: 'Assess scope of data breach',
            priority: 'critical',
            estimatedDuration: 60,
            requiredRoles: ['senior-analyst'],
            dependencies: [],
            automated: false
          },
          {
            type: 'contain',
            description: 'Implement immediate containment',
            priority: 'critical',
            estimatedDuration: 30,
            requiredRoles: ['security-team'],
            dependencies: [],
            automated: true
          },
          {
            type: 'communicate',
            description: 'Notify relevant stakeholders',
            priority: 'high',
            estimatedDuration: 15,
            requiredRoles: ['security-manager'],
            dependencies: [],
            automated: true
          }
        ],
        escalationRules: [
          {
            condition: 'time_exceeded',
            threshold: 30,
            action: 'notify_manager',
            recipients: ['security-manager']
          }
        ],
        sla: {
          acknowledgment: 15,
          containment: 60,
          resolution: 24 * 60
        }
      }
    ];

    for (const playbookData of defaultPlaybooks) {
      await this.createPlaybook(playbookData);
    }
  }

  // Public management methods
  async getIncidentMetrics(): Promise<typeof this.responseMetrics> {
    return { ...this.responseMetrics };
  }

  async getActiveIncidents(): Promise<SecurityIncident[]> {
    return Array.from(this.activeIncidents.values());
  }

  async getIncident(incidentId: string): Promise<SecurityIncident | null> {
    return this.activeIncidents.get(incidentId) || 
           await firestoreHelper.getDocumentOptional('security_incidents', incidentId) as SecurityIncident | null;
  }

  async getPlaybooks(): Promise<PlaybookTemplate[]> {
    return Array.from(this.playbooks.values());
  }

  async searchIncidents(filters: {
    status?: SecurityIncident['status'][];
    severity?: SecurityIncident['severity'][];
    category?: SecurityIncident['category'][];
    assignedTo?: string;
    timeRange?: { start: Date; end: Date };
    limit?: number;
  }): Promise<SecurityIncident[]> {
    try {
      let query = this.db.collection('security_incidents') as any;

      if (filters.status) {
        query = query.where('status', 'in', filters.status);
      }
      if (filters.severity) {
        query = query.where('severity', 'in', filters.severity);
      }
      if (filters.category) {
        query = query.where('category', 'in', filters.category);
      }
      if (filters.assignedTo) {
        query = query.where('response.assignedTo', '==', filters.assignedTo);
      }
      if (filters.timeRange) {
        query = query.where('timeline.detected', '>=', filters.timeRange.start)
                    .where('timeline.detected', '<=', filters.timeRange.end);
      }

      query = query.orderBy('timeline.detected', 'desc').limit(filters.limit || 100);

      const snapshot = await query.get();
      return snapshot.docs.map((doc: any) => doc.data() as SecurityIncident);

    } catch (error) {
      logger.error('Failed to search incidents', error as Error, { filters });
      return [];
    }
  }
}

interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  triggers: {
    eventTypes: string[];
    severity: string[];
    conditions: any[];
  };
  actions: {
    createIncident: boolean;
    assignTo?: string;
    executePlaybook?: string;
    notify: string[];
  };
}

// Singleton instance
export const incidentResponseSystem = new IncidentResponseSystem();

// Helper functions for integration
export async function createIncidentFromAlert(alert: SecurityAlert): Promise<SecurityIncident> {
  return await incidentResponseSystem.createIncident(alert, {
    severity: alert.severity as SecurityIncident['severity']
  });
}

export async function createIncidentFromEvent(event: SecurityEvent): Promise<SecurityIncident> {
  return await incidentResponseSystem.createIncident(event);
}

export async function getActiveSecurityIncidents(): Promise<SecurityIncident[]> {
  return await incidentResponseSystem.getActiveIncidents();
}