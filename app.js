const socket = io('https://live-chat-hub.onrender.com'); // Changes automatically based on deployment URL
let streamSources = JSON.parse(localStorage.getItem('chatSources')) || [];
const chatTimeline = document.getElementById('chat-timeline');
const statusBanner = document.getElementById('status-banner');

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

// Initialize App Configuration
function init() {
  renderSourceCards();
  
  // Show source manager by default if no sources exist
  if (streamSources.length === 0) {
    sourcePanel.classList.remove('hidden');
    sourcePanel.classList.add('visible');
    managerToggleBtn.textContent = '✕ Close Sources';
  }
  
  // Connect existing storage instances back to your socket cluster on load
  streamSources.forEach((src) => {
    if (!src.isPaused) socket.emit('add-source', src);
  });
}

// Global Message Pipeline Catchment
socket.on('chat-message', (data) => {
  console.log('[FRONTEND INBOUND] Received chat message payload:', data);
  const currentConfig = streamSources.find((s) => s.id === data.sourceId);
  if (!currentConfig || currentConfig.isPaused) return;

  // Play notification sound if not muted
  if (!currentConfig.isMuted) {
    playNotificationSound();
  }

  // Trigger Text-To-Speech for unmuted system events
  if (data.isSystemAlert && !currentConfig.isMuted) {
    const announcement = new SpeechSynthesisUtterance(`${data.username}: ${data.message}`);
    window.speechSynthesis.speak(announcement);
  }

  renderMessageToTimeline(data);
});

// Socket error handler
socket.on('error', (err) => {
  console.error('Socket error:', err);
});

// UI Event Handlers
const sourcePanel = document.getElementById('source-manager-panel');
const managerToggleBtn = document.getElementById('manager-toggle-btn');
const closePanelBtn = document.getElementById('close-panel-btn');

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

// Platform selector dropdown
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

// Close dropdown when clicking outside
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

const platformIcons = {
  twitch: 'assets/twch_icon.png',
  youtube: 'assets/tube_icon.png',
  tiktok: 'assets/tktk_icon.png',
  facebook: 'assets/fb_icon.png',
  instagram: 'assets/ins_icon.png',
};

function renderMessageToTimeline(msg) {
  const item = document.createElement('div');
  item.className = `chat-message ${msg.isSystemAlert ? 'system-alert' : ''}`;

  const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const iconSrc = msg.iconUrl || platformIcons[msg.platform.toLowerCase()] || 'assets/twch_icon.png';

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
  chatTimeline.scrollTop = chatTimeline.scrollHeight; // Auto-scrolls timeline down natively
}

// Utility to prevent XSS attacks
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Interactive runtime control functions
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

init();
