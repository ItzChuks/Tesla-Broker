/**
 * ╔══════════════════════════════════════════════════════════════╗
 *   TESLA BROKER — APPWRITE v16 CONFIG & HELPERS
 *
 *   ONE THING TO EDIT:
 *   Replace 'YOUR_PROJECT_ID' below with your Appwrite Project ID
 *   (found in Appwrite Console → Project Settings → Project ID)
 * ╚══════════════════════════════════════════════════════════════╝
 */

// ─── SDK (loaded via <script> tag before this file) ───────────
const { Client, Account, Databases, Storage, Query, ID } = Appwrite;

// ─── YOUR CONFIG ──────────────────────────────────────────────
const APPWRITE_ENDPOINT = 'https://cloud.appwrite.io/v1';
const APPWRITE_PROJECT  = '69ab43d4003b2d8e2d87'; // ← REPLACE THIS

// These IDs must exactly match what you create in the Appwrite Console
const DB_ID           = '69ab446900079ae7df91';
const PROFILES_COL    = 'profiles';
const DEPOSITS_COL    = 'deposits';
const WITHDRAWALS_COL = 'withdrawals';
const INVESTMENTS_COL = 'investments';
const RECEIPTS_BUCKET = '69cc0e76003afe87127c';

// Support chat collections (create these in Appwrite Console)
const SUPPORT_TICKETS_COL  = 'support_tickets';
const SUPPORT_MESSAGES_COL = 'support_messages';

// Vendors collection (create in Appwrite Console)
// Required attributes: name (string), code (string, unique), createdAt (string)
const VENDORS_COL = 'vendors';

// Admin account is identified by this email after a normal login
const ADMIN_EMAIL    = 'teslabroker@gmail.com';
const ADMIN_PASSWORD = 'admin@teslabroker.com';

// ─── SDK CLIENTS ──────────────────────────────────────────────
const client = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT);

const account   = new Account(client);
const databases = new Databases(client);
const storage   = new Storage(client);

// ══════════════════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════════════════

/**
 * REGISTRATION — creates account with email+password, logs in, saves profile.
 * No OTP. No email verification. One step.
 */
/** Generate a unique 4-digit withdrawal PIN (0001–9999) */
function generateWithdrawalPin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

async function registerUser({ userId, email, password, firstName, lastName, phone, country, referralCode }) {
  const fullName = (firstName.trim() + ' ' + lastName.trim()).trim();

  // 1. Create the Appwrite account with email + password
  await account.create(userId, email, password, fullName);

  // 2. Log them in immediately
  await account.createEmailPasswordSession(email, password);

  // 3. Save extended profile to the database (non-fatal if DB write fails)
  try {
    await createOrUpdateProfile(userId, {
      firstName:        firstName.trim(),
      lastName:         lastName.trim(),
      phone:            phone    || '',
      country:          country  || '',
      email,
      balance:          0,
      investmentPlan:   '',
      investmentAmount: 0,
      withdrawalPin:    generateWithdrawalPin(),
      referralCode:     referralCode || '',
    });
  } catch (profileErr) {
    console.warn('Profile save failed (non-fatal):', profileErr);
  }
}

/** Login with email + password (used for both users and admin) */
async function loginUser(email, password) {
  return await account.createEmailPasswordSession(email, password);
}

/**
 * Get the currently logged-in Appwrite user, or null.
 * Never throws — safe to call on every page load.
 */
async function getCurrentUser() {
  try {
    return await account.get();
  } catch {
    return null;
  }
}

/** Delete the current session (logout) */
async function logoutUser() {
  try { await account.deleteSession('current'); } catch {}
}

/** Resend a fresh OTP to the same userId + email */
async function resendOTP(userId, email) {
  await account.createEmailToken(userId, email);
}

/**
 * FORGOT PASSWORD — OTP FLOW
 *
 * Step 1: sendPasswordResetOTP(email)
 *   → calls createEmailToken() which emails the user a 6-digit OTP
 *   → returns { userId } to store client-side for step 2
 *
 * Step 2: verifyPasswordResetOTP(userId, otp)
 *   → verifies the OTP by creating a session
 *   → returns true on success, throws on failure
 *
 * Step 3: updatePasswordAfterReset(newPassword)
 *   → updates the password on the now-authenticated session
 *   → logs the user out so they log in fresh
 */

async function sendPasswordResetOTP(email) {
  // In Appwrite v16, createEmailToken(userId, email) sends a 6-digit OTP.
  // We must NOT pass a third argument — it is not supported and causes
  // Appwrite to silently misbehave (ghost user creation, no OTP sent).
  // Instead, we first look up the user's real userId from their profile
  // in our database so the OTP is tied to the correct existing account.
  const profiles = await databases.listDocuments(DB_ID, PROFILES_COL, [
    Query.equal('email', email.trim()),
    Query.limit(1),
  ]);
  if (!profiles.documents.length) {
    throw new Error('No account found with this email address.');
  }
  const userId = profiles.documents[0].$id;
  const token  = await account.createEmailToken(userId, email.trim());
  return { userId: token.userId };
}

async function verifyPasswordResetOTP(userId, otp) {
  // Create a session using the OTP — throws if code is wrong/expired
  await account.createSession(userId, otp);
  return true;
}

async function updatePasswordAfterReset(newPassword) {
  // User is now authenticated via OTP session — update their password
  await account.updatePassword(newPassword);
  // Log out the temporary session so they sign in fresh
  try { await account.deleteSession('current'); } catch {}
}

// Legacy link-based reset (kept for backwards compat)
async function initiatePasswordReset(email, redirectUrl) {
  return await account.createRecovery(email, redirectUrl);
}
async function completePasswordReset(userId, secret, newPassword) {
  return await account.updateRecovery(userId, secret, newPassword, newPassword);
}

// ══════════════════════════════════════════════════════════════
//  PROFILES
// ══════════════════════════════════════════════════════════════

/** Get a single user profile document. Returns null if not found. */
async function getUserProfile(userId) {
  try {
    return await databases.getDocument(DB_ID, PROFILES_COL, userId);
  } catch (err) {
    if (err.code === 404) return null;
    throw err;
  }
}

/** Update fields in an existing profile document */
async function updateUserProfile(userId, data) {
  return await databases.updateDocument(DB_ID, PROFILES_COL, userId, data);
}

/**
 * Create a profile document. If it already exists (409 conflict),
 * update it instead. Safe to call multiple times.
 */
async function createOrUpdateProfile(userId, data) {
  try {
    return await databases.createDocument(DB_ID, PROFILES_COL, userId, data);
  } catch (err) {
    if (err.code === 409) {
      return await databases.updateDocument(DB_ID, PROFILES_COL, userId, data);
    }
    throw err;
  }
}

/** Get all profile documents — admin use only */
async function getAllProfiles() {
  const res = await databases.listDocuments(DB_ID, PROFILES_COL, [
    Query.orderDesc('$createdAt'),
    Query.limit(500),
  ]);
  return res.documents;
}

// ══════════════════════════════════════════════════════════════
//  DEPOSITS
// ══════════════════════════════════════════════════════════════

/** Upload a receipt file to Appwrite Storage. Returns the fileId. */
async function uploadReceipt(file) {
  const res = await storage.createFile(RECEIPTS_BUCKET, ID.unique(), file);
  return res.$id;
}

/** Build a direct preview URL for a stored receipt */
function getReceiptUrl(fileId) {
  if (!fileId) return null;
  return `${APPWRITE_ENDPOINT}/storage/buckets/${RECEIPTS_BUCKET}/files/${fileId}/view?project=${APPWRITE_PROJECT}`;
}

/** Create a pending deposit record in the database */
async function submitDepositRequest({ userId, amount, method, walletAddress, receiptFileId }) {
  return await databases.createDocument(DB_ID, DEPOSITS_COL, ID.unique(), {
    userId,
    amount:        parseFloat(amount),
    method:        method        || '',
    walletAddress: walletAddress || '',
    receiptFileId: receiptFileId || '',
    status:        'pending',
  });
}

/** Get all deposits for one user, newest first */
async function getUserDeposits(userId) {
  const res = await databases.listDocuments(DB_ID, DEPOSITS_COL, [
    Query.equal('userId', userId),
    Query.orderDesc('$createdAt'),
    Query.limit(100),
  ]);
  return res.documents;
}

/** Get all deposits across all users (admin) */
async function getAllDeposits() {
  const res = await databases.listDocuments(DB_ID, DEPOSITS_COL, [
    Query.orderDesc('$createdAt'),
    Query.limit(500),
  ]);
  return res.documents;
}

/**
 * Approve a deposit:
 *   - Marks the deposit as 'approved'
 *   - Adds the amount to the user's balance
 * Returns the new balance.
 */
async function approveDeposit(depositId, userId, amount) {
  await databases.updateDocument(DB_ID, DEPOSITS_COL, depositId, { status: 'approved' });
  const profile    = await getUserProfile(userId);
  const newBalance = ((profile && profile.balance) || 0) + parseFloat(amount);
  await updateUserProfile(userId, { balance: newBalance });
  return newBalance;
}

/** Reject a deposit — flips status only */
async function rejectDeposit(depositId) {
  return await databases.updateDocument(DB_ID, DEPOSITS_COL, depositId, { status: 'rejected' });
}

// ══════════════════════════════════════════════════════════════
//  WITHDRAWALS
// ══════════════════════════════════════════════════════════════

/**
 * Create a pending withdrawal record.
 * method: 'btc' | 'eth' | 'bank_transfer'
 * For crypto: cryptoAddress required
 * For bank_transfer: recipientName, bankName, accountNumber required
 */
async function submitWithdrawalRequest({
  userId, amount, method,
  // crypto fields
  cryptoAddress,
  // bank fields
  recipientName, bankName, accountNumber,
  swiftCode, achRouting, wireRouting, ein, recipientAddress, bankAddress,
}) {
  return await databases.createDocument(DB_ID, WITHDRAWALS_COL, ID.unique(), {
    userId,
    amount:           parseFloat(amount),
    method:           method           || 'bank_transfer',
    cryptoAddress:    cryptoAddress    || '',
    recipientName:    recipientName    || '',
    bankName:         bankName         || '',
    accountNumber:    accountNumber    || '',
    swiftCode:        swiftCode        || '',
    achRouting:       achRouting       || '',
    wireRouting:      wireRouting      || '',
    ein:              ein              || '',
    recipientAddress: recipientAddress || '',
    bankAddress:      bankAddress      || '',
    status:           'pending',
  });
}

/** Get all withdrawals for one user, newest first */
async function getUserWithdrawals(userId) {
  const res = await databases.listDocuments(DB_ID, WITHDRAWALS_COL, [
    Query.equal('userId', userId),
    Query.orderDesc('$createdAt'),
    Query.limit(100),
  ]);
  return res.documents;
}

/** Get all withdrawals across all users (admin) */
async function getAllWithdrawals() {
  const res = await databases.listDocuments(DB_ID, WITHDRAWALS_COL, [
    Query.orderDesc('$createdAt'),
    Query.limit(500),
  ]);
  return res.documents;
}

/**
 * Approve a withdrawal:
 *   - Marks the withdrawal as 'approved'
 *   - Subtracts the amount from the user's balance
 * Returns the new balance.
 */
async function approveWithdrawal(withdrawalId, userId, amount) {
  await databases.updateDocument(DB_ID, WITHDRAWALS_COL, withdrawalId, { status: 'approved' });
  const profile    = await getUserProfile(userId);
  const newBalance = Math.max(0, ((profile && profile.balance) || 0) - parseFloat(amount));
  await updateUserProfile(userId, { balance: newBalance });
  return newBalance;
}

/** Reject a withdrawal — flips status only */
async function rejectWithdrawal(withdrawalId) {
  return await databases.updateDocument(DB_ID, WITHDRAWALS_COL, withdrawalId, { status: 'rejected' });
}

// ══════════════════════════════════════════════════════════════
//  INVESTMENTS
// ══════════════════════════════════════════════════════════════

const PLAN_PAYOUTS = {
  'Basic':     5000,
  'Silver':   25000,
  'Gold':     50000,
  'Platinum': 1000000,
};

/**
 * Confirm an investment plan:
 *   - Deducts amount from balance
 *   - Creates (or updates) the investment document
 *   - Updates the profile with the plan info
 * Returns the new balance.
 */
// Generates a safe Appwrite document ID: max 36 chars, only a-z, A-Z, 0-9, underscore
function safeDocId() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < 36; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

async function confirmInvestment(userIdOrObj, planName, amount) {
  // Support both object style: confirmInvestment({userId, planName, amount})
  // and positional style: confirmInvestment(userId, planName, amount)
  let userId;
  if (userIdOrObj && typeof userIdOrObj === 'object') {
    userId   = userIdOrObj.userId;
    planName = userIdOrObj.planName;
    amount   = userIdOrObj.amount;
  } else {
    userId = userIdOrObj;
  }

  const expectedPayout = PLAN_PAYOUTS[planName] || 0;
  const profile        = await getUserProfile(userId);
  const newBalance     = Math.max(0, ((profile && profile.balance) || 0) - parseFloat(amount));

  const existing = await databases.listDocuments(DB_ID, INVESTMENTS_COL, [
    Query.equal('userId', userId),
    Query.equal('status', 'active'),
    Query.limit(1),
  ]);

  if (existing.documents.length > 0) {
    await databases.updateDocument(DB_ID, INVESTMENTS_COL, existing.documents[0].$id, {
      planName, amount: parseFloat(amount), expectedPayout,
    });
  } else {
    await databases.createDocument(DB_ID, INVESTMENTS_COL, safeDocId(), {
      userId, planName, amount: parseFloat(amount), expectedPayout, status: 'active',
    });
  }

  await updateUserProfile(userId, {
    investmentPlan:   planName,
    investmentAmount: parseFloat(amount),
    balance:          newBalance,
  });
  return newBalance;
}

/** Get a user's active investment, or null */
async function getUserInvestment(userId) {
  try {
    const res = await databases.listDocuments(DB_ID, INVESTMENTS_COL, [
      Query.equal('userId', userId),
      Query.equal('status', 'active'),
      Query.limit(1),
    ]);
    return res.documents[0] || null;
  } catch { return null; }
}

/** Get all investment documents (admin) */
async function getAllInvestments() {
  const res = await databases.listDocuments(DB_ID, INVESTMENTS_COL, [
    Query.orderDesc('$createdAt'),
    Query.limit(500),
  ]);
  return res.documents;
}

// ══════════════════════════════════════════════════════════════
//  ADMIN HELPERS
// ══════════════════════════════════════════════════════════════

async function getAllUsers() { return await getAllProfiles(); }

async function adminUpdateDepositStatus(depositId, status) {
  return await databases.updateDocument(DB_ID, DEPOSITS_COL, depositId, { status });
}

async function adminUpdateWithdrawalStatus(withdrawalId, status) {
  return await databases.updateDocument(DB_ID, WITHDRAWALS_COL, withdrawalId, { status });
}

async function adminUpdateBalance(userId, newBalance) {
  return await updateUserProfile(userId, { balance: parseFloat(newBalance) });
}

/** Redirect to loginUrl if the logged-in user isn't the admin */
async function requireAdmin(loginUrl) {
  const u = await getCurrentUser();
  if (!u || u.email !== ADMIN_EMAIL) {
    window.location.href = loginUrl || 'auth.html';
    return null;
  }
  return u;
}

/** Logout and redirect */
async function signOut(redirectUrl) {
  await logoutUser();
  window.location.href = redirectUrl || 'auth.html';
}

/**
 * Attach userName / userEmail onto deposit and withdrawal docs
 * by looking them up in the already-loaded profiles array.
 */
function enrichDocsWithUserInfo(docs, profiles) {
  return docs.map(doc => {
    const p = profiles.find(pr => pr.$id === doc.userId);
    doc.userName  = p ? ((p.firstName || '') + ' ' + (p.lastName || '')).trim() || p.email : '—';
    doc.userEmail = p ? (p.email || '—') : '—';
    return doc;
  });
}

// ══════════════════════════════════════════════════════════════
//  FORMAT HELPERS
// ══════════════════════════════════════════════════════════════

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDate(iso)  { return formatDate(iso); }

function fmtMoney(val) {
  return '$' + parseFloat(val || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ══════════════════════════════════════════════════════════════
//  PAGE LOADER SPINNER
// ══════════════════════════════════════════════════════════════

function showPageLoader() {
  let el = document.getElementById('_aw_loader');
  if (!el) {
    el = document.createElement('div');
    el.id = '_aw_loader';
    el.style.cssText = 'position:fixed;inset:0;background:rgba(255,255,255,0.82);display:flex;align-items:center;justify-content:center;z-index:99999;';
    el.innerHTML = '<svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#E31937" stroke-width="2.2" stroke-linecap="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.65s" repeatCount="indefinite"/></path></svg>';
    document.body.appendChild(el);
  }
  el.style.display = 'flex';
}

function hidePageLoader() {
  const el = document.getElementById('_aw_loader');
  if (el) el.style.display = 'none';
}



// ══════════════════════════════════════════════════════════════
//  SUPPORT CHAT
// ══════════════════════════════════════════════════════════════

/**
 * Create a new support ticket (called when user starts a chat)
 * Attributes needed in Appwrite Console for 'support_tickets':
 *   email (string), service (string), status (string, default:'open'),
 *   userName (string)
 *
 * Guest vs registered-user status is derived on the admin side:
 * if ticket.userName is non-empty AND differs from ticket.email,
 * the person is a registered user (they had a real display name).
 */
async function createSupportTicket({ email, service, userName }) {
  return await databases.createDocument(DB_ID, SUPPORT_TICKETS_COL, ID.unique(), {
    email:    email.trim(),
    service:  service,
    userName: userName || '',
    status:   'open',
  });
}

/** Get all tickets — admin use */
async function getAllSupportTickets() {
  const res = await databases.listDocuments(DB_ID, SUPPORT_TICKETS_COL, [
    Query.orderDesc('$createdAt'),
    Query.limit(200),
  ]);
  return res.documents;
}

/** Update ticket status: 'open' | 'closed' */
async function updateTicketStatus(ticketId, status) {
  return await databases.updateDocument(DB_ID, SUPPORT_TICKETS_COL, ticketId, { status });
}

/**
 * Send a message on a ticket
 * Attributes needed in Appwrite Console for 'support_messages':
 *   ticketId (string), sender (string: 'user'|'admin'|'bot'),
 *   message (string, size: 5000), senderName (string)
 */
async function sendSupportMessage({ ticketId, sender, message, senderName }) {
  return await databases.createDocument(DB_ID, SUPPORT_MESSAGES_COL, ID.unique(), {
    ticketId,
    sender,
    message:    message.trim(),
    senderName: senderName || sender,
  });
}

/** Get all messages for a ticket, oldest first */
async function getSupportMessages(ticketId) {
  const res = await databases.listDocuments(DB_ID, SUPPORT_MESSAGES_COL, [
    Query.equal('ticketId', ticketId),
    Query.orderAsc('$createdAt'),
    Query.limit(500),
  ]);
  return res.documents;
}

/**
 * Subscribe to realtime updates on a ticket's messages.
 * Returns the unsubscribe function — call it to stop listening.
 *
 * Usage:
 *   const unsub = subscribeToTicket(ticketId, (msg) => renderMessage(msg));
 *   // later: unsub();
 */
function subscribeToTicket(ticketId, onNewMessage) {
  const channel = `databases.${DB_ID}.collections.${SUPPORT_MESSAGES_COL}.documents`;
  return client.subscribe(channel, event => {
    const doc = event.payload;
    if (doc.ticketId === ticketId &&
        event.events.some(e => e.includes('create'))) {
      onNewMessage(doc);
    }
  });
}

/**
 * Subscribe to all ticket updates — for admin dashboard live refresh.
 * Fires whenever any ticket or message is created/updated.
 */
function subscribeToAllTickets(onUpdate) {
  const channels = [
    `databases.${DB_ID}.collections.${SUPPORT_TICKETS_COL}.documents`,
    `databases.${DB_ID}.collections.${SUPPORT_MESSAGES_COL}.documents`,
  ];
  return client.subscribe(channels, onUpdate);
}

// ══════════════════════════════════════════════════════════════
//  ADMIN EMAIL NOTIFICATIONS  (via EmailJS)
// ══════════════════════════════════════════════════════════════

const EMAILJS_SERVICE_ID  = 'service_a3xjeeh';   // ← Replace with your EmailJS Service ID
const EMAILJS_TEMPLATE_ID = 'template_km6ojve';  // ← Replace with your EmailJS Template ID
const EMAILJS_PUBLIC_KEY  = 'MjFH9MMSDk_3oXCGT';   // ← Replace with your EmailJS Public Key

/**
 * Sends a silent admin notification email when a user event occurs.
 * Uses the user's email as the reply-to so admin can respond directly.
 * Never throws — failures are logged only and never break user flows.
 */
async function notifyAdmin({ eventType, userName, userEmail, details = '' }) {
  try {
    if (typeof emailjs === 'undefined') {
      console.warn('[notifyAdmin] EmailJS not loaded — skipping notification.');
      return;
    }
    await emailjs.send(
      EMAILJS_SERVICE_ID,
      EMAILJS_TEMPLATE_ID,
      {
        event_type: eventType,
        user_name:  userName  || 'Unknown',
        user_email: userEmail || 'Unknown',
        details:    details,
        time:       new Date().toLocaleString('en-US', { timeZone: 'UTC' }) + ' UTC',
        admin_email: 'preciousogbatue4@gmail.com',
        reply_to:   userEmail || '',
      },
      EMAILJS_PUBLIC_KEY
    );
    console.log('[notifyAdmin] Notification sent:', eventType, userEmail);
  } catch (err) {
    console.warn('[notifyAdmin] Email failed (non-fatal):', err);
  }
}

// ══════════════════════════════════════════════════════════════
//  VENDORS
// ══════════════════════════════════════════════════════════════

/**
 * Generate a unique vendor referral code.
 * Format: 3 uppercase letters + 4 digits, e.g. VND-TES8472
 */
function generateVendorCode(vendorName) {
  const prefix = (vendorName || 'VND')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 3)
    .padEnd(3, 'X');
  const suffix = String(Math.floor(1000 + Math.random() * 9000));
  return prefix + suffix;
}

/** Create a new vendor document */
async function createVendor({ name, code }) {
  return await databases.createDocument(DB_ID, VENDORS_COL, ID.unique(), {
    name: name.trim(),
    code: code.trim().toUpperCase(),
  });
}

/** Get all vendors, newest first */
async function getAllVendors() {
  const res = await databases.listDocuments(DB_ID, VENDORS_COL, [
    Query.orderDesc('$createdAt'),
    Query.limit(500),
  ]);
  return res.documents;
}

/** Get users who registered with a specific referral code */
async function getUsersByReferralCode(code) {
  const res = await databases.listDocuments(DB_ID, PROFILES_COL, [
    Query.equal('referralCode', code.trim().toUpperCase()),
    Query.orderDesc('$createdAt'),
    Query.limit(500),
  ]);
  return res.documents;
}

/** Delete a vendor document */
async function deleteVendor(vendorId) {
  return await databases.deleteDocument(DB_ID, VENDORS_COL, vendorId);
}

// ══════════════════════════════════════════════════════════════
//  ALIASES  (admin.html uses these names)
// ══════════════════════════════════════════════════════════════
const approveDeposit_db    = approveDeposit;
const rejectDeposit_db     = rejectDeposit;
const approveWithdrawal_db = approveWithdrawal;
const rejectWithdrawal_db  = rejectWithdrawal;