/**
 * CRM Google Sheets Integration Controller
 * OAuth 2.0 + Sheets API v4 sync (server-side only)
 * Per-company OAuth credentials stored in CrmSettings (secret encrypted).
 */
const crypto = require('crypto');
const { randomUUID } = require('crypto');
const prisma = require('../prisma/client');
const { google } = require('googleapis');

const DEFAULT_REDIRECT = process.env.GOOGLE_REDIRECT_URI
  || `${process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 5000}`}/api/crm/google-sheets/callback`;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

function getCompanyId(req) {
  return req.user?.companyId || null;
}

function encryptionKey() {
  const secret = process.env.JWT_SECRET || process.env.ENCRYPTION_KEY || 'crm-google-sheets-fallback-key';
  return crypto.scryptSync(secret, 'crm-google-oauth-salt', 32);
}

function encryptSecret(plain) {
  if (!plain) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

function decryptSecret(payload) {
  if (!payload) return null;
  if (!String(payload).startsWith('v1:')) return String(payload); // legacy/plaintext fallback
  const [, ivB64, tagB64, dataB64] = String(payload).split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function maskSecret(secret) {
  if (!secret) return null;
  const s = String(secret);
  if (s.length <= 4) return '••••';
  return `••••••••${s.slice(-4)}`;
}

async function ensureCrmSettings(companyId) {
  let settings = await prisma.crmSettings.findUnique({ where: { companyId } });
  if (!settings) {
    settings = await prisma.crmSettings.create({ data: { id: randomUUID(), companyId } });
  }
  return settings;
}

async function resolveGoogleCredentials(companyId) {
  const settings = companyId
    ? await prisma.crmSettings.findUnique({ where: { companyId } }).catch(() => null)
    : null;

  const clientId = (settings?.googleClientId || process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = decryptSecret(settings?.googleClientSecretEnc)
    || (process.env.GOOGLE_CLIENT_SECRET || '').trim()
    || null;
  const redirectUri = (settings?.googleRedirectUri || process.env.GOOGLE_REDIRECT_URI || DEFAULT_REDIRECT || '').trim();

  return { clientId, clientSecret, redirectUri, fromCompany: !!(settings?.googleClientId && settings?.googleClientSecretEnc) };
}

async function createOAuth2ClientForCompany(companyId) {
  const { clientId, clientSecret, redirectUri } = await resolveGoogleCredentials(companyId);
  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth credentials are not configured. Open Google Sheets Settings and add your Client ID and Client Secret.');
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri || DEFAULT_REDIRECT);
}

async function getAuthClientForConnection(connection) {
  const oauth2Client = await createOAuth2ClientForCompany(connection.companyId);
  oauth2Client.setCredentials({
    access_token: connection.accessToken,
    refresh_token: connection.refreshToken,
    expiry_date: connection.tokenExpiry ? new Date(connection.tokenExpiry).getTime() : undefined,
  });
  oauth2Client.on('tokens', async (tokens) => {
    await prisma.googleSheetConnection.update({
      where: { id: connection.id },
      data: {
        accessToken: tokens.access_token || connection.accessToken,
        refreshToken: tokens.refresh_token || connection.refreshToken,
        tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
      },
    }).catch(() => {});
  });
  return oauth2Client;
}

/** GET — public status of company Google OAuth config (secret never returned in clear) */
const getGoogleOAuthSettings = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) return res.status(400).json({ success: false, message: 'Company context required' });
    const settings = await ensureCrmSettings(companyId);
    const secretPlain = decryptSecret(settings.googleClientSecretEnc);
    const envFallback = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    const configured = !!(settings.googleClientId && settings.googleClientSecretEnc) || envFallback;
    return res.json({
      success: true,
      data: {
        configured,
        clientId: settings.googleClientId || '',
        hasClientSecret: !!settings.googleClientSecretEnc,
        clientSecretMasked: maskSecret(secretPlain),
        redirectUri: settings.googleRedirectUri || DEFAULT_REDIRECT,
        usingEnvFallback: envFallback && !(settings.googleClientId && settings.googleClientSecretEnc),
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/** PUT — save company Google OAuth credentials */
const updateGoogleOAuthSettings = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) return res.status(400).json({ success: false, message: 'Company context required' });

    const clientId = (req.body.clientId || '').trim();
    const clientSecret = (req.body.clientSecret || '').trim();
    const redirectUri = (req.body.redirectUri || '').trim();

    if (!clientId) {
      return res.status(400).json({ success: false, message: 'Client ID is required' });
    }

    const existing = await ensureCrmSettings(companyId);
    const data = {
      googleClientId: clientId,
      googleRedirectUri: redirectUri || DEFAULT_REDIRECT,
    };

    // Only replace secret when a new clear value is provided (ignore masked placeholders)
    const isMasked = !clientSecret || clientSecret.includes('•') || clientSecret.includes('*');
    if (!isMasked) {
      data.googleClientSecretEnc = encryptSecret(clientSecret);
    } else if (!existing.googleClientSecretEnc) {
      return res.status(400).json({ success: false, message: 'Client Secret is required' });
    }

    const settings = await prisma.crmSettings.update({
      where: { companyId },
      data,
    });

    const secretPlain = decryptSecret(settings.googleClientSecretEnc);
    return res.json({
      success: true,
      message: 'Google Sheets credentials saved securely',
      data: {
        configured: true,
        clientId: settings.googleClientId || '',
        hasClientSecret: !!settings.googleClientSecretEnc,
        clientSecretMasked: maskSecret(secretPlain),
        redirectUri: settings.googleRedirectUri || DEFAULT_REDIRECT,
        usingEnvFallback: false,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Generate OAuth URL for frontend redirect
const getAuthUrl = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const oauth2Client = await createOAuth2ClientForCompany(companyId);
    const scopes = [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.metadata.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ];
    const state = Buffer.from(JSON.stringify({ companyId, userId: req.user.id })).toString('base64');
    const url = oauth2Client.generateAuthUrl({ access_type: 'offline', scope: scopes, state, prompt: 'consent' });
    return res.json({ success: true, data: { authUrl: url } });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message, code: 'GOOGLE_OAUTH_NOT_CONFIGURED' });
  }
};

// Handle OAuth callback — exchange code for tokens, then redirect to frontend
const handleOAuthCallback = async (req, res) => {
  const redirectFail = (msg) => {
    const url = `${FRONTEND_URL}/crm/google-sheets?error=${encodeURIComponent(msg || 'OAuth failed')}`;
    return res.redirect(url);
  };
  try {
    const { code, state } = req.query;
    if (!code || !state) return redirectFail('Missing code or state');

    let stateData;
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'));
    } catch {
      return redirectFail('Invalid OAuth state');
    }

    const { companyId, userId } = stateData;
    const oauth2Client = await createOAuth2ClientForCompany(companyId);
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ auth: oauth2Client, version: 'v2' });
    const { data: userInfo } = await oauth2.userinfo.get();

    await prisma.googleSheetConnection.create({
      data: {
        companyId,
        googleAccountEmail: userInfo.email,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        createdBy: userId,
      },
    });

    return res.redirect(`${FRONTEND_URL}/crm/google-sheets?connected=1`);
  } catch (err) {
    console.error('[CRM Google Sheets] OAuth callback error:', err);
    return redirectFail(err.message || 'OAuth failed');
  }
};

// List connections
const getConnections = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const connections = await prisma.googleSheetConnection.findMany({
      where: { companyId, isActive: true },
      select: {
        id: true, googleAccountEmail: true, spreadsheetId: true, spreadsheetName: true,
        sheetName: true, syncMode: true, syncIntervalMinutes: true, lastSyncAt: true,
        lastSyncStatus: true, lastSyncError: true, nextSyncAt: true, isActive: true,
        createdAt: true, columnMapping: true,
        syncJobs: { orderBy: { startedAt: 'desc' }, take: 5, select: { id: true, status: true, importedCount: true, updatedCount: true, failedCount: true, startedAt: true, completedAt: true } },
      },
    });
    return res.json({ success: true, data: connections });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Disconnect a connection
const disconnectConnection = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { id } = req.params;
    const conn = await prisma.googleSheetConnection.findFirst({ where: { id, companyId } });
    if (!conn) return res.status(404).json({ success: false, message: 'Connection not found' });
    await prisma.googleSheetConnection.update({ where: { id }, data: { isActive: false } });
    return res.json({ success: true, message: 'Google account disconnected' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// List user's accessible spreadsheets
const listSpreadsheets = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { connectionId } = req.params;
    const conn = await prisma.googleSheetConnection.findFirst({ where: { id: connectionId, companyId, isActive: true } });
    if (!conn) return res.status(404).json({ success: false, message: 'Connection not found' });

    const auth = await getAuthClientForConnection(conn);
    const drive = google.drive({ auth, version: 'v3' });
    const { data } = await drive.files.list({ q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false", fields: 'files(id, name, modifiedTime)', pageSize: 50 });
    return res.json({ success: true, data: data.files || [] });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Get sheet names within a spreadsheet
const getSheetNames = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { connectionId, spreadsheetId } = req.params;
    const conn = await prisma.googleSheetConnection.findFirst({ where: { id: connectionId, companyId, isActive: true } });
    if (!conn) return res.status(404).json({ success: false, message: 'Connection not found' });

    const auth = await getAuthClientForConnection(conn);
    const sheets = google.sheets({ auth, version: 'v4' });
    const { data } = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
    const sheetNames = (data.sheets || []).map(s => s.properties?.title);
    return res.json({ success: true, data: sheetNames });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Preview sheet data + auto-map
const previewSheet = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { connectionId } = req.params;
    const { spreadsheetId, sheetName } = req.query;

    const conn = await prisma.googleSheetConnection.findFirst({ where: { id: connectionId, companyId, isActive: true } });
    if (!conn) return res.status(404).json({ success: false, message: 'Connection not found' });

    const auth = await getAuthClientForConnection(conn);
    const sheets = google.sheets({ auth, version: 'v4' });
    const range = sheetName ? `${sheetName}!A1:ZZ21` : 'A1:ZZ21';
    const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range });

    const rows = data.values || [];
    if (rows.length === 0) return res.json({ success: true, data: { headers: [], preview: [], totalRows: 0 } });

    const headers = rows[0];
    const preview = rows.slice(1, 21).map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i] || ''; });
      return obj;
    });

    const crmFields = await prisma.leadCustomField.findMany({ where: { companyId }, select: { fieldKey: true, fieldName: true } });
    const coreFields = [
      { fieldKey: 'fullName', fieldName: 'Full Name' }, { fieldKey: 'email', fieldName: 'Email' },
      { fieldKey: 'phone', fieldName: 'Phone' }, { fieldKey: 'whatsapp', fieldName: 'WhatsApp' },
      { fieldKey: 'companyName', fieldName: 'Company' }, { fieldKey: 'city', fieldName: 'City' },
      { fieldKey: 'country', fieldName: 'Country' }, { fieldKey: 'source', fieldName: 'Lead Source' },
      { fieldKey: 'status', fieldName: 'Lead Status' }, { fieldKey: 'interest', fieldName: 'Interest' },
      { fieldKey: 'budget', fieldName: 'Budget' }, { fieldKey: 'notes', fieldName: 'Notes' },
    ];
    const autoMapping = {};
    const allFields = [...coreFields, ...crmFields];
    for (const header of headers) {
      const hLow = header.toLowerCase().replace(/[\s_\-]/g, '');
      for (const f of allFields) {
        const fLow = f.fieldName.toLowerCase().replace(/[\s_\-]/g, '');
        const kLow = f.fieldKey.toLowerCase().replace(/[\s_\-]/g, '');
        if (hLow === fLow || hLow === kLow || fLow.includes(hLow) || hLow.includes(kLow)) {
          autoMapping[header] = f.fieldKey;
          break;
        }
      }
    }

    return res.json({ success: true, data: { headers, preview, totalRows: rows.length - 1, autoMapping, availableFields: allFields } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Save connection config (spreadsheet + sheet + mapping + sync mode)
const updateConnectionConfig = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { id } = req.params;
    const { spreadsheetId, spreadsheetName, sheetName, syncMode, columnMapping, syncIntervalMinutes } = req.body;
    const conn = await prisma.googleSheetConnection.findFirst({ where: { id, companyId } });
    if (!conn) return res.status(404).json({ success: false, message: 'Connection not found' });

    const updated = await prisma.googleSheetConnection.update({
      where: { id },
      data: { spreadsheetId, spreadsheetName, sheetName, syncMode: syncMode || 'ONE_TIME_IMPORT', columnMapping, syncIntervalMinutes: syncIntervalMinutes || 60, nextSyncAt: syncMode !== 'ONE_TIME_IMPORT' ? new Date(Date.now() + (syncIntervalMinutes || 60) * 60000) : null },
    });
    return res.json({ success: true, data: updated });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Execute sync (import from Google Sheet)
const syncNow = async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { id } = req.params;
    const conn = await prisma.googleSheetConnection.findFirst({ where: { id, companyId, isActive: true } });
    if (!conn) return res.status(404).json({ success: false, message: 'Connection not found' });
    if (!conn.spreadsheetId) return res.status(400).json({ success: false, message: 'No spreadsheet configured' });

    // Create sync job
    const syncJob = await prisma.googleSheetSyncJob.create({
      data: { connectionId: id, companyId, syncMode: conn.syncMode, status: 'RUNNING' },
    });

    await prisma.googleSheetConnection.update({ where: { id }, data: { lastSyncStatus: 'RUNNING' } });

    try {
      const auth = await getAuthClientForConnection(conn);
      const sheets = google.sheets({ auth, version: 'v4' });
      const range = conn.sheetName ? `${conn.sheetName}!A:ZZ` : 'A:ZZ';
      const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: conn.spreadsheetId, range });
      const rows = data.values || [];
      if (rows.length < 2) throw new Error('Spreadsheet has no data rows');

      const headers = rows[0];
      const dataRows = rows.slice(1);
      const mapping = conn.columnMapping || {};

      // Reuse import logic
      const crmFields = await prisma.leadCustomField.findMany({ where: { companyId }, select: { fieldKey: true } });
      const customFieldKeys = new Set(crmFields.map(f => f.fieldKey));
      const existingLeads = await prisma.lead.findMany({ where: { companyId, isDeleted: false }, select: { id: true, phone: true, email: true } });
      const existingPhones = new Set(existingLeads.map(l => l.phone).filter(Boolean));
      const existingEmails = new Set(existingLeads.map(l => l.email?.toLowerCase()).filter(Boolean));

      let importedCount = 0, updatedCount = 0, failedCount = 0;

      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        try {
          const rowObj = {};
          headers.forEach((h, idx) => { rowObj[h] = row[idx] || ''; });

          const lead = {};
          const customData = {};
          for (const [header, fieldKey] of Object.entries(mapping)) {
            if (!fieldKey || fieldKey === '__skip__') continue;
            const val = rowObj[header];
            if (!val) continue;
            if (customFieldKeys.has(fieldKey)) customData[fieldKey] = val;
            else lead[fieldKey] = val;
          }

          const phone = lead.phone?.replace(/[^0-9+]/g, '') || null;
          const email = lead.email?.toLowerCase() || null;
          const isDuplicate = (phone && existingPhones.has(phone)) || (email && existingEmails.has(email));

          if (isDuplicate && conn.syncMode === 'ONE_TIME_IMPORT') {
            continue;
          }

          const fullName = lead.fullName || [lead.firstName, lead.lastName].filter(Boolean).join(' ') || `Sheet Row ${i + 2}`;
          const leadNumber = `LEAD-SH-${Date.now()}-${i}`;

          await prisma.lead.create({
            data: {
              leadNumber, companyId, createdBy: req.user.id,
              fullName, email, phone, whatsapp: lead.whatsapp || null,
              companyName: lead.companyName || null, city: lead.city || null,
              country: lead.country || 'Pakistan', source: 'Google Sheets',
              status: lead.status || 'New', notes: lead.notes || null,
              customFields: customData,
            },
          });
          if (phone) existingPhones.add(phone);
          if (email) existingEmails.add(email);
          importedCount++;
        } catch (rowErr) {
          failedCount++;
        }
      }

      await prisma.googleSheetSyncJob.update({
        where: { id: syncJob.id },
        data: { status: 'COMPLETED', importedCount, updatedCount, failedCount, completedAt: new Date() },
      });
      await prisma.googleSheetConnection.update({
        where: { id },
        data: { lastSyncAt: new Date(), lastSyncStatus: 'SUCCESS', lastSyncError: null, nextSyncAt: conn.syncMode !== 'ONE_TIME_IMPORT' ? new Date(Date.now() + conn.syncIntervalMinutes * 60000) : null },
      });

      return res.json({ success: true, data: { importedCount, updatedCount, failedCount }, message: `Sync complete: ${importedCount} imported` });
    } catch (syncErr) {
      await prisma.googleSheetSyncJob.update({ where: { id: syncJob.id }, data: { status: 'FAILED', errorMessage: syncErr.message, completedAt: new Date() } });
      await prisma.googleSheetConnection.update({ where: { id }, data: { lastSyncStatus: 'ERROR', lastSyncError: syncErr.message } });
      throw syncErr;
    }
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getAuthUrl, handleOAuthCallback, getConnections, disconnectConnection,
  listSpreadsheets, getSheetNames, previewSheet, updateConnectionConfig, syncNow,
  getGoogleOAuthSettings, updateGoogleOAuthSettings,
};

