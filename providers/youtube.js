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
      // Return as channel handle marker so we can fetch live stream later
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
      // Match @ChannelHandle
      const handleMatch = pathname.match(/\/@([a-zA-Z0-9_-]+)/);
      if (handleMatch) {
        return handleMatch[1];
      }
    } catch (err) {
      // Handle raw channel names like "ThaRixer" or "@ThaRixer"
      const match = target.match(/^@?([a-zA-Z0-9_-]+)$/);
      if (match) {
        return match[1];
      }
    }
    return null;
  }

  async fetchChannelLiveStream(channelHandle) {
    try {
      console.log(`[YouTubeProvider] Fetching live stream for channel: ${channelHandle}`);
      const channelUrl = `https://www.youtube.com/@${channelHandle}/live`;
      const response = await axios.get(channelUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36',
        },
      });

      // Extract video ID from the response
      const idMatch = response.data.match(/(?:"videoId"|"VIDEO_ID"\s*:\s*)"([a-zA-Z0-9_-]{11})/);
      if (idMatch && idMatch[1]) {
        console.log(`[YouTubeProvider] Found live stream video ID: ${idMatch[1]}`);
        return idMatch[1];
      }
      
      console.warn(`[YouTubeProvider] No live stream found for channel: ${channelHandle}`);
      return null;
    } catch (err) {
      console.error(`[YouTubeProvider] Error fetching channel stream:`, err.message);
      return null;
    }
  }


  extractVideoId(target) {
    // First try to extract a video ID
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

    // Try to extract channel handle
    try {
      const url = new URL(target);
      const pathname = url.pathname;
      const handleMatch = pathname.match(/\/@([a-zA-Z0-9_-]+)/);
      if (handleMatch) {
        return `@${handleMatch[1]}`;
      }
    } catch (err) {
      const match = target.match(/^@?([a-zA-Z0-9_-]+)$/);
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
    const response = await axios.get(this.buildChatUrl(), {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36',
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
      if (node.some((item) => item && (item.addChatItemAction || item.replayChatItemAction))) {
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
    if (!runs) {
      return '';
    }
    if (typeof runs === 'string') {
      return runs;
    }
    if (Array.isArray(runs)) {
      return runs.map((run) => run?.text || '').join('');
    }
    if (runs.simpleText) {
      return runs.simpleText;
    }
    return '';
  }

  normalizeAuthor(author) {
    if (!author) {
      return 'YouTube Viewer';
    }
    if (author.simpleText) {
      return author.simpleText;
    }
    if (Array.isArray(author.runs)) {
      return author.runs.map((run) => run.text || '').join('');
    }
    return 'YouTube Viewer';
  }

  extractActionPayload(action) {
    const chatItem = action.addChatItemAction || action.replayChatItemAction;
    const item = chatItem?.item;
    if (!item) {
      return null;
    }

    const textRenderer =
      item.liveChatTextMessageRenderer ||
      item.liveChatPaidMessageRenderer ||
      item.liveChatPaidStickerRenderer ||
      item.liveChatMembershipItemRenderer ||
      item.liveChatStandardMessageRenderer;

    if (!textRenderer) {
      return null;
    }

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

    if (!messageText || !username) {
      return null;
    }

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
    if (!this.videoId) {
      throw new Error('Invalid YouTube target URL or missing video ID');
    }

    try {
      const initialData = await this.fetchInitialData();
      const actions = this.findChatActions(initialData) || [];

      for (const action of actions) {
        const payload = this.extractActionPayload(action);
        if (!payload) {
          continue;
        }

        if (!payload.id) {
          continue;
        }

        if (this.seenIds.has(payload.id)) {
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
    if (this.isActive) {
      return;
    }

    // If target starts with @, it's a channel handle—fetch the live stream video ID
    if (this.target.startsWith('@')) {
      const channelHandle = this.target.substring(1);
      this.fetchChannelLiveStream(channelHandle)
        .then((videoId) => {
          if (videoId) {
            this.videoId = videoId;
            this.startPolling();
          } else {
            console.error(`[YouTubeProvider] No active live stream for channel @${channelHandle}`);
          }
        })
        .catch((err) => {
          console.error(`[YouTubeProvider] Error resolving channel live stream:`, err);
        });
      return;
    }

    this.startPolling();
  }

  startPolling() {
    if (!this.videoId) {
      throw new Error('YouTubeProvider requires a valid YouTube video URL, ID, or channel name');
    }

    this.pollInterval = setInterval(() => this.pollLiveChat(), POLL_INTERVAL_MS);
    this.pollLiveChat().catch((err) => {
      console.error('YouTubeProvider initial poll failed:', err.message || err);
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

module.exports = YouTubeProvider;
