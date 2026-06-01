const axios = require('axios');
const BaseProvider = require('./baseProvider');

const INSTAGRAM_ICON_URL = 'assets/ins_icon.png';
const POLL_INTERVAL_MS = 5000;

class InstagramProvider extends BaseProvider {
  constructor(target, onMessage) {
    super(target, onMessage);
    this.pollInterval = null;
    this.messageCounter = 0;
    this.seenIds = new Set();
  }

  async fetchPublicPostComments() {
    try {
      // Extensible placeholder for public post comment fetching
      // This would typically fetch from Instagram's public post URL or API endpoint
      // For now, serves as a structural template for comment aggregation

      // Example: Parse post ID from target URL
      const postId = this.extractPostId(this.target);
      if (!postId) {
        return;
      }

      // Fetch logic would go here
      // Example: const response = await axios.get(`https://www.instagram.com/...`);
      // Parse and normalize comments, then emit via this.onMessage()
    } catch (err) {
      console.error('InstagramProvider fetch error:', err.message || err);
    }
  }

  extractPostId(target) {
    try {
      const url = new URL(target);
      const match = url.pathname.match(/\/p\/([a-zA-Z0-9_-]+)|\/reel\/([a-zA-Z0-9_-]+)/);
      if (match) {
        return match[1] || match[2];
      }
    } catch (err) {
      const match = target.match(/instagram\.com.*?(?:\/p\/([a-zA-Z0-9_-]+)|\/reel\/([a-zA-Z0-9_-]+))/);
      if (match) {
        return match[1] || match[2];
      }
    }
    return null;
  }

  normalizeComment(comment) {
    return {
      id: comment.id || `ig_${Date.now()}_${this.messageCounter++}`,
      platform: 'instagram',
      username: comment.username || comment.author || 'Instagram User',
      message: comment.message || comment.text || '',
      timestamp: comment.timestamp || new Date().toISOString(),
      isSystemAlert: comment.isSystemAlert || false,
      iconUrl: INSTAGRAM_ICON_URL,
    };
  }

  start() {
    if (this.isActive) {
      return;
    }

    this.pollInterval = setInterval(() => this.fetchPublicPostComments(), POLL_INTERVAL_MS);
    this.fetchPublicPostComments().catch((err) => {
      console.error('InstagramProvider initial fetch failed:', err.message || err);
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

module.exports = InstagramProvider;
