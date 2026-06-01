const tmi = require('tmi.js');
const BaseProvider = require('./baseProvider');

const TWITCH_ICON_URL = 'https://static.twitchcdn.net/assets/glitch_474x356.png';

class TwitchProvider extends BaseProvider {
  constructor(target, onMessage) {
    super(target, onMessage);
    this.client = null;
  }

  start() {
    if (this.isActive) {
      return;
    }

    this.client = new tmi.Client({
      connection: {
        reconnect: true,
      },
      channels: [this.target],
    });

    this.client.on('message', (channel, userstate, message, self) => {
      if (self) return;

      const username = userstate['display-name'] || userstate.username || userstate['user-id'] || 'unknown';
      const id = userstate.id || userstate['user-id'] || userstate['message-id'] || null;
      this.onMessage({
        id,
        platform: 'twitch',
        username,
        message,
        timestamp: new Date().toISOString(),
        isSystemAlert: false,
        iconUrl: TWITCH_ICON_URL,
      });
    });

    this.client.on('subscription', (channel, username, method, message, userstate) => {
      this.onMessage({
        id: userstate.id || userstate['user-id'] || null,
        platform: 'twitch',
        username,
        message: message || `${username} subscribed!`,
        timestamp: new Date().toISOString(),
        isSystemAlert: true,
        iconUrl: TWITCH_ICON_URL,
      });
    });

    this.client.connect().catch((err) => {
      console.error('TwitchProvider connection error:', err);
    });
    super.start();
  }

  stop() {
    if (this.client) {
      this.client.removeAllListeners();
      this.client.disconnect().catch(() => {});
      this.client = null;
    }
    super.stop();
  }
}

module.exports = TwitchProvider;
