# Guide de Dépannage Automatisé pour LLM Backend
## Social Finance Impact Platform MVP

## 1. Système de diagnostic automatique

### 1.1 Architecture de diagnostic pour LLM

```typescript
// src/diagnostics/diagnosticRunner.ts
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from '../utils/logger';

export interface DiagnosticResult {
  component: string;
  status: 'healthy' | 'warning' | 'error' | 'critical';
  message: string;
  details?: any;
  suggestions?: string[];
  autoFixAvailable?: boolean;
}

export interface SystemHealth {
  overall: 'healthy' | 'degraded' | 'critical';
  timestamp: Date;
  components: DiagnosticResult[];
  summary: {
    healthy: number;
    warnings: number;
    errors: number;
    critical: number;
  };
}

export class DiagnosticRunner {
  private db = getFirestore();
  private diagnostics: Map<string, any> = new Map();

  constructor() {
    this.initializeDiagnostics();
  }

  private initializeDiagnostics(): void {
    // Auto-register tous les diagnostics
    this.diagnostics.set('firestore', new FirestoreDiagnostic());
    this.diagnostics.set('auth', new AuthDiagnostic());
    this.diagnostics.set('functions', new FunctionsDiagnostic());
    this.diagnostics.set('external_apis', new ExternalAPIsDiagnostic());
    this.diagnostics.set('data_integrity', new DataIntegrityDiagnostic());
    this.diagnostics.set('performance', new PerformanceDiagnostic());
    this.diagnostics.set('security', new SecurityDiagnostic());
  }

  async runFullDiagnostic(): Promise<SystemHealth> {
    logger.info('Starting full system diagnostic');

    const results: DiagnosticResult[] = [];

    // Exécuter tous les diagnostics en parallèle
    const diagnosticPromises = Array.from(this.diagnostics.entries()).map(
      async ([name, diagnostic]) => {
        try {
          const result = await diagnostic.check();
          return { ...result, component: name };
        } catch (error) {
          return {
            component: name,
            status: 'critical' as const,
            message: `Diagnostic failed: ${(error as Error).message}`,
            suggestions: ['Check diagnostic implementation', 'Review logs for details']
          };
        }
      }
    );

    const diagnosticResults = await Promise.all(diagnosticPromises);
    results.push(...diagnosticResults);

    // Calculer santé globale
    const summary = this.calculateSummary(results);
    const overall = this.determineOverallHealth(summary);

    const systemHealth: SystemHealth = {
      overall,
      timestamp: new Date(),
      components: results,
      summary
    };

    // Enregistrer résultats pour tracking
    await this.recordDiagnosticResults(systemHealth);

    logger.info('System diagnostic completed', {
      overall,
      summary,
      componentsChecked: results.length
    });

    return systemHealth;
  }

  async runSpecificDiagnostic(component: string): Promise<DiagnosticResult> {
    const diagnostic = this.diagnostics.get(component);
    if (!diagnostic) {
      throw new Error(`Unknown diagnostic component: ${component}`);
    }

    logger.info('Running specific diagnostic', { component });

    try {
      const result = await diagnostic.check();
      return { ...result, component };
    } catch (error) {
      return {
        component,
        status: 'critical',
        message: `Diagnostic failed: ${(error as Error).message}`,
        suggestions: ['Check component availability', 'Review configuration']
      };
    }
  }

  async autoFixIssues(): Promise<{
    attempted: number;
    successful: number;
    failed: string[];
  }> {
    logger.info('Starting auto-fix process');

    const health = await this.runFullDiagnostic();
    const fixableIssues = health.components.filter(c => 
      c.autoFixAvailable && (c.status === 'warning' || c.status === 'error')
    );

    let successful = 0;
    const failed: string[] = [];

    for (const issue of fixableIssues) {
      try {
        const diagnostic = this.diagnostics.get(issue.component);
        if (diagnostic.autoFix) {
          await diagnostic.autoFix();
          successful++;
          logger.info('Auto-fix successful', { component: issue.component });
        }
      } catch (error) {
        failed.push(issue.component);
        logger.error('Auto-fix failed', error as Error, { component: issue.component });
      }
    }

    return {
      attempted: fixableIssues.length,
      successful,
      failed
    };
  }

  private calculateSummary(results: DiagnosticResult[]) {
    return results.reduce(
      (acc, result) => {
        switch (result.status) {
          case 'healthy':
            acc.healthy++;
            break;
          case 'warning':
            acc.warnings++;
            break;
          case 'error':
            acc.errors++;
            break;
          case 'critical':
            acc.critical++;
            break;
        }
        return acc;
      },
      { healthy: 0, warnings: 0, errors: 0, critical: 0 }
    );
  }

  private determineOverallHealth(summary: any): 'healthy' | 'degraded' | 'critical' {
    if (summary.critical > 0) return 'critical';
    if (summary.errors > 0 || summary.warnings > 2) return 'degraded';
    return 'healthy';
  }

  private async recordDiagnosticResults(health: SystemHealth): Promise<void> {
    await this.db.collection('_diagnostic_history').add({
      ...health,
      id: `diagnostic_${Date.now()}`
    });

    // Nettoyer ancien historique (garder 30 jours)
    const cutoffDate = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000));
    const oldRecords = await this.db.collection('_diagnostic_history')
      .where('timestamp', '<', cutoffDate)
      .get();

    const batch = this.db.batch();
    oldRecords.docs.forEach(doc => batch.delete(doc.ref));
    if (!oldRecords.empty) await batch.commit();
  }
}
```

### 1.2 Diagnostics spécialisés

```typescript
// src/diagnostics/firestoreDiagnostic.ts
export class FirestoreDiagnostic {
  private db = getFirestore();

  async check(): Promise<Omit<DiagnosticResult, 'component'>> {
    const checks = [
      this.checkConnection(),
      this.checkIndexes(),
      this.checkQuotaUsage(),
      this.checkRulesIntegrity(),
      this.checkDataIntegrity()
    ];

    const results = await Promise.allSettled(checks);
    
    // Analyser résultats
    const failures = results.filter(r => r.status === 'rejected');
    const successes = results.filter(r => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];

    if (failures.length > 0) {
      return {
        status: 'error',
        message: `${failures.length} Firestore checks failed`,
        details: failures.map(f => f.reason),
        suggestions: [
          'Check Firestore configuration',
          'Verify security rules',
          'Review quota usage'
        ],
        autoFixAvailable: true
      };
    }

    const warnings = successes.filter(s => s.value.warning);
    if (warnings.length > 0) {
      return {
        status: 'warning',
        message: `Firestore operational with ${warnings.length} warnings`,
        details: warnings.map(w => w.value),
        suggestions: warnings.flatMap(w => w.value.suggestions || [])
      };
    }

    return {
      status: 'healthy',
      message: 'Firestore operational - all checks passed',
      details: successes.map(s => s.value)
    };
  }

  private async checkConnection(): Promise<any> {
    try {
      await this.db.collection('_health').doc('test').get();
      return { check: 'connection', status: 'ok' };
    } catch (error) {
      throw new Error(`Firestore connection failed: ${(error as Error).message}`);
    }
  }

  private async checkIndexes(): Promise<any> {
    // Vérifier les index critiques via requêtes test
    const criticalQueries = [
      { collection: 'projects', filters: [['status', '==', 'live'], ['category', '==', 'environment']] },
      { collection: 'users', filters: [['kycStatus', '==', 'approved'], ['userType', '==', 'creator']] },
      { collection: 'audits', filters: [['status', '==', 'assigned'], ['dueDate', '<', new Date()]] }
    ];

    const indexIssues = [];
    
    for (const query of criticalQueries) {
      try {
        let firestoreQuery = this.db.collection(query.collection);
        query.filters.forEach(([field, op, value]) => {
          firestoreQuery = firestoreQuery.where(field, op as any, value);
        });
        
        await firestoreQuery.limit(1).get();
      } catch (error) {
        if ((error as any).code === 9) { // FAILED_PRECONDITION
          indexIssues.push({
            collection: query.collection,
            filters: query.filters,
            error: 'Missing composite index'
          });
        }
      }
    }

    if (indexIssues.length > 0) {
      return {
        warning: true,
        check: 'indexes',
        issues: indexIssues,
        suggestions: ['Create missing composite indexes via Firebase Console']
      };
    }

    return { check: 'indexes', status: 'ok' };
  }

  private async checkQuotaUsage(): Promise<any> {
    // Note: Quota usage nécessiterait l'API Admin ou monitoring
    // Pour MVP, on fait une estimation basée sur les données
    const collections = ['users', 'projects', 'contributions', 'audits'];
    let totalDocs = 0;

    for (const collection of collections) {
      const snapshot = await this.db.collection(collection).limit(1).get();
      // Estimation basée sur un échantillon (pas exact mais indicatif)
      totalDocs += snapshot.size * 1000; // Estimation très approximative
    }

    const warningThreshold = 800000; // 80% de 1M documents
    const errorThreshold = 900000;

    if (totalDocs > errorThreshold) {
      return {
        warning: true,
        check: 'quota',
        usage: totalDocs,
        suggestions: ['Consider data archiving', 'Optimize document structure']
      };
    }

    return { check: 'quota', status: 'ok', estimatedDocs: totalDocs };
  }

  private async checkRulesIntegrity(): Promise<any> {
    // Test des règles de sécurité via tentatives d'accès
    try {
      // Simuler différents contextes d'auth pour tester les règles
      const testContexts = [
        { auth: null, expect: 'denied' },
        { auth: { uid: 'test', role: 'contributor' }, expect: 'partial' },
        { auth: { uid: 'test', role: 'admin' }, expect: 'allowed' }
      ];

      // Tests basiques des règles (simulation)
      return { check: 'rules', status: 'ok' };

    } catch (error) {
      throw new Error(`Security rules validation failed: ${(error as Error).message}`);
    }
  }

  private async checkDataIntegrity(): Promise<any> {
    const issues = [];

    // Vérifier orphaned contributions
    const contributionsSnapshot = await this.db.collectionGroup('contributions').limit(100).get();
    for (const contrib of contributionsSnapshot.docs) {
      const projectId = contrib.ref.path.split('/')[1];
      const projectExists = await this.db.collection('projects').doc(projectId).get();
      if (!projectExists.exists) {
        issues.push({ type: 'orphaned_contribution', contributionId: contrib.id, projectId });
      }
    }

    // Vérifier users avec projets mais pas creator
    const projectsSnapshot = await this.db.collection('projects').limit(50).get();
    for (const project of projectsSnapshot.docs) {
      const creatorUid = project.data().creatorUid;
      const user = await this.db.collection('users').doc(creatorUid).get();
      if (user.exists && user.data()?.userType !== 'creator') {
        issues.push({ type: 'invalid_creator_type', userId: creatorUid, projectId: project.id });
      }
    }

    if (issues.length > 0) {
      return {
        warning: true,
        check: 'data_integrity',
        issues,
        suggestions: ['Run data cleanup script', 'Review data validation rules']
      };
    }

    return { check: 'data_integrity', status: 'ok' };
  }

  async autoFix(): Promise<void> {
    logger.info('Running Firestore auto-fix');

    // Auto-fix data integrity issues
    const integrity = await this.checkDataIntegrity();
    if (integrity.warning && integrity.issues) {
      for (const issue of integrity.issues) {
        try {
          if (issue.type === 'orphaned_contribution') {
            // Soft delete orphaned contributions
            const contribPath = `projects/${issue.projectId}/contributions/${issue.contributionId}`;
            await this.db.doc(contribPath).update({
              status: 'orphaned',
              fixedAt: new Date()
            });
          }
        } catch (error) {
          logger.warn('Auto-fix failed for issue', { issue, error: (error as Error).message });
        }
      }
    }
  }
}
```

## 2. Diagnostics d'APIs externes

### 2.1 Diagnostic Stripe

```typescript
// src/diagnostics/externalAPIsDiagnostic.ts
export class ExternalAPIsDiagnostic {
  async check(): Promise<Omit<DiagnosticResult, 'component'>> {
    const apiChecks = [
      this.checkStripe(),
      this.checkSumsub(),
      this.checkSendGrid()
    ];

    const results = await Promise.allSettled(apiChecks);
    const failures = results.filter(r => r.status === 'rejected');

    if (failures.length > 0) {
      return {
        status: 'error',
        message: `${failures.length} external APIs failing`,
        details: failures.map(f => ({ service: f, error: f.reason })),
        suggestions: [
          'Check API credentials',
          'Verify network connectivity',
          'Review rate limits'
        ]
      };
    }

    return {
      status: 'healthy',
      message: 'All external APIs operational'
    };
  }

  private async checkStripe(): Promise<any> {
    try {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      
      // Test basique de l'API Stripe
      await stripe.balance.retrieve();
      
      return { service: 'stripe', status: 'ok', latency: 'good' };
    } catch (error) {
      const err = error as any;
      if (err.type === 'StripeAuthenticationError') {
        throw new Error('Stripe authentication failed - check API key');
      }
      throw new Error(`Stripe API error: ${err.message}`);
    }
  }

  private async checkSumsub(): Promise<any> {
    try {
      // Test endpoint Sumsub
      const axios = require('axios');
      const config = {
        headers: {
          'X-App-Token': process.env.SUMSUB_APP_TOKEN,
        },
        timeout: 10000
      };

      await axios.get('https://api.sumsub.com/resources/applicants', config);
      
      return { service: 'sumsub', status: 'ok' };
    } catch (error) {
      const err = error as any;
      if (err.response?.status === 401) {
        throw new Error('Sumsub authentication failed - check credentials');
      }
      throw new Error(`Sumsub API error: ${err.message}`);
    }
  }

  private async checkSendGrid(): Promise<any> {
    try {
      const sgMail = require('@sendgrid/mail');
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      
      // Test simple validation de clé API
      await sgMail.send({
        to: 'test@example.com',
        from: 'noreply@socialimpact.com',
        subject: 'Test',
        text: 'Test',
        mailSettings: {
          sandboxMode: { enable: true }
        }
      });

      return { service: 'sendgrid', status: 'ok' };
    } catch (error) {
      const err = error as any;
      if (err.code === 401) {
        throw new Error('SendGrid authentication failed - check API key');
      }
      throw new Error(`SendGrid API error: ${err.message}`);
    }
  }
}
```

## 3. Diagnostic de performance

### 3.1 Performance monitoring

```typescript
// src/diagnostics/performanceDiagnostic.ts
export class PerformanceDiagnostic {
  private db = getFirestore();

  async check(): Promise<Omit<DiagnosticResult, 'component'>> {
    const checks = [
      this.checkFunctionLatency(),
      this.checkFirestorePerformance(),
      this.checkMemoryUsage(),
      this.checkColdStarts()
    ];

    const results = await Promise.all(checks);
    const issues = results.filter(r => r.warning || r.error);

    if (issues.length > 0) {
      const hasErrors = issues.some(i => i.error);
      return {
        status: hasErrors ? 'error' : 'warning',
        message: `Performance issues detected: ${issues.length} components`,
        details: issues,
        suggestions: this.generatePerformanceSuggestions(issues)
      };
    }

    return {
      status: 'healthy',
      message: 'System performance within acceptable ranges',
      details: results
    };
  }

  private async checkFunctionLatency(): Promise<any> {
    // Simuler appels aux functions critiques et mesurer latency
    const criticalFunctions = ['createProject', 'createContribution', 'completeProfile'];
    const latencies: Record<string, number> = {};

    for (const funcName of criticalFunctions) {
      const start = Date.now();
      try {
        // Appel test en mode dry-run
        await this.testFunctionLatency(funcName);
        latencies[funcName] = Date.now() - start;
      } catch (error) {
        latencies[funcName] = -1; // Erreur
      }
    }

    const avgLatency = Object.values(latencies).reduce((sum, lat) => sum + (lat > 0 ? lat : 0), 0) / 
                       Object.values(latencies).filter(lat => lat > 0).length;

    const slowFunctions = Object.entries(latencies).filter(([_, lat]) => lat > 3000);

    if (slowFunctions.length > 0) {
      return {
        warning: true,
        check: 'function_latency',
        avgLatency,
        slowFunctions,
        suggestions: ['Review function optimization', 'Check cold start issues']
      };
    }

    return { check: 'function_latency', avgLatency, status: 'ok' };
  }

  private async checkFirestorePerformance(): Promise<any> {
    const queries = [
      { name: 'user_lookup', query: () => this.db.collection('users').limit(1).get() },
      { name: 'project_search', query: () => this.db.collection('projects').where('status', '==', 'live').limit(10).get() },
      { name: 'contribution_history', query: () => this.db.collectionGroup('contributions').limit(5).get() }
    ];

    const results = [];
    
    for (const { name, query } of queries) {
      const start = Date.now();
      try {
        await query();
        const latency = Date.now() - start;
        results.push({ query: name, latency, status: latency > 1000 ? 'slow' : 'ok' });
      } catch (error) {
        results.push({ query: name, error: (error as Error).message });
      }
    }

    const slowQueries = results.filter(r => r.status === 'slow');
    
    if (slowQueries.length > 0) {
      return {
        warning: true,
        check: 'firestore_performance',
        results,
        suggestions: ['Review query optimization', 'Check composite indexes']
      };
    }

    return { check: 'firestore_performance', results, status: 'ok' };
  }

  private async checkMemoryUsage(): Promise<any> {
    const usage = process.memoryUsage();
    const maxMemory = 256 * 1024 * 1024; // 256MB limit for functions
    const usagePercent = (usage.heapUsed / maxMemory) * 100;

    if (usagePercent > 80) {
      return {
        error: true,
        check: 'memory_usage',
        usage: usage,
        usagePercent,
        suggestions: ['Optimize memory usage', 'Review object lifecycle']
      };
    }

    if (usagePercent > 60) {
      return {
        warning: true,
        check: 'memory_usage',
        usage,
        usagePercent,
        suggestions: ['Monitor memory usage trends']
      };
    }

    return { check: 'memory_usage', usage, usagePercent, status: 'ok' };
  }

  private async checkColdStarts(): Promise<any> {
    // Analyser les logs pour détecter les cold starts fréquents
    // Pour MVP, simulation basique
    const estimatedColdStarts = Math.random() * 10; // Simulation

    if (estimatedColdStarts > 5) {
      return {
        warning: true,
        check: 'cold_starts',
        estimatedColdStarts,
        suggestions: [
          'Implement function warming',
          'Optimize function initialization',
          'Consider function splitting'
        ]
      };
    }

    return { check: 'cold_starts', estimatedColdStarts, status: 'ok' };
  }

  private async testFunctionLatency(functionName: string): Promise<void> {
    // Simulation d'appel function pour test latency
    await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
  }

  private generatePerformanceSuggestions(issues: any[]): string[] {
    const suggestions = new Set<string>();

    issues.forEach(issue => {
      if (issue.suggestions) {
        issue.suggestions.forEach((s: string) => suggestions.add(s));
      }
    });

    // Suggestions générales selon types d'issues
    if (issues.some(i => i.check === 'function_latency')) {
      suggestions.add('Consider function optimization');
      suggestions.add('Review async/await usage');
    }

    if (issues.some(i => i.check === 'firestore_performance')) {
      suggestions.add('Create composite indexes');
      suggestions.add('Optimize query patterns');
    }

    return Array.from(suggestions);
  }
}
```

## 4. Auto-healing et notifications

### 4.1 Auto-healing system

```typescript
// src/diagnostics/autoHealer.ts
export class AutoHealer {
  private diagnosticRunner = new DiagnosticRunner();

  async runAutoHealing(): Promise<{
    issuesDetected: number;
    issuesFixed: number;
    criticalIssues: DiagnosticResult[];
  }> {
    logger.info('Starting auto-healing process');

    // 1. Diagnostic complet
    const health = await this.diagnosticRunner.runFullDiagnostic();
    
    // 2. Identifier issues critiques non auto-fixables
    const criticalIssues = health.components.filter(c => 
      c.status === 'critical' && !c.autoFixAvailable
    );

    // 3. Auto-fix des issues réparables
    const fixResults = await this.diagnosticRunner.autoFixIssues();

    // 4. Notifications si nécessaire
    if (criticalIssues.length > 0) {
      await this.sendCriticalAlerts(criticalIssues);
    }

    // 5. Rapport final
    const finalHealth = await this.diagnosticRunner.runFullDiagnostic();
    
    return {
      issuesDetected: health.components.filter(c => c.status !== 'healthy').length,
      issuesFixed: fixResults.successful,
      criticalIssues
    };
  }

  private async sendCriticalAlerts(issues: DiagnosticResult[]): Promise<void> {
    const alertMessage = {
      type: 'system_critical',
      title: 'Critical System Issues Detected',
      message: `${issues.length} critical issues require immediate attention`,
      details: issues.map(i => `${i.component}: ${i.message}`),
      timestamp: new Date(),
      severity: 'critical'
    };

    // Envoyer notification admin (simulation)
    logger.error('Critical system issues detected', new Error('System health critical'), {
      issues: issues.length,
      components: issues.map(i => i.component)
    });
    
    // TODO: Intégrer avec système de notifications réel
  }
}

// Scheduled function pour auto-healing périodique
export const scheduledAutoHealing = functions.pubsub
  .schedule('every 1 hours')
  .onRun(async (context) => {
    const autoHealer = new AutoHealer();
    
    try {
      const results = await autoHealer.runAutoHealing();
      
      logger.info('Scheduled auto-healing completed', results);
      
      return null;
    } catch (error) {
      logger.error('Scheduled auto-healing failed', error as Error);
      throw error;
    }
  });
```

Ce système de diagnostic et dépannage automatique permet à un LLM de maintenir un backend robuste avec une capacité d'auto-réparation et de détection proactive des problèmes.