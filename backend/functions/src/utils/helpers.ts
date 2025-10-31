/**
 * General Helper Functions
 * Social Finance Impact Platform
 */

import { logger } from './logger';
import { LIMITS, PATTERNS, FEES } from './constants';
import { ProjectCategory } from '../types/global';

/**
 * Utilitaires pour les montants et devises
 */
export const amountHelpers = {
  /**
   * Convertit un montant de euros vers centimes
   */
  eurosToCents(euros: number): number {
    return Math.round(euros * 100);
  },

  /**
   * Convertit un montant de centimes vers euros
   */
  centsToEuros(cents: number): number {
    return cents / 100;
  },

  /**
   * Formate un montant en euros avec devise
   */
  formatEuros(cents: number, showCurrency: boolean = true): string {
    const euros = this.centsToEuros(cents);
    const formatted = euros.toLocaleString('fr-FR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return showCurrency ? `${formatted} €` : formatted;
  },

  /**
   * Valide qu'un montant est dans les limites autorisées
   */
  validateAmount(cents: number, context: 'contribution' | 'project_goal' = 'contribution'): boolean {
    switch (context) {
      case 'contribution':
        return cents >= LIMITS.CONTRIBUTION.MIN_AMOUNT && cents <= LIMITS.CONTRIBUTION.MAX_AMOUNT;
      case 'project_goal':
        return cents >= LIMITS.PROJECT.MIN_FUNDING_GOAL && cents <= LIMITS.PROJECT.MAX_FUNDING_GOAL;
      default:
        return false;
    }
  },

  /**
   * Calcule les frais pour un montant donné
   */
  calculateFees: FEES.calculateFees,
};

/**
 * Utilitaires pour les dates et temps
 */
export const dateHelpers = {
  /**
   * Convertit une date en timestamp Unix
   */
  toUnixTimestamp(date: Date): number {
    return Math.floor(date.getTime() / 1000);
  },

  /**
   * Crée une date à partir d'un timestamp Unix
   */
  fromUnixTimestamp(timestamp: number): Date {
    return new Date(timestamp * 1000);
  },

  /**
   * Calcule la différence en jours entre deux dates
   */
  daysBetween(startDate: Date, endDate: Date): number {
    const timeDifference = endDate.getTime() - startDate.getTime();
    return Math.ceil(timeDifference / (1000 * 3600 * 24));
  },

  /**
   * Ajoute des jours à une date
   */
  addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  },

  /**
   * Vérifie si une date est dans le passé
   */
  isPast(date: Date): boolean {
    return date < new Date();
  },

  /**
   * Vérifie si une date est dans le futur
   */
  isFuture(date: Date): boolean {
    return date > new Date();
  },

  /**
   * Formate une date pour l'affichage français
   */
  formatFrench(date: Date): string {
    return date.toLocaleDateString('fr-FR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  },

  /**
   * Formate une date et heure pour l'affichage français
   */
  formatFrenchDateTime(date: Date): string {
    return date.toLocaleDateString('fr-FR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  },

  /**
   * Génère une date d'expiration par défaut (30 jours)
   */
  defaultExpiration(fromDate: Date = new Date()): Date {
    return this.addDays(fromDate, 30);
  },
};

/**
 * Utilitaires pour les chaînes de caractères
 */
export const stringHelpers = {
  /**
   * Génère un slug URL-friendly à partir d'un titre
   */
  generateSlug(title: string, maxLength: number = 50): string {
    return title
      .toLowerCase()
      .trim()
      // Remplacer les caractères accentués
      .replace(/[àáâãäå]/g, 'a')
      .replace(/[èéêë]/g, 'e')
      .replace(/[ìíîï]/g, 'i')
      .replace(/[òóôõö]/g, 'o')
      .replace(/[ùúûü]/g, 'u')
      .replace(/[ñ]/g, 'n')
      .replace(/[ç]/g, 'c')
      // Supprimer caractères spéciaux
      .replace(/[^a-z0-9\s-]/g, '')
      // Remplacer espaces par tirets
      .replace(/\s+/g, '-')
      // Supprimer tirets multiples
      .replace(/-+/g, '-')
      // Supprimer tirets au début/fin
      .replace(/^-|-$/g, '')
      // Limiter la longueur
      .substring(0, maxLength);
  },

  /**
   * Génère un ID unique avec préfixe
   */
  generateId(prefix: string): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 5);
    return `${prefix}_${timestamp}_${random}`;
  },

  /**
   * Capitalise la première lettre d'une chaîne
   */
  capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  },

  /**
   * Tronque un texte avec ellipse
   */
  truncate(text: string, maxLength: number, suffix: string = '...'): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - suffix.length) + suffix;
  },

  /**
   * Échappe les caractères HTML
   */
  escapeHtml(text: string): string {
    const div = { innerHTML: text } as any;
    return div.textContent || div.innerText || '';
  },

  /**
   * Génère un hash simple pour une chaîne
   */
  simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convertir en entier 32bit
    }
    return Math.abs(hash);
  },
};

/**
 * Utilitaires pour la validation
 */
export const validationHelpers = {
  /**
   * Valide une adresse email
   */
  isValidEmail(email: string): boolean {
    return PATTERNS.EMAIL.test(email);
  },

  /**
   * Valide un numéro de téléphone international
   */
  isValidPhoneNumber(phone: string): boolean {
    return PATTERNS.PHONE.test(phone);
  },

  /**
   * Valide un mot de passe fort
   */
  isValidPassword(password: string): boolean {
    return PATTERNS.PASSWORD.test(password);
  },

  /**
   * Valide un code postal selon le pays
   */
  isValidPostalCode(postalCode: string, country: string): boolean {
    const pattern = PATTERNS.POSTAL_CODE[country as keyof typeof PATTERNS.POSTAL_CODE];
    return pattern ? pattern.test(postalCode) : true; // Accepter si pas de pattern défini
  },

  /**
   * Valide un IBAN
   */
  isValidIBAN(iban: string): boolean {
    return PATTERNS.IBAN.test(iban.replace(/\s/g, ''));
  },

  /**
   * Valide une URL
   */
  isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Nettoie et valide une catégorie de projet
   */
  validateProjectCategory(category: string): ProjectCategory | null {
    const validCategories: ProjectCategory[] = ['environment', 'education', 'health', 'community', 'innovation'];
    return validCategories.includes(category as ProjectCategory) ? category as ProjectCategory : null;
  },
};

/**
 * Utilitaires pour les objets et arrays
 */
export const objectHelpers = {
  /**
   * Supprime les propriétés undefined/null d'un objet
   */
  removeEmpty<T extends Record<string, any>>(obj: T): Partial<T> {
    const result: Partial<T> = {};
    
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined && value !== null) {
        result[key as keyof T] = value;
      }
    }
    
    return result;
  },

  /**
   * Sélectionne certaines propriétés d'un objet
   */
  pick<T extends Record<string, any>, K extends keyof T>(
    obj: T,
    keys: K[]
  ): Pick<T, K> {
    const result = {} as Pick<T, K>;
    
    for (const key of keys) {
      if (key in obj) {
        result[key] = obj[key];
      }
    }
    
    return result;
  },

  /**
   * Exclut certaines propriétés d'un objet
   */
  omit<T extends Record<string, any>, K extends keyof T>(
    obj: T,
    keys: K[]
  ): Omit<T, K> {
    const result = { ...obj };
    
    for (const key of keys) {
      delete result[key];
    }
    
    return result;
  },

  /**
   * Applique une transformation récursive aux valeurs d'un objet
   */
  deepTransform<T>(
    obj: T,
    transformer: (value: any, key: string) => any
  ): T {
    if (Array.isArray(obj)) {
      return obj.map((item, index) => this.deepTransform(item, transformer)) as unknown as T;
    }
    
    if (obj && typeof obj === 'object') {
      const result: any = {};
      
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.deepTransform(transformer(value, key), transformer);
      }
      
      return result;
    }
    
    return obj;
  },

  /**
   * Clone profond d'un objet
   */
  deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    
    if (obj instanceof Date) {
      return new Date(obj.getTime()) as unknown as T;
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.deepClone(item)) as unknown as T;
    }
    
    const clonedObj = {} as T;
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        clonedObj[key] = this.deepClone(obj[key]);
      }
    }
    
    return clonedObj;
  },
};

/**
 * Utilitaires pour les opérations asynchrones
 */
export const asyncHelpers = {
  /**
   * Attend pendant un nombre de millisecondes
   */
  delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  /**
   * Exécute des promesses par petits lots pour éviter la surcharge
   */
  async batchProcess<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    batchSize: number = 10,
    delayMs: number = 100
  ): Promise<R[]> {
    const results: R[] = [];
    
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchPromises = batch.map(processor);
      const batchResults = await Promise.all(batchPromises);
      
      results.push(...batchResults);
      
      // Pause entre les lots
      if (i + batchSize < items.length) {
        await this.delay(delayMs);
      }
    }
    
    return results;
  },

  /**
   * Retry une fonction avec backoff exponentiel
   */
  async retry<T>(
    fn: () => Promise<T>,
    maxAttempts: number = 3,
    initialDelayMs: number = 1000,
    backoffMultiplier: number = 2
  ): Promise<T> {
    let lastError: any;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        
        if (attempt === maxAttempts) {
          break;
        }
        
        const delay = initialDelayMs * Math.pow(backoffMultiplier, attempt - 1);
        logger.warn(`Retry attempt ${attempt} failed, retrying in ${delay}ms`, error);
        
        await this.delay(delay);
      }
    }
    
    throw lastError;
  },

  /**
   * Timeout pour une promesse
   */
  async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutMessage: string = 'Operation timed out'
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    });
    
    return Promise.race([promise, timeoutPromise]);
  },
};

/**
 * Utilitaires de performance et monitoring
 */
export const performanceHelpers = {
  /**
   * Mesure le temps d'exécution d'une fonction
   */
  async measureTime<T>(
    label: string,
    fn: () => Promise<T> | T
  ): Promise<{ result: T; duration: number }> {
    const startTime = performance.now();
    
    try {
      const result = await fn();
      const duration = performance.now() - startTime;
      
      logger.debug(`Performance: ${label}`, { duration: Math.round(duration) });
      
      return { result, duration };
    } catch (error) {
      const duration = performance.now() - startTime;
      logger.warn(`Performance: ${label} (failed)`, { duration: Math.round(duration), error });
      throw error;
    }
  },

  /**
   * Obtient l'usage mémoire actuel
   */
  getMemoryUsage(): NodeJS.MemoryUsage {
    return process.memoryUsage();
  },

  /**
   * Log de l'usage mémoire avec un label
   */
  logMemoryUsage(label: string): void {
    const usage = this.getMemoryUsage();
    const usageMB = {
      rss: Math.round(usage.rss / 1024 / 1024 * 100) / 100,
      heapTotal: Math.round(usage.heapTotal / 1024 / 1024 * 100) / 100,
      heapUsed: Math.round(usage.heapUsed / 1024 / 1024 * 100) / 100,
      external: Math.round(usage.external / 1024 / 1024 * 100) / 100,
    };
    
    logger.debug(`Memory usage: ${label}`, usageMB);
  },
};

/**
 * Utilitaires de sécurité
 */
export const securityHelpers = {
  /**
   * Génère un token aléatoire sécurisé
   */
  generateSecureToken(length: number = 32): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    return result;
  },

  /**
   * Hash une chaîne avec un sel
   */
  hashWithSalt(input: string, salt: string): string {
    return Buffer.from(input + salt).toString('base64');
  },

  /**
   * Sanitise une chaîne pour éviter les injections
   */
  sanitizeString(input: string): string {
    return input
      .replace(/[<>\"'&]/g, '')
      .trim()
      .substring(0, 1000); // Limite la longueur
  },

  /**
   * Valide et nettoie un nom de fichier
   */
  sanitizeFilename(filename: string): string {
    return filename
      .replace(/[^a-zA-Z0-9.-]/g, '_')
      .replace(/_{2,}/g, '_')
      .substring(0, 100);
  },
};

/**
 * Export de tous les helpers dans un objet global
 */
export const helpers = {
  amount: amountHelpers,
  date: dateHelpers,
  string: stringHelpers,
  validation: validationHelpers,
  object: objectHelpers,
  async: asyncHelpers,
  performance: performanceHelpers,
  security: securityHelpers,
};