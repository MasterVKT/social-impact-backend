# Firebase Functions - Spécifications Techniques Détaillées
## Social Finance Impact Platform MVP

## 1. Architecture des Functions

### 1.1 Organisation modulaire

```
functions/
├── src/
│   ├── auth/                    # Authentification et profils
│   │   ├── completeProfile.js
│   │   ├── initKYC.js
│   │   ├── handleKYCWebhook.js
│   │   └── updateProfile.js
│   ├── projects/                # Gestion des projets
│   │   ├── createProject.js
│   │   ├── submitProject.js
│   │   ├── moderateProject.js
│   │   └── getProjectDetails.js
│   ├── payments/                # Système de paiement
│   │   ├── createContribution.js
│   │   ├── confirmPayment.js
│   │   ├── handleStripeWebhook.js
│   │   └── processRefunds.js
│   ├── audits/                  # Workflow d'audit
│   │   ├── assignAuditor.js
│   │   ├── submitAuditReport.js
│   │   └── releaseFunds.js
│   ├── notifications/           # Système de notifications
│   │   ├── sendNotification.js
│   │   ├── processEmailQueue.js
│   │   └── cleanupNotifications.js
│   ├── triggers/                # Functions déclenchées
│   │   ├── onUserCreate.js
│   │   ├── onProjectUpdate.js
│   │   ├── onContributionCreate.js
│   │   └── onAuditComplete.js
│   ├── scheduled/               # Tâches programmées
│   │   ├── dailyStats.js
│   │   ├── projectDeadlines.js
│   │   └── cleanupExpired.js
│   └── utils/                   # Utilitaires partagés
│       ├── auth.js
│       ├── validation.js
│       ├── email.js
│       ├── stripe.js
│       └── sumsub.js
├── package.json
├── .env.example
└── firebase.json
```

### 1.2 Configuration générale

```javascript
// firebase.json
{
  "functions": {
    "runtime": "nodejs18",
    "memory": "256MB",
    "timeout": "60s",
    "region": "europe-west1",
    "predeploy": ["npm --prefix functions run build"],
    "source": "functions"
  }
}

// package.json functions
{
  "name": "functions",
  "description": "Social Finance Impact Platform Backend",
  "scripts": {
    "build": "tsc",
    "serve": "npm run build && firebase emulators:start --only functions",
    "shell": "firebase functions:shell",
    "start": "npm run shell",
    "deploy": "firebase deploy --only functions",
    "logs": "firebase functions:log",
    "test": "jest",
    "lint": "eslint --ext .js,.ts ."
  },
  "engines": {
    "node": "18"
  },
  "main": "lib/index.js",
  "dependencies": {
    "firebase-admin": "^11.0.0",
    "firebase-functions": "^4.0.0",
    "stripe": "^13.0.0",
    "axios": "^1.0.0",
    "joi": "^17.0.0",
    "moment": "^2.29.0",
    "crypto": "^1.0.1"
  }
}
```

## 2. Module d'authentification

### 2.1 Function: completeProfile

**Endpoint** : `POST /api/auth/completeProfile`

```javascript
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const Joi = require('joi');

// Schéma de validation
const profileSchema = Joi.object({
  userType: Joi.string().valid('contributor', 'creator').required(),
  firstName: Joi.string().min(2).max(50).required(),
  lastName: Joi.string().min(2).max(50).required(),
  phoneNumber: Joi.string().pattern(/^\+[1-9]\d{1,14}$/),
  dateOfBirth: Joi.date().iso().max('now').required(),
  address: Joi.object({
    street: Joi.string().max(200),
    city: Joi.string().max(100).required(),
    postalCode: Joi.string().max(20).required(),
    country: Joi.string().length(2).required() // ISO 3166-1 alpha-2
  }).required(),
  preferences: Joi.object({
    language: Joi.string().valid('fr', 'en').default('fr'),
    currency: Joi.string().valid('EUR').default('EUR'),
    notifications: Joi.object({
      email: Joi.boolean().default(true),
      push: Joi.boolean().default(true),
      inApp: Joi.boolean().default(true)
    }),
    interestedCategories: Joi.array()
      .items(Joi.string().valid('environment', 'education', 'health', 'community', 'innovation'))
      .max(5)
  })
});

exports.completeProfile = functions
  .region('europe-west1')
  .https
  .onCall(async (data, context) => {
    try {
      // Vérification authentification
      if (!context.auth) {
        throw new functions.https.HttpsError(
          'unauthenticated',
          'Authentication required'
        );
      }

      // Validation des données
      const { error, value } = profileSchema.validate(data);
      if (error) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          `Validation error: ${error.details[0].message}`
        );
      }

      const uid = context.auth.uid;
      const email = context.auth.token.email;

      // Vérification que le profil n'existe pas déjà
      const userDoc = await admin.firestore()
        .collection('users')
        .doc(uid)
        .get();

      if (userDoc.exists && userDoc.data().profileComplete) {
        throw new functions.https.HttpsError(
          'already-exists',
          'Profile already completed'
        );
      }

      // Préparation du document utilisateur
      const userData = {
        uid,
        email,
        ...value,
        displayName: `${value.firstName} ${value.lastName}`,
        profileComplete: true,
        accountStatus: 'active',
        kyc: {
          status: 'pending',
          level: 0,
          provider: 'sumsub'
        },
        stats: {
          totalContributed: 0,
          projectsSupported: 0,
          projectsCreated: 0,
          auditsCompleted: 0,
          lastLoginAt: admin.firestore.FieldValue.serverTimestamp()
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        version: 1
      };

      // Transaction pour création du profil et Custom Claims
      const result = await admin.firestore().runTransaction(async (t) => {
        // Création du document utilisateur
        const userRef = admin.firestore().collection('users').doc(uid);
        t.set(userRef, userData);

        // Définition des Custom Claims
        const customClaims = {
          role: value.userType,
          permissions: getPermissionsByRole(value.userType),
          kycLevel: 0,
          kycStatus: 'pending'
        };

        await admin.auth().setCustomUserClaims(uid, customClaims);

        return {
          userId: uid,
          profileComplete: true,
          kycRequired: true,
          nextStep: 'kyc_verification'
        };
      });

      // Envoi de l'email de bienvenue
      await sendWelcomeEmail(email, value.firstName, value.userType);

      // Log de l'action
      functions.logger.info('Profile completed', {
        uid,
        userType: value.userType,
        timestamp: new Date().toISOString()
      });

      return {
        success: true,
        data: result,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      functions.logger.error('Error completing profile', {
        uid: context.auth?.uid,
        error: error.message,
        stack: error.stack
      });

      if (error instanceof functions.https.HttpsError) {
        throw error;
      }

      throw new functions.https.HttpsError(
        'internal',
        'An internal error occurred'
      );
    }
  });

// Fonction utilitaire pour les permissions
function getPermissionsByRole(userType) {
  const permissions = {
    'contributor': ['view_projects', 'contribute', 'view_portfolio'],
    'creator': ['view_projects', 'create_project', 'submit_milestone', 'view_analytics'],
    'auditor': ['view_assigned_audits', 'submit_audit_report'],
    'admin': ['moderate_content', 'manage_users', 'system_config', 'view_analytics']
  };
  return permissions[userType] || [];
}

// Fonction d'envoi d'email de bienvenue
async function sendWelcomeEmail(email, firstName, userType) {
  // Utilisation de l'extension Firebase Email/SendGrid
  const emailData = {
    to: email,
    template: {
      name: 'welcome',
      data: {
        firstName,
        userType,
        nextSteps: userType === 'creator' ? 
          ['Complete KYC verification', 'Create your first project'] :
          ['Complete KYC verification', 'Discover projects', 'Make your first contribution']
      }
    }
  };

  return admin.firestore()
    .collection('mail')
    .add(emailData);
}
```

### 2.2 Function: initKYCVerification

```javascript
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');
const axios = require('axios');

// Configuration Sumsub
const sumsubConfig = {
  baseURL: functions.config().sumsub.base_url || 'https://api.sumsub.com',
  appToken: functions.config().sumsub.app_token,
  secretKey: functions.config().sumsub.secret_key,
  levels: {
    basic: 'basic-kyc-level',
    enhanced: 'enhanced-kyc-level'
  }
};

exports.initKYCVerification = functions
  .region('europe-west1')
  .https
  .onCall(async (data, context) => {
    try {
      // Vérification authentification
      if (!context.auth) {
        throw new functions.https.HttpsError(
          'unauthenticated',
          'Authentication required'
        );
      }

      const { kycLevel } = data;
      if (!['basic', 'enhanced'].includes(kycLevel)) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'Invalid KYC level'
        );
      }

      const uid = context.auth.uid;

      // Récupération du profil utilisateur
      const userDoc = await admin.firestore()
        .collection('users')
        .doc(uid)
        .get();

      if (!userDoc.exists) {
        throw new functions.https.HttpsError(
          'not-found',
          'User profile not found'
        );
      }

      const userData = userDoc.data();

      // Vérification que KYC n'est pas déjà en cours ou approuvé
      if (userData.kyc.status === 'approved') {
        throw new functions.https.HttpsError(
          'already-exists',
          'KYC already approved'
        );
      }

      // Génération de l'ID externe Sumsub
      const externalUserId = `${uid}_${Date.now()}`;
      const levelName = sumsubConfig.levels[kycLevel];

      // Création de l'applicant Sumsub
      const applicantData = {
        externalUserId,
        info: {
          firstName: userData.firstName,
          lastName: userData.lastName,
          dob: userData.dateOfBirth,
          country: userData.address.country,
          phone: userData.phoneNumber
        },
        email: userData.email
      };

      const applicant = await createSumsubApplicant(applicantData, levelName);

      // Génération du token d'accès
      const accessToken = await generateSumsubToken(
        externalUserId,
        levelName
      );

      // Mise à jour du statut KYC
      await admin.firestore()
        .collection('users')
        .doc(uid)
        .update({
          'kyc.status': 'pending',
          'kyc.level': kycLevel === 'basic' ? 1 : 2,
          'kyc.externalId': externalUserId,
          'kyc.submittedAt': admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

      return {
        success: true,
        data: {
          sumsubToken: accessToken,
          sumsubUrl: `${sumsubConfig.baseURL}/websdk/build/dist/`,
          externalUserId,
          levelName,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24h
        }
      };

    } catch (error) {
      functions.logger.error('Error initializing KYC', {
        uid: context.auth?.uid,
        error: error.message
      });

      if (error instanceof functions.https.HttpsError) {
        throw error;
      }

      throw new functions.https.HttpsError(
        'internal',
        'Failed to initialize KYC verification'
      );
    }
  });

// Fonctions utilitaires Sumsub
async function createSumsubApplicant(applicantData, levelName) {
  const url = `/resources/applicants?levelName=${levelName}`;
  const body = JSON.stringify(applicantData);
  
  const signature = generateSumsubSignature('POST', url, body);
  
  const response = await axios.post(
    `${sumsubConfig.baseURL}${url}`,
    body,
    {
      headers: {
        'Content-Type': 'application/json',
        'X-App-Token': sumsubConfig.appToken,
        'X-App-Access-Sig': signature,
        'X-App-Access-Ts': Math.floor(Date.now() / 1000)
      }
    }
  );

  return response.data;
}

async function generateSumsubToken(externalUserId, levelName) {
  const url = `/resources/accessTokens?userId=${externalUserId}&levelName=${levelName}&ttlInSecs=86400`;
  
  const signature = generateSumsubSignature('POST', url, '');
  const timestamp = Math.floor(Date.now() / 1000);
  
  const response = await axios.post(
    `${sumsubConfig.baseURL}${url}`,
    {},
    {
      headers: {
        'X-App-Token': sumsubConfig.appToken,
        'X-App-Access-Sig': signature,
        'X-App-Access-Ts': timestamp
      }
    }
  );

  return response.data.token;
}

function generateSumsubSignature(method, url, body) {
  const timestamp = Math.floor(Date.now() / 1000);
  const message = timestamp + method.toUpperCase() + url + body;
  
  return crypto
    .createHmac('sha256', sumsubConfig.secretKey)
    .update(message)
    .digest('hex');
}
```

### 2.3 Function: handleKYCWebhook (Trigger)

```javascript
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');

exports.handleKYCWebhook = functions
  .region('europe-west1')
  .https
  .onRequest(async (req, res) => {
    try {
      // Vérification de la signature Sumsub
      const signature = req.headers['x-payload-digest'];
      const payload = JSON.stringify(req.body);
      
      if (!verifySumsubSignature(payload, signature)) {
        functions.logger.warn('Invalid Sumsub webhook signature');
        res.status(401).send('Unauthorized');
        return;
      }

      const { type, externalUserId, reviewResult, applicantId } = req.body;

      // Extraction de l'UID utilisateur depuis externalUserId
      const uid = externalUserId.split('_')[0];

      functions.logger.info('Received KYC webhook', {
        type,
        uid,
        reviewResult,
        applicantId
      });

      // Traitement selon le type d'événement
      switch (type) {
        case 'applicantReviewed':
          await handleApplicantReviewed(uid, reviewResult);
          break;
        
        case 'applicantPending':
          await handleApplicantPending(uid);
          break;
        
        case 'applicantActionPending':
          await handleActionPending(uid, reviewResult);
          break;
        
        default:
          functions.logger.info('Unhandled webhook type', { type });
      }

      res.status(200).send('OK');

    } catch (error) {
      functions.logger.error('Error handling KYC webhook', {
        error: error.message,
        body: req.body
      });
      res.status(500).send('Internal Error');
    }
  });

async function handleApplicantReviewed(uid, reviewResult) {
  const { reviewAnswer, rejectLabels, moderationComment } = reviewResult;
  
  const updateData = {
    'kyc.status': reviewAnswer.toLowerCase(), // 'green' -> 'approved', 'red' -> 'rejected'
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };

  if (reviewAnswer === 'GREEN') {
    updateData['kyc.status'] = 'approved';
    updateData['kyc.approvedAt'] = admin.firestore.FieldValue.serverTimestamp();
    
    // Mise à jour des Custom Claims
    const currentClaims = await admin.auth().getUser(uid).then(user => user.customClaims || {});
    await admin.auth().setCustomUserClaims(uid, {
      ...currentClaims,
      kycStatus: 'approved',
      kycLevel: updateData['kyc.level'] || currentClaims.kycLevel
    });

    // Notification de succès
    await sendKYCNotification(uid, 'approved');
    
  } else if (reviewAnswer === 'RED') {
    updateData['kyc.status'] = 'rejected';
    updateData['kyc.rejectionReason'] = moderationComment || rejectLabels?.join(', ');
    
    // Notification de rejet
    await sendKYCNotification(uid, 'rejected', updateData['kyc.rejectionReason']);
  }

  // Mise à jour de la base de données
  await admin.firestore()
    .collection('users')
    .doc(uid)
    .update(updateData);
}

async function sendKYCNotification(uid, status, reason = null) {
  const notificationData = {
    recipientUid: uid,
    type: 'kyc',
    subtype: status,
    priority: 'high',
    title: status === 'approved' ? 'KYC Verification Successful' : 'KYC Verification Failed',
    message: status === 'approved' 
      ? 'Your identity has been verified. You can now access all platform features.'
      : `Your KYC verification was rejected. ${reason ? `Reason: ${reason}` : 'Please submit new documents.'}`,
    data: {
      kycStatus: status,
      rejectionReason: reason
    },
    channels: {
      inApp: { sent: false },
      email: { enabled: true, sent: false },
      push: { enabled: true, sent: false }
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  };

  await admin.firestore()
    .collection('notifications')
    .add(notificationData);
}

function verifySumsubSignature(payload, signature) {
  const expectedSignature = crypto
    .createHmac('sha256', functions.config().sumsub.webhook_secret)
    .update(payload)
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  );
}
```

## 3. Module de gestion des projets

### 3.1 Function: createProject

```javascript
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const Joi = require('joi');

// Schéma de validation pour création de projet
const projectSchema = Joi.object({
  title: Joi.string().min(10).max(100).required(),
  shortDescription: Joi.string().min(50).max(200).required(),
  fullDescription: Joi.string().min(500).max(5000).required(),
  category: Joi.string().valid('environment', 'education', 'health', 'community', 'innovation').required(),
  fundingGoal: Joi.number().min(100000).max(5000000).required(), // En centimes
  campaignDuration: Joi.number().valid(30, 60, 90).required(),
  milestones: Joi.array().items(
    Joi.object({
      title: Joi.string().min(5).max(100).required(),
      description: Joi.string().min(50).max(1000).required(),
      budgetPercentage: Joi.number().min(10).max(70).required(),
      dueDate: Joi.date().iso().min('now').required(),
      criteria: Joi.array().items(Joi.string()).min(1).max(10)
    })
  ).min(1).max(3).required(),
  impactMetrics: Joi.object({
    beneficiariesCount: Joi.number().min(1).required(),
    targetAudience: Joi.string().min(20).max(500).required(),
    measurementMethod: Joi.string().min(20).max(500).required()
  }).required(),
  coverImage: Joi.string().required(), // Base64
  additionalImages: Joi.array().items(Joi.string()).max(3),
  documents: Joi.array().items(
    Joi.object({
      name: Joi.string().required(),
      type: Joi.string().valid('business_plan', 'impact_study', 'other').required(),
      content: Joi.string().required() // Base64
    })
  ).max(5)
});

exports.createProject = functions
  .region('europe-west1')
  .runWith({
    memory: '512MB',
    timeoutSeconds: 120
  })
  .https
  .onCall(async (data, context) => {
    try {
      // Vérifications d'autorisation
      if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
      }

      const uid = context.auth.uid;
      const userClaims = context.auth.token;

      // Vérification du rôle et KYC
      if (userClaims.role !== 'creator') {
        throw new functions.https.HttpsError('permission-denied', 'Creator role required');
      }

      if (userClaims.kycLevel < 2 || userClaims.kycStatus !== 'approved') {
        throw new functions.https.HttpsError('permission-denied', 'Enhanced KYC verification required');
      }

      // Validation des données
      const { error, value } = projectSchema.validate(data);
      if (error) {
        throw new functions.https.HttpsError('invalid-argument', error.details[0].message);
      }

      // Vérification du nombre de projets actifs
      const activeProjectsCount = await admin.firestore()
        .collection('projects')
        .where('creator.uid', '==', uid)
        .where('status', 'in', ['draft', 'under_review', 'live', 'funded', 'active'])
        .get()
        .then(snapshot => snapshot.size);

      if (activeProjectsCount >= 3) {
        throw new functions.https.HttpsError(
          'resource-exhausted',
          'Maximum 3 active projects allowed'
        );
      }

      // Vérification des pourcentages de milestones
      const totalPercentage = value.milestones.reduce((sum, m) => sum + m.budgetPercentage, 0);
      if (totalPercentage !== 100) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'Milestone budget percentages must total 100%'
        );
      }

      // Récupération du profil créateur
      const userDoc = await admin.firestore().collection('users').doc(uid).get();
      const userData = userDoc.data();

      // Upload des images et documents
      const mediaUrls = await uploadProjectMedia(uid, value);

      // Assistance IA pour amélioration du contenu
      const aiAssistance = await processWithAI(value);

      // Calcul des dates
      const now = admin.firestore.Timestamp.now();
      const endDate = new admin.firestore.Timestamp(
        now.seconds + (value.campaignDuration * 24 * 60 * 60),
        now.nanoseconds
      );

      // Préparation du document projet
      const projectData = {
        title: value.title,
        shortDescription: value.shortDescription,
        fullDescription: value.fullDescription,
        category: value.category,
        
        creator: {
          uid: uid,
          displayName: userData.displayName,
          profilePicture: userData.profilePicture,
          bio: userData.bio,
          stats: {
            projectsCreated: userData.stats.projectsCreated,
            successRate: calculateSuccessRate(userData.stats),
            averageRating: userData.stats.averageRating || 0
          }
        },
        
        funding: {
          goal: value.fundingGoal,
          raised: 0,
          currency: 'EUR',
          percentage: 0,
          contributorsCount: 0,
          averageContribution: 0,
          fees: {
            platformPercentage: 5,
            auditPercentage: 3,
            platformAmount: Math.round(value.fundingGoal * 0.05),
            auditAmount: Math.round(value.fundingGoal * 0.03)
          },
          minimumContribution: 1000 // 10€ en centimes
        },
        
        status: 'draft',
        timeline: {
          createdAt: now,
          endDate: endDate,
          campaignDuration: value.campaignDuration
        },
        
        media: {
          coverImage: {
            url: mediaUrls.coverImage.url,
            thumbnails: mediaUrls.coverImage.thumbnails
          },
          additionalImages: mediaUrls.additionalImages || [],
          documents: mediaUrls.documents || []
        },
        
        impact: {
          beneficiariesCount: value.impactMetrics.beneficiariesCount,
          targetAudience: value.impactMetrics.targetAudience,
          measurementMethod: value.impactMetrics.measurementMethod,
          expectedOutcomes: []
        },
        
        moderation: {
          status: 'pending',
          aiScore: aiAssistance.qualityScore,
          aiFlags: aiAssistance.flags || []
        },
        
        analytics: {
          views: 0,
          totalViews: 0,
          saves: 0,
          shares: 0,
          conversionRate: 0,
          averageTimeSpent: 0,
          bounceRate: 0,
          trafficSources: {},
          lastViewedAt: now
        },
        
        settings: {
          allowAnonymousContributions: true,
          publicContributorsList: true,
          allowComments: false,
          emailUpdatesEnabled: true,
          autoRefundOnFailure: true
        },
        
        createdAt: now,
        updatedAt: now,
        version: 1
      };

      // Transaction pour créer le projet et les milestones
      const result = await admin.firestore().runTransaction(async (t) => {
        // Création du projet
        const projectRef = admin.firestore().collection('projects').doc();
        projectData.id = projectRef.id;
        t.set(projectRef, projectData);

        // Création des milestones
        const milestonesData = [];
        for (let i = 0; i < value.milestones.length; i++) {
          const milestone = value.milestones[i];
          const milestoneRef = projectRef.collection('milestones').doc();
          
          const milestoneData = {
            id: milestoneRef.id,
            projectId: projectRef.id,
            order: i + 1,
            title: milestone.title,
            description: milestone.description,
            criteria: milestone.criteria,
            deliverables: [],
            budget: {
              percentage: milestone.budgetPercentage,
              amount: Math.round(value.fundingGoal * milestone.budgetPercentage / 100)
            },
            timeline: {
              plannedStartDate: i === 0 ? now : admin.firestore.Timestamp.fromDate(new Date(milestone.dueDate)),
              plannedEndDate: admin.firestore.Timestamp.fromDate(new Date(milestone.dueDate)),
              submissionDeadline: admin.firestore.Timestamp.fromDate(
                new Date(new Date(milestone.dueDate).getTime() + 30 * 24 * 60 * 60 * 1000) // +30 jours
              )
            },
            status: 'pending',
            createdAt: now,
            updatedAt: now,
            version: 1
          };
          
          t.set(milestoneRef, milestoneData);
          milestonesData.push(milestoneData);
        }

        return {
          projectId: projectRef.id,
          status: 'draft',
          milestones: milestonesData.length,
          aiAssistance: {
            titleSuggestions: aiAssistance.titleSuggestions || [],
            descriptionImprovements: aiAssistance.descriptionImprovements || '',
            categorySuggestion: aiAssistance.categorySuggestion || value.category,
            qualityScore: aiAssistance.qualityScore
          },
          estimatedReviewTime: '48h',
          nextSteps: ['Review and edit content', 'Submit for moderation']
        };
      });

      functions.logger.info('Project created', {
        projectId: result.projectId,
        creatorUid: uid,
        category: value.category,
        fundingGoal: value.fundingGoal
      });

      return {
        success: true,
        data: result,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      functions.logger.error('Error creating project', {
        uid: context.auth?.uid,
        error: error.message,
        stack: error.stack
      });

      if (error instanceof functions.https.HttpsError) {
        throw error;
      }

      throw new functions.https.HttpsError('internal', 'Failed to create project');
    }
  });

// Fonctions utilitaires
async function uploadProjectMedia(uid, projectData) {
  const bucket = admin.storage().bucket();
  const results = {};

  try {
    // Upload de l'image de couverture
    const coverImageBuffer = Buffer.from(projectData.coverImage, 'base64');
    const coverImagePath = `projects/${uid}/${Date.now()}_cover.jpg`;
    
    const coverImageFile = bucket.file(coverImagePath);
    await coverImageFile.save(coverImageBuffer, {
      metadata: { contentType: 'image/jpeg' }
    });

    results.coverImage = {
      url: `gs://${bucket.name}/${coverImagePath}`,
      thumbnails: {
        small: `gs://${bucket.name}/${coverImagePath}_150x150`,
        medium: `gs://${bucket.name}/${coverImagePath}_300x300`,
        large: `gs://${bucket.name}/${coverImagePath}_600x600`
      }
    };

    // Upload des images additionnelles
    if (projectData.additionalImages?.length > 0) {
      results.additionalImages = [];
      
      for (let i = 0; i < projectData.additionalImages.length; i++) {
        const imageBuffer = Buffer.from(projectData.additionalImages[i], 'base64');
        const imagePath = `projects/${uid}/${Date.now()}_${i}.jpg`;
        
        const imageFile = bucket.file(imagePath);
        await imageFile.save(imageBuffer, {
          metadata: { contentType: 'image/jpeg' }
        });

        results.additionalImages.push({
          url: `gs://${bucket.name}/${imagePath}`,
          thumbnails: {
            small: `gs://${bucket.name}/${imagePath}_150x150`,
            medium: `gs://${bucket.name}/${imagePath}_300x300`,
            large: `gs://${bucket.name}/${imagePath}_600x600`
          },
          order: i
        });
      }
    }

    // Upload des documents
    if (projectData.documents?.length > 0) {
      results.documents = [];
      
      for (const doc of projectData.documents) {
        const docBuffer = Buffer.from(doc.content, 'base64');
        const docPath = `projects/${uid}/documents/${Date.now()}_${doc.name}`;
        
        const docFile = bucket.file(docPath);
        await docFile.save(docBuffer, {
          metadata: { 
            contentType: 'application/pdf',
            customMetadata: {
              originalName: doc.name,
              type: doc.type
            }
          }
        });

        results.documents.push({
          name: doc.name,
          type: doc.type,
          url: `gs://${bucket.name}/${docPath}`,
          size: docBuffer.length,
          uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
          downloadable: true
        });
      }
    }

    return results;

  } catch (error) {
    functions.logger.error('Error uploading project media', {
      uid,
      error: error.message
    });
    throw new Error('Failed to upload project media');
  }
}

async function processWithAI(projectData) {
  // Simulation de traitement IA - à remplacer par Firebase AI Logic
  const qualityScore = calculateQualityScore(projectData);
  
  return {
    qualityScore,
    titleSuggestions: generateTitleSuggestions(projectData.title, projectData.category),
    descriptionImprovements: generateDescriptionImprovements(projectData.fullDescription),
    categorySuggestion: projectData.category,
    flags: detectContentFlags(projectData)
  };
}

function calculateQualityScore(projectData) {
  let score = 0;
  
  // Titre (20 points)
  if (projectData.title.length >= 20) score += 20;
  else score += Math.round(projectData.title.length / 20 * 20);
  
  // Description (30 points)
  if (projectData.fullDescription.length >= 1000) score += 30;
  else score += Math.round(projectData.fullDescription.length / 1000 * 30);
  
  // Milestones (25 points)
  score += Math.round(projectData.milestones.length / 3 * 25);
  
  // Impact metrics (25 points)
  if (projectData.impactMetrics.beneficiariesCount > 0) score += 10;
  if (projectData.impactMetrics.targetAudience.length >= 50) score += 10;
  if (projectData.impactMetrics.measurementMethod.length >= 50) score += 5;
  
  return Math.min(score, 100);
}

function calculateSuccessRate(stats) {
  if (stats.projectsCreated === 0) return 0;
  return Math.round((stats.successfulProjects / stats.projectsCreated) * 100);
}
```

## 4. Module de paiement et contributions

### 4.1 Function: createContribution

```javascript
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const Joi = require('joi');
const stripe = require('stripe')(functions.config().stripe.secret_key);

// Schéma de validation pour contribution
const contributionSchema = Joi.object({
  projectId: Joi.string().required(),
  amount: Joi.number().min(1000).max(100000).required(), // En centimes
  message: Joi.string().max(500).allow(''),
  anonymous: Joi.boolean().default(false),
  paymentMethod: Joi.object({
    type: Joi.string().valid('card').required(),
    source: Joi.string().valid('form', 'saved').default('form')
  }).required()
});

exports.createContribution = functions
  .region('europe-west1')
  .runWith({
    memory: '256MB',
    timeoutSeconds: 60
  })
  .https
  .onCall(async (data, context) => {
    try {
      // Vérifications d'autorisation
      if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
      }

      const uid = context.auth.uid;
      const userClaims = context.auth.token;

      // Vérification KYC niveau 1 minimum
      if (userClaims.kycLevel < 1 || userClaims.kycStatus !== 'approved') {
        throw new functions.https.HttpsError(
          'permission-denied', 
          'KYC verification level 1 required'
        );
      }

      // Validation des données
      const { error, value } = contributionSchema.validate(data);
      if (error) {
        throw new functions.https.HttpsError('invalid-argument', error.details[0].message);
      }

      // Vérification du projet
      const projectDoc = await admin.firestore()
        .collection('projects')
        .doc(value.projectId)
        .get();

      if (!projectDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Project not found');
      }

      const projectData = projectDoc.data();

      // Vérification statut du projet
      if (projectData.status !== 'live') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Project is not accepting contributions'
        );
      }

      // Vérification date limite
      if (projectData.timeline.endDate.toDate() < new Date()) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Project campaign has ended'
        );
      }

      // Vérification limites utilisateur
      await checkUserContributionLimits(uid, value.amount, userClaims.kycLevel);

      // Récupération profil utilisateur
      const userDoc = await admin.firestore().collection('users').doc(uid).get();
      const userData = userDoc.data();

      // Calcul des frais
      const fees = calculateFees(value.amount);
      const totalAmount = value.amount + fees.total;

      // Création du PaymentIntent Stripe
      const paymentIntent = await stripe.paymentIntents.create({
        amount: totalAmount,
        currency: 'eur',
        metadata: {
          projectId: value.projectId,
          contributorUid: uid,
          contributionAmount: value.amount,
          platformFee: fees.platform,
          stripeFee: fees.stripe,
          projectTitle: projectData.title,
          creatorUid: projectData.creator.uid
        },
        description: `Contribution to: ${projectData.title}`,
        statement_descriptor: 'SOCIAL IMPACT',
        automatic_payment_methods: {
          enabled: true
        }
      });

      // Préparation du document contribution
      const contributionData = {
        projectId: value.projectId,
        contributorUid: uid,
        
        contributor: {
          uid: uid,
          displayName: value.anonymous ? 'Anonymous' : userData.displayName,
          profilePicture: value.anonymous ? null : userData.profilePicture,
          isAnonymous: value.anonymous,
          country: userData.address?.country
        },
        
        amount: {
          gross: value.amount,
          fees: {
            platform: fees.platform,
            stripe: fees.stripe,
            total: fees.total
          },
          net: value.amount,
          currency: 'EUR'
        },
        
        payment: {
          status: 'pending',
          provider: 'stripe',
          paymentIntentId: paymentIntent.id,
          initiatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        
        escrow: {
          status: 'held',
          heldAmount: value.amount,
          releasedAmount: 0,
          releases: []
        },
        
        message: value.message || null,
        preferences: {
          anonymous: value.anonymous,
          receiveUpdates: true,
          allowContact: !value.anonymous
        },
        
        source: {
          device: 'web', // À enrichir avec de vraies données
          userAgent: context.rawRequest?.headers['user-agent']
        },
        
        verified: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        version: 1
      };

      // Transaction pour créer la contribution
      const result = await admin.firestore().runTransaction(async (t) => {
        const contributionRef = admin.firestore()
          .collection('projects')
          .doc(value.projectId)
          .collection('contributions')
          .doc();

        contributionData.id = contributionRef.id;
        t.set(contributionRef, contributionData);

        return {
          contributionId: contributionRef.id,
          paymentIntent: {
            id: paymentIntent.id,
            clientSecret: paymentIntent.client_secret,
            amount: totalAmount,
            currency: 'EUR'
          },
          fees: {
            platformFee: fees.platform,
            stripeFee: fees.stripe,
            total: fees.total
          },
          escrow: {
            holdUntil: projectData.timeline.endDate.toDate().toISOString(),
            releaseConditions: ['milestone validations']
          }
        };
      });

      functions.logger.info('Contribution created', {
        contributionId: result.contributionId,
        projectId: value.projectId,
        contributorUid: uid,
        amount: value.amount,
        paymentIntentId: paymentIntent.id
      });

      return {
        success: true,
        data: result,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      functions.logger.error('Error creating contribution', {
        uid: context.auth?.uid,
        projectId: data?.projectId,
        error: error.message
      });

      if (error instanceof functions.https.HttpsError) {
        throw error;
      }

      throw new functions.https.HttpsError('internal', 'Failed to create contribution');
    }
  });

// Fonctions utilitaires
async function checkUserContributionLimits(uid, amount, kycLevel) {
  // Limites selon niveau KYC
  const limits = {
    1: { perContribution: 100000, perMonth: 500000 }, // Basic: 1000€/contribution, 5000€/mois
    2: { perContribution: 1000000, perMonth: 5000000 } // Enhanced: 10000€/contribution, 50000€/mois
  };

  const userLimit = limits[kycLevel];
  
  if (amount > userLimit.perContribution) {
    throw new functions.https.HttpsError(
      'permission-denied',
      `Contribution amount exceeds limit (${userLimit.perContribution / 100}€)`
    );
  }

  // Vérification limite mensuelle
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const monthlyContributions = await admin.firestore()
    .collectionGroup('contributions')
    .where('contributorUid', '==', uid)
    .where('payment.status', '==', 'confirmed')
    .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(monthStart))
    .get();

  const monthlyTotal = monthlyContributions.docs.reduce(
    (sum, doc) => sum + doc.data().amount.gross,
    0
  );

  if (monthlyTotal + amount > userLimit.perMonth) {
    throw new functions.https.HttpsError(
      'permission-denied',
      `Monthly contribution limit exceeded (${userLimit.perMonth / 100}€)`
    );
  }
}

function calculateFees(amount) {
  const platformFee = Math.round(amount * 0.05); // 5%
  const stripeFee = Math.round(amount * 0.029 + 30); // ~2.9% + 0.30€
  
  return {
    platform: platformFee,
    stripe: stripeFee,
    total: platformFee + stripeFee
  };
}
```

### 4.2 Function: confirmPayment

```javascript
exports.confirmPayment = functions
  .region('europe-west1')
  .https
  .onCall(async (data, context) => {
    try {
      if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
      }

      const { contributionId, paymentIntentId } = data;
      const uid = context.auth.uid;

      // Récupération de la contribution
      const contributionQuery = await admin.firestore()
        .collectionGroup('contributions')
        .where('id', '==', contributionId)
        .where('contributorUid', '==', uid)
        .limit(1)
        .get();

      if (contributionQuery.empty) {
        throw new functions.https.HttpsError('not-found', 'Contribution not found');
      }

      const contributionDoc = contributionQuery.docs[0];
      const contributionData = contributionDoc.data();
      const projectId = contributionData.projectId;

      // Vérification du PaymentIntent Stripe
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      
      if (paymentIntent.status !== 'succeeded') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Payment not completed. Status: ${paymentIntent.status}`
        );
      }

      // Extraction des détails de paiement
      const paymentMethod = await stripe.paymentMethods.retrieve(
        paymentIntent.payment_method
      );

      // Transaction pour confirmer la contribution
      const result = await admin.firestore().runTransaction(async (t) => {
        // Mise à jour de la contribution
        const contributionRef = contributionDoc.ref;
        const updateData = {
          'payment.status': 'confirmed',
          'payment.confirmedAt': admin.firestore.FieldValue.serverTimestamp(),
          'payment.paymentMethodId': paymentIntent.payment_method,
          'payment.cardLast4': paymentMethod.card?.last4,
          'payment.cardBrand': paymentMethod.card?.brand,
          'payment.cardCountry': paymentMethod.card?.country,
          verified: true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        
        t.update(contributionRef, updateData);

        // Mise à jour des statistiques du projet
        const projectRef = admin.firestore().collection('projects').doc(projectId);
        const projectDoc = await t.get(projectRef);
        const projectData = projectDoc.data();
        
        const newRaised = projectData.funding.raised + contributionData.amount.gross;
        const newContributorsCount = projectData.funding.contributorsCount + 1;
        const newPercentage = Math.round((newRaised / projectData.funding.goal) * 100);
        const newAverageContribution = Math.round(newRaised / newContributorsCount);

        t.update(projectRef, {
          'funding.raised': newRaised,
          'funding.percentage': newPercentage,
          'funding.contributorsCount': newContributorsCount,
          'funding.averageContribution': newAverageContribution,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Mise à jour des stats utilisateur
        const userRef = admin.firestore().collection('users').doc(uid);
        t.update(userRef, {
          'stats.totalContributed': admin.firestore.FieldValue.increment(contributionData.amount.gross),
          'stats.projectsSupported': admin.firestore.FieldValue.increment(1),
          'stats.lastContributionAt': admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Création de l'entrée transaction
        const transactionRef = admin.firestore().collection('transactions').doc();
        const transactionData = {
          id: transactionRef.id,
          type: 'contribution',
          projectId: projectId,
          contributionId: contributionId,
          
          from: {
            type: 'user',
            uid: uid,
            name: contributionData.contributor.displayName
          },
          to: {
            type: 'project',
            uid: projectData.creator.uid,
            name: projectData.title
          },
          
          amount: {
            gross: contributionData.amount.gross,
            fees: contributionData.amount.fees.total,
            net: contributionData.amount.net,
            currency: 'EUR'
          },
          
          status: 'completed',
          external: {
            provider: 'stripe',
            externalId: paymentIntentId
          },
          
          timeline: {
            initiatedAt: contributionData.createdAt,
            processedAt: admin.firestore.FieldValue.serverTimestamp(),
            completedAt: admin.firestore.FieldValue.serverTimestamp()
          },
          
          description: `Contribution to project: ${projectData.title}`,
          reconciliation: {
            reconciled: false
          },
          
          auditTrail: [{
            action: 'payment_confirmed',
            performedBy: 'system',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            details: `Stripe PaymentIntent: ${paymentIntentId}`
          }],
          
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          version: 1
        };

        t.set(transactionRef, transactionData);

        return {
          status: 'confirmed',
          transactionId: transactionRef.id,
          escrowDetails: {
            amount: contributionData.amount.gross,
            heldUntil: projectData.timeline.endDate.toDate().toISOString(),
            releaseSchedule: await calculateReleaseSchedule(projectId, contributionData.amount.gross)
          }
        };
      });

      // Génération et envoi du reçu
      const receiptUrl = await generateReceipt(contributionId, paymentIntent);
      await sendContributionConfirmationEmail(uid, projectId, contributionData, receiptUrl);

      // Notification au créateur du projet
      await notifyProjectCreator(projectId, contributionData);

      // Vérification si projet entièrement financé
      const updatedProject = await admin.firestore()
        .collection('projects')
        .doc(projectId)
        .get();
      
      if (updatedProject.data().funding.percentage >= 100) {
        await handleProjectFullyFunded(projectId);
      }

      functions.logger.info('Payment confirmed', {
        contributionId,
        projectId,
        contributorUid: uid,
        amount: contributionData.amount.gross,
        paymentIntentId
      });

      return {
        success: true,
        data: {
          ...result,
          receiptUrl
        },
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      functions.logger.error('Error confirming payment', {
        contributionId: data?.contributionId,
        paymentIntentId: data?.paymentIntentId,
        error: error.message
      });

      if (error instanceof functions.https.HttpsError) {
        throw error;
      }

      throw new functions.https.HttpsError('internal', 'Failed to confirm payment');
    }
  });

async function calculateReleaseSchedule(projectId, contributionAmount) {
  const milestonesSnapshot = await admin.firestore()
    .collection('projects')
    .doc(projectId)
    .collection('milestones')
    .orderBy('order')
    .get();

  const schedule = [];
  
  milestonesSnapshot.docs.forEach(doc => {
    const milestone = doc.data();
    const releaseAmount = Math.round(contributionAmount * milestone.budget.percentage / 100);
    
    schedule.push({
      milestoneId: milestone.id,
      amount: releaseAmount,
      conditions: 'milestone validation'
    });
  });

  return schedule;
}

async function generateReceipt(contributionId, paymentIntent) {
  // Génération d'un reçu PDF (implémentation simplifiée)
  const receiptId = `receipt_${contributionId}_${Date.now()}`;
  
  // Stockage des informations de reçu
  await admin.firestore()
    .collection('receipts')
    .doc(receiptId)
    .set({
      contributionId,
      paymentIntentId: paymentIntent.id,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

  return `https://platform.socialimpact.com/receipts/${receiptId}`;
}
```

### 4.3 Function: handleStripeWebhook (Trigger)

```javascript
exports.handleStripeWebhook = functions
  .region('europe-west1')
  .runWith({
    memory: '256MB',
    timeoutSeconds: 60
  })
  .https
  .onRequest(async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = functions.config().stripe.webhook_secret;

    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      functions.logger.error('Webhook signature verification failed', { error: err.message });
      res.status(400).send(`Webhook Error: ${err.message}`);
      return;
    }

    functions.logger.info('Stripe webhook received', {
      type: event.type,
      id: event.id
    });

    try {
      switch (event.type) {
        case 'payment_intent.succeeded':
          await handlePaymentIntentSucceeded(event.data.object);
          break;
        
        case 'payment_intent.payment_failed':
          await handlePaymentIntentFailed(event.data.object);
          break;
        
        case 'charge.dispute.created':
          await handleChargeDispute(event.data.object);
          break;
        
        case 'invoice.payment_succeeded':
          await handleInvoicePaymentSucceeded(event.data.object);
          break;
        
        default:
          functions.logger.info('Unhandled webhook event type', { type: event.type });
      }

      res.status(200).send('OK');

    } catch (error) {
      functions.logger.error('Error processing webhook', {
        eventType: event.type,
        eventId: event.id,
        error: error.message
      });
      res.status(500).send('Internal Error');
    }
  });

async function handlePaymentIntentSucceeded(paymentIntent) {
  const { id, metadata } = paymentIntent;
  const { projectId, contributorUid, contributionAmount } = metadata;

  functions.logger.info('Payment intent succeeded', {
    paymentIntentId: id,
    projectId,
    contributorUid,
    amount: contributionAmount
  });

  // Le traitement principal est fait dans confirmPayment
  // Ici on peut ajouter des logs ou métriques additionnelles
  
  // Mise à jour des métriques de conversion
  await admin.firestore()
    .collection('analytics')
    .doc('daily_stats')
    .set({
      date: admin.firestore.FieldValue.serverTimestamp(),
      successfulPayments: admin.firestore.FieldValue.increment(1),
      totalRevenue: admin.firestore.FieldValue.increment(parseInt(contributionAmount))
    }, { merge: true });
}

async function handlePaymentIntentFailed(paymentIntent) {
  const { id, metadata, last_payment_error } = paymentIntent;
  const { projectId, contributorUid } = metadata;

  functions.logger.warn('Payment intent failed', {
    paymentIntentId: id,
    projectId,
    contributorUid,
    error: last_payment_error?.message
  });

  // Trouver et mettre à jour la contribution
  const contributionQuery = await admin.firestore()
    .collectionGroup('contributions')
    .where('payment.paymentIntentId', '==', id)
    .limit(1)
    .get();

  if (!contributionQuery.empty) {
    const contributionDoc = contributionQuery.docs[0];
    
    await contributionDoc.ref.update({
      'payment.status': 'failed',
      'payment.failedAt': admin.firestore.FieldValue.serverTimestamp(),
      'payment.failureReason': last_payment_error?.message || 'Unknown error',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Notification à l'utilisateur
    await admin.firestore().collection('notifications').add({
      recipientUid: contributorUid,
      type: 'contribution',
      subtype: 'payment_failed',
      priority: 'high',
      title: 'Payment Failed',
      message: `Your contribution payment failed: ${last_payment_error?.message || 'Unknown error'}`,
      data: {
        projectId,
        paymentIntentId: id,
        retryUrl: `https://platform.socialimpact.com/projects/${projectId}/contribute`
      },
      channels: {
        inApp: { sent: false },
        email: { enabled: true, sent: false },
        push: { enabled: true, sent: false }
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
}
```

## 5. Module d'audit

### 5.1 Function: assignAuditor

```javascript
const functions = require('firebase-functions');
const admin = require('firebase-admin');

exports.assignAuditor = functions
  .region('europe-west1')
  .https
  .onCall(async (data, context) => {
    try {
      // Vérification autorisation admin
      if (!context.auth || context.auth.token.role !== 'admin') {
        throw new functions.https.HttpsError(
          'permission-denied',
          'Admin role required'
        );
      }

      const { projectId, auditorUid, specializations = [], deadline, compensation = 20000 } = data;

      // Vérification du projet
      const projectDoc = await admin.firestore()
        .collection('projects')
        .doc(projectId)
        .get();

      if (!projectDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Project not found');
      }

      const projectData = projectDoc.data();

      // Vérification de l'auditeur
      const auditorDoc = await admin.firestore()
        .collection('users')
        .doc(auditorUid)
        .get();

      if (!auditorDoc.exists || auditorDoc.data().userType !== 'auditor') {
        throw new functions.https.HttpsError('not-found', 'Auditor not found');
      }

      const auditorData = auditorDoc.data();

      // Vérification disponibilité auditeur
      const activeAudits = await admin.firestore()
        .collection('audits')
        .where('auditor.uid', '==', auditorUid)
        .where('status', 'in', ['assigned', 'accepted', 'in_progress'])
        .get();

      if (activeAudits.size >= 5) { // Limite de 5 audits actifs
        throw new functions.https.HttpsError(
          'resource-exhausted',
          'Auditor has too many active audits'
        );
      }

      // Calcul de la deadline par défaut (7 jours après acceptation)
      const calculatedDeadline = deadline || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      // Récupération des milestones du projet
      const milestonesSnapshot = await admin.firestore()
        .collection('projects')
        .doc(projectId)
        .collection('milestones')
        .orderBy('order')
        .get();

      // Transaction pour créer l'audit
      const result = await admin.firestore().runTransaction(async (t) => {
        const auditRef = admin.firestore().collection('audits').doc();
        
        const auditData = {
          id: auditRef.id,
          projectId,
          projectTitle: projectData.title,
          creatorUid: projectData.creator.uid,
          creatorName: projectData.creator.displayName,
          
          auditor: {
            uid: auditorUid,
            displayName: auditorData.displayName,
            email: auditorData.email,
            profilePicture: auditorData.profilePicture,
            specializations: auditorData.specializations || specializations,
            stats: {
              auditsCompleted: auditorData.stats.auditsCompleted || 0,
              averageRating: auditorData.stats.averageRating || 0,
              approvalRate: auditorData.stats.approvalRate || 100
            }
          },
          
          scope: {
            totalMilestones: milestonesSnapshot.size,
            estimatedHours: milestonesSnapshot.size * 4, // Estimation 4h par milestone
            complexity: calculateComplexity(projectData),
            specialRequirements: specializations
          },
          
          timeline: {
            assignedAt: admin.firestore.FieldValue.serverTimestamp(),
            deadline: admin.firestore.Timestamp.fromDate(calculatedDeadline),
            isOverdue: false
          },
          
          status: 'assigned',
          
          compensation: {
            baseAmount: compensation,
            totalAmount: compensation,
            currency: 'EUR',
            status: 'pending',
            invoiceRequired: true
          },
          
          results: {
            milestonesAudited: 0,
            averageScore: 0,
            totalApproved: 0,
            totalRejected: 0,
            totalRevisions: 0,
            fundsReleased: 0
          },
          
          communications: [],
          
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          version: 1
        };

        t.set(auditRef, auditData);

        // Mise à jour du projet avec l'auditeur assigné
        t.update(admin.firestore().collection('projects').doc(projectId), {
          'audit.assignedAuditorUid': auditorUid,
          'audit.assignedAuditorName': auditorData.displayName,
          'audit.assignedAt': admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return {
          auditId: auditRef.id,
          assignedAt: new Date().toISOString(),
          deadline: calculatedDeadline.toISOString(),
          status: 'assigned',
          notificationSent: false // Sera envoyée après la transaction
        };
      });

      // Envoi de la notification à l'auditeur
      await sendAuditorAssignmentNotification(auditorUid, projectData, result);

      functions.logger.info('Auditor assigned', {
        auditId: result.auditId,
        projectId,
        auditorUid,
        assignedBy: context.auth.uid
      });

      return {
        success: true,
        data: { ...result, notificationSent: true },
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      functions.logger.error('Error assigning auditor', {
        projectId: data?.projectId,
        auditorUid: data?.auditorUid,
        error: error.message
      });

      if (error instanceof functions.https.HttpsError) {
        throw error;
      }

      throw new functions.https.HttpsError('internal', 'Failed to assign auditor');
    }
  });

function calculateComplexity(projectData) {
  let complexity = 'medium';
  
  // Facteurs de complexité
  const factors = {
    highFunding: projectData.funding.goal > 2000000, // > 20k€
    manyMilestones: projectData.milestones?.length > 2,
    complexCategory: ['innovation', 'health'].includes(projectData.category),
    internationalScope: projectData.location?.country !== 'FR'
  };
  
  const complexityScore = Object.values(factors).filter(Boolean).length;
  
  if (complexityScore >= 3) complexity = 'high';
  else if (complexityScore <= 1) complexity = 'low';
  
  return complexity;
}

async function sendAuditorAssignmentNotification(auditorUid, projectData, auditResult) {
  const notificationData = {
    recipientUid: auditorUid,
    type: 'audit',
    subtype: 'assignment',
    priority: 'high',
    title: 'New Audit Assignment',
    message: `You have been assigned to audit the project: ${projectData.title}`,
    actionText: 'Review Assignment',
    actionUrl: `https://platform.socialimpact.com/audits/${auditResult.auditId}`,
    data: {
      auditId: auditResult.auditId,
      projectId: projectData.id,
      projectTitle: projectData.title,
      deadline: auditResult.deadline,
      compensation: 200 // En euros
    },
    channels: {
      inApp: { sent: false },
      email: { enabled: true, sent: false },
      push: { enabled: true, sent: false }
    },
    scheduling: {
      scheduleType: 'immediate'
    },
    expiresAt: admin.firestore.Timestamp.fromDate(
      new Date(Date.now() + 48 * 60 * 60 * 1000) // 48h pour répondre
    ),
    autoDelete: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  };

  await admin.firestore().collection('notifications').add(notificationData);
}
```

### 5.2 Function: submitAuditReport

```javascript
const Joi = require('joi');

// Schéma de validation pour rapport d'audit
const auditReportSchema = Joi.object({
  milestoneId: Joi.string().required(),
  decision: Joi.string().valid('approved', 'rejected', 'needs_revision').required(),
  score: Joi.number().min(0).max(100).required(),
  criteria: Joi.array().items(
    Joi.object({
      name: Joi.string().required(),
      met: Joi.boolean().required(),
      score: Joi.number().min(0).max(100).required(),
      comments: Joi.string().max(1000)
    })
  ).min(1).required(),
  report: Joi.object({
    summary: Joi.string().min(200).max(2000).required(),
    strengths: Joi.array().items(Joi.string()).min(1).max(5),
    weaknesses: Joi.array().items(Joi.string()).max(5),
    recommendations: Joi.array().items(Joi.string()).min(1).max(5),
    riskAssessment: Joi.string().valid('low', 'medium', 'high').required()
  }).required(),
  evidence: Joi.array().items(
    Joi.object({
      type: Joi.string().valid('document', 'image', 'video').required(),
      name: Joi.string().required(),
      content: Joi.string().required() // Base64
    })
  ).max(10)
});

exports.submitAuditReport = functions
  .region('europe-west1')
  .runWith({
    memory: '512MB',
    timeoutSeconds: 120
  })
  .https
  .onCall(async (data, context) => {
    try {
      // Vérification autorisation auditeur
      if (!context.auth || context.auth.token.role !== 'auditor') {
        throw new functions.https.HttpsError(
          'permission-denied',
          'Auditor role required'
        );
      }

      const auditorUid = context.auth.uid;
      const { auditId } = data;

      // Validation des données
      const { error, value } = auditReportSchema.validate(data);
      if (error) {
        throw new functions.https.HttpsError('invalid-argument', error.details[0].message);
      }

      // Vérification de l'audit
      const auditDoc = await admin.firestore()
        .collection('audits')
        .doc(auditId)
        .get();

      if (!auditDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Audit not found');
      }

      const auditData = auditDoc.data();

      // Vérification que l'auditeur est assigné
      if (auditData.auditor.uid !== auditorUid) {
        throw new functions.https.HttpsError(
          'permission-denied',
          'Not assigned to this audit'
        );
      }

      // Vérification du statut
      if (!['accepted', 'in_progress'].includes(auditData.status)) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Audit not in progress'
        );
      }

      // Vérification de la deadline
      if (auditData.timeline.deadline.toDate() < new Date()) {
        functions.logger.warn('Audit submitted after deadline', {
          auditId,
          deadline: auditData.timeline.deadline.toDate(),
          submittedAt: new Date()
        });
      }

      // Récupération de la milestone
      const milestoneDoc = await admin.firestore()
        .collection('projects')
        .doc(auditData.projectId)
        .collection('milestones')
        .doc(value.milestoneId)
        .get();

      if (!milestoneDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Milestone not found');
      }

      const milestoneData = milestoneDoc.data();

      // Vérification que la milestone est soumise
      if (milestoneData.status !== 'submitted') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Milestone not submitted for audit'
        );
      }

      // Upload des preuves d'audit
      const evidenceUrls = await uploadAuditEvidence(auditId, value.milestoneId, value.evidence);

      // Calcul du score global
      const globalScore = calculateGlobalScore(value.criteria);

      // Transaction pour soumettre le rapport
      const result = await admin.firestore().runTransaction(async (t) => {
        // Mise à jour de la milestone avec le rapport d'audit
        const milestoneRef = admin.firestore()
          .collection('projects')
          .doc(auditData.projectId)
          .collection('milestones')
          .doc(value.milestoneId);

        const auditInfo = {
          auditorUid: auditorUid,
          auditorName: auditData.auditor.displayName,
          assignedAt: auditData.timeline.assignedAt,
          startedAt: auditData.timeline.startedAt || admin.firestore.FieldValue.serverTimestamp(),
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
          deadline: auditData.timeline.deadline,
          
          score: globalScore,
          decision: value.decision,
          
          criteriaEvaluation: value.criteria,
          
          report: {
            ...value.report,
            confidence: calculateConfidence(value.criteria, value.report)
          },
          
          fundsReleased: value.decision === 'approved' ? milestoneData.budget.amount : 0,
          releaseDate: value.decision === 'approved' ? admin.firestore.FieldValue.serverTimestamp() : null
        };

        // Mise à jour du statut de la milestone
        const newMilestoneStatus = value.decision === 'approved' ? 'approved' : 
                                  value.decision === 'rejected' ? 'rejected' : 'needs_revision';

        t.update(milestoneRef, {
          status: newMilestoneStatus,
          audit: auditInfo,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Mise à jour de l'audit principal
        const auditRef = admin.firestore().collection('audits').doc(auditId);
        t.update(auditRef, {
          status: 'completed',
          'timeline.completedAt': admin.firestore.FieldValue.serverTimestamp(),
          'results.milestonesAudited': admin.firestore.FieldValue.increment(1),
          'results.averageScore': globalScore, // Simplification pour MVP
          [`results.total${value.decision === 'approved' ? 'Approved' : 
                       value.decision === 'rejected' ? 'Rejected' : 'Revisions'}`]: 
            admin.firestore.FieldValue.increment(1),
          'results.fundsReleased': value.decision === 'approved' ? 
            admin.firestore.FieldValue.increment(milestoneData.budget.amount) : 
            admin.firestore.FieldValue.increment(0),
          'compensation.status': 'approved', // Compensation approuvée après soumission
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        let nextMilestone = null;
        let fundsReleased = 0;

        // Si approuvé, processus de déblocage des fonds
        if (value.decision === 'approved') {
          fundsReleased = await processFundsRelease(t, auditData.projectId, value.milestoneId, milestoneData.budget.amount);
          
          // Recherche de la prochaine milestone
          const nextMilestonesSnapshot = await t.get(
            admin.firestore()
              .collection('projects')
              .doc(auditData.projectId)
              .collection('milestones')
              .where('order', '>', milestoneData.order)
              .orderBy('order')
              .limit(1)
          );

          if (!nextMilestonesSnapshot.empty) {
            const nextMilestoneData = nextMilestonesSnapshot.docs[0].data();
            nextMilestone = {
              id: nextMilestoneData.id,
              dueDate: nextMilestoneData.timeline.plannedEndDate.toDate().toISOString()
            };
          }
        }

        return {
          reportId: `${auditId}_${value.milestoneId}`,
          submittedAt: new Date().toISOString(),
          decision: value.decision,
          fundsReleased,
          nextMilestone,
          compensation: {
            amount: auditData.compensation.baseAmount,
            status: 'approved'
          }
        };
      });

      // Notifications post-transaction
      await sendAuditCompletionNotifications(auditData, value, result);

      // Si projet entièrement audité, vérifier statut final
      await checkProjectCompletionStatus(auditData.projectId);

      functions.logger.info('Audit report submitted', {
        auditId,
        milestoneId: value.milestoneId,
        auditorUid,
        decision: value.decision,
        score: globalScore,
        fundsReleased: result.fundsReleased
      });

      return {
        success: true,
        data: result,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      functions.logger.error('Error submitting audit report', {
        auditId: data?.auditId,
        milestoneId: data?.milestoneId,
        auditorUid: context.auth?.uid,
        error: error.message
      });

      if (error instanceof functions.https.HttpsError) {
        throw error;
      }

      throw new functions.https.HttpsError('internal', 'Failed to submit audit report');
    }
  });

// Fonctions utilitaires
function calculateGlobalScore(criteria) {
  if (criteria.length === 0) return 0;
  
  const totalScore = criteria.reduce((sum, criterion) => sum + criterion.score, 0);
  return Math.round(totalScore / criteria.length);
}

function calculateConfidence(criteria, report) {
  let confidence = 50; // Base
  
  // Augmente avec le nombre de critères évalués
  confidence += criteria.length * 5;
  
  // Augmente avec la longueur du rapport
  confidence += Math.min(report.summary.length / 50, 20);
  
  // Augmente avec le nombre de recommandations
  confidence += (report.recommendations?.length || 0) * 3;
  
  return Math.min(confidence, 100);
}

async function processFundsRelease(transaction, projectId, milestoneId, releaseAmount) {
  // Récupération de toutes les contributions pour ce projet
  const contributionsSnapshot = await transaction.get(
    admin.firestore()
      .collection('projects')
      .doc(projectId)
      .collection('contributions')
      .where('payment.status', '==', 'confirmed')
  );

  let totalReleased = 0;

  // Traitement de chaque contribution
  for (const contributionDoc of contributionsSnapshot.docs) {
    const contributionData = contributionDoc.data();
    const proportionalRelease = Math.round(
      contributionData.amount.gross * releaseAmount / 100 // releaseAmount est un pourcentage
    );

    // Mise à jour de l'escrow
    transaction.update(contributionDoc.ref, {
      'escrow.releasedAmount': admin.firestore.FieldValue.increment(proportionalRelease),
      [`escrow.releases`]: admin.firestore.FieldValue.arrayUnion({
        milestoneId,
        amount: proportionalRelease,
        releasedAt: admin.firestore.FieldValue.serverTimestamp(),
        reason: 'milestone_validated'
      }),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    totalReleased += proportionalRelease;

    // Création de la transaction de déblocage
    const releaseTransactionRef = admin.firestore().collection('transactions').doc();
    const releaseTransactionData = {
      id: releaseTransactionRef.id,
      type: 'payout',
      projectId,
      contributionId: contributionData.id,
      milestoneId,
      
      from: {
        type: 'platform',
        name: 'Platform Escrow'
      },
      to: {
        type: 'user',
        uid: contributionData.contributorUid,
        name: contributionData.contributor.displayName
      },
      
      amount: {
        gross: proportionalRelease,
        fees: 0,
        net: proportionalRelease,
        currency: 'EUR'
      },
      
      status: 'completed',
      external: {
        provider: 'stripe',
        externalId: `release_${milestoneId}_${contributionData.id}`
      },
      
      description: `Funds release for milestone validation: ${milestoneId}`,
      
      timeline: {
        initiatedAt: admin.firestore.FieldValue.serverTimestamp(),
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        completedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      
      reconciliation: {
        reconciled: false
      },
      
      auditTrail: [{
        action: 'funds_released',
        performedBy: 'system',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        details: `Milestone ${milestoneId} validated`
      }],
      
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      version: 1
    };

    transaction.set(releaseTransactionRef, releaseTransactionData);
  }

  return totalReleased;
}

async function uploadAuditEvidence(auditId, milestoneId, evidenceArray) {
  if (!evidenceArray || evidenceArray.length === 0) return [];

  const bucket = admin.storage().bucket();
  const evidenceUrls = [];

  for (let i = 0; i < evidenceArray.length; i++) {
    const evidence = evidenceArray[i];
    const buffer = Buffer.from(evidence.content, 'base64');
    
    const extension = evidence.type === 'image' ? 'jpg' : 
                     evidence.type === 'video' ? 'mp4' : 'pdf';
    
    const fileName = `audits/${auditId}/milestones/${milestoneId}/evidence_${i}.${extension}`;
    const file = bucket.file(fileName);
    
    await file.save(buffer, {
      metadata: {
        contentType: evidence.type === 'image' ? 'image/jpeg' :
                    evidence.type === 'video' ? 'video/mp4' : 'application/pdf',
        customMetadata: {
          originalName: evidence.name,
          evidenceType: evidence.type,
          auditId,
          milestoneId
        }
      }
    });

    evidenceUrls.push({
      type: evidence.type,
      name: evidence.name,
      url: `gs://${bucket.name}/${fileName}`,
      uploadedAt: new Date().toISOString()
    });
  }

  return evidenceUrls;
}
```

## 6. Notifications et communications

### 6.1 Function: sendNotification (Utilitaire)

```javascript
exports.sendNotification = functions
  .region('europe-west1')
  .runWith({
    memory: '256MB'
  })
  .https
  .onCall(async (data, context) => {
    try {
      // Cette function est utilisée pour envoyer des notifications programmatiques
      // Elle peut être appelée par d'autres functions ou par l'admin
      
      if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
      }

      const {
        recipientUid,
        type,
        subtype,
        title,
        message,
        data: notificationData = {},
        priority = 'medium',
        channels = { inApp: true, email: false, push: false }
      } = data;

      // Vérification que l'utilisateur destinataire existe
      const recipientDoc = await admin.firestore()
        .collection('users')
        .doc(recipientUid)
        .get();

      if (!recipientDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Recipient not found');
      }

      const recipientData = recipientDoc.data();

      // Respect des préférences de notification
      const userPreferences = recipientData.preferences?.notifications || {};
      const finalChannels = {
        inApp: { sent: false },
        email: { 
          enabled: channels.email && userPreferences.email !== false, 
          sent: false 
        },
        push: { 
          enabled: channels.push && userPreferences.push !== false, 
          sent: false 
        }
      };

      // Création du document notification
      const notificationDoc = {
        recipientUid,
        type,
        subtype,
        priority,
        title,
        message,
        data: notificationData,
        
        status: {
          read: false,
          clicked: false,
          dismissed: false
        },
        
        channels: finalChannels,
        
        scheduling: {
          scheduleType: 'immediate'
        },
        
        source: 'system',
        locale: recipientData.preferences?.language || 'fr',
        autoDelete: priority === 'low',
        
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        version: 1
      };

      // Ajout à la collection notifications
      const notificationRef = await admin.firestore()
        .collection('notifications')
        .add(notificationDoc);

      // Envoi immédiat selon les canaux activés
      const sendResults = {};

      // Notification in-app (toujours envoyée)
      sendResults.inApp = { sent: true, sentAt: new Date() };

      // Email si activé
      if (finalChannels.email.enabled) {
        try {
          await sendEmailNotification(recipientData, notificationDoc);
          sendResults.email = { sent: true, sentAt: new Date() };
        } catch (error) {
          functions.logger.error('Failed to send email notification', {
            notificationId: notificationRef.id,
            recipientUid,
            error: error.message
          });
          sendResults.email = { sent: false, error: error.message };
        }
      }

      // Push notification si activée
      if (finalChannels.push.enabled) {
        try {
          const messageId = await sendPushNotification(recipientUid, notificationDoc);
          sendResults.push = { sent: true, sentAt: new Date(), messageId };
        } catch (error) {
          functions.logger.error('Failed to send push notification', {
            notificationId: notificationRef.id,
            recipientUid,
            error: error.message
          });
          sendResults.push = { sent: false, error: error.message };
        }
      }

      // Mise à jour du statut d'envoi
      await notificationRef.update({
        channels: {
          inApp: sendResults.inApp,
          email: sendResults.email || finalChannels.email,
          push: sendResults.push || finalChannels.push
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      functions.logger.info('Notification sent', {
        notificationId: notificationRef.id,
        recipientUid,
        type,
        subtype,
        channels: Object.keys(sendResults).filter(k => sendResults[k].sent)
      });

      return {
        success: true,
        data: {
          notificationId: notificationRef.id,
          channels: sendResults
        },
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      functions.logger.error('Error sending notification', {
        recipientUid: data?.recipientUid,
        type: data?.type,
        error: error.message
      });

      if (error instanceof functions.https.HttpsError) {
        throw error;
      }

      throw new functions.https.HttpsError('internal', 'Failed to send notification');
    }
  });

async function sendEmailNotification(recipientData, notificationDoc) {
  // Utilisation de l'extension Firebase Email (SendGrid)
  const emailData = {
    to: recipientData.email,
    template: {
      name: getEmailTemplate(notificationDoc.type, notificationDoc.subtype),
      data: {
        firstName: recipientData.firstName,
        title: notificationDoc.title,
        message: notificationDoc.message,
        actionUrl: notificationDoc.data.actionUrl,
        actionText: notificationDoc.actionText || 'View Details',
        ...notificationDoc.data
      }
    }
  };

  return admin.firestore()
    .collection('mail')
    .add(emailData);
}

async function sendPushNotification(recipientUid, notificationDoc) {
  // Récupération des tokens FCM de l'utilisateur
  const tokensSnapshot = await admin.firestore()
    .collection('users')
    .doc(recipientUid)
    .collection('fcm_tokens')
    .where('active', '==', true)
    .get();

  if (tokensSnapshot.empty) {
    throw new Error('No active FCM tokens found');
  }

  const tokens = tokensSnapshot.docs.map(doc => doc.data().token);

  const message = {
    notification: {
      title: notificationDoc.title,
      body: notificationDoc.message
    },
    data: {
      type: notificationDoc.type,
      subtype: notificationDoc.subtype,
      notificationId: notificationDoc.id || '',
      ...Object.fromEntries(
        Object.entries(notificationDoc.data).map(([k, v]) => [k, String(v)])
      )
    },
    webpush: {
      fcmOptions: {
        link: notificationDoc.data.actionUrl || 'https://platform.socialimpact.com'
      }
    },
    tokens
  };

  const response = await admin.messaging().sendMulticast(message);

  // Nettoyage des tokens invalides
  const invalidTokens = [];
  response.responses.forEach((resp, idx) => {
    if (!resp.success && 
        (resp.error?.code === 'messaging/invalid-registration-token' ||
         resp.error?.code === 'messaging/registration-token-not-registered')) {
      invalidTokens.push(tokens[idx]);
    }
  });

  if (invalidTokens.length > 0) {
    // Suppression des tokens invalides
    const batch = admin.firestore().batch();
    for (const token of invalidTokens) {
      const tokenQuery = await admin.firestore()
        .collection('users')
        .doc(recipientUid)
        .collection('fcm_tokens')
        .where('token', '==', token)
        .limit(1)
        .get();
      
      if (!tokenQuery.empty) {
        batch.delete(tokenQuery.docs[0].ref);
      }
    }
    await batch.commit();
  }

  return response.responses.find(r => r.success)?.messageId;
}

function getEmailTemplate(type, subtype) {
  const templates = {
    'contribution_confirmed': 'contribution-confirmed',
    'kyc_approved': 'kyc-approved',
    'kyc_rejected': 'kyc-rejected',
    'project_approved': 'project-approved',
    'project_rejected': 'project-rejected',
    'milestone_validated': 'milestone-validated',
    'audit_assignment': 'audit-assignment',
    'audit_completed': 'audit-completed',
    'project_funded': 'project-funded',
    'welcome': 'welcome'
  };

  return templates[`${type}_${subtype}`] || templates[type] || 'generic-notification';
}
```

## 7. Tâches programmées

### 7.1 Function: dailyStats (Scheduled)

```javascript
exports.dailyStats = functions
  .region('europe-west1')
  .pubsub
  .schedule('0 1 * * *') // Tous les jours à 1h du matin
  .timeZone('Europe/Paris')
  .onRun(async (context) => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const todayTimestamp = admin.firestore.Timestamp.fromDate(today);
      const tomorrowTimestamp = admin.firestore.Timestamp.fromDate(tomorrow);

      // Collecte des statistiques du jour
      const stats = {
        date: todayTimestamp,
        users: await calculateUserStats(todayTimestamp, tomorrowTimestamp),
        projects: await calculateProjectStats(todayTimestamp, tomorrowTimestamp),
        contributions: await calculateContributionStats(todayTimestamp, tomorrowTimestamp),
        audits: await calculateAuditStats(todayTimestamp, tomorrowTimestamp)
      };

      // Sauvegarde des statistiques
      await admin.firestore()
        .collection('analytics')
        .doc('daily_stats')
        .collection('by_date')
        .doc(today.toISOString().split('T')[0])
        .set({
          ...stats,
          generatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

      // Mise à jour des statistiques globales
      await updateGlobalStats(stats);

      functions.logger.info('Daily stats calculated', {
        date: today.toISOString().split('T')[0],
        newUsers: stats.users.new,
        newProjects: stats.projects.new,
        totalContributions: stats.contributions.amount
      });

    } catch (error) {
      functions.logger.error('Error calculating daily stats', {
        error: error.message,
        stack: error.stack
      });
    }
  });

async function calculateUserStats(start, end) {
  // Nouveaux utilisateurs
  const newUsersSnapshot = await admin.firestore()
    .collection('users')
    .where('createdAt', '>=', start)
    .where('createdAt', '<', end)
    .get();

  // Utilisateurs actifs (connexion dans les dernières 24h)
  const activeUsersSnapshot = await admin.firestore()
    .collection('users')
    .where('stats.lastLoginAt', '>=', start)
    .get();

  // Statistiques KYC
  const kycStats = {
    pending: 0,
    approved: 0,
    rejected: 0
  };

  newUsersSnapshot.docs.forEach(doc => {
    const user = doc.data();
    kycStats[user.kyc.status]++;
  });

  return {
    new: newUsersSnapshot.size,
    active: activeUsersSnapshot.size,
    kyc: kycStats
  };
}

async function calculateProjectStats(start, end) {
  // Nouveaux projets
  const newProjectsSnapshot = await admin.firestore()
    .collection('projects')
    .where('createdAt', '>=', start)
    .where('createdAt', '<', end)
    .get();

  // Projets par statut
  const statusStats = {
    draft: 0,
    under_review: 0,
    live: 0,
    funded: 0,
    completed: 0
  };

  const categoryStats = {
    environment: 0,
    education: 0,
    health: 0,
    community: 0,
    innovation: 0
  };

  newProjectsSnapshot.docs.forEach(doc => {
    const project = doc.data();
    statusStats[project.status]++;
    categoryStats[project.category]++;
  });

  return {
    new: newProjectsSnapshot.size,
    byStatus: statusStats,
    byCategory: categoryStats
  };
}

async function calculateContributionStats(start, end) {
  // Nouvelles contributions
  const contributionsSnapshot = await admin.firestore()
    .collectionGroup('contributions')
    .where('createdAt', '>=', start)
    .where('createdAt', '<', end)
    .where('payment.status', '==', 'confirmed')
    .get();

  let totalAmount = 0;
  let count = 0;
  const amounts = [];

  contributionsSnapshot.docs.forEach(doc => {
    const contribution = doc.data();
    totalAmount += contribution.amount.gross;
    amounts.push(contribution.amount.gross);
    count++;
  });

  amounts.sort((a, b) => a - b);
  const median = amounts.length > 0 ? 
    amounts[Math.floor(amounts.length / 2)] : 0;

  return {
    count,
    amount: totalAmount,
    average: count > 0 ? Math.round(totalAmount / count) : 0,
    median
  };
}

async function calculateAuditStats(start, end) {
  // Audits complétés
  const completedAuditsSnapshot = await admin.firestore()
    .collection('audits')
    .where('timeline.completedAt', '>=', start)
    .where('timeline.completedAt', '<', end)
    .get();

  let approvals = 0;
  let rejections = 0;
  let totalProcessingTime = 0;

  completedAuditsSnapshot.docs.forEach(doc => {
    const audit = doc.data();
    if (audit.results.totalApproved > 0) approvals++;
    if (audit.results.totalRejected > 0) rejections++;
    
    if (audit.timeline.startedAt && audit.timeline.completedAt) {
      const processingTime = audit.timeline.completedAt.seconds - audit.timeline.startedAt.seconds;
      totalProcessingTime += processingTime;
    }
  });

  return {
    completed: completedAuditsSnapshot.size,
    approvals,
    rejections,
    averageProcessingTime: completedAuditsSnapshot.size > 0 ? 
      Math.round(totalProcessingTime / completedAuditsSnapshot.size / 3600) : 0 // En heures
  };
}
```

### 7.2 Function: projectDeadlines (Scheduled)

```javascript
exports.projectDeadlines = functions
  .region('europe-west1')
  .pubsub
  .schedule('0 */6 * * *') // Toutes les 6 heures
  .timeZone('Europe/Paris')
  .onRun(async (context) => {
    try {
      const now = admin.firestore.Timestamp.now();
      const in24Hours = admin.firestore.Timestamp.fromDate(
        new Date(Date.now() + 24 * 60 * 60 * 1000)
      );
      const in48Hours = admin.firestore.Timestamp.fromDate(
        new Date(Date.now() + 48 * 60 * 60 * 1000)
      );

      // Projets arrivant à échéance dans 24h
      await handleProjectsEndingSoon(now, in24Hours, '24h');
      
      // Projets arrivant à échéance dans 48h
      await handleProjectsEndingSoon(now, in48Hours, '48h');

      // Projets expirés
      await handleExpiredProjects(now);

      // Audits en retard
      await handleOverdueAudits(now);

      functions.logger.info('Project deadlines check completed');

    } catch (error) {
      functions.logger.error('Error checking project deadlines', {
        error: error.message
      });
    }
  });

async function handleProjectsEndingSoon(now, deadline, timeframe) {
  const projectsSnapshot = await admin.firestore()
    .collection('projects')
    .where('status', '==', 'live')
    .where('timeline.endDate', '>', now)
    .where('timeline.endDate', '<=', deadline)
    .get();

  for (const projectDoc of projectsSnapshot.docs) {
    const projectData = projectDoc.data();
    
    // Notification au créateur
    await admin.firestore().collection('notifications').add({
      recipientUid: projectData.creator.uid,
      type: 'project',
      subtype: 'deadline_warning',
      priority: 'high',
      title: `Project Deadline Approaching`,
      message: `Your project "${projectData.title}" ends in ${timeframe}`,
      data: {
        projectId: projectData.id,
        timeframe,
        currentFunding: projectData.funding.percentage
      },
      channels: {
        inApp: { sent: false },
        email: { enabled: true, sent: false },
        push: { enabled: true, sent: false }
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Si moins de 80% financé, notification aux contributeurs potentiels
    if (projectData.funding.percentage < 80) {
      await notifyInterestedUsers(projectData, timeframe);
    }
  }
}

async function handleExpiredProjects(now) {
  const expiredProjectsSnapshot = await admin.firestore()
    .collection('projects')
    .where('status', '==', 'live')
    .where('timeline.endDate', '<=', now)
    .get();

  for (const projectDoc of expiredProjectsSnapshot.docs) {
    const projectData = projectDoc.data();
    const newStatus = projectData.funding.percentage >= 100 ? 'funded' : 'failed';
    
    // Mise à jour du statut
    await projectDoc.ref.update({
      status: newStatus,
      'timeline.completedAt': admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    if (newStatus === 'failed') {
      // Processus de remboursement automatique
      await initiateRefundProcess(projectData.id);
    } else {
      // Notification de succès
      await notifyProjectSuccess(projectData);
    }

    functions.logger.info('Project status updated', {
      projectId: projectData.id,
      oldStatus: 'live',
      newStatus,
      fundingPercentage: projectData.funding.percentage
    });
  }
}

async function handleOverdueAudits(now) {
  const overdueAuditsSnapshot = await admin.firestore()
    .collection('audits')
    .where('status', 'in', ['assigned', 'accepted', 'in_progress'])
    .where('timeline.deadline', '<=', now)
    .get();

  for (const auditDoc of overdueAuditsSnapshot.docs) {
    const auditData = auditDoc.data();
    
    // Marquer comme en retard
    await auditDoc.ref.update({
      'timeline.isOverdue': true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Notification à l'auditeur
    await admin.firestore().collection('notifications').add({
      recipientUid: auditData.auditor.uid,
      type: 'audit',
      subtype: 'overdue',
      priority: 'urgent',
      title: 'Audit Overdue',
      message: `Your audit for "${auditData.projectTitle}" is overdue`,
      data: {
        auditId: auditData.id,
        projectId: auditData.projectId,
        deadlineDate: auditData.timeline.deadline.toDate().toISOString()
      },
      channels: {
        inApp: { sent: false },
        email: { enabled: true, sent: false },
        push: { enabled: true, sent: false }
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Notification à l'admin après 24h de retard
    const delay = now.seconds - auditData.timeline.deadline.seconds;
    if (delay > 24 * 60 * 60) { // 24h
      await notifyAdminOverdueAudit(auditData, delay);
    }
  }
}
```

Cette documentation complète des Firebase Functions couvre tous les aspects essentiels du backend MVP. Les développeurs backend peuvent utiliser ces spécifications pour implémenter l'ensemble du système de manière autonome et complète.