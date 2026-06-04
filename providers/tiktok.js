const { WebcastPushConnection } = require('tiktok-live-connector');
const BaseProvider = require('./baseProvider');

const TIKTOK_ICON_URL = 'assets/tktk_icon.png';

class TikTokProvider extends BaseProvider {
  constructor(target, onMessage) {
    super(target, onMessage);
    this.connection = new WebcastPushConnection(target);
    this.messageCounter = 0;
  }

  static normalizeTarget(target) {
    if (typeof target !== 'string') return null;
    const raw = target.trim();
    if (!raw) return null;

    try {
      const url = new URL(raw);
      if (!/^(www\.)?tiktok\.com$/i.test(url.hostname)) return null;
      const path = url.pathname.replace(/^\/+|\/+$/g, '');
      if (!path) return null;
      const username = path.split('/')[0];
      return username.replace(/^@/, '') || null;
    } catch (err) {
      return raw.replace(/^@/, '').trim() || null;
    }
  }

  static validateTarget(target) {
    return Boolean(this.normalizeTarget(target));
  }

  start() {
    if (this.isActive) {
      return;
    }

    this.connection.on('chat', (data) => {
      this.messageCounter++;
      this.onMessage({
        id: `tiktok_${Date.now()}_${this.messageCounter}`,
        platform: 'tiktok',
        username: data.nickname || data.uniqueId || 'TikTok User',
        message: data.comment || '',
        timestamp: new Date().toISOString(),
        isSystemAlert: false,
        iconUrl: TIKTOK_ICON_URL,
      });
    });

    this.connection.on('gift', (data) => {
      // If the gift is part of a streak and hasn't finished yet, skip it.
      // This stops the same gift event from flooding the app multiple times.
      if (data.giftType === 1 && !data.repeatEnd) {
        return;
      }

      this.messageCounter++;
      const giftName = data.giftName || 'Gift';
      const username = data.nickname || data.uniqueId || 'TikTok User';
      
      // Determine if we should show a multiplier (e.g., "sent a Rose x5!")
      const countLabel = data.repeatCount > 1 ? ` x${data.repeatCount}` : '';

      this.onMessage({
        id: `tiktok_gift_${Date.now()}_${this.messageCounter}`,
        platform: 'tiktok',
        username,
        message: `${username} sent a ${giftName}${countLabel}!`,
        timestamp: new Date().toISOString(),
        isSystemAlert: true,
        iconUrl: TIKTOK_ICON_URL,
      });
    });

    this.connection.connect().catch((err) => {
      console.error('TikTokProvider connection error:', err);
    });

    super.start();
  }

  stop() {
    if (this.connection) {
      this.connection.removeAllListeners();
      this.connection.disconnect().catch(() => {});
    }
    super.stop();
  }
}

module.exports = TikTokProvider;