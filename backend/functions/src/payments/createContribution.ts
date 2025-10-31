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
import { STATUS, PAYMENT_CONFIG, PROJECT_CONFIG, USER_PERMISSIONS } from '../utils/constants';

/**
 * Schéma de validation pour la requête
 */
const requestSchema = Joi.object({
  projectId: Joi.string().required(),
  amount: Joi.number().integer().min(PAYMENT_CONFIG.MIN_CONTRIBUTION_AMOUNT).max(PAYMENT_CONFIG.MAX_CONTRIBUTION_AMOUNT).required(),
  message: Joi.string().max(500).optional(),
  anonymous: Joi.boolean().default(false),
  paymentMethod: Joi.object({
    type: Joi.string().valid('card').required(),
    source: Joi.string().valid('form', 'saved').default('form'),
    savedPaymentMethodId: Joi.string().when('source', { is: 'saved', then: Joi.required() }),
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
    const contributableStatuses = [STATUS.PROJECT.ACTIVE, STATUS.PROJECT.FUNDING];
    if (!contributableStatuses.includes(project.status)) {
      throw new https.HttpsError('failed-precondition', `Project is not accepting contributions (status: ${project.status})`);
    }

    // Vérifier la deadline
    const now = new Date();
    const deadline = new Date(project.funding.deadline);
    if (deadline <= now) {
      throw new https.HttpsError('failed-precondition', 'Project funding period has ended');
    }

    // Vérifier que le projet n'a pas déjà atteint son objectif
    if (project.funding.raised >= project.funding.goal) {
      throw new https.HttpsError('failed-precondition', 'Project has already reached its funding goal');
    }

    // Vérifier les limites de contribution du projet
    if (amount < project.funding.minContribution) {
      throw new https.HttpsError(
        'invalid-argument',
        `Minimum contribution for this project is ${project.funding.minContribution / 100} EUR`
      );
    }

    if (project.funding.maxContribution && amount > project.funding.maxContribution) {
      throw new https.HttpsError(
        'invalid-argument',
        `Maximum contribution for this project is ${project.funding.maxContribution / 100} EUR`
      );
    }

    // Vérifier les limites journalières utilisateur
    const todayStart = helpers.date.startOfDay(new Date());
    const todayContributions = await firestoreHelper.queryDocuments<ContributionDocument>(
      `users/${uid}/contributions`,
      [
        ['createdAt', '>=', todayStart],
        ['status', 'in', ['pending', 'confirmed']]
      ]
    );

    const todayTotal = todayContributions.reduce((sum, c) => sum + c.amount.gross, 0);
    if (todayTotal + amount > PAYMENT_CONFIG.MAX_DAILY_CONTRIBUTION_AMOUNT) {
      throw new https.HttpsError(
        'permission-denied',
        `Daily contribution limit exceeded. Remaining: ${(PAYMENT_CONFIG.MAX_DAILY_CONTRIBUTION_AMOUNT - todayTotal) / 100} EUR`
      );
    }

    // Vérifier les limites mensuelles utilisateur
    const monthStart = helpers.date.startOfMonth(new Date());
    const monthlyContributions = await firestoreHelper.queryDocuments<ContributionDocument>(
      `users/${uid}/contributions`,
      [
        ['createdAt', '>=', monthStart],
        ['status', 'in', ['pending', 'confirmed']]
      ]
    );

    const monthlyTotal = monthlyContributions.reduce((sum, c) => sum + c.amount.gross, 0);
    const monthlyLimit = user.kyc.level >= 2 ? 
      PAYMENT_CONFIG.MAX_MONTHLY_CONTRIBUTION_ENHANCED : 
      PAYMENT_CONFIG.MAX_MONTHLY_CONTRIBUTION_BASIC;

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
  const platformFee = Math.round(amount * PAYMENT_CONFIG.PLATFORM_FEE_RATE);
  
  // Frais Stripe (pourcentage + fixe)
  const stripeFee = Math.round(amount * PAYMENT_CONFIG.STRIPE_FEE_RATE) + PAYMENT_CONFIG.STRIPE_FIXED_FEE;
  
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
    const metadata = prepareStripeMetadata(contributionId, project.uid, user.uid, project, user);

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
        destination: project.stripeConnectAccountId || process.env.STRIPE_ESCROW_ACCOUNT_ID,
      },
      
      // Configuration automatique de confirmation
      automatic_payment_methods: {
        enabled: true,
      },
    };

    // Ajouter la méthode de paiement si sauvegardée
    if (paymentMethodData.source === 'saved' && paymentMethodData.savedPaymentMethodId) {
      paymentIntentData.payment_method = paymentMethodData.savedPaymentMethodId;
      paymentIntentData.customer = user.stripeCustomerId;
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
): Promise<ContributionDocument> {
  const now = new Date();
  
  const contributionData: ContributionDocument = {
    // Identifiants
    id: contributionId,
    uid: contributionId,
    contributorUid: user.uid,
    projectId: data.projectId,
    
    // Informations contributeur (filtrées si anonyme)
    contributorName: data.anonymous ? 'Contributeur anonyme' : `${user.firstName} ${user.lastName}`,
    contributorEmail: data.anonymous ? '' : user.email,
    contributorDisplayName: data.anonymous ? 'Anonyme' : user.displayName,
    anonymous: data.anonymous,
    
    // Montants et frais
    amount: {
      gross: data.amount,
      net: fees.netAmount,
      currency: project.funding.currency,
      platformFee: fees.platformFee,
      stripeFee: fees.stripeFee,
      totalFees: fees.totalFees,
    },
    
    // Message et preferences
    message: data.message?.trim() || '',
    
    // Statut et paiement
    status: 'pending',
    payment: {
      paymentIntentId: paymentIntent.id,
      paymentMethod: data.paymentMethod.type,
      processorStatus: paymentIntent.status,
      clientSecret: paymentIntent.client_secret,
    },
    
    // Escrow et planification de libération
    escrow: {
      held: true,
      heldAmount: fees.netAmount,
      releaseSchedule: project.milestones.map(milestone => ({
        milestoneId: milestone.id,
        amount: Math.round(fees.netAmount * milestone.fundingPercentage / 100),
        releaseCondition: 'milestone_completion',
        released: false,
      })),
      expectedReleaseDate: project.funding.deadline,
    },
    
    // Permissions et notifications
    notificationsEnabled: true,
    receiptGenerated: false,
    
    // Métadonnées
    ipAddress: context.rawRequest.ip,
    userAgent: context.rawRequest.headers['user-agent'] as string,
    createdAt: now,
    updatedAt: now,
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
        'stats.lastContributionAt': new Date(),
        status: newStatus,
        updatedAt: new Date(),
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
    await firestoreHelper.incrementDocument('users', uid, {
      'stats.totalContributed': contributionAmount,
      'stats.contributionsCount': 1,
      'stats.lastContributionAt': new Date(),
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
      createdAt: new Date(),
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
  logger.financial('Contribution payment initiated', {
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
      totalFees: fees.totalFees,
    },
    escrow: {
      holdUntil: project.funding.deadline.toISOString(),
      releaseConditions: ['milestone_validations'],
    },
    success: true,
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