/**
 * Donation Repository Implementation
 * Social Finance Impact Platform
 * 
 * Specialized repository for financial transactions with advanced
 * fraud detection, compliance tracking, and financial reporting
 */

import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { BaseRepository, QueryOptions, PaginationResult } from '../repository';
import { Donation } from '../schema';
import { dataEncryption } from '../../security/dataEncryption';
import { logger } from '../../utils/logger';
import { performanceMonitor } from '../../monitoring/performanceMonitor';
import { metricsCollector } from '../../monitoring/metricsCollector';
import { auditLogger } from '../../monitoring/auditLogger';
import { 
  NotFoundError, 
  ConflictError, 
  ValidationError,
  BusinessRuleViolationError,
  PaymentError,
  FraudDetectionError
} from '../../utils/errors';

// ============================================================================
// DONATION-SPECIFIC INTERFACES
// ============================================================================

export interface DonationSearchFilters {
  donorId?: string;
  projectId?: string;
  status?: Donation['payment']['status'];
  amountMin?: number;
  amountMax?: number;
  currency?: string;
  paymentProvider?: Donation['payment']['provider'];
  dateFrom?: Date;
  dateTo?: Date;
  riskLevel?: Donation['compliance']['riskLevel'];
  amlStatus?: Donation['compliance']['amlStatus'];
  isRecurring?: boolean;
  anonymous?: boolean;
  country?: string;
  fraudScore?: { min?: number; max?: number };
  refunded?: boolean;
}

export interface DonationAnalytics {
  totalDonations: number;
  totalAmount: number;
  averageDonation: number;
  uniqueDonors: number;
  recurringDonations: number;
  refundRate: number;
  fraudRate: number;
  topCurrencies: Array<{ currency: string; count: number; amount: number }>;
  topCountries: Array<{ country: string; count: number; amount: number }>;
  monthlyTrends: Array<{ date: Date; amount: number; count: number }>;
  riskDistribution: Record<string, number>;
}

export interface FinancialReport {
  period: { start: Date; end: Date };
  totalRevenue: number;
  platformFees: number;
  paymentFees: number;
  auditFees: number;
  netRevenue: number;
  transactionCount: number;
  refundAmount: number;
  chargebackAmount: number;
  averageTransactionValue: number;
  topProjects: Array<{
    projectId: string;
    title: string;
    amount: number;
    donationCount: number;
  }>;
}

export interface FraudAnalysisResult {
  score: number;
  level: 'low' | 'medium' | 'high' | 'critical';
  factors: string[];
  recommendation: 'approve' | 'review' | 'decline';
  requiresManualReview: boolean;
}

export interface RecurringDonationSummary {
  subscriptionId: string;
  donorId: string;
  projectId: string;
  amount: number;
  frequency: Donation['recurring']['frequency'];
  status: Donation['recurring']['status'];
  nextPaymentDate: Date;
  totalPayments: number;
  failedPayments: number;
  totalAmount: number;
}

// ============================================================================
// DONATION REPOSITORY CLASS
// ============================================================================

export class DonationRepository extends BaseRepository<Donation> {
  constructor() {
    super('donations');
  }

  // ============================================================================
  // DONATION CREATION AND PROCESSING
  // ============================================================================

  async createDonation(donationData: {
    projectId: string;
    donorId: string;
    amount: number;
    currency: string;
    paymentProvider: Donation['payment']['provider'];
    donorInfo: {
      name?: string;
      email: string;
      anonymous: boolean;
      message?: string;
      country?: string;
    };
    compliance: {
      ipAddress: string;
      userAgent: string;
      geoLocation?: Donation['compliance']['geoLocation'];
    };
    recurring?: Omit<Donation['recurring'], 'totalPayments' | 'completedPayments' | 'failedPayments' | 'lastPaymentDate'>;
    campaign?: Donation['campaign'];
  }): Promise<Donation> {
    const traceId = await performanceMonitor.startTrace('donation_create', 'repository', {
      operation: 'createDonation',
      amount: donationData.amount,
      currency: donationData.currency
    });

    try {
      // Encrypt sensitive donor information
      const encryptedEmail = await dataEncryption.encrypt(donationData.donorInfo.email);
      const encryptedName = donationData.donorInfo.name && !donationData.donorInfo.anonymous 
        ? await dataEncryption.encrypt(donationData.donorInfo.name)
        : undefined;

      // Calculate fees
      const fees = this.calculateFees(donationData.amount);

      // Perform initial fraud analysis
      const fraudAnalysis = await this.analyzeFraudRisk(donationData);

      // Generate tax receipt number
      const receiptNumber = this.generateReceiptNumber();

      const newDonation: Omit<Donation, 'id' | 'createdAt' | 'updatedAt' | 'version'> = {
        projectId: donationData.projectId,
        donorId: donationData.donorId,
        amount: donationData.amount,
        currency: donationData.currency,

        payment: {
          status: 'pending',
          provider: donationData.paymentProvider,
          paymentMethod: {
            type: 'card' // Will be updated during processing
          },
          fees
        },

        donor: {
          name: encryptedName,
          email: encryptedEmail,
          anonymous: donationData.donorInfo.anonymous,
          message: donationData.donorInfo.message,
          country: donationData.donorInfo.country,
          recognition: {
            allowPublicRecognition: !donationData.donorInfo.anonymous,
            allowNameDisplay: !donationData.donorInfo.anonymous,
            allowAmountDisplay: false // Default to private amounts
          }
        },

        recurring: donationData.recurring ? {
          ...donationData.recurring,
          totalPayments: 0,
          completedPayments: 0,
          failedPayments: 0
        } : undefined,

        tax: {
          deductible: true, // Default - would be determined by jurisdiction
          receiptGenerated: false,
          receiptNumber,
          taxYear: new Date().getFullYear()
        },

        compliance: {
          amlChecked: false,
          amlStatus: 'clear',
          riskLevel: fraudAnalysis.level,
          riskScore: fraudAnalysis.score,
          riskFactors: fraudAnalysis.factors,
          ipAddress: await this.hashSensitiveData(donationData.compliance.ipAddress),
          userAgent: donationData.compliance.userAgent,
          geoLocation: donationData.compliance.geoLocation,
          fraudAnalysis: {
            provider: 'internal',
            score: fraudAnalysis.score,
            decision: fraudAnalysis.recommendation,
            reasons: fraudAnalysis.factors,
            analysedAt: new Date()
          }
        },

        campaign: donationData.campaign,

        escrow: {
          held: fraudAnalysis.level === 'high' || fraudAnalysis.level === 'critical',
          releaseDate: fraudAnalysis.level === 'high' || fraudAnalysis.level === 'critical' 
            ? new Date(Date.now() + 72 * 60 * 60 * 1000) // 72 hours hold
            : undefined
        },

        communication: {
          sendReceipt: true,
          sendUpdates: true,
          allowProjectCreatorContact: !donationData.donorInfo.anonymous,
          preferredLanguage: 'en'
        },

        createdBy: donationData.donorId,
        updatedBy: donationData.donorId
      };

      // Check for fraud blocking
      if (fraudAnalysis.recommendation === 'decline') {
        throw new FraudDetectionError(
          'Donation blocked by fraud detection',
          fraudAnalysis.score,
          fraudAnalysis.factors
        );
      }

      const donation = await this.create(newDonation);

      // Log donation creation
      await auditLogger.logUserAction(
        donationData.donorId,
        'create',
        'donation',
        donation.id,
        'success',
        {
          service: 'donation-repository',
          projectId: donationData.projectId,
          amount: donationData.amount,
          currency: donationData.currency,
          riskLevel: fraudAnalysis.level,
          fraudScore: fraudAnalysis.score,
          recurring: !!donationData.recurring?.enabled
        }
      );

      // Record metrics
      await metricsCollector.recordCounter('donations.created', 1, {
        currency: donationData.currency,
        riskLevel: fraudAnalysis.level,
        recurring: donationData.recurring?.enabled ? 'true' : 'false',
        provider: donationData.paymentProvider
      });

      await metricsCollector.recordHistogram('donations.amount', donationData.amount, {
        currency: donationData.currency
      });

      await performanceMonitor.endTrace(traceId, 'success', { 
        donationId: donation.id,
        riskLevel: fraudAnalysis.level
      });

      logger.info('Donation created successfully', {
        donationId: donation.id,
        donorId: donationData.donorId,
        projectId: donationData.projectId,
        amount: donationData.amount,
        riskLevel: fraudAnalysis.level
      });

      return donation;

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });

      throw error;
    }
  }

  async updatePaymentStatus(
    donationId: string,
    status: Donation['payment']['status'],
    paymentData?: {
      transactionId?: string;
      paymentIntentId?: string;
      paymentMethodId?: string;
      paymentMethodDetails?: Partial<Donation['payment']['paymentMethod']>;
    }
  ): Promise<Donation> {
    const traceId = await performanceMonitor.startTrace('donation_update_payment', 'repository', {
      operation: 'updatePaymentStatus',
      donationId,
      status
    });

    try {
      const donation = await this.findByIdOrThrow(donationId);

      const paymentUpdates: Partial<Donation['payment']> = {
        status,
        ...(status === 'processing' && { processedAt: new Date() }),
        ...(status === 'completed' && { capturedAt: new Date() }),
        ...(status === 'refunded' && { refundedAt: new Date() }),
        ...(paymentData?.transactionId && { transactionId: paymentData.transactionId }),
        ...(paymentData?.paymentIntentId && { paymentIntentId: paymentData.paymentIntentId }),
        ...(paymentData?.paymentMethodId && { paymentMethodId: paymentData.paymentMethodId }),
        ...(paymentData?.paymentMethodDetails && {
          paymentMethod: {
            ...donation.payment.paymentMethod,
            ...paymentData.paymentMethodDetails
          }
        })
      };

      const updatedDonation = await this.update(donationId, {
        payment: {
          ...donation.payment,
          ...paymentUpdates
        },
        updatedBy: 'system'
      });

      // Log payment status update
      await auditLogger.logUserAction(
        'system',
        'update',
        'donation_payment',
        donationId,
        'success',
        {
          service: 'donation-repository',
          previousStatus: donation.payment.status,
          newStatus: status,
          transactionId: paymentData?.transactionId
        }
      );

      // Record metrics
      await metricsCollector.recordCounter('donations.payment_status_changes', 1, {
        status,
        previousStatus: donation.payment.status,
        currency: donation.currency
      });

      await performanceMonitor.endTrace(traceId, 'success', { donationId, status });

      return updatedDonation;

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });

      throw error;
    }
  }

  // ============================================================================
  // FRAUD DETECTION AND COMPLIANCE
  // ============================================================================

  async updateComplianceStatus(
    donationId: string,
    complianceUpdates: Partial<Donation['compliance']>,
    updatedBy: string
  ): Promise<Donation> {
    const donation = await this.findByIdOrThrow(donationId);

    const updatedDonation = await this.update(donationId, {
      compliance: {
        ...donation.compliance,
        ...complianceUpdates
      },
      updatedBy
    });

    // Log compliance update
    await auditLogger.logUserAction(
      updatedBy,
      'compliance',
      'donation_compliance',
      donationId,
      'success',
      {
        service: 'donation-repository',
        updates: Object.keys(complianceUpdates),
        amlStatus: complianceUpdates.amlStatus,
        riskLevel: complianceUpdates.riskLevel
      }
    );

    return updatedDonation;
  }

  async performAMLCheck(donationId: string, performedBy: string): Promise<Donation> {
    const donation = await this.findByIdOrThrow(donationId);

    if (donation.compliance.amlChecked) {
      throw new BusinessRuleViolationError(
        'aml_check',
        'AML check has already been performed for this donation'
      );
    }

    // Simulate AML check logic
    const amlResult = await this.performAMLAnalysis(donation);

    const updatedDonation = await this.updateComplianceStatus(donationId, {
      amlChecked: true,
      amlStatus: amlResult.status,
      riskLevel: amlResult.riskLevel
    }, performedBy);

    // If high risk or flagged, hold in escrow
    if (amlResult.status === 'flagged' || amlResult.riskLevel === 'high') {
      await this.update(donationId, {
        escrow: {
          ...donation.escrow,
          held: true,
          holdReason: 'AML review required',
          releaseDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days hold
        },
        updatedBy: performedBy
      });
    }

    return updatedDonation;
  }

  async getFraudAnalyticsSummary(period?: { start: Date; end: Date }): Promise<{
    totalAnalyzed: number;
    fraudDetected: number;
    falsePositives: number;
    averageRiskScore: number;
    topRiskFactors: Array<{ factor: string; frequency: number }>;
  }> {
    const traceId = await performanceMonitor.startTrace('donation_fraud_analytics', 'repository', {
      operation: 'getFraudAnalyticsSummary'
    });

    try {
      const whereConditions: QueryOptions['where'] = [];

      if (period) {
        whereConditions.push(
          { field: 'createdAt', operator: '>=', value: period.start },
          { field: 'createdAt', operator: '<=', value: period.end }
        );
      }

      const donations = await this.find({ where: whereConditions });

      const totalAnalyzed = donations.length;
      const fraudDetected = donations.filter(d => d.compliance.riskLevel === 'high' || d.compliance.riskLevel === 'critical').length;
      
      // This would be calculated based on manual review results
      const falsePositives = Math.floor(fraudDetected * 0.1); // Estimate 10% false positive rate

      const averageRiskScore = donations.length > 0 
        ? donations.reduce((sum, d) => sum + d.compliance.riskScore, 0) / donations.length 
        : 0;

      // Aggregate risk factors
      const factorCounts: Record<string, number> = {};
      donations.forEach(donation => {
        donation.compliance.riskFactors.forEach(factor => {
          factorCounts[factor] = (factorCounts[factor] || 0) + 1;
        });
      });

      const topRiskFactors = Object.entries(factorCounts)
        .map(([factor, frequency]) => ({ factor, frequency }))
        .sort((a, b) => b.frequency - a.frequency)
        .slice(0, 10);

      await performanceMonitor.endTrace(traceId, 'success');

      return {
        totalAnalyzed,
        fraudDetected,
        falsePositives,
        averageRiskScore,
        topRiskFactors
      };

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });

      throw error;
    }
  }

  // ============================================================================
  // RECURRING DONATIONS
  // ============================================================================

  async getRecurringDonations(status?: Donation['recurring']['status']): Promise<RecurringDonationSummary[]> {
    const whereConditions: QueryOptions['where'] = [
      { field: 'recurring.enabled', operator: '==', value: true }
    ];

    if (status) {
      whereConditions.push({ field: 'recurring.status', operator: '==', value: status });
    }

    const donations = await this.find({ where: whereConditions });

    return donations
      .filter(d => d.recurring?.enabled)
      .map(donation => ({
        subscriptionId: donation.recurring!.subscriptionId || donation.id,
        donorId: donation.donorId,
        projectId: donation.projectId,
        amount: donation.amount,
        frequency: donation.recurring!.frequency!,
        status: donation.recurring!.status!,
        nextPaymentDate: donation.recurring!.nextPaymentDate!,
        totalPayments: donation.recurring!.totalPayments,
        failedPayments: donation.recurring!.failedPayments,
        totalAmount: donation.recurring!.totalPayments * donation.amount
      }));
  }

  async processRecurringPayment(subscriptionId: string): Promise<Donation> {
    const originalDonation = await this.findOne({
      where: [{ field: 'recurring.subscriptionId', operator: '==', value: subscriptionId }]
    });

    if (!originalDonation || !originalDonation.recurring?.enabled) {
      throw new NotFoundError(`Active recurring donation with subscription ID '${subscriptionId}' not found`);
    }

    // Create new donation for recurring payment
    const recurringPayment = await this.createDonation({
      projectId: originalDonation.projectId,
      donorId: originalDonation.donorId,
      amount: originalDonation.amount,
      currency: originalDonation.currency,
      paymentProvider: originalDonation.payment.provider,
      donorInfo: {
        email: await dataEncryption.decrypt(originalDonation.donor.email),
        name: originalDonation.donor.name 
          ? await dataEncryption.decrypt(originalDonation.donor.name)
          : undefined,
        anonymous: originalDonation.donor.anonymous,
        country: originalDonation.donor.country
      },
      compliance: {
        ipAddress: 'recurring_payment',
        userAgent: 'recurring_payment_system'
      },
      recurring: {
        enabled: true,
        frequency: originalDonation.recurring.frequency!,
        subscriptionId
      }
    });

    // Update original donation's recurring statistics
    await this.update(originalDonation.id, {
      recurring: {
        ...originalDonation.recurring,
        totalPayments: originalDonation.recurring.totalPayments + 1,
        lastPaymentDate: new Date(),
        nextPaymentDate: this.calculateNextPaymentDate(
          new Date(),
          originalDonation.recurring.frequency!
        )
      },
      updatedBy: 'system'
    });

    return recurringPayment;
  }

  async cancelRecurringDonation(donationId: string, cancelledBy: string, reason?: string): Promise<Donation> {
    const donation = await this.findByIdOrThrow(donationId);

    if (!donation.recurring?.enabled) {
      throw new BusinessRuleViolationError(
        'recurring_cancellation',
        'This is not a recurring donation'
      );
    }

    const updatedDonation = await this.update(donationId, {
      recurring: {
        ...donation.recurring,
        status: 'cancelled',
        endDate: new Date()
      },
      updatedBy: cancelledBy
    });

    // Log cancellation
    await auditLogger.logUserAction(
      cancelledBy,
      'update',
      'recurring_donation',
      donationId,
      'success',
      {
        service: 'donation-repository',
        action: 'cancel',
        reason,
        subscriptionId: donation.recurring.subscriptionId
      }
    );

    return updatedDonation;
  }

  // ============================================================================
  // FINANCIAL REPORTING AND ANALYTICS
  // ============================================================================

  async getDonationAnalytics(period?: { start: Date; end: Date }): Promise<DonationAnalytics> {
    const traceId = await performanceMonitor.startTrace('donation_analytics', 'repository', {
      operation: 'getDonationAnalytics'
    });

    try {
      const whereConditions: QueryOptions['where'] = [
        { field: 'payment.status', operator: '==', value: 'completed' }
      ];

      if (period) {
        whereConditions.push(
          { field: 'createdAt', operator: '>=', value: period.start },
          { field: 'createdAt', operator: '<=', value: period.end }
        );
      }

      const donations = await this.find({ where: whereConditions });

      const totalDonations = donations.length;
      const totalAmount = donations.reduce((sum, d) => sum + d.amount, 0);
      const averageDonation = totalDonations > 0 ? totalAmount / totalDonations : 0;

      const uniqueDonors = new Set(donations.map(d => d.donorId)).size;
      const recurringDonations = donations.filter(d => d.recurring?.enabled).length;

      // Count refunded donations
      const refundedCount = await this.count({
        where: [
          { field: 'payment.status', operator: '==', value: 'refunded' },
          ...(period ? [
            { field: 'createdAt', operator: '>=', value: period.start },
            { field: 'createdAt', operator: '<=', value: period.end }
          ] : [])
        ]
      });

      const refundRate = totalDonations > 0 ? refundedCount / totalDonations : 0;

      const fraudCount = donations.filter(d => 
        d.compliance.riskLevel === 'high' || d.compliance.riskLevel === 'critical'
      ).length;
      const fraudRate = totalDonations > 0 ? fraudCount / totalDonations : 0;

      // Aggregate by currency
      const currencyTotals: Record<string, { count: number; amount: number }> = {};
      donations.forEach(donation => {
        if (!currencyTotals[donation.currency]) {
          currencyTotals[donation.currency] = { count: 0, amount: 0 };
        }
        currencyTotals[donation.currency].count++;
        currencyTotals[donation.currency].amount += donation.amount;
      });

      const topCurrencies = Object.entries(currencyTotals)
        .map(([currency, data]) => ({ currency, ...data }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5);

      // Risk distribution
      const riskDistribution: Record<string, number> = {};
      donations.forEach(donation => {
        const level = donation.compliance.riskLevel;
        riskDistribution[level] = (riskDistribution[level] || 0) + 1;
      });

      const analytics: DonationAnalytics = {
        totalDonations,
        totalAmount,
        averageDonation,
        uniqueDonors,
        recurringDonations,
        refundRate,
        fraudRate,
        topCurrencies,
        topCountries: [], // Would be aggregated from donor countries
        monthlyTrends: [], // Would be calculated from time-series data
        riskDistribution
      };

      await performanceMonitor.endTrace(traceId, 'success');

      return analytics;

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });

      throw error;
    }
  }

  async generateFinancialReport(period: { start: Date; end: Date }): Promise<FinancialReport> {
    const traceId = await performanceMonitor.startTrace('donation_financial_report', 'repository', {
      operation: 'generateFinancialReport'
    });

    try {
      const donations = await this.find({
        where: [
          { field: 'payment.status', operator: '==', value: 'completed' },
          { field: 'payment.capturedAt', operator: '>=', value: period.start },
          { field: 'payment.capturedAt', operator: '<=', value: period.end }
        ]
      });

      const totalRevenue = donations.reduce((sum, d) => sum + d.amount, 0);
      const platformFees = donations.reduce((sum, d) => sum + d.payment.fees.platform, 0);
      const paymentFees = donations.reduce((sum, d) => sum + d.payment.fees.payment, 0);
      const auditFees = donations.reduce((sum, d) => sum + d.payment.fees.audit, 0);
      const netRevenue = totalRevenue - platformFees - paymentFees - auditFees;

      // Get refund amounts
      const refundedDonations = await this.find({
        where: [
          { field: 'payment.status', operator: '==', value: 'refunded' },
          { field: 'payment.refundedAt', operator: '>=', value: period.start },
          { field: 'payment.refundedAt', operator: '<=', value: period.end }
        ]
      });

      const refundAmount = refundedDonations.reduce((sum, d) => sum + d.amount, 0);

      const report: FinancialReport = {
        period,
        totalRevenue,
        platformFees,
        paymentFees,
        auditFees,
        netRevenue,
        transactionCount: donations.length,
        refundAmount,
        chargebackAmount: 0, // Would be tracked separately
        averageTransactionValue: donations.length > 0 ? totalRevenue / donations.length : 0,
        topProjects: [] // Would be aggregated by project
      };

      await performanceMonitor.endTrace(traceId, 'success');

      return report;

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });

      throw error;
    }
  }

  // ============================================================================
  // SEARCH AND FILTERING
  // ============================================================================

  async searchDonations(
    filters: DonationSearchFilters,
    options?: QueryOptions
  ): Promise<PaginationResult<Donation>> {
    const traceId = await performanceMonitor.startTrace('donation_search', 'repository', {
      operation: 'searchDonations',
      filtersCount: Object.keys(filters).length
    });

    try {
      const whereConditions: QueryOptions['where'] = [];

      // Add filter conditions
      if (filters.donorId) {
        whereConditions.push({ field: 'donorId', operator: '==', value: filters.donorId });
      }

      if (filters.projectId) {
        whereConditions.push({ field: 'projectId', operator: '==', value: filters.projectId });
      }

      if (filters.status) {
        whereConditions.push({ field: 'payment.status', operator: '==', value: filters.status });
      }

      if (filters.currency) {
        whereConditions.push({ field: 'currency', operator: '==', value: filters.currency });
      }

      if (filters.paymentProvider) {
        whereConditions.push({ field: 'payment.provider', operator: '==', value: filters.paymentProvider });
      }

      if (filters.amountMin) {
        whereConditions.push({ field: 'amount', operator: '>=', value: filters.amountMin });
      }

      if (filters.amountMax) {
        whereConditions.push({ field: 'amount', operator: '<=', value: filters.amountMax });
      }

      if (filters.dateFrom) {
        whereConditions.push({ field: 'createdAt', operator: '>=', value: filters.dateFrom });
      }

      if (filters.dateTo) {
        whereConditions.push({ field: 'createdAt', operator: '<=', value: filters.dateTo });
      }

      if (filters.riskLevel) {
        whereConditions.push({ field: 'compliance.riskLevel', operator: '==', value: filters.riskLevel });
      }

      if (filters.amlStatus) {
        whereConditions.push({ field: 'compliance.amlStatus', operator: '==', value: filters.amlStatus });
      }

      if (filters.isRecurring !== undefined) {
        whereConditions.push({ field: 'recurring.enabled', operator: '==', value: filters.isRecurring });
      }

      if (filters.anonymous !== undefined) {
        whereConditions.push({ field: 'donor.anonymous', operator: '==', value: filters.anonymous });
      }

      if (filters.country) {
        whereConditions.push({ field: 'donor.country', operator: '==', value: filters.country });
      }

      const queryOptions: QueryOptions = {
        ...options,
        where: whereConditions,
        orderBy: options?.orderBy || [{ field: 'createdAt', direction: 'desc' }]
      };

      const result = await this.paginate(queryOptions);

      // Client-side filtering for complex conditions
      if (filters.fraudScore) {
        result.data = result.data.filter(donation => {
          const score = donation.compliance.riskScore;
          return (!filters.fraudScore!.min || score >= filters.fraudScore!.min) &&
                 (!filters.fraudScore!.max || score <= filters.fraudScore!.max);
        });
      }

      if (filters.refunded !== undefined) {
        result.data = result.data.filter(donation => 
          filters.refunded ? donation.payment.status === 'refunded' : donation.payment.status !== 'refunded'
        );
      }

      await performanceMonitor.endTrace(traceId, 'success', {
        resultCount: result.data.length
      });

      return result;

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });

      throw error;
    }
  }

  async getDonationsByProject(projectId: string, status?: Donation['payment']['status']): Promise<Donation[]> {
    const whereConditions: QueryOptions['where'] = [
      { field: 'projectId', operator: '==', value: projectId }
    ];

    if (status) {
      whereConditions.push({ field: 'payment.status', operator: '==', value: status });
    }

    return await this.find({
      where: whereConditions,
      orderBy: [{ field: 'createdAt', direction: 'desc' }]
    });
  }

  async getDonationsByDonor(donorId: string, status?: Donation['payment']['status']): Promise<Donation[]> {
    const whereConditions: QueryOptions['where'] = [
      { field: 'donorId', operator: '==', value: donorId }
    ];

    if (status) {
      whereConditions.push({ field: 'payment.status', operator: '==', value: status });
    }

    return await this.find({
      where: whereConditions,
      orderBy: [{ field: 'createdAt', direction: 'desc' }]
    });
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private calculateFees(amount: number): Donation['payment']['fees'] {
    const platform = Math.round(amount * 0.05); // 5%
    const payment = Math.round(amount * 0.029 + 30); // 2.9% + $0.30
    const audit = Math.round(amount * 0.03); // 3%
    
    return {
      platform,
      payment,
      audit,
      total: platform + payment + audit
    };
  }

  private async analyzeFraudRisk(donationData: any): Promise<FraudAnalysisResult> {
    let score = 0;
    const factors: string[] = [];

    // Amount-based risk
    if (donationData.amount > 100000) { // $1000+
      score += 25;
      factors.push('High donation amount');
    } else if (donationData.amount < 100) { // Less than $1
      score += 10;
      factors.push('Unusually low amount');
    }

    // Geographic risk (simplified)
    const highRiskCountries = ['XX', 'YY']; // Would be configured
    if (donationData.donorInfo.country && highRiskCountries.includes(donationData.donorInfo.country)) {
      score += 20;
      factors.push('High-risk geographic location');
    }

    // VPN/Proxy detection (simulated)
    if (donationData.compliance.geoLocation?.vpnDetected) {
      score += 15;
      factors.push('VPN/Proxy detected');
    }

    // Anonymous donations
    if (donationData.donorInfo.anonymous && donationData.amount > 50000) {
      score += 10;
      factors.push('High-value anonymous donation');
    }

    const level: FraudAnalysisResult['level'] = 
      score >= 50 ? 'critical' :
      score >= 30 ? 'high' :
      score >= 15 ? 'medium' : 'low';

    const recommendation: FraudAnalysisResult['recommendation'] = 
      level === 'critical' ? 'decline' :
      level === 'high' ? 'review' : 'approve';

    return {
      score,
      level,
      factors,
      recommendation,
      requiresManualReview: level === 'high' || level === 'critical'
    };
  }

  private async performAMLAnalysis(donation: Donation): Promise<{
    status: Donation['compliance']['amlStatus'];
    riskLevel: Donation['compliance']['riskLevel'];
  }> {
    // Simplified AML analysis
    let riskScore = donation.compliance.riskScore;

    // Large amounts require enhanced due diligence
    if (donation.amount > 1000000) { // $10,000+
      riskScore += 20;
    }

    // Multiple donations from same source
    const recentDonations = await this.find({
      where: [
        { field: 'donorId', operator: '==', value: donation.donorId },
        { field: 'createdAt', operator: '>=', value: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      ]
    });

    if (recentDonations.length > 5) {
      riskScore += 15;
    }

    const status: Donation['compliance']['amlStatus'] = 
      riskScore >= 70 ? 'flagged' :
      riskScore >= 40 ? 'review' : 'clear';

    const riskLevel: Donation['compliance']['riskLevel'] = 
      riskScore >= 70 ? 'critical' :
      riskScore >= 50 ? 'high' :
      riskScore >= 25 ? 'medium' : 'low';

    return { status, riskLevel };
  }

  private generateReceiptNumber(): string {
    const year = new Date().getFullYear();
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 5).toUpperCase();
    return `RCP-${year}-${timestamp}-${random}`;
  }

  private async hashSensitiveData(data: string): Promise<string> {
    // Simple hash - in production would use proper cryptographic hash
    return Buffer.from(data).toString('base64').substr(0, 16);
  }

  private calculateNextPaymentDate(currentDate: Date, frequency: Donation['recurring']['frequency']): Date {
    const nextDate = new Date(currentDate);
    
    switch (frequency) {
      case 'weekly':
        nextDate.setDate(nextDate.getDate() + 7);
        break;
      case 'monthly':
        nextDate.setMonth(nextDate.getMonth() + 1);
        break;
      case 'quarterly':
        nextDate.setMonth(nextDate.getMonth() + 3);
        break;
    }
    
    return nextDate;
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const donationRepository = new DonationRepository();