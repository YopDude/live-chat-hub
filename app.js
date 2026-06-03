let ACTIVE_PROFILE = null;
let streamSources = JSON.parse(localStorage.getItem('chatSources')) || [];
let socket; 
let wakeLock = null; 

// Track all rendered unique message IDs globally on the page to prevent duplication on catchup
const renderedMessageIds = new Set();

// --- DOM ELEMENTS ---
const chatTimeline = document.getElementById('chat-timeline');
const statusBanner = document.getElementById('status-banner');
const sourcePanel = document.getElementById('source-manager-panel');
const managerToggleBtn = document.getElementById('manager-toggle-btn');
const closePanelBtn = document.getElementById('close-panel-btn');

// --- DYNAMIC PROFILE CONFIGURATIONS ---
const PROFILES = {
  shiho: {
    globalMuted: true, // Globally mutes all alert sounds
    sources: [
      { platform: 'youtube', target: 'shiho-tennyoza' },
      { platform: 'twitch',  target: 'shihoyabuki' },
      { platform: 'tiktok',  target: 'shihoyabuki' }
    ]
  },
  tester: {
    globalMuted: false, // Keep sound on so you can test audio notifications!
    sources: [
      { platform: 'twitch',  target: 'tharixer' },
      { platform: 'twitch',  target: 'gumi772' }
    ]
  }
};

// --------------------------------------------------
// PROFILE ACCESS CONTROL
// --------------------------------------------------
const PROFILE_HASHES = {
  '3c1bf06375a231a024e02ff86402e14dbfc91298a86178e197ceb4ae3630fef0': 'shiho',
  '94ba85a49d1e443153077af8db2572562fb80bf61ee6010d867c2957b45f956c': 'tester'
};

const urlParams = new URLSearchParams(window.location.search);
const suppliedProfile = urlParams.get('p')?.toLowerCase() || '';

async function sha256(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);

  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function initializeProfile() {
  const suppliedHash = await sha256(suppliedProfile);
  const matchedProfileKey = PROFILE_HASHES[suppliedHash];

  if (!matchedProfileKey) {
    document.body.innerHTML = `
      <div style="display:flex;justify-content:center;align-items:center;height:100vh;font-size:2rem;font-family:sans-serif;background-color:#1a202c;color:#e2e8f0;">
        404 Not Found
      </div>
    `;
    return false;
  }

  ACTIVE_PROFILE = PROFILES[matchedProfileKey];
  console.log(`[PROFILE ACTIVATED] Loading profile: ${matchedProfileKey}`);

  // Establish connection with built-in robust reconnection attempts configured
  socket = io('https://live-chat-hub.onrender.com', {
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000
  }); 

  setupSocketListeners();
  setupMobileKeepAlive(); // Initialize iPad wake lock and background event listeners

  if (streamSources.length === 0) {
    streamSources = ACTIVE_PROFILE.sources.map((src, index) => ({
      id: `profile-preset-${index}`,
      platform: src.platform,
      target: src.target,
      isPaused: false,
      isMuted: ACTIVE_PROFILE.globalMuted
    }));
    localStorage.setItem('chatSources', JSON.stringify(streamSources));
  }

  return true;
}

function setupSocketListeners() {
  socket.on('chat-message', (data) => {
    console.log('[FRONTEND INBOUND] Received chat message payload:', data);
    const currentConfig = streamSources.find((s) => s.id === data.sourceId);
    if (!currentConfig || currentConfig.isPaused) return;

    // Cache real-time message ID to prevent duplicates later
    if (data && data.id) {
      renderedMessageIds.add(data.id);
    }

    const isGloballyMuted = ACTIVE_PROFILE && ACTIVE_PROFILE.globalMuted;
    if (!isGloballyMuted && !currentConfig.isMuted) {
      playNotificationSound();
    }

    renderMessageToTimeline(data);
  });

  socket.on('connect', () => {
    console.log('Connected to server');
    showStatus('Connected to server ✓', 'info');
  });

  socket.on('disconnect', (reason) => {
    console.log('Disconnected from server:', reason);
    if (reason === 'io server disconnect') {
      showStatus('Connection dropped by server. Retrying...', 'error');
      socket.connect();
    } else {
      showStatus('Connection lost. Reconnecting...', 'error');
    }
  });

  socket.on('connect_error', (err) => {
    console.error('Connection error:', err);
    showStatus('Reconnecting to live stream...', 'info');
  });
}

// --- IPAD KEEPALIVE & AUTOMATED HISTORICAL BACKFILL ENGINE ---
function setupMobileKeepAlive() {
  async function requestWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        wakeLock = await navigator.wakeLock.request('screen');
        console.log('[Wake Lock] Screen kept active successfully.');
      } catch (err) {
        console.warn(`[Wake Lock] Activation skipped: ${err.message}`);
      }
    }
  }

  // Initial execution block
  requestWakeLock();

  // Watch for the iPad waking up or navigating back onto the tab layout
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
      console.log('[Visibility] iPad woke up. Initiating data restoration routine...');
      
      requestWakeLock(); // Renew screen wake-lock session

      // 1. Force the active socket out of any latent/frozen state
      if (!socket || !socket.connected) {
        console.log('[Visibility] Stale socket detected. Forcing reconnection...');
        showStatus('Restoring socket connection...', 'info');
        socket.connect();
      }

      // 2. Fetch the latest 50 messages from the backend history buffer
      try {
        const response = await fetch('https://live-chat-hub.onrender.com/api/history');
        const data = await response.json();

        if (data && data.success && Array.isArray(data.history)) {
          let backfilledCount = 0;

          data.history.forEach((msg) => {
            // Verify if source is currently added and unpaused
            const currentConfig = streamSources.find((s) => s.id === msg.sourceId);
            if (!currentConfig || currentConfig.isPaused) return;

            // Skip rendering if this message is already on the iPad display
            if (renderedMessageIds.has(msg.id)) return;

            // Register and render the missing item
            renderedMessageIds.add(msg.id);
            renderMessageToTimeline(msg);
            backfilledCount++;
          });

          if (backfilledCount > 0) {
            showStatus(`Successfully backfilled ${backfilledCount} missed chats ✓`, 'info');
          }
        }
      } catch (err) {
        console.error('[History Sync] Catch-up log sync request failed:', err);
      }
    }
  });
}

// --- CORE APPLICATION UTILITIES ---

function showStatus(message, type = 'info') {
  statusBanner.textContent = message;
  statusBanner.className = `status-banner ${type}`;
  statusBanner.classList.remove('hidden');
  window.clearTimeout(showStatus.timeoutId);
  showStatus.timeoutId = window.setTimeout(() => {
    statusBanner.classList.add('hidden');
  }, 5000);
}

function playNotificationSound() {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 800;
    oscillator.type = 'sine';

    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.1);
  } catch (err) {
    console.log('Audio context not available:', err);
  }
}

function init() {
  renderSourceCards();
  
  if (streamSources.length === 0) {
    sourcePanel.classList.remove('hidden');
    sourcePanel.classList.add('visible');
    managerToggleBtn.textContent = '✕ Close Sources';
  }
  
  streamSources.forEach((src) => {
    if (!src.isPaused) socket.emit('add-source', src);
  });
}

// --- UI EVENT HANDLERS & MANAGEMENT ---

function toggleSourcePanel() {
  sourcePanel.classList.toggle('hidden');
  sourcePanel.classList.toggle('visible');
  const isOpen = sourcePanel.classList.contains('visible');
  managerToggleBtn.textContent = isOpen ? '✕ Close Sources' : '⚙️ Manage Sources';
}

managerToggleBtn.addEventListener('click', toggleSourcePanel);
if (closePanelBtn) {
  closePanelBtn.addEventListener('click', toggleSourcePanel);
}

document.getElementById('add-btn').addEventListener('click', () => {
  const platform = window.selectedPlatform || 'twitch';
  const target = document.getElementById('target-input').value.trim();
  if (!target) {
    alert('Please enter a target channel or URL');
    return;
  }

  const newSource = {
    id: crypto.randomUUID(),
    platform,
    target,
    isPaused: false,
    isMuted: false,
  };

  socket.emit('add-source', newSource, (response) => {
    if (!response || !response.success) {
      const message = response?.error || 'Unable to add source.';
      showStatus(`Source error: ${message}`, 'error');
      return;
    }

    const storedSource = {
      ...newSource,
      target: response.source.target,
    };

    streamSources.push(storedSource);
    localStorage.setItem('chatSources', JSON.stringify(streamSources));
    renderSourceCards();
    document.getElementById('target-input').value = '';
    showStatus(`Added ${platform} source: ${storedSource.target}`, 'info');
  });
});

window.selectedPlatform = 'twitch';
const platformToggleBtn = document.getElementById('platform-toggle-btn');
const platformDropdown = document.getElementById('platform-dropdown');
const platformOptions = document.querySelectorAll('.platform-option');
const platformLabelPreview = document.getElementById('platform-label-preview');
const platformIconPreview = document.getElementById('platform-icon-preview');

const platformIcons = {
  twitch: 'assets/twch_icon.png',
  youtube: 'assets/tube_icon.png',
  tiktok: 'assets/tktk_icon.png',
  facebook: 'assets/fb_icon.png',
  instagram: 'assets/ins_icon.png',
};

const platformLabels = {
  twitch: 'Twitch',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  facebook: 'Facebook',
  instagram: 'Instagram',
};

platformToggleBtn.addEventListener('click', () => {
  platformDropdown.classList.toggle('hidden');
});

platformOptions.forEach((option) => {
  option.addEventListener('click', () => {
    const platform = option.dataset.platform;
    window.selectedPlatform = platform;
    platformLabelPreview.textContent = platformLabels[platform];
    platformIconPreview.src = platformIcons[platform];
    platformDropdown.classList.add('hidden');
  });
});

document.addEventListener('click', (e) => {
  if (!platformToggleBtn.contains(e.target) && !platformDropdown.contains(e.target)) {
    platformDropdown.classList.add('hidden');
  }
});

function renderSourceCards() {
  const container = document.getElementById('active-sources-list');
  container.innerHTML = '';

  if (streamSources.length === 0) {
    container.innerHTML = '<div style="padding: 2rem; text-align: center; color: rgba(226, 232, 240, 0.5);">No sources added yet</div>';
    return;
  }

  streamSources.forEach((src) => {
    const card = document.createElement('div');
    card.className = `source-card ${src.isPaused ? 'paused' : ''}`;
    card.innerHTML = `
      <div class="source-info">
        <div class="platform">${src.platform}</div>
        <div class="target">${src.target}</div>
      </div>
      <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; justify-content: flex-end;">
        <button class="action-btn" style="font-size: 0.85rem; padding: 0.4rem 0.75rem;" onclick="togglePause('${src.id}')">${src.isPaused ? '▶️' : '⏸️'}</button>
        <button class="action-btn" style="font-size: 0.85rem; padding: 0.4rem 0.75rem;" onclick="toggleMute('${src.id}')">${src.isMuted ? '🔊' : '🔇'}</button>
        <button class="remove-btn" onclick="removeSource('${src.id}')">Remove</button>
      </div>
    `;
    container.appendChild(card);
  });
}

function parseTwitchEmotes(message, emotesObj) {
  if (!emotesObj || typeof emotesObj !== 'object' || Object.keys(emotesObj).length === 0) {
    return escapeHtml(message);
  }

  const replacements = [];
  for (const [emoteId, positions] of Object.entries(emotesObj)) {
    if (Array.isArray(positions)) {
      for (const posRange of positions) {
        const [start, end] = posRange.split('-').map(Number);
        replacements.push({
          start,
          end: end + 1, 
          emoteId,
          text: message.substring(start, end + 1),
        });
      }
    }
  }

  replacements.sort((a, b) => b.start - a.start);

  let lastIdx = message.length;
  let htmlParts = [];

  for (const replacement of replacements) {
    if (replacement.end < lastIdx) {
      htmlParts.unshift(escapeHtml(message.substring(replacement.end, lastIdx)));
    }
    const emoteUrl = `https://static-cdn.jtvnw.net/emoticons/v2/${replacement.emoteId}/default/dark/1.0`;
    const emoteHtml = `<img src="${emoteUrl}" alt="${escapeHtml(replacement.text)}" class="twitch-emote" title="${escapeHtml(replacement.text)}" loading="lazy">`;
    htmlParts.unshift(emoteHtml);
    lastIdx = replacement.start;
  }

  if (lastIdx > 0) {
    htmlParts.unshift(escapeHtml(message.substring(0, lastIdx)));
  }

  return htmlParts.join('');
}

function renderMessageToTimeline(msg) {
  const item = document.createElement('div');
  item.className = `chat-message ${msg.isSystemAlert ? 'system-alert' : ''}`;

  const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const iconSrc = msg.iconUrl || platformIcons[msg.platform.toLowerCase()] || 'assets/twch_icon.png';

  if (msg.platform === 'twitch') {
    const messageHtml = parseTwitchEmotes(msg.message, msg.emotes);
    item.innerHTML = `
      <img src="${iconSrc}" class="platform-icon" alt="${msg.platform}">
      <div class="chat-content">
        <div class="chat-header">
          <span class="chat-username">${escapeHtml(msg.username)}</span>
          <span class="chat-platform">${escapeHtml(msg.platform)}</span>
          <span class="chat-timestamp">${time}</span>
        </div>
        <div class="chat-text">${messageHtml}</div>
      </div>
    `;
    chatTimeline.appendChild(item);
    chatTimeline.scrollTop = chatTimeline.scrollHeight;
    return;
  }
  
  if (msg.platform === 'youtube') {
    let messageHtml = escapeHtml(msg.message);
    
    if (msg.emotes && Array.isArray(msg.emotes)) {
      const sortedEmotes = [...msg.emotes].sort((a, b) => b.text.length - a.text.length);
      
      sortedEmotes.forEach(emote => {
        const escapedShortcode = escapeHtml(emote.text);
        const emoteHtml = `<img src="${emote.url}" alt="${escapedShortcode}" class="youtube-emote" title="${escapedShortcode}" style="height: 24px; vertical-align: middle; display: inline-block; margin: 0 2px;" loading="lazy">`;
        messageHtml = messageHtml.split(escapedShortcode).join(emoteHtml);
      });
    }

    item.innerHTML = `
      <img src="${iconSrc}" class="platform-icon" alt="${msg.platform}">
      <div class="chat-content">
        <div class="chat-header">
          <span class="chat-username">${escapeHtml(msg.username)}</span>
          <span class="chat-platform">${escapeHtml(msg.platform)}</span>
          <span class="chat-timestamp">${time}</span>
        </div>
        <div class="chat-text">${messageHtml}</div>
      </div>
    `;
    chatTimeline.appendChild(item);
    chatTimeline.scrollTop = chatTimeline.scrollHeight;
    return;
  }
  
  item.innerHTML = `
    <img src="${iconSrc}" class="platform-icon" alt="${msg.platform}">
    <div class="chat-content">
      <div class="chat-header">
        <span class="chat-username">${escapeHtml(msg.username)}</span>
        <span class="chat-platform">${escapeHtml(msg.platform)}</span>
        <span class="chat-timestamp">${time}</span>
      </div>
      <div class="chat-text">${escapeHtml(msg.message)}</div>
    </div>
  `;

  chatTimeline.appendChild(item);
  chatTimeline.scrollTop = chatTimeline.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

window.togglePause = (id) => {
  const src = streamSources.find((s) => s.id === id);
  if (!src) return;

  src.isPaused = !src.isPaused;
  localStorage.setItem('chatSources', JSON.stringify(streamSources));

  if (src.isPaused) {
    socket.emit('remove-source', { id: src.id });
  } else {
    socket.emit('add-source', src);
  }

  renderSourceCards();
};

window.toggleMute = (id) => {
  const src = streamSources.find((s) => s.id === id);
  if (!src) return;

  src.isMuted = !src.isMuted;
  localStorage.setItem('chatSources', JSON.stringify(streamSources));
  renderSourceCards();
};

window.removeSource = (id) => {
  const idx = streamSources.findIndex((s) => s.id === id);
  if (idx > -1) {
    socket.emit('remove-source', { id: streamSources[idx].id });
    streamSources.splice(idx, 1);
    localStorage.setItem('chatSources', JSON.stringify(streamSources));
    renderSourceCards();
  }
};

document.addEventListener('DOMContentLoaded', () => {
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    const body = document.body;
    const savedTheme = localStorage.getItem('theme');
    
    if (savedTheme === 'light') {
        body.classList.add('light-mode');
        themeToggleBtn.textContent = '🌙 Dark Mode';
    } else {
        body.classList.remove('light-mode');
        themeToggleBtn.textContent = '☀️ Light Mode';
    }

    themeToggleBtn.addEventListener('click', () => {
        body.classList.toggle('light-mode');
        if (body.classList.contains('light-mode')) {
            themeToggleBtn.textContent = '🌙 Dark Mode';
            localStorage.setItem('theme', 'light');
        } else {
            themeToggleBtn.textContent = '☀️ Light Mode';
            localStorage.setItem('theme', 'dark');
        }
    });
});

initializeProfile().then((allowed) => {
  if (allowed) {
    init();
  }
});