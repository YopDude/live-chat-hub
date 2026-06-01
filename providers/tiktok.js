const { WebcastPushConnection } = require('tiktok-live-connector');
const BaseProvider = require('./baseProvider');

const TIKTOK_ICON_URL = 'assets/tktk_icon.png';

class TikTokProvider extends BaseProvider {
  constructor(target, onMessage) {
    super(target, onMessage);
    this.connection = new WebcastPushConnection(target);
    this.messageCounter = 0;
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
        username: data.uniqueId || data.nickname || 'TikTok User',
        message: data.comment || '',
        timestamp: new Date().toISOString(),
        isSystemAlert: false,
        iconUrl: TIKTOK_ICON_URL,
      });
    });

    this.connection.on('gift', (data) => {
      this.messageCounter++;
      const giftName = data.giftName || 'Gift';
      const username = data.uniqueId || data.nickname || 'TikTok User';
      this.onMessage({
        id: `tiktok_gift_${Date.now()}_${this.messageCounter}`,
        platform: 'tiktok',
        username,
        message: `${username} sent a ${giftName}!`,
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
