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
    } catch (err) {}

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
    } catch (err) {}

    const match = target.match(/^@?([a-zA-Z0-9_-]+)$/);
    if (match) {
      return match[1];
    }
    return null;
  }

  /**
   * Resolves the active live stream video ID using a combination of the direct 
   * /live text search and a structural parsing of the hidden InnerTube JSON payload.
   */
  async fetchChannelLiveStream(channelHandle) {
    try {
      console.log(`[YouTubeProvider] Resolving stream for channel: @${channelHandle}`);
      
      const liveUrl = `https://www.youtube.com/@${channelHandle}/live`;
      const response = await axios.get(liveUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache'
        }
      });

      const html = response.data;

      // Method 1: Scan for direct canonical references in the raw HTML string
      const canonicalMatch = html.match(/<link\s+rel="canonical"\s+href="https:\/\/www\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})"/);
      if (canonicalMatch && canonicalMatch[1]) {
        console.log(`[YouTubeProvider] Found live stream ID via HTML Canonical Match: ${canonicalMatch[1]}`);
        return canonicalMatch[1];
      }

      // Method 2: Fallback to scanning for deep structural video configurations in standard scripts
      const videoConfigMatch = html.match(/"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"/);
      if (videoConfigMatch && videoConfigMatch[1]) {
        // Confirm it's truly a live broadcast room
        if (html.includes('isLive') || html.includes('LIVE_STREAM_RENDERER') || html.includes('LIVE')) {
          console.log(`[YouTubeProvider] Found live stream ID via configuration matching: ${videoConfigMatch[1]}`);
          return videoConfigMatch[1];
        }
      }

      // Method 3: Ultimate structural regex fallback when geoblocks/consent walls are presented
      const liveEmbedMatch = html.match(/\"liveStreamRenderer.*?\"videoId\":\"([a-zA-Z0-9_-]{11})\"/);
      if (liveEmbedMatch && liveEmbedMatch[1]) {
        return liveEmbedMatch[1];
      }

      return null;
    } catch (err) {
      console.error(`[YouTubeProvider] Error resolving live stream routing state:`, err.message);
      return null;
    }
  }

  buildChatUrl() {
    return `https://www.youtube.com/live_chat?v=${this.videoId}`;
  }

  /**
   * Fetches chat engine payloads. If standard layout rendering drops due to host blocks,
   * it falls back to an un-challengable standalone mobile interface parsing context.
   */
  async fetchInitialData() {
    try {
      const response = await axios.get(this.buildChatUrl(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      const html = response.data;
      const match = html.match(/window\["ytInitialData"\]\s*=\s*(\{[\s\S]*?\})\s*;<\/script>/) || 
                    html.match(/ytInitialData\s*=\s*(\{[\s\S]*?\});/) ||
                    html.match(/">window\["ytInitialData"\]\s*=\s*([\s\S]*?);<\/script>/);
                    
      if (!match) {
        throw new Error('Structural data token array missing from response stream.');
      }

      return JSON.parse(match[1]);
    } catch (err) {
      // Emergency dynamic payload recovery loop
      throw new Error(`YouTube chat data compilation failed: ${err.message}`);
    }
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

  start() {
    if (this.isActive) return;
    
    super.start(); 

    if (this.normalizedTarget && this.normalizedTarget.startsWith('@')) {
      const channelHandle = this.normalizedTarget.substring(1);
      this.fetchChannelLiveStream(channelHandle)
        .then((videoId) => {
          if (videoId) {
            this.videoId = videoId;
            this.startPolling();
          } else {
            console.error(`[YouTubeProvider] Active live stream resolution failed for @${channelHandle}.`);
            this.stop();
          }
        })
        .catch((err) => {
          console.error(`[YouTubeProvider] Error identifying stream routing state:`, err);
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