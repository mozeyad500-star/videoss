require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const videoRoutes = require('./routes/video');

const app = express();
const PORT = process.env.PORT || 5000;

// ---------- Security & Middleware ----------
app.use(helmet({
  contentSecurityPolicy: false // allow frontend to load easily in development
}));

app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true }));

// Global rate limit – protects free hosting from abuse
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' }
});
app.use(globalLimiter);

// Stricter limit for video fetch (resource-heavy endpoint)
const videoLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: { success: false, message: 'Too many video requests. Please wait a minute.' }
});

// ---------- Routes ----------
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Videoss Backend API is running',
    version: '1.0.0',
    endpoints: {
      auth: {
        signup: 'POST /api/auth/signup',
        login: 'POST /api/auth/login',
        me: 'GET /api/auth/me'
      },
      video: {
        fetch: 'POST /api/video/fetch',
        platforms: 'GET /api/video/platforms'
      }
    }
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/video', videoLimiter, videoRoutes);

// ---------- 404 & Error handlers ----------
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Endpoint not found' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`🚀 Videoss backend running on http://localhost:${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
});
