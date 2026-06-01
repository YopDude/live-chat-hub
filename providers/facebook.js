const axios = require('axios');
const BaseProvider = require('./baseProvider');

const FACEBOOK_ICON_URL = 'https://www.facebook.com/images/fb_icon_325x325.png';
const POLL_INTERVAL_MS = 5000;

class FacebookProvider extends BaseProvider {
  constructor(target, onMessage) {
    super(target, onMessage);
    this.pollInterval = null;
    this.messageCounter = 0;
    this.seenIds = new Set();
  }

  async fetchPublicVideoComments() {
    try {
      // Extensible placeholder for public video comment fetching
      // This would typically fetch from Facebook's public video URL or API endpoint
      // For now, serves as a structural template for comment aggregation

      // Example: Parse video ID from target URL
      const videoId = this.extractVideoId(this.target);
      if (!videoId) {
        return;
      }

      // Fetch logic would go here
      // Example: const response = await axios.get(`https://graph.facebook.com/...`);
      // Parse and normalize comments, then emit via this.onMessage()
    } catch (err) {
      console.error('FacebookProvider fetch error:', err.message || err);
    }
  }

  extractVideoId(target) {
    try {
      const url = new URL(target);
      const match = url.pathname.match(/\/video\.php\?v=(\d+)|\/videos\/(\d+)/);
      if (match) {
        return match[1] || match[2];
      }
    } catch (err) {
      const match = target.match(/facebook\.com.*?(?:video\.php\?v=(\d+)|\/videos\/(\d+))/);
      if (match) {
        return match[1] || match[2];
      }
    }
    return null;
  }

  normalizeComment(comment) {
    return {
      id: comment.id || `fb_${Date.now()}_${this.messageCounter++}`,
      platform: 'facebook',
      username: comment.username || comment.author || 'Facebook User',
      message: comment.message || comment.text || '',
      timestamp: comment.timestamp || new Date().toISOString(),
      isSystemAlert: comment.isSystemAlert || false,
      iconUrl: FACEBOOK_ICON_URL,
    };
  }

  start() {
    if (this.isActive) {
      return;
    }

    this.pollInterval = setInterval(() => this.fetchPublicVideoComments(), POLL_INTERVAL_MS);
    this.fetchPublicVideoComments().catch((err) => {
      console.error('FacebookProvider initial fetch failed:', err.message || err);
    });

    super.start();
  }

  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    super.stop();
  }
}

module.exports = FacebookProvider;
