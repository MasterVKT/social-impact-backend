/**
 * Create Contribution Firebase Function
 * Social Finance Impact Platform
 */

import { https } from 'firebase-functions';
import { CallableContext } from 'firebase-functions/v1/https';
import Joi from 'joi';
import { logger } from '../utils/logger';
import { withErrorHandling } from '../utils/errors';
import { validateWithJoi } from '../utils/validation';
import { firestoreHelper } from '../utils/firestore';
import { authHelper } from '../utils/auth';
import { stripeService } from '../integrations/stripe/stripeService';
import { ContributionsAPI } from '../types/api';
import { ProjectDocument, UserDocument, ContributionDocument } from '../types/firestore';
import { helpers } from '../utils/helpers';
import { STATUS, PAYMENT_CONFIG, LIMITS, USER_PERMISSIONS } from '../utils/constants';

/**
 * Schéma de validation pour la requête
 */
const requestSchema = Joi.object({
  projectId: Joi.string().required(),
  amount: Joi.number().integer().min(LIMITS.CONTRIBUTION.MIN_AMOUNT).max(LIMITS.CONTRIBUTION.MAX_AMOUNT).required(),
  message: Joi.string().max(500).optional(),
  anonymous: Joi.boolean().default(false),
  paymentMethod: Joi.object({
    type: Joi.string().valid('card').required(),
    source: Joi.string().valid('form', 'saved').default('form'),
    savedPaymentMethodId: Joi.string().optional(),
  }).required(),
}).required();

/**
 * Valide que l'utilisateur peut contribuer au projet
 */
async function validateContributionEligibility(
  uid: string,
  projectId: string,
  amount: number
): Promise<{ user: UserDocument; project: ProjectDocument }> {
  try {
    const [user, project] = await Promise.all([
      firestoreHelper.getDocument<UserDocument>('users', uid),
      firestoreHelper.getDocument<ProjectDocument>('projects', projectId)
    ]);

    // Vérifier le statut utilisateur
    if (user.accountStatus !== STATUS.USER.ACTIVE) {
      throw new https.HttpsError('permission-denied', 'Account is not active');
    }

    // Vérifier KYC pour les contributions
    if (!user.kyc || user.kyc.status !== STATUS.KYC.APPROVED || user.kyc.level < 1) {
      throw new https.HttpsError('permission-denied', 'KYC verification level 1 required to contribute');
    }

    // Vérifier que l'utilisateur n'est pas le créateur
    if (project.creatorUid === uid) {
      throw new https.HttpsError('permission-denied', 'Project creators cannot contribute to their own projects');
    }

    // Vérifier le statut du projet
    // Accepter plusieurs formats pour compatibilité frontend/backend
    const contributableStatuses = [
      STATUS.PROJECT.ACTIVE,      // 'active'
      STATUS.PROJECT.FUNDING,     // 'funding'
      'fundingActive',            // Format camelCase du frontend
      'funding_active',           // Format snake_case alternatif
      'approved',                 // Statut approuvé alternatif
    ];
    if (!contributableStatuses.includes(project.status)) {
      throw new https.HttpsError('failed-precondition', `Project is not accepting contributions (status: ${project.status})`);
    }

    // Vérifier la deadline
    const now = new Date();
    let deadlineDate: any = project.deadline;
    if (!deadlineDate && project.timeline?.endDate) {
      deadlineDate = project.timeline.endDate;
    }
    
    if (deadlineDate) {
      const deadline = typeof deadlineDate === 'string' ? new Date(deadlineDate) : 
                       deadlineDate instanceof Date ? deadlineDate :
                       deadlineDate.toDate?.() || new Date();
      if (deadline <= now) {
        throw new https.HttpsError('failed-precondition', 'Project funding period has ended');
      }
    }

    // Vérifier que le projet n'a pas déjà atteint son objectif
    if (project.funding.raised >= project.funding.goal) {
      throw new https.HttpsError('failed-precondition', 'Project has already reached its funding goal');
    }

    // Vérifier les limites de contribution du projet (minimumContribution avec majuscule)
    const minContribution = project.funding.minimumContribution || LIMITS.CONTRIBUTION.MIN_AMOUNT;
    const maxContribution = project.funding.maximumContribution;
    
    if (amount < minContribution) {
      throw new https.HttpsError(
        'invalid-argument',
        `Minimum contribution for this project is ${minContribution / 100} EUR`
      );
    }

    if (maxContribution && amount > maxContribution) {
      throw new https.HttpsError(
        'invalid-argument',
        `Maximum contribution for this project is ${maxContribution / 100} EUR`
      );
    }

    // Vérifier les limites journalières utilisateur
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayContributions = await firestoreHelper.queryDocuments<ContributionDocument>(
      `users/${uid}/contributions`,
      [
        ['createdAt', '>=', todayStart],
        ['status', 'in', ['pending', 'confirmed']]
      ]
    );

    const todayTotal = todayContributions.data.reduce((sum, c) => sum + c.amount.gross, 0);
    const dailyLimit = LIMITS.CONTRIBUTION.MAX_AMOUNT * 5;
    if (todayTotal + amount > dailyLimit) {
      throw new https.HttpsError(
        'permission-denied',
        `Daily contribution limit exceeded. Remaining: ${(dailyLimit - todayTotal) / 100} EUR`
      );
    }

    // Vérifier les limites mensuelles utilisateur
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthlyContributions = await firestoreHelper.queryDocuments<ContributionDocument>(
      `users/${uid}/contributions`,
      [
        ['createdAt', '>=', monthStart],
        ['status', 'in', ['pending', 'confirmed']]
      ]
    );

    const monthlyTotal = monthlyContributions.data.reduce((sum, c) => sum + c.amount.gross, 0);
    const monthlyLimit = user.kyc.level >= 2 ? 
      LIMITS.KYC.ENHANCED_MAX_CONTRIBUTION : 
      LIMITS.KYC.BASIC_MAX_CONTRIBUTION;

    if (monthlyTotal + amount > monthlyLimit) {
      throw new https.HttpsError(
        'permission-denied',
        `Monthly contribution limit exceeded. Remaining: ${(monthlyLimit - monthlyTotal) / 100} EUR`
      );
    }

    return { user, project };

  } catch (error) {
    if (error instanceof https.HttpsError) {
      throw error;
    }
    logger.error('Failed to validate contribution eligibility', error, { uid, projectId, amount });
    throw new https.HttpsError('internal', 'Unable to validate contribution eligibility');
  }
}

/**
 * Calcule les frais de transaction
 */
function calculateTransactionFees(amount: number): {
  platformFee: number;
  stripeFee: number;
  totalFees: number;
  netAmount: number;
} {
  // Frais plateforme (pourcentage fixe)
  const platformFee = Math.round(amount * (PAYMENT_CONFIG.PLATFORM_FEE_PERCENTAGE / 100));
  
  // Frais Stripe (pourcentage + fixe)
  const stripeFee = Math.round(amount * (PAYMENT_CONFIG.STRIPE_FEE_PERCENTAGE / 100)) + PAYMENT_CONFIG.STRIPE_FEE_FIXED;
  
  const totalFees = platformFee + stripeFee;
  const netAmount = amount - totalFees;

  return {
    platformFee,
    stripeFee,
    totalFees,
    netAmount,
  };
}

/**
 * Prépare les métadonnées pour Stripe
 */
function prepareStripeMetadata(
  contributionId: string,
  projectId: string,
  uid: string,
  project: ProjectDocument,
  user: UserDocument
): Record<string, string> {
  return {
    contributionId,
    projectId,
    projectTitle: project.title,
    contributorUid: uid,
    contributorName: `${user.firstName} ${user.lastName}`,
    contributorEmail: user.email,
    platform: 'social-impact',
    environment: process.env.NODE_ENV || 'development',
    category: project.category,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Crée le PaymentIntent Stripe
 */
async function createStripePaymentIntent(
  amount: number,
  contributionId: string,
  project: ProjectDocument,
  user: UserDocument,
  paymentMethodData: any
): Promise<any> {
  try {
    const fees = calculateTransactionFees(amount);
    const projectId = project.id || project.uid;
    const metadata = prepareStripeMetadata(contributionId, projectId, user.uid, project, user);

    const paymentIntentData: any = {
      amount,
      currency: project.funding.currency.toLowerCase(),
      metadata,
      description: `Contribution to ${project.title}`,
      receipt_email: user.email,
      
      // Configuration des frais d'application
      application_fee_amount: fees.platformFee,
      
      // Configuration pour escrow (Connect account si nécessaire)
      transfer_data: {
        destination: (project as any).stripeConnectAccountId || process.env.STRIPE_ESCROW_ACCOUNT_ID,
      },
      
      // Configuration automatique de confirmation
      automatic_payment_methods: {
        enabled: true,
      },
    };

    // Ajouter la méthode de paiement si sauvegardée
    if (paymentMethodData.source === 'saved' && paymentMethodData.savedPaymentMethodId) {
      paymentIntentData.payment_method = paymentMethodData.savedPaymentMethodId;
      if ((user as any).stripeCustomerId) {
        paymentIntentData.customer = (user as any).stripeCustomerId;
      }
      paymentIntentData.confirm = true; // Auto-confirmer avec méthode sauvegardée
    }

    const paymentIntent = await stripeService.createPaymentIntent(paymentIntentData);

    logger.info('Stripe PaymentIntent created', {
      paymentIntentId: paymentIntent.id,
      contributionId,
      amount,
      fees,
      projectId: project.uid,
      contributorUid: user.uid,
    });

    return paymentIntent;

  } catch (error) {
    logger.error('Failed to create Stripe PaymentIntent', error, {
      contributionId,
      amount,
      projectId: project.uid,
      contributorUid: user.uid,
    });
    throw new https.HttpsError('internal', 'Unable to process payment. Please try again.');
  }
}

/**
 * Crée la contribution en base de données
 */
async function createContributionDocument(
  contributionId: string,
  data: ContributionsAPI.CreateContributionRequest,
  paymentIntent: any,
  fees: any,
  user: UserDocument,
  project: ProjectDocument,
  context: CallableContext
): Promise<Partial<ContributionDocument>> {
  const now = new Date();
  const { Timestamp } = await import('firebase-admin/firestore');
  
  const contributionData: Partial<ContributionDocument> = {
    // Identifiants
    id: contributionId,
    contributorUid: user.uid,
    projectId: data.projectId,
    
    // Informations contributeur (filtrées si anonyme)
    contributor: {
      uid: user.uid,
      displayName: data.anonymous ? 'Anonyme' : user.displayName,
      profilePicture: data.anonymous ? undefined : user.profilePicture,
      isAnonymous: data.anonymous,
    },
    
    // Montants et frais
    amount: {
      gross: data.amount,
      fees: {
        platform: fees.platformFee,
        stripe: fees.stripeFee,
        total: fees.totalFees,
      },
      net: fees.netAmount,
      currency: project.funding.currency,
    },
    
    // Statut et paiement - payment.status est le statut, pas le top-level status
    payment: {
      status: 'pending',
      provider: 'stripe',
      paymentIntentId: paymentIntent.id,
      initiatedAt: Timestamp.fromDate(now),
    },
    
    // Escrow et planification de libération
    escrow: {
      status: 'held',
      heldAmount: fees.netAmount,
      releasedAmount: 0,
      releases: [],
    },
    
    // Message et preferences
    message: data.message?.trim(),
    preferences: {
      anonymous: data.anonymous,
      receiveUpdates: true,
      allowContact: !data.anonymous,
    },
    
    // Source et attribution
    source: {
      device: 'desktop',
      userAgent: context.rawRequest.headers['user-agent'] as string,
    },
    
    // Métadonnées
    ipAddress: context.rawRequest.ip,
    verified: false,
    createdAt: Timestamp.fromDate(now),
    updatedAt: Timestamp.fromDate(now),
    version: 1,
  };

  return contributionData;
}

/**
 * Met à jour les statistiques du projet
 */
async function updateProjectFundingStats(
  projectId: string,
  contributionAmount: number
): Promise<void> {
  try {
    const { Timestamp } = await import('firebase-admin/firestore');
    await firestoreHelper.runTransaction(async (transaction) => {
      const projectRef = firestoreHelper.getDocumentRef('projects', projectId);
      const projectDoc = await transaction.get(projectRef);
      
      if (!projectDoc.exists) {
        throw new Error('Project not found in transaction');
      }

      const projectData = projectDoc.data()!;
      const newRaised = projectData.funding.raised + contributionAmount;
      const newPercentage = Math.round((newRaised / projectData.funding.goal) * 100);
      const newContributorsCount = projectData.funding.contributorsCount + 1;

      // Déterminer le nouveau statut si l'objectif est atteint
      let newStatus = projectData.status;
      if (newPercentage >= 100 && projectData.status === STATUS.PROJECT.ACTIVE) {
        newStatus = STATUS.PROJECT.FUNDING; // Passer en mode financement complet
      }

      transaction.update(projectRef, {
        'funding.raised': newRaised,
        'funding.percentage': newPercentage,
        'funding.contributorsCount': newContributorsCount,
        status: newStatus,
        updatedAt: Timestamp.now(),
        version: projectData.version + 1,
      });
    });

    logger.info('Project funding stats updated', {
      projectId,
      contributionAmount,
    });

  } catch (error) {
    logger.error('Failed to update project funding stats', error, { projectId, contributionAmount });
    // Ne pas faire échouer la création de contribution pour les stats
  }
}

/**
 * Met à jour les statistiques utilisateur
 */
async function updateUserContributionStats(
  uid: string,
  contributionAmount: number
): Promise<void> {
  try {
    const { Timestamp } = await import('firebase-admin/firestore');
    const db = require('firebase-admin').firestore();
    const userRef = db.collection('users').doc(uid);
    
    await db.runTransaction(async (transaction: any) => {
      const userDoc = await transaction.get(userRef);
      if (userDoc.exists) {
        const stats = userDoc.data().stats || {};
        transaction.update(userRef, {
          'stats.totalContributed': (stats.totalContributed || 0) + contributionAmount,
          'stats.contributionsCount': (stats.contributionsCount || 0) + 1,
          'stats.lastContributionAt': Timestamp.now(),
        });
      }
    });

    logger.info('User contribution stats updated', {
      uid,
      contributionAmount,
    });

  } catch (error) {
    logger.error('Failed to update user contribution stats', error, { uid, contributionAmount });
    // Ne pas faire échouer la création pour les stats
  }
}

/**
 * Exécute la création de contribution
 */
async function executeCreateContribution(
  data: ContributionsAPI.CreateContributionRequest,
  context: CallableContext
): Promise<ContributionsAPI.CreateContributionResponse> {
  const { Timestamp } = await import('firebase-admin/firestore');
  const uid = context.auth!.uid;
  
  // Validation de l'éligibilité
  const { user, project } = await validateContributionEligibility(uid, data.projectId, data.amount);
  
  // Générer un ID unique pour la contribution
  const contributionId = helpers.string.generateId('contrib');
  
  // Calculer les frais
  const fees = calculateTransactionFees(data.amount);
  
  // Créer le PaymentIntent Stripe
  const paymentIntent = await createStripePaymentIntent(
    data.amount,
    contributionId,
    project,
    user,
    data.paymentMethod
  );
  
  // Préparer les données de contribution
  const contributionData = await createContributionDocument(
    contributionId,
    data,
    paymentIntent,
    fees,
    user,
    project,
    context
  );

  // Transaction pour créer la contribution
  await firestoreHelper.runTransaction(async (transaction) => {
    // Créer la contribution dans le projet
    const contributionRef = firestoreHelper.getDocumentRef(
      `projects/${data.projectId}/contributions`,
      contributionId
    );
    transaction.set(contributionRef, contributionData);
    
    // Créer une référence dans le profil utilisateur
    const userContributionRef = firestoreHelper.getDocumentRef(
      `users/${uid}/contributions`,
      contributionId
    );
    transaction.set(userContributionRef, {
      contributionId,
      projectId: data.projectId,
      projectTitle: project.title,
      amount: data.amount,
      status: 'pending',
      createdAt: Timestamp.now(),
    });
  });

  // Mettre à jour les statistiques en parallèle
  await Promise.all([
    updateProjectFundingStats(data.projectId, data.amount),
    updateUserContributionStats(uid, data.amount),
  ]);

  // Log business
  logger.business('Contribution created', 'contributions', {
    contributionId,
    projectId: data.projectId,
    contributorUid: uid,
    amount: data.amount,
    fees,
    anonymous: data.anonymous,
    paymentIntentId: paymentIntent.id,
    paymentMethod: data.paymentMethod.type,
    projectTitle: project.title,
    projectCategory: project.category,
  });

  // Log financial pour audit
  logger.business('Contribution payment initiated', 'finance', {
    contributionId,
    paymentIntentId: paymentIntent.id,
    grossAmount: data.amount,
    netAmount: fees.netAmount,
    platformFee: fees.platformFee,
    stripeFee: fees.stripeFee,
    currency: project.funding.currency,
    projectId: data.projectId,
    contributorUid: uid,
  });

  // Convertir deadline en ISO string
  let deadlineISO: string;
  let deadlineDate: any = project.deadline;
  if (!deadlineDate && project.timeline?.endDate) {
    deadlineDate = project.timeline.endDate;
  }
  
  let actualDeadlineDate = deadlineDate;
  if (!actualDeadlineDate) {
    actualDeadlineDate = new Date(new Date().getTime() + 30 * 24 * 60 * 60 * 1000); // Default 30 days
  }
  
  if (typeof actualDeadlineDate === 'string') {
    deadlineISO = actualDeadlineDate;
  } else if (actualDeadlineDate instanceof Date) {
    deadlineISO = actualDeadlineDate.toISOString();
  } else if (actualDeadlineDate && 'toDate' in actualDeadlineDate) {
    // Timestamp Firestore
    deadlineISO = (actualDeadlineDate as any).toDate().toISOString();
  } else {
    deadlineISO = new Date().toISOString();
  }

  return {
    contributionId,
    paymentIntent: {
      id: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      amount: data.amount,
      currency: project.funding.currency,
    },
    fees: {
      platformFee: fees.platformFee,
      stripeFee: fees.stripeFee,
      total: fees.totalFees,
    },
    escrow: {
      holdUntil: deadlineISO,
      releaseConditions: ['milestone_validations'],
    },
  };
}

/**
 * Firebase Function principale
 */
export const createContribution = https.onCall(
  withErrorHandling(async (data: unknown, context: CallableContext): Promise<ContributionsAPI.CreateContributionResponse> => {
    // Authentification requise
    if (!context.auth) {
      throw new https.HttpsError('unauthenticated', 'Authentication required');
    }

    // Validation des données
    const validatedData = validateWithJoi<ContributionsAPI.CreateContributionRequest>(requestSchema, data);

    // Logging de démarrage
    logger.info('Creating contribution', {
      functionName: 'createContribution',
      uid: context.auth.uid,
      projectId: validatedData.projectId,
      amount: validatedData.amount,
      anonymous: validatedData.anonymous,
      paymentMethod: validatedData.paymentMethod.type,
    });

    // Exécution
    const result = await executeCreateContribution(validatedData, context);

    // Logging de succès
    logger.info('Contribution created successfully', {
      functionName: 'createContribution',
      uid: context.auth.uid,
      contributionId: result.contributionId,
      paymentIntentId: result.paymentIntent.id,
      amount: result.paymentIntent.amount,
      platformFee: result.fees.platformFee,
      success: true,
    });

    return result;
  })
);