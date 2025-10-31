# Sécurité Backend et Intégrations Externes
## Social Finance Impact Platform MVP

## 1. Architecture de sécurité globale

### 1.1 Modèle de sécurité multicouche

```
┌─────────────────────────────────────────────────────────────┐
│                    Layer 1: Client Security                 │
│              Firebase App Check + reCAPTCHA                 │
├─────────────────────────────────────────────────────────────┤
│                   Layer 2: Authentication                   │
│              Firebase Auth + Custom Claims                  │
├─────────────────────────────────────────────────────────────┤
│                   Layer 3: Authorization                    │
│              Firestore Security Rules + RBAC               │
├─────────────────────────────────────────────────────────────┤
│                   Layer 4: Business Logic                   │
│              Firebase Functions Validation                  │
├─────────────────────────────────────────────────────────────┤
│                   Layer 5: Data Security                    │
│              Firestore Encryption + Audit Logs             │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Principes de sécurité fondamentaux

**Principe de moindre privilège**
Chaque utilisateur et service ne dispose que des permissions minimales nécessaires à sa fonction. Les rôles sont granulaires et les accès sont vérifiés à chaque niveau.

**Défense en profondeur**
Plusieurs couches de sécurité indépendantes protègent les données et les opérations critiques. La compromission d'une couche ne compromet pas l'ensemble du système.

**Validation systématique**
Toutes les entrées utilisateur sont validées côté client ET serveur. Aucune donnée externe n'est considérée comme fiable sans validation.

**Audit et traçabilité**
Toutes les actions sensibles sont loggées avec horodatage, utilisateur, et contexte pour permettre l'audit et la détection d'anomalies.

## 2. Firestore Security Rules détaillées

### 2.1 Règles globales et utilitaires

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Fonctions utilitaires globales
    function isAuthenticated() {
      return request.auth != null;
    }
    
    function getCurrentUser() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid));
    }
    
    function hasRole(role) {
      return isAuthenticated() && 
             request.auth.token.role == role;
    }
    
    function hasAnyRole(roles) {
      return isAuthenticated() && 
             request.auth.token.role in roles;
    }
    
    function hasPermission(permission) {
      return isAuthenticated() && 
             permission in request.auth.token.permissions;
    }
    
    function isKYCApproved() {
      return isAuthenticated() && 
             request.auth.token.kycStatus == 'approved';
    }
    
    function getKYCLevel() {
      return isAuthenticated() ? 
             request.auth.token.kycLevel : 0;
    }
    
    function isOwner(uid) {
      return isAuthenticated() && 
             request.auth.uid == uid;
    }
    
    function isProjectCreator(projectId) {
      let project = get(/databases/$(database)/documents/projects/$(projectId));
      return isAuthenticated() && 
             request.auth.uid == project.data.creator.uid;
    }
    
    function isAuditorAssigned(auditId) {
      let audit = get(/databases/$(database)/documents/audits/$(auditId));
      return isAuthenticated() && 
             request.auth.uid == audit.data.auditor.uid;
    }
    
    // Validation des données
    function isValidEmail(email) {
      return email.matches('^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$');
    }
    
    function isValidString(str, minLength, maxLength) {
      return str is string && 
             str.size() >= minLength && 
             str.size() <= maxLength;
    }
    
    function isValidAmount(amount) {
      return amount is number && 
             amount >= 1000 && 
             amount <= 10000000; // 10€ à 100k€ en centimes
    }
    
    function isValidDate(date) {
      return date is timestamp && 
             date > request.time;
    }
```

### 2.2 Règles pour la collection Users

```javascript
    // Collection Users - Profils utilisateur
    match /users/{userId} {
      // Lecture du profil
      allow read: if isOwner(userId) || 
                     hasRole('admin') ||
                     (isAuthenticated() && 
                      resource.data.privacy.profilePublic == true);
      
      // Création du profil (seulement par l'utilisateur propriétaire)
      allow create: if isOwner(userId) && 
                       isValidUserData(request.resource.data) &&
                       request.resource.data.uid == userId &&
                       request.resource.data.email == request.auth.token.email;
      
      // Mise à jour du profil
      allow update: if isOwner(userId) && 
                       isValidUserUpdate(request.resource.data, resource.data) ||
                       hasRole('admin');
      
      // Suppression (soft delete seulement par admin)
      allow delete: if hasRole('admin');
      
      function isValidUserData(data) {
        return data.keys().hasAll(['uid', 'email', 'firstName', 'lastName', 'userType']) &&
               isValidString(data.firstName, 2, 50) &&
               isValidString(data.lastName, 2, 50) &&
               isValidEmail(data.email) &&
               data.userType in ['contributor', 'creator'] &&
               data.kyc.status == 'pending' &&
               data.accountStatus == 'active';
      }
      
      function isValidUserUpdate(newData, oldData) {
        return // Champs modifiables par l'utilisateur
               (!('firstName' in newData) || newData.firstName == oldData.firstName) &&
               (!('lastName' in newData) || newData.lastName == oldData.lastName) &&
               (!('email' in newData) || newData.email == oldData.email) &&
               (!('userType' in newData) || newData.userType == oldData.userType) &&
               // Champs KYC non modifiables
               (!('kyc' in newData) || newData.kyc == oldData.kyc) &&
               // Autres validations
               (!('bio' in newData) || isValidString(newData.bio, 0, 500)) &&
               (!('preferences' in newData) || isValidPreferences(newData.preferences));
      }
      
      function isValidPreferences(prefs) {
        return prefs.language in ['fr', 'en'] &&
               prefs.currency == 'EUR' &&
               prefs.notifications.email is bool &&
               prefs.notifications.push is bool &&
               prefs.notifications.inApp is bool;
      }
    }
```

### 2.3 Règles pour la collection Projects

```javascript
    // Collection Projects
    match /projects/{projectId} {
      // Lecture des projets
      allow read: if isAuthenticated() && 
                     (resource.data.status in ['live', 'funded', 'active', 'completed'] ||
                      isProjectCreator(projectId) ||
                      hasRole('admin'));
      
      // Création de projet
      allow create: if hasRole('creator') && 
                       isKYCApproved() && 
                       getKYCLevel() >= 2 &&
                       isValidProjectData(request.resource.data) &&
                       request.resource.data.creator.uid == request.auth.uid;
      
      // Mise à jour de projet
      allow update: if (isProjectCreator(projectId) && 
                        isValidProjectUpdate(request.resource.data, resource.data)) ||
                       hasRole('admin');
      
      // Suppression (soft delete par admin seulement)
      allow delete: if hasRole('admin');
      
      function isValidProjectData(data) {
        return data.keys().hasAll(['title', 'shortDescription', 'fullDescription', 
                                  'category', 'funding', 'creator', 'status']) &&
               isValidString(data.title, 10, 100) &&
               isValidString(data.shortDescription, 50, 200) &&
               isValidString(data.fullDescription, 500, 5000) &&
               data.category in ['environment', 'education', 'health', 'community', 'innovation'] &&
               isValidFunding(data.funding) &&
               data.status == 'draft' &&
               data.creator.uid == request.auth.uid;
      }
      
      function isValidFunding(funding) {
        return funding.goal >= 100000 && // Minimum 1000€
               funding.goal <= 5000000 && // Maximum 50k€
               funding.currency == 'EUR' &&
               funding.raised == 0 &&
               funding.percentage == 0 &&
               funding.contributorsCount == 0;
      }
      
      function isValidProjectUpdate(newData, oldData) {
        let unchangedFields = ['id', 'creator', 'createdAt'];
        return // Vérification que les champs protégés ne changent pas
               (newData.diff(oldData).unchangedKeys().hasAll(unchangedFields)) &&
               // Seuls certains champs peuvent être modifiés selon le statut
               isValidStatusTransition(newData.status, oldData.status) &&
               // Validations selon le statut
               (oldData.status == 'draft' || 
                hasRole('admin') || 
                isSystemUpdate(newData, oldData));
      }
      
      function isValidStatusTransition(newStatus, oldStatus) {
        return (oldStatus == 'draft' && newStatus == 'under_review') ||
               (oldStatus == 'under_review' && newStatus in ['live', 'rejected']) ||
               (oldStatus == 'live' && newStatus in ['funded', 'failed']) ||
               (oldStatus == 'funded' && newStatus == 'active') ||
               (oldStatus == 'active' && newStatus in ['completed', 'failed']) ||
               hasRole('admin');
      }
      
      function isSystemUpdate(newData, oldData) {
        // Mises à jour système autorisées (ex: stats de financement)
        return newData.diff(oldData).changedKeys().hasOnly(['funding', 'analytics', 'updatedAt']);
      }
      
      // Sous-collection Contributions
      match /contributions/{contributionId} {
        allow read: if isAuthenticated() && 
                       (resource.data.contributorUid == request.auth.uid ||
                        isProjectCreator(projectId) ||
                        hasRole('admin'));
        
        allow create: if isAuthenticated() && 
                         isKYCApproved() && 
                         isValidContribution(request.resource.data) &&
                         request.resource.data.contributorUid == request.auth.uid;
        
        // Mises à jour système seulement (via Functions)
        allow update: if false; // Toutes les mises à jour via Functions
        
        allow delete: if hasRole('admin');
        
        function isValidContribution(data) {
          return data.contributorUid == request.auth.uid &&
                 isValidAmount(data.amount.gross) &&
                 data.amount.currency == 'EUR' &&
                 data.payment.status == 'pending' &&
                 (getKYCLevel() == 1 && data.amount.gross <= 100000 ||
                  getKYCLevel() >= 2 && data.amount.gross <= 1000000);
        }
      }
      
      // Sous-collection Milestones
      match /milestones/{milestoneId} {
        allow read: if isAuthenticated() && 
                       (resource.data.status in ['approved', 'rejected'] ||
                        isProjectCreator(projectId) ||
                        hasRole('admin') ||
                        hasRole('auditor'));
        
        allow create: if isProjectCreator(projectId) && 
                         isValidMilestone(request.resource.data);
        
        allow update: if isProjectCreator(projectId) || 
                         hasRole('admin') ||
                         (hasRole('auditor') && 
                          isValidAuditUpdate(request.resource.data, resource.data));
        
        allow delete: if isProjectCreator(projectId) || hasRole('admin');
        
        function isValidMilestone(data) {
          return data.projectId == projectId &&
                 isValidString(data.title, 5, 100) &&
                 isValidString(data.description, 50, 1000) &&
                 data.budget.percentage >= 10 &&
                 data.budget.percentage <= 70 &&
                 data.status == 'pending';
        }
        
        function isValidAuditUpdate(newData, oldData) {
          return newData.status in ['under_audit', 'approved', 'rejected', 'needs_revision'] &&
                 ('audit' in newData) &&
                 newData.audit.auditorUid == request.auth.uid;
        }
      }
    }
```

### 2.4 Règles pour les collections sensibles

```javascript
    // Collection Audits
    match /audits/{auditId} {
      allow read: if isAuditorAssigned(auditId) ||
                     hasRole('admin') ||
                     (isAuthenticated() && 
                      resource.data.creatorUid == request.auth.uid);
      
      allow create: if hasRole('admin');
      
      allow update: if (isAuditorAssigned(auditId) && 
                        isValidAuditUpdate(request.resource.data, resource.data)) ||
                       hasRole('admin');
      
      allow delete: if hasRole('admin');
      
      function isValidAuditUpdate(newData, oldData) {
        return // Auditeur peut accepter/décliner et soumettre rapports
               (oldData.status == 'assigned' && 
                newData.status in ['accepted', 'declined']) ||
               (oldData.status in ['accepted', 'in_progress'] && 
                newData.status in ['completed', 'in_progress']) ||
               // Admin peut tout modifier
               hasRole('admin');
      }
    }
    
    // Collection Transactions (lecture seule pour utilisateurs)
    match /transactions/{transactionId} {
      allow read: if hasRole('admin') ||
                     (isAuthenticated() && 
                      (resource.data.from.uid == request.auth.uid ||
                       resource.data.to.uid == request.auth.uid));
      
      allow write: if false; // Création via Functions seulement
    }
    
    // Collection Notifications
    match /notifications/{notificationId} {
      allow read: if isAuthenticated() && 
                     resource.data.recipientUid == request.auth.uid;
      
      allow update: if isAuthenticated() && 
                       resource.data.recipientUid == request.auth.uid &&
                       isValidNotificationUpdate(request.resource.data, resource.data);
      
      allow create, delete: if false; // Gestion via Functions
      
      function isValidNotificationUpdate(newData, oldData) {
        // Utilisateur peut seulement marquer comme lu/cliqué/dismissed
        return newData.diff(oldData).changedKeys().hasOnly(['status', 'updatedAt']) &&
               (newData.status.read == true || oldData.status.read == newData.status.read) &&
               (newData.status.clicked == true || oldData.status.clicked == newData.status.clicked) &&
               (newData.status.dismissed == true || oldData.status.dismissed == newData.status.dismissed);
      }
    }
    
    // Collection System Config (admin seulement)
    match /system_config/{configId} {
      allow read: if isAuthenticated();
      allow write: if hasRole('admin');
    }
    
    // Collection Analytics (admin seulement)
    match /analytics/{path=**} {
      allow read: if hasRole('admin');
      allow write: if false; // Génération automatique
    }
  }
}
```

## 3. Firebase Storage Security Rules

### 3.1 Règles de sécurité Storage

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    
    // Fonctions utilitaires
    function isAuthenticated() {
      return request.auth != null;
    }
    
    function isOwner(userId) {
      return request.auth.uid == userId;
    }
    
    function hasRole(role) {
      return request.auth != null && 
             request.auth.token.role == role;
    }
    
    function isValidImageSize() {
      return resource.size <= 5 * 1024 * 1024; // 5MB max
    }
    
    function isValidDocumentSize() {
      return resource.size <= 10 * 1024 * 1024; // 10MB max
    }
    
    function isValidImageType() {
      return resource.contentType.matches('image/.*');
    }
    
    function isValidDocumentType() {
      return resource.contentType in ['application/pdf', 
                                      'application/msword',
                                      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    }
    
    function getProjectCreator(projectId) {
      return firestore.get(/databases/(default)/documents/projects/$(projectId)).data.creator.uid;
    }
    
    // Photos de profil utilisateur
    match /users/{userId}/profile/{fileName} {
      allow read: if isAuthenticated();
      
      allow write: if isOwner(userId) && 
                      isValidImageSize() && 
                      isValidImageType();
      
      allow delete: if isOwner(userId) || hasRole('admin');
    }
    
    // Documents KYC (très sensibles)
    match /users/{userId}/kyc/{fileName} {
      allow read: if isOwner(userId) || hasRole('admin');
      
      allow write: if isOwner(userId) && 
                      isValidDocumentSize() && 
                      (isValidImageType() || isValidDocumentType());
      
      allow delete: if hasRole('admin'); // KYC docs ne peuvent pas être supprimés par l'utilisateur
    }
    
    // Images de projet
    match /projects/{projectId}/images/{fileName} {
      allow read: if isAuthenticated();
      
      allow write: if isAuthenticated() && 
                      request.auth.uid == getProjectCreator(projectId) &&
                      isValidImageSize() && 
                      isValidImageType();
      
      allow delete: if isAuthenticated() && 
                       (request.auth.uid == getProjectCreator(projectId) || 
                        hasRole('admin'));
    }
    
    // Documents de projet
    match /projects/{projectId}/documents/{fileName} {
      allow read: if isAuthenticated() && 
                     (request.auth.uid == getProjectCreator(projectId) ||
                      hasRole('admin') ||
                      hasRole('auditor'));
      
      allow write: if isAuthenticated() && 
                      request.auth.uid == getProjectCreator(projectId) &&
                      isValidDocumentSize() && 
                      isValidDocumentType();
      
      allow delete: if isAuthenticated() && 
                       (request.auth.uid == getProjectCreator(projectId) || 
                        hasRole('admin'));
    }
    
    // Preuves de milestones
    match /milestones/{milestoneId}/evidence/{fileName} {
      allow read: if hasRole('admin') || hasRole('auditor');
      
      allow write: if isAuthenticated() && 
                      isValidDocumentSize() && 
                      (isValidImageType() || isValidDocumentType());
      
      allow delete: if hasRole('admin');
    }
    
    // Rapports d'audit
    match /audits/{auditId}/reports/{fileName} {
      allow read: if hasRole('admin') || 
                     hasRole('auditor');
      
      allow write: if hasRole('auditor') && 
                      isValidDocumentSize() && 
                      isValidDocumentType();
      
      allow delete: if hasRole('admin');
    }
    
    // Deny all other paths
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

## 4. Intégrations externes sécurisées

### 4.1 Intégration Sumsub (KYC/AML)

**Configuration sécurisée**
```javascript
// Configuration stockée dans Firebase Config
const sumsubConfig = {
  baseURL: 'https://api.sumsub.com',
  appToken: functions.config().sumsub.app_token,
  secretKey: functions.config().sumsub.secret_key,
  webhookSecret: functions.config().sumsub.webhook_secret,
  levels: {
    basic: functions.config().sumsub.basic_level,
    enhanced: functions.config().sumsub.enhanced_level
  },
  testMode: functions.config().sumsub.test_mode === 'true'
};

// Classe utilitaire sécurisée pour Sumsub
class SumsubService {
  constructor(config) {
    this.config = config;
    this.client = axios.create({
      baseURL: config.baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'X-App-Token': config.appToken
      }
    });
  }
  
  // Génération de signature sécurisée
  generateSignature(method, url, body = '') {
    const timestamp = Math.floor(Date.now() / 1000);
    const message = timestamp + method.toUpperCase() + url + body;
    
    const signature = crypto
      .createHmac('sha256', this.config.secretKey)
      .update(message)
      .digest('hex');
    
    return { signature, timestamp };
  }
  
  // Création d'applicant avec validation
  async createApplicant(userData, levelName) {
    this.validateUserData(userData);
    
    const url = `/resources/applicants?levelName=${levelName}`;
    const body = JSON.stringify({
      externalUserId: userData.externalUserId,
      info: {
        firstName: userData.firstName,
        lastName: userData.lastName,
        dob: userData.dateOfBirth,
        country: userData.country,
        phone: userData.phoneNumber
      },
      email: userData.email
    });
    
    const { signature, timestamp } = this.generateSignature('POST', url, body);
    
    try {
      const response = await this.client.post(url, body, {
        headers: {
          'X-App-Access-Sig': signature,
          'X-App-Access-Ts': timestamp
        }
      });
      
      functions.logger.info('Sumsub applicant created', {
        externalUserId: userData.externalUserId,
        applicantId: response.data.id
      });
      
      return response.data;
    } catch (error) {
      functions.logger.error('Sumsub API error', {
        endpoint: url,
        error: error.response?.data || error.message
      });
      throw new Error('KYC service temporarily unavailable');
    }
  }
  
  // Génération de token d'accès
  async generateAccessToken(externalUserId, levelName, ttlInSecs = 86400) {
    const url = `/resources/accessTokens?userId=${externalUserId}&levelName=${levelName}&ttlInSecs=${ttlInSecs}`;
    const { signature, timestamp } = this.generateSignature('POST', url);
    
    try {
      const response = await this.client.post(url, {}, {
        headers: {
          'X-App-Access-Sig': signature,
          'X-App-Access-Ts': timestamp
        }
      });
      
      return response.data.token;
    } catch (error) {
      functions.logger.error('Sumsub token generation error', {
        externalUserId,
        error: error.response?.data || error.message
      });
      throw new Error('Failed to generate KYC access token');
    }
  }
  
  // Vérification de webhook
  verifyWebhookSignature(payload, signature) {
    const expectedSignature = crypto
      .createHmac('sha256', this.config.webhookSecret)
      .update(payload)
      .digest('hex');
    
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  }
  
  // Validation des données utilisateur
  validateUserData(userData) {
    const required = ['externalUserId', 'firstName', 'lastName', 'email', 'country'];
    const missing = required.filter(field => !userData[field]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required fields: ${missing.join(', ')}`);
    }
    
    if (!this.isValidEmail(userData.email)) {
      throw new Error('Invalid email format');
    }
    
    if (!this.isValidCountryCode(userData.country)) {
      throw new Error('Invalid country code');
    }
  }
  
  isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }
  
  isValidCountryCode(country) {
    return /^[A-Z]{2}$/.test(country);
  }
}
```

### 4.2 Intégration Stripe (Paiements)

**Configuration sécurisée**
```javascript
const stripe = require('stripe')(functions.config().stripe.secret_key);

// Service Stripe sécurisé
class StripeService {
  constructor() {
    this.stripe = stripe;
    this.webhookSecret = functions.config().stripe.webhook_secret;
    this.platformAccountId = functions.config().stripe.platform_account_id;
  }
  
  // Création de PaymentIntent sécurisée
  async createPaymentIntent(amount, projectData, contributorData) {
    this.validatePaymentData(amount, projectData, contributorData);
    
    try {
      const paymentIntent = await this.stripe.paymentIntents.create({
        amount,
        currency: 'eur',
        automatic_payment_methods: {
          enabled: true
        },
        
        // Métadonnées pour traçabilité
        metadata: {
          projectId: projectData.id,
          projectTitle: projectData.title,
          contributorUid: contributorData.uid,
          contributorEmail: contributorData.email,
          creatorUid: projectData.creator.uid,
          platform: 'social-impact-mvp',
          environment: functions.config().environment || 'production'
        },
        
        // Description pour relevé bancaire
        description: `Social Impact: ${projectData.title}`,
        statement_descriptor: 'SOCIAL IMPACT',
        
        // Configuration escrow
        transfer_data: {
          destination: projectData.stripeAccountId, // Compte du créateur
          amount: Math.round(amount * 0.92) // 92% après frais plateforme (5%) + audit (3%)
        },
        
        application_fee_amount: Math.round(amount * 0.08), // 8% frais total
        
        // Configuration 3D Secure
        confirmation_method: 'automatic',
        payment_method_options: {
          card: {
            request_three_d_secure: 'automatic'
          }
        }
      });
      
      functions.logger.info('Stripe PaymentIntent created', {
        paymentIntentId: paymentIntent.id,
        amount,
        projectId: projectData.id,
        contributorUid: contributorData.uid
      });
      
      return paymentIntent;
    } catch (error) {
      functions.logger.error('Stripe PaymentIntent creation failed', {
        amount,
        projectId: projectData.id,
        error: error.message
      });
      throw new Error('Payment processing temporarily unavailable');
    }
  }
  
  // Vérification de webhook Stripe
  verifyWebhookSignature(payload, signature) {
    try {
      return this.stripe.webhooks.constructEvent(
        payload, 
        signature, 
        this.webhookSecret
      );
    } catch (error) {
      functions.logger.error('Stripe webhook verification failed', {
        error: error.message
      });
      throw new Error('Invalid webhook signature');
    }
  }
  
  // Création de remboursement sécurisé
  async createRefund(paymentIntentId, amount, reason = 'project_failed') {
    try {
      const refund = await this.stripe.refunds.create({
        payment_intent: paymentIntentId,
        amount,
        reason: 'requested_by_customer',
        metadata: {
          refund_reason: reason,
          processed_by: 'system',
          timestamp: new Date().toISOString()
        }
      });
      
      functions.logger.info('Stripe refund created', {
        refundId: refund.id,
        paymentIntentId,
        amount,
        reason
      });
      
      return refund;
    } catch (error) {
      functions.logger.error('Stripe refund failed', {
        paymentIntentId,
        amount,
        error: error.message
      });
      throw new Error('Refund processing failed');
    }
  }
  
  // Validation des données de paiement
  validatePaymentData(amount, projectData, contributorData) {
    if (!amount || amount < 1000 || amount > 10000000) {
      throw new Error('Invalid payment amount');
    }
    
    if (!projectData?.id || !projectData?.title || !projectData?.creator?.uid) {
      throw new Error('Invalid project data');
    }
    
    if (!contributorData?.uid || !contributorData?.email) {
      throw new Error('Invalid contributor data');
    }
    
    if (projectData.status !== 'live') {
      throw new Error('Project not accepting contributions');
    }
  }
  
  // Calcul sécurisé des frais
  calculateFees(amount) {
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
}
```

### 4.3 Intégration SendGrid (Emails)

**Configuration et templates sécurisés**
```javascript
// Configuration SendGrid via Firebase Extensions
const emailService = {
  templateIds: {
    welcome: functions.config().sendgrid.templates.welcome,
    kycApproved: functions.config().sendgrid.templates.kyc_approved,
    kycRejected: functions.config().sendgrid.templates.kyc_rejected,
    contributionConfirmed: functions.config().sendgrid.templates.contribution_confirmed,
    projectApproved: functions.config().sendgrid.templates.project_approved,
    milestoneValidated: functions.config().sendgrid.templates.milestone_validated,
    auditAssigned: functions.config().sendgrid.templates.audit_assigned
  },
  
  fromEmail: functions.config().sendgrid.from_email || 'noreply@socialimpact.com',
  fromName: functions.config().sendgrid.from_name || 'Social Impact Platform'
};

// Service d'email sécurisé
class EmailService {
  constructor() {
    this.templates = emailService.templateIds;
    this.fromEmail = emailService.fromEmail;
    this.fromName = emailService.fromName;
  }
  
  // Envoi d'email sécurisé via Firebase Extension
  async sendEmail(to, templateType, templateData, options = {}) {
    this.validateEmailData(to, templateType, templateData);
    
    const templateId = this.templates[templateType];
    if (!templateId) {
      throw new Error(`Unknown email template: ${templateType}`);
    }
    
    const emailDoc = {
      to: [{ email: to, name: templateData.firstName || '' }],
      from: {
        email: this.fromEmail,
        name: this.fromName
      },
      templateId,
      dynamicTemplateData: {
        ...templateData,
        platformUrl: 'https://platform.socialimpact.com',
        supportEmail: 'support@socialimpact.com',
        unsubscribeUrl: `https://platform.socialimpact.com/unsubscribe?email=${encodeURIComponent(to)}`,
        timestamp: new Date().toISOString()
      },
      categories: [templateType, 'automated'],
      customArgs: {
        template_type: templateType,
        environment: functions.config().environment || 'production'
      }
    };
    
    try {
      const emailRef = await admin.firestore()
        .collection('mail')
        .add(emailDoc);
      
      functions.logger.info('Email queued for sending', {
        emailId: emailRef.id,
        to,
        templateType,
        templateId
      });
      
      return emailRef.id;
    } catch (error) {
      functions.logger.error('Email queueing failed', {
        to,
        templateType,
        error: error.message
      });
      throw new Error('Email service temporarily unavailable');
    }
  }
  
  // Templates spécialisés
  async sendWelcomeEmail(userData, userType) {
    return this.sendEmail(userData.email, 'welcome', {
      firstName: userData.firstName,
      userType,
      nextSteps: this.getNextSteps(userType),
      kycUrl: 'https://platform.socialimpact.com/kyc'
    });
  }
  
  async sendKYCResultEmail(userData, status, reason = null) {
    const templateType = status === 'approved' ? 'kycApproved' : 'kycRejected';
    
    return this.sendEmail(userData.email, templateType, {
      firstName: userData.firstName,
      status,
      reason,
      retryUrl: status === 'rejected' ? 'https://platform.socialimpact.com/kyc' : null,
      dashboardUrl: 'https://platform.socialimpact.com/dashboard'
    });
  }
  
  async sendContributionConfirmation(contributorData, projectData, contributionData) {
    return this.sendEmail(contributorData.email, 'contributionConfirmed', {
      firstName: contributorData.firstName,
      projectTitle: projectData.title,
      contributionAmount: (contributionData.amount.gross / 100).toFixed(2),
      projectUrl: `https://platform.socialimpact.com/projects/${projectData.id}`,
      receiptUrl: contributionData.receiptUrl,
      trackingEnabled: !contributionData.preferences.anonymous
    });
  }
  
  // Validation des données email
  validateEmailData(to, templateType, templateData) {
    if (!this.isValidEmail(to)) {
      throw new Error('Invalid recipient email address');
    }
    
    if (!templateType || typeof templateType !== 'string') {
      throw new Error('Invalid template type');
    }
    
    if (!templateData || typeof templateData !== 'object') {
      throw new Error('Invalid template data');
    }
    
    // Validation anti-spam
    if (templateData.firstName && templateData.firstName.length > 100) {
      throw new Error('Invalid firstName length');
    }
  }
  
  isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }
  
  getNextSteps(userType) {
    const steps = {
      contributor: [
        'Complete your KYC verification',
        'Browse impactful projects',
        'Make your first contribution'
      ],
      creator: [
        'Complete enhanced KYC verification',
        'Create your first project',
        'Build your community'
      ]
    };
    
    return steps[userType] || steps.contributor;
  }
}
```

## 5. Monitoring et détection d'anomalies

### 5.1 Système de monitoring sécurisé

```javascript
// Service de monitoring et alertes
class SecurityMonitoringService {
  constructor() {
    this.alertThresholds = {
      failedLogins: 5, // Par heure
      suspiciousContributions: 3, // Par utilisateur par jour
      rapidProjectCreations: 2, // Par utilisateur par jour
      highValueTransactions: 500000, // 5000€ en centimes
      kycFailureRate: 0.8 // 80% de rejets
    };
  }
  
  // Détection de tentatives de connexion suspectes
  async monitorAuthentication(uid, success, metadata = {}) {
    const hour = Math.floor(Date.now() / (60 * 60 * 1000));
    const key = `auth_attempts_${uid}_${hour}`;
    
    try {
      const attemptsDoc = await admin.firestore()
        .collection('security_monitoring')
        .doc(key)
        .get();
      
      const attempts = attemptsDoc.exists ? attemptsDoc.data().attempts : [];
      attempts.push({
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        success,
        ip: metadata.ip,
        userAgent: metadata.userAgent,
        location: metadata.location
      });
      
      await admin.firestore()
        .collection('security_monitoring')
        .doc(key)
        .set({
          uid,
          attempts,
          failedCount: attempts.filter(a => !a.success).length,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      
      // Alertes si trop d'échecs
      const failedCount = attempts.filter(a => !a.success).length;
      if (failedCount >= this.alertThresholds.failedLogins) {
        await this.triggerSecurityAlert('failed_logins', {
          uid,
          failedCount,
          timeWindow: '1 hour',
          metadata
        });
      }
      
    } catch (error) {
      functions.logger.error('Authentication monitoring failed', {
        uid,
        error: error.message
      });
    }
  }
  
  // Détection de contributions suspectes
  async monitorContribution(contributionData) {
    const checks = [
      this.checkRapidContributions(contributionData),
      this.checkHighValueTransaction(contributionData),
      this.checkGeographicAnomaly(contributionData),
      this.checkVelocityAnomaly(contributionData)
    ];
    
    const results = await Promise.allSettled(checks);
    const alerts = results
      .filter(r => r.status === 'fulfilled' && r.value.suspicious)
      .map(r => r.value);
    
    if (alerts.length > 0) {
      await this.triggerSecurityAlert('suspicious_contribution', {
        contributionId: contributionData.id,
        contributorUid: contributionData.contributorUid,
        projectId: contributionData.projectId,
        amount: contributionData.amount.gross,
        alerts: alerts.map(a => a.reason)
      });
    }
    
    return alerts.length === 0;
  }
  
  // Vérification de contributions rapides
  async checkRapidContributions(contributionData) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todayContributions = await admin.firestore()
      .collectionGroup('contributions')
      .where('contributorUid', '==', contributionData.contributorUid)
      .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(today))
      .where('payment.status', '==', 'confirmed')
      .get();
    
    const suspicious = todayContributions.size >= this.alertThresholds.suspiciousContributions;
    
    return {
      suspicious,
      reason: suspicious ? 'rapid_contributions' : null,
      count: todayContributions.size
    };
  }
  
  // Vérification de montant élevé
  async checkHighValueTransaction(contributionData) {
    const suspicious = contributionData.amount.gross >= this.alertThresholds.highValueTransactions;
    
    return {
      suspicious,
      reason: suspicious ? 'high_value_transaction' : null,
      amount: contributionData.amount.gross
    };
  }
  
  // Alerte de sécurité
  async triggerSecurityAlert(type, data) {
    const alertDoc = {
      type,
      data,
      severity: this.getAlertSeverity(type),
      status: 'open',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      assignedTo: null,
      resolvedAt: null
    };
    
    const alertRef = await admin.firestore()
      .collection('security_alerts')
      .add(alertDoc);
    
    // Notification immédiate aux admins
    await this.notifyAdmins(type, data, alertRef.id);
    
    functions.logger.warn('Security alert triggered', {
      alertId: alertRef.id,
      type,
      severity: alertDoc.severity,
      data
    });
    
    return alertRef.id;
  }
  
  getAlertSeverity(type) {
    const severities = {
      failed_logins: 'medium',
      suspicious_contribution: 'high',
      rapid_project_creation: 'medium',
      kyc_anomaly: 'high',
      data_breach_attempt: 'critical'
    };
    
    return severities[type] || 'low';
  }
  
  async notifyAdmins(alertType, alertData, alertId) {
    // Récupération des admins
    const adminsSnapshot = await admin.firestore()
      .collection('users')
      .where('userType', '==', 'admin')
      .get();
    
    for (const adminDoc of adminsSnapshot.docs) {
      await admin.firestore().collection('notifications').add({
        recipientUid: adminDoc.id,
        type: 'security',
        subtype: alertType,
        priority: 'urgent',
        title: 'Security Alert',
        message: `Security incident detected: ${alertType}`,
        data: {
          alertId,
          alertType,
          ...alertData
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
}
```

### 5.2 Audit et conformité

```javascript
// Service d'audit et conformité
class AuditService {
  constructor() {
    this.sensitiveActions = [
      'user_created',
      'kyc_status_changed',
      'payment_processed',
      'funds_released',
      'project_status_changed',
      'audit_completed',
      'admin_action'
    ];
  }
  
  // Enregistrement d'audit pour actions sensibles
  async logAuditEvent(action, actorUid, targetId, details = {}) {
    if (!this.sensitiveActions.includes(action)) {
      return; // Pas d'audit nécessaire
    }
    
    const auditEntry = {
      action,
      actorUid,
      targetId,
      targetType: this.inferTargetType(targetId),
      details,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      ipAddress: details.ipAddress || null,
      userAgent: details.userAgent || null,
      sessionId: details.sessionId || null
    };
    
    try {
      await admin.firestore()
        .collection('audit_logs')
        .add(auditEntry);
      
      functions.logger.info('Audit event logged', {
        action,
        actorUid,
        targetId
      });
    } catch (error) {
      functions.logger.error('Audit logging failed', {
        action,
        actorUid,
        targetId,
        error: error.message
      });
    }
  }
  
  // Génération de rapport de conformité
  async generateComplianceReport(startDate, endDate) {
    const auditLogs = await admin.firestore()
      .collection('audit_logs')
      .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(startDate))
      .where('timestamp', '<=', admin.firestore.Timestamp.fromDate(endDate))
      .orderBy('timestamp', 'desc')
      .get();
    
    const report = {
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString()
      },
      totalEvents: auditLogs.size,
      eventsByAction: {},
      eventsByUser: {},
      securityIncidents: await this.getSecurityIncidents(startDate, endDate),
      kycStats: await this.getKYCStats(startDate, endDate),
      financialStats: await this.getFinancialStats(startDate, endDate)
    };
    
    auditLogs.docs.forEach(doc => {
      const event = doc.data();
      
      // Groupement par action
      report.eventsByAction[event.action] = 
        (report.eventsByAction[event.action] || 0) + 1;
      
      // Groupement par utilisateur
      report.eventsByUser[event.actorUid] = 
        (report.eventsByUser[event.actorUid] || 0) + 1;
    });
    
    return report;
  }
  
  inferTargetType(targetId) {
    if (targetId.startsWith('user_')) return 'user';
    if (targetId.startsWith('project_')) return 'project';
    if (targetId.startsWith('audit_')) return 'audit';
    return 'unknown';
  }
  
  async getSecurityIncidents(startDate, endDate) {
    const incidents = await admin.firestore()
      .collection('security_alerts')
      .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(startDate))
      .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(endDate))
      .get();
    
    return {
      total: incidents.size,
      bySeverity: incidents.docs.reduce((acc, doc) => {
        const severity = doc.data().severity;
        acc[severity] = (acc[severity] || 0) + 1;
        return acc;
      }, {}),
      resolved: incidents.docs.filter(doc => doc.data().status === 'resolved').length
    };
  }
}
```

Cette documentation complète de sécurité et d'intégrations permet aux développeurs backend de comprendre et implémenter tous les aspects sécuritaires et les intégrations externes de manière totalement autonome et sécurisée.