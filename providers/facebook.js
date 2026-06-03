const puppeteer = require('puppeteer-core'); // 👈 Changed from 'puppeteer'
const BaseProvider = require('./baseProvider');

const FACEBOOK_ICON_URL = 'assets/fb_icon.png';

class FacebookProvider extends BaseProvider {
  constructor(target, onMessage) {
    super(target, onMessage);
    this.browser = null;
    this.page = null;
    this.seenCommentIds = new Set();
    this.normalizedTarget = FacebookProvider.normalizeTarget(target);
  }

  // ... normalizeTarget and validateTarget functions stay the same ...

  async start() {
    if (this.isActive) return;
    super.start();

    if (!this.normalizedTarget) {
      console.error('[FacebookProvider] Initialization aborted: Target structure is invalid.');
      this.stop();
      return;
    }

    try {
      console.log(`[FacebookProvider] Spawning browser pipeline for target: ${this.normalizedTarget}`);
      
      this.browser = await puppeteer.launch({
        headless: "new",
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-notifications'
        ]
      });

      this.page = await this.browser.newPage();
      
      // Inject persistent desktop User-Agent string to match cookie structural profiles
      await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      // --- PERSISTENT COOKIE INJECTION ---
      // Load your long-lived Facebook session string from environment configurations.
      // This maps your `c_user`, `xs`, and session tokens to mimic a persistent logged-in app browser.
      const sessionCookiesJson = process.env.FACEBOOK_SESSION_COOKIES;
      if (sessionCookiesJson) {
        try {
          const cookies = JSON.parse(sessionCookiesJson);
          await this.page.setCookie(...cookies);
          console.log('[FacebookProvider] Persistent session cookies successfully synchronized.');
        } catch (e) {
          console.warn('[FacebookProvider] Cookie parsing failed. Attempting unauthenticated access layout...', e.message);
        }
      }

      // Navigate straight into the live interactive stream portal
      await this.page.goto(this.normalizedTarget, { waitUntil: 'networkidle2', timeout: 45000 });

      // Expose a secure inter-process bridge function back to the Node process environment
      await this.page.exposeFunction('emitFacebookComment', (payload) => {
        if (!this.isActive) return;
        
        if (payload && payload.id && !this.seenCommentIds.has(payload.id)) {
          this.seenCommentIds.add(payload.id);
          
          this.onMessage({
            id: payload.id,
            platform: 'facebook',
            username: payload.username,
            message: payload.message,
            timestamp: new Date().toISOString(),
            isSystemAlert: false,
            iconUrl: FACEBOOK_ICON_URL
          });
        }
      });

      // Monitor structural mutations inside the standard live comment element trees
      await this.page.evaluate(() => {
        console.log('[FacebookProvider] MutationObserver initialized on target container viewport.');

        // Target standard responsive role structures where chat feeds update inside Facebook layouts
        const targetSelectors = [
          'div[role="log"]', 
          'div[data-testid="UFI2CommentsList/root"]',
          '.x1n2onr6.x1ja2u2z' // Modern structural tailwind-like minified compilation blocks
        ];

        let targetNode = null;
        for (const selector of targetSelectors) {
          targetNode = document.querySelector(selector);
          if (targetNode) break;
        }

        // Fallback fallback selector map to high-level parent layout structures if precise components haven't hydrated yet
        if (!targetNode) targetNode = document.body;

        const observer = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            mutation.addedNodes.forEach((node) => {
              if (node.nodeType !== Node.ELEMENT_NODE) return;

              // Extract interactive string components based on standard text block attributes
              const textBlock = node.querySelector('span[dir="auto"]');
              
              // Extract usernames targeting text linkage components within the element card
              const authorBlock = node.querySelector('span.x193iq5w, a[role="link"]');

              if (textBlock && authorBlock) {
                const message = textBlock.textContent.trim();
                const username = authorBlock.textContent.trim();
                
                // Construct a tracking unique composite hash to prevent timeline layout repetition
                const elementSignature = `${username}-${message.substring(0, 16)}`;

                if (message && username) {
                  window.emitFacebookComment({
                    id: elementSignature,
                    username: username,
                    message: message
                  });
                }
              }
            });
          }
        });

        observer.observe(targetNode, { childList: true, subtree: true });
      });

    } catch (err) {
      console.error(`[FacebookProvider] Stream pipeline initialization failure: ${err.message}`);
      this.stop();
    }
  }

  /**
   * Safely disposes and tears down background automation layers to free system memory allocations.
   */
  stop() {
    console.log(`[FacebookProvider] Terminating stream observers cleanly for: ${this.target}`);
    if (this.browser) {
      this.browser.close()
        .catch((e) => console.error('[FacebookProvider] Error closing browser allocation context:', e.message));
      this.browser = null;
    }
    this.page = null;
    super.stop();
  }
}

module.exports = FacebookProvider;