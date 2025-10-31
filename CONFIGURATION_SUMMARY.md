# Configuration Summary - Quick Reference

## 🎯 What You Need to Get Started

To make your Social Impact Platform backend 100% functional, you need to configure **4 main external services** and set **28 required environment variables**.

---

## 📋 The 4 Essential Services

### 1. 🔥 Firebase (FREE to start)
**What it does**: Database, authentication, hosting, cloud functions
**Sign up**: https://console.firebase.google.com/
**Time to setup**: 15 minutes
**Cost**: Free tier covers development, ~$10-50/month for production

**What you need**:
- ✅ Create Firebase project
- ✅ Enable Authentication, Firestore, Storage, Functions
- ✅ Download service account JSON
- ✅ Copy Project ID and Storage Bucket

**Variables needed**: 4
```
FIREBASE_PROJECT_ID
FIREBASE_REGION
FIREBASE_STORAGE_BUCKET
FIREBASE_SERVICE_ACCOUNT_KEY
```

---

### 2. 💳 Stripe (FREE to start, pay per transaction)
**What it does**: Payment processing, escrow, payouts
**Sign up**: https://dashboard.stripe.com/register
**Time to setup**: 30 minutes
**Cost**: 2.9% + €0.30 per transaction

**What you need**:
- ✅ Create Stripe account
- ✅ Complete business verification
- ✅ Enable Stripe Connect
- ✅ Setup webhooks
- ✅ Copy API keys

**Variables needed**: 5
```
STRIPE_SECRET_KEY
STRIPE_PUBLISHABLE_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_CONNECT_CLIENT_ID
STRIPE_CONNECT_WEBHOOK_SECRET
```

---

### 3. 🔐 Sumsub (PAID - contact sales)
**What it does**: KYC/identity verification
**Sign up**: https://sumsub.com/contact-sales
**Time to setup**: 45 minutes
**Cost**: ~€1-3 per verification, volume discounts available

**What you need**:
- ✅ Create Sumsub account (contact sales)
- ✅ Configure two verification levels (Basic & Enhanced)
- ✅ Setup webhook
- ✅ Copy API credentials

**Variables needed**: 6
```
SUMSUB_APP_TOKEN
SUMSUB_SECRET_KEY
SUMSUB_BASE_URL
SUMSUB_WEBHOOK_SECRET
SUMSUB_LEVEL_BASIC
SUMSUB_LEVEL_FULL
```

**Alternative for Development**: You can temporarily bypass KYC for testing

---

### 4. 📧 SendGrid (FREE tier: 100 emails/day)
**What it does**: Transactional emails (receipts, notifications, etc.)
**Sign up**: https://signup.sendgrid.com/
**Time to setup**: 60 minutes (includes creating 9 email templates)
**Cost**: Free for 100 emails/day, $19.95/month for 50K emails

**What you need**:
- ✅ Create SendGrid account
- ✅ Verify sender email or domain
- ✅ Get API key
- ✅ Create 9 email templates

**Variables needed**: 13 (4 credentials + 9 template IDs)
```
SENDGRID_API_KEY
SENDGRID_FROM_EMAIL
SENDGRID_FROM_NAME
SENDGRID_REPLY_TO
SENDGRID_TEMPLATE_WELCOME
SENDGRID_TEMPLATE_KYC_APPROVED
SENDGRID_TEMPLATE_KYC_REJECTED
SENDGRID_TEMPLATE_PROJECT_APPROVED
SENDGRID_TEMPLATE_CONTRIBUTION_CONFIRMED
SENDGRID_TEMPLATE_AUDIT_ASSIGNMENT
SENDGRID_TEMPLATE_MONTHLY_REPORT
SENDGRID_TEMPLATE_DIGEST_DAILY
SENDGRID_TEMPLATE_REFUND_PROCESSED
```

---

## 🔒 Security & Configuration (Self-Generated)

### 5. Security Keys (Generate yourself - FREE)
**What**: Encryption keys for securing sensitive data
**Time to setup**: 5 minutes
**Cost**: FREE

**Generate with**:
```bash
# Encryption key (32 bytes)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# JWT secret (64 bytes)
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Webhook signature secret (32 bytes)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Variables needed**: 3
```
ENCRYPTION_KEY
JWT_SECRET
WEBHOOK_SIGNATURE_SECRET
```

---

### 6. URLs (Your Own)
**What**: Frontend and API URLs
**Time to setup**: 2 minutes
**Cost**: FREE (just enter your URLs)

**Variables needed**: 2
```
FRONTEND_URL=https://yoursite.com
API_BASE_URL=https://api.yoursite.com
```

---

### 7. Platform Name
**What**: Your platform's name
**Time to setup**: 1 minute
**Cost**: FREE

**Variables needed**: 1
```
PLATFORM_NAME=Social Impact Platform
```

---

## 📊 Complete Variable Count

| Category | Required Variables | Optional Variables |
|----------|-------------------|-------------------|
| Firebase | 4 | 1 |
| Stripe | 5 | 1 |
| Sumsub | 6 | 0 |
| SendGrid | 13 | 0 |
| Security | 3 | 1 |
| URLs | 2 | 3 |
| Platform | 1 | 0 |
| **TOTAL** | **28** | **6** |

---

## ⏱️ Total Setup Time Estimate

| Task | Time |
|------|------|
| Firebase setup | 15 min |
| Stripe setup | 30 min |
| Sumsub setup | 45 min |
| SendGrid setup + templates | 60 min |
| Generate security keys | 5 min |
| Configure URLs & platform | 3 min |
| Create .env file | 10 min |
| Test configuration | 20 min |
| **TOTAL** | **~3 hours** |

---

## 💰 Monthly Cost Estimate

### Startup/Development (Low Volume)
| Service | Cost |
|---------|------|
| Firebase | FREE tier or ~$10/month |
| Stripe | 2.9% + €0.30 per transaction |
| Sumsub | ~€50-100 (10-50 verifications) |
| SendGrid | FREE (100 emails/day) |
| **Total Fixed** | **€60-110/month + transaction fees** |

### Small Production (1,000 users, 500 projects)
| Service | Cost |
|---------|------|
| Firebase | ~$50/month |
| Stripe | ~€1,600/month (on €50K volume) |
| Sumsub | ~€750-1,500/month |
| SendGrid | ~$89/month |
| **Total** | **€2,490-3,240/month** |

**Revenue**: 5% platform fee on contributions = ~€2,500/month on €50K volume
**Net**: Break-even to slight profit at this scale

---

## 🚀 Quick Start Guide

### Option A: Full Production Setup (3 hours)

1. **Sign up for all 4 services** (Firebase, Stripe, Sumsub, SendGrid)
2. **Follow the detailed guide**: `PRODUCTION_CONFIGURATION_CHECKLIST.md`
3. **Copy .env.example to .env** and fill in all 28 variables
4. **Deploy to Firebase**: `firebase deploy --only functions`
5. **Test all flows**: Registration → KYC → Project → Contribution

### Option B: Quick Development Setup (30 minutes)

**For testing without full production services:**

1. **Firebase only** (required - FREE)
   - Setup Firebase project
   - 4 variables

2. **Stripe Test Mode** (required for payments)
   - Use test API keys
   - 5 variables

3. **Mock Sumsub** (optional for development)
   - Set `ENABLE_KYC_VERIFICATION=false` in feature flags
   - Skip Sumsub entirely for local testing

4. **SendGrid Free Tier** (100 emails/day)
   - Create account
   - Skip templates initially (handle errors gracefully)
   - 4 variables minimum

**Minimum 13 variables for basic testing**:
```env
# Firebase (4)
FIREBASE_PROJECT_ID=
FIREBASE_REGION=
FIREBASE_STORAGE_BUCKET=
FIREBASE_SERVICE_ACCOUNT_KEY=

# Stripe Test (5)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_CONNECT_CLIENT_ID=ca_...
STRIPE_CONNECT_WEBHOOK_SECRET=whsec_...

# Security (3)
ENCRYPTION_KEY=
JWT_SECRET=
WEBHOOK_SIGNATURE_SECRET=

# URLs (1)
FRONTEND_URL=http://localhost:3000
```

---

## 📝 Where to Find Each Variable

### Complete Reference Table

| Variable | Service Dashboard | Section/Page |
|----------|------------------|--------------|
| `FIREBASE_PROJECT_ID` | Firebase Console | Project Settings > General |
| `FIREBASE_STORAGE_BUCKET` | Firebase Console | Project Settings > General |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | Firebase Console | Settings > Service Accounts > Generate Key |
| `STRIPE_SECRET_KEY` | Stripe Dashboard | Developers > API Keys |
| `STRIPE_PUBLISHABLE_KEY` | Stripe Dashboard | Developers > API Keys |
| `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard | Developers > Webhooks > Add Endpoint |
| `STRIPE_CONNECT_CLIENT_ID` | Stripe Dashboard | Settings > Connect Settings |
| `SUMSUB_APP_TOKEN` | Sumsub Cockpit | Settings > Developer |
| `SUMSUB_SECRET_KEY` | Sumsub Cockpit | Settings > Developer |
| `SUMSUB_WEBHOOK_SECRET` | Sumsub Cockpit | Settings > Webhooks |
| `SENDGRID_API_KEY` | SendGrid Dashboard | Settings > API Keys > Create API Key |
| `SENDGRID_TEMPLATE_*` | SendGrid Dashboard | Email API > Dynamic Templates |

---

## ⚠️ Common Issues & Solutions

### Issue 1: "STRIPE_SECRET_KEY is required"
**Solution**:
- Go to Stripe Dashboard > Developers > API Keys
- Copy "Secret key" (starts with `sk_test_` or `sk_live_`)
- Add to .env file

### Issue 2: "SUMSUB_APP_TOKEN environment variable is required"
**Solution**:
- Contact Sumsub sales to create account
- Or temporarily disable KYC: set `ENABLE_KYC_VERIFICATION=false`

### Issue 3: SendGrid templates not found
**Solution**:
- Create templates in SendGrid dashboard
- Copy template IDs (start with `d-`)
- Or comment out email sending code for testing

### Issue 4: Firebase Service Account error
**Solution**:
- Download service account JSON from Firebase
- Convert to base64: `base64 -w 0 serviceAccountKey.json`
- Add entire base64 string to `FIREBASE_SERVICE_ACCOUNT_KEY`

---

## 🎯 Minimum Viable Configuration

**To get the backend running with core features only**:

### Required (13 variables):
✅ Firebase (4): Project, auth, storage, functions
✅ Stripe Test Mode (5): Payments in test mode
✅ Security (3): Encryption, JWT, webhooks
✅ URLs (1): Frontend URL

### Can Skip Initially:
❌ Sumsub (disable KYC for testing)
❌ SendGrid (log emails instead of sending)
❌ Analytics/monitoring

### Enable Later:
- Sumsub when you have real users
- SendGrid when email volume > 100/day
- Monitoring when you have traffic

---

## ✅ Verification Checklist

Before going live, verify:

- [ ] All 28 required variables are set
- [ ] Firebase project is created and connected
- [ ] Stripe webhooks are configured and receiving events
- [ ] Sumsub levels are configured (Basic & Enhanced)
- [ ] All 9 SendGrid templates are created
- [ ] Frontend URL is correct and accessible
- [ ] Test user can: register → verify email → complete profile
- [ ] Test payment flow works end-to-end
- [ ] KYC verification works (or is disabled for dev)
- [ ] Emails are sending (or errors are handled)
- [ ] No errors in Firebase Functions logs

---

## 📞 Quick Links

| Resource | URL |
|----------|-----|
| **Full Configuration Guide** | `PRODUCTION_CONFIGURATION_CHECKLIST.md` |
| **Frontend Documentation** | `README_FRONTEND_DOCS.md` |
| **API Reference** | `API_ENDPOINTS_REFERENCE.md` |
| **Firebase Console** | https://console.firebase.google.com |
| **Stripe Dashboard** | https://dashboard.stripe.com |
| **Sumsub Cockpit** | https://cockpit.sumsub.com |
| **SendGrid Dashboard** | https://app.sendgrid.com |

---

## 🚀 Next Steps

1. **Read Full Guide**: Open `PRODUCTION_CONFIGURATION_CHECKLIST.md`
2. **Choose Path**: Full production setup OR quick dev setup
3. **Sign Up for Services**: Create accounts for all required services
4. **Collect API Keys**: Follow the guide to get all credentials
5. **Create .env File**: Copy values to `.env`
6. **Deploy**: Run `firebase deploy --only functions`
7. **Test**: Verify all critical flows work
8. **Launch**: You're ready! 🎉

---

**Total Time from Zero to Deployed**: 3-4 hours for full production setup
**Minimum Time for Basic Testing**: 30 minutes with shortcuts

---

Good luck! 🍀
