import { getFirestore } from 'firebase-admin/firestore';
import { logger } from '../utils/logger';
import { firestoreHelper } from '../utils/firestore';
import { securityMonitoringSystem } from './securityMonitoring';
import { accessControlSystem } from './accessControl';
import { threatDetectionSystem } from './threatDetection';

export interface SecurityPolicy {
  id: string;
  name: string;
  description: string;
  category: 'authentication' | 'authorization' | 'data_protection' | 'threat_prevention' | 'compliance' | 'system_integrity';
  priority: 'low' | 'medium' | 'high' | 'critical';
  enabled: boolean;
  conditions: {
    triggers: PolicyTrigger[];
    scope: PolicyScope;
    timeframe?: {
      validFrom?: Date;
      validUntil?: Date;
    };
  };
  actions: PolicyAction[];
  enforcement: {
    mode: 'advisory' | 'blocking' | 'audit_only';
    exceptions: PolicyException[];
    escalation?: PolicyEscalation;
  };
  metrics: {
    createdAt: Date;
    lastModified: Date;
    lastTriggered?: Date;
    triggerCount: number;
    violationCount: number;
    exemptionCount: number;
  };
}

export interface PolicyTrigger {
  type: 'event' | 'condition' | 'threshold' | 'pattern' | 'schedule';
  eventType?: string;
  condition?: {
    field: string;
    operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains' | 'regex';
    value: any;
  };
  threshold?: {
    metric: string;
    value: number;
    timeWindow: number; // minutes
  };
  pattern?: {
    sequence: string[];
    timeWindow: number;
  };
  schedule?: {
    cron: string;
    timezone: string;
  };
}

export interface PolicyScope {
  targets: PolicyTarget[];
  exclusions?: PolicyTarget[];
}

export interface PolicyTarget {
  type: 'user' | 'role' | 'ip' | 'endpoint' | 'resource' | 'service' | 'global';
  values: string[];
  conditions?: {
    userAttributes?: Record<string, any>;
    timeConstraints?: {
      days: string[];
      hours: { start: string; end: string };
    };
    locationConstraints?: {
      countries: string[];
      regions: string[];
    };
  };
}

export interface PolicyAction {
  type: 'block' | 'alert' | 'log' | 'redirect' | 'throttle' | 'quarantine' | 'require_auth' | 'require_mfa';
  parameters?: {
    message?: string;
    redirectUrl?: string;
    throttleLimit?: number;
    quarantineDuration?: number;
    alertSeverity?: string;
    logLevel?: string;
    customData?: Record<string, any>;
  };
}

export interface PolicyException {
  id: string;
  reason: string;
  target: PolicyTarget;
  validUntil?: Date;
  approvedBy: string;
  createdAt: Date;
}

export interface PolicyEscalation {
  conditions: {
    violationCount: number;
    timeWindow: number; // minutes
  };
  actions: PolicyAction[];
  recipients: string[];
}

export interface PolicyViolation {
  id: string;
  policyId: string;
  policyName: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  details: {
    trigger: PolicyTrigger;
    context: Record<string, any>;
    violationType: 'direct' | 'threshold_exceeded' | 'pattern_detected' | 'schedule_based';
  };
  source: {
    userId?: string;
    ip: string;
    userAgent?: string;
    service: string;
    endpoint?: string;
  };
  response: {
    actions: PolicyAction[];
    blocked: boolean;
    exempted: boolean;
    exemptionReason?: string;
  };
  metadata: {
    timestamp: Date;
    processed: boolean;
    escalated: boolean;
    resolved: boolean;
    resolvedBy?: string;
    resolvedAt?: Date;
  };
}

export interface PolicyEnforcementResult {
  allowed: boolean;
  violatedPolicies: SecurityPolicy[];
  appliedActions: PolicyAction[];
  exemptions: PolicyException[];
  riskScore: number;
  recommendation: 'allow' | 'block' | 'warn' | 'monitor';
}

export class SecurityPolicyEngine {
  private db = getFirestore();
  private policies: Map<string, SecurityPolicy> = new Map();
  private evaluationCache: Map<string, { result: PolicyEnforcementResult; expiry: number }> = new Map();
  private processingQueue: PolicyViolation[] = [];
  private enforcementStats = {
    totalEvaluations: 0,
    policyViolations: 0,
    blockedRequests: 0,
    exemptionCount: 0,
    cacheHitRate: 0
  };

  constructor() {
    this.initializePolicyEngine();
  }

  async evaluateRequest(context: {
    userId?: string;
    ip: string;
    userAgent?: string;
    service: string;
    endpoint?: string;
    action: string;
    resource?: string;
    data?: any;
    headers?: Record<string, string>;
    timestamp?: Date;
  }): Promise<PolicyEnforcementResult> {
    const startTime = Date.now();
    this.enforcementStats.totalEvaluations++;

    try {
      // Check cache first
      const cacheKey = this.generateCacheKey(context);
      const cached = this.evaluationCache.get(cacheKey);
      if (cached && cached.expiry > Date.now()) {
        this.enforcementStats.cacheHitRate = 
          ((this.enforcementStats.cacheHitRate * (this.enforcementStats.totalEvaluations - 1)) + 1) / 
          this.enforcementStats.totalEvaluations;
        return cached.result;
      }

      // Evaluate against all active policies
      const result = await this.performPolicyEvaluation(context);

      // Cache result
      this.evaluationCache.set(cacheKey, {
        result,
        expiry: Date.now() + (5 * 60 * 1000) // 5 minutes
      });

      // Log enforcement decision
      await this.logEnforcementDecision(context, result);

      // Handle violations
      if (result.violatedPolicies.length > 0) {
        await this.handlePolicyViolations(context, result);
      }

      logger.info('Policy evaluation completed', {
        userId: context.userId,
        ip: context.ip,
        endpoint: context.endpoint,
        allowed: result.allowed,
        violationCount: result.violatedPolicies.length,
        riskScore: result.riskScore,
        processingTime: Date.now() - startTime
      });

      return result;

    } catch (error) {
      logger.error('Policy evaluation failed', error as Error, {
        userId: context.userId,
        ip: context.ip,
        endpoint: context.endpoint
      });

      // Fail-safe: allow request but log the failure
      return {
        allowed: true,
        violatedPolicies: [],
        appliedActions: [],
        exemptions: [],
        riskScore: 0,
        recommendation: 'monitor'
      };
    }
  }

  async createPolicy(policyData: Omit<SecurityPolicy, 'id' | 'metrics'>): Promise<SecurityPolicy> {
    try {
      const policy: SecurityPolicy = {
        id: `policy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        ...policyData,
        metrics: {
          createdAt: new Date(),
          lastModified: new Date(),
          triggerCount: 0,
          violationCount: 0,
          exemptionCount: 0
        }
      };

      // Validate policy configuration
      this.validatePolicy(policy);

      // Store policy
      await firestoreHelper.setDocument('security_policies', policy.id, policy);

      // Add to active policies
      this.policies.set(policy.id, policy);

      // Clear cache to ensure new policy takes effect
      this.evaluationCache.clear();

      logger.info('Security policy created', {
        policyId: policy.id,
        name: policy.name,
        category: policy.category,
        priority: policy.priority
      });

      return policy;

    } catch (error) {
      logger.error('Failed to create security policy', error as Error, {
        policyName: policyData.name
      });
      throw error;
    }
  }

  async updatePolicy(
    policyId: string,
    updates: Partial<Omit<SecurityPolicy, 'id' | 'metrics'>>
  ): Promise<SecurityPolicy> {
    try {
      const existingPolicy = this.policies.get(policyId);
      if (!existingPolicy) {
        throw new Error(`Policy not found: ${policyId}`);
      }

      const updatedPolicy: SecurityPolicy = {
        ...existingPolicy,
        ...updates,
        metrics: {
          ...existingPolicy.metrics,
          lastModified: new Date()
        }
      };

      // Validate updated policy
      this.validatePolicy(updatedPolicy);

      // Store updates
      await firestoreHelper.updateDocument('security_policies', policyId, {
        ...updates,
        'metrics.lastModified': new Date()
      });

      // Update active policies
      this.policies.set(policyId, updatedPolicy);

      // Clear cache
      this.evaluationCache.clear();

      logger.info('Security policy updated', {
        policyId,
        name: updatedPolicy.name,
        enabled: updatedPolicy.enabled
      });

      return updatedPolicy;

    } catch (error) {
      logger.error('Failed to update security policy', error as Error, { policyId, updates });
      throw error;
    }
  }

  async deletePolicy(policyId: string): Promise<void> {
    try {
      const policy = this.policies.get(policyId);
      if (!policy) {
        throw new Error(`Policy not found: ${policyId}`);
      }

      // Archive instead of delete for audit trail
      await this.updatePolicy(policyId, { enabled: false });

      // Remove from active policies
      this.policies.delete(policyId);

      // Clear cache
      this.evaluationCache.clear();

      logger.info('Security policy deleted', {
        policyId,
        name: policy.name
      });

    } catch (error) {
      logger.error('Failed to delete security policy', error as Error, { policyId });
      throw error;
    }
  }

  async addPolicyException(
    policyId: string,
    exceptionData: Omit<PolicyException, 'id' | 'createdAt'>
  ): Promise<PolicyException> {
    try {
      const policy = this.policies.get(policyId);
      if (!policy) {
        throw new Error(`Policy not found: ${policyId}`);
      }

      const exception: PolicyException = {
        id: `exception_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        ...exceptionData,
        createdAt: new Date()
      };

      // Add exception to policy
      policy.enforcement.exceptions.push(exception);
      policy.metrics.exemptionCount++;

      await this.updatePolicy(policyId, {
        enforcement: policy.enforcement,
        metrics: policy.metrics
      });

      logger.info('Policy exception added', {
        policyId,
        exceptionId: exception.id,
        reason: exception.reason,
        approvedBy: exception.approvedBy
      });

      return exception;

    } catch (error) {
      logger.error('Failed to add policy exception', error as Error, {
        policyId,
        exceptionData
      });
      throw error;
    }
  }

  private async performPolicyEvaluation(context: any): Promise<PolicyEnforcementResult> {
    const violatedPolicies: SecurityPolicy[] = [];
    const appliedActions: PolicyAction[] = [];
    const exemptions: PolicyException[] = [];
    let totalRiskScore = 0;

    for (const policy of this.policies.values()) {
      if (!policy.enabled) continue;

      // Check if policy applies to this context
      if (!this.isPolicyApplicable(policy, context)) continue;

      // Check for exemptions
      const exemption = this.checkPolicyExemptions(policy, context);
      if (exemption) {
        exemptions.push(exemption);
        continue;
      }

      // Evaluate policy triggers
      const triggered = await this.evaluatePolicyTriggers(policy, context);
      if (triggered) {
        violatedPolicies.push(policy);
        appliedActions.push(...policy.actions);
        
        // Update policy metrics
        policy.metrics.triggerCount++;
        policy.metrics.lastTriggered = new Date();
        
        // Calculate risk contribution
        const policyRisk = this.calculatePolicyRisk(policy, context);
        totalRiskScore += policyRisk;
      }
    }

    const riskScore = Math.min(100, totalRiskScore);
    const recommendation = this.determineRecommendation(violatedPolicies, riskScore);
    const allowed = this.determineAccess(violatedPolicies, appliedActions, exemptions);

    return {
      allowed,
      violatedPolicies,
      appliedActions,
      exemptions,
      riskScore,
      recommendation
    };
  }

  private isPolicyApplicable(policy: SecurityPolicy, context: any): boolean {
    // Check timeframe
    if (policy.conditions.timeframe) {
      const now = new Date();
      if (policy.conditions.timeframe.validFrom && now < policy.conditions.timeframe.validFrom) {
        return false;
      }
      if (policy.conditions.timeframe.validUntil && now > policy.conditions.timeframe.validUntil) {
        return false;
      }
    }

    // Check scope targets
    const scopeMatches = this.checkScopeMatch(policy.conditions.scope, context);
    return scopeMatches;
  }

  private checkScopeMatch(scope: PolicyScope, context: any): boolean {
    // Check if any target matches
    const targetMatches = scope.targets.some(target => this.checkTargetMatch(target, context));
    if (!targetMatches) return false;

    // Check exclusions
    if (scope.exclusions) {
      const excludedMatches = scope.exclusions.some(exclusion => this.checkTargetMatch(exclusion, context));
      if (excludedMatches) return false;
    }

    return true;
  }

  private checkTargetMatch(target: PolicyTarget, context: any): boolean {
    switch (target.type) {
      case 'user':
        return context.userId && target.values.includes(context.userId);
      case 'ip':
        return target.values.includes(context.ip);
      case 'endpoint':
        return context.endpoint && target.values.some(pattern => 
          context.endpoint.includes(pattern) || new RegExp(pattern).test(context.endpoint)
        );
      case 'service':
        return target.values.includes(context.service);
      case 'global':
        return true;
      default:
        return false;
    }
  }

  private checkPolicyExemptions(policy: SecurityPolicy, context: any): PolicyException | null {
    for (const exception of policy.enforcement.exceptions) {
      // Check if exception is still valid
      if (exception.validUntil && new Date() > exception.validUntil) continue;

      // Check if exception applies to this context
      if (this.checkTargetMatch(exception.target, context)) {
        return exception;
      }
    }
    return null;
  }

  private async evaluatePolicyTriggers(policy: SecurityPolicy, context: any): Promise<boolean> {
    for (const trigger of policy.conditions.triggers) {
      const triggered = await this.evaluateTrigger(trigger, context);
      if (triggered) return true;
    }
    return false;
  }

  private async evaluateTrigger(trigger: PolicyTrigger, context: any): Promise<boolean> {
    switch (trigger.type) {
      case 'event':
        return this.evaluateEventTrigger(trigger, context);
      case 'condition':
        return this.evaluateConditionTrigger(trigger, context);
      case 'threshold':
        return await this.evaluateThresholdTrigger(trigger, context);
      case 'pattern':
        return await this.evaluatePatternTrigger(trigger, context);
      case 'schedule':
        return this.evaluateScheduleTrigger(trigger, context);
      default:
        return false;
    }
  }

  private evaluateEventTrigger(trigger: PolicyTrigger, context: any): boolean {
    if (!trigger.eventType) return false;
    
    // Map context to event types
    const eventTypeMap: Record<string, string[]> = {
      'failed_login': ['authentication'],
      'privilege_escalation': ['authorization'],
      'data_access': ['data_access'],
      'admin_action': ['system_change']
    };

    const applicableEvents = eventTypeMap[trigger.eventType] || [trigger.eventType];
    return applicableEvents.includes(context.action) || 
           (context.endpoint && applicableEvents.some(event => context.endpoint.includes(event)));
  }

  private evaluateConditionTrigger(trigger: PolicyTrigger, context: any): boolean {
    if (!trigger.condition) return false;

    const fieldValue = this.getFieldValue(context, trigger.condition.field);
    const expectedValue = trigger.condition.value;

    switch (trigger.condition.operator) {
      case 'equals':
        return fieldValue === expectedValue;
      case 'not_equals':
        return fieldValue !== expectedValue;
      case 'greater_than':
        return Number(fieldValue) > Number(expectedValue);
      case 'less_than':
        return Number(fieldValue) < Number(expectedValue);
      case 'contains':
        return String(fieldValue).includes(String(expectedValue));
      case 'regex':
        return new RegExp(String(expectedValue)).test(String(fieldValue));
      default:
        return false;
    }
  }

  private async evaluateThresholdTrigger(trigger: PolicyTrigger, context: any): Promise<boolean> {
    if (!trigger.threshold) return false;

    try {
      // Get historical data for threshold evaluation
      const cutoffTime = new Date(Date.now() - (trigger.threshold.timeWindow * 60 * 1000));
      
      let count = 0;
      switch (trigger.threshold.metric) {
        case 'request_count':
          count = await this.getRequestCount(context, cutoffTime);
          break;
        case 'failed_attempts':
          count = await this.getFailedAttemptCount(context, cutoffTime);
          break;
        case 'data_volume':
          count = await this.getDataVolumeMetric(context, cutoffTime);
          break;
        default:
          return false;
      }

      return count >= trigger.threshold.value;

    } catch (error) {
      logger.error('Failed to evaluate threshold trigger', error as Error, {
        metric: trigger.threshold?.metric,
        threshold: trigger.threshold?.value
      });
      return false;
    }
  }

  private async evaluatePatternTrigger(trigger: PolicyTrigger, context: any): Promise<boolean> {
    if (!trigger.pattern) return false;

    try {
      // Look for sequence pattern in recent events
      const cutoffTime = new Date(Date.now() - (trigger.pattern.timeWindow * 60 * 1000));
      
      const recentEvents = await securityMonitoringSystem.searchEvents({
        userId: context.userId,
        ip: context.ip,
        timeRange: { start: cutoffTime, end: new Date() },
        limit: 100
      });

      // Check if the pattern sequence exists
      const eventActions = recentEvents.map(event => event.details.action);
      return this.findSequence(eventActions, trigger.pattern.sequence);

    } catch (error) {
      logger.error('Failed to evaluate pattern trigger', error as Error, {
        pattern: trigger.pattern?.sequence
      });
      return false;
    }
  }

  private evaluateScheduleTrigger(trigger: PolicyTrigger, context: any): boolean {
    if (!trigger.schedule) return false;

    // Basic cron evaluation (would use a proper cron library in production)
    const now = new Date();
    return this.matchesCronSchedule(now, trigger.schedule.cron);
  }

  private calculatePolicyRisk(policy: SecurityPolicy, context: any): number {
    const baseRisk = {
      'low': 10,
      'medium': 25,
      'high': 50,
      'critical': 75
    }[policy.priority] || 0;

    // Adjust based on policy category
    const categoryMultiplier = {
      'threat_prevention': 1.5,
      'data_protection': 1.3,
      'authentication': 1.2,
      'authorization': 1.1,
      'compliance': 1.0,
      'system_integrity': 1.4
    }[policy.category] || 1.0;

    return Math.round(baseRisk * categoryMultiplier);
  }

  private determineRecommendation(
    violatedPolicies: SecurityPolicy[],
    riskScore: number
  ): 'allow' | 'block' | 'warn' | 'monitor' {
    if (violatedPolicies.length === 0) return 'allow';
    
    const hasBlockingPolicy = violatedPolicies.some(policy => 
      policy.enforcement.mode === 'blocking'
    );
    
    if (hasBlockingPolicy || riskScore >= 80) return 'block';
    if (riskScore >= 50) return 'warn';
    return 'monitor';
  }

  private determineAccess(
    violatedPolicies: SecurityPolicy[],
    appliedActions: PolicyAction[],
    exemptions: PolicyException[]
  ): boolean {
    // Allow if exempted
    if (exemptions.length > 0) return true;

    // Block if any blocking policy is violated
    const hasBlockingViolation = violatedPolicies.some(policy => 
      policy.enforcement.mode === 'blocking'
    );

    // Block if any blocking action is applied
    const hasBlockingAction = appliedActions.some(action => action.type === 'block');

    return !hasBlockingViolation && !hasBlockingAction;
  }

  private async handlePolicyViolations(
    context: any,
    result: PolicyEnforcementResult
  ): Promise<void> {
    this.enforcementStats.policyViolations++;
    if (!result.allowed) {
      this.enforcementStats.blockedRequests++;
    }

    for (const policy of result.violatedPolicies) {
      const violation: PolicyViolation = {
        id: `violation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        policyId: policy.id,
        policyName: policy.name,
        severity: this.mapPriorityToSeverity(policy.priority),
        details: {
          trigger: policy.conditions.triggers[0], // First triggered rule
          context,
          violationType: 'direct'
        },
        source: {
          userId: context.userId,
          ip: context.ip,
          userAgent: context.userAgent,
          service: context.service,
          endpoint: context.endpoint
        },
        response: {
          actions: policy.actions,
          blocked: !result.allowed,
          exempted: result.exemptions.length > 0,
          exemptionReason: result.exemptions[0]?.reason
        },
        metadata: {
          timestamp: new Date(),
          processed: false,
          escalated: false,
          resolved: false
        }
      };

      // Store violation
      await this.storeViolation(violation);

      // Add to processing queue
      this.processingQueue.push(violation);

      // Update policy metrics
      policy.metrics.violationCount++;
      await this.updatePolicyMetrics(policy);

      // Check for escalation
      if (policy.enforcement.escalation) {
        await this.checkEscalationConditions(policy, violation);
      }
    }
  }

  private async checkEscalationConditions(policy: SecurityPolicy, violation: PolicyViolation): Promise<void> {
    if (!policy.enforcement.escalation) return;

    try {
      const { conditions } = policy.enforcement.escalation;
      const cutoffTime = new Date(Date.now() - (conditions.timeWindow * 60 * 1000));

      // Count recent violations for this policy
      const recentViolations = await this.getRecentViolations(policy.id, cutoffTime);

      if (recentViolations.length >= conditions.violationCount) {
        // Trigger escalation
        violation.metadata.escalated = true;
        await this.updateViolation(violation);

        // Execute escalation actions
        for (const action of policy.enforcement.escalation.actions) {
          await this.executeAction(action, violation);
        }

        // Notify recipients
        await this.sendEscalationNotifications(policy, violation, recentViolations);

        logger.warn('Policy violation escalated', {
          policyId: policy.id,
          policyName: policy.name,
          violationId: violation.id,
          recentViolationCount: recentViolations.length
        });
      }

    } catch (error) {
      logger.error('Failed to check escalation conditions', error as Error, {
        policyId: policy.id,
        violationId: violation.id
      });
    }
  }

  private validatePolicy(policy: SecurityPolicy): void {
    if (!policy.name || policy.name.trim().length === 0) {
      throw new Error('Policy name is required');
    }

    if (!policy.conditions.triggers || policy.conditions.triggers.length === 0) {
      throw new Error('Policy must have at least one trigger');
    }

    if (!policy.actions || policy.actions.length === 0) {
      throw new Error('Policy must have at least one action');
    }

    if (!policy.conditions.scope.targets || policy.conditions.scope.targets.length === 0) {
      throw new Error('Policy must have at least one target in scope');
    }

    // Validate triggers
    for (const trigger of policy.conditions.triggers) {
      this.validateTrigger(trigger);
    }

    // Validate actions
    for (const action of policy.actions) {
      this.validateAction(action);
    }
  }

  private validateTrigger(trigger: PolicyTrigger): void {
    switch (trigger.type) {
      case 'threshold':
        if (!trigger.threshold || !trigger.threshold.metric || trigger.threshold.value <= 0) {
          throw new Error('Threshold trigger requires metric and positive value');
        }
        break;
      case 'pattern':
        if (!trigger.pattern || !trigger.pattern.sequence || trigger.pattern.sequence.length === 0) {
          throw new Error('Pattern trigger requires sequence');
        }
        break;
      case 'condition':
        if (!trigger.condition || !trigger.condition.field || !trigger.condition.operator) {
          throw new Error('Condition trigger requires field and operator');
        }
        break;
    }
  }

  private validateAction(action: PolicyAction): void {
    const validActionTypes = ['block', 'alert', 'log', 'redirect', 'throttle', 'quarantine', 'require_auth', 'require_mfa'];
    if (!validActionTypes.includes(action.type)) {
      throw new Error(`Invalid action type: ${action.type}`);
    }
  }

  private generateCacheKey(context: any): string {
    const key = [
      context.userId || 'anonymous',
      context.ip,
      context.service,
      context.endpoint || '',
      context.action
    ].join('|');

    return require('crypto').createHash('sha256').update(key).digest('hex').substring(0, 16);
  }

  private getFieldValue(obj: any, fieldPath: string): any {
    return fieldPath.split('.').reduce((current, prop) => current?.[prop], obj);
  }

  private findSequence(haystack: string[], needle: string[]): boolean {
    for (let i = 0; i <= haystack.length - needle.length; i++) {
      let found = true;
      for (let j = 0; j < needle.length; j++) {
        if (haystack[i + j] !== needle[j]) {
          found = false;
          break;
        }
      }
      if (found) return true;
    }
    return false;
  }

  private matchesCronSchedule(date: Date, cron: string): boolean {
    // Simplified cron matching - would use a proper library in production
    return true; // Placeholder implementation
  }

  private mapPriorityToSeverity(priority: string): 'low' | 'medium' | 'high' | 'critical' {
    return priority as 'low' | 'medium' | 'high' | 'critical';
  }

  // Database operations
  private async storeViolation(violation: PolicyViolation): Promise<void> {
    await firestoreHelper.setDocument('policy_violations', violation.id, violation);
  }

  private async updateViolation(violation: PolicyViolation): Promise<void> {
    await firestoreHelper.updateDocument('policy_violations', violation.id, {
      metadata: violation.metadata
    });
  }

  private async updatePolicyMetrics(policy: SecurityPolicy): Promise<void> {
    await firestoreHelper.updateDocument('security_policies', policy.id, {
      metrics: policy.metrics
    });
  }

  private async getRecentViolations(policyId: string, cutoffTime: Date): Promise<PolicyViolation[]> {
    try {
      const snapshot = await this.db.collection('policy_violations')
        .where('policyId', '==', policyId)
        .where('metadata.timestamp', '>=', cutoffTime)
        .get();

      return snapshot.docs.map(doc => doc.data() as PolicyViolation);
    } catch (error) {
      logger.error('Failed to get recent violations', error as Error, { policyId });
      return [];
    }
  }

  private async getRequestCount(context: any, cutoffTime: Date): Promise<number> {
    // Implementation would query actual request logs
    return 0; // Placeholder
  }

  private async getFailedAttemptCount(context: any, cutoffTime: Date): Promise<number> {
    // Implementation would query security events
    return 0; // Placeholder
  }

  private async getDataVolumeMetric(context: any, cutoffTime: Date): Promise<number> {
    // Implementation would query data access logs
    return 0; // Placeholder
  }

  private async executeAction(action: PolicyAction, violation: PolicyViolation): Promise<void> {
    switch (action.type) {
      case 'block':
        // Block action handled at middleware level
        break;
      case 'alert':
        await this.sendAlert(violation, action);
        break;
      case 'quarantine':
        await this.quarantineUser(violation, action);
        break;
      // Add other action implementations
    }
  }

  private async sendAlert(violation: PolicyViolation, action: PolicyAction): Promise<void> {
    await securityMonitoringSystem.logSecurityEvent({
      type: 'security_violation',
      severity: action.parameters?.alertSeverity as any || violation.severity,
      source: violation.source,
      details: {
        action: 'policy_violation',
        outcome: 'blocked',
        resource: violation.source.endpoint,
        metadata: {
          policyId: violation.policyId,
          policyName: violation.policyName,
          violationId: violation.id
        }
      },
      risk: {
        score: 70,
        factors: ['policy_violation'],
        confidence: 0.9
      }
    });
  }

  private async quarantineUser(violation: PolicyViolation, action: PolicyAction): Promise<void> {
    if (violation.source.userId) {
      const duration = action.parameters?.quarantineDuration || 3600; // 1 hour default
      // Implementation would integrate with access control system
      logger.warn('User quarantined due to policy violation', {
        userId: violation.source.userId,
        duration,
        violationId: violation.id
      });
    }
  }

  private async sendEscalationNotifications(
    policy: SecurityPolicy,
    violation: PolicyViolation,
    recentViolations: PolicyViolation[]
  ): Promise<void> {
    // Implementation would integrate with notification system
    logger.error('Policy escalation notification', {
      policyId: policy.id,
      policyName: policy.name,
      violationId: violation.id,
      recentViolationCount: recentViolations.length,
      recipients: policy.enforcement.escalation?.recipients
    });
  }

  private async initializePolicyEngine(): Promise<void> {
    try {
      // Load active policies
      await this.loadActivePolicies();

      // Create default policies if none exist
      if (this.policies.size === 0) {
        await this.createDefaultPolicies();
      }

      // Start violation processing
      this.startViolationProcessing();

      // Clean up expired cache entries
      this.startCacheCleanup();

      logger.info('Security policy engine initialized', {
        policyCount: this.policies.size
      });

    } catch (error) {
      logger.error('Failed to initialize policy engine', error as Error);
      throw error;
    }
  }

  private async loadActivePolicies(): Promise<void> {
    try {
      const snapshot = await this.db.collection('security_policies')
        .where('enabled', '==', true)
        .get();

      snapshot.docs.forEach(doc => {
        const policy = doc.data() as SecurityPolicy;
        this.policies.set(policy.id, policy);
      });

    } catch (error) {
      logger.error('Failed to load active policies', error as Error);
    }
  }

  private async createDefaultPolicies(): Promise<void> {
    const defaultPolicies = [
      {
        name: 'Brute Force Protection',
        description: 'Prevent brute force attacks on authentication endpoints',
        category: 'authentication' as const,
        priority: 'high' as const,
        enabled: true,
        conditions: {
          triggers: [{
            type: 'threshold' as const,
            threshold: {
              metric: 'failed_attempts',
              value: 5,
              timeWindow: 15
            }
          }],
          scope: {
            targets: [{
              type: 'endpoint' as const,
              values: ['/auth/login', '/auth/register']
            }]
          }
        },
        actions: [{
          type: 'block' as const,
          parameters: {
            message: 'Too many failed attempts. Try again later.'
          }
        }],
        enforcement: {
          mode: 'blocking' as const,
          exceptions: []
        }
      },
      {
        name: 'Admin Access Control',
        description: 'Strict controls for administrative functions',
        category: 'authorization' as const,
        priority: 'critical' as const,
        enabled: true,
        conditions: {
          triggers: [{
            type: 'event' as const,
            eventType: 'admin_action'
          }],
          scope: {
            targets: [{
              type: 'endpoint' as const,
              values: ['/admin/*']
            }]
          }
        },
        actions: [{
          type: 'require_mfa' as const
        }, {
          type: 'log' as const,
          parameters: {
            logLevel: 'warn'
          }
        }],
        enforcement: {
          mode: 'blocking' as const,
          exceptions: []
        }
      }
    ];

    for (const policyData of defaultPolicies) {
      await this.createPolicy(policyData);
    }
  }

  private startViolationProcessing(): void {
    setInterval(async () => {
      if (this.processingQueue.length > 0) {
        const violations = this.processingQueue.splice(0, 50); // Process in batches
        
        for (const violation of violations) {
          if (!violation.metadata.processed) {
            violation.metadata.processed = true;
            await this.updateViolation(violation);
          }
        }
      }
    }, 10000); // Process every 10 seconds
  }

  private startCacheCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      for (const [key, cached] of this.evaluationCache.entries()) {
        if (cached.expiry <= now) {
          this.evaluationCache.delete(key);
        }
      }
    }, 5 * 60 * 1000); // Clean up every 5 minutes
  }

  // Public management methods
  async getPolicyMetrics(): Promise<{
    totalPolicies: number;
    activePolicies: number;
    violationCount: number;
    exemptionCount: number;
    enforcementStats: typeof this.enforcementStats;
  }> {
    const totalPolicies = await this.db.collection('security_policies').count().get();
    const activePolicies = this.policies.size;
    
    const violationSnapshot = await this.db.collection('policy_violations')
      .where('metadata.timestamp', '>=', new Date(Date.now() - 24 * 60 * 60 * 1000))
      .count()
      .get();

    return {
      totalPolicies: totalPolicies.data().count,
      activePolicies,
      violationCount: violationSnapshot.data().count,
      exemptionCount: this.enforcementStats.exemptionCount,
      enforcementStats: this.enforcementStats
    };
  }

  async getAllPolicies(): Promise<SecurityPolicy[]> {
    return Array.from(this.policies.values());
  }

  async getPolicy(policyId: string): Promise<SecurityPolicy | null> {
    return this.policies.get(policyId) || null;
  }

  async getViolationHistory(
    filters: {
      policyId?: string;
      userId?: string;
      ip?: string;
      timeRange?: { start: Date; end: Date };
      limit?: number;
    }
  ): Promise<PolicyViolation[]> {
    try {
      let query = this.db.collection('policy_violations') as any;

      if (filters.policyId) {
        query = query.where('policyId', '==', filters.policyId);
      }
      if (filters.userId) {
        query = query.where('source.userId', '==', filters.userId);
      }
      if (filters.ip) {
        query = query.where('source.ip', '==', filters.ip);
      }
      if (filters.timeRange) {
        query = query.where('metadata.timestamp', '>=', filters.timeRange.start)
                    .where('metadata.timestamp', '<=', filters.timeRange.end);
      }

      query = query.orderBy('metadata.timestamp', 'desc').limit(filters.limit || 100);

      const snapshot = await query.get();
      return snapshot.docs.map((doc: any) => doc.data() as PolicyViolation);

    } catch (error) {
      logger.error('Failed to get violation history', error as Error, { filters });
      return [];
    }
  }
}

// Singleton instance
export const securityPolicyEngine = new SecurityPolicyEngine();

// Helper functions for middleware integration
export async function enforcePolicies(context: {
  userId?: string;
  ip: string;
  userAgent?: string;
  service: string;
  endpoint?: string;
  action: string;
  resource?: string;
  data?: any;
  headers?: Record<string, string>;
}): Promise<PolicyEnforcementResult> {
  return await securityPolicyEngine.evaluateRequest(context);
}

export async function createSecurityPolicy(
  policyData: Omit<SecurityPolicy, 'id' | 'metrics'>
): Promise<SecurityPolicy> {
  return await securityPolicyEngine.createPolicy(policyData);
}

export async function getPolicyViolations(
  filters?: {
    policyId?: string;
    userId?: string;
    ip?: string;
    timeRange?: { start: Date; end: Date };
    limit?: number;
  }
): Promise<PolicyViolation[]> {
  return await securityPolicyEngine.getViolationHistory(filters || {});
}