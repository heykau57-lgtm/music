// app.js
const PROXY_URL = CONFIG.PROXY_URL;
const MAX_RESULTS = CONFIG.MAX_RESULTS || 20;
const PLAYLIST_KEY = 'waie_playlist';

let currentTrack = null;
let queue = [];
let queueIndex = -1;
let ytPlayer = null;
let playerReady = false;
let progressInterval = null;
let shuffleMode = false;
let repeatMode = false;
let playlist = [];
let playingFromPlaylist = false;

// SVG icons (inline)
const ICONS = {
  play: '<svg viewBox="0 0 24 24" style="fill:currentColor;stroke:none;"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
  pause: '<svg viewBox="0 0 24 24" style="fill:currentColor;stroke:none;"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
  check: '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>',
  warning: '<svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  music: '<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>'
};

// ============ PLAYLIST STORAGE ============
function loadPlaylist() {
  try {
    const raw = localStorage.getItem(PLAYLIST_KEY);
    playlist = raw ? JSON.parse(raw) : [];
  } catch { playlist = []; }
  updatePlaylistBadge();
}

function savePlaylist() {
  try { localStorage.setItem(PLAYLIST_KEY, JSON.stringify(playlist)); } catch {}
  updatePlaylistBadge();
}

function isInPlaylist(id) {
  return playlist.some(t => t.id === id);
}

function toggleSave(id) {
  if (isInPlaylist(id)) {
    playlist = playlist.filter(t => t.id !== id);
    showToast('Dibuang dari playlist', false, 'trash');
  } else {
    const track = queue.find(t => t.id === id);
    if (!track) return;
    playlist.unshift(track);
    showToast('Ditambah ke playlist', false, 'heart');
  }
  savePlaylist();
  renderPlaylist();
  refreshSaveButtons();
}

function refreshSaveButtons() {
  document.querySelectorAll('.track-btn.save').forEach(btn => {
    const id = btn.dataset.id;
    const saved = isInPlaylist(id);
    btn.classList.toggle('saved', saved);
    const svg = btn.querySelector('svg');
    if (svg) svg.setAttribute('fill', saved ? 'currentColor' : 'none');
  });
}

function updatePlaylistBadge() {
  const badge = document.getElementById('playlistBadge');
  if (!badge) return;
  badge.textContent = playlist.length;
  badge.classList.toggle('show', playlist.length > 0);
}

// ============ RENDER ============
function renderPlaylist() {
  const el = document.getElementById('playlistResults');
  if (!el) return;

  if (!playlist.length) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${ICONS.heart}</div>
        <p>Playlist masih kosong</p>
      </div>`;
    return;
  }

  el.innerHTML = playlist.map((item, idx) => `
    <div class="track" data-id="${item.id}">
      <img class="track-thumb" src="${item.thumbnail}" loading="lazy" onclick="playFromPlaylist(${idx})">
      <div class="track-info" onclick="playFromPlaylist(${idx})">
        <div class="track-title">${escapeHtml(item.title)}</div>
        <div class="track-channel">${escapeHtml(item.channel)}</div>
      </div>
      <div class="track-actions">
        <button class="track-btn play" onclick="playFromPlaylist(${idx})">${ICONS.play}</button>
        <button class="track-btn remove" onclick="removeFromPlaylist('${item.id}')">${ICONS.trash}</button>
      </div>
    </div>`).join('');
}

function removeFromPlaylist(id) {
  playlist = playlist.filter(t => t.id !== id);
  savePlaylist();
  renderPlaylist();
  refreshSaveButtons();
  showToast('Dibuang dari playlist', false, 'trash');
}

function playFromPlaylist(idx) {
  playingFromPlaylist = true;
  queue = playlist.slice();
  playTrack(idx);
}

// ============ YOUTUBE PLAYER ============
const tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
document.head.appendChild(tag);

window.onYouTubeIframeAPIReady = function () {
  ytPlayer = new YT.Player('ytPlayer', {
    height: '1', width: '1',
    playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, modestbranding: 1, playsinline: 1 },
    events: {
      onReady: () => { playerReady = true; },
      onStateChange: onPlayerStateChange
    }
  });
};

function onPlayerStateChange(e) {
  const icon = document.getElementById('playIcon');
  if (!icon) return;
  if (e.data === YT.PlayerState.PLAYING) {
    icon.outerHTML = ICONS.pause.replace('<svg', '<svg id="playIcon"');
    startProgress();
  } else if (e.data === YT.PlayerState.PAUSED) {
    icon.outerHTML = ICONS.play.replace('<svg', '<svg id="playIcon"');
    stopProgress();
  } else if (e.data === YT.PlayerState.ENDED) {
    stopProgress();
    if (repeatMode) { ytPlayer.seekTo(0); ytPlayer.playVideo(); }
    else nextTrack();
  }
}

// ============ SEARCH ============
let searchTimer;
document.getElementById('searchInput').addEventListener('input', function () {
  const q = this.value.trim();
  document.getElementById('clearBtn').classList.toggle('show', q.length > 0);
  clearTimeout(searchTimer);
  if (q.length >= 2) searchTimer = setTimeout(search, 500);
});

document.getElementById('searchInput').addEventListener('keypress', e => {
  if (e.key === 'Enter') search();
});

function clearSearch() {
  document.getElementById('searchInput').value = '';
  document.getElementById('clearBtn').classList.remove('show');
  document.getElementById('results').innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">${ICONS.music}</div>
      <p>Cari lagu buat mulai</p>
    </div>`;
}

async function search() {
  const q = document.getElementById('searchInput').value.trim();
  if (!q) return;

  const results = document.getElementById('results');
  results.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Mencari...</p></div>';

  try {
    const url = PROXY_URL + '/?q=' + encodeURIComponent(q);
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      results.innerHTML = `<div class="empty-state"><p>Error: ${data.error.message || data.error}</p></div>`;
      return;
    }
    if (!data.items || !data.items.length) {
      results.innerHTML = '<div class="empty-state"><p>Tiada hasil</p></div>';
      return;
    }

    queue = data.items.map(item => ({
      id: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails.medium ? item.snippet.thumbnails.medium.url : item.snippet.thumbnails.default.url
    }));

    playingFromPlaylist = false;

    results.innerHTML = queue.map((item, idx) => {
      const saved = isInPlaylist(item.id);
      return `
      <div class="track" id="track-${idx}" data-id="${item.id}">
        <img class="track-thumb" src="${item.thumbnail}" loading="lazy" onclick="playTrack(${idx})">
        <div class="track-info" onclick="playTrack(${idx})">
          <div class="track-title">${escapeHtml(item.title)}</div>
          <div class="track-channel">${escapeHtml(item.channel)}</div>
        </div>
        <div class="track-actions">
          <button class="track-btn save ${saved ? 'saved' : ''}" data-id="${item.id}" onclick="toggleSave('${item.id}')">
            <svg viewBox="0 0 24 24" fill="${saved ? 'currentColor' : 'none'}"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          </button>
          <button class="track-btn play" onclick="playTrack(${idx})">${ICONS.play}</button>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    results.innerHTML = `<div class="empty-state"><p>Error: ${e.message}</p></div>`;
  }
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ============ PLAYER ============
function playTrack(idx) {
  if (!playerReady) { showToast('Player belum ready', true, 'warning'); return; }
  queueIndex = idx;
  currentTrack = queue[idx];

  document.querySelectorAll('.track').forEach(t => {
    t.classList.toggle('playing', t.dataset.id === currentTrack.id);
  });

  document.getElementById('playerThumb').src = currentTrack.thumbnail;
  document.getElementById('playerTitle').textContent = currentTrack.title;
  document.getElementById('playerChannel').textContent = currentTrack.channel;
  document.getElementById('playerBar').classList.add('show');

  ytPlayer.loadVideoById(currentTrack.id);
  showToast('Memutar: ' + currentTrack.title.substring(0, 30) + '...', false, 'play');
}

function togglePlay() {
  if (!ytPlayer || !playerReady) return;
  const s = ytPlayer.getPlayerState();
  s === YT.PlayerState.PLAYING ? ytPlayer.pauseVideo() : ytPlayer.playVideo();
}

function nextTrack() {
  if (!queue.length) return;
  queueIndex = shuffleMode ? Math.floor(Math.random() * queue.length) : (queueIndex + 1) % queue.length;
  playTrack(queueIndex);
}

function prevTrack() {
  if (!queue.length) return;
  queueIndex = (queueIndex - 1 + queue.length) % queue.length;
  playTrack(queueIndex);
}

function shuffleToggle() {
  shuffleMode = !shuffleMode;
  document.getElementById('shuffleBtn').classList.toggle('active', shuffleMode);
  showToast(shuffleMode ? 'Shuffle ON' : 'Shuffle OFF');
}

function repeatToggle() {
  repeatMode = !repeatMode;
  document.getElementById('repeatBtn').classList.toggle('active', repeatMode);
  showToast(repeatMode ? 'Repeat ON' : 'Repeat OFF');
}

function startProgress() {
  stopProgress();
  progressInterval = setInterval(() => {
    if (!ytPlayer || !playerReady) return;
    const cur = ytPlayer.getCurrentTime() || 0;
    const dur = ytPlayer.getDuration() || 0;
    if (dur > 0) {
      document.getElementById('progressFill').style.width = (cur / dur * 100) + '%';
      document.getElementById('currentTime').textContent = fmt(cur);
      document.getElementById('duration').textContent = fmt(dur);
    }
  }, 500);
}

function stopProgress() { if (progressInterval) clearInterval(progressInterval); }

function fmt(s) {
  s = Math.floor(s);
  return Math.floor(s / 60) + ':' + (s % 60).toString().padStart(2, '0');
}

function seek(e) {
  if (!ytPlayer || !playerReady) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  ytPlayer.seekTo(pct * (ytPlayer.getDuration() || 0));
}

function showToast(msg, isErr, icon) {
  const t = document.getElementById('toast');
  const ic = icon && ICONS[icon] ? ICONS[icon] : '';
  t.innerHTML = ic + '<span>' + msg + '</span>';
  t.classList.toggle('error', !!isErr);
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2500);
}

// ============ BOTTOM NAV ============
function switchTab(el) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  el.classList.add('active');
  el.classList.remove('tapped');
  void el.offsetWidth;
  el.classList.add('tapped');

  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  const rect = el.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  ripple.style.width = ripple.style.height = size + 'px';
  ripple.style.left = (rect.width / 2 - size / 2) + 'px';
  ripple.style.top = (rect.height / 2 - size / 2) + 'px';
  el.appendChild(ripple);
  setTimeout(() => ripple.remove(), 600);

  const tab = el.dataset.tab;
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  const target = document.getElementById('tab-' + tab);
  if (target) target.classList.add('active');

  if (tab === 'playlist') renderPlaylist();
}

// ============ INIT ============
loadPlaylist();
renderPlaylist(); 
