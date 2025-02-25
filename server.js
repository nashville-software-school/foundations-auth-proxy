const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

// Environment variables
const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS.split(',');

// Validate environment variables
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing required environment variables: OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET must be set');
  process.exit(1);
}

// Create Express app
const app = express();

// Configure CORS
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, etc.)
    if (!origin) return callback(null, true);

    if (ALLOWED_ORIGINS.indexOf(origin) !== -1 || ALLOWED_ORIGINS.includes('*')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept']
};

// Apply middleware
app.use(cors(corsOptions));
app.use(express.json());

// Routes
app.post('/oauth/github/token', async (req, res) => {
  try {
    const { code, redirect_uri } = req.body;

    // Validate required parameters
    if (!code) {
      return res.status(400).json({ error: 'Missing code parameter' });
    }

    console.log(`Processing OAuth token exchange for code: ${code.substring(0, 4)}...`);
    console.log(`Redirect URI: ${redirect_uri}`);

    // Exchange code for token with GitHub
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code: code,
        redirect_uri: redirect_uri
      })
    });

    // Handle GitHub API errors
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`GitHub API error: ${response.status} ${errorText}`);
      return res.status(response.status).json({
        error: 'GitHub API error',
        status: response.status,
        details: errorText
      });
    }

    // Parse and return the token data
    const data = await response.json();

    // Check for error in response
    if (data.error) {
      console.error(`GitHub API returned error: ${data.error}`);
      return res.status(400).json(data);
    }

    console.log('Token exchange completed successfully');
    return res.status(200).json(data);
  } catch (error) {
    console.error(`OAuth error: ${error.message}`);
    return res.status(500).json({
      error: 'Failed to exchange code for token',
      details: error.message
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

// Start server
app.listen(PORT, () => {
  console.log(`OAuth proxy server running on port ${PORT}`);
  console.log(`Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
});