const axios = require('axios');
const BaseProvider = require('./baseProvider');

const YOUTUBE_ICON_URL = 'assets/tube_icon.png';
const POLL_INTERVAL_MS = 3500;

class YouTubeProvider extends BaseProvider {
  constructor(target, onMessage) {
    super(target, onMessage);
    this.seenIds = new Set();
    this.pollInterval = null;
    this.videoId = null;
    
    // Normalize target correctly from the start
    this.normalizedTarget = YouTubeProvider.normalizeTarget(target);
    
    if (this.normalizedTarget && !this.normalizedTarget.startsWith('@')) {
      this.videoId = this.normalizedTarget;
    }
  }

  static normalizeTarget(target) {
    if (typeof target !== 'string') return null;
    const raw = target.trim();
    if (!raw) return null;
    
    const videoId = YouTubeProvider.extractVideoIdStatic(raw);
    if (videoId && !videoId.startsWith('@')) {
      return videoId;
    }
    
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
    if (/^[a-zA-Z0-9_-]{11}$/.test(target)) {
      return target;
    }

    try {
      if (target.startsWith('http://') || target.startsWith('https://')) {
        const url = new URL(target);
        if (url.searchParams.has('v')) {
          return url.searchParams.get('v');
        }
        const pathname = url.pathname;
        const match = pathname.match(/\/([a-zA-Z0-9_-]{11})(?:$|\/)/);
        if (match) {
          return match[1];
        }
      }
    } catch (err) {
      // Fallthrough
    }

    const match = target.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (match) {
      return match[1];
    }
    return null;
  }

  static extractChannelHandle(target) {
    try {
      if (target.startsWith('http://') || target.startsWith('https://')) {
        const url = new URL(target);
        const pathname = url.pathname;
        const handleMatch = pathname.match(/\/@([a-zA-Z0-9_-]+)/);
        if (handleMatch) {
          return handleMatch[1];
        }
      }
    } catch (err) {
      // Fallthrough
    }

    const match = target.match(/^@?([a-zA-Z0-9_-]+)$/);
    if (match) {
      return match[1];
    }
    return null;
  }

  /**
   * Fetches the channel's active live stream video ID using a combination of 
   * the ultra-stable RSS Feed fallback and direct DOM inspection.
   */
  async fetchChannelLiveStream(channelHandle) {
    try {
      console.log(`[YouTubeProvider] Resolving active live stream for: @${channelHandle}`);
      
      // Phase 1: Try reading the channel page frontend with layout-proof lookaheads
      const channelUrl = `https://www.youtube.com/@${channelHandle}/live`;
      const response = await axios.get(channelUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      const html = response.data;

      // Check canonical link patterns first
      const canonicalMatch = html.match(/<link\s+rel="canonical"\s+href="https:\/\/www\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})"/);
      if (canonicalMatch && canonicalMatch[1]) {
        return canonicalMatch[1];
      }

      // Phase 2: RSS Feed parsing fallback (Unbrickable via layout challenges)
      // We look for the external channel ID channel token inside the layout to query the XML feed
      const channelIdMatch = html.match(/"channelId"\s*:\s*"([a-zA-Z0-9_-]{24})"/);
      if (channelIdMatch && channelIdMatch[1]) {
        const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelIdMatch[1]}`;
        const rssResponse = await axios.get(rssUrl);
        const rssFeed = rssResponse.data;
        
        // Find the most recent video ID uploaded/streamed in the XML feed stream
        const videoIdMatches = [...rssFeed.matchAll(/<yt:videoId>([a-zA-Z0-9_-]{11})<\/yt:videoId>/g)];
        if (videoIdMatches.length > 0) {
          // Check the top 2 items to see if either are active live streams
          for (const match of videoIdMatches.slice(0, 2)) {
            const potentialId = match[1];
            // Double check if this recent video ID is actually an active live stream chat room
            const isLive = await this.verifyIsLive(potentialId);
            if (isLive) return potentialId;
          }
        }
      }

      // Final dynamic structural text trace fallback
      const fallbackMatch = html.match(/"liveStreamRenderer".*?"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"/);
      if (fallbackMatch && fallbackMatch[1]) return fallbackMatch[1];

      return null;
    } catch (err) {
      console.error(`[YouTubeProvider] Error identifying channel state:`, err.message);
      return null;
    }
  }

  async verifyIsLive(videoId) {
    try {
      const response = await axios.get(`https://www.youtube.com/live_chat?v=${videoId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      return response.data.includes('ytInitialData') && !response.data.includes('isLive":false');
    } catch {
      return false;
    }
  }

  buildChatUrl() {
    return `https://www.youtube.com/live_chat?v=${this.videoId}`;
  }

  async fetchInitialData() {
    const response = await axios.get(this.buildChatUrl(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    const html = response.data;
    const match = html.match(/window\["ytInitialData"\]\s*=\s*(\{[\s\S]*?\})\s*;<\/script>/) || 
                  html.match(/ytInitialData\s*=\s*(\{[\s\S]*?\});/);
                  
    if (!match) {
      throw new Error('Unable to extract ytInitialData token payload. Rate limit challenge wall active.');
    }

    return JSON.parse(match[1]);
  }

  findChatActions(node) {
    if (!node || typeof node !== 'object') return null;

    if (Array.isArray(node)) {
      if (node.some((item) => item && (item.addChatItemAction || item.replayChatItemAction))) {
        return node;
      }
      for (const item of node) {
        const found = this.findChatActions(item);
        if (found) return found;
      }
      return null;
    }

    for (const value of Object.values(node)) {
      const found = this.findChatActions(value);
      if (found) return found;
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
    const chatItem = action.addChatItemAction || action.replayChatItemAction;
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
    if (!this.videoId) return;

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

  /**
   * OVERRIDE: Modified to synchronize seamlessly with BaseProvider state rules instantly
   */
  start() {
    if (this.isActive) return;
    
    // Crucial: Set active status IMMEDIATELY so parent orchestration code maps sync loops correctly
    super.start(); 

    if (this.normalizedTarget && this.normalizedTarget.startsWith('@')) {
      const channelHandle = this.normalizedTarget.substring(1);
      this.fetchChannelLiveStream(channelHandle)
        .then((videoId) => {
          if (videoId) {
            this.videoId = videoId;
            this.startPolling();
          } else {
            console.error(`[YouTubeProvider] No active live stream found for channel @${channelHandle}.`);
            this.stop();
          }
        })
        .catch((err) => {
          console.error(`[YouTubeProvider] Error resolving channel live stream:`, err);
          this.stop();
        });
      return;
    }

    this.startPolling();
  }

  startPolling() {
    if (!this.videoId) {
      console.error('YouTubeProvider execution failed: video ID not resolved.');
      this.stop();
      return;
    }

    this.pollInterval = setInterval(() => this.pollLiveChat(), POLL_INTERVAL_MS);
    this.pollLiveChat().catch((err) => {
      console.error('YouTubeProvider initial poll failed:', err.message || err);
    });
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