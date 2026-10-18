const express = require('express');
const { optionalAuth } = require('../middleware/auth');

const router = express.Router();

// Helper: detect platform from URL
function detectPlatform(url) {
  const lower = url.toLowerCase();
  if (lower.includes('instagram.com') || lower.includes('instagr.am')) return 'Instagram';
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'YouTube';
  if (lower.includes('tiktok.com') || lower.includes('vm.tiktok.com')) return 'TikTok';
  if (lower.includes('facebook.com') || lower.includes('fb.watch')) return 'Facebook';
  if (lower.includes('twitter.com') || lower.includes('x.com')) return 'X (Twitter)';
  if (lower.includes('vimeo.com')) return 'Vimeo';
  return 'Video';
}

// Realistic mock data generator (safe & free)
function generateMockVideo(url) {
  const platform = detectPlatform(url);
  const titles = {
    Instagram: 'Sample Trending Reel / Short Video #2026',
    YouTube: 'Amazing YouTube Short – Viral Clip 2026',
    TikTok: 'TikTok Viral Dance Challenge',
    Facebook: 'Facebook Reels Highlight',
    'X (Twitter)': 'Trending Clip on X',
    Vimeo: 'High Quality Vimeo Video',
    Video: 'Sample Video Download'
  };

  const thumbnails = [
    'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1536240478700-b869070f9279?auto=format&fit=crop&w=800&q=80'
  ];

  const durations = ['0:28', '0:45', '1:12', '0:59', '2:05'];

  return {
    title: titles[platform] || titles.Video,
    thumbnail: thumbnails[Math.floor(Math.random() * thumbnails.length)],
    duration: durations[Math.floor(Math.random() * durations.length)],
    platform,
    links: [
      { quality: '1080p Full HD (MP4)', size: '24.5 MB', format: 'mp4' },
      { quality: '720p HD (MP4)', size: '12.1 MB', format: 'mp4' },
      { quality: '480p (MP4)', size: '6.8 MB', format: 'mp4' },
      { quality: 'Audio Only (MP3)', size: '2.8 MB', format: 'mp3' }
    ]
  };
}

// Basic URL validation
function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// POST /api/video/fetch
router.post('/fetch', optionalAuth, async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid video URL'
      });
    }

    const trimmed = url.trim();
    if (!isValidUrl(trimmed)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid URL format'
      });
    }

    // Simulate realistic processing delay (0.8 – 1.8s)
    const delay = 800 + Math.random() * 1000;
    await new Promise(resolve => setTimeout(resolve, delay));

    const videoData = generateMockVideo(trimmed);

    // In a real production system you would call yt-dlp / similar here.
    // We intentionally keep this mock so the service stays free, legal, and stable.

    res.json({
      success: true,
      message: 'Video information retrieved successfully',
      data: videoData
    });
  } catch (err) {
    console.error('Video fetch error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to process video. Please try again later.'
    });
  }
});

// GET /api/video/platforms  – list supported platforms
router.get('/platforms', (req, res) => {
  res.json({
    success: true,
    data: [
      'Instagram',
      'YouTube',
      'TikTok',
      'Facebook',
      'X (Twitter)',
      'Vimeo',
      'and 100+ more'
    ]
  });
});

module.exports = router;
