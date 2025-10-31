import { Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { auditLogger } from '../../monitoring/auditLogger';
import { performanceMonitor } from '../../monitoring/performanceMonitor';
import { metricsCollector } from '../../monitoring/metricsCollector';
import { firestoreDb } from '../../config/database';
import { dataEncryption } from '../../security/dataEncryption';
import { fraudDetection } from '../../security/fraudDetection';
import { validateAndSanitize } from '../../middleware/validation';
import { generateId } from '../../utils/helpers';

export interface Donation {
  id: string;
  projectId: string;
  donorId: string;
  amount: number;
  currency: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'refunded' | 'disputed';
  
  // Payment information (encrypted)
  paymentData: {
    stripePaymentIntentId?: string;
    paymentMethodId?: string;
    last4?: string;
    brand?: string;
    fingerprint?: string;
  };
  
  // Donor information
  donorInfo: {
    name?: string;
    email: string;
    anonymous: boolean;
    message?: string;
    country?: string;
  };
  
  // Financial data
  fees: {
    platform: number;
    stripe: number;
    audit: number;
    total: number;
  };
  
  // Recurring donation settings
  recurring?: {
    enabled: boolean;
    frequency: 'weekly' | 'monthly' | 'quarterly';
    nextPaymentDate?: Date;
    endDate?: Date;
    subscriptionId?: string;
  };
  
  // Compliance and audit
  compliance: {
    amlCheck: boolean;
    riskLevel: 'low' | 'medium' | 'high';
    fraudScore: number;
    ipAddress: string;
    userAgent: string;
    geoLocation?: {
      country: string;
      region: string;
      city: string;
    };
  };
  
  // Metadata
  metadata: {
    campaign?: string;
    source?: string;
    referrer?: string;
    utmParams?: Record<string, string>;
  };
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  processedAt?: Date;
  refundedAt?: Date;
}

export interface DonationSearchFilters {
  projectId?: string;
  donorId?: string;
  status?: string;
  amountMin?: number;
  amountMax?: number;
  currency?: string;
  dateFrom?: Date;
  dateTo?: Date;
  recurring?: boolean;
  riskLevel?: string;
}

export class DonationController {
  private db = firestoreDb;

  async createDonation(req: Request, res: Response): Promise<void> {
    const traceId = await performanceMonitor.startTrace('donation_create', 'endpoint', {
      endpoint: '/api/donations',
      method: 'POST',
      userId: req.user?.uid,
      ip: req.ip
    });

    try {
      // Validate and sanitize input
      const donationSchema = {
        type: 'object' as const,
        required: ['projectId', 'amount', 'currency'],
        properties: {
          projectId: { type: 'string' as const, pattern: '^[a-zA-Z0-9_-]+$' },
          amount: { type: 'number' as const, minimum: 1, maximum: 100000 },
          currency: { type: 'string' as const, pattern: '^[A-Z]{3}$' },
          anonymous: { type: 'boolean' as const },
          message: { type: 'string' as const, maxLength: 500 },
          recurring: {
            type: 'object' as const,
            properties: {
              enabled: { type: 'boolean' as const },
              frequency: { enum: ['weekly', 'monthly', 'quarterly'] },
              endDate: { type: 'string' as const, format: 'date' as const }
            }
          }
        },
        additionalProperties: false
      };

      const validation = validateAndSanitize(req.body, donationSchema);
      if (!validation.valid) {
        res.status(400).json({
          error: 'Validation failed',
          message: 'Invalid donation data',
          details: validation.errors
        });
        return;
      }

      const donationData = validation.sanitized!;

      // Check if project exists and is active
      const projectDoc = await this.db.collection('projects').doc(donationData.projectId).get();
      if (!projectDoc.exists) {
        res.status(404).json({
          error: 'Project not found',
          message: 'The specified project does not exist'
        });
        return;
      }

      const project = projectDoc.data();
      if (project?.status !== 'published') {
        res.status(400).json({
          error: 'Project not available',
          message: 'This project is not currently accepting donations'
        });
        return;
      }

      // Calculate fees
      const fees = this.calculateFees(donationData.amount);
      const totalAmount = donationData.amount + fees.total;

      // Perform fraud detection
      const fraudResult = await fraudDetection.analyzeTransaction({
        userId: req.user!.uid,
        amount: donationData.amount,
        currency: donationData.currency,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] || '',
        projectId: donationData.projectId
      });

      if (fraudResult.blocked) {
        await auditLogger.logUserAction(
          req.user!.uid,
          'payment',
          'donation',
          donationData.projectId,
          'blocked',
          {
            service: 'donation-controller',
            reason: 'fraud_detection',
            fraudScore: fraudResult.riskScore,
            amount: donationData.amount,
            currency: donationData.currency
          }
        );

        res.status(403).json({
          error: 'Transaction blocked',
          message: 'This transaction has been flagged for security review'
        });
        return;
      }

      // Get user information
      const userDoc = await this.db.collection('users').doc(req.user!.uid).get();
      const userData = userDoc.data();

      // Create donation record
      const donation: Donation = {
        id: generateId(),
        projectId: donationData.projectId,
        donorId: req.user!.uid,
        amount: donationData.amount,
        currency: donationData.currency,
        status: 'pending',
        
        paymentData: {
          // Will be populated after Stripe processing
        },
        
        donorInfo: {
          name: donationData.anonymous ? undefined : `${userData?.profile?.firstName} ${userData?.profile?.lastName}`,
          email: userData?.email || req.user!.email!,
          anonymous: donationData.anonymous || false,
          message: donationData.message,
          country: userData?.profile?.location?.country
        },
        
        fees,
        
        recurring: donationData.recurring ? {
          enabled: donationData.recurring.enabled,
          frequency: donationData.recurring.frequency,
          endDate: donationData.recurring.endDate ? new Date(donationData.recurring.endDate) : undefined
        } : undefined,
        
        compliance: {
          amlCheck: false, // Will be performed during processing
          riskLevel: fraudResult.riskLevel,
          fraudScore: fraudResult.riskScore,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'] || '',
          geoLocation: fraudResult.location
        },
        
        metadata: {
          source: req.headers['x-source'] as string,
          referrer: req.headers.referer,
          utmParams: this.extractUtmParams(req.query)
        },
        
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Encrypt sensitive data
      donation.donorInfo.email = await dataEncryption.encrypt(donation.donorInfo.email);
      if (donation.donorInfo.name) {
        donation.donorInfo.name = await dataEncryption.encrypt(donation.donorInfo.name);
      }

      // Save to database
      await this.db.collection('donations').doc(donation.id).set(donation);

      // Log creation
      await auditLogger.logUserAction(
        req.user!.uid,
        'create',
        'donation',
        donation.id,
        'success',
        {
          service: 'donation-controller',
          projectId: donation.projectId,
          amount: donation.amount,
          currency: donation.currency,
          recurring: !!donation.recurring?.enabled
        }
      );

      // Record metrics
      await metricsCollector.recordCounter('donations.created', 1, {
        currency: donation.currency,
        recurring: donation.recurring?.enabled ? 'true' : 'false',
        riskLevel: donation.compliance.riskLevel
      });

      await metricsCollector.recordHistogram('donations.amount', donation.amount, {
        currency: donation.currency
      });

      await performanceMonitor.endTrace(traceId, 'success', {
        donationId: donation.id,
        amount: donation.amount
      });

      // Return donation with sensitive data for payment processing
      const response = {
        id: donation.id,
        amount: donation.amount,
        currency: donation.currency,
        fees: donation.fees,
        totalAmount,
        clientSecret: '', // Will be populated by payment processor
        requiresAml: fraudResult.riskLevel === 'high'
      };

      res.status(201).json({
        message: 'Donation created successfully',
        donation: response
      });

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });

      logger.error('Failed to create donation', error as Error, {
        userId: req.user?.uid,
        ip: req.ip,
        body: req.body
      });

      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to create donation'
      });
    }
  }

  async processDonation(req: Request, res: Response): Promise<void> {
    const traceId = await performanceMonitor.startTrace('donation_process', 'endpoint', {
      endpoint: '/api/donations/:id/process',
      method: 'POST',
      userId: req.user?.uid,
      donationId: req.params.id
    });

    try {
      const donationId = req.params.id;
      const { paymentIntentId, paymentMethodId } = req.body;

      // Get donation
      const donationDoc = await this.db.collection('donations').doc(donationId).get();
      if (!donationDoc.exists) {
        res.status(404).json({
          error: 'Donation not found',
          message: 'The specified donation does not exist'
        });
        return;
      }

      const donation = donationDoc.data() as Donation;

      if (donation.donorId !== req.user!.uid && !req.user!.roles?.includes('admin')) {
        res.status(403).json({
          error: 'Access denied',
          message: 'You do not have permission to process this donation'
        });
        return;
      }

      if (donation.status !== 'pending') {
        res.status(400).json({
          error: 'Invalid status',
          message: 'This donation cannot be processed in its current state'
        });
        return;
      }

      // Update donation with payment information
      const updates: Partial<Donation> = {
        status: 'processing',
        paymentData: {
          stripePaymentIntentId: paymentIntentId,
          paymentMethodId: paymentMethodId
        },
        updatedAt: new Date(),
        processedAt: new Date()
      };

      // Perform AML check for high-risk donations
      if (donation.compliance.riskLevel === 'high') {
        updates.compliance = {
          ...donation.compliance,
          amlCheck: true
        };
      }

      await this.db.collection('donations').doc(donationId).update(updates);

      // Log processing
      await auditLogger.logUserAction(
        req.user!.uid,
        'update',
        'donation',
        donationId,
        'success',
        {
          service: 'donation-controller',
          action: 'process_payment',
          paymentIntentId
        }
      );

      // Record metrics
      await metricsCollector.recordCounter('donations.processed', 1, {
        currency: donation.currency,
        riskLevel: donation.compliance.riskLevel
      });

      await performanceMonitor.endTrace(traceId, 'success', {
        donationId,
        status: 'processing'
      });

      res.json({
        message: 'Donation processing initiated',
        status: 'processing'
      });

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });

      logger.error('Failed to process donation', error as Error, {
        userId: req.user?.uid,
        donationId: req.params.id
      });

      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to process donation'
      });
    }
  }

  async getDonationById(req: Request, res: Response): Promise<void> {
    const traceId = await performanceMonitor.startTrace('donation_get', 'endpoint', {
      endpoint: '/api/donations/:id',
      method: 'GET',
      userId: req.user?.uid,
      donationId: req.params.id
    });

    try {
      const donationId = req.params.id;
      const donationDoc = await this.db.collection('donations').doc(donationId).get();

      if (!donationDoc.exists) {
        res.status(404).json({
          error: 'Donation not found',
          message: 'The specified donation does not exist'
        });
        return;
      }

      const donation = donationDoc.data() as Donation;

      // Check access permissions
      const canAccess = donation.donorId === req.user!.uid ||
                       req.user!.roles?.includes('admin') ||
                       req.user!.roles?.includes('auditor') ||
                       (req.user!.roles?.includes('creator') && await this.isProjectOwner(donation.projectId, req.user!.uid));

      if (!canAccess) {
        res.status(403).json({
          error: 'Access denied',
          message: 'You do not have permission to view this donation'
        });
        return;
      }

      // Decrypt sensitive data for authorized users
      const decryptedDonation = { ...donation };
      if (donation.donorId === req.user!.uid || req.user!.roles?.includes('admin')) {
        decryptedDonation.donorInfo.email = await dataEncryption.decrypt(donation.donorInfo.email);
        if (donation.donorInfo.name) {
          decryptedDonation.donorInfo.name = await dataEncryption.decrypt(donation.donorInfo.name);
        }
      }

      await performanceMonitor.endTrace(traceId, 'success', {
        donationId,
        userType: req.user!.roles?.[0] || 'user'
      });

      res.json({
        donation: decryptedDonation
      });

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });

      logger.error('Failed to get donation', error as Error, {
        userId: req.user?.uid,
        donationId: req.params.id
      });

      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve donation'
      });
    }
  }

  async searchDonations(req: Request, res: Response): Promise<void> {
    const traceId = await performanceMonitor.startTrace('donations_search', 'endpoint', {
      endpoint: '/api/donations/search',
      method: 'GET',
      userId: req.user?.uid
    });

    try {
      const filters: DonationSearchFilters = req.query as any;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
      const offset = parseInt(req.query.offset as string) || 0;

      let query = this.db.collection('donations');

      // Apply user-based filtering
      if (!req.user!.roles?.includes('admin') && !req.user!.roles?.includes('auditor')) {
        // Regular users can only see their own donations
        query = query.where('donorId', '==', req.user!.uid);
      } else {
        // Admins and auditors can filter by user
        if (filters.donorId) {
          query = query.where('donorId', '==', filters.donorId);
        }
      }

      // Apply other filters
      if (filters.projectId) {
        query = query.where('projectId', '==', filters.projectId);
      }

      if (filters.status) {
        query = query.where('status', '==', filters.status);
      }

      if (filters.currency) {
        query = query.where('currency', '==', filters.currency);
      }

      if (filters.recurring !== undefined) {
        query = query.where('recurring.enabled', '==', filters.recurring);
      }

      if (filters.riskLevel) {
        query = query.where('compliance.riskLevel', '==', filters.riskLevel);
      }

      // Apply date range filters
      if (filters.dateFrom) {
        query = query.where('createdAt', '>=', filters.dateFrom);
      }

      if (filters.dateTo) {
        query = query.where('createdAt', '<=', filters.dateTo);
      }

      // Execute query with pagination
      const querySnapshot = await query
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .offset(offset)
        .get();

      const donations = querySnapshot.docs.map(doc => {
        const donation = doc.data() as Donation;
        
        // Hide sensitive data for non-owners
        if (donation.donorId !== req.user!.uid && !req.user!.roles?.includes('admin')) {
          return {
            ...donation,
            donorInfo: {
              ...donation.donorInfo,
              email: '[HIDDEN]',
              name: donation.donorInfo.anonymous ? '[ANONYMOUS]' : '[HIDDEN]'
            }
          };
        }

        return donation;
      });

      // Get total count for pagination
      const countQuery = await this.db.collection('donations').count().get();
      const total = countQuery.data().count;

      await performanceMonitor.endTrace(traceId, 'success', {
        resultCount: donations.length,
        filters: Object.keys(filters).join(',')
      });

      res.json({
        donations,
        pagination: {
          limit,
          offset,
          total,
          hasMore: offset + limit < total
        }
      });

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });

      logger.error('Failed to search donations', error as Error, {
        userId: req.user?.uid,
        query: req.query
      });

      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to search donations'
      });
    }
  }

  async refundDonation(req: Request, res: Response): Promise<void> {
    const traceId = await performanceMonitor.startTrace('donation_refund', 'endpoint', {
      endpoint: '/api/donations/:id/refund',
      method: 'POST',
      userId: req.user?.uid,
      donationId: req.params.id
    });

    try {
      const donationId = req.params.id;
      const { reason } = req.body;

      // Get donation
      const donationDoc = await this.db.collection('donations').doc(donationId).get();
      if (!donationDoc.exists) {
        res.status(404).json({
          error: 'Donation not found',
          message: 'The specified donation does not exist'
        });
        return;
      }

      const donation = donationDoc.data() as Donation;

      // Check permissions
      const canRefund = req.user!.roles?.includes('admin') ||
                       req.user!.roles?.includes('support') ||
                       donation.donorId === req.user!.uid;

      if (!canRefund) {
        res.status(403).json({
          error: 'Access denied',
          message: 'You do not have permission to refund this donation'
        });
        return;
      }

      if (donation.status !== 'completed') {
        res.status(400).json({
          error: 'Invalid status',
          message: 'Only completed donations can be refunded'
        });
        return;
      }

      // Update donation status
      await this.db.collection('donations').doc(donationId).update({
        status: 'refunded',
        refundedAt: new Date(),
        updatedAt: new Date()
      });

      // Log refund
      await auditLogger.logUserAction(
        req.user!.uid,
        'update',
        'donation',
        donationId,
        'success',
        {
          service: 'donation-controller',
          action: 'refund',
          reason,
          originalAmount: donation.amount
        }
      );

      // Record metrics
      await metricsCollector.recordCounter('donations.refunded', 1, {
        currency: donation.currency,
        reason: reason || 'unspecified'
      });

      await performanceMonitor.endTrace(traceId, 'success', {
        donationId,
        amount: donation.amount
      });

      res.json({
        message: 'Donation refunded successfully',
        status: 'refunded'
      });

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });

      logger.error('Failed to refund donation', error as Error, {
        userId: req.user?.uid,
        donationId: req.params.id
      });

      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to refund donation'
      });
    }
  }

  // Helper methods
  private calculateFees(amount: number): { platform: number; stripe: number; audit: number; total: number } {
    const platformFee = Math.round(amount * 0.05); // 5%
    const auditFee = Math.round(amount * 0.03); // 3%
    const stripeFee = Math.round(amount * 0.029 + 30); // ~2.9% + 0.30€
    
    return {
      platform: platformFee,
      audit: auditFee,
      stripe: stripeFee,
      total: platformFee + auditFee + stripeFee
    };
  }

  private extractUtmParams(query: any): Record<string, string> {
    const utmParams: Record<string, string> = {};
    const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
    
    for (const key of utmKeys) {
      if (query[key]) {
        utmParams[key] = query[key];
      }
    }
    
    return utmParams;
  }

  private async isProjectOwner(projectId: string, userId: string): Promise<boolean> {
    const projectDoc = await this.db.collection('projects').doc(projectId).get();
    const project = projectDoc.data();
    return project?.creatorId === userId;
  }
}

export const donationController = new DonationController();