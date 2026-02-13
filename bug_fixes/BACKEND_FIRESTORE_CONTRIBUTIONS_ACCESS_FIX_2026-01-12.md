# Backend Fix Proposal: Firestore global contributions access

## 1) Executive Summary
User investment page fails to load because Firestore denies reads on the global `contributions` collection. The Flutter app now queries `/{database}/documents/contributions` filtered by `contributorId`, but the rules explicitly state the global collection was removed and default-deny all access. Add read rules for authenticated contributors (and admins) to restore access.

## 2) Exact Problem
- Error observed: `Listen for Query(target=Query(contributions where contributorId==<uid> order by -createdAt, -__name__);limitType=LIMIT_TO_FIRST) failed: Status{code=PERMISSION_DENIED, description=Missing or insufficient permissions.}`
- Location: Firestore client on Investments page querying global `contributions` collection.
- Current rules: No match for `/contributions/{contributionId}`; default rule blocks everything. A note in rules says the global collection was removed, but client code now relies on it.

## 3) Root Cause
Rules and data storage are out of sync: frontend now stores/reads contributions in the top-level `contributions` collection, but Firestore rules still assume contributions live only in project/user subcollections and block global access.

## 4) Proposed Solutions (ordered)
1. **Add secure read rules for global contributions (recommended)**: Allow read when `resource.data.contributor.uid == request.auth.uid` or requester is admin; keep create/update/delete blocked (handled by Cloud Functions). Optional: allow project creator to read their project contributions if needed.
2. **(Alt) Revert frontend to use subcollections only**: Change app back to `/projects/{projectId}/contributions` + `/users/{uid}/contributions`. Higher dev effort; not recommended since recent code migrated to global collection.

## 5) Implementation Instructions
- File: `firestore.rules`
- Insert below existing collections section (after projects or before audits) a new match for `/contributions/{contributionId}`.
- Rule snippet:
```
    // ============================================
    // COLLECTION: contributions (global)
    // ============================================

    match /contributions/{contributionId} {
      // Lecture : contributeur propriétaire ou admin
      allow read: if isOwner(resource.data.contributor.uid) || isAdmin();

      // Création/Mise à jour/Suppression : via Cloud Functions uniquement
      allow create, update, delete: if false;
    }
```
- Remove or update the comment block that says the global collection was removed to avoid future confusion.
- After editing, run sync script and deploy:
  - `powershell -File scripts\sync_firestore_rules.ps1`
  - `firebase deploy --only firestore:rules`

## 6) File Locations to Modify
- `firestore.rules` (add match block as above; near the current note about global contributions removal).

## 7) Test Validation
- Flutter app: sign in as contributor; open Investments page → history loads without permission errors.
- Firestore Rules emulator or production: simulate `get`/`list` on `/contributions` with `request.auth.uid == contributorId` → allowed; with different uid → denied.
- Ensure write attempts from client remain denied.

## 8) Impact Assessment
- Security: Keeps write operations locked to Cloud Functions; read exposure limited to owner or admin. No public data leak if contributor field is enforced.
- Performance: Query limited to contributorId + ordered by createdAt; no additional indexes required unless Firestore requests one.
- Complexity: Low—single rules block addition and deployment.

## 9) References
- Error log from `flutter run` on 2026-01-12.
- Frontend datasource: investments Firestore datasource now queries global `contributions` filtered by `contributorId`.
