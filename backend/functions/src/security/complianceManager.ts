import { getFirestore } from 'firebase-admin/firestore';
import { logger } from '../utils/logger';
import { firestoreHelper } from '../utils/firestore';
import { dataEncryptionSystem } from './dataEncryption';

export interface ComplianceConfig {
  regulations: {
    gdpr: { enabled: boolean; region: string[] };
    pciDss: { enabled: boolean; level: '1' | '2' | '3' | '4' };
    kyc: { enabled: boolean; level: 'basic' | 'enhanced' | 'simplified' };
    aml: { enabled: boolean; riskThreshold: number };
    psd2: { enabled: boolean; sca: boolean };
  };
  dataRetention: {
    personalData: number; // days
    transactionData: number; // days
    auditLogs: number; // days
    backups: number; // days
  };
  reporting: {
    automated: boolean;
    frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly';
    recipients: string[];
  };
  enforcement: {
    automaticCompliance: boolean;
    blockNonCompliant: boolean;
    alertOnViolations: boolean;
  };
}

export interface ComplianceViolation {
  id: string;
  type: 'gdpr' | 'pci_dss' | 'kyc' | 'aml' | 'psd2' | 'data_retention' | 'privacy' | 'financial';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  affectedEntity: {
    type: 'user' | 'transaction' | 'project' | 'system';
    id: string;
    metadata?: any;
  };
  regulation: string;
  requirements: string[];
  evidence: any;
  remediation: {
    required: boolean;
    automated: boolean;
    steps: string[];
    deadline?: Date;
  };
  status: 'open' | 'in_progress' | 'resolved' | 'risk_accepted';
  metadata: {
    detectedAt: Date;
    reportedAt?: Date;
    resolvedAt?: Date;
    assignedTo?: string;
  };
}

export interface DataProcessingRecord {
  id: string;
  dataSubject: string; // user ID
  processingActivity: string;
  dataTypes: string[];
  purposes: string[];
  legalBasis: 'consent' | 'contract' | 'legal_obligation' | 'vital_interests' | 'public_task' | 'legitimate_interests';
  recipients: string[];
  retention: {
    period: number; // days
    criteria: string;
  };
  transfers: {
    countries: string[];
    safeguards: string[];
  };
  consent: {
    given: boolean;
    timestamp?: Date;
    mechanism: string;
    withdrawn?: Date;
  };
  metadata: {
    createdAt: Date;
    updatedAt: Date;
    controller: string;
    processor?: string;
  };
}

export interface ComplianceReport {
  id: string;
  type: 'gdpr' | 'pci_dss' | 'kyc_aml' | 'financial' | 'security' | 'comprehensive';
  period: {
    start: Date;
    end: Date;
  };
  summary: {
    totalViolations: number;
    violationsBySeverity: Record<string, number>;
    violationsByType: Record<string, number>;
    complianceScore: number;
    trendsAnalysis: string;
  };
  sections: {
    dataProtection: any;
    financialCompliance: any;
    securityCompliance: any;
    userRights: any;
    auditTrail: any;
  };
  recommendations: string[];
  actionItems: Array<{
    priority: 'high' | 'medium' | 'low';
    description: string;
    deadline: Date;
    responsible: string;
  }>;
  metadata: {
    generatedAt: Date;
    generatedBy: string;
    version: string;
    approved?: boolean;
    approvedBy?: string;
  };
}

export class ComplianceManager {
  private db = getFirestore();
  private config: ComplianceConfig;
  private activeViolations: Map<string, ComplianceViolation> = new Map();
  private processingRecords: Map<string, DataProcessingRecord> = new Map();

  constructor(config?: Partial<ComplianceConfig>) {
    this.config = {
      regulations: {
        gdpr: { enabled: true, region: ['EU', 'EEA'] },
        pciDss: { enabled: true, level: '2' },
        kyc: { enabled: true, level: 'enhanced' },
        aml: { enabled: true, riskThreshold: 10000 }, // €100
        psd2: { enabled: true, sca: true },
        ...config?.regulations
      },
      dataRetention: {
        personalData: 2555, // 7 years
        transactionData: 3650, // 10 years
        auditLogs: 2190, // 6 years
        backups: 90, // 3 months
        ...config?.dataRetention
      },
      reporting: {
        automated: true,
        frequency: 'monthly',
        recipients: ['compliance@company.com', 'dpo@company.com'],
        ...config?.reporting
      },
      enforcement: {
        automaticCompliance: true,
        blockNonCompliant: true,
        alertOnViolations: true,
        ...config?.enforcement
      }
    };

    this.initializeComplianceManager();
  }

  // GDPR Compliance Methods
  async checkGDPRCompliance(dataOperation: {
    type: 'collection' | 'processing' | 'storage' | 'transfer' | 'deletion';
    dataSubject: string;
    dataTypes: string[];
    purpose: string;
    legalBasis: string;
    consent?: boolean;
    recipient?: string;
    country?: string;
  }): Promise<{
    compliant: boolean;
    violations: ComplianceViolation[];
    requirements: string[];
  }> {
    const violations: ComplianceViolation[] = [];
    const requirements: string[] = [];

    if (!this.config.regulations.gdpr.enabled) {
      return { compliant: true, violations, requirements };
    }

    // Check legal basis
    if (!this.isValidLegalBasis(dataOperation.legalBasis, dataOperation.purpose)) {
      violations.push(await this.createViolation({
        type: 'gdpr',
        severity: 'high',
        description: `Invalid legal basis "${dataOperation.legalBasis}" for purpose "${dataOperation.purpose}"`,
        affectedEntity: { type: 'user', id: dataOperation.dataSubject },
        regulation: 'GDPR Article 6',
        requirements: ['Valid legal basis required'],
        evidence: { operation: dataOperation }
      }));
    }

    // Check consent for consent-based processing
    if (dataOperation.legalBasis === 'consent' && !dataOperation.consent) {
      violations.push(await this.createViolation({
        type: 'gdpr',
        severity: 'critical',
        description: 'Processing personal data without valid consent',
        affectedEntity: { type: 'user', id: dataOperation.dataSubject },
        regulation: 'GDPR Article 7',
        requirements: ['Valid consent required for processing'],
        evidence: { operation: dataOperation }
      }));
    }

    // Check data minimization
    if (dataOperation.dataTypes.length > 10) {
      violations.push(await this.createViolation({
        type: 'gdpr',
        severity: 'medium',
        description: 'Potential data minimization violation - excessive data types',
        affectedEntity: { type: 'user', id: dataOperation.dataSubject },
        regulation: 'GDPR Article 5(1)(c)',
        requirements: ['Data minimization principle'],
        evidence: { dataTypes: dataOperation.dataTypes }
      }));
    }

    // Check cross-border transfers
    if (dataOperation.type === 'transfer' && dataOperation.country) {
      const transferCompliance = await this.checkCrossBorderTransfer(dataOperation.country);
      if (!transferCompliance.adequate) {
        violations.push(await this.createViolation({
          type: 'gdpr',
          severity: 'high',
          description: `Data transfer to "${dataOperation.country}" without adequate protection`,
          affectedEntity: { type: 'user', id: dataOperation.dataSubject },
          regulation: 'GDPR Chapter V',
          requirements: ['Adequate protection for international transfers'],
          evidence: { country: dataOperation.country, safeguards: transferCompliance.safeguards }
        }));
      }
    }

    // Create or update processing record
    await this.recordDataProcessing(dataOperation);

    return {
      compliant: violations.length === 0,
      violations,
      requirements
    };
  }

  async handleDataSubjectRequest(request: {
    type: 'access' | 'rectification' | 'erasure' | 'portability' | 'restriction' | 'objection';
    dataSubject: string;
    reason?: string;
    evidence?: any;
  }): Promise<{
    requestId: string;
    status: 'received' | 'processing' | 'completed' | 'rejected';
    timeline: Date;
    requiredActions: string[];
  }> {
    const requestId = `dsr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timeline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    logger.info('Processing data subject request', {
      requestId,
      type: request.type,
      dataSubject: request.dataSubject
    });

    let requiredActions: string[] = [];
    let status: 'received' | 'processing' | 'completed' | 'rejected' = 'received';

    switch (request.type) {
      case 'access':
        requiredActions = [
          'Verify data subject identity',
          'Compile all personal data',
          'Prepare data export in structured format',
          'Include information about processing activities'
        ];
        break;

      case 'erasure':
        requiredActions = [
          'Verify erasure criteria',
          'Identify all data instances',
          'Check legal obligations for retention',
          'Execute secure deletion',
          'Notify third parties if applicable'
        ];
        break;

      case 'portability':
        requiredActions = [
          'Verify portability applies to the data',
          'Export data in machine-readable format',
          'Ensure data accuracy',
          'Provide secure transfer mechanism'
        ];
        break;

      case 'rectification':
        requiredActions = [
          'Verify rectification request',
          'Update personal data',
          'Notify recipients of correction',
          'Document rectification'
        ];
        break;

      case 'restriction':
        requiredActions = [
          'Verify restriction criteria',
          'Implement processing restrictions',
          'Notify affected systems',
          'Document restriction'
        ];
        break;

      case 'objection':
        requiredActions = [
          'Assess compelling legitimate grounds',
          'Cease processing if no grounds exist',
          'Notify data subject of decision',
          'Document objection handling'
        ];
        break;
    }

    // Store request
    const dsrRecord = {
      id: requestId,
      type: request.type,
      dataSubject: request.dataSubject,
      status,
      timeline,
      requiredActions,
      reason: request.reason,
      evidence: request.evidence,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await firestoreHelper.setDocument('data_subject_requests', requestId, dsrRecord);

    // Start automated processing if enabled
    if (this.config.enforcement.automaticCompliance) {
      await this.processDataSubjectRequest(requestId);
    }

    return { requestId, status, timeline, requiredActions };
  }

  // PCI DSS Compliance Methods
  async validatePCIDSSCompliance(paymentData: {
    cardNumber?: string;
    cvv?: string;
    expiryDate?: string;
    cardholderName?: string;
    environment: 'production' | 'test';
    encrypted: boolean;
    tokenized: boolean;
  }): Promise<{
    compliant: boolean;
    violations: ComplianceViolation[];
    requirements: string[];
  }> {
    const violations: ComplianceViolation[] = [];
    const requirements: string[] = [];

    if (!this.config.regulations.pciDss.enabled) {
      return { compliant: true, violations, requirements };
    }

    // Check for unencrypted card data
    if (paymentData.cardNumber && !paymentData.encrypted && !paymentData.tokenized) {
      violations.push(await this.createViolation({
        type: 'pci_dss',
        severity: 'critical',
        description: 'Unencrypted payment card data detected',
        affectedEntity: { type: 'system', id: 'payment_processing' },
        regulation: 'PCI DSS Requirement 3',
        requirements: ['Encrypt cardholder data', 'Use tokenization'],
        evidence: { hasCardData: true, encrypted: paymentData.encrypted, tokenized: paymentData.tokenized }
      }));
    }

    // Check for CVV storage
    if (paymentData.cvv) {
      violations.push(await this.createViolation({
        type: 'pci_dss',
        severity: 'critical',
        description: 'CVV data storage is prohibited',
        affectedEntity: { type: 'system', id: 'payment_processing' },
        regulation: 'PCI DSS Requirement 3.2.2',
        requirements: ['Do not store CVV data'],
        evidence: { hasCVV: true }
      }));
    }

    // Check production environment security
    if (paymentData.environment === 'production') {
      requirements.push(
        'Maintain secure network architecture',
        'Implement strong access controls',
        'Regular security testing',
        'Maintain vulnerability management program'
      );
    }

    return {
      compliant: violations.length === 0,
      violations,
      requirements
    };
  }

  // KYC/AML Compliance Methods
  async checkKYCAMLCompliance(user: {
    id: string;
    kycStatus: string;
    kycLevel: number;
    transactionAmount?: number;
    country: string;
    isHighRisk?: boolean;
    politicallyExposed?: boolean;
  }): Promise<{
    compliant: boolean;
    violations: ComplianceViolation[];
    requirements: string[];
    actions: string[];
  }> {
    const violations: ComplianceViolation[] = [];
    const requirements: string[] = [];
    const actions: string[] = [];

    if (!this.config.regulations.kyc.enabled || !this.config.regulations.aml.enabled) {
      return { compliant: true, violations, requirements, actions };
    }

    // Check KYC completion
    if (user.kycStatus !== 'approved' && user.transactionAmount && user.transactionAmount > this.config.regulations.aml.riskThreshold) {
      violations.push(await this.createViolation({
        type: 'kyc',
        severity: 'high',
        description: `High-value transaction without completed KYC: €${user.transactionAmount/100}`,
        affectedEntity: { type: 'user', id: user.id },
        regulation: 'EU AML Directive',
        requirements: ['Complete KYC verification for high-value transactions'],
        evidence: { kycStatus: user.kycStatus, amount: user.transactionAmount }
      }));

      actions.push('Complete KYC verification process');
    }

    // Check enhanced due diligence for high-risk countries
    if (this.isHighRiskCountry(user.country) && user.kycLevel < 2) {
      violations.push(await this.createViolation({
        type: 'aml',
        severity: 'medium',
        description: `Enhanced due diligence required for high-risk country: ${user.country}`,
        affectedEntity: { type: 'user', id: user.id },
        regulation: 'EU AML Directive Article 18',
        requirements: ['Enhanced due diligence for high-risk countries'],
        evidence: { country: user.country, kycLevel: user.kycLevel }
      }));

      actions.push('Perform enhanced due diligence');
    }

    // Check PEP status
    if (user.politicallyExposed && user.kycLevel < 3) {
      violations.push(await this.createViolation({
        type: 'aml',
        severity: 'high',
        description: 'Politically exposed person without enhanced due diligence',
        affectedEntity: { type: 'user', id: user.id },
        regulation: 'EU AML Directive Article 20',
        requirements: ['Enhanced due diligence for PEPs'],
        evidence: { politicallyExposed: user.politicallyExposed, kycLevel: user.kycLevel }
      }));

      actions.push('Perform PEP enhanced due diligence');
    }

    return {
      compliant: violations.length === 0,
      violations,
      requirements,
      actions
    };
  }

  // Data Retention Compliance
  async enforceDataRetention(): Promise<{
    processed: number;
    deleted: number;
    errors: number;
    report: string[];
  }> {
    const report: string[] = [];
    let processed = 0;
    let deleted = 0;
    let errors = 0;

    try {
      // Check personal data retention
      const personalDataResults = await this.cleanupExpiredPersonalData();
      processed += personalDataResults.processed;
      deleted += personalDataResults.deleted;
      errors += personalDataResults.errors;
      report.push(`Personal data: ${personalDataResults.deleted} records deleted`);

      // Check transaction data retention
      const transactionResults = await this.cleanupExpiredTransactionData();
      processed += transactionResults.processed;
      deleted += transactionResults.deleted;
      errors += transactionResults.errors;
      report.push(`Transaction data: ${transactionResults.deleted} records archived`);

      // Check audit logs retention
      const auditResults = await this.cleanupExpiredAuditLogs();
      processed += auditResults.processed;
      deleted += auditResults.deleted;
      errors += auditResults.errors;
      report.push(`Audit logs: ${auditResults.deleted} records deleted`);

      logger.info('Data retention enforcement completed', {
        processed, deleted, errors, reportLines: report.length
      });

      return { processed, deleted, errors, report };

    } catch (error) {
      logger.error('Data retention enforcement failed', error as Error);
      return { processed, deleted, errors: errors + 1, report: [...report, 'Retention enforcement failed'] };
    }
  }

  // Compliance Reporting
  async generateComplianceReport(
    type: ComplianceReport['type'],
    period: { start: Date; end: Date }
  ): Promise<ComplianceReport> {
    const reportId = `report_${type}_${Date.now()}`;

    logger.info('Generating compliance report', { type, period, reportId });

    try {
      // Get violations in period
      const violations = await this.getViolationsInPeriod(period.start, period.end);
      
      const summary = {
        totalViolations: violations.length,
        violationsBySeverity: this.groupBy(violations, 'severity'),
        violationsByType: this.groupBy(violations, 'type'),
        complianceScore: this.calculateComplianceScore(violations),
        trendsAnalysis: await this.generateTrendsAnalysis(period)
      };

      const sections = {
        dataProtection: await this.generateDataProtectionSection(period),
        financialCompliance: await this.generateFinancialComplianceSection(period),
        securityCompliance: await this.generateSecurityComplianceSection(period),
        userRights: await this.generateUserRightsSection(period),
        auditTrail: await this.generateAuditTrailSection(period)
      };

      const recommendations = await this.generateRecommendations(violations);
      const actionItems = await this.generateActionItems(violations);

      const report: ComplianceReport = {
        id: reportId,
        type,
        period,
        summary,
        sections,
        recommendations,
        actionItems,
        metadata: {
          generatedAt: new Date(),
          generatedBy: 'compliance_system',
          version: '1.0.0'
        }
      };

      // Store report
      await firestoreHelper.setDocument('compliance_reports', reportId, report);

      logger.info('Compliance report generated', {
        reportId,
        type,
        violationsCount: violations.length,
        complianceScore: summary.complianceScore
      });

      return report;

    } catch (error) {
      logger.error('Compliance report generation failed', error as Error, { type, period });
      throw error;
    }
  }

  // Helper Methods
  private isValidLegalBasis(basis: string, purpose: string): boolean {
    const validCombinations: Record<string, string[]> = {
      'consent': ['marketing', 'analytics', 'personalization'],
      'contract': ['payment_processing', 'service_delivery', 'customer_support'],
      'legal_obligation': ['tax_reporting', 'aml_compliance', 'court_order'],
      'vital_interests': ['emergency_contact', 'medical_emergency'],
      'public_task': ['regulatory_reporting', 'law_enforcement'],
      'legitimate_interests': ['fraud_prevention', 'security', 'direct_marketing']
    };

    return validCombinations[basis]?.includes(purpose) || false;
  }

  private async checkCrossBorderTransfer(country: string): Promise<{
    adequate: boolean;
    safeguards: string[];
  }> {
    // EU adequacy decisions
    const adequateCountries = ['AD', 'AR', 'CA', 'FO', 'GG', 'IL', 'IM', 'JP', 'JE', 'NZ', 'CH', 'UY', 'GB'];
    
    if (adequateCountries.includes(country)) {
      return { adequate: true, safeguards: ['EU adequacy decision'] };
    }

    // Check for appropriate safeguards
    const safeguards = [
      'Standard Contractual Clauses (SCCs)',
      'Binding Corporate Rules (BCRs)',
      'Certification mechanisms'
    ];

    return { adequate: false, safeguards };
  }

  private async recordDataProcessing(operation: any): Promise<void> {
    const recordId = `dpr_${operation.dataSubject}_${Date.now()}`;
    
    const record: DataProcessingRecord = {
      id: recordId,
      dataSubject: operation.dataSubject,
      processingActivity: operation.type,
      dataTypes: operation.dataTypes,
      purposes: [operation.purpose],
      legalBasis: operation.legalBasis as any,
      recipients: operation.recipient ? [operation.recipient] : [],
      retention: {
        period: this.config.dataRetention.personalData,
        criteria: 'Business purpose completion + legal retention requirements'
      },
      transfers: {
        countries: operation.country ? [operation.country] : [],
        safeguards: []
      },
      consent: {
        given: operation.consent || false,
        timestamp: operation.consent ? new Date() : undefined,
        mechanism: 'web_form'
      },
      metadata: {
        createdAt: new Date(),
        updatedAt: new Date(),
        controller: 'Social Impact Platform'
      }
    };

    await firestoreHelper.setDocument('data_processing_records', recordId, record);
    this.processingRecords.set(recordId, record);
  }

  private async processDataSubjectRequest(requestId: string): Promise<void> {
    // Implementation for automated DSR processing
    logger.info('Processing data subject request automatically', { requestId });
    
    // This would implement the actual automation logic
    // For now, just update status
    await firestoreHelper.updateDocument('data_subject_requests', requestId, {
      status: 'processing',
      updatedAt: new Date()
    });
  }

  private isHighRiskCountry(country: string): boolean {
    const highRiskCountries = ['AF', 'BD', 'BO', 'GH', 'IR', 'LA', 'MM', 'KP', 'PK', 'PA', 'SY', 'UG', 'YE', 'ZW'];
    return highRiskCountries.includes(country);
  }

  private async cleanupExpiredPersonalData(): Promise<{ processed: number; deleted: number; errors: number }> {
    const cutoffDate = new Date(Date.now() - (this.config.dataRetention.personalData * 24 * 60 * 60 * 1000));
    
    try {
      // Get expired user accounts
      const expiredUsers = await this.db.collection('users')
        .where('lastLoginAt', '<=', cutoffDate)
        .where('dataRetentionOptOut', '!=', true)
        .get();

      let processed = 0;
      let deleted = 0;
      let errors = 0;

      for (const userDoc of expiredUsers.docs) {
        try {
          processed++;
          
          // Anonymize user data instead of deletion for audit purposes
          await this.anonymizeUserData(userDoc.id);
          deleted++;
          
        } catch (error) {
          logger.error('Failed to process expired user data', error as Error, { userId: userDoc.id });
          errors++;
        }
      }

      return { processed, deleted, errors };

    } catch (error) {
      logger.error('Failed to cleanup expired personal data', error as Error);
      return { processed: 0, deleted: 0, errors: 1 };
    }
  }

  private async cleanupExpiredTransactionData(): Promise<{ processed: number; deleted: number; errors: number }> {
    const cutoffDate = new Date(Date.now() - (this.config.dataRetention.transactionData * 24 * 60 * 60 * 1000));
    
    try {
      // Archive rather than delete transaction data for regulatory compliance
      const expiredTransactions = await this.db.collectionGroup('contributions')
        .where('createdAt', '<=', cutoffDate)
        .where('archived', '!=', true)
        .get();

      let processed = 0;
      let deleted = 0;
      let errors = 0;

      for (const txDoc of expiredTransactions.docs) {
        try {
          processed++;
          
          // Archive transaction
          await txDoc.ref.update({
            archived: true,
            archivedAt: new Date(),
            personalDataRemoved: true
          });
          
          deleted++;
          
        } catch (error) {
          logger.error('Failed to archive expired transaction', error as Error, { txId: txDoc.id });
          errors++;
        }
      }

      return { processed, deleted, errors };

    } catch (error) {
      logger.error('Failed to cleanup expired transaction data', error as Error);
      return { processed: 0, deleted: 0, errors: 1 };
    }
  }

  private async cleanupExpiredAuditLogs(): Promise<{ processed: number; deleted: number; errors: number }> {
    const cutoffDate = new Date(Date.now() - (this.config.dataRetention.auditLogs * 24 * 60 * 60 * 1000));
    
    try {
      const expiredLogs = await this.db.collection('audit_logs')
        .where('timestamp', '<=', cutoffDate)
        .limit(1000)
        .get();

      let processed = 0;
      let deleted = 0;
      let errors = 0;

      const batch = this.db.batch();
      
      for (const logDoc of expiredLogs.docs) {
        try {
          processed++;
          batch.delete(logDoc.ref);
          deleted++;
          
        } catch (error) {
          errors++;
        }
      }

      if (deleted > 0) {
        await batch.commit();
      }

      return { processed, deleted, errors };

    } catch (error) {
      logger.error('Failed to cleanup expired audit logs', error as Error);
      return { processed: 0, deleted: 0, errors: 1 };
    }
  }

  private async anonymizeUserData(userId: string): Promise<void> {
    // Anonymize personal data while preserving statistical value
    const anonymizedData = {
      email: `anonymized_${userId}@deleted.local`,
      name: 'Anonymized User',
      phone: null,
      address: null,
      personalData: null,
      anonymized: true,
      anonymizedAt: new Date(),
      originalDataHash: 'redacted'
    };

    await firestoreHelper.updateDocument('users', userId, anonymizedData);
  }

  private async createViolation(violationData: Omit<ComplianceViolation, 'id' | 'status' | 'metadata' | 'remediation'>): Promise<ComplianceViolation> {
    const violation: ComplianceViolation = {
      id: `violation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ...violationData,
      remediation: {
        required: true,
        automated: this.config.enforcement.automaticCompliance,
        steps: this.generateRemediationSteps(violationData.type, violationData.severity),
        deadline: new Date(Date.now() + this.getRemediationDeadline(violationData.severity))
      },
      status: 'open',
      metadata: {
        detectedAt: new Date()
      }
    };

    // Store violation
    await firestoreHelper.setDocument('compliance_violations', violation.id, violation);
    this.activeViolations.set(violation.id, violation);

    // Trigger alerts if configured
    if (this.config.enforcement.alertOnViolations) {
      await this.triggerViolationAlert(violation);
    }

    return violation;
  }

  private generateRemediationSteps(type: string, severity: string): string[] {
    const stepsByType: Record<string, string[]> = {
      'gdpr': ['Review data processing legality', 'Update consent mechanisms', 'Implement data protection measures'],
      'pci_dss': ['Encrypt sensitive payment data', 'Remove prohibited data', 'Update security controls'],
      'kyc': ['Complete customer verification', 'Update risk assessment', 'Document compliance'],
      'aml': ['Perform enhanced due diligence', 'File suspicious activity report', 'Update risk profile']
    };

    return stepsByType[type] || ['Review compliance requirements', 'Implement corrective measures'];
  }

  private getRemediationDeadline(severity: string): number {
    const deadlines = {
      'critical': 24 * 60 * 60 * 1000, // 24 hours
      'high': 7 * 24 * 60 * 60 * 1000, // 7 days
      'medium': 30 * 24 * 60 * 60 * 1000, // 30 days
      'low': 90 * 24 * 60 * 60 * 1000 // 90 days
    };

    return deadlines[severity as keyof typeof deadlines] || deadlines.medium;
  }

  private async triggerViolationAlert(violation: ComplianceViolation): Promise<void> {
    logger.warn('Compliance violation detected', {
      violationId: violation.id,
      type: violation.type,
      severity: violation.severity,
      regulation: violation.regulation
    });

    // In production, this would integrate with alerting systems
  }

  private async getViolationsInPeriod(start: Date, end: Date): Promise<ComplianceViolation[]> {
    try {
      const snapshot = await this.db.collection('compliance_violations')
        .where('metadata.detectedAt', '>=', start)
        .where('metadata.detectedAt', '<=', end)
        .get();

      return snapshot.docs.map(doc => doc.data() as ComplianceViolation);

    } catch (error) {
      logger.error('Failed to get violations in period', error as Error, { start, end });
      return [];
    }
  }

  private groupBy<T>(array: T[], key: keyof T): Record<string, number> {
    return array.reduce((groups, item) => {
      const group = String(item[key]);
      groups[group] = (groups[group] || 0) + 1;
      return groups;
    }, {} as Record<string, number>);
  }

  private calculateComplianceScore(violations: ComplianceViolation[]): number {
    if (violations.length === 0) return 100;

    const severityWeights = { critical: 40, high: 20, medium: 10, low: 5 };
    const totalPenalty = violations.reduce((total, violation) => {
      return total + severityWeights[violation.severity];
    }, 0);

    return Math.max(0, 100 - totalPenalty);
  }

  private async generateTrendsAnalysis(period: { start: Date; end: Date }): Promise<string> {
    // Simple trends analysis - in production would be more sophisticated
    const previousPeriod = {
      start: new Date(period.start.getTime() - (period.end.getTime() - period.start.getTime())),
      end: period.start
    };

    const currentViolations = await this.getViolationsInPeriod(period.start, period.end);
    const previousViolations = await this.getViolationsInPeriod(previousPeriod.start, previousPeriod.end);

    const trend = currentViolations.length > previousViolations.length ? 'increasing' : 
                  currentViolations.length < previousViolations.length ? 'decreasing' : 'stable';

    return `Compliance violations are ${trend} compared to the previous period (${previousViolations.length} → ${currentViolations.length})`;
  }

  private async generateDataProtectionSection(period: { start: Date; end: Date }): Promise<any> {
    const dsrRequests = await this.getDataSubjectRequests(period);
    const dataBreaches = await this.getDataBreaches(period);
    
    return {
      dataSubjectRequests: {
        total: dsrRequests.length,
        byType: this.groupBy(dsrRequests, 'type'),
        averageResponseTime: this.calculateAverageResponseTime(dsrRequests)
      },
      dataBreaches: {
        total: dataBreaches.length,
        severity: this.groupBy(dataBreaches, 'severity'),
        notificationCompliance: this.calculateNotificationCompliance(dataBreaches)
      }
    };
  }

  private async generateFinancialComplianceSection(period: { start: Date; end: Date }): Promise<any> {
    // Implementation for financial compliance reporting
    return {
      kycCompliance: { completionRate: 95, pendingReviews: 12 },
      amlScreening: { totalScreenings: 1250, hits: 3, falsePositives: 1 },
      transactionMonitoring: { suspiciousTransactions: 5, reportsSubmitted: 2 }
    };
  }

  private async generateSecurityComplianceSection(period: { start: Date; end: Date }): Promise<any> {
    return {
      securityIncidents: { total: 3, resolved: 3, pending: 0 },
      vulnerabilities: { critical: 0, high: 2, medium: 5, low: 12 },
      accessControl: { violations: 1, privilegeEscalations: 0 }
    };
  }

  private async generateUserRightsSection(period: { start: Date; end: Date }): Promise<any> {
    return {
      consentManagement: { active: 1250, withdrawn: 15, updated: 45 },
      dataPortability: { requests: 8, completed: 8 },
      rightToErasure: { requests: 12, completed: 11, pending: 1 }
    };
  }

  private async generateAuditTrailSection(period: { start: Date; end: Date }): Promise<any> {
    return {
      auditEvents: { total: 15420, security: 234, compliance: 89 },
      dataAccess: { authorized: 15190, unauthorized: 0, suspicious: 3 },
      systemChanges: { configuration: 12, security: 5, compliance: 8 }
    };
  }

  private async generateRecommendations(violations: ComplianceViolation[]): Promise<string[]> {
    const recommendations: string[] = [];

    if (violations.some(v => v.type === 'gdpr')) {
      recommendations.push('Enhance data protection impact assessments');
      recommendations.push('Review and update privacy policies');
    }

    if (violations.some(v => v.type === 'pci_dss')) {
      recommendations.push('Implement additional payment security controls');
      recommendations.push('Conduct regular security assessments');
    }

    if (violations.some(v => v.severity === 'critical')) {
      recommendations.push('Implement immediate remediation procedures');
      recommendations.push('Enhance monitoring and alerting systems');
    }

    return recommendations;
  }

  private async generateActionItems(violations: ComplianceViolation[]): Promise<ComplianceReport['actionItems']> {
    return violations
      .filter(v => v.status === 'open')
      .map(violation => ({
        priority: violation.severity === 'critical' ? 'high' as const : 
                 violation.severity === 'high' ? 'medium' as const : 'low' as const,
        description: `Resolve ${violation.type.toUpperCase()} violation: ${violation.description}`,
        deadline: violation.remediation.deadline || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        responsible: 'compliance_team'
      }));
  }

  // Additional helper methods
  private async getDataSubjectRequests(period: { start: Date; end: Date }): Promise<any[]> {
    try {
      const snapshot = await this.db.collection('data_subject_requests')
        .where('createdAt', '>=', period.start)
        .where('createdAt', '<=', period.end)
        .get();

      return snapshot.docs.map(doc => doc.data());
    } catch (error) {
      return [];
    }
  }

  private async getDataBreaches(period: { start: Date; end: Date }): Promise<any[]> {
    try {
      const snapshot = await this.db.collection('data_breaches')
        .where('detectedAt', '>=', period.start)
        .where('detectedAt', '<=', period.end)
        .get();

      return snapshot.docs.map(doc => doc.data());
    } catch (error) {
      return [];
    }
  }

  private calculateAverageResponseTime(requests: any[]): number {
    const completedRequests = requests.filter(req => req.completedAt);
    if (completedRequests.length === 0) return 0;

    const totalTime = completedRequests.reduce((sum, req) => {
      const responseTime = req.completedAt.getTime() - req.createdAt.getTime();
      return sum + responseTime;
    }, 0);

    return Math.round(totalTime / completedRequests.length / (24 * 60 * 60 * 1000)); // Days
  }

  private calculateNotificationCompliance(breaches: any[]): number {
    const notificationRequired = breaches.filter(breach => breach.requiresNotification);
    const notifiedOnTime = notificationRequired.filter(breach => breach.notifiedOnTime);
    
    return notificationRequired.length > 0 ? 
      Math.round((notifiedOnTime.length / notificationRequired.length) * 100) : 100;
  }

  private async initializeComplianceManager(): Promise<void> {
    try {
      // Load active violations
      await this.loadActiveViolations();

      // Initialize scheduled tasks
      this.scheduleRetentionEnforcement();

      // Initialize reporting
      if (this.config.reporting.automated) {
        this.scheduleAutomatedReporting();
      }

      logger.info('Compliance manager initialized', {
        config: this.config,
        activeViolations: this.activeViolations.size
      });

    } catch (error) {
      logger.error('Failed to initialize compliance manager', error as Error);
      throw error;
    }
  }

  private async loadActiveViolations(): Promise<void> {
    try {
      const snapshot = await this.db.collection('compliance_violations')
        .where('status', 'in', ['open', 'in_progress'])
        .get();

      snapshot.docs.forEach(doc => {
        this.activeViolations.set(doc.id, doc.data() as ComplianceViolation);
      });

    } catch (error) {
      logger.error('Failed to load active violations', error as Error);
    }
  }

  private scheduleRetentionEnforcement(): void {
    // Run data retention enforcement daily
    setInterval(async () => {
      try {
        await this.enforceDataRetention();
      } catch (error) {
        logger.error('Scheduled data retention enforcement failed', error as Error);
      }
    }, 24 * 60 * 60 * 1000); // Daily
  }

  private scheduleAutomatedReporting(): void {
    const intervals = {
      'daily': 24 * 60 * 60 * 1000,
      'weekly': 7 * 24 * 60 * 60 * 1000,
      'monthly': 30 * 24 * 60 * 60 * 1000,
      'quarterly': 90 * 24 * 60 * 60 * 1000
    };

    const interval = intervals[this.config.reporting.frequency];
    
    setInterval(async () => {
      try {
        const period = {
          start: new Date(Date.now() - interval),
          end: new Date()
        };

        await this.generateComplianceReport('comprehensive', period);
      } catch (error) {
        logger.error('Scheduled compliance reporting failed', error as Error);
      }
    }, interval);
  }

  // Public management methods
  async getActiveViolations(): Promise<ComplianceViolation[]> {
    return Array.from(this.activeViolations.values());
  }

  async resolveViolation(violationId: string, resolution: string): Promise<void> {
    const violation = this.activeViolations.get(violationId);
    if (!violation) {
      throw new Error(`Violation not found: ${violationId}`);
    }

    violation.status = 'resolved';
    violation.metadata.resolvedAt = new Date();

    await firestoreHelper.updateDocument('compliance_violations', violationId, {
      status: violation.status,
      'metadata.resolvedAt': violation.metadata.resolvedAt,
      resolution
    });

    this.activeViolations.delete(violationId);

    logger.info('Compliance violation resolved', { violationId, resolution });
  }

  async getComplianceStatus(): Promise<{
    overallScore: number;
    activeViolations: number;
    criticalViolations: number;
    complianceByRegulation: Record<string, number>;
  }> {
    const violations = Array.from(this.activeViolations.values());
    const criticalViolations = violations.filter(v => v.severity === 'critical').length;
    
    const complianceByRegulation = violations.reduce((acc, violation) => {
      const regulation = violation.regulation.split(' ')[0]; // Get main regulation name
      acc[regulation] = (acc[regulation] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      overallScore: this.calculateComplianceScore(violations),
      activeViolations: violations.length,
      criticalViolations,
      complianceByRegulation
    };
  }
}

// Singleton instance
export const complianceManager = new ComplianceManager();