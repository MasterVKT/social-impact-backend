import { getFirestore } from 'firebase-admin/firestore';
import { logger } from '../utils/logger';
import { firestoreHelper } from '../utils/firestore';

export interface FraudDetectionConfig {
  thresholds: {
    velocityCheck: {
      maxTransactionsPerHour: number;
      maxAmountPerHour: number;
      maxAmountPerDay: number;
    };
    behaviorAnalysis: {
      typicalTransactionAmount: { min: number; max: number };
      suspiciousAmountMultiplier: number;
      geolocationVarianceThreshold: number;
    };
    riskScoring: {
      lowRisk: number;
      mediumRisk: number;
      highRisk: number;
      criticalRisk: number;
    };
  };
  mlModels: {
    enableAnomalyDetection: boolean;
    enablePatternRecognition: boolean;
    confidenceThreshold: number;
  };
  realTimeBlocking: {
    enabled: boolean;
    autoBlockThreshold: number;
    requireManualReview: boolean;
  };
}

export interface FraudAnalysisResult {
  transactionId: string;
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  indicators: FraudIndicator[];
  recommendation: 'approve' | 'review' | 'block' | 'investigate';
  confidence: number;
  metadata: {
    analysisTimestamp: Date;
    modelVersion: string;
    processingTime: number;
  };
}

export interface FraudIndicator {
  type: 'velocity' | 'amount' | 'behavioral' | 'geolocation' | 'device' | 'pattern' | 'network' | 'temporal';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  evidence: any;
  confidence: number;
  weight: number;
}

export interface TransactionContext {
  transactionId: string;
  userId: string;
  amount: number;
  currency: string;
  type: 'contribution' | 'refund' | 'transfer' | 'withdrawal';
  source: {
    ip: string;
    country?: string;
    device?: string;
    userAgent?: string;
  };
  payment: {
    method: string;
    cardFingerprint?: string;
    bankAccount?: string;
    digitalWallet?: string;
  };
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface UserRiskProfile {
  userId: string;
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  factors: {
    accountAge: number;
    transactionHistory: number;
    verificationLevel: number;
    behavioralConsistency: number;
    networkReputation: number;
  };
  flags: string[];
  lastUpdated: Date;
  historicalAnalysis: {
    averageTransactionAmount: number;
    transactionFrequency: number;
    preferredPaymentMethods: string[];
    typicalTransactionTimes: number[];
    geolocationPatterns: string[];
  };
}

export class FraudDetectionSystem {
  private db = getFirestore();
  private config: FraudDetectionConfig;
  private userProfiles: Map<string, UserRiskProfile> = new Map();
  private suspiciousPatterns: Map<string, any> = new Map();

  constructor(config?: Partial<FraudDetectionConfig>) {
    this.config = {
      thresholds: {
        velocityCheck: {
          maxTransactionsPerHour: 10,
          maxAmountPerHour: 500000, // €5,000
          maxAmountPerDay: 1000000   // €10,000
        },
        behaviorAnalysis: {
          typicalTransactionAmount: { min: 1000, max: 100000 }, // €10-€1,000
          suspiciousAmountMultiplier: 5,
          geolocationVarianceThreshold: 1000 // km
        },
        riskScoring: {
          lowRisk: 25,
          mediumRisk: 50,
          highRisk: 75,
          criticalRisk: 90
        },
        ...config?.thresholds
      },
      mlModels: {
        enableAnomalyDetection: true,
        enablePatternRecognition: true,
        confidenceThreshold: 0.8,
        ...config?.mlModels
      },
      realTimeBlocking: {
        enabled: true,
        autoBlockThreshold: 85,
        requireManualReview: true,
        ...config?.realTimeBlocking
      }
    };

    this.initializeFraudDetection();
  }

  async analyzeTransaction(context: TransactionContext): Promise<FraudAnalysisResult> {
    const startTime = Date.now();
    
    try {
      logger.info('Starting fraud analysis', {
        transactionId: context.transactionId,
        userId: context.userId,
        amount: context.amount,
        type: context.type
      });

      // Get or create user risk profile
      const userProfile = await this.getUserRiskProfile(context.userId);

      // Run parallel fraud checks
      const [
        velocityIndicators,
        behavioralIndicators,
        geolocationIndicators,
        deviceIndicators,
        patternIndicators,
        networkIndicators
      ] = await Promise.all([
        this.checkTransactionVelocity(context, userProfile),
        this.analyzeBehavioralPattern(context, userProfile),
        this.checkGeolocationAnomaly(context, userProfile),
        this.analyzeDeviceFingerprint(context, userProfile),
        this.detectSuspiciousPatterns(context, userProfile),
        this.analyzeNetworkReputation(context)
      ]);

      // Combine all indicators
      const allIndicators = [
        ...velocityIndicators,
        ...behavioralIndicators,
        ...geolocationIndicators,
        ...deviceIndicators,
        ...patternIndicators,
        ...networkIndicators
      ];

      // Calculate risk score
      const riskScore = this.calculateRiskScore(allIndicators, userProfile);
      const riskLevel = this.determineRiskLevel(riskScore);
      const recommendation = this.generateRecommendation(riskScore, allIndicators);
      const confidence = this.calculateConfidence(allIndicators);

      // Update user profile
      await this.updateUserRiskProfile(context, userProfile, riskScore);

      const processingTime = Date.now() - startTime;

      const result: FraudAnalysisResult = {
        transactionId: context.transactionId,
        riskScore,
        riskLevel,
        indicators: allIndicators,
        recommendation,
        confidence,
        metadata: {
          analysisTimestamp: new Date(),
          modelVersion: '1.0.0',
          processingTime
        }
      };

      // Store analysis result
      await this.storeFraudAnalysis(result);

      // Execute real-time blocking if necessary
      if (this.config.realTimeBlocking.enabled && riskScore >= this.config.realTimeBlocking.autoBlockThreshold) {
        await this.executeRealTimeBlock(context, result);
      }

      logger.info('Fraud analysis completed', {
        transactionId: context.transactionId,
        riskScore,
        riskLevel,
        recommendation,
        indicatorCount: allIndicators.length,
        processingTime
      });

      return result;

    } catch (error) {
      logger.error('Fraud analysis failed', error as Error, {
        transactionId: context.transactionId,
        userId: context.userId
      });

      // Return safe default for errors
      return {
        transactionId: context.transactionId,
        riskScore: 50,
        riskLevel: 'medium',
        indicators: [{
          type: 'pattern',
          severity: 'medium',
          description: 'Fraud analysis system error',
          evidence: { error: (error as Error).message },
          confidence: 0.5,
          weight: 10
        }],
        recommendation: 'review',
        confidence: 0.5,
        metadata: {
          analysisTimestamp: new Date(),
          modelVersion: '1.0.0',
          processingTime: Date.now() - startTime
        }
      };
    }
  }

  private async checkTransactionVelocity(
    context: TransactionContext,
    userProfile: UserRiskProfile
  ): Promise<FraudIndicator[]> {
    const indicators: FraudIndicator[] = [];
    const now = new Date();

    // Check hourly velocity
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const recentTransactions = await this.getRecentTransactions(
      context.userId,
      hourAgo,
      now
    );

    const hourlyCount = recentTransactions.length;
    const hourlyAmount = recentTransactions.reduce((sum, tx) => sum + tx.amount, 0);

    if (hourlyCount > this.config.thresholds.velocityCheck.maxTransactionsPerHour) {
      indicators.push({
        type: 'velocity',
        severity: 'high',
        description: `Excessive transaction frequency: ${hourlyCount} transactions in 1 hour`,
        evidence: { hourlyCount, threshold: this.config.thresholds.velocityCheck.maxTransactionsPerHour },
        confidence: 0.9,
        weight: 25
      });
    }

    if (hourlyAmount > this.config.thresholds.velocityCheck.maxAmountPerHour) {
      indicators.push({
        type: 'velocity',
        severity: 'high',
        description: `Excessive transaction amount: €${hourlyAmount/100} in 1 hour`,
        evidence: { hourlyAmount, threshold: this.config.thresholds.velocityCheck.maxAmountPerHour },
        confidence: 0.95,
        weight: 30
      });
    }

    // Check daily velocity
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const dailyTransactions = await this.getRecentTransactions(
      context.userId,
      dayAgo,
      now
    );

    const dailyAmount = dailyTransactions.reduce((sum, tx) => sum + tx.amount, 0);

    if (dailyAmount > this.config.thresholds.velocityCheck.maxAmountPerDay) {
      indicators.push({
        type: 'velocity',
        severity: 'medium',
        description: `High daily transaction volume: €${dailyAmount/100}`,
        evidence: { dailyAmount, threshold: this.config.thresholds.velocityCheck.maxAmountPerDay },
        confidence: 0.8,
        weight: 20
      });
    }

    // Check velocity spikes
    const averageHourlyAmount = userProfile.historicalAnalysis.averageTransactionAmount * 
                               userProfile.historicalAnalysis.transactionFrequency;
    
    if (hourlyAmount > averageHourlyAmount * 3) {
      indicators.push({
        type: 'velocity',
        severity: 'medium',
        description: `Transaction velocity spike: ${Math.round(hourlyAmount / averageHourlyAmount)}x normal`,
        evidence: { currentAmount: hourlyAmount, historicalAverage: averageHourlyAmount },
        confidence: 0.7,
        weight: 15
      });
    }

    return indicators;
  }

  private async analyzeBehavioralPattern(
    context: TransactionContext,
    userProfile: UserRiskProfile
  ): Promise<FraudIndicator[]> {
    const indicators: FraudIndicator[] = [];

    // Check transaction amount anomaly
    const avgAmount = userProfile.historicalAnalysis.averageTransactionAmount;
    const amountRatio = context.amount / avgAmount;

    if (amountRatio > this.config.thresholds.behaviorAnalysis.suspiciousAmountMultiplier) {
      indicators.push({
        type: 'behavioral',
        severity: amountRatio > 10 ? 'critical' : 'high',
        description: `Unusual transaction amount: ${Math.round(amountRatio)}x typical amount`,
        evidence: { currentAmount: context.amount, typicalAmount: avgAmount, ratio: amountRatio },
        confidence: 0.85,
        weight: amountRatio > 10 ? 35 : 25
      });
    }

    // Check payment method deviation
    const preferredMethods = userProfile.historicalAnalysis.preferredPaymentMethods;
    if (preferredMethods.length > 0 && !preferredMethods.includes(context.payment.method)) {
      indicators.push({
        type: 'behavioral',
        severity: 'medium',
        description: `Unusual payment method: ${context.payment.method}`,
        evidence: { 
          currentMethod: context.payment.method, 
          preferredMethods: preferredMethods.slice(0, 3)
        },
        confidence: 0.6,
        weight: 15
      });
    }

    // Check transaction timing pattern
    const currentHour = context.timestamp.getHours();
    const typicalHours = userProfile.historicalAnalysis.typicalTransactionTimes;
    
    if (typicalHours.length > 0) {
      const isTypicalTime = typicalHours.some(hour => Math.abs(hour - currentHour) <= 2);
      
      if (!isTypicalTime) {
        indicators.push({
          type: 'temporal',
          severity: 'low',
          description: `Unusual transaction time: ${currentHour}:00`,
          evidence: { currentHour, typicalHours },
          confidence: 0.5,
          weight: 10
        });
      }
    }

    // Check transaction type consistency
    if (context.type === 'withdrawal' && userProfile.historicalAnalysis.transactionHistory < 5) {
      indicators.push({
        type: 'behavioral',
        severity: 'medium',
        description: 'Withdrawal attempt by new user with limited history',
        evidence: { transactionType: context.type, userHistory: userProfile.historicalAnalysis.transactionHistory },
        confidence: 0.8,
        weight: 20
      });
    }

    return indicators;
  }

  private async checkGeolocationAnomaly(
    context: TransactionContext,
    userProfile: UserRiskProfile
  ): Promise<FraudIndicator[]> {
    const indicators: FraudIndicator[] = [];

    if (!context.source.country) return indicators;

    const typicalLocations = userProfile.historicalAnalysis.geolocationPatterns;
    
    // Check if location is completely new
    if (typicalLocations.length > 0 && !typicalLocations.includes(context.source.country)) {
      const isHighRiskCountry = this.isHighRiskCountry(context.source.country);
      
      indicators.push({
        type: 'geolocation',
        severity: isHighRiskCountry ? 'high' : 'medium',
        description: `Transaction from new location: ${context.source.country}`,
        evidence: { 
          currentCountry: context.source.country, 
          typicalCountries: typicalLocations,
          highRiskCountry: isHighRiskCountry
        },
        confidence: 0.7,
        weight: isHighRiskCountry ? 25 : 15
      });
    }

    // Check for impossible travel (if we have recent transactions)
    const recentTransactions = await this.getRecentTransactions(
      context.userId,
      new Date(Date.now() - 2 * 60 * 60 * 1000), // Last 2 hours
      new Date()
    );

    if (recentTransactions.length > 0) {
      const lastTransaction = recentTransactions[0];
      if (lastTransaction.country && 
          lastTransaction.country !== context.source.country) {
        
        const timeDiff = context.timestamp.getTime() - lastTransaction.timestamp.getTime();
        const hoursDiff = timeDiff / (1000 * 60 * 60);
        
        // If different countries within 4 hours, flag as suspicious
        if (hoursDiff < 4) {
          indicators.push({
            type: 'geolocation',
            severity: 'high',
            description: `Impossible travel: ${lastTransaction.country} to ${context.source.country} in ${Math.round(hoursDiff)} hours`,
            evidence: { 
              previousCountry: lastTransaction.country,
              currentCountry: context.source.country,
              timeGap: hoursDiff
            },
            confidence: 0.9,
            weight: 30
          });
        }
      }
    }

    return indicators;
  }

  private async analyzeDeviceFingerprint(
    context: TransactionContext,
    userProfile: UserRiskProfile
  ): Promise<FraudIndicator[]> {
    const indicators: FraudIndicator[] = [];

    // Check for device/browser inconsistencies
    if (context.source.userAgent) {
      const deviceFingerprint = this.generateDeviceFingerprint(context.source);
      
      // Check if this is a completely new device
      const knownDevices = await this.getUserKnownDevices(context.userId);
      const isKnownDevice = knownDevices.some(device => 
        this.compareDeviceFingerprints(device.fingerprint, deviceFingerprint) > 0.8
      );

      if (!isKnownDevice) {
        indicators.push({
          type: 'device',
          severity: 'medium',
          description: 'Transaction from unrecognized device',
          evidence: { deviceFingerprint, knownDeviceCount: knownDevices.length },
          confidence: 0.6,
          weight: 15
        });
      }

      // Check for suspicious user agent patterns
      if (this.isSuspiciousUserAgent(context.source.userAgent)) {
        indicators.push({
          type: 'device',
          severity: 'high',
          description: 'Suspicious user agent detected',
          evidence: { userAgent: context.source.userAgent },
          confidence: 0.8,
          weight: 25
        });
      }
    }

    return indicators;
  }

  private async detectSuspiciousPatterns(
    context: TransactionContext,
    userProfile: UserRiskProfile
  ): Promise<FraudIndicator[]> {
    const indicators: FraudIndicator[] = [];

    // Check for round number patterns (often indicates testing/fraud)
    if (this.isRoundNumber(context.amount)) {
      indicators.push({
        type: 'pattern',
        severity: 'low',
        description: 'Round number transaction amount',
        evidence: { amount: context.amount },
        confidence: 0.4,
        weight: 5
      });
    }

    // Check for sequential transaction patterns
    const recentAmounts = await this.getRecentTransactionAmounts(context.userId, 5);
    if (this.hasSequentialPattern(recentAmounts)) {
      indicators.push({
        type: 'pattern',
        severity: 'medium',
        description: 'Sequential transaction amount pattern detected',
        evidence: { amounts: recentAmounts },
        confidence: 0.7,
        weight: 20
      });
    }

    // Check for card testing patterns
    if (context.payment.cardFingerprint) {
      const cardUsage = await this.getCardUsagePattern(context.payment.cardFingerprint);
      if (cardUsage.multipleUsers > 3) {
        indicators.push({
          type: 'pattern',
          severity: 'high',
          description: 'Payment method used by multiple users',
          evidence: { 
            cardFingerprint: context.payment.cardFingerprint,
            userCount: cardUsage.multipleUsers
          },
          confidence: 0.9,
          weight: 35
        });
      }
    }

    // Check for account takeover indicators
    if (this.hasAccountTakeoverIndicators(context, userProfile)) {
      indicators.push({
        type: 'pattern',
        severity: 'critical',
        description: 'Potential account takeover detected',
        evidence: { 
          behaviorChange: true,
          suspiciousActivity: true
        },
        confidence: 0.8,
        weight: 40
      });
    }

    return indicators;
  }

  private async analyzeNetworkReputation(context: TransactionContext): Promise<FraudIndicator[]> {
    const indicators: FraudIndicator[] = [];

    // Check IP reputation
    const ipReputation = await this.checkIPReputation(context.source.ip);
    if (ipReputation.isMalicious) {
      indicators.push({
        type: 'network',
        severity: 'critical',
        description: 'Transaction from known malicious IP',
        evidence: { 
          ip: context.source.ip,
          reputation: ipReputation.categories
        },
        confidence: 0.95,
        weight: 45
      });
    }

    // Check for VPN/Proxy usage
    if (ipReputation.isProxy || ipReputation.isVPN) {
      indicators.push({
        type: 'network',
        severity: 'medium',
        description: `Transaction through ${ipReputation.isVPN ? 'VPN' : 'proxy'}`,
        evidence: { 
          ip: context.source.ip,
          serviceType: ipReputation.isVPN ? 'VPN' : 'proxy'
        },
        confidence: 0.8,
        weight: 20
      });
    }

    // Check for Tor usage
    if (ipReputation.isTor) {
      indicators.push({
        type: 'network',
        severity: 'high',
        description: 'Transaction through Tor network',
        evidence: { ip: context.source.ip },
        confidence: 0.9,
        weight: 30
      });
    }

    return indicators;
  }

  private calculateRiskScore(indicators: FraudIndicator[], userProfile: UserRiskProfile): number {
    // Base risk from user profile
    let riskScore = userProfile.riskScore * 0.3;

    // Add indicator scores
    const indicatorScore = indicators.reduce((total, indicator) => {
      const severityMultiplier = {
        'low': 1,
        'medium': 2,
        'high': 3,
        'critical': 4
      }[indicator.severity];

      return total + (indicator.weight * indicator.confidence * severityMultiplier);
    }, 0);

    riskScore += indicatorScore;

    // Apply ML model adjustments if enabled
    if (this.config.mlModels.enableAnomalyDetection) {
      const mlAdjustment = this.applyMLAnomalyDetection(indicators, userProfile);
      riskScore = riskScore * (1 + mlAdjustment);
    }

    // Normalize to 0-100 scale
    return Math.min(Math.max(riskScore, 0), 100);
  }

  private determineRiskLevel(riskScore: number): 'low' | 'medium' | 'high' | 'critical' {
    if (riskScore >= this.config.thresholds.riskScoring.criticalRisk) return 'critical';
    if (riskScore >= this.config.thresholds.riskScoring.highRisk) return 'high';
    if (riskScore >= this.config.thresholds.riskScoring.mediumRisk) return 'medium';
    return 'low';
  }

  private generateRecommendation(riskScore: number, indicators: FraudIndicator[]): 'approve' | 'review' | 'block' | 'investigate' {
    if (riskScore >= this.config.thresholds.riskScoring.criticalRisk) return 'block';
    if (riskScore >= this.config.thresholds.riskScoring.highRisk) return 'investigate';
    if (riskScore >= this.config.thresholds.riskScoring.mediumRisk) return 'review';
    
    // Check for specific critical indicators even with lower overall score
    const hasCriticalIndicators = indicators.some(i => i.severity === 'critical');
    if (hasCriticalIndicators) return 'investigate';
    
    return 'approve';
  }

  private calculateConfidence(indicators: FraudIndicator[]): number {
    if (indicators.length === 0) return 0.5;
    
    const avgConfidence = indicators.reduce((sum, i) => sum + i.confidence, 0) / indicators.length;
    const indicatorVariety = new Set(indicators.map(i => i.type)).size;
    
    // Higher confidence with more diverse indicators
    return Math.min(avgConfidence * (1 + indicatorVariety * 0.1), 0.99);
  }

  // Helper methods
  private async getUserRiskProfile(userId: string): Promise<UserRiskProfile> {
    try {
      // Check cache first
      if (this.userProfiles.has(userId)) {
        return this.userProfiles.get(userId)!;
      }

      // Load from database
      const profile = await firestoreHelper.getDocumentOptional('user_risk_profiles', userId);
      
      if (profile) {
        const userProfile = profile as UserRiskProfile;
        this.userProfiles.set(userId, userProfile);
        return userProfile;
      }

      // Create new profile
      const newProfile = await this.createUserRiskProfile(userId);
      this.userProfiles.set(userId, newProfile);
      return newProfile;

    } catch (error) {
      logger.error('Failed to get user risk profile', error as Error, { userId });
      
      // Return default profile
      return {
        userId,
        riskScore: 25,
        riskLevel: 'low',
        factors: {
          accountAge: 0,
          transactionHistory: 0,
          verificationLevel: 0,
          behavioralConsistency: 50,
          networkReputation: 50
        },
        flags: [],
        lastUpdated: new Date(),
        historicalAnalysis: {
          averageTransactionAmount: 5000, // €50 default
          transactionFrequency: 1,
          preferredPaymentMethods: [],
          typicalTransactionTimes: [],
          geolocationPatterns: []
        }
      };
    }
  }

  private async createUserRiskProfile(userId: string): Promise<UserRiskProfile> {
    // Analyze user's historical data
    const userDoc = await firestoreHelper.getDocumentOptional('users', userId);
    const transactions = await this.getAllUserTransactions(userId);
    
    const accountAge = userDoc?.createdAt 
      ? (Date.now() - userDoc.createdAt.toDate().getTime()) / (1000 * 60 * 60 * 24)
      : 0;

    const historicalAnalysis = this.analyzeTransactionHistory(transactions);
    
    const factors = {
      accountAge: Math.min(accountAge / 30, 100), // Normalize to 30 days = 100%
      transactionHistory: Math.min(transactions.length * 10, 100),
      verificationLevel: userDoc?.kycStatus === 'approved' ? 100 : 0,
      behavioralConsistency: 50, // Default until we have data
      networkReputation: 50 // Default
    };

    const riskScore = this.calculateUserBaseRiskScore(factors);
    
    const profile: UserRiskProfile = {
      userId,
      riskScore,
      riskLevel: this.determineRiskLevel(riskScore),
      factors,
      flags: [],
      lastUpdated: new Date(),
      historicalAnalysis
    };

    await firestoreHelper.setDocument('user_risk_profiles', userId, profile);
    return profile;
  }

  private async getRecentTransactions(userId: string, startTime: Date, endTime: Date): Promise<any[]> {
    try {
      const snapshot = await this.db.collectionGroup('contributions')
        .where('contributorUid', '==', userId)
        .where('createdAt', '>=', startTime)
        .where('createdAt', '<=', endTime)
        .orderBy('createdAt', 'desc')
        .get();

      return snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          amount: data.amount,
          timestamp: data.createdAt.toDate(),
          country: data.geoLocation?.country,
          paymentMethod: data.paymentMethod
        };
      });

    } catch (error) {
      logger.error('Failed to get recent transactions', error as Error, { userId });
      return [];
    }
  }

  private async getAllUserTransactions(userId: string): Promise<any[]> {
    try {
      const snapshot = await this.db.collectionGroup('contributions')
        .where('contributorUid', '==', userId)
        .where('status', '==', 'confirmed')
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get();

      return snapshot.docs.map(doc => doc.data());

    } catch (error) {
      logger.error('Failed to get all user transactions', error as Error, { userId });
      return [];
    }
  }

  private analyzeTransactionHistory(transactions: any[]): UserRiskProfile['historicalAnalysis'] {
    if (transactions.length === 0) {
      return {
        averageTransactionAmount: 5000,
        transactionFrequency: 0,
        preferredPaymentMethods: [],
        typicalTransactionTimes: [],
        geolocationPatterns: []
      };
    }

    const amounts = transactions.map(tx => tx.amount || 0);
    const averageTransactionAmount = amounts.reduce((sum, amt) => sum + amt, 0) / amounts.length;
    
    const paymentMethods = transactions.map(tx => tx.paymentMethod).filter(Boolean);
    const methodCounts = paymentMethods.reduce((acc, method) => {
      acc[method] = (acc[method] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const preferredPaymentMethods = Object.entries(methodCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3)
      .map(([method]) => method);

    const hours = transactions
      .map(tx => tx.createdAt?.toDate?.()?.getHours())
      .filter(hour => hour !== undefined);
    
    const hourCounts = hours.reduce((acc, hour) => {
      acc[hour] = (acc[hour] || 0) + 1;
      return acc;
    }, {} as Record<number, number>);
    
    const typicalTransactionTimes = Object.entries(hourCounts)
      .filter(([, count]) => count >= Math.max(1, transactions.length * 0.1))
      .map(([hour]) => parseInt(hour));

    const countries = transactions
      .map(tx => tx.geoLocation?.country)
      .filter(Boolean);
    
    const geolocationPatterns = [...new Set(countries)];

    return {
      averageTransactionAmount,
      transactionFrequency: transactions.length,
      preferredPaymentMethods,
      typicalTransactionTimes,
      geolocationPatterns
    };
  }

  private isHighRiskCountry(country: string): boolean {
    const highRiskCountries = ['CN', 'RU', 'KP', 'IR', 'SY', 'AF'];
    return highRiskCountries.includes(country);
  }

  private generateDeviceFingerprint(source: TransactionContext['source']): string {
    const components = [
      source.userAgent || '',
      source.device || '',
      // In production, would include more device characteristics
    ].filter(Boolean);

    const crypto = require('crypto');
    return crypto.createHash('sha256').update(components.join('|')).digest('hex');
  }

  private async getUserKnownDevices(userId: string): Promise<Array<{ fingerprint: string; lastSeen: Date }>> {
    try {
      const snapshot = await this.db.collection('user_devices')
        .where('userId', '==', userId)
        .get();

      return snapshot.docs.map(doc => doc.data() as any);

    } catch (error) {
      logger.error('Failed to get user known devices', error as Error, { userId });
      return [];
    }
  }

  private compareDeviceFingerprints(fp1: string, fp2: string): number {
    // Simple similarity calculation - in production would use more sophisticated matching
    return fp1 === fp2 ? 1.0 : 0.0;
  }

  private isSuspiciousUserAgent(userAgent: string): boolean {
    const suspiciousPatterns = [
      /curl/i, /wget/i, /python/i, /bot/i, /crawler/i, /scraper/i,
      /postman/i, /insomnia/i, /httpclient/i
    ];
    
    return suspiciousPatterns.some(pattern => pattern.test(userAgent));
  }

  private isRoundNumber(amount: number): boolean {
    // Check if amount is a round number (divisible by 1000, 5000, 10000)
    return amount % 1000 === 0 || amount % 5000 === 0 || amount % 10000 === 0;
  }

  private async getRecentTransactionAmounts(userId: string, limit: number): Promise<number[]> {
    const recentTx = await this.getRecentTransactions(
      userId,
      new Date(Date.now() - 24 * 60 * 60 * 1000),
      new Date()
    );
    
    return recentTx.slice(0, limit).map(tx => tx.amount);
  }

  private hasSequentialPattern(amounts: number[]): boolean {
    if (amounts.length < 3) return false;
    
    // Check for arithmetic progression
    for (let i = 0; i < amounts.length - 2; i++) {
      const diff1 = amounts[i + 1] - amounts[i];
      const diff2 = amounts[i + 2] - amounts[i + 1];
      if (Math.abs(diff1 - diff2) < 100) { // Allow small variance
        return true;
      }
    }
    
    return false;
  }

  private async getCardUsagePattern(cardFingerprint: string): Promise<{ multipleUsers: number }> {
    try {
      const snapshot = await this.db.collectionGroup('contributions')
        .where('paymentFingerprint', '==', cardFingerprint)
        .get();

      const uniqueUsers = new Set(snapshot.docs.map(doc => doc.data().contributorUid));
      return { multipleUsers: uniqueUsers.size };

    } catch (error) {
      return { multipleUsers: 1 };
    }
  }

  private hasAccountTakeoverIndicators(context: TransactionContext, userProfile: UserRiskProfile): boolean {
    // Simple heuristic - in production would use more sophisticated ML models
    const indicators = [
      context.amount > userProfile.historicalAnalysis.averageTransactionAmount * 5,
      !userProfile.historicalAnalysis.preferredPaymentMethods.includes(context.payment.method),
      !userProfile.historicalAnalysis.geolocationPatterns.includes(context.source.country || '')
    ];

    return indicators.filter(Boolean).length >= 2;
  }

  private async checkIPReputation(ip: string): Promise<{
    isMalicious: boolean;
    isProxy: boolean;
    isVPN: boolean;
    isTor: boolean;
    categories: string[];
  }> {
    // In production, this would integrate with IP reputation services
    // For now, simple pattern matching
    
    const knownMaliciousRanges = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];
    const isMalicious = false; // Would check against threat intelligence feeds
    
    return {
      isMalicious,
      isProxy: false,
      isVPN: false,
      isTor: false,
      categories: []
    };
  }

  private applyMLAnomalyDetection(indicators: FraudIndicator[], userProfile: UserRiskProfile): number {
    // Simplified ML model simulation
    // In production, this would use actual trained models
    
    const anomalyScore = indicators.length * 0.1;
    const profileDeviation = Math.abs(userProfile.riskScore - 25) / 100;
    
    return Math.min(anomalyScore + profileDeviation, 0.5);
  }

  private calculateUserBaseRiskScore(factors: UserRiskProfile['factors']): number {
    const weights = {
      accountAge: 0.2,
      transactionHistory: 0.3,
      verificationLevel: 0.25,
      behavioralConsistency: 0.15,
      networkReputation: 0.1
    };

    // Lower values for positive factors (higher risk with lower values)
    const score = Object.entries(factors).reduce((total, [factor, value]) => {
      const weight = weights[factor as keyof typeof weights] || 0;
      const riskContribution = (100 - value) * weight; // Invert so lower values = higher risk
      return total + riskContribution;
    }, 0);

    return Math.min(Math.max(score, 0), 100);
  }

  private async updateUserRiskProfile(
    context: TransactionContext,
    profile: UserRiskProfile,
    newRiskScore: number
  ): Promise<void> {
    try {
      // Update profile with new transaction data
      profile.riskScore = (profile.riskScore * 0.7) + (newRiskScore * 0.3); // Weighted average
      profile.riskLevel = this.determineRiskLevel(profile.riskScore);
      profile.lastUpdated = new Date();

      // Update cache
      this.userProfiles.set(context.userId, profile);

      // Update database
      await firestoreHelper.updateDocument('user_risk_profiles', context.userId, {
        riskScore: profile.riskScore,
        riskLevel: profile.riskLevel,
        lastUpdated: profile.lastUpdated
      });

    } catch (error) {
      logger.error('Failed to update user risk profile', error as Error, { userId: context.userId });
    }
  }

  private async storeFraudAnalysis(result: FraudAnalysisResult): Promise<void> {
    try {
      await firestoreHelper.setDocument('fraud_analyses', result.transactionId, result);
    } catch (error) {
      logger.error('Failed to store fraud analysis', error as Error, { 
        transactionId: result.transactionId 
      });
    }
  }

  private async executeRealTimeBlock(context: TransactionContext, result: FraudAnalysisResult): Promise<void> {
    try {
      logger.warn('Executing real-time fraud block', {
        transactionId: context.transactionId,
        userId: context.userId,
        riskScore: result.riskScore,
        indicators: result.indicators.length
      });

      // Block the transaction
      await firestoreHelper.setDocument('blocked_transactions', context.transactionId, {
        userId: context.userId,
        reason: 'fraud_detection',
        riskScore: result.riskScore,
        indicators: result.indicators.map(i => i.type),
        timestamp: new Date(),
        status: 'blocked'
      });

      // Flag user account for review if high risk
      if (result.riskScore >= 90) {
        await firestoreHelper.updateDocument('users', context.userId, {
          'securityFlags.fraudSuspected': true,
          'securityFlags.lastFlaggedAt': new Date(),
          'securityFlags.requiresReview': true
        });
      }

    } catch (error) {
      logger.error('Failed to execute real-time block', error as Error, {
        transactionId: context.transactionId
      });
    }
  }

  private async initializeFraudDetection(): Promise<void> {
    try {
      // Load existing suspicious patterns
      await this.loadSuspiciousPatterns();

      // Initialize ML models if enabled
      if (this.config.mlModels.enableAnomalyDetection) {
        await this.initializeMLModels();
      }

      logger.info('Fraud detection system initialized', {
        config: this.config,
        userProfilesLoaded: this.userProfiles.size
      });

    } catch (error) {
      logger.error('Failed to initialize fraud detection', error as Error);
      throw error;
    }
  }

  private async loadSuspiciousPatterns(): Promise<void> {
    try {
      const snapshot = await this.db.collection('fraud_patterns').get();
      
      snapshot.docs.forEach(doc => {
        this.suspiciousPatterns.set(doc.id, doc.data());
      });

    } catch (error) {
      logger.error('Failed to load suspicious patterns', error as Error);
    }
  }

  private async initializeMLModels(): Promise<void> {
    // In production, this would load trained ML models
    logger.info('ML fraud detection models initialized');
  }

  // Public management methods
  async getFraudAnalysis(transactionId: string): Promise<FraudAnalysisResult | null> {
    return await firestoreHelper.getDocumentOptional('fraud_analyses', transactionId) as FraudAnalysisResult | null;
  }

  async getUserRiskSummary(userId: string): Promise<UserRiskProfile | null> {
    return await this.getUserRiskProfile(userId);
  }

  async getFraudStatistics(timeRange: { start: Date; end: Date }): Promise<{
    totalAnalyses: number;
    riskDistribution: Record<string, number>;
    blockedTransactions: number;
    falsePositiveRate: number;
  }> {
    try {
      const snapshot = await this.db.collection('fraud_analyses')
        .where('metadata.analysisTimestamp', '>=', timeRange.start)
        .where('metadata.analysisTimestamp', '<=', timeRange.end)
        .get();

      const analyses = snapshot.docs.map(doc => doc.data() as FraudAnalysisResult);
      
      const riskDistribution = analyses.reduce((acc, analysis) => {
        acc[analysis.riskLevel] = (acc[analysis.riskLevel] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const blockedTransactions = analyses.filter(a => a.recommendation === 'block').length;

      return {
        totalAnalyses: analyses.length,
        riskDistribution,
        blockedTransactions,
        falsePositiveRate: 0 // Would calculate from manual reviews
      };

    } catch (error) {
      logger.error('Failed to get fraud statistics', error as Error);
      return {
        totalAnalyses: 0,
        riskDistribution: {},
        blockedTransactions: 0,
        falsePositiveRate: 0
      };
    }
  }
}

// Singleton instance
export const fraudDetectionSystem = new FraudDetectionSystem();