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
const io = new Server(server);

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

  socket.on('add-source', ({ id, platform, target }) => {
    if (!id || !platform || !target) {
      socket.emit('error', { message: 'add-source requires id, platform, and target.' });
      return;
    }

    const ProviderClass = providerClasses[platform.toLowerCase()];
    if (!ProviderClass) {
      socket.emit('error', { message: `Unsupported platform: ${platform}` });
      return;
    }

    stopSource(id);

    const provider = new ProviderClass(target, (message) => {
      socket.emit('chat-message', {
        sourceId: id,
        platform,
        target,
        message,
      });
    });

    activeSources.set(id, provider);
    provider.start();
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
