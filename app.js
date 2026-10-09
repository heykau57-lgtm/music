// app.js
const PROXY_URL = CONFIG.PROXY_URL;
const MAX_RESULTS = CONFIG.MAX_RESULTS || 20;

let currentTrack = null;
let queue = [];
let queueIndex = -1;
let ytPlayer = null;
let playerReady = false;
let progressInterval = null;
let shuffleMode = false;
let repeatMode = false;

// Load YouTube IFrame API
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
    icon.outerHTML = '<svg id="playIcon" viewBox="0 0 24 24" style="fill:currentColor;stroke:none;"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
    startProgress();
  } else if (e.data === YT.PlayerState.PAUSED) {
    icon.outerHTML = '<svg id="playIcon" viewBox="0 0 24 24" style="fill:currentColor;stroke:none;"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
    stopProgress();
  } else if (e.data === YT.PlayerState.ENDED) {
    stopProgress();
    if (repeatMode) { ytPlayer.seekTo(0); ytPlayer.playVideo(); }
    else nextTrack();
  }
}

// Search
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
      <div class="empty-icon">♪</div>
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

    results.innerHTML = queue.map((item, idx) => `
      <div class="track" id="track-${idx}" onclick="playTrack(${idx})">
        <img class="track-thumb" src="${item.thumbnail}" loading="lazy">
        <div class="track-info">
          <div class="track-title">${escapeHtml(item.title)}</div>
          <div class="track-channel">${escapeHtml(item.channel)}</div>
        </div>
        <button class="track-play">
          <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </button>
      </div>`).join('');
  } catch (e) {
    results.innerHTML = `<div class="empty-state"><p>Error: ${e.message}</p></div>`;
  }
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function playTrack(idx) {
  if (!playerReady) { showToast('Player belum ready', true); return; }
  queueIndex = idx;
  currentTrack = queue[idx];

  document.querySelectorAll('.track').forEach((t, i) => t.classList.toggle('playing', i === idx));

  document.getElementById('playerThumb').src = currentTrack.thumbnail;
  document.getElementById('playerTitle').textContent = currentTrack.title;
  document.getElementById('playerChannel').textContent = currentTrack.channel;
  document.getElementById('playerBar').classList.add('show');

  ytPlayer.loadVideoById(currentTrack.id);
  showToast('▶ ' + currentTrack.title.substring(0, 30) + '...');
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

function showToast(msg, isErr) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('error', !!isErr);
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
                                   }
