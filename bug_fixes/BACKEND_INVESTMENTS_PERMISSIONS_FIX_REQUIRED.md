# BACKEND FIX REQUIRED - Investments Collection Permissions

**Date**: 7 Janvier 2026  
**Priority**: 🔴 CRITICAL  
**Type**: Backend Configuration  
**Impact**: Blocking user investments functionality

---

## 🚨 Problem Description

### Error Message
```
W/Firestore(17562): (25.1.4) [Firestore]: Listen for Query(target=Query(investments where investorId==5GqHzQJ4wrRawS6z2GY1opoSb543 order by __name__);limitType=LIMIT_TO_FIRST) failed: Status{code=PERMISSION_DENIED, description=Missing or insufficient permissions., cause=null}

I/flutter (17562): Error fetching dashboard stats: [cloud_firestore/permission-denied] The caller does not have permission to execute the specified operation.
```

### Issue Summary
The frontend application **cannot read** from the `investments` collection in Firestore. When users try to access their investment dashboard or view their portfolio, queries fail with `PERMISSION_DENIED`.

**Affected User**: `5GqHzQJ4wrRawS6z2GY1opoSb543` (ericvekout2022@gmail.com)

### Query Failing
```javascript
// Frontend query attempting to execute:
Query(investments where investorId==5GqHzQJ4wrRawS6z2GY1opoSb543 order by __name__)
```

---

## 🔍 Root Cause Analysis

### Current Firestore Rules Status
The Firestore security rules for the `investments` collection are either:
1. ❌ **Missing entirely** - No rules defined for `/investments/{investmentId}`
2. ❌ **Too restrictive** - Rules don't allow authenticated users to read their own investments
3. ❌ **Incorrect field reference** - Rules use wrong field name (e.g., `investor.uid` vs `investorId`)

### Data Structure Expected
Based on the query pattern, the `investments` collection should have documents with:
```typescript
interface Investment {
  id: string;
  investorId: string;  // ← Field used in query (direct UID string)
  projectId: string;
  amount: number;
  currency: string;
  status: 'pending' | 'completed' | 'failed';
  timestamp: Timestamp;
  // ... other fields
}
```

**IMPORTANT**: The query uses `investorId` as a **direct string field**, NOT a nested object like `investor.uid`.

---

## ✅ Required Solution

### Step 1: Verify Current Rules

**File**: `firestore.rules`

Check if there's a rule for the `investments` collection:

```javascript
match /investments/{investmentId} {
  // Check what's currently here (if anything)
}
```

### Step 2: Implement Correct Rules

Add or replace the `investments` collection rules with the following:

```javascript
// firestore.rules

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // ========== INVESTMENTS COLLECTION ==========
    match /investments/{investmentId} {
      
      // Allow users to read their own investments
      allow read: if request.auth != null && 
                     (resource.data.investorId == request.auth.uid);
      
      // Allow users to create investments (for contributing to projects)
      allow create: if request.auth != null && 
                       request.resource.data.investorId == request.auth.uid &&
                       request.resource.data.amount > 0 &&
                       request.resource.data.projectId is string &&
                       request.resource.data.status in ['pending', 'completed', 'failed'];
      
      // Allow users to update their own investments (e.g., cancel pending)
      allow update: if request.auth != null && 
                       resource.data.investorId == request.auth.uid &&
                       // Only allow updating specific fields
                       !request.resource.data.diff(resource.data).affectedKeys()
                         .hasAny(['investorId', 'projectId', 'amount']);
      
      // Only admins can delete investments
      allow delete: if request.auth != null && 
                       get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }
    
    // Other collections...
  }
}
```

### Step 3: Create Required Indexes

**File**: `firestore.indexes.json`

Add indexes for common investment queries:

```json
{
  "indexes": [
    {
      "collectionGroup": "investments",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "investorId",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "__name__",
          "order": "ASCENDING"
        }
      ]
    },
    {
      "collectionGroup": "investments",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "investorId",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "timestamp",
          "order": "DESCENDING"
        }
      ]
    },
    {
      "collectionGroup": "investments",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "projectId",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "timestamp",
          "order": "DESCENDING"
        }
      ]
    },
    {
      "collectionGroup": "investments",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "investorId",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "status",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "timestamp",
          "order": "DESCENDING"
        }
      ]
    }
  ],
  "fieldOverrides": []
}
```

### Step 4: Deploy Changes

```bash
# Test rules locally (optional)
firebase emulators:start --only firestore

# Deploy to production
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
```

---

## 🔄 Alternative: Support Both Data Formats

If the backend uses **both** `investorId` (string) **and** `investor.uid` (nested object) formats, use this rule:

```javascript
match /investments/{investmentId} {
  allow read: if request.auth != null && (
    // Support direct investorId field
    resource.data.investorId == request.auth.uid ||
    // Support nested investor.uid field
    (resource.data.keys().hasAny(['investor']) && 
     resource.data.investor.uid == request.auth.uid)
  );
  
  // ... other rules
}
```

---

## 🧪 Verification Steps

After deploying the fixes, verify with these tests:

### Test 1: Read Own Investments
```javascript
// Firebase Console -> Firestore -> Rules Playground
// Operation: get
// Path: /investments/{someInvestmentId}
// Auth: User with UID matching investorId
// Expected: ✅ ALLOW
```

### Test 2: Read Other User's Investments
```javascript
// Operation: get
// Path: /investments/{someInvestmentId}
// Auth: User with DIFFERENT UID
// Expected: ❌ DENY
```

### Test 3: List User's Investments
```javascript
// Operation: list
// Path: /investments
// Auth: User with UID
// Query: where investorId == {auth.uid}
// Expected: ✅ ALLOW
```

### Test 4: Frontend Verification
After deployment, check frontend logs for:
```
✅ Successfully fetched investments
✅ Dashboard stats loaded
```

**Should NOT see**:
```
❌ PERMISSION_DENIED
❌ Missing or insufficient permissions
```

---

## 📊 Impact Analysis

### Before Fix (Current State)
- ❌ Users cannot view their investment portfolio
- ❌ Dashboard shows errors instead of stats
- ❌ Investment tracking completely broken
- ❌ Users cannot contribute to projects

### After Fix (Expected)
- ✅ Users can view their own investments
- ✅ Dashboard displays correct statistics
- ✅ Investment tracking functional
- ✅ Users can contribute to projects
- ✅ Security maintained (users can only see their own data)

---

## 🔗 Related Files

### Backend Files to Modify
1. **`firestore.rules`** - Security rules for all collections
2. **`firestore.indexes.json`** - Composite indexes for queries

### Frontend Files Using Investments
1. `lib/features/investments/data/repositories/investments_repository.dart`
2. `lib/features/investments/presentation/providers/investments_providers.dart`
3. `lib/features/auth/presentation/providers/dashboard_providers.dart`

---

## 🚧 Known Issues Related to This

### Issue 1: Similar Problem in Projects Collection (RESOLVED)
Previously, the `projects` collection had the same permission issue with `creatorId` vs `creator.uid`. This was fixed by supporting both formats:

```javascript
// firestore.rules - projects collection (WORKING EXAMPLE)
match /projects/{projectId} {
  allow read: if request.auth != null && (
    resource.data.creatorId == request.auth.uid ||
    (resource.data.keys().hasAny(['creator']) && 
     resource.data.creator.uid == request.auth.uid)
  );
}
```

### Issue 2: Missing Indexes
If deployment succeeds but queries still fail, check Firestore console for missing index errors and create the suggested indexes.

---

## 📝 Additional Notes

### Security Considerations
- ✅ Rules enforce that users can only read their **own** investments
- ✅ Users cannot modify critical fields (investorId, projectId, amount) after creation
- ✅ Only admins can delete investments
- ✅ Amount validation ensures positive values

### Performance Considerations
- The indexes are optimized for common queries:
  - List all investments by user
  - List investments by project
  - Filter investments by status
  - Sort by timestamp (most recent first)

### Future Improvements
Consider adding:
- Rule for admins to read all investments
- Rule for project creators to see investments in their projects
- Validation for currency field
- Validation for status transitions

---

## ✅ Checklist for Backend Developer

- [ ] Verify current `investments` collection rules in `firestore.rules`
- [ ] Implement or update rules to allow user read access
- [ ] Add required composite indexes to `firestore.indexes.json`
- [ ] Test rules in Firebase Console Rules Playground
- [ ] Deploy rules: `firebase deploy --only firestore:rules`
- [ ] Deploy indexes: `firebase deploy --only firestore:indexes`
- [ ] Wait for indexes to build (check Firebase Console)
- [ ] Verify in frontend application (check logs)
- [ ] Update this document with "RESOLVED" status
- [ ] Notify frontend team that fix is deployed

---

## 📞 Contact

**Issue Reported By**: Frontend Developer  
**User Affected**: ericvekout2022@gmail.com (UID: 5GqHzQJ4wrRawS6z2GY1opoSb543)  
**Date Reported**: 7 Janvier 2026  
**Urgency**: CRITICAL - Blocking core functionality

---

## 🎯 Success Criteria

The issue will be considered **RESOLVED** when:

1. ✅ Frontend logs show **NO** `PERMISSION_DENIED` errors for investments collection
2. ✅ Dashboard statistics load successfully
3. ✅ Users can view their investment portfolio
4. ✅ Users can create new investments (contribute to projects)
5. ✅ All Firestore rules tests pass in Firebase Console

---

**Status**: 🔴 PENDING BACKEND FIX  
**Last Updated**: 7 Janvier 2026  
**Expected Resolution**: Within 24 hours
