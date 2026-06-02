const axios = require('axios');
const BaseProvider = require('./baseProvider');

const YOUTUBE_ICON_URL = 'assets/tube_icon.png';
const POLL_INTERVAL_MS = 3500;

class YouTubeProvider extends BaseProvider {
  constructor(target, onMessage) {
    super(target, onMessage);
    this.seenIds = new Set();
    this.pollInterval = null;
    this.videoId = this.extractVideoId(target);
  }

  static normalizeTarget(target) {
    if (typeof target !== 'string') return null;
    const raw = target.trim();
    if (!raw) return null;
    
    // Try to extract a video ID first
    const videoId = YouTubeProvider.extractVideoIdStatic(raw);
    if (videoId && !videoId.startsWith('@')) {
      return videoId;
    }
    
    // Try to extract channel handle from URLs or raw channel names
    const channelHandle = YouTubeProvider.extractChannelHandle(raw);
    if (channelHandle) {
      return `@${channelHandle}`;
    }
    
    return null;
  }

  static validateTarget(target) {
    return Boolean(this.normalizeTarget(target));
  }

  static extractVideoIdStatic(target) {
    try {
      const url = new URL(target);
      if (url.searchParams.has('v')) {
        return url.searchParams.get('v');
      }
      const pathname = url.pathname;
      const match = pathname.match(/\/([a-zA-Z0-9_-]{11})(?:$|\/)/);
      if (match) {
        return match[1];
      }
    } catch (err) {
      const match = target.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      if (match) {
        return match[1];
      }
      if (/^[a-zA-Z0-9_-]{11}$/.test(target)) {
        return target;
      }
    }
    return null;
  }

  static extractChannelHandle(target) {
    try {
      const url = new URL(target);
      const pathname = url.pathname;
      const handleMatch = pathname.match(/\/@([^\/?#]+)/u);
      if (handleMatch) {
        return handleMatch[1];
      }
    } catch (err) {
      const match = target.match(/^@?([^\/\s]+)$/u);
      if (match) {
        return match[1];
      }
    }
    return null;
  }

async fetchChannelLiveStream(channelHandle) {
    try {
      console.log(`[YouTubeProvider] Dynamic lookup tracking active for channel: @${channelHandle}`);
      const channelUrl = `https://www.youtube.com/@${channelHandle}/live`;
      const response = await axios.get(channelUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      // Guard: Check if your scraper hit an unauthenticated cookie consent or bot wall
      if (response.data.includes('consent.youtube.com') || response.data.includes('captcha')) {
        console.warn(`[YouTubeProvider] Warning: YouTube issued a bot challenge or consent wall for @${channelHandle}.`);
        return null;
      }

      // Extract the video ID safely from the primary player's internal videoDetails block.
      // This ignores sidebar recommendations while successfully capturing the active video ID.
      const playerMatch = response.data.match(/"videoDetails"\s*:\s*\{[^}]*"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"/);
      const videoId = playerMatch ? playerMatch[1] : null;

      if (!videoId) {
        return null;
      }

      // Verify that this specific main player item is actually live, rather than a channel trailer VOD
      const isLiveActive = response.data.includes('"isLive":true') || 
                           response.data.includes('"isLiveStream":true') || 
                           response.data.includes('"style":"LIVE"');

      if (!isLiveActive) {
        return null;
      }

      console.log(`[YouTubeProvider] Successfully isolated verified active live stream ID: ${videoId}`);
      return videoId;
    } catch (err) {
      console.error(`[YouTubeProvider] Error resolving dynamic channel stream:`, err.message);
      return null;
    }
  }

  extractVideoId(target) {
    try {
      const url = new URL(target);
      if (url.searchParams.has('v')) {
        return url.searchParams.get('v');
      }
      const pathname = url.pathname;
      const match = pathname.match(/\/([a-zA-Z0-9_-]{11})(?:$|\/)/);
      if (match) {
        return match[1];
      }
    } catch (err) {
      const match = target.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      if (match) {
        return match[1];
      }
    }

    try {
      const url = new URL(target);
      const pathname = url.pathname;
      const handleMatch = pathname.match(/\/@([^\/?#]+)/u);
      if (handleMatch) {
        return `@${handleMatch[1]}`;
      }
    } catch (err) {
      const match = target.match(/^@?([^\/\s]+)$/u);
      if (match) {
        return `@${match[1]}`;
      }
    }

    return null;
  }

  buildChatUrl() {
    return `https://www.youtube.com/live_chat?v=${this.videoId}`;
  }

  async fetchInitialData() {
    const response = await axios.get(channelUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept-Language': 'en-US,en;q=0.9',
              // Inject pre-accepted consent cookies to bypass the redirect wall
              'Cookie': 'CONSENT=YES+cb; SOCS=CAI', 
              // Adding these helps bypass deeper bot-checks
              'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
              'Sec-Ch-Ua-Mobile': '?0',
              'Sec-Ch-Ua-Platform': '"Windows"'
            },
          });

    const html = response.data;
    const match = html.match(/window\["ytInitialData"\]\s*=\s*(\{[\s\S]*?\})\s*;<\/script>/);
    if (!match) {
      throw new Error('Unable to locate ytInitialData in YouTube live chat page');
    }

    return JSON.parse(match[1]);
  }

  findChatActions(node) {
    if (!node || typeof node !== 'object') {
      return null;
    }

    if (Array.isArray(node)) {
      if (node.some((item) => item && item.addChatItemAction)) {
        return node;
      }
      for (const item of node) {
        const found = this.findChatActions(item);
        if (found) {
          return found;
        }
      }
      return null;
    }

    for (const value of Object.values(node)) {
      const found = this.findChatActions(value);
      if (found) {
        return found;
      }
    }
    return null;
  }

  normalizeText(runs) {
    if (!runs) return '';
    if (typeof runs === 'string') return runs;
    if (Array.isArray(runs)) {
      return runs.map((run) => run?.text || '').join('');
    }
    if (runs.simpleText) return runs.simpleText;
    return '';
  }

  normalizeAuthor(author) {
    if (!author) return 'YouTube Viewer';
    if (author.simpleText) return author.simpleText;
    if (Array.isArray(author.runs)) {
      return author.runs.map((run) => run.text || '').join('');
    }
    return 'YouTube Viewer';
  }

  extractActionPayload(action) {
    const chatItem = action.addChatItemAction;
    const item = chatItem?.item;
    if (!item) return null;

    const textRenderer =
      item.liveChatTextMessageRenderer ||
      item.liveChatPaidMessageRenderer ||
      item.liveChatPaidStickerRenderer ||
      item.liveChatMembershipItemRenderer ||
      item.liveChatStandardMessageRenderer;

    if (!textRenderer) return null;

    const messageText =
      this.normalizeText(textRenderer.message?.runs || textRenderer.message?.simpleText) ||
      this.normalizeText(textRenderer.purchaseAmount?.simpleText) ||
      this.normalizeText(textRenderer.headerSubtext?.runs) ||
      this.normalizeText(textRenderer.authorName?.simpleText);

    const username = this.normalizeAuthor(textRenderer.authorName);
    const id = textRenderer.id || textRenderer.messageId || textRenderer.purchaseAmount?.runs?.[0]?.text || null;
    const isSystemAlert = Boolean(
      item.liveChatPaidMessageRenderer ||
      item.liveChatPaidStickerRenderer ||
      item.liveChatMembershipItemRenderer,
    );

    if (!messageText || !username) return null;

    return {
      id,
      platform: 'youtube',
      username,
      message: messageText,
      timestamp: new Date().toISOString(),
      isSystemAlert,
      iconUrl: YOUTUBE_ICON_URL,
    };
  }

  async pollLiveChat() {
    if (!this.videoId || this.videoId.startsWith('@')) {
      return;
    }

    try {
      const initialData = await this.fetchInitialData();
      const actions = this.findChatActions(initialData) || [];

      for (const action of actions) {
        const payload = this.extractActionPayload(action);
        if (!payload || !payload.id || this.seenIds.has(payload.id)) {
          continue;
        }

        this.seenIds.add(payload.id);
        this.onMessage(payload);
      }
    } catch (err) {
      console.error('YouTubeProvider polling error:', err.message || err);
    }
  }

  start() {
    if (this.isActive) return;

    if (this.videoId && this.videoId.startsWith('@')) {
      const channelHandle = this.videoId.substring(1);
      
      // FIX: Upgraded to a continuous background polling loop to provide a true 
      // "set-it-and-forget-it" UX if the channel starts up while offline.
      const resolveAndConnect = async () => {
        const resolvedVideoId = await this.fetchChannelLiveStream(channelHandle);
        if (resolvedVideoId) {
          this.videoId = resolvedVideoId;
          this.startPolling();
        } else {
          console.log(`[YouTubeProvider] @${channelHandle} is currently offline. Re-checking stream state in 30 seconds...`);
          this.pollInterval = setTimeout(resolveAndConnect, 30000);
        }
      };

      resolveAndConnect().catch((err) => {
        console.error(`[YouTubeProvider] Handle tracking thread encountered a fault:`, err);
      });
      
      this.isActive = true;
      super.start();
      return;
    }

    this.startPolling();
  }

  startPolling() {
    if (!this.videoId || this.videoId.startsWith('@')) {
      throw new Error('YouTubeProvider requires a resolved, valid 11-character video ID before polling.');
    }

    // Clear previous check-timers if switching gears to active polling
    if (this.pollInterval) {
      clearTimeout(this.pollInterval);
    }

    this.pollInterval = setInterval(() => this.pollLiveChat(), POLL_INTERVAL_MS);
    this.pollLiveChat().catch((err) => {
      console.error('YouTubeProvider initial poll failed:', err.message || err);
    });

    if (!this.isActive) {
      super.start();
    }
  }

  stop() {
    if (this.pollInterval) {
      clearTimeout(this.pollInterval);
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    super.stop();
  }
}

module.exports = YouTubeProvider;