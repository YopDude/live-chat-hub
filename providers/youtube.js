const axios = require('axios');
const BaseProvider = require('./baseProvider');

const YOUTUBE_ICON_URL = 'assets/tube_icon.png';
const POLL_INTERVAL_MS = 3500;

class YouTubeProvider extends BaseProvider {
  constructor(target, onMessage) {
    super(target, onMessage);
    this.seenIds = new Set();
    this.pollInterval = null;
    
    // Normalize target correctly from the start to catch handles or IDs
    this.normalizedTarget = YouTubeProvider.normalizeTarget(target);
    
    if (this.normalizedTarget && !this.normalizedTarget.startsWith('@')) {
      this.videoId = this.normalizedTarget;
    } else {
      this.videoId = null; 
    }
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
   * Scrapes the channel's /streams tab to structurally isolate the truly live video card.
   */
  async fetchChannelLiveStream(channelHandle) {
    try {
      console.log(`[YouTubeProvider] Fetching active stream metadata for channel: ${channelHandle}`);
      
      // Scraping the /streams tab guarantees we get structural layout lists instead of direct watch layout shifts
      const targetUrl = `https://www.youtube.com/@${channelHandle}/streams`;
      
      const response = await axios.get(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache'
        },
      });

      const html = response.data;
      const match = html.match(/window\["ytInitialData"\]\s*=\s*(\{[\s\S]*?\})\s*;<\/script>/) || 
                    html.match(/ytInitialData\s*=\s*(\{[\s\S]*?\});/);

      if (!match) {
        console.warn(`[YouTubeProvider] Failed to extract structural JSON layout data for @${channelHandle}. Triggering backup parsing...`);
        return this.backupRegexParser(html);
      }

      const ytInitialData = JSON.parse(match[1]);
      
      // Traverse down into the active tab contents structurally
      const activeVideoId = this.scanRenderersForLiveBadge(ytInitialData);
      if (activeVideoId) {
        console.log(`[YouTubeProvider] Found live stream video ID: ${activeVideoId}`);
        return activeVideoId;
      }

      // Check fallback regex just in case extraction was fine but tree structure has mutated slightly
      return this.backupRegexParser(html);
    } catch (err) {
      console.error(`[YouTubeProvider] Error identifying active stream:`, err.message);
      return null;
    }
  }

  /**
   * Recursively looks for a videoRenderer containing a live badge inside the data tree.
   */
  scanRenderersForLiveBadge(node) {
    if (!node || typeof node !== 'object') return null;

    if (node.videoRenderer) {
      const renderer = node.videoRenderer;
      const badges = renderer.thumbnailOverlays || [];
      
      // Look for a structural 'STYLE_TYPE_LIVE' overlay marker inside the video layout card
      const isLive = JSON.stringify(badges).includes('BADGE_STYLE_TYPE_LIVE') || 
                     JSON.stringify(renderer.badges).includes('LIVE');
                     
      if (isLive && renderer.videoId) {
        return renderer.videoId;
      }
    }

    if (Array.isArray(node)) {
      for (const element of node) {
        const found = this.scanRenderersForLiveBadge(element);
        if (found) return found;
      }
    } else {
      for (const value of Object.values(node)) {
        const found = this.scanRenderersForLiveBadge(value);
        if (found) return found;
      }
    }
    return null;
  }

  backupRegexParser(html) {
    // Looks for explicit canonical URLs pointing to watch?v= matching elements inside scripts
    const canonicalMatch = html.match(/<link\s+rel="canonical"\s+href="https:\/\/www\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})"/);
    if (canonicalMatch && canonicalMatch[1]) return canonicalMatch[1];

    const structuralMatch = html.match(/"videoRenderer":\s*\{\s*"videoId":\s*"([a-zA-Z0-9_-]{11})"[^}]+"style":\s*"BADGE_STYLE_TYPE_LIVE"/);
    if (structuralMatch && structuralMatch[1]) return structuralMatch[1];
    
    return null;
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
      throw new Error('Unable to locate ytInitialData in YouTube live chat page. Challenge walls or IP restrictions are currently active.');
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
    if (!this.videoId) {
      throw new Error('Invalid YouTube target URL or missing video ID');
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

    if (this.normalizedTarget && this.normalizedTarget.startsWith('@')) {
      const channelHandle = this.normalizedTarget.substring(1);
      this.fetchChannelLiveStream(channelHandle)
        .then((videoId) => {
          if (videoId) {
            this.videoId = videoId;
            this.startPolling();
          } else {
            console.error(`[YouTubeProvider] No active live stream found for channel @${channelHandle}. Verify channel setup.`);
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