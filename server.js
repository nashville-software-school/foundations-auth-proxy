const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

// Load non-secret site config from repo (allowed origins, descriptions)
const sitesConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'sites.json'), 'utf8')
);

// In Lambda: pulled from Secrets Manager on cold start.
// Locally: falls back to SITES_SECRETS env var (plain JSON).
let siteSecrets = {};

async function loadSiteSecrets() {
  const secretId = process.env.SITES_SECRETS_SECRET_ID;
  if (secretId) {
    const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-2' });
    const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
    siteSecrets = JSON.parse(response.SecretString);
    return;
  }

  // Local dev fallback
  const raw = process.env.SITES_SECRETS;
  if (!raw) return;
  try {
    siteSecrets = JSON.parse(raw);
  } catch (e) {
    console.error('Failed to parse SITES_SECRETS:', e.message);
    process.exit(1);
  }
}

// Load dotenv before kicking off secrets fetch so env vars are available
if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
  require('dotenv').config({ override: false });
}

// Resolves once on cold start; subsequent Lambda invocations await the cached promise
const secretsReady = loadSiteSecrets().catch(e => {
  console.error('Failed to load secrets:', e.message);
  process.exit(1);
});

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());

// Per-request CORS based on the site making the call
app.use((req, res, next) => {
  const siteId = req.headers['x-site-id'];
  const origin = req.headers.origin;

  if (!origin) return next();

  // Browsers don't send X-Site-ID in the OPTIONS preflight, so fall back to
  // checking the origin against all sites. The actual POST still validates per-site.
  const allowedOrigins = siteId
    ? (sitesConfig[siteId] ? sitesConfig[siteId].allowedOrigins : [])
    : Object.values(sitesConfig).flatMap(s => s.allowedOrigins);

  if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, X-Site-ID');
  } else {
    return res.status(403).json({ error: 'Origin not allowed' });
  }

  if (req.method === 'OPTIONS') return res.status(204).send();
  next();
});

app.post('/oauth/github/token', async (req, res) => {
  try {
    const siteId = req.headers['x-site-id'];

    if (!siteId) {
      return res.status(400).json({ error: 'Missing X-Site-ID header' });
    }

    if (!sitesConfig[siteId]) {
      return res.status(400).json({ error: `Unknown site: ${siteId}` });
    }

    const secrets = siteSecrets[siteId];
    if (!secrets || !secrets.clientId || !secrets.clientSecret) {
      console.error(`No credentials configured for site: ${siteId}`);
      return res.status(500).json({ error: `Credentials not configured for site: ${siteId}` });
    }

    const { code, redirect_uri } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Missing code parameter' });
    }

    console.log(`[${siteId}] Processing OAuth token exchange for code: ${code.substring(0, 4)}...`);

    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: secrets.clientId,
        client_secret: secrets.clientSecret,
        code,
        redirect_uri
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[${siteId}] GitHub API error: ${response.status} ${errorText}`);
      return res.status(response.status).json({
        error: 'GitHub API error',
        status: response.status,
        details: errorText
      });
    }

    const data = await response.json();

    if (data.error) {
      console.error(`[${siteId}] GitHub returned error: ${data.error}`);
      return res.status(400).json(data);
    }

    console.log(`[${siteId}] Token exchange completed successfully`);
    return res.status(200).json(data);
  } catch (error) {
    console.error(`OAuth error: ${error.message}`);
    return res.status(500).json({
      error: 'Failed to exchange code for token',
      details: error.message
    });
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', sites: Object.keys(sitesConfig) });
});

// Run as a standalone server when not in Lambda
if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
  secretsReady.then(() => {
    app.listen(PORT, () => {
      console.log(`OAuth proxy running on port ${PORT}`);
      console.log(`Configured sites: ${Object.keys(sitesConfig).join(', ')}`);
    });
  });
}

module.exports = { app, secretsReady };
