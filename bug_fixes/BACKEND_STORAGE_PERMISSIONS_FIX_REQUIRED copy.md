# BACKEND FIX REQUIRED - Firebase Storage Permissions for Project Images

**Date**: 7 Janvier 2026  
**Priority**: 🔴 CRITICAL  
**Type**: Backend Configuration  
**Impact**: Blocking project creation and modification with images

---

## 🚨 Problem Description

### Error Messages
```
E/StorageException(18653): StorageException has occurred.
E/StorageException(18653): User does not have permission to access this object.
E/StorageException(18653):  Code: -13021 HttpResult: 403
E/StorageException(18653): The server has terminated the upload session

E/StorageException(18653): Caused by: java.io.IOException: {  "error": {    "code": 403,    "message": "Permission denied."  }}

I/flutter (18653): ❌ Upload error: [firebase_storage/unauthorized] User is not authorized to perform the desired action.
I/flutter (18653): ❌ Error uploading cover image: [firebase_storage/unauthorized] User is not authorized to perform the desired action.
```

### Issue Summary
The frontend application **cannot upload images** to Firebase Storage. When users try to:
1. Create a new project with a cover image
2. Add additional images to a new project
3. Update an existing project with new images

The upload fails with `403 Permission denied` errors.

**Affected User**: `5GqHzQJ4wrRawS6z2GY1opoSb543` (ericvekout2022@gmail.com)

### Upload Paths Attempted
Based on the frontend code, images are uploaded to:
- Cover images: `projects/{projectId}/cover.jpg`
- Additional images: `projects/{projectId}/additional_{index}.jpg`
- Project images during creation: `projects/{tempId}/...`

---

## 🔍 Root Cause Analysis

### Current Storage Rules Status
The Firebase Storage security rules are either:
1. ❌ **Missing entirely** - No rules defined for project image uploads
2. ❌ **Too restrictive** - Rules don't allow authenticated users to upload images
3. ❌ **Incorrect paths** - Rules don't match the actual upload paths used by the frontend

### Expected Storage Structure
```
/projects/
  ├── {projectId}/
  │   ├── cover.jpg           (Project cover image)
  │   ├── additional_0.jpg    (Additional image 1)
  │   ├── additional_1.jpg    (Additional image 2)
  │   └── additional_2.jpg    (Additional image 3)
```

### Upload Flow
1. **User creates/edits a project**
2. **User selects images** (cover + up to 3 additional)
3. **Images are compressed** (Frontend: 96KB → 17KB)
4. **Upload to Storage** → ❌ **FAILS with 403**
5. **Project creation continues** but without images

---

## ✅ Required Solution

### Step 1: Verify Current Rules

**File**: `storage.rules`

Check if there are rules for the `projects` folder:

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // Check what's currently here
  }
}
```

### Step 2: Implement Correct Rules

Add or replace the storage rules with the following:

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    
    // ========== PROJECT IMAGES ==========
    match /projects/{projectId}/{imageFile} {
      
      // Allow authenticated users to read any project images
      allow read: if request.auth != null;
      
      // Allow project creators to upload images to their projects
      // We verify ownership by checking the Firestore project document
      allow write: if request.auth != null && 
                      isProjectOwner(projectId, request.auth.uid);
      
      // Allow deletion only by project owner or admin
      allow delete: if request.auth != null && 
                       (isProjectOwner(projectId, request.auth.uid) || 
                        isAdmin(request.auth.uid));
    }
    
    // ========== HELPER FUNCTIONS ==========
    
    // Check if user is the owner of the project
    function isProjectOwner(projectId, uid) {
      let project = firestore.get(/databases/(default)/documents/projects/$(projectId));
      // Support both creatorId (string) and creator.uid (object) formats
      return project.data.creatorId == uid || 
             (project.data.keys().hasAny(['creator']) && 
              project.data.creator.uid == uid);
    }
    
    // Check if user is an admin
    function isAdmin(uid) {
      let user = firestore.get(/databases/(default)/documents/users/$(uid));
      return user.data.role == 'admin';
    }
  }
}
```

### Step 3: Alternative Simpler Rules (If Firestore Access Not Working)

If the Firestore access in storage rules causes issues, use this simpler version:

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    
    // ========== PROJECT IMAGES (SIMPLIFIED) ==========
    match /projects/{projectId}/{imageFile} {
      
      // Allow all authenticated users to read project images
      allow read: if request.auth != null;
      
      // Allow all authenticated users to upload/update images
      // (Relies on Firestore rules to control who can create/update projects)
      allow write: if request.auth != null &&
                      request.resource.size < 10 * 1024 * 1024 && // Max 10MB
                      request.resource.contentType.matches('image/.*'); // Only images
      
      // Allow authenticated users to delete their uploads
      allow delete: if request.auth != null;
    }
  }
}
```

**Note**: The simplified version is less secure but easier to implement. Choose based on your security requirements.

### Step 4: Deploy Changes

```bash
# Deploy storage rules
firebase deploy --only storage
```

---

## 🔄 Testing the Fix

### Test 1: Upload Cover Image During Creation
1. Go to `/projects/create`
2. Fill in project details
3. Select a cover image
4. Click "Create Project"
5. **Expected**: ✅ Image uploads successfully, project created with image

### Test 2: Upload Additional Images
1. Create a project
2. Add up to 3 additional images
3. **Expected**: ✅ All images upload successfully

### Test 3: Update Project with New Cover Image
1. Go to existing project
2. Click "Edit"
3. Change cover image
4. Click "Save Changes"
5. **Expected**: ✅ New image uploads, old image remains or is replaced

### Test 4: Frontend Verification
After deployment, check logs for:
```
✅ Image compressed: 96KB → 17KB (82% reduction)
✅ Image uploaded successfully
✅ Project created with ID: xxx
```

**Should NOT see**:
```
❌ StorageException: User does not have permission
❌ Upload error: [firebase_storage/unauthorized]
❌ Error uploading cover image
```

---

## 📊 Impact Analysis

### Before Fix (Current State)
- ❌ Projects cannot have images
- ❌ All image uploads fail with 403
- ❌ Projects are created in Firestore but appear without images
- ❌ User experience is broken (image upload seems to work but fails)

### After Fix (Expected)
- ✅ Users can upload cover images for projects
- ✅ Users can add up to 3 additional images
- ✅ Users can update project images
- ✅ Images are properly stored and displayed
- ✅ Security maintained (only project owners can upload/modify)

---

## 🔗 Related Files

### Backend Files to Modify
1. **`storage.rules`** - Firebase Storage security rules

### Frontend Files Using Storage
1. `lib/features/projects/data/datasources/projects_storage_datasource.dart`
2. `lib/features/projects/domain/usecases/create_project_usecase.dart`
3. `lib/features/projects/domain/usecases/update_project_usecase.dart`

---

## 🚧 Known Issues Related to This

### Issue 1: AppCheck Warning
```
W/StorageUtil(18653): Error getting App Check token; using placeholder token instead.
```

**Impact**: Not critical - App Check is not configured. This is a warning, not an error.  
**Action**: Optional - Configure Firebase App Check for better security.

### Issue 2: Image Compression Works
```
I/flutter (18653): ✅ Image compressed: 96KB → 17KB (82% reduction)
```

**Status**: ✅ Working correctly - Images are compressed before upload.  
**No action needed**.

---

## 📝 Additional Notes

### Security Considerations
- ✅ Rules enforce authentication (only logged-in users can upload)
- ✅ File size limit (10MB max) prevents abuse
- ✅ File type validation (only images allowed)
- ✅ Project ownership verification (via Firestore)
- ✅ Admin override for deletions

### Performance Considerations
- Images are compressed on the client before upload (96KB → 17KB)
- Storage quota should be monitored as users upload images
- Consider implementing image optimization/resizing on the backend (Cloud Functions)

### Future Improvements
Consider adding:
- Automatic thumbnail generation (Cloud Functions)
- Image format conversion to WebP (better compression)
- CDN integration for faster image delivery
- Cleanup of orphaned images (projects deleted but images remain)
- Image moderation (Cloud Vision API)

---

## 📋 Validation Checklist

### Before Deployment
- [ ] Backup current `storage.rules` file
- [ ] Review rules for security implications
- [ ] Test rules in Firebase Console Rules Playground (if available)
- [ ] Ensure Firestore rules for projects collection are correct

### Deployment Steps
- [ ] Deploy: `firebase deploy --only storage`
- [ ] Verify deployment success in Firebase Console
- [ ] Check Storage Rules tab shows new rules
- [ ] Monitor logs for any errors

### After Deployment
- [ ] Test project creation with cover image
- [ ] Test project creation with additional images
- [ ] Test project update with new images
- [ ] Verify images are visible in Firebase Storage Console
- [ ] Check frontend logs show successful uploads
- [ ] Update this document with "RESOLVED" status

---

## 🔧 Troubleshooting

### If uploads still fail after deploying rules:

**1. Check deployed rules**
```bash
firebase storage:rules:get
```

**2. Verify authentication**
- Ensure user is properly authenticated in frontend
- Check that `request.auth.uid` is available

**3. Check Firestore project ownership**
- Verify projects have `creatorId` field set correctly
- Ensure `creatorId` matches user UID

**4. Test with simplified rules**
- Try the simpler rules version without Firestore access
- This helps isolate if the issue is with Firestore integration

**5. Check Storage CORS**
- Storage CORS should allow uploads from your app domain
- Usually configured automatically by Firebase

---

## ✅ Success Criteria

The issue will be considered **RESOLVED** when:

1. ✅ Frontend logs show **NO** `firebase_storage/unauthorized` errors
2. ✅ Images upload successfully during project creation
3. ✅ Images upload successfully during project updates
4. ✅ Images are visible in Firebase Storage Console
5. ✅ Images are displayed correctly in the app
6. ✅ All security rules tests pass

---

## 📞 Contact

**Issue Reported By**: Frontend Developer  
**User Affected**: ericvekout2022@gmail.com (UID: 5GqHzQJ4wrRawS6z2GY1opoSb543)  
**Date Reported**: 7 Janvier 2026  
**Urgency**: CRITICAL - Blocking core functionality (project images)

---

**Status**: 🔴 PENDING BACKEND FIX  
**Last Updated**: 7 Janvier 2026  
**Expected Resolution**: Within 24 hours

---

## 📎 Example Logs

### Current (Failing)
```
I/flutter: ✅ Image compressed: 96KB → 17KB (82% reduction)
E/StorageException: User does not have permission to access this object.
E/StorageException:  Code: -13021 HttpResult: 403
I/flutter: ❌ Upload error: [firebase_storage/unauthorized]
I/flutter: ❌ Error uploading cover image: [firebase_storage/unauthorized]
I/flutter: ! Cover image upload failed
```

### Expected (Working)
```
I/flutter: ✅ Image compressed: 96KB → 17KB (82% reduction)
I/flutter: 📤 Uploading image to: projects/abc123/cover.jpg
I/flutter: ✅ Image uploaded successfully
I/flutter: ✅ Project created with ID: abc123
I/flutter: 🖼️ Cover image URL: https://firebasestorage.googleapis.com/...
```
