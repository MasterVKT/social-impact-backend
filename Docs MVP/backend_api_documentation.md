# Documentation API Backend - Firebase Functions
## Social Finance Impact Platform MVP

## 1. Vue d'ensemble de l'API

### 1.1 Architecture API

L'API backend est construite entièrement sur Firebase Functions avec des endpoints HTTPS callable pour toutes les interactions client-serveur. Cette approche garantit l'authentification automatique et la sécurité des appels.

**Base URL** : `https://europe-west1-[project-id].cloudfunctions.net/`

**Authentication** : Tous les endpoints nécessitent un token Firebase Auth valide, automatiquement géré par le SDK Firebase côté client.

**Content-Type** : `application/json`

**Response Format** : Toutes les réponses suivent le format standard :
```json
{
  "success": true|false,
  "data": {...},
  "error": {
    "code": "ERROR_CODE",
    "message": "Description de l'erreur"
  },
  "timestamp": "2025-01-15T10:30:00Z"
}
```

### 1.2 Codes d'erreur standardisés

```json
{
  "AUTH_REQUIRED": "Authentification requise",
  "INSUFFICIENT_PERMISSIONS": "Permissions insuffisantes",
  "INVALID_INPUT": "Données d'entrée invalides",
  "RESOURCE_NOT_FOUND": "Ressource introuvable",
  "KYC_REQUIRED": "Vérification KYC requise",
  "QUOTA_EXCEEDED": "Quota dépassé",
  "EXTERNAL_API_ERROR": "Erreur service externe",
  "BUSINESS_RULE_VIOLATION": "Violation des règles métier"
}
```

## 2. Authentification et profils utilisateur

### 2.1 POST /api/auth/completeProfile

**Description** : Complète le profil utilisateur après création de compte Firebase Auth

**Authentication** : Firebase Auth token requis

**Request Body** :
```json
{
  "userType": "contributor|creator",
  "firstName": "string (required, 2-50 chars)",
  "lastName": "string (required, 2-50 chars)",
  "phoneNumber": "string (optional, format international)",
  "dateOfBirth": "string (ISO date, required for KYC)",
  "address": {
    "street": "string",
    "city": "string", 
    "postalCode": "string",
    "country": "string (ISO 3166-1 alpha-2)"
  },
  "preferences": {
    "language": "fr|en",
    "currency": "EUR",
    "notifications": {
      "email": true,
      "push": true,
      "inApp": true
    },
    "interestedCategories": ["environment", "education", "health", "community", "innovation"]
  }
}
```

**Response Success (200)** :
```json
{
  "success": true,
  "data": {
    "userId": "string",
    "profileComplete": true,
    "kycRequired": true,
    "nextStep": "kyc_verification"
  }
}
```

**Business Rules** :
- Vérifie que l'utilisateur n'a pas déjà un profil complet
- Valide le format email et unicité
- Créé automatiquement le document Firestore `/users/{uid}`
- Assigne les Custom Claims selon userType

### 2.2 POST /api/auth/initKYCVerification

**Description** : Initialise le processus de vérification KYC via Sumsub

**Authentication** : Firebase Auth token requis

**Request Body** :
```json
{
  "kycLevel": "basic|enhanced"
}
```

**Response Success (200)** :
```json
{
  "success": true,
  "data": {
    "sumsubToken": "string",
    "sumsubUrl": "string",
    "externalUserId": "string",
    "levelName": "string",
    "expiresAt": "ISO datetime"
  }
}
```

**Business Rules** :
- basic: pour contributeurs (document ID + selfie)
- enhanced: pour créateurs (ID + justificatif domicile + vérification manuelle)
- Génère token Sumsub unique avec 24h d'expiration
- Met à jour statut KYC à "pending" dans Firestore

### 2.3 GET /api/auth/profile

**Description** : Récupère le profil complet de l'utilisateur authentifié

**Authentication** : Firebase Auth token requis

**Response Success (200)** :
```json
{
  "success": true,
  "data": {
    "uid": "string",
    "email": "string",
    "firstName": "string",
    "lastName": "string",
    "userType": "contributor|creator|auditor|admin",
    "profilePicture": "string (URL)",
    "kyc": {
      "status": "pending|approved|rejected",
      "level": 0|1|2,
      "verifiedAt": "ISO datetime",
      "documents": [
        {
          "type": "passport|id_card|proof_of_address",
          "status": "pending|approved|rejected",
          "submittedAt": "ISO datetime"
        }
      ]
    },
    "stats": {
      "totalContributed": "number",
      "projectsSupported": "number",
      "projectsCreated": "number",
      "auditsCompleted": "number"
    },
    "preferences": "object",
    "createdAt": "ISO datetime",
    "lastLoginAt": "ISO datetime"
  }
}
```

### 2.4 PUT /api/auth/updateProfile

**Description** : Met à jour les informations modifiables du profil

**Authentication** : Firebase Auth token requis

**Request Body** :
```json
{
  "profilePicture": "string (base64 ou URL)",
  "bio": "string (max 500 chars)",
  "preferences": {
    "notifications": {
      "email": true,
      "push": false,
      "inApp": true
    },
    "interestedCategories": ["environment", "health"]
  },
  "address": {
    "city": "string",
    "country": "string"
  }
}
```

**Response Success (200)** :
```json
{
  "success": true,
  "data": {
    "updated": true,
    "profilePictureUrl": "string (si image uploadée)"
  }
}
```

**Business Rules** :
- Les informations KYC (nom, prénom, email) ne peuvent pas être modifiées
- Upload automatique de la photo dans Firebase Storage
- Validation des formats et tailles

## 3. Gestion des projets

### 3.1 POST /api/projects/create

**Description** : Créé un nouveau projet avec assistance IA

**Authentication** : Firebase Auth token requis + role "creator" + KYC level 2

**Request Body** :
```json
{
  "title": "string (10-100 chars, required)",
  "shortDescription": "string (50-200 chars, required)", 
  "fullDescription": "string (500-5000 chars, required)",
  "category": "environment|education|health|community|innovation",
  "fundingGoal": "number (1000-50000, required)",
  "campaignDuration": "30|60|90",
  "milestones": [
    {
      "title": "string (required)",
      "description": "string (required)",
      "budgetPercentage": "number (required, total=100)",
      "dueDate": "ISO date",
      "criteria": ["string array"]
    }
  ],
  "impactMetrics": {
    "beneficiariesCount": "number",
    "targetAudience": "string",
    "measurementMethod": "string"
  },
  "coverImage": "string (base64, required)",
  "additionalImages": ["string array (max 3)"],
  "documents": [
    {
      "name": "string",
      "type": "business_plan|impact_study|other",
      "content": "string (base64)"
    }
  ]
}
```

**Response Success (201)** :
```json
{
  "success": true,
  "data": {
    "projectId": "string",
    "status": "draft",
    "aiAssistance": {
      "titleSuggestions": ["string array"],
      "descriptionImprovements": "string",
      "categorySuggestion": "string",
      "qualityScore": "number (0-100)"
    },
    "estimatedReviewTime": "48h",
    "nextSteps": ["Submit for review", "Add more details"]
  }
}
```

**Business Rules** :
- Vérification KYC level 2 obligatoire
- Maximum 3 projets actifs par créateur
- Validation via Firebase AI Logic (score minimum 60)
- Upload automatique des images vers Firebase Storage
- Création en statut "draft" initialement

### 3.2 POST /api/projects/{projectId}/submit

**Description** : Soumet un projet pour modération administrative

**Authentication** : Firebase Auth token requis + propriétaire du projet

**Path Parameters** :
- `projectId`: ID du projet à soumettre

**Request Body** :
```json
{
  "finalReview": true,
  "acceptsTerms": true,
  "additionalNotes": "string (optional)"
}
```

**Response Success (200)** :
```json
{
  "success": true,
  "data": {
    "status": "under_review",
    "submittedAt": "ISO datetime",
    "estimatedDecision": "ISO datetime",
    "reviewQueue": "number"
  }
}
```

**Business Rules** :
- Projet doit être en statut "draft"
- Toutes les sections obligatoires doivent être complètes
- Score IA minimum 60 requis
- Passe automatiquement en "under_review"

### 3.3 GET /api/projects

**Description** : Liste paginée des projets avec filtres

**Authentication** : Firebase Auth token requis

**Query Parameters** :
- `status`: "live|funded|active|completed" (optionnel)
- `category`: "environment|education|health|community|innovation" (optionnel)
- `minFunding`: nombre (optionnel)
- `maxFunding`: nombre (optionnel)
- `sortBy`: "recent|popular|ending_soon|funding_progress" (défaut: recent)
- `limit`: nombre (défaut: 20, max: 50)
- `startAfter`: string (pagination cursor)

**Response Success (200)** :
```json
{
  "success": true,
  "data": {
    "projects": [
      {
        "id": "string",
        "title": "string",
        "shortDescription": "string",
        "category": "string",
        "coverImageUrl": "string",
        "creator": {
          "uid": "string",
          "displayName": "string",
          "profilePicture": "string"
        },
        "funding": {
          "goal": "number",
          "raised": "number",
          "percentage": "number",
          "contributorsCount": "number"
        },
        "status": "string",
        "endDate": "ISO datetime",
        "createdAt": "ISO datetime",
        "metrics": {
          "views": "number",
          "saves": "number"
        }
      }
    ],
    "hasMore": true,
    "nextCursor": "string"
  }
}
```

### 3.4 GET /api/projects/{projectId}

**Description** : Détails complets d'un projet spécifique

**Authentication** : Firebase Auth token requis

**Path Parameters** :
- `projectId`: ID du projet

**Response Success (200)** :
```json
{
  "success": true,
  "data": {
    "id": "string",
    "title": "string",
    "shortDescription": "string",
    "fullDescription": "string",
    "category": "string",
    "status": "string",
    "creator": {
      "uid": "string",
      "displayName": "string",
      "profilePicture": "string",
      "bio": "string",
      "stats": {
        "projectsCreated": "number",
        "successRate": "number"
      }
    },
    "funding": {
      "goal": "number",
      "raised": "number",
      "percentage": "number",
      "contributorsCount": "number",
      "platformFee": "number",
      "auditFee": "number"
    },
    "timeline": {
      "createdAt": "ISO datetime",
      "publishedAt": "ISO datetime",
      "endDate": "ISO datetime",
      "daysRemaining": "number"
    },
    "milestones": [
      {
        "id": "string",
        "title": "string",
        "description": "string",
        "budgetPercentage": "number",
        "status": "pending|submitted|approved|rejected",
        "dueDate": "ISO datetime",
        "submittedAt": "ISO datetime",
        "audit": {
          "auditorName": "string",
          "status": "string",
          "completedAt": "ISO datetime"
        }
      }
    ],
    "impactMetrics": {
      "beneficiariesCount": "number",
      "targetAudience": "string",
      "actualImpact": "object (rempli après validation)"
    },
    "media": {
      "coverImageUrl": "string",
      "additionalImages": ["string array"],
      "documents": [
        {
          "name": "string",
          "type": "string",
          "url": "string",
          "downloadable": true
        }
      ]
    },
    "userInteraction": {
      "hasContributed": true,
      "contributionAmount": "number",
      "isSaved": true,
      "canContribute": true
    }
  }
}
```

**Business Rules** :
- Incrémente automatiquement le compteur de vues
- `userInteraction` personnalisé selon l'utilisateur connecté
- Certains champs sensibles masqués selon le statut KYC

## 4. Système de contributions

### 4.1 POST /api/contributions/create

**Description** : Créé une nouvelle contribution avec PaymentIntent Stripe

**Authentication** : Firebase Auth token requis + KYC level 1 minimum

**Request Body** :
```json
{
  "projectId": "string (required)",
  "amount": "number (min: 10, max: 1000, required)",
  "message": "string (optional, max 500 chars)",
  "anonymous": "boolean (default: false)",
  "paymentMethod": {
    "type": "card",
    "source": "form|saved"
  }
}
```

**Response Success (201)** :
```json
{
  "success": true,
  "data": {
    "contributionId": "string",
    "paymentIntent": {
      "id": "string",
      "clientSecret": "string",
      "amount": "number",
      "currency": "EUR"
    },
    "fees": {
      "platformFee": "number",
      "stripeFee": "number",
      "total": "number"
    },
    "escrow": {
      "holdUntil": "ISO datetime",
      "releaseConditions": ["milestone validations"]
    }
  }
}
```

**Business Rules** :
- Vérifie les limites de contribution par utilisateur
- Calcule automatiquement les frais (plateforme 5% + Stripe ~3%)
- Créé PaymentIntent Stripe avec metadata complète
- Statut initial "pending" jusqu'à confirmation paiement

### 4.2 POST /api/contributions/{contributionId}/confirm

**Description** : Confirme une contribution après succès du paiement Stripe

**Authentication** : Firebase Auth token requis + propriétaire de la contribution

**Path Parameters** :
- `contributionId`: ID de la contribution

**Request Body** :
```json
{
  "paymentIntentId": "string (required)",
  "stripeClientSecret": "string (required)"
}
```

**Response Success (200)** :
```json
{
  "success": true,
  "data": {
    "status": "confirmed",
    "receiptUrl": "string",
    "transactionId": "string",
    "escrowDetails": {
      "amount": "number",
      "heldUntil": "ISO datetime",
      "releaseSchedule": [
        {
          "milestoneId": "string",
          "amount": "number",
          "conditions": "milestone validation"
        }
      ]
    }
  }
}
```

**Business Rules** :
- Vérifie le statut du PaymentIntent Stripe
- Met à jour les statistiques du projet en temps réel
- Créé l'entrée dans le ledger des transactions
- Envoie automatiquement le reçu par email
- Place les fonds en escrow logique

### 4.3 GET /api/contributions/portfolio

**Description** : Portfolio complet des contributions de l'utilisateur

**Authentication** : Firebase Auth token requis

**Query Parameters** :
- `status`: "all|active|completed|refunded" (défaut: all)
- `sortBy`: "recent|amount|project_name" (défaut: recent)
- `limit`: nombre (défaut: 20)

**Response Success (200)** :
```json
{
  "success": true,
  "data": {
    "summary": {
      "totalInvested": "number",
      "activeContributions": "number",
      "completedProjects": "number",
      "totalImpact": {
        "beneficiariesHelped": "number",
        "projectsSupported": "number"
      }
    },
    "contributions": [
      {
        "id": "string",
        "amount": "number",
        "date": "ISO datetime",
        "status": "confirmed|refunded",
        "project": {
          "id": "string",
          "title": "string",
          "coverImage": "string",
          "status": "active|completed|failed",
          "progress": {
            "milestonesCompleted": "number",
            "totalMilestones": "number",
            "percentageComplete": "number"
          }
        },
        "returns": {
          "expectedImpact": "string",
          "actualImpact": "string"
        }
      }
    ]
  }
}
```

## 5. Workflow d'audit

### 5.1 POST /api/audits/assign

**Description** : Assigne un auditeur à un projet (admin seulement)

**Authentication** : Firebase Auth token requis + role "admin"

**Request Body** :
```json
{
  "projectId": "string (required)",
  "auditorUid": "string (required)",
  "specializations": ["string array"],
  "deadline": "ISO datetime",
  "compensation": "number (default: 200)"
}
```

**Response Success (201)** :
```json
{
  "success": true,
  "data": {
    "auditId": "string",
    "assignedAt": "ISO datetime",
    "deadline": "ISO datetime",
    "status": "assigned",
    "notificationSent": true
  }
}
```

### 5.2 POST /api/audits/{auditId}/accept

**Description** : Accepte une mission d'audit (auditeur)

**Authentication** : Firebase Auth token requis + role "auditor" + assigné à cet audit

**Path Parameters** :
- `auditId`: ID de l'audit

**Request Body** :
```json
{
  "acceptanceNote": "string (optional)",
  "estimatedCompletionDate": "ISO datetime"
}
```

**Response Success (200)** :
```json
{
  "success": true,
  "data": {
    "status": "accepted",
    "acceptedAt": "ISO datetime",
    "deadline": "ISO datetime",
    "project": {
      "id": "string",
      "title": "string",
      "creator": "string",
      "milestones": "array"
    }
  }
}
```

### 5.3 POST /api/audits/{auditId}/submit-report

**Description** : Soumet un rapport d'audit pour une milestone

**Authentication** : Firebase Auth token requis + role "auditor" + assigné à cet audit

**Path Parameters** :
- `auditId`: ID de l'audit

**Request Body** :
```json
{
  "milestoneId": "string (required)",
  "decision": "approved|rejected|needs_revision",
  "score": "number (0-100, required)",
  "criteria": [
    {
      "name": "string",
      "met": true,
      "score": "number",
      "comments": "string"
    }
  ],
  "report": {
    "summary": "string (required, min 200 chars)",
    "strengths": ["string array"],
    "weaknesses": ["string array"],
    "recommendations": ["string array"],
    "riskAssessment": "low|medium|high"
  },
  "evidence": [
    {
      "type": "document|image|video",
      "name": "string",
      "content": "string (base64)"
    }
  ]
}
```

**Response Success (200)** :
```json
{
  "success": true,
  "data": {
    "reportId": "string",
    "submittedAt": "ISO datetime",
    "decision": "string",
    "fundsReleased": "number (si approved)",
    "nextMilestone": {
      "id": "string",
      "dueDate": "ISO datetime"
    },
    "compensation": {
      "amount": "number",
      "status": "pending_payment"
    }
  }
}
```

**Business Rules** :
- Vérifie que toutes les preuves ont été évaluées
- Score global calculé automatiquement selon les critères
- Si "approved": déclenche le déblocage automatique des fonds
- Si "rejected": bloque les fonds et notifie le créateur
- Met à jour les statistiques de l'auditeur

### 5.4 GET /api/audits/dashboard

**Description** : Dashboard des audits pour un auditeur

**Authentication** : Firebase Auth token requis + role "auditor"

**Response Success (200)** :
```json
{
  "success": true,
  "data": {
    "stats": {
      "totalAudits": "number",
      "completedThisMonth": "number",
      "averageProcessingTime": "number (hours)",
      "approvalRate": "number (percentage)",
      "totalEarnings": "number"
    },
    "assigned": [
      {
        "auditId": "string",
        "projectTitle": "string", 
        "milestoneTitle": "string",
        "assignedAt": "ISO datetime",
        "deadline": "ISO datetime",
        "priority": "high|medium|low",
        "status": "assigned|in_progress"
      }
    ],
    "completed": [
      {
        "auditId": "string",
        "projectTitle": "string",
        "completedAt": "ISO datetime",
        "decision": "string",
        "feedback": {
          "creatorRating": "number (1-5)",
          "creatorComment": "string"
        }
      }
    ]
  }
}
```

## 6. Notifications

### 6.1 GET /api/notifications

**Description** : Liste des notifications pour l'utilisateur connecté

**Authentication** : Firebase Auth token requis

**Query Parameters** :
- `unread`: "true|false" (optionnel)
- `type`: "contribution|project|audit|system" (optionnel)
- `limit`: nombre (défaut: 20)

**Response Success (200)** :
```json
{
  "success": true,
  "data": {
    "unreadCount": "number",
    "notifications": [
      {
        "id": "string",
        "type": "contribution|project|audit|system",
        "title": "string",
        "message": "string",
        "data": {
          "projectId": "string",
          "amount": "number",
          "actionUrl": "string"
        },
        "read": false,
        "createdAt": "ISO datetime"
      }
    ]
  }
}
```

### 6.2 POST /api/notifications/{notificationId}/read

**Description** : Marque une notification comme lue

**Authentication** : Firebase Auth token requis

**Path Parameters** :
- `notificationId`: ID de la notification

**Response Success (200)** :
```json
{
  "success": true,
  "data": {
    "marked": true,
    "readAt": "ISO datetime"
  }
}
```

## 7. Administration

### 7.1 GET /api/admin/dashboard

**Description** : Dashboard administrateur avec métriques globales

**Authentication** : Firebase Auth token requis + role "admin"

**Response Success (200)** :
```json
{
  "success": true,
  "data": {
    "metrics": {
      "totalUsers": "number",
      "activeProjects": "number",
      "totalFunding": "number",
      "completionRate": "number"
    },
    "pendingActions": {
      "projectsToReview": "number",
      "kycToValidate": "number",
      "disputesToResolve": "number"
    },
    "recentActivity": [
      {
        "type": "project_submitted|contribution_made|audit_completed",
        "description": "string",
        "timestamp": "ISO datetime"
      }
    ]
  }
}
```

### 7.2 POST /api/admin/projects/{projectId}/moderate

**Description** : Modère un projet soumis

**Authentication** : Firebase Auth token requis + role "admin"

**Path Parameters** :
- `projectId`: ID du projet

**Request Body** :
```json
{
  "decision": "approved|rejected",
  "feedback": "string (required si rejected)",
  "requestedChanges": ["string array (si applicable)"],
  "priority": "high|medium|low",
  "assignAuditor": "string (uid, optionnel)"
}
```

**Response Success (200)** :
```json
{
  "success": true,
  "data": {
    "status": "live|rejected",
    "moderatedAt": "ISO datetime",
    "notificationSent": true,
    "auditorAssigned": "string (si applicable)"
  }
}
```

## 8. Utilitaires et système

### 8.1 GET /api/system/config

**Description** : Configuration publique de la plateforme

**Authentication** : Firebase Auth token requis

**Response Success (200)** :
```json
{
  "success": true,
  "data": {
    "limits": {
      "maxContributionAmount": 1000,
      "maxProjectGoal": 50000,
      "maxActiveProjects": 3
    },
    "fees": {
      "platformPercentage": 5,
      "auditPercentage": 3
    },
    "categories": [
      {
        "id": "environment",
        "name": "Environnement",
        "description": "string",
        "icon": "string"
      }
    ],
    "kycLevels": {
      "basic": {
        "maxContribution": 1000,
        "requirements": ["id_document", "selfie"]
      },
      "enhanced": {
        "maxContribution": "unlimited",
        "requirements": ["id_document", "proof_of_address", "manual_review"]
      }
    }
  }
}
```

### 8.2 POST /api/system/feedback

**Description** : Envoie un feedback utilisateur

**Authentication** : Firebase Auth token requis

**Request Body** :
```json
{
  "type": "bug|feature|complaint|other",
  "subject": "string (required)",
  "message": "string (required, min 50 chars)",
  "category": "ui|payment|project|audit",
  "priority": "low|medium|high",
  "attachments": [
    {
      "name": "string",
      "type": "image|document",
      "content": "string (base64)"
    }
  ]
}
```

**Response Success (201)** :
```json
{
  "success": true,
  "data": {
    "ticketId": "string",
    "createdAt": "ISO datetime",
    "estimatedResponse": "24-48h",
    "trackingUrl": "string"
  }
}
```

Cette documentation API complète permet au frontend de consommer tous les services backend de manière totalement autonome.