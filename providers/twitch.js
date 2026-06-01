const tmi = require('tmi.js');
const BaseProvider = require('./baseProvider');

const TWITCH_ICON_URL = 'assets/twch_icon.png';

class TwitchProvider extends BaseProvider {
  constructor(target, onMessage) {
    console.log(`[TwitchProvider] Constructing with target: ${target}`);
    super(target, onMessage);
    this.client = null;
  }

  start() {
    if (this.isActive) {
      console.log(`[TwitchProvider] Already active for ${this.target}, skipping restart`);
      return;
    }

    console.log(`[TwitchProvider] Starting for channel: ${this.target}`);

    this.client = new tmi.Client({
      connection: {
        reconnect: true,
      },
      channels: [this.target],
    });

    this.client.on('message', (channel, userstate, message, self) => {
      console.log(`[TwitchProvider:message] channel=${channel}, self=${self}, message="${message}"`);
      if (self) return;

      const username = userstate['display-name'] || userstate.username || userstate['user-id'] || 'unknown';
      const id = userstate.id || userstate['user-id'] || userstate['message-id'] || null;
      console.log(`[TwitchProvider:message] Emitting: username="${username}", message="${message}"`);
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
      console.log(`[TwitchProvider:subscription] username="${username}", method="${method}"`);
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

    this.client.on('connected', () => {
      console.log(`[TwitchProvider] Connected to channel: ${this.target}`);
    });

    this.client.on('disconnected', () => {
      console.log(`[TwitchProvider] Disconnected from channel: ${this.target}`);
    });

    this.client.connect().catch((err) => {
      console.error('TwitchProvider connection error:', err);
    });
    console.log(`[TwitchProvider] start() completed, calling super.start()`);
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
