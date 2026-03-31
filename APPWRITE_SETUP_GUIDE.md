# Tesla Broker — Appwrite Setup Guide

## Overview
This guide walks you through setting up Appwrite Cloud (free tier) to power the Tesla Broker platform. Follow every step in order.

---

## STEP 1 — Create Your Appwrite Account & Project

1. Go to **https://cloud.appwrite.io** and sign up for a free account.
2. Click **"Create Project"** → enter name: `Tesla Broker` → click **Create**.
3. Copy your **Project ID** from **Project Settings → General**.
4. Open **`appwrite.js`** and replace `YOUR_PROJECT_ID` with your actual Project ID:
   ```js
   const APPWRITE_PROJECT = 'your-actual-project-id-here';
   ```

---

## STEP 2 — Enable Email/Password Authentication

1. In your Appwrite Console sidebar, go to **Auth → Settings**.
2. Under **Auth Methods**, enable **Email/Password**.
3. Under **Email OTP**, enable **Email OTP** (this powers the 6-digit code on registration).
4. Set the OTP length to **6 digits**.
5. Go to **Auth → Templates** → customize the **Verification** and **Password Recovery** emails if you wish.

---

## STEP 3 — Create the Database

1. In sidebar go to **Databases** → click **"Create Database"**.
2. Set Database ID to: `tesla_broker` (must match exactly).
3. Click **Create**.

---

## STEP 4 — Create Collections

Create each collection below inside the `tesla_broker` database.

### Collection: `profiles`
**Collection ID:** `profiles`

| Attribute Key        | Type    | Required | Default |
|---------------------|---------|----------|---------|
| `firstName`         | String  | Yes      |         |
| `lastName`          | String  | Yes      |         |
| `phone`             | String  | No       |         |
| `country`           | String  | No       |         |
| `email`             | Email   | Yes      |         |
| `balance`           | Float   | No       | `0`     |
| `investmentPlan`    | String  | No       |         |
| `investmentAmount`  | Float   | No       | `0`     |

**Permissions:**
- Click **Settings** tab → **Permissions** → Add:
  - **Role: Any** → Read ❌ Write ❌
  - **Role: Users** → Read ✅ (only their own doc)
  - **Role: Users** → Update ✅ (only their own doc)
- For admin to read all profiles, use **API Key** (Step 8).

> ⚠️ Document-level permissions: When creating a profile document in `verifyOTPAndLogin()`, Appwrite automatically sets the document owner to the authenticated user, so they can only read/update their own profile. The admin reads all profiles via server-side API key.

---

### Collection: `deposits`
**Collection ID:** `deposits`

| Attribute Key    | Type   | Required | Default    |
|-----------------|--------|----------|------------|
| `userId`        | String | Yes      |            |
| `amount`        | Float  | Yes      |            |
| `method`        | String | Yes      |            |
| `walletAddress` | String | No       |            |
| `receiptFileId` | String | No       |            |
| `status`        | String | Yes      | `pending`  |

**Permissions:** Users can create + read their own. Admin reads all via API key.

---

### Collection: `withdrawals`
**Collection ID:** `withdrawals`

| Attribute Key      | Type   | Required |
|-------------------|--------|----------|
| `userId`          | String | Yes      |
| `amount`          | Float  | Yes      |
| `recipientName`   | String | Yes      |
| `bankName`        | String | Yes      |
| `accountNumber`   | String | Yes      |
| `routingNumber`   | String | No       |
| `swiftCode`       | String | No       |
| `achRouting`      | String | No       |
| `wireRouting`     | String | No       |
| `ein`             | String | No       |
| `recipientAddress`| String | No       |
| `bankAddress`     | String | No       |
| `status`          | String | Yes      | `pending` |

**Permissions:** Same as deposits.

---

### Collection: `investments`
**Collection ID:** `investments`

| Attribute Key    | Type   | Required | Default   |
|-----------------|--------|----------|-----------|
| `userId`        | String | Yes      |           |
| `planName`      | String | Yes      |           |
| `amount`        | Float  | Yes      |           |
| `expectedPayout`| Float  | Yes      |           |
| `status`        | String | Yes      | `active`  |

**Permissions:** Same as deposits.

---

## STEP 5 — Create Indexes (Required for Queries)

For each collection, add these indexes so `Query.equal('userId', ...)` works:

### In `deposits` collection → **Indexes** tab:
- Click **Create Index**
- Key: `userId`, Type: **Key**, Attributes: `userId` → Save
- Key: `status`, Type: **Key**, Attributes: `status` → Save

### In `withdrawals` collection → **Indexes** tab:
- Same: `userId` index and `status` index

### In `investments` collection → **Indexes** tab:
- `userId` index, `status` index

---

## STEP 6 — Create Storage Bucket for Receipts

1. In sidebar go to **Storage** → **Create Bucket**.
2. Set Bucket ID: `receipts` (must match exactly).
3. Set **Maximum file size**: `10 MB`.
4. Allow file extensions: `jpg, jpeg, png, pdf, webp`.
5. **Permissions:**
   - Users can **create** (upload) their own files.
   - Admin reads all via API key.

---

## STEP 7 — Configure Collection Permissions (Detailed)

For each collection (`profiles`, `deposits`, `withdrawals`, `investments`), go to the collection's **Settings → Permissions** and set:

```
Role: Users    → Create ✅
Role: Users    → Read   ✅ (document-level, restricted to owner)
Role: Users    → Update ✅ (document-level, restricted to owner)
```

This means a logged-in user can only access their own documents by default.

For the admin to access ALL documents (across users), the admin operates with elevated privileges via an **API Key** in a backend function. For this client-only project, add:

```
Role: Any → Read ✅
```

> ⚠️ **Security Note**: For production, use Appwrite Functions as a backend proxy for admin operations so the admin API key is never exposed in the browser. For development/testing, the above is acceptable.

---

## STEP 8 — Set Up Admin Account in Appwrite Auth

The admin logs in like a normal user (email + password), but is identified by their email address. You need to manually create the admin account:

1. Go to **Auth → Users** → **Create User**.
2. Fill in:
   - **User ID**: (leave blank for auto-generate)
   - **Email**: `teslabroker@gmail.com`
   - **Password**: `admin@teslabroker.com`
   - **Name**: `Tesla Admin`
3. Click **Create**.

The app will detect this email and redirect to `admin.html` instead of `dashboard.html`.

---

## STEP 9 — Configure Hosting / File Paths

Your files must be served from a web server (not opened as `file://`). Options:

### Option A — Appwrite Hosting (Recommended)
1. Go to **Hosting** → **Create Site**.
2. Upload your 5 files: `auth.html`, `dashboard.html`, `reset.html`, `admin.html`, `appwrite.js`.
3. Note your site URL (e.g., `https://yoursite.appwrite.network`).
4. In **Auth → Settings → Allowed Origins**, add your site URL.

### Option B — VS Code Live Server (Local Dev)
1. Install the **Live Server** extension in VS Code.
2. Right-click `auth.html` → **Open with Live Server**.
3. In **Appwrite Console → Auth → Settings → Allowed Origins**, add: `http://localhost:5500`

### Option C — Any Static Host (Netlify, Vercel, etc.)
1. Deploy your files.
2. Add the deployed URL to **Appwrite → Auth → Settings → Allowed Origins**.

---

## STEP 10 — Set the Password Recovery Redirect URL

In `auth.html`, the forgot password form calls:
```js
const resetUrl = window.location.origin + '/reset.html';
```

This auto-detects your site's URL. When Appwrite sends the recovery email, it appends `?userId=xxx&secret=xxx` to this URL. When the user clicks the link, `reset.html` reads these params and lets them set a new password.

No additional configuration needed — this is handled automatically.

---

## STEP 11 — Test the Full Flow

### ✅ User Registration
1. Open `auth.html` → click **Register**.
2. Fill in the form → Submit.
3. Check email for the 6-digit OTP.
4. Enter OTP → you should be redirected to `dashboard.html`.

### ✅ User Login
1. Open `auth.html` → Login tab.
2. Enter your registered email/password → Submit.
3. Should redirect to `dashboard.html` with your name shown.

### ✅ Admin Login
1. Open `auth.html` → Login tab.
2. Enter `teslabroker@gmail.com` / `admin@teslabroker.com`.
3. Should redirect to `admin.html`.

### ✅ Deposit Flow
1. In dashboard, go to **Deposit** → select BTC or ETH.
2. Enter an amount, upload a receipt image → Submit.
3. Go to admin → **Deposits** → you should see the pending deposit.
4. Click Approve → user's balance should increase.

### ✅ Password Reset
1. On `auth.html` login, click **Forgot password**.
2. Enter your email → check email for recovery link.
3. Click the link → you'll be on `reset.html` step 3 (new password).
4. Enter new password → Success.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `AppwriteException: Invalid origin` | Add your URL to Auth → Settings → Allowed Origins |
| `AppwriteException: Unauthorized` | The user isn't logged in — check auth guard works |
| `AppwriteException: Document not found` | Profile wasn't created after OTP — check `verifyOTPAndLogin` ran |
| OTP email not received | Check Appwrite Console → **Messaging** → ensure SMTP is configured, or use Appwrite's built-in email |
| `Invalid credentials` on login | Double-check password, or check if the user account was created in Appwrite Auth |
| Balance not updating after deposit approve | Check that the profiles collection has `balance` attribute as Float |

---

## File Summary

| File | Purpose |
|------|---------|
| `appwrite.js` | All Appwrite SDK setup & helper functions — **edit PROJECT ID here** |
| `auth.html` | Login/Register with OTP verification |
| `dashboard.html` | User dashboard with deposit, withdrawal, investment |
| `reset.html` | Password reset flow |
| `admin.html` | Admin panel — full user/deposit/withdrawal management |

---

## Quick Reference — Appwrite IDs to Use

```
Database ID:        tesla_broker
Collections:        profiles, deposits, withdrawals, investments
Storage Bucket:     receipts
Admin Email:        teslabroker@gmail.com
Admin Password:     admin@teslabroker.com
```
