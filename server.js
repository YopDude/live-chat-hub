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
      socket.emit('chat-message', {
        sourceId: id,
        platform,
        target: normalizedTarget,
        ...message,
      });
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

// HTTP route for fetching Twitch emotes (CORS proxy)
app.get('/api/twitch-emote/:emoteName', async (req, res) => {
  const emoteName = req.params.emoteName;
  try {
    const axios = require('axios');
    const response = await axios.get(`https://twitchemotes.com/api/v2/default?name=${encodeURIComponent(emoteName)}`);
    if (response.data && response.data.emotes && response.data.emotes.length > 0) {
      const emoteId = response.data.emotes[0].id;
      const emoteUrl = `https://cdn.betterttv.net/emote/${emoteId}/1x`;
      res.json({ success: true, url: emoteUrl });
    } else {
      res.json({ success: false });
    }
  } catch (err) {
    console.error(`Error fetching emote ${emoteName}:`, err.message);
    res.json({ success: false });
  }
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Live chat hub server listening on port ${PORT}`);
});
