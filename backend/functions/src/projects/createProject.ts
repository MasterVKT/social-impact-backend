/**
 * Create Project Firebase Function
 * Social Finance Impact Platform
 */

import { https } from 'firebase-functions';
import { CallableContext } from 'firebase-functions/v1/https';
import Joi from 'joi';
import { logger } from '../utils/logger';
import { withErrorHandling } from '../utils/errors';
import { validateWithJoi, commonSchemas } from '../utils/validation';
import { firestoreHelper } from '../utils/firestore';
import { authHelper } from '../utils/auth';
import { ProjectsAPI } from '../types/api';
import { ProjectDocument, UserDocument } from '../types/firestore';
import { helpers } from '../utils/helpers';
import { STATUS, PROJECT_CONFIG, USER_PERMISSIONS } from '../utils/constants';

/**
 * Schéma de validation pour la requête
 */
const requestSchema = Joi.object({
  title: Joi.string().min(3).max(100).required(),
  description: Joi.string().min(10).max(2000).required(),
  shortDescription: Joi.string().min(10).max(200).required(),
  category: Joi.string().valid('environment', 'education', 'health', 'community', 'innovation').required(),
  tags: Joi.array().items(Joi.string().max(30)).min(1).max(10).required(),
  
  // Objectifs et impact
  impactGoals: Joi.object({
    primary: Joi.string().min(10).max(500).required(),
    secondary: Joi.array().items(Joi.string().max(200)).max(5).optional(),
    metrics: Joi.array().items(
      Joi.object({
        name: Joi.string().max(50).required(),
        target: Joi.number().positive().required(),
        unit: Joi.string().max(20).required(),
        description: Joi.string().max(200).optional(),
      })
    ).min(1).max(10).required(),
  }).required(),

  // Financement
  funding: Joi.object({
    goal: Joi.number().min(PROJECT_CONFIG.MIN_FUNDING_GOAL).max(PROJECT_CONFIG.MAX_FUNDING_GOAL).required(),
    currency: commonSchemas.currency.required(),
    deadline: Joi.date().min('now').max(helpers.date.addMonths(new Date(), PROJECT_CONFIG.MAX_DURATION_MONTHS)).required(),
    minContribution: Joi.number().min(PROJECT_CONFIG.MIN_CONTRIBUTION).max(1000000).optional(),
  }).required(),

  // Milestones
  milestones: Joi.array().items(
    Joi.object({
      title: Joi.string().min(3).max(100).required(),
      description: Joi.string().min(10).max(500).required(),
      targetDate: Joi.date().min('now').required(),
      fundingPercentage: Joi.number().min(0).max(100).required(),
      deliverables: Joi.array().items(Joi.string().max(200)).min(1).max(10).required(),
    })
  ).min(1).max(10).required(),

  // Médias
  media: Joi.object({
    coverImage: Joi.string().uri().required(),
    gallery: Joi.array().items(Joi.string().uri()).max(20).optional(),
    video: Joi.string().uri().optional(),
    documents: Joi.array().items(
      Joi.object({
        name: Joi.string().max(100).required(),
        url: Joi.string().uri().required(),
        type: Joi.string().valid('pdf', 'doc', 'image', 'other').required(),
        size: Joi.number().max(10485760).optional(), // 10MB max
      })
    ).max(10).optional(),
  }).required(),

  // Localisation
  location: Joi.object({
    country: commonSchemas.countryCode.required(),
    region: Joi.string().max(50).optional(),
    city: Joi.string().max(50).optional(),
    coordinates: Joi.object({
      lat: Joi.number().min(-90).max(90).required(),
      lng: Joi.number().min(-180).max(180).required(),
    }).optional(),
  }).required(),

  // Équipe
  team: Joi.array().items(
    Joi.object({
      name: Joi.string().min(2).max(100).required(),
      role: Joi.string().min(2).max(50).required(),
      bio: Joi.string().max(300).optional(),
      avatar: Joi.string().uri().optional(),
      linkedin: Joi.string().uri().optional(),
    })
  ).min(1).max(10).required(),

  // Paramètres avancés
  settings: Joi.object({
    allowPublicComments: Joi.boolean().default(true),
    requireIdentityVerification: Joi.boolean().default(false),
    autoApproveContributions: Joi.boolean().default(true),
    notifyOnMilestone: Joi.boolean().default(true),
    visibility: Joi.string().valid('public', 'private').default('public'),
  }).optional(),
}).required();

/**
 * Valide que l'utilisateur peut créer un projet
 */
async function validateUserCanCreateProject(uid: string): Promise<UserDocument> {
  try {
    const user = await firestoreHelper.getDocument<UserDocument>('users', uid);
    
    // Vérifier le profil complet
    if (!user.profileComplete) {
      throw new https.HttpsError('failed-precondition', 'Profile must be completed first');
    }

    // Vérifier le statut du compte
    if (user.accountStatus !== STATUS.USER.ACTIVE) {
      throw new https.HttpsError('failed-precondition', 'Account is not active');
    }

    // Vérifier les permissions
    if (!user.permissions.includes(USER_PERMISSIONS.CREATE_PROJECT)) {
      throw new https.HttpsError('permission-denied', 'User does not have permission to create projects');
    }

    // Vérifier le KYC pour les projets importants
    if (user.kyc.status !== STATUS.KYC.APPROVED) {
      throw new https.HttpsError('failed-precondition', 'KYC verification required to create projects');
    }

    // Vérifier les limites de projets actifs
    const activeProjectsCount = await firestoreHelper.countDocuments('projects', [
      ['creatorUid', '==', uid],
      ['status', 'in', [STATUS.PROJECT.ACTIVE, STATUS.PROJECT.FUNDING]]
    ]);

    const maxActiveProjects = user.kyc.level >= PROJECT_CONFIG.ENHANCED_KYC_LEVEL ? 
      PROJECT_CONFIG.MAX_ACTIVE_PROJECTS_ENHANCED : 
      PROJECT_CONFIG.MAX_ACTIVE_PROJECTS_BASIC;

    if (activeProjectsCount >= maxActiveProjects) {
      throw new https.HttpsError(
        'resource-exhausted',
        `Maximum number of active projects reached (${maxActiveProjects})`
      );
    }

    return user;

  } catch (error) {
    if (error instanceof https.HttpsError) {
      throw error;
    }
    logger.error('Failed to validate user for project creation', error, { uid });
    throw new https.HttpsError('internal', 'Unable to validate user');
  }
}

/**
 * Valide les données du projet
 */
function validateProjectData(data: ProjectsAPI.CreateProjectRequest): void {
  // Validation des milestones
  const totalPercentage = data.milestones.reduce((sum, milestone) => sum + milestone.fundingPercentage, 0);
  if (Math.abs(totalPercentage - 100) > 0.01) {
    throw new https.HttpsError('invalid-argument', 'Milestone funding percentages must sum to 100%');
  }

  // Validation des dates de milestones
  const sortedMilestones = [...data.milestones].sort((a, b) => 
    new Date(a.targetDate).getTime() - new Date(b.targetDate).getTime()
  );
  
  for (let i = 0; i < sortedMilestones.length; i++) {
    const milestone = sortedMilestones[i];
    const milestoneDate = new Date(milestone.targetDate);
    const fundingDeadline = new Date(data.funding.deadline);
    
    if (milestoneDate > fundingDeadline) {
      throw new https.HttpsError(
        'invalid-argument',
        `Milestone "${milestone.title}" target date cannot be after funding deadline`
      );
    }
  }

  // Validation de l'équipe - au moins le créateur
  if (data.team.length === 0) {
    throw new https.HttpsError('invalid-argument', 'At least one team member is required');
  }

  // Validation des métriques d'impact
  const metricNames = data.impactGoals.metrics.map(m => m.name.toLowerCase());
  const uniqueMetricNames = new Set(metricNames);
  if (metricNames.length !== uniqueMetricNames.size) {
    throw new https.HttpsError('invalid-argument', 'Impact metric names must be unique');
  }
}

/**
 * Génère un slug unique pour le projet
 */
async function generateProjectSlug(title: string, creatorUid: string): Promise<string> {
  const baseSlug = helpers.string.createSlug(title);
  let finalSlug = baseSlug;
  let counter = 1;

  // Vérifier l'unicité du slug
  while (counter <= 10) {
    const existing = await firestoreHelper.getDocumentByField(
      'projects',
      'slug',
      finalSlug
    );

    if (!existing) {
      break;
    }

    finalSlug = `${baseSlug}-${counter}`;
    counter++;
  }

  if (counter > 10) {
    // Fallback avec timestamp
    finalSlug = `${baseSlug}-${Date.now()}`;
  }

  return finalSlug;
}

/**
 * Crée le document projet
 */
async function createProjectDocument(
  data: ProjectsAPI.CreateProjectRequest,
  creator: UserDocument,
  context: CallableContext
): Promise<ProjectDocument> {
  const now = new Date();
  const projectId = helpers.string.generateId('proj');
  const slug = await generateProjectSlug(data.title, creator.uid);

  // Calculer les dates importantes
  const fundingDeadline = new Date(data.funding.deadline);
  const estimatedDuration = helpers.date.differenceInDays(fundingDeadline, now);

  // Préparer les milestones avec IDs
  const milestonesWithIds = data.milestones.map((milestone, index) => ({
    id: helpers.string.generateId('milestone'),
    order: index + 1,
    title: milestone.title,
    description: milestone.description,
    targetDate: new Date(milestone.targetDate),
    fundingPercentage: milestone.fundingPercentage,
    deliverables: milestone.deliverables,
    status: STATUS.MILESTONE.PENDING,
    completedAt: undefined,
    evidence: [],
    auditRequired: milestone.fundingPercentage >= PROJECT_CONFIG.AUDIT_THRESHOLD_PERCENTAGE,
    auditStatus: undefined,
    auditAssignedTo: undefined,
  }));

  // Calculer les métriques de financement
  const platformFeeRate = PROJECT_CONFIG.PLATFORM_FEE_RATE;
  const estimatedPlatformFees = Math.round(data.funding.goal * platformFeeRate);
  const netGoal = data.funding.goal - estimatedPlatformFees;

  const projectDocument: Omit<ProjectDocument, 'id'> = {
    // Identité et métadonnées
    uid: projectId,
    slug,
    title: data.title.trim(),
    description: data.description.trim(),
    shortDescription: data.shortDescription.trim(),
    category: data.category,
    tags: data.tags.map(tag => tag.trim().toLowerCase()),
    
    // Créateur
    creatorUid: creator.uid,
    creatorDisplayName: creator.displayName,
    creatorAvatar: creator.profilePicture,
    
    // Status et dates
    status: STATUS.PROJECT.DRAFT,
    visibility: data.settings?.visibility || 'public',
    publishedAt: undefined,
    fundingStartsAt: undefined,
    fundingEndsAt: fundingDeadline,
    completedAt: undefined,
    
    // Financement
    funding: {
      goal: data.funding.goal,
      raised: 0,
      currency: data.funding.currency,
      contributorsCount: 0,
      percentage: 0,
      deadline: fundingDeadline,
      minContribution: data.funding.minContribution || PROJECT_CONFIG.MIN_CONTRIBUTION,
      platformFees: {
        estimated: estimatedPlatformFees,
        actual: 0,
        rate: platformFeeRate,
      },
      stripeFees: {
        estimated: 0,
        actual: 0,
      },
      netGoal,
      netRaised: 0,
    },

    // Impact et objectifs
    impactGoals: {
      primary: data.impactGoals.primary.trim(),
      secondary: data.impactGoals.secondary?.map(goal => goal.trim()) || [],
      metrics: data.impactGoals.metrics.map(metric => ({
        id: helpers.string.generateId('metric'),
        name: metric.name.trim(),
        target: metric.target,
        unit: metric.unit.trim(),
        description: metric.description?.trim(),
        current: 0,
        percentage: 0,
        lastUpdatedAt: undefined,
      })),
    },

    // Milestones
    milestones: milestonesWithIds,
    currentMilestoneIndex: 0,
    
    // Équipe
    team: data.team.map((member, index) => ({
      id: helpers.string.generateId('team'),
      name: member.name.trim(),
      role: member.role.trim(),
      bio: member.bio?.trim(),
      avatar: member.avatar,
      linkedin: member.linkedin,
      isLead: index === 0, // Premier membre = lead
      joinedAt: now,
    })),

    // Médias
    media: {
      coverImage: data.media.coverImage,
      gallery: data.media.gallery || [],
      video: data.media.video,
      documents: data.media.documents?.map(doc => ({
        id: helpers.string.generateId('doc'),
        name: doc.name.trim(),
        url: doc.url,
        type: doc.type,
        size: doc.size,
        uploadedAt: now,
      })) || [],
    },

    // Localisation
    location: {
      country: data.location.country,
      region: data.location.region?.trim(),
      city: data.location.city?.trim(),
      coordinates: data.location.coordinates,
    },

    // Paramètres
    settings: {
      allowPublicComments: data.settings?.allowPublicComments ?? true,
      requireIdentityVerification: data.settings?.requireIdentityVerification ?? false,
      autoApproveContributions: data.settings?.autoApproveContributions ?? true,
      notifyOnMilestone: data.settings?.notifyOnMilestone ?? true,
    },

    // Statistiques initiales
    stats: {
      views: 0,
      likes: 0,
      shares: 0,
      comments: 0,
      updates: 0,
      avgRating: 0,
      ratingCount: 0,
    },

    // Audit et conformité
    auditRequired: data.funding.goal >= PROJECT_CONFIG.AUDIT_THRESHOLD_AMOUNT,
    auditStatus: data.funding.goal >= PROJECT_CONFIG.AUDIT_THRESHOLD_AMOUNT ? STATUS.AUDIT.PENDING : undefined,
    complianceChecks: {
      contentModeration: STATUS.MODERATION.PENDING,
      legalReview: data.funding.goal >= PROJECT_CONFIG.LEGAL_REVIEW_THRESHOLD ? STATUS.MODERATION.PENDING : STATUS.MODERATION.APPROVED,
      financialReview: STATUS.MODERATION.PENDING,
    },

    // Métadonnées système
    estimatedDuration,
    riskLevel: calculateProjectRiskLevel(data),
    lastModifiedBy: creator.uid,
    ipAddress: undefined, // Sera ajouté par le contexte
    userAgent: undefined, // Sera ajouté par le contexte
    
    // Champs BaseDocument
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  return projectDocument as ProjectDocument;
}

/**
 * Calcule le niveau de risque du projet
 */
function calculateProjectRiskLevel(data: ProjectsAPI.CreateProjectRequest): 'low' | 'medium' | 'high' {
  let riskScore = 0;

  // Facteurs de risque basés sur le montant
  if (data.funding.goal > 50000) riskScore += 2;
  else if (data.funding.goal > 10000) riskScore += 1;

  // Facteurs de risque basés sur la durée
  const durationMonths = helpers.date.differenceInMonths(new Date(data.funding.deadline), new Date());
  if (durationMonths > 12) riskScore += 2;
  else if (durationMonths > 6) riskScore += 1;

  // Facteurs de risque basés sur la complexité
  if (data.milestones.length > 5) riskScore += 1;
  if (data.impactGoals.metrics.length > 5) riskScore += 1;

  // Facteurs de risque basés sur l'équipe
  if (data.team.length === 1) riskScore += 1;

  if (riskScore >= 5) return 'high';
  if (riskScore >= 3) return 'medium';
  return 'low';
}

/**
 * Met à jour les statistiques du créateur
 */
async function updateCreatorStats(creatorUid: string): Promise<void> {
  try {
    await firestoreHelper.runTransaction(async (transaction) => {
      const userRef = firestoreHelper.getDocumentRef('users', creatorUid);
      const userDoc = await transaction.get(userRef);
      
      if (!userDoc.exists) {
        throw new Error('Creator not found');
      }

      const currentStats = userDoc.data()?.stats || {};
      
      transaction.update(userRef, {
        'stats.projectsCreated': (currentStats.projectsCreated || 0) + 1,
        'stats.lastProjectAt': new Date(),
        updatedAt: new Date(),
      });
    });

    logger.info('Creator stats updated', { creatorUid });

  } catch (error) {
    logger.error('Failed to update creator stats', error, { creatorUid });
    // Ne pas faire échouer la création pour les stats
  }
}

/**
 * Envoie les notifications de création de projet
 */
async function notifyProjectCreation(
  project: ProjectDocument,
  creator: UserDocument
): Promise<void> {
  try {
    // Notification au créateur
    logger.info('Project creation notifications would be sent', {
      projectId: project.uid,
      creatorUid: creator.uid,
      category: project.category,
      fundingGoal: project.funding.goal
    });

    // TODO: Implémenter les notifications push et email
    // - Email de confirmation au créateur
    // - Notification aux admins pour review si montant élevé

  } catch (error) {
    logger.error('Failed to send project creation notifications', error, {
      projectId: project.uid,
      creatorUid: creator.uid
    });
    // Ne pas faire échouer la création pour les notifications
  }
}

/**
 * Exécute la création du projet
 */
async function executeCreateProject(
  data: ProjectsAPI.CreateProjectRequest,
  context: CallableContext
): Promise<ProjectsAPI.CreateProjectResponse> {
  const uid = context.auth!.uid;
  
  // Validation de l'utilisateur
  const creator = await validateUserCanCreateProject(uid);
  
  // Validation des données du projet
  validateProjectData(data);
  
  // Créer le document projet
  const projectDocument = await createProjectDocument(data, creator, context);
  
  // Ajouter les métadonnées de contexte
  projectDocument.ipAddress = context.rawRequest.ip;
  projectDocument.userAgent = context.rawRequest.headers['user-agent'] as string;

  // Transaction pour créer le projet
  const projectId = await firestoreHelper.runTransaction(async (transaction) => {
    const projectRef = firestoreHelper.getDocumentRef('projects', projectDocument.uid);
    
    // Vérifier que l'ID n'existe pas déjà
    const existingProject = await transaction.get(projectRef);
    if (existingProject.exists) {
      throw new https.HttpsError('already-exists', 'Project ID already exists');
    }

    // Créer le projet
    transaction.set(projectRef, projectDocument);
    
    return projectDocument.uid;
  });

  // Mettre à jour les statistiques du créateur (en parallèle)
  await updateCreatorStats(creator.uid);

  // Envoyer les notifications (en parallèle)
  await notifyProjectCreation(projectDocument, creator);

  logger.business('Project created', 'projects', {
    projectId,
    creatorUid: creator.uid,
    title: data.title,
    category: data.category,
    fundingGoal: data.funding.goal,
    currency: data.funding.currency,
    milestonesCount: data.milestones.length,
    teamSize: data.team.length,
    estimatedDuration: projectDocument.estimatedDuration,
    riskLevel: projectDocument.riskLevel,
    auditRequired: projectDocument.auditRequired,
  });

  return {
    projectId,
    slug: projectDocument.slug,
    status: projectDocument.status,
    auditRequired: projectDocument.auditRequired,
    estimatedDuration: projectDocument.estimatedDuration,
    riskLevel: projectDocument.riskLevel,
    nextSteps: getNextSteps(projectDocument),
  };
}

/**
 * Détermine les prochaines étapes après la création
 */
function getNextSteps(project: ProjectDocument): string[] {
  const steps: string[] = [];

  if (project.complianceChecks.contentModeration === STATUS.MODERATION.PENDING) {
    steps.push('content_moderation_review');
  }

  if (project.complianceChecks.legalReview === STATUS.MODERATION.PENDING) {
    steps.push('legal_review');
  }

  if (project.complianceChecks.financialReview === STATUS.MODERATION.PENDING) {
    steps.push('financial_review');
  }

  if (project.auditRequired) {
    steps.push('audit_assignment');
  }

  if (steps.length === 0) {
    steps.push('ready_for_publication');
  }

  return steps;
}

/**
 * Firebase Function principale
 */
export const createProject = https.onCall(
  withErrorHandling(async (data: unknown, context: CallableContext): Promise<ProjectsAPI.CreateProjectResponse> => {
    // Authentification requise
    if (!context.auth) {
      throw new https.HttpsError('unauthenticated', 'Authentication required');
    }

    // Validation des données
    const validatedData = validateWithJoi<ProjectsAPI.CreateProjectRequest>(requestSchema, data);

    // Logging de démarrage
    logger.info('Creating new project', {
      functionName: 'createProject',
      uid: context.auth.uid,
      title: validatedData.title,
      category: validatedData.category,
      fundingGoal: validatedData.funding.goal,
      currency: validatedData.funding.currency,
      milestonesCount: validatedData.milestones.length,
      teamSize: validatedData.team.length,
    });

    // Exécution
    const result = await executeCreateProject(validatedData, context);

    // Logging de succès
    logger.info('Project created successfully', {
      functionName: 'createProject',
      uid: context.auth.uid,
      projectId: result.projectId,
      slug: result.slug,
      auditRequired: result.auditRequired,
      riskLevel: result.riskLevel,
      success: true,
    });

    return result;
  })
);