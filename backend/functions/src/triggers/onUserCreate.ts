/**
 * User Creation Trigger Firebase Function
 * Social Finance Impact Platform
 */

import { firestore } from 'firebase-functions';
import { Timestamp } from 'firebase-admin/firestore';
import { logger } from '../utils/logger';
import { firestoreHelper } from '../utils/firestore';
import { emailService } from '../integrations/sendgrid/emailService';
import { UserDocument } from '../types/firestore';
import { STATUS, USER_PERMISSIONS, KYC_CONFIG } from '../utils/constants';
import { helpers } from '../utils/helpers';

/**
 * Interface pour les données de profil utilisateur initial
 */
interface UserProfileData {
  uid: string;
  email: string;
  firstName?: string;
  lastName?: string;
  userType: 'creator' | 'contributor' | 'auditor';
  source: 'email' | 'google' | 'apple';
  referredBy?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Initialise les données de profil utilisateur par défaut
 */
async function initializeUserProfile(userData: UserProfileData): Promise<void> {
  try {
    const now = new Date();
    
    // Données de profil par défaut
    const defaultProfile: Partial<UserDocument> = {
      uid: userData.uid,
      email: userData.email,
      firstName: userData.firstName || '',
      lastName: userData.lastName || '',
      userType: userData.userType,
      status: 'pending_verification',
      
      // Permissions par défaut selon le type
      permissions: getUserDefaultPermissions(userData.userType),
      
      // Préférences par défaut
      preferences: {
        language: 'fr',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        notifications: {
          email: true,
          push: true,
          inApp: true,
          project_update: {
            email: true,
            push: true,
            inApp: true
          },
          contribution_received: {
            email: true,
            push: true,
            inApp: true
          },
          payment_processed: {
            email: true,
            push: true,
            inApp: true
          }
        },
        privacy: {
          profilePublic: false,
          showContributions: false,
          allowContact: true
        }
      },
      
      // Compteurs initiaux
      notificationCounters: {
        unread: 0,
        total: 0,
        lastAccess: now
      },
      
      stats: {
        profileViews: 0,
        notificationsSent: 0,
        projectsCreated: 0,
        projectsSupported: 0,
        totalContributed: 0,
        lastActivity: now,
        joinedAt: now
      },

      // Métadonnées
      onboardingStep: 'profile_completion',
      emailVerified: false,
      phoneVerified: false,
      kycStatus: 'not_started',

      // Données de création
      registrationData: {
        source: userData.source,
        referredBy: userData.referredBy,
        ipAddress: userData.ipAddress,
        userAgent: userData.userAgent
      },

      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      version: 1
    };

    // Mettre à jour le document utilisateur
    await firestoreHelper.updateDocument('users', userData.uid, defaultProfile);

    logger.info('User profile initialized successfully', {
      uid: userData.uid,
      userType: userData.userType,
      source: userData.source,
      hasReferral: !!userData.referredBy
    });

  } catch (error) {
    logger.error('Failed to initialize user profile', error, { uid: userData.uid });
    throw error;
  }
}

/**
 * Retourne les permissions par défaut selon le type d'utilisateur
 */
function getUserDefaultPermissions(userType: string): string[] {
  switch (userType) {
    case 'creator':
      return [
        USER_PERMISSIONS.CREATE_PROJECT,
        USER_PERMISSIONS.UPDATE_OWN_PROJECT,
        USER_PERMISSIONS.VIEW_OWN_PROJECT
      ];
    case 'contributor':
      return [
        USER_PERMISSIONS.VIEW_PROJECTS,
        USER_PERMISSIONS.VIEW_OWN_PROJECT
      ];
    case 'auditor':
      return [
        USER_PERMISSIONS.VIEW_PROJECTS,
        USER_PERMISSIONS.VIEW_OWN_PROJECT
      ];
    default:
      return [];
  }
}

/**
 * Crée les collections sous-utilisateur nécessaires
 */
async function createUserSubCollections(uid: string): Promise<void> {
  try {
    // Créer document de métadonnées pour les devices
    await firestoreHelper.setDocument(`users/${uid}/devices`, 'metadata', {
      createdAt: Timestamp.now(),
      lastUpdated: Timestamp.now(),
      deviceCount: 0,
      maxDevices: 5
    });

    // Créer document de métadonnées pour les sessions
    await firestoreHelper.setDocument(`users/${uid}/sessions`, 'metadata', {
      createdAt: Timestamp.now(),
      activeSessions: 0,
      lastSession: null,
      maxConcurrentSessions: 3
    });

    // Créer document de métadonnées pour les notifications
    await firestoreHelper.setDocument(`users/${uid}/notification_preferences`, 'metadata', {
      createdAt: Timestamp.now(),
      customRules: [],
      blockedSenders: []
    });

    logger.info('User sub-collections created', { uid });

  } catch (error) {
    logger.error('Failed to create user sub-collections', error, { uid });
    // Ne pas faire échouer pour les sous-collections
  }
}

/**
 * Envoie l'email de bienvenue
 */
async function sendWelcomeEmail(user: UserDocument): Promise<void> {
  try {
    const templateMap = {
      creator: 'welcome_creator',
      contributor: 'welcome_contributor',
      auditor: 'welcome_auditor'
    };

    const templateId = templateMap[user.userType] || 'welcome_generic';

    await emailService.sendEmail({
      to: user.email,
      templateId,
      dynamicTemplateData: {
        firstName: user.firstName || 'Utilisateur',
        lastName: user.lastName || '',
        userType: user.userType,
        loginUrl: `${process.env.FRONTEND_URL}/login`,
        dashboardUrl: `${process.env.FRONTEND_URL}/dashboard`,
        supportUrl: `${process.env.FRONTEND_URL}/support`,
        settingsUrl: `${process.env.FRONTEND_URL}/settings`,
        year: new Date().getFullYear()
      }
    });

    logger.info('Welcome email sent', {
      uid: user.uid,
      email: user.email,
      userType: user.userType,
      templateId
    });

  } catch (error) {
    logger.error('Failed to send welcome email', error, {
      uid: user.uid,
      email: user.email,
      userType: user.userType
    });
    // Ne pas faire échouer pour l'email
  }
}

/**
 * Met à jour les statistiques de la plateforme
 */
async function updatePlatformStats(user: UserDocument): Promise<void> {
  try {
    // Incrémenter les compteurs globaux
    await firestoreHelper.incrementDocument('platform_stats', 'global', {
      'users.totalRegistered': 1,
      [`users.byType.${user.userType}`]: 1,
      [`users.bySource.${user.registrationData?.source || 'unknown'}`]: 1,
      'users.pendingVerification': 1
    });

    // Compteurs mensuels
    const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM
    await firestoreHelper.incrementDocument('platform_stats', `monthly_${monthKey}`, {
      'users.newRegistrations': 1,
      [`users.byType.${user.userType}`]: 1
    });

    // Compteurs de parrainage si applicable
    if (user.registrationData?.referredBy) {
      await firestoreHelper.incrementDocument('platform_stats', 'global', {
        'users.referrals.total': 1
      });

      // Créditer le parrain
      await firestoreHelper.incrementDocument('users', user.registrationData.referredBy, {
        'stats.referralsCount': 1,
        'stats.lastReferralAt': Timestamp.now()
      });
    }

    logger.info('Platform statistics updated for new user', {
      uid: user.uid,
      userType: user.userType,
      hasReferral: !!user.registrationData?.referredBy,
      monthKey
    });

  } catch (error) {
    logger.error('Failed to update platform statistics', error, { uid: user.uid });
    // Ne pas faire échouer pour les stats
  }
}

/**
 * Gère les tâches d'onboarding selon le type d'utilisateur
 */
async function initiateOnboardingProcess(user: UserDocument): Promise<void> {
  try {
    const onboardingTasks: any[] = [];

    // Tâches communes
    onboardingTasks.push(
      {
        id: helpers.string.generateId('task'),
        userId: user.uid,
        type: 'email_verification',
        title: 'Vérifier votre adresse email',
        description: 'Cliquez sur le lien dans l\'email de confirmation',
        status: 'pending',
        priority: 'high',
        dueDate: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000), // 24h
        createdAt: Timestamp.now()
      },
      {
        id: helpers.string.generateId('task'),
        userId: user.uid,
        type: 'profile_completion',
        title: 'Compléter votre profil',
        description: 'Ajoutez vos informations personnelles et préférences',
        status: 'pending',
        priority: 'medium',
        dueDate: Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 jours
        createdAt: Timestamp.now()
      }
    );

    // Tâches spécifiques par type
    if (user.userType === 'creator') {
      onboardingTasks.push({
        id: helpers.string.generateId('task'),
        userId: user.uid,
        type: 'kyc_initiation',
        title: 'Démarrer la vérification d\'identité',
        description: 'Complétez le processus KYC pour pouvoir créer des projets',
        status: 'pending',
        priority: 'high',
        dueDate: Timestamp.fromMillis(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 jours
        createdAt: Timestamp.now()
      });
    }

    if (user.userType === 'auditor') {
      onboardingTasks.push({
        id: helpers.string.generateId('task'),
        userId: user.uid,
        type: 'auditor_certification',
        title: 'Compléter la certification auditeur',
        description: 'Soumettez vos qualifications et certifications',
        status: 'pending',
        priority: 'high',
        dueDate: Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 jours
        createdAt: Timestamp.now()
      });
    }

    // Sauvegarder les tâches d'onboarding
    await Promise.all(
      onboardingTasks.map(task =>
        firestoreHelper.setDocument(`users/${user.uid}/onboarding_tasks`, task.id, task)
      )
    );

    // Créer notification de bienvenue
    const welcomeNotificationId = helpers.string.generateId('notif');
    await firestoreHelper.setDocument('notifications', welcomeNotificationId, {
      id: welcomeNotificationId,
      recipientUid: user.uid,
      senderUid: 'system',
      type: 'system_announcement',
      title: 'Bienvenue sur Social Finance Impact !',
      message: `Félicitations ${user.firstName || 'Utilisateur'} ! Votre compte a été créé avec succès. Complétez votre profil pour commencer.`,
      data: {
        onboardingTasksCount: onboardingTasks.length,
        userType: user.userType,
        nextStep: 'email_verification'
      },
      priority: 'medium',
      actionUrl: `${process.env.FRONTEND_URL}/onboarding`,
      read: false,
      readAt: null,
      delivered: true,
      deliveredAt: Timestamp.now(),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      version: 1,
      autoDelete: false
    } as unknown as any);

    // Mettre à jour le compteur de notifications
    await firestoreHelper.updateDocument('users', user.uid, {
      'notificationCounters.unread': firestoreHelper.increment(1),
      'notificationCounters.total': firestoreHelper.increment(1),
      'notificationCounters.lastNotificationAt': Timestamp.now()
    });

    logger.info('Onboarding process initiated', {
      uid: user.uid,
      userType: user.userType,
      tasksCreated: onboardingTasks.length,
      welcomeNotificationId
    });

  } catch (error) {
    logger.error('Failed to initiate onboarding process', error, { uid: user.uid });
    // Ne pas faire échouer pour l'onboarding
  }
}

/**
 * Gère les actions spécifiques au type d'utilisateur
 */
async function handleUserTypeSpecificActions(user: UserDocument): Promise<void> {
  try {
    switch (user.userType) {
      case 'creator':
        // Préparer le processus KYC
        await prepareKYCProcess(user);
        break;
        
      case 'contributor':
        // Analyser les projets recommandés
        await analyzeRecommendedProjects(user);
        break;
        
      case 'auditor':
        // Vérifier les qualifications d'auditeur
        await validateAuditorQualifications(user);
        break;
    }

  } catch (error) {
    logger.error('Failed to handle user type specific actions', error, {
      uid: user.uid,
      userType: user.userType
    });
    // Ne pas faire échouer pour les actions spécifiques
  }
}

/**
 * Prépare le processus KYC pour les créateurs
 */
async function prepareKYCProcess(user: UserDocument): Promise<void> {
  try {
    const kycSessionId = helpers.string.generateId('kyc');
    
    // Créer session KYC préliminaire
    await firestoreHelper.setDocument(`users/${user.uid}/kyc_sessions`, kycSessionId, {
      id: kycSessionId,
      userId: user.uid,
      status: 'pending_initiation',
      level: 'basic',
      provider: 'sumsub',
      requiredDocuments: KYC_CONFIG.REQUIRED_DOCUMENTS.CREATOR,
      createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 jours
      attempts: 0,
      maxAttempts: KYC_CONFIG.MAX_ATTEMPTS
    });

    logger.info('KYC process prepared for creator', {
      uid: user.uid,
      kycSessionId,
      requiredDocuments: KYC_CONFIG.REQUIRED_DOCUMENTS.CREATOR.length
    });

  } catch (error) {
    logger.error('Failed to prepare KYC process', error, { uid: user.uid });
  }
}

/**
 * Analyse les projets recommandés pour les contributeurs
 */
async function analyzeRecommendedProjects(user: UserDocument): Promise<void> {
  try {
    // Récupérer les projets actifs
    const activeProjects = await firestoreHelper.queryDocuments<any>(
      'projects',
      [
        ['status', '==', STATUS.PROJECT.ACTIVE],
        ['fundingStatus', '==', 'open']
      ],
      {
        limit: 10,
        orderBy: 'createdAt'
      }
    );

    if (activeProjects.data.length > 0) {
      // Créer document de recommandations
      await firestoreHelper.setDocument(`users/${user.uid}/recommendations`, 'projects', {
        projects: activeProjects.data.slice(0, 5).map(project => ({
          projectId: project.id,
          title: project.title,
          description: project.description,
          fundingGoal: project.fundingGoal,
          currentFunding: project.currentFunding,
          category: project.category,
          location: project.location,
          urgency: project.urgency,
          recommendationScore: Math.random() * 100, // TODO: Implémenter algorithme de recommandation
          reasons: ['new_user_recommendation', 'category_match']
        })),
        createdAt: Timestamp.now(),
        lastUpdated: Timestamp.now(),
        algorithm: 'initial_user_v1'
      });

      logger.info('Project recommendations created for new contributor', {
        uid: user.uid,
        recommendedProjects: activeProjects.data.length
      });
    }

  } catch (error) {
    logger.error('Failed to analyze recommended projects', error, { uid: user.uid });
  }
}

/**
 * Valide les qualifications d'auditeur
 */
async function validateAuditorQualifications(user: UserDocument): Promise<void> {
  try {
    // Créer document de qualification préliminaire
    const qualificationId = helpers.string.generateId('qual');
    
    await firestoreHelper.setDocument(`users/${user.uid}/qualifications`, qualificationId, {
      id: qualificationId,
      userId: user.uid,
      status: 'pending_submission',
      requiredCertifications: [
        'financial_analysis',
        'project_management',
        'impact_assessment'
      ],
      submittedDocuments: [],
      reviewStatus: 'not_started',
      reviewerUid: null,
      createdAt: Timestamp.now(),
      dueDate: Timestamp.fromMillis(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 jours
      notes: []
    });

    logger.info('Auditor qualification process initiated', {
      uid: user.uid,
      qualificationId,
      requiredCertifications: 3
    });

  } catch (error) {
    logger.error('Failed to validate auditor qualifications', error, { uid: user.uid });
  }
}

/**
 * Met à jour les métriques d'acquisition
 */
async function updateAcquisitionMetrics(user: UserDocument): Promise<void> {
  try {
    const acquisitionData = {
      date: new Date().toISOString().slice(0, 10), // YYYY-MM-DD
      userType: user.userType,
      source: user.registrationData?.source || 'unknown',
      hasReferral: !!user.registrationData?.referredBy,
      country: 'FR', // TODO: Détecter depuis l'IP
      timestamp: Timestamp.now()
    };

    // Sauvegarder les données d'acquisition pour analyse
    await firestoreHelper.setDocument(
      'analytics/acquisition/daily_registrations',
      helpers.string.generateId('reg'),
      acquisitionData
    );

    // Mettre à jour les métriques par source
    await firestoreHelper.incrementDocument('platform_stats', 'acquisition', {
      [`sources.${acquisitionData.source}.registrations`]: 1,
      [`userTypes.${user.userType}.registrations`]: 1,
      'total.registrations': 1,
      'total.withReferrals': acquisitionData.hasReferral ? 1 : 0
    });

    logger.info('Acquisition metrics updated', {
      uid: user.uid,
      acquisitionData
    });

  } catch (error) {
    logger.error('Failed to update acquisition metrics', error, { uid: user.uid });
    // Ne pas faire échouer pour les métriques
  }
}

/**
 * Gère le processus de parrainage si applicable
 */
async function handleReferralProcess(user: UserDocument): Promise<void> {
  try {
    if (!user.registrationData?.referredBy) {
      return;
    }

    const referrerId = user.registrationData.referredBy;

    // Valider que le parrain existe
    const referrer = await firestoreHelper.getDocument<UserDocument>('users', referrerId);

    // Créer l'enregistrement de parrainage
    const referralId = helpers.string.generateId('ref');
    await firestoreHelper.setDocument('referrals', referralId, {
      id: referralId,
      referrerId,
      referredUserId: user.uid,
      referredUserType: user.userType,
      status: 'pending_completion',
      completionCriteria: getReferralCompletionCriteria(user.userType),
      rewardStatus: 'pending',
      rewardAmount: getReferralRewardAmount(user.userType),
      createdAt: Timestamp.now(),
      completedAt: null,
      rewardedAt: null
    });

    // Notifier le parrain
    const notificationId = helpers.string.generateId('notif');
    await firestoreHelper.setDocument('notifications', notificationId, {
      id: notificationId,
      recipientUid: referrerId,
      senderUid: 'system',
      type: 'referral_registered',
      title: 'Nouveau parrainage !',
      message: `${user.firstName || 'Un utilisateur'} s'est inscrit grâce à votre lien de parrainage.`,
      data: {
        referredUserId: user.uid,
        referredUserName: `${user.firstName} ${user.lastName}`.trim(),
        userType: user.userType,
        referralId,
        potentialReward: getReferralRewardAmount(user.userType)
      },
      priority: 'medium',
      actionUrl: `${process.env.FRONTEND_URL}/referrals`,
      read: false,
      readAt: null,
      delivered: true,
      deliveredAt: Timestamp.now(),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      version: 1,
      autoDelete: false
    } as unknown as any);

    // Mettre à jour le compteur du parrain
    await firestoreHelper.updateDocument('users', referrerId, {
      'notificationCounters.unread': firestoreHelper.increment(1),
      'notificationCounters.total': firestoreHelper.increment(1)
    });

    logger.info('Referral process handled', {
      referralId,
      referrerId,
      referredUserId: user.uid,
      userType: user.userType,
      rewardAmount: getReferralRewardAmount(user.userType)
    });

  } catch (error) {
    logger.error('Failed to handle referral process', error, {
      uid: user.uid,
      referrerId: user.registrationData?.referredBy
    });
    // Ne pas faire échouer pour le parrainage
  }
}

/**
 * Retourne les critères de completion pour les parrainages
 */
function getReferralCompletionCriteria(userType: string): string[] {
  switch (userType) {
    case 'creator':
      return ['email_verified', 'kyc_completed', 'first_project_created'];
    case 'contributor':
      return ['email_verified', 'first_contribution_made'];
    case 'auditor':
      return ['email_verified', 'qualifications_approved', 'first_audit_completed'];
    default:
      return ['email_verified'];
  }
}

/**
 * Retourne le montant de récompense pour les parrainages (en centimes)
 */
function getReferralRewardAmount(userType: string): number {
  switch (userType) {
    case 'creator':
      return 2000; // €20.00
    case 'auditor':
      return 1500; // €15.00
    case 'contributor':
      return 1000; // €10.00
    default:
      return 500; // €5.00
  }
}

/**
 * Trigger principal - Création d'utilisateur
 */
export const onUserCreate = firestore
  .document('users/{userId}')
  .onCreate(async (snapshot, context) => {
    const userData = snapshot.data() as UserDocument;
    const uid = context.params.userId;

    try {
      logger.info('User creation trigger started', {
        uid,
        userType: userData.userType,
        email: userData.email,
        source: userData.registrationData?.source
      });

      // Initialisation du profil utilisateur
      await initializeUserProfile({
        uid,
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
        userType: (userData.userType === 'admin' ? 'creator' : userData.userType) as 'creator' | 'contributor' | 'auditor',
        source: userData.registrationData?.source as any || 'email',
        referredBy: userData.registrationData?.referredBy,
        ipAddress: userData.registrationData?.ipAddress,
        userAgent: userData.registrationData?.userAgent
      });

      // Exécution en parallèle des tâches non critiques
      await Promise.allSettled([
        createUserSubCollections(uid),
        sendWelcomeEmail(userData),
        updatePlatformStats(userData),
        initiateOnboardingProcess(userData),
        handleReferralProcess(userData)
      ]);

      // Log business
      logger.business('User account created', 'users', {
        userId: uid,
        userType: userData.userType,
        email: userData.email,
        source: userData.registrationData?.source || 'unknown',
        hasReferral: !!userData.registrationData?.referredBy,
        timestamp: new Date().toISOString(),
        onboardingInitiated: true
      });

      // Log security pour audit
      logger.security('New user registration', 'low', {
        userId: uid,
        email: userData.email,
        userType: userData.userType,
        ipAddress: userData.registrationData?.ipAddress,
        userAgent: userData.registrationData?.userAgent,
        referredBy: userData.registrationData?.referredBy
      });

      logger.info('User creation trigger completed successfully', {
        uid,
        userType: userData.userType,
        processingTime: userData.createdAt ? Date.now() - userData.createdAt.toMillis() : 0
      });

    } catch (error) {
      logger.error('User creation trigger failed', error, {
        uid,
        userType: userData.userType,
        email: userData.email
      });
      
      // Marquer l'utilisateur comme ayant échoué l'initialisation
      try {
        await firestoreHelper.updateDocument('users', uid, {
          status: 'initialization_failed',
          initializationError: {
            message: error instanceof Error ? error.message : 'Unknown error',
            timestamp: Timestamp.now(),
            retryCount: 0
          },
          updatedAt: Timestamp.now()
        });
      } catch (updateError) {
        logger.error('Failed to mark user initialization as failed', updateError, { uid });
      }
      
      throw error;
    }
  });