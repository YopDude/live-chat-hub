const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const TwitchProvider = require('./providers/twitch');
const YouTubeProvider = require('./providers/youtube');
const TikTokProvider = require('./providers/tiktok');
const FacebookProvider = require('./providers/facebook');
const InstagramProvider = require('./providers/instagram');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ['https://yopdude.github.io', 'https://live-chat-hub.onrender.com', '*'],
    methods: ['GET', 'POST'],
  },
});

const providerClasses = {
  twitch: TwitchProvider,
  youtube: YouTubeProvider,
  tiktok: TikTokProvider,
  facebook: FacebookProvider,
  instagram: InstagramProvider,
};

// --- GLOBAL ROLLING HISTORY BUFFER ---
// Maintains a central cache of the last 50 chats received across all active users/channels
const CHAT_HISTORY_BUFFER = [];

function archiveMessage(payload) {
  CHAT_HISTORY_BUFFER.push(payload);
  if (CHAT_HISTORY_BUFFER.length > 50) {
    CHAT_HISTORY_BUFFER.shift(); // Evict the oldest entry to remain capped at 50
  }
}

// REST Endpoint allowing the iPad to pull down recent historical content upon waking up
app.get('/api/history', (req, res) => {
  res.json({ success: true, history: CHAT_HISTORY_BUFFER });
});

io.on('connection', (socket) => {
  const activeSources = new Map();

  const stopSource = (sourceId) => {
    const provider = activeSources.get(sourceId);
    if (!provider) return;

    try {
      provider.stop();
    } catch (err) {
      console.error(`Failed to stop provider ${sourceId}:`, err);
    }

    activeSources.delete(sourceId);
  };

  socket.on('add-source', ({ id, platform, target }, callback) => {
    console.log(`[add-source] Received: platform='${platform}', target='${target}'`);
    if (!id || !platform || !target) {
      const error = 'add-source requires id, platform, and target.';
      socket.emit('error', { message: error });
      if (typeof callback === 'function') callback({ success: false, error });
      return;
    }

    const ProviderClass = providerClasses[platform.toLowerCase()];
    if (!ProviderClass) {
      const error = `Unsupported platform: ${platform}`;
      socket.emit('error', { message: error });
      if (typeof callback === 'function') callback({ success: false, error });
      return;
    }

    const normalizedTarget = ProviderClass.normalizeTarget(target);
    if (!normalizedTarget) {
      const error = `Invalid ${platform} target: ${target}`;
      socket.emit('error', { message: error });
      if (typeof callback === 'function') callback({ success: false, error });
      return;
    }

    stopSource(id);

    const provider = new ProviderClass(normalizedTarget, (message) => {
      // Build full outbox message object
      const fullMessagePayload = {
        sourceId: id,
        platform,
        target: normalizedTarget,
        ...message,
      };

      // Store in our history log so it can be requested via /api/history later
      archiveMessage(fullMessagePayload);

      // Distribute immediately to connected streaming frontends
      socket.emit('chat-message', fullMessagePayload);
    });

    activeSources.set(id, provider);
    provider.start();

    if (typeof callback === 'function') {
      callback({ success: true, source: { id, platform, target: normalizedTarget } });
    }
  });

  socket.on('remove-source', ({ id }) => {
    if (!id) {
      socket.emit('error', { message: 'remove-source requires id.' });
      return;
    }

    stopSource(id);
  });

  socket.on('disconnect', () => {
    for (const sourceId of activeSources.keys()) {
      stopSource(sourceId);
    }
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Live chat hub server listening on port ${PORT}`);
});