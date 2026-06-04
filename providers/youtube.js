const axios = require('axios');
const BaseProvider = require('./baseProvider');

const YOUTUBE_ICON_URL = 'assets/tube_icon.png';
const POLL_INTERVAL_MS = 3500;
const RECHECK_STREAM_INTERVAL_MS = 60000; // Recheck for a live stream every 60 seconds if not active

class YouTubeProvider extends BaseProvider {
  constructor(target, onMessage) {
    super(target, onMessage);
    this.seenIds = new Set();
    this.pollInterval = null;
    this.recheckInterval = null; // Track the interval used for checking stream status
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
        const decodedPathname = decodeURIComponent(url.pathname);
        const handleMatch = decodedPathname.match(/\/@([a-zA-Z0-9_\-\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\uFF00-\uFFEF]+)/u);
        if (handleMatch) {
          return handleMatch[1];
        }
      }
    } catch (err) {}

    try {
      const decodedRaw = decodeURIComponent(target);
      const match = decodedRaw.match(/^@?([a-zA-Z0-9_\-\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\uFF00-\uFFEF]+)$/u);
      if (match) {
        return match[1];
      }
    } catch (err) {}
    
    return null;
  }

  /**
   * Resolves the active live stream video ID using robust structural extraction.
   */
  async fetchChannelLiveStream(channelHandle) {
    try {
      const safeHandle = encodeURIComponent(channelHandle);
      console.log(`[YouTubeProvider] Resolving stream for channel: @${channelHandle}`);
      
      const liveUrl = `https://www.youtube.com/@${safeHandle}/live`;
      const response = await axios.get(liveUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache'
        }
      });

      const html = response.data;
      let discoveredVideoId = null;

      // Method 1: Look for the precise canonical URL link element first
      const canonicalMatch = html.match(/<link\s+rel="canonical"\s+href="https:\/\/www\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})"/);
      if (canonicalMatch && canonicalMatch[1]) {
        discoveredVideoId = canonicalMatch[1];
        console.log(`[YouTubeProvider] Found live stream ID via canonical tag: ${discoveredVideoId}`);
        return discoveredVideoId;
      }

      // Method 2: Extract and parse ytInitialData to find the targeted watch video context
      const jsonMatch = html.match(/ytInitialData\s*=\s*(\{[\s\S]*?\});/) || 
                        html.match(/window\["ytInitialData"\]\s*=\s*(\{[\s\S]*?\})\s*;/);

      if (jsonMatch) {
        try {
          const parsedData = JSON.parse(jsonMatch[1]);
          
          // Drill directly into the primary player/watch layout metadata context
          const videoIdFromContext = parsedData?.currentVideoEndpoint?.watchEndpoint?.videoId ||
                                     parsedData?.playerOverlays?.liveChatRenderer?.liveChatId;

          if (videoIdFromContext && /^[a-zA-Z0-9_-]{11}$/.test(videoIdFromContext)) {
            console.log(`[YouTubeProvider] Found live stream ID via ytInitialData parsing: ${videoIdFromContext}`);
            return videoIdFromContext;
          }
        } catch (e) {
          console.warn(`[YouTubeProvider] Failed parsing ytInitialData block structural payload.`);
        }
      }

      // Method 3: Fallback to strict videoDetails contextual block regex matching
      const embeddedConfig = html.match(/"videoDetails":\s*\{[^}]*?"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"/);
      if (embeddedConfig && embeddedConfig[1]) {
        discoveredVideoId = embeddedConfig[1];
        console.log(`[YouTubeProvider] Found live stream ID via configuration details fallback: ${discoveredVideoId}`);
        return discoveredVideoId;
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

  async fetchInitialData() {
    try {
      const response = await axios.get(this.buildChatUrl(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
          'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
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
    if (!runs) return { text: '', emotes: [] };
    if (typeof runs === 'string') return { text: runs, emotes: [] };
    
    let combinedText = '';
    const emotes = [];

    if (Array.isArray(runs)) {
      runs.forEach((run) => {
        if (run?.text) {
          combinedText += run.text;
        } 
        else if (run?.emoji) {
          const shortcut = run.emoji.isCustomEmoji ? run.emoji.shortcuts?.[0] : run.emoji.emojiId;
          const label = shortcut || 'emoji';
          
          const thumbnails = run.emoji.image?.thumbnails || [];
          const imageUrl = thumbnails[thumbnails.length - 1]?.url || '';

          if (imageUrl) {
            combinedText += label;
            emotes.push({
              text: label,
              url: imageUrl
            });
          } else if (run.emoji.emojiId) {
            combinedText += run.emoji.emojiId;
          }
        }
      });
      return { text: combinedText, emotes };
    }

    if (runs.simpleText) return { text: runs.simpleText, emotes: [] };
    return { text: '', emotes: [] };
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

    const messageContent = this.normalizeText(textRenderer.message?.runs || textRenderer.message?.simpleText);
    
    let finalMessage = messageContent.text;
    let extractedEmotes = messageContent.emotes;
    
    if (!finalMessage) {
      finalMessage = this.normalizeText(textRenderer.purchaseAmount?.simpleText).text ||
                     this.normalizeText(textRenderer.headerSubtext?.runs).text ||
                     this.normalizeText(textRenderer.authorName?.simpleText).text;
    }

    const username = this.normalizeAuthor(textRenderer.authorName);
    const id = textRenderer.id || textRenderer.messageId || textRenderer.purchaseAmount?.runs?.[0]?.text || null;
    const isSystemAlert = Boolean(
      item.liveChatPaidMessageRenderer ||
      item.liveChatPaidStickerRenderer ||
      item.liveChatMembershipItemRenderer,
    );

    if (!finalMessage || !username) return null;

    return {
      id,
      platform: 'youtube',
      username,
      message: finalMessage,
      emotes: extractedEmotes,
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
   * Evaluates the targeted handle to see if a newer or active live stream is present.
   */
  async evaluateChannelStreamStatus(channelHandle) {
    const discoveredVideoId = await this.fetchChannelLiveStream(channelHandle);
    
    if (discoveredVideoId) {
      // If we found a live stream ID and it's different from our current tracked videoId, switch over
      if (discoveredVideoId !== this.videoId) {
        console.log(`[YouTubeProvider] Stream ID update detected for @${channelHandle}: ${this.videoId} -> ${discoveredVideoId}`);
        
        // Stop current polling instance if it exists
        if (this.pollInterval) {
          clearInterval(this.pollInterval);
          this.pollInterval = null;
        }

        // Wipe deduplication buffer cache for the new room environment context
        this.seenIds.clear();
        
        // Update to the newly recovered ID and spin up chat polling engine
        this.videoId = discoveredVideoId;
        this.startPolling();
      }
    } else {
      console.log(`[YouTubeProvider] Channel @${channelHandle} does not appear to be actively streaming live right now.`);
    }
  }

  start() {
    if (this.isActive) return;
    
    super.start(); 

    // If the input configuration is an explicit video ID, just start polling normally
    if (this.normalizedTarget && !this.normalizedTarget.startsWith('@')) {
      this.videoId = this.normalizedTarget;
      this.startPolling();
      return;
    }

    // Otherwise, handle dynamic channel lookups
    const channelHandle = this.normalizedTarget.substring(1);
    
    // Perform initial evaluation immediately
    this.evaluateChannelStreamStatus(channelHandle).catch((err) => {
      console.error(`[YouTubeProvider] Initial stream resolution sequence failed:`, err);
    });

    // Establish cyclical loop checks to safeguard against configuration updates or mid-session streams starting
    this.recheckInterval = setInterval(() => {
      if (!this.isActive) return;
      this.evaluateChannelStreamStatus(channelHandle).catch((err) => {
        console.error(`[YouTubeProvider] Background stream status evaluation loop failed:`, err);
      });
    }, RECHECK_STREAM_INTERVAL_MS);
  }

  startPolling() {
    if (!this.videoId) {
      console.error('YouTubeProvider execution failed: video ID not resolved.');
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
    if (this.recheckInterval) {
      clearInterval(this.recheckInterval);
      this.recheckInterval = null;
    }
    super.stop();
  }
}

module.exports = YouTubeProvider;