import { getFirestore } from 'firebase-admin/firestore';
import { logger } from '../utils/logger';
import { firestoreHelper } from '../utils/firestore';

export interface ThreatDetectionConfig {
  ipRateLimits: {
    requests: number;
    windowMinutes: number;
    blockDurationMinutes: number;
  };
  behaviorAnalysis: {
    failedAttemptsThreshold: number;
    suspiciousPatternThreshold: number;
    temporalAnomalyThreshold: number;
  };
  geolocation: {
    blockedCountries: string[];
    suspiciousCountries: string[];
  };
  automated: {
    autoBlock: boolean;
    autoAlert: boolean;
    autoEscalate: boolean;
  };
}

export interface ThreatEvent {
  id: string;
  type: 'rate_limit' | 'brute_force' | 'suspicious_behavior' | 'geo_anomaly' | 'injection_attempt' | 'data_exfiltration';
  severity: 'low' | 'medium' | 'high' | 'critical';
  source: {
    ip: string;
    userAgent?: string;
    userId?: string;
    country?: string;
    region?: string;
  };
  details: {
    endpoint?: string;
    method?: string;
    payload?: any;
    timestamp: Date;
    description: string;
  };
  response: {
    action: 'logged' | 'blocked' | 'rate_limited' | 'escalated';
    automated: boolean;
    blockExpiry?: Date;
  };
  metadata: {
    riskScore: number;
    confidence: number;
    falsePositiveProbability: number;
  };
}

export interface SecurityMetrics {
  totalThreats: number;
  threatsByType: Record<string, number>;
  threatsBySeverity: Record<string, number>;
  blockedIPs: number;
  averageRiskScore: number;
  falsePositiveRate: number;
  responseTime: number;
}

export class ThreatDetectionSystem {
  private db = getFirestore();
  private config: ThreatDetectionConfig;
  private ipAttempts: Map<string, Array<{ timestamp: Date; endpoint: string }>> = new Map();
  private blockedIPs: Set<string> = new Set();
  private suspiciousPatterns: Map<string, number> = new Map();

  constructor(config?: Partial<ThreatDetectionConfig>) {
    this.config = {
      ipRateLimits: {
        requests: 100,
        windowMinutes: 15,
        blockDurationMinutes: 60,
        ...config?.ipRateLimits
      },
      behaviorAnalysis: {
        failedAttemptsThreshold: 5,
        suspiciousPatternThreshold: 3,
        temporalAnomalyThreshold: 10,
        ...config?.behaviorAnalysis
      },
      geolocation: {
        blockedCountries: ['CN', 'RU', 'KP'],
        suspiciousCountries: ['IR', 'SY'],
        ...config?.geolocation
      },
      automated: {
        autoBlock: true,
        autoAlert: true,
        autoEscalate: true,
        ...config?.automated
      }
    };

    this.initializeThreatDetection();
  }

  async detectThreats(request: {
    ip: string;
    userAgent?: string;
    userId?: string;
    endpoint: string;
    method: string;
    payload?: any;
    country?: string;
    headers?: Record<string, string>;
  }): Promise<{
    isBlocked: boolean;
    threatLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
    threats: ThreatEvent[];
    riskScore: number;
  }> {
    const startTime = Date.now();
    const threats: ThreatEvent[] = [];
    let maxThreatLevel: 'none' | 'low' | 'medium' | 'high' | 'critical' = 'none';
    let riskScore = 0;

    try {
      // Check if IP is already blocked
      if (this.blockedIPs.has(request.ip)) {
        const blockThreat = await this.createThreatEvent({
          type: 'rate_limit',
          severity: 'high',
          source: {
            ip: request.ip,
            userAgent: request.userAgent,
            userId: request.userId,
            country: request.country
          },
          details: {
            endpoint: request.endpoint,
            method: request.method,
            timestamp: new Date(),
            description: 'Request from blocked IP address'
          },
          riskScore: 90
        });

        threats.push(blockThreat);
        maxThreatLevel = 'high';
        riskScore = 90;

        return {
          isBlocked: true,
          threatLevel: maxThreatLevel,
          threats,
          riskScore
        };
      }

      // Run parallel threat detection checks
      const detectionPromises = [
        this.detectRateLimitViolation(request),
        this.detectBruteForceAttack(request),
        this.detectSuspiciousBehavior(request),
        this.detectGeolocationAnomaly(request),
        this.detectInjectionAttempts(request),
        this.detectDataExfiltration(request)
      ];

      const detectionResults = await Promise.allSettled(detectionPromises);

      // Process detection results
      for (const result of detectionResults) {
        if (result.status === 'fulfilled' && result.value) {
          threats.push(result.value);
          
          // Update max threat level
          const severityLevels = { low: 1, medium: 2, high: 3, critical: 4 };
          if (severityLevels[result.value.severity] > severityLevels[maxThreatLevel]) {
            maxThreatLevel = result.value.severity;
          }

          // Accumulate risk score
          riskScore = Math.max(riskScore, result.value.metadata.riskScore);
        }
      }

      // Determine if request should be blocked
      const shouldBlock = this.shouldBlockRequest(threats, riskScore);

      // Execute automated responses
      if (threats.length > 0) {
        await this.executeAutomatedResponse(threats, request.ip, shouldBlock);
      }

      // Log performance metrics
      const responseTime = Date.now() - startTime;
      await this.updatePerformanceMetrics(responseTime, threats.length);

      return {
        isBlocked: shouldBlock,
        threatLevel: maxThreatLevel,
        threats,
        riskScore
      };

    } catch (error) {
      logger.error('Threat detection error', error as Error, {
        ip: request.ip,
        endpoint: request.endpoint
      });

      return {
        isBlocked: false,
        threatLevel: 'none',
        threats: [],
        riskScore: 0
      };
    }
  }

  private async detectRateLimitViolation(request: any): Promise<ThreatEvent | null> {
    const { ip, endpoint, method } = request;
    const now = new Date();
    const windowStart = new Date(now.getTime() - (this.config.ipRateLimits.windowMinutes * 60 * 1000));

    // Get or initialize IP attempt history
    if (!this.ipAttempts.has(ip)) {
      this.ipAttempts.set(ip, []);
    }

    const attempts = this.ipAttempts.get(ip)!;
    
    // Clean old attempts
    const recentAttempts = attempts.filter(attempt => attempt.timestamp > windowStart);
    this.ipAttempts.set(ip, recentAttempts);

    // Add current attempt
    recentAttempts.push({ timestamp: now, endpoint });

    // Check rate limit
    if (recentAttempts.length > this.config.ipRateLimits.requests) {
      return await this.createThreatEvent({
        type: 'rate_limit',
        severity: 'medium',
        source: { ip, country: request.country },
        details: {
          endpoint,
          method,
          timestamp: now,
          description: `Rate limit exceeded: ${recentAttempts.length} requests in ${this.config.ipRateLimits.windowMinutes} minutes`
        },
        riskScore: 60 + Math.min(recentAttempts.length - this.config.ipRateLimits.requests, 30)
      });
    }

    return null;
  }

  private async detectBruteForceAttack(request: any): Promise<ThreatEvent | null> {
    const { ip, endpoint, userId } = request;

    // Check for authentication endpoints
    const authEndpoints = ['/auth/login', '/auth/verify', '/kyc/verify'];
    if (!authEndpoints.some(path => endpoint.includes(path))) {
      return null;
    }

    // Check recent failed attempts from this IP
    const recentFailures = await this.getRecentFailedAttempts(ip, 30); // Last 30 minutes

    if (recentFailures >= this.config.behaviorAnalysis.failedAttemptsThreshold) {
      return await this.createThreatEvent({
        type: 'brute_force',
        severity: recentFailures > 10 ? 'high' : 'medium',
        source: { ip, userId, country: request.country },
        details: {
          endpoint,
          method: request.method,
          timestamp: new Date(),
          description: `Brute force attack detected: ${recentFailures} failed attempts`
        },
        riskScore: 50 + Math.min(recentFailures * 5, 40)
      });
    }

    return null;
  }

  private async detectSuspiciousBehavior(request: any): Promise<ThreatEvent | null> {
    const { ip, userAgent, endpoint, payload } = request;
    let suspicionScore = 0;
    const suspiciousIndicators: string[] = [];

    // Check user agent
    if (!userAgent || userAgent.length < 10) {
      suspicionScore += 20;
      suspiciousIndicators.push('Missing or minimal user agent');
    }

    // Check for automation tools
    const automationPatterns = [
      /curl/i, /wget/i, /python/i, /bot/i, /crawler/i, /scraper/i,
      /postman/i, /insomnia/i, /httpclient/i
    ];
    
    if (userAgent && automationPatterns.some(pattern => pattern.test(userAgent))) {
      suspicionScore += 30;
      suspiciousIndicators.push('Automation tool detected');
    }

    // Check for SQL injection patterns
    if (payload && this.containsSQLInjectionPatterns(JSON.stringify(payload))) {
      suspicionScore += 50;
      suspiciousIndicators.push('SQL injection patterns detected');
    }

    // Check for unusual endpoint access patterns
    const unusualEndpoints = ['/admin', '/.env', '/wp-admin', '/phpmyadmin'];
    if (unusualEndpoints.some(path => endpoint.includes(path))) {
      suspicionScore += 40;
      suspiciousIndicators.push('Access to unusual endpoints');
    }

    // Check temporal anomalies (rapid sequential requests)
    const isTemporalAnomaly = await this.checkTemporalAnomalies(ip);
    if (isTemporalAnomaly) {
      suspicionScore += 25;
      suspiciousIndicators.push('Temporal access anomaly');
    }

    if (suspicionScore >= 30) {
      return await this.createThreatEvent({
        type: 'suspicious_behavior',
        severity: suspicionScore > 60 ? 'high' : 'medium',
        source: { ip, userAgent, country: request.country },
        details: {
          endpoint,
          method: request.method,
          timestamp: new Date(),
          description: `Suspicious behavior: ${suspiciousIndicators.join(', ')}`
        },
        riskScore: suspicionScore
      });
    }

    return null;
  }

  private async detectGeolocationAnomaly(request: any): Promise<ThreatEvent | null> {
    const { ip, country, userId } = request;

    if (!country) return null;

    // Check blocked countries
    if (this.config.geolocation.blockedCountries.includes(country)) {
      return await this.createThreatEvent({
        type: 'geo_anomaly',
        severity: 'high',
        source: { ip, country },
        details: {
          endpoint: request.endpoint,
          method: request.method,
          timestamp: new Date(),
          description: `Access from blocked country: ${country}`
        },
        riskScore: 80
      });
    }

    // Check suspicious countries
    if (this.config.geolocation.suspiciousCountries.includes(country)) {
      return await this.createThreatEvent({
        type: 'geo_anomaly',
        severity: 'medium',
        source: { ip, country, userId },
        details: {
          endpoint: request.endpoint,
          method: request.method,
          timestamp: new Date(),
          description: `Access from suspicious country: ${country}`
        },
        riskScore: 50
      });
    }

    // Check for rapid geographical changes (if user is logged in)
    if (userId) {
      const recentLocations = await this.getRecentUserLocations(userId, 24); // Last 24 hours
      if (recentLocations.length > 1 && this.isImpossibleTravel(recentLocations, country)) {
        return await this.createThreatEvent({
          type: 'geo_anomaly',
          severity: 'high',
          source: { ip, country, userId },
          details: {
            endpoint: request.endpoint,
            method: request.method,
            timestamp: new Date(),
            description: 'Impossible travel pattern detected'
          },
          riskScore: 75
        });
      }
    }

    return null;
  }

  private async detectInjectionAttempts(request: any): Promise<ThreatEvent | null> {
    const { payload, endpoint } = request;

    if (!payload) return null;

    const payloadString = JSON.stringify(payload);
    let injectionScore = 0;
    const detectedPatterns: string[] = [];

    // SQL Injection patterns
    if (this.containsSQLInjectionPatterns(payloadString)) {
      injectionScore += 40;
      detectedPatterns.push('SQL injection');
    }

    // NoSQL Injection patterns
    if (this.containsNoSQLInjectionPatterns(payload)) {
      injectionScore += 40;
      detectedPatterns.push('NoSQL injection');
    }

    // XSS patterns
    if (this.containsXSSPatterns(payloadString)) {
      injectionScore += 30;
      detectedPatterns.push('XSS');
    }

    // Command injection patterns
    if (this.containsCommandInjectionPatterns(payloadString)) {
      injectionScore += 50;
      detectedPatterns.push('Command injection');
    }

    if (injectionScore >= 30) {
      return await this.createThreatEvent({
        type: 'injection_attempt',
        severity: injectionScore > 60 ? 'critical' : 'high',
        source: { ip: request.ip, country: request.country },
        details: {
          endpoint,
          method: request.method,
          timestamp: new Date(),
          description: `Injection attempt detected: ${detectedPatterns.join(', ')}`
        },
        riskScore: injectionScore
      });
    }

    return null;
  }

  private async detectDataExfiltration(request: any): Promise<ThreatEvent | null> {
    const { endpoint, method, payload } = request;

    // Check for large data requests
    if (method === 'GET') {
      const dataEndpoints = ['/api/users', '/api/projects', '/api/contributions', '/api/audits'];
      const isDataEndpoint = dataEndpoints.some(path => endpoint.includes(path));
      
      if (isDataEndpoint) {
        // Check for suspicious query parameters
        const url = new URL(`http://example.com${endpoint}`);
        const limit = url.searchParams.get('limit');
        
        if (limit && parseInt(limit) > 1000) {
          return await this.createThreatEvent({
            type: 'data_exfiltration',
            severity: 'medium',
            source: { ip: request.ip, country: request.country },
            details: {
              endpoint,
              method,
              timestamp: new Date(),
              description: `Large data request: limit=${limit}`
            },
            riskScore: 45
          });
        }
      }
    }

    // Check for rapid data access patterns
    const recentDataRequests = await this.getRecentDataRequests(request.ip, 10); // Last 10 minutes
    if (recentDataRequests > 50) {
      return await this.createThreatEvent({
        type: 'data_exfiltration',
        severity: 'high',
        source: { ip: request.ip, country: request.country },
        details: {
          endpoint,
          method,
          timestamp: new Date(),
          description: `Rapid data access: ${recentDataRequests} requests in 10 minutes`
        },
        riskScore: 70
      });
    }

    return null;
  }

  private async createThreatEvent(threat: {
    type: ThreatEvent['type'];
    severity: ThreatEvent['severity'];
    source: ThreatEvent['source'];
    details: Omit<ThreatEvent['details'], 'timestamp'> & { timestamp: Date };
    riskScore: number;
  }): Promise<ThreatEvent> {
    const threatEvent: ThreatEvent = {
      id: `threat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: threat.type,
      severity: threat.severity,
      source: threat.source,
      details: threat.details,
      response: {
        action: 'logged',
        automated: false
      },
      metadata: {
        riskScore: threat.riskScore,
        confidence: this.calculateConfidence(threat.type, threat.riskScore),
        falsePositiveProbability: this.calculateFalsePositiveProbability(threat.type, threat.riskScore)
      }
    };

    // Store threat event
    await this.storeThreatEvent(threatEvent);

    return threatEvent;
  }

  private shouldBlockRequest(threats: ThreatEvent[], riskScore: number): boolean {
    if (!this.config.automated.autoBlock) return false;

    // Block on critical threats
    if (threats.some(t => t.severity === 'critical')) return true;

    // Block on high risk score
    if (riskScore >= 80) return true;

    // Block on multiple high severity threats
    const highSeverityThreats = threats.filter(t => t.severity === 'high').length;
    if (highSeverityThreats >= 2) return true;

    return false;
  }

  private async executeAutomatedResponse(threats: ThreatEvent[], ip: string, shouldBlock: boolean): Promise<void> {
    if (shouldBlock) {
      // Add IP to blocked list
      this.blockedIPs.add(ip);
      
      // Set block expiry
      const blockExpiry = new Date(Date.now() + (this.config.ipRateLimits.blockDurationMinutes * 60 * 1000));
      
      // Update threat events with block response
      for (const threat of threats) {
        threat.response = {
          action: 'blocked',
          automated: true,
          blockExpiry
        };
        await this.updateThreatEvent(threat);
      }

      // Schedule unblock
      setTimeout(() => {
        this.blockedIPs.delete(ip);
      }, this.config.ipRateLimits.blockDurationMinutes * 60 * 1000);
    }

    // Send alerts for high severity threats
    if (this.config.automated.autoAlert) {
      const alertableThreats = threats.filter(t => ['high', 'critical'].includes(t.severity));
      if (alertableThreats.length > 0) {
        await this.sendSecurityAlert(alertableThreats);
      }
    }

    // Escalate critical threats
    if (this.config.automated.autoEscalate) {
      const criticalThreats = threats.filter(t => t.severity === 'critical');
      if (criticalThreats.length > 0) {
        await this.escalateThreat(criticalThreats);
      }
    }
  }

  // Helper methods
  private containsSQLInjectionPatterns(input: string): boolean {
    const patterns = [
      /(\bunion\b.*\bselect\b)|(\bselect\b.*\bunion\b)/i,
      /(\bor\b.*=.*\bor\b)|(\band\b.*=.*\band\b)/i,
      /'\s*(or|and)\s*'?\w*'?\s*=\s*'?\w*'?/i,
      /exec\s*\(/i,
      /script\s*:/i,
      /(drop|delete|insert|update)\s+(table|from|into)/i
    ];
    
    return patterns.some(pattern => pattern.test(input));
  }

  private containsNoSQLInjectionPatterns(payload: any): boolean {
    const checkObject = (obj: any): boolean => {
      if (typeof obj !== 'object' || obj === null) return false;
      
      for (const [key, value] of Object.entries(obj)) {
        if (key.startsWith('$') && ['$ne', '$gt', '$lt', '$regex', '$where'].includes(key)) {
          return true;
        }
        if (typeof value === 'object' && checkObject(value)) {
          return true;
        }
      }
      return false;
    };

    return checkObject(payload);
  }

  private containsXSSPatterns(input: string): boolean {
    const patterns = [
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      /javascript:/gi,
      /on\w+\s*=/gi,
      /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi
    ];
    
    return patterns.some(pattern => pattern.test(input));
  }

  private containsCommandInjectionPatterns(input: string): boolean {
    const patterns = [
      /[;&|`$()]/,
      /\.\.\//,
      /(cat|ls|pwd|id|whoami|uname)\s/i,
      /(rm|mv|cp|chmod|chown)\s/i
    ];
    
    return patterns.some(pattern => pattern.test(input));
  }

  private calculateConfidence(type: string, riskScore: number): number {
    const baseConfidence: Record<string, number> = {
      'rate_limit': 0.9,
      'brute_force': 0.85,
      'suspicious_behavior': 0.7,
      'geo_anomaly': 0.8,
      'injection_attempt': 0.95,
      'data_exfiltration': 0.75
    };

    const base = baseConfidence[type] || 0.7;
    const riskFactor = riskScore / 100;
    
    return Math.min(base + (riskFactor * 0.2), 0.99);
  }

  private calculateFalsePositiveProbability(type: string, riskScore: number): number {
    const baseFalsePositive: Record<string, number> = {
      'rate_limit': 0.05,
      'brute_force': 0.1,
      'suspicious_behavior': 0.3,
      'geo_anomaly': 0.2,
      'injection_attempt': 0.02,
      'data_exfiltration': 0.15
    };

    const base = baseFalsePositive[type] || 0.2;
    const riskFactor = riskScore / 100;
    
    return Math.max(base - (riskFactor * 0.15), 0.01);
  }

  private async initializeThreatDetection(): Promise<void> {
    // Load blocked IPs from database
    await this.loadBlockedIPs();
    
    // Initialize cleanup intervals
    this.startCleanupIntervals();
    
    logger.info('Threat detection system initialized', {
      config: this.config,
      blockedIPs: this.blockedIPs.size
    });
  }

  private async loadBlockedIPs(): Promise<void> {
    try {
      const snapshot = await this.db.collection('security_blocks')
        .where('blockExpiry', '>', new Date())
        .get();

      snapshot.docs.forEach(doc => {
        const data = doc.data();
        this.blockedIPs.add(data.ip);
      });
    } catch (error) {
      logger.error('Failed to load blocked IPs', error as Error);
    }
  }

  private startCleanupIntervals(): void {
    // Clean IP attempts every 5 minutes
    setInterval(() => {
      const cutoff = new Date(Date.now() - (30 * 60 * 1000)); // 30 minutes ago
      
      for (const [ip, attempts] of this.ipAttempts.entries()) {
        const recentAttempts = attempts.filter(attempt => attempt.timestamp > cutoff);
        if (recentAttempts.length === 0) {
          this.ipAttempts.delete(ip);
        } else {
          this.ipAttempts.set(ip, recentAttempts);
        }
      }
    }, 5 * 60 * 1000);

    // Clean blocked IPs every hour
    setInterval(async () => {
      try {
        const expiredBlocks = await this.db.collection('security_blocks')
          .where('blockExpiry', '<=', new Date())
          .get();

        const batch = this.db.batch();
        expiredBlocks.docs.forEach(doc => {
          this.blockedIPs.delete(doc.data().ip);
          batch.delete(doc.ref);
        });

        if (!expiredBlocks.empty) {
          await batch.commit();
        }
      } catch (error) {
        logger.error('Failed to clean expired blocks', error as Error);
      }
    }, 60 * 60 * 1000);
  }

  // Database operations
  private async storeThreatEvent(threat: ThreatEvent): Promise<void> {
    try {
      await firestoreHelper.setDocument('security_threats', threat.id, threat);
    } catch (error) {
      logger.error('Failed to store threat event', error as Error, { threatId: threat.id });
    }
  }

  private async updateThreatEvent(threat: ThreatEvent): Promise<void> {
    try {
      await firestoreHelper.updateDocument('security_threats', threat.id, {
        response: threat.response,
        updatedAt: new Date()
      });
    } catch (error) {
      logger.error('Failed to update threat event', error as Error, { threatId: threat.id });
    }
  }

  private async getRecentFailedAttempts(ip: string, minutes: number): Promise<number> {
    try {
      const cutoff = new Date(Date.now() - (minutes * 60 * 1000));
      const snapshot = await this.db.collection('auth_attempts')
        .where('ip', '==', ip)
        .where('success', '==', false)
        .where('timestamp', '>=', cutoff)
        .get();

      return snapshot.size;
    } catch (error) {
      logger.error('Failed to get recent failed attempts', error as Error, { ip });
      return 0;
    }
  }

  private async checkTemporalAnomalies(ip: string): Promise<boolean> {
    const attempts = this.ipAttempts.get(ip) || [];
    if (attempts.length < 5) return false;

    // Check for rapid sequential requests (more than 10 requests per minute)
    const lastMinute = new Date(Date.now() - 60 * 1000);
    const recentAttempts = attempts.filter(attempt => attempt.timestamp > lastMinute);
    
    return recentAttempts.length > this.config.behaviorAnalysis.temporalAnomalyThreshold;
  }

  private async getRecentUserLocations(userId: string, hours: number): Promise<Array<{ country: string; timestamp: Date }>> {
    try {
      const cutoff = new Date(Date.now() - (hours * 60 * 60 * 1000));
      const snapshot = await this.db.collection('user_sessions')
        .where('userId', '==', userId)
        .where('timestamp', '>=', cutoff)
        .orderBy('timestamp', 'desc')
        .limit(10)
        .get();

      return snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          country: data.country,
          timestamp: data.timestamp.toDate()
        };
      });
    } catch (error) {
      logger.error('Failed to get recent user locations', error as Error, { userId });
      return [];
    }
  }

  private isImpossibleTravel(locations: Array<{ country: string; timestamp: Date }>, currentCountry: string): boolean {
    // Simple impossible travel detection - in production, use geolocation distances
    const sortedLocations = locations.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    
    if (sortedLocations.length < 2) return false;
    
    const lastLocation = sortedLocations[0];
    const timeDiff = (new Date().getTime() - lastLocation.timestamp.getTime()) / (1000 * 60 * 60); // hours
    
    // If different countries within 2 hours, consider impossible
    return lastLocation.country !== currentCountry && timeDiff < 2;
  }

  private async getRecentDataRequests(ip: string, minutes: number): Promise<number> {
    const attempts = this.ipAttempts.get(ip) || [];
    const cutoff = new Date(Date.now() - (minutes * 60 * 1000));
    
    return attempts.filter(attempt => 
      attempt.timestamp > cutoff && 
      attempt.endpoint.includes('/api/')
    ).length;
  }

  private async sendSecurityAlert(threats: ThreatEvent[]): Promise<void> {
    // Implementation would integrate with notification system
    logger.warn('Security alert triggered', {
      threatCount: threats.length,
      threats: threats.map(t => ({
        id: t.id,
        type: t.type,
        severity: t.severity,
        riskScore: t.metadata.riskScore
      }))
    });
  }

  private async escalateThreat(threats: ThreatEvent[]): Promise<void> {
    // Implementation would escalate to security team
    logger.error('Critical threat escalation', {
      threatCount: threats.length,
      threats: threats.map(t => ({
        id: t.id,
        type: t.type,
        severity: t.severity,
        source: t.source
      }))
    });
  }

  private async updatePerformanceMetrics(responseTime: number, threatCount: number): Promise<void> {
    try {
      await firestoreHelper.updateDocument('security_metrics', 'performance', {
        lastResponseTime: responseTime,
        avgResponseTime: responseTime, // Would calculate actual average
        lastThreatCount: threatCount,
        lastUpdate: new Date()
      });
    } catch (error) {
      logger.error('Failed to update performance metrics', error as Error);
    }
  }

  // Public methods for system management
  async getSecurityMetrics(): Promise<SecurityMetrics> {
    try {
      const threatsSnapshot = await this.db.collection('security_threats')
        .where('details.timestamp', '>=', new Date(Date.now() - 24 * 60 * 60 * 1000))
        .get();

      const threats = threatsSnapshot.docs.map(doc => doc.data() as ThreatEvent);
      
      const threatsByType = threats.reduce((acc, threat) => {
        acc[threat.type] = (acc[threat.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const threatsBySeverity = threats.reduce((acc, threat) => {
        acc[threat.severity] = (acc[threat.severity] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const avgRiskScore = threats.length > 0 
        ? threats.reduce((sum, threat) => sum + threat.metadata.riskScore, 0) / threats.length
        : 0;

      const falsePositiveRate = threats.length > 0
        ? threats.reduce((sum, threat) => sum + threat.metadata.falsePositiveProbability, 0) / threats.length
        : 0;

      return {
        totalThreats: threats.length,
        threatsByType,
        threatsBySeverity,
        blockedIPs: this.blockedIPs.size,
        averageRiskScore: avgRiskScore,
        falsePositiveRate,
        responseTime: 0 // Would get from performance metrics
      };

    } catch (error) {
      logger.error('Failed to get security metrics', error as Error);
      throw error;
    }
  }

  async unblockIP(ip: string): Promise<void> {
    this.blockedIPs.delete(ip);
    
    try {
      await this.db.collection('security_blocks')
        .where('ip', '==', ip)
        .get()
        .then(snapshot => {
          const batch = this.db.batch();
          snapshot.docs.forEach(doc => batch.delete(doc.ref));
          return batch.commit();
        });

      logger.info('IP unblocked manually', { ip });
    } catch (error) {
      logger.error('Failed to unblock IP', error as Error, { ip });
      throw error;
    }
  }

  async updateConfig(newConfig: Partial<ThreatDetectionConfig>): Promise<void> {
    this.config = { ...this.config, ...newConfig };
    logger.info('Threat detection config updated', { config: this.config });
  }
}

// Singleton instance
export const threatDetectionSystem = new ThreatDetectionSystem();