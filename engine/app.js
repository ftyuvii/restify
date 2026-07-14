const STORAGE_KEY = 'restify_state_v1';
const FALLBACK_COVER = 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&q=80';
const SPEED_STEPS = [0.75, 1, 1.25, 1.5, 2];

const SUPABASE_URL = 'https://pcpisivrddvhdvstwluq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_1c9xNU7i4yVfFzc1OvksUQ_xuDY5-y3';
const SONGS_BUCKET = 'songs';
const COVERS_BUCKET = 'covers';
const SUPABASE_REFRESH_MS = 45000;

const supabaseClient = (typeof window.supabase !== 'undefined')
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

function stripExtension(filename){
  return filename.replace(/\.[^/.]+$/, '');
}

function baseKey(filename){
  return stripExtension(filename).toLowerCase().trim();
}

function parseSongMeta(filename){
  const base = stripExtension(filename);
  const parts = base.split(' - ');
  if (parts.length >= 2) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  }
  return { artist: 'Unknown Artist', title: base.replace(/[_-]+/g, ' ').trim() };
}

async function fetchSupabaseAlbum(){
  if (!supabaseClient) return null;
  try {
    const [songsRes, coversRes] = await Promise.all([
      supabaseClient.storage.from(SONGS_BUCKET).list('', { limit: 1000, sortBy: { column: 'created_at', order: 'desc' } }),
      supabaseClient.storage.from(COVERS_BUCKET).list('', { limit: 1000 })
    ]);

    if (songsRes.error) throw songsRes.error;

    const coverMap = {};
    (coversRes.data || []).forEach(f => {
      if (!f.name || f.name.endsWith('/')) return;
      coverMap[baseKey(f.name)] = supabaseClient.storage.from(COVERS_BUCKET).getPublicUrl(f.name).data.publicUrl;
    });

    const songFiles = (songsRes.data || []).filter(f => f.name && f.name.toLowerCase().endsWith('.mp3'));
    if (!songFiles.length) return null;

    const songs = songFiles.map((f, idx) => {
      const meta = parseSongMeta(f.name);
      const fileUrl = supabaseClient.storage.from(SONGS_BUCKET).getPublicUrl(f.name).data.publicUrl;
      const cover = coverMap[baseKey(f.name)] || FALLBACK_COVER;
      return {
        id: 'sb_' + baseKey(f.name).replace(/[^a-z0-9]+/g, '_'),
        title: meta.title,
        artist: meta.artist,
        cover,
        file: fileUrl,
        trending: idx < 5
      };
    });

    return {
      id: 'supabase-live',
      title: 'Fresh Uploads',
      cover: songs[0].cover,
      songs
    };
  } catch (err) {
    console.error('Supabase library fetch failed', err);
    return null;
  }
}

function mergeLibrary(staticLibrary, supabaseAlbum){
  const base = Array.isArray(staticLibrary) ? staticLibrary : [];
  return supabaseAlbum ? [supabaseAlbum, ...base] : base;
}

function publishLibrary(){
  window.RestifyLibrary = library;
  window.dispatchEvent(new CustomEvent('restify-data-ready'));
}

let library = [];
let currentAlbumIndex = -1;
let currentSongIndex = -1;
let isShuffle = false;
let isRepeat = false;
let loadToken = 0;
let stack = ['view-home'];
let activePlaylistId = null;
let speedIndex = 1;
let sheetActionSong = null;

const state = loadState();

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error('empty');
    const parsed = JSON.parse(raw);
    return {
      liked: Array.isArray(parsed.liked) ? parsed.liked : [],
      recent: Array.isArray(parsed.recent) ? parsed.recent : [],
      playlists: Array.isArray(parsed.playlists) ? parsed.playlists : [],
      queue: Array.isArray(parsed.queue) ? parsed.queue : [],
      volume: typeof parsed.volume === 'number' ? parsed.volume : 0.85
    };
  }catch(e){
    return { liked: [], recent: [], playlists: [], queue: [], volume: 0.85 };
  }
}

function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

const audio = document.getElementById('audio');

const els = {
  loader: document.getElementById('loader'),

  albumsGrid: document.getElementById('albums-grid'),
  albumsSkeleton: document.getElementById('albums-skeleton'),
  searchInput: document.getElementById('search-input'),
  suggestPanel: document.getElementById('suggest-panel'),
  featureBtn: document.getElementById('feature-btn'),
  libraryHeaderBtn: document.getElementById('library-header-btn'),
  recentRail: document.getElementById('recent-rail'),
  recentSection: document.getElementById('recent-section'),
  trendingRail: document.getElementById('trending-rail'),
  recommendedRail: document.getElementById('recommended-rail'),

  albumBack: document.getElementById('album-back'),
  albumHeroImg: document.getElementById('album-hero-img'),
  albumHeroTitle: document.getElementById('album-hero-title'),
  albumHeroSub: document.getElementById('album-hero-sub'),
  albumPlayAll: document.getElementById('album-play-all'),
  albumShuffleAll: document.getElementById('album-shuffle-all'),
  songList: document.getElementById('song-list'),

  libraryBack: document.getElementById('library-back'),
  likedRow: document.getElementById('liked-row'),
  likedCount: document.getElementById('liked-count'),
  playlistList: document.getElementById('playlist-list'),
  createPlaylistBtn: document.getElementById('create-playlist-btn'),

  playlistBack: document.getElementById('playlist-back'),
  playlistTitle: document.getElementById('playlist-view-title'),
  playlistHeroTitle: document.getElementById('playlist-hero-title'),
  playlistHeroSub: document.getElementById('playlist-hero-sub'),
  playlistSongList: document.getElementById('playlist-song-list'),
  playlistDeleteBtn: document.getElementById('playlist-delete-btn'),

  playerBack: document.getElementById('player-back'),
  exploreBtn: document.getElementById('explore-albums-btn'),
  queueOpenBtn: document.getElementById('queue-open-btn'),
  artworkFrame: document.getElementById('artwork-frame'),
  playerArtwork: document.getElementById('player-artwork'),
  playerTitle: document.getElementById('player-title'),
  playerArtist: document.getElementById('player-artist'),
  favBtn: document.getElementById('fav-btn'),
  seekSlider: document.getElementById('seek-slider'),
  rangeFill: document.getElementById('range-fill'),
  timeCurrent: document.getElementById('time-current'),
  timeTotal: document.getElementById('time-total'),
  btnShuffle: document.getElementById('btn-shuffle'),
  btnPrev: document.getElementById('btn-prev'),
  btnPlay: document.getElementById('btn-play'),
  btnNext: document.getElementById('btn-next'),
  btnRepeat: document.getElementById('btn-repeat'),
  volumeSlider: document.getElementById('volume-slider'),
  volumeFill: document.getElementById('volume-fill'),
  volumeIconBtn: document.getElementById('volume-icon-btn'),
  speedBtn: document.getElementById('speed-btn'),

  miniPlayer: document.getElementById('mini-player'),
  miniProgressFill: document.getElementById('mini-progress-fill'),
  miniThumb: document.getElementById('mini-thumb'),
  miniInfoTap: document.getElementById('mini-info-tap'),
  miniTitle: document.getElementById('mini-title'),
  miniArtist: document.getElementById('mini-artist'),
  miniPrev: document.getElementById('mini-prev'),
  miniPlay: document.getElementById('mini-play'),
  miniNext: document.getElementById('mini-next'),

  overlay: document.getElementById('overlay'),
  queueSheet: document.getElementById('queue-sheet'),
  queueList: document.getElementById('queue-list'),
  actionSheet: document.getElementById('action-sheet'),
  actionSheetTitle: document.getElementById('action-sheet-title'),
  actionLike: document.getElementById('action-like'),
  actionLikeLabel: document.getElementById('action-like-label'),
  actionQueue: document.getElementById('action-queue'),
  actionPlaylistList: document.getElementById('action-playlist-list'),

  createModal: document.getElementById('create-modal'),
  createModalInput: document.getElementById('create-modal-input'),
  createModalCancel: document.getElementById('create-modal-cancel'),
  createModalConfirm: document.getElementById('create-modal-confirm'),

  toast: document.getElementById('toast')
};

window.addEventListener('DOMContentLoaded', () => {
  if (typeof lucide !== 'undefined') lucide.createIcons();

  audio.volume = state.volume;
  updateVolumeUI();

  showSkeletons(true);

  const staticLibrary = (typeof MUSIC_LIBRARY !== 'undefined' && Array.isArray(MUSIC_LIBRARY)) ? MUSIC_LIBRARY : [];
  library = staticLibrary;
  publishLibrary();

  fetchSupabaseAlbum().then(supabaseAlbum => {
    library = mergeLibrary(staticLibrary, supabaseAlbum);
    publishLibrary();
    showSkeletons(false);
    if (library.length) {
      renderAlbumsGrid(library);
      renderHomeRails();
    } else {
      els.albumsGrid.innerHTML = '<div class="no-results">No albums found.<br>Add some in music-data.js</div>';
    }
    bindEvents();
    els.loader.classList.add('hide');
    startSupabasePolling(staticLibrary);
  });

  initMediaSession();
  registerServiceWorker();
});

function startSupabasePolling(staticLibrary){
  setInterval(async () => {
    const supabaseAlbum = await fetchSupabaseAlbum();
    const existing = library.find(a => a.id === 'supabase-live');
    const existingIds = existing ? existing.songs.map(s => s.id).join(',') : '';
    const incomingIds = supabaseAlbum ? supabaseAlbum.songs.map(s => s.id).join(',') : '';
    if (existingIds === incomingIds) return;
    library = mergeLibrary(staticLibrary, supabaseAlbum);
    publishLibrary();
    if (!els.searchInput.value.trim()) renderAlbumsGrid(library);
    renderHomeRails();
  }, SUPABASE_REFRESH_MS);
}

function showSkeletons(show){
  els.albumsSkeleton.style.display = show ? 'grid' : 'none';
  els.albumsGrid.style.display = show ? 'none' : 'grid';
}

function applyPositions(fromId, toId, direction){
  const toEl = document.getElementById(toId);
  toEl.classList.remove('pos-left', 'pos-right');
  toEl.classList.add('pos-center');
  if (fromId && fromId !== toId) {
    const fromEl = document.getElementById(fromId);
    fromEl.classList.remove('pos-center');
    fromEl.classList.add(direction === 'push' ? 'pos-left' : 'pos-right');
  }
}

function pushView(targetId){
  const fromId = stack[stack.length - 1];
  if (fromId === targetId) return;
  stack.push(targetId);
  applyPositions(fromId, targetId, 'push');
}

function popView(){
  if (stack.length < 2) return;
  const fromId = stack.pop();
  const toId = stack[stack.length - 1];
  applyPositions(fromId, toId, 'pop');
}

function resetToHome(){
  const fromId = stack[stack.length - 1];
  if (fromId === 'view-home') return;
  stack = ['view-home'];
  applyPositions(fromId, 'view-home', 'pop');
  setTimeout(() => {
    ['view-album', 'view-player', 'view-library', 'view-playlist', 'view-frame'].forEach(id => {
      if (id === fromId) return;
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.remove('pos-left', 'pos-center');
      el.classList.add('pos-right');
    });
  }, 400);
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function findAlbumIndex(albumId){
  return library.findIndex(a => a.id === albumId);
}

function allSongsFlat(){
  const out = [];
  library.forEach((album, albumIdx) => {
    (album.songs || []).forEach((song, songIdx) => {
      out.push({ album, song, albumIdx, songIdx });
    });
  });
  return out;
}

function findTrackById(songId){
  return allSongsFlat().find(t => t.song.id === songId) || null;
}

function renderAlbumsGrid(albums){
  els.albumsGrid.innerHTML = '';
  if (!albums.length) {
    els.albumsGrid.innerHTML = '<div class="no-results">No matches found</div>';
    return;
  }
  albums.forEach(album => {
    const card = document.createElement('div');
    card.className = 'album-card';
    const cover = album.cover || FALLBACK_COVER;
    const count = (album.songs || []).length;
    card.innerHTML = `
      <img src="${cover}" alt="${escapeHtml(album.title)}" loading="lazy">
      <div class="card-shade"></div>
      <div class="card-count">${count} track${count !== 1 ? 's' : ''}</div>
      <div class="card-label">${escapeHtml(album.title)}</div>
    `;
    card.addEventListener('click', () => openAlbum(album.id));
    els.albumsGrid.appendChild(card);
  });
}

function renderHomeRails(){
  renderRecentRail();
  renderRail(els.trendingRail, allSongsFlat().filter(t => t.song.trending), true);
  const recommended = allSongsFlat()
    .filter(t => !t.song.trending)
    .sort(() => Math.random() - 0.5)
    .slice(0, 8);
  renderRail(els.recommendedRail, recommended, false);
}

function renderRecentRail(){
  const tracks = state.recent.map(id => findTrackById(id)).filter(Boolean).slice(0, 10);
  els.recentSection.style.display = tracks.length ? 'block' : 'none';
  renderRail(els.recentRail, tracks, false);
}

function renderRail(container, tracks, trendingBadge){
  container.innerHTML = '';
  if (!tracks.length) {
    container.innerHTML = '<div class="rail-empty">Nothing here yet</div>';
    return;
  }
  tracks.forEach(t => {
    const cover = t.song.cover || t.album.cover || FALLBACK_COVER;
    const card = document.createElement('div');
    card.className = 'rail-card' + (trendingBadge ? ' trending' : '');
    card.innerHTML = `
      <img src="${cover}" alt="${escapeHtml(t.song.title)}" loading="lazy">
      <div class="card-shade"></div>
      <div class="rail-label">${escapeHtml(t.song.title)}</div>
    `;
    card.addEventListener('click', () => playTrack(t.albumIdx, t.songIdx));
    container.appendChild(card);
  });
}

function openAlbum(albumId){
  const idx = findAlbumIndex(albumId);
  if (idx === -1) return;
  const album = library[idx];

  els.albumHeroImg.src = album.cover || FALLBACK_COVER;
  els.albumHeroTitle.textContent = album.title;
  const count = (album.songs || []).length;
  els.albumHeroSub.textContent = `${count} track${count !== 1 ? 's' : ''}`;

  renderSongList(els.songList, album.songs || [], (songIdx) => playTrack(idx, songIdx), idx);
  els.albumPlayAll.onclick = () => { if (album.songs && album.songs.length) playTrack(idx, 0); };
  els.albumShuffleAll.onclick = () => {
    if (!album.songs || !album.songs.length) return;
    isShuffle = true;
    els.btnShuffle.classList.add('active');
    playTrack(idx, Math.floor(Math.random() * album.songs.length));
  };

  pushView('view-album');
}

function renderSongList(container, songs, onPlay, albumIdx){
  container.innerHTML = '';
  if (!songs.length) {
    container.innerHTML = '<div class="empty-state">No songs here yet</div>';
    return;
  }
  songs.forEach((song, songIdx) => {
    const row = document.createElement('div');
    row.className = 'song-row';
    if (albumIdx !== undefined) row.id = `song-row-${albumIdx}-${songIdx}`;
    const thumb = song.cover || FALLBACK_COVER;
    row.innerHTML = `
      <div class="song-left">
        <span class="song-num">${songIdx + 1}</span>
        <img class="song-thumb" src="${thumb}" alt="">
        <div class="song-meta">
          <div class="song-title">${escapeHtml(song.title)}</div>
          <div class="song-artist">${escapeHtml(song.artist)}</div>
        </div>
      </div>
      <i data-lucide="volume-2" class="song-pulse"></i>
      <button class="song-more" data-song-id="${song.id}"><i data-lucide="more-vertical"></i></button>
    `;
    row.querySelector('.song-left').addEventListener('click', () => onPlay(songIdx));
    row.querySelector('.song-more').addEventListener('click', (e) => {
      e.stopPropagation();
      openActionSheet(song.id);
    });
    container.appendChild(row);
  });
  if (typeof lucide !== 'undefined') lucide.createIcons();
  syncPlayingRowHighlight();
}

function syncPlayingRowHighlight(){
  document.querySelectorAll('.song-row').forEach(r => r.classList.remove('is-playing'));
  if (currentAlbumIndex === -1 || currentSongIndex === -1) return;
  const activeRow = document.getElementById(`song-row-${currentAlbumIndex}-${currentSongIndex}`);
  if (activeRow) activeRow.classList.add('is-playing');
}

function openLibraryView(){
  els.likedCount.textContent = `${state.liked.length} song${state.liked.length !== 1 ? 's' : ''}`;
  renderPlaylistList();
  pushView('view-library');
}

function renderPlaylistList(){
  els.playlistList.innerHTML = '';
  if (!state.playlists.length) {
    els.playlistList.innerHTML = '<div class="empty-state">Create your first playlist</div>';
    return;
  }
  state.playlists.forEach(pl => {
    const row = document.createElement('div');
    row.className = 'library-row';
    row.innerHTML = `
      <div class="library-icon plain"><i data-lucide="list-music"></i></div>
      <div class="library-meta">
        <div class="library-name">${escapeHtml(pl.name)}</div>
        <div class="library-sub">${pl.songIds.length} song${pl.songIds.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="library-chevron"><i data-lucide="chevron-right"></i></div>
    `;
    row.addEventListener('click', () => openPlaylist(pl.id));
    els.playlistList.appendChild(row);
  });
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function openLikedSongs(){
  activePlaylistId = null;
  els.playlistTitle.textContent = 'Liked Songs';
  els.playlistHeroTitle.textContent = 'Liked Songs';
  els.playlistHeroSub.textContent = `${state.liked.length} song${state.liked.length !== 1 ? 's' : ''}`;
  els.playlistDeleteBtn.style.display = 'none';
  const tracks = state.liked.map(id => findTrackById(id)).filter(Boolean);
  renderPlaylistTracks(tracks);
  pushView('view-playlist');
}

function openPlaylist(playlistId){
  const pl = state.playlists.find(p => p.id === playlistId);
  if (!pl) return;
  activePlaylistId = playlistId;
  els.playlistTitle.textContent = pl.name;
  els.playlistHeroTitle.textContent = pl.name;
  els.playlistHeroSub.textContent = `${pl.songIds.length} song${pl.songIds.length !== 1 ? 's' : ''}`;
  els.playlistDeleteBtn.style.display = 'flex';
  const tracks = pl.songIds.map(id => findTrackById(id)).filter(Boolean);
  renderPlaylistTracks(tracks);
  pushView('view-playlist');
}

function renderPlaylistTracks(tracks){
  els.playlistSongList.innerHTML = '';
  if (!tracks.length) {
    els.playlistSongList.innerHTML = '<div class="empty-state">No songs added yet</div>';
    return;
  }
  const songs = tracks.map(t => t.song);
  renderSongList(els.playlistSongList, songs, (songIdx) => {
    const t = tracks[songIdx];
    playTrack(t.albumIdx, t.songIdx);
  });
}

function deleteActivePlaylist(){
  if (!activePlaylistId) return;
  state.playlists = state.playlists.filter(p => p.id !== activePlaylistId);
  saveState();
  activePlaylistId = null;
  popView();
  renderPlaylistList();
  showToast('Playlist deleted');
}

function playTrack(albumIdx, songIdx){
  const album = library[albumIdx];
  if (!album || !album.songs || !album.songs[songIdx]) return;
  const song = album.songs[songIdx];

  const token = ++loadToken;
  currentAlbumIndex = albumIdx;
  currentSongIndex = songIdx;

  setBuffering(true);

  updateNowPlayingUI(album, song);
  showMiniPlayer(true);
  syncPlayingRowHighlight();
  addToRecent(song.id);
  updateFavButtonUI();

  audio.pause();
  audio.currentTime = 0;
  audio.src = song.file;
  audio.playbackRate = SPEED_STEPS[speedIndex];
  audio.load();

  const onReady = () => {
    if (token !== loadToken) return;
    audio.removeEventListener('canplay', onReady);
    attemptPlay();
  };
  audio.addEventListener('canplay', onReady);

  updateSeekUI(0, 0);
  els.timeTotal.textContent = '0:00';
}

function attemptPlay(){
  const playPromise = audio.play();
  if (playPromise !== undefined) {
    playPromise
      .then(() => { setPlayingState(true); setBuffering(false); })
      .catch(() => { setPlayingState(false); setBuffering(false); });
  }
}

function togglePlayPause(){
  if (currentAlbumIndex === -1) {
    if (library.length && library[0].songs && library[0].songs.length) {
      playTrack(0, 0);
    }
    return;
  }
  if (audio.paused) {
    attemptPlay();
  } else {
    audio.pause();
    setPlayingState(false);
  }
}

function setBuffering(isBuffering){
  els.artworkFrame.classList.toggle('buffering', isBuffering);
}

function setPlayingState(isPlaying){
  const iconName = isPlaying ? 'pause' : 'play';
  els.btnPlay.classList.toggle('is-playing', isPlaying);
  els.artworkFrame.classList.toggle('playing', isPlaying);
  els.miniThumb.classList.toggle('spin', isPlaying);

  const playIconEl = document.getElementById('play-icon');
  const miniPlayIconEl = document.getElementById('mini-play-icon');
  if (playIconEl) playIconEl.setAttribute('data-lucide', iconName);
  if (miniPlayIconEl) miniPlayIconEl.setAttribute('data-lucide', iconName);
  if (typeof lucide !== 'undefined') lucide.createIcons();

  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }
}

function updateNowPlayingUI(album, song){
  const cover = song.cover || album.cover || FALLBACK_COVER;

  els.playerTitle.style.opacity = '0';
  els.playerArtist.style.opacity = '0';
  setTimeout(() => {
    els.playerTitle.textContent = song.title;
    els.playerArtist.textContent = song.artist;
    els.playerTitle.style.opacity = '1';
    els.playerArtist.style.opacity = '1';
    els.playerArtwork.src = cover;
  }, 120);

  els.miniTitle.textContent = song.title;
  els.miniArtist.textContent = song.artist;
  els.miniThumb.src = cover;

  updateMediaSessionMetadata(album, song, cover);
}

function updateMediaSessionMetadata(album, song, cover){
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: song.title,
    artist: song.artist,
    album: album.title,
    artwork: [
      { src: cover, sizes: '96x96', type: 'image/png' },
      { src: cover, sizes: '192x192', type: 'image/png' },
      { src: cover, sizes: '512x512', type: 'image/png' }
    ]
  });
}

function initMediaSession(){
  if (!('mediaSession' in navigator)) return;

  navigator.mediaSession.setActionHandler('play', () => attemptPlay());
  navigator.mediaSession.setActionHandler('pause', () => {
    audio.pause();
    setPlayingState(false);
  });
  navigator.mediaSession.setActionHandler('previoustrack', prevTrack);
  navigator.mediaSession.setActionHandler('nexttrack', nextTrack);
  navigator.mediaSession.setActionHandler('stop', () => {
    audio.pause();
    setPlayingState(false);
  });
  navigator.mediaSession.setActionHandler('seekbackward', (details) => {
    const skip = details.seekOffset || 10;
    audio.currentTime = Math.max(audio.currentTime - skip, 0);
  });
  navigator.mediaSession.setActionHandler('seekforward', (details) => {
    const skip = details.seekOffset || 10;
    audio.currentTime = Math.min(audio.currentTime + skip, audio.duration || audio.currentTime);
  });
  navigator.mediaSession.setActionHandler('seekto', (details) => {
    if (details.seekTime === undefined || !audio.duration) return;
    if (details.fastSeek && 'fastSeek' in audio) {
      audio.fastSeek(details.seekTime);
      return;
    }
    audio.currentTime = details.seekTime;
  });
}

function updateMediaSessionPosition(){
  if (!('mediaSession' in navigator) || !('setPositionState' in navigator.mediaSession)) return;
  if (isNaN(audio.duration) || !isFinite(audio.duration) || audio.duration <= 0) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: audio.duration,
      playbackRate: audio.playbackRate || 1,
      position: audio.currentTime
    });
  } catch (e) {}
}

function showMiniPlayer(show){
  els.miniPlayer.classList.toggle('visible', show);
}

function getNextFromQueue(){
  if (!state.queue.length) return null;
  const nextId = state.queue.shift();
  saveState();
  renderQueueSheet();
  return findTrackById(nextId);
}

function nextTrack(){
  if (currentAlbumIndex === -1) return;
  if (isRepeat) {
    audio.currentTime = 0;
    attemptPlay();
    return;
  }
  const queued = getNextFromQueue();
  if (queued) {
    playTrack(queued.albumIdx, queued.songIdx);
    return;
  }
  const album = library[currentAlbumIndex];
  const total = album.songs.length;
  let nextIdx;
  if (isShuffle && total > 1) {
    do { nextIdx = Math.floor(Math.random() * total); } while (nextIdx === currentSongIndex);
  } else {
    nextIdx = (currentSongIndex + 1) % total;
  }
  playTrack(currentAlbumIndex, nextIdx);
}

function prevTrack(){
  if (currentAlbumIndex === -1) return;
  if (audio.currentTime > 4) {
    audio.currentTime = 0;
    return;
  }
  const album = library[currentAlbumIndex];
  const total = album.songs.length;
  const prevIdx = (currentSongIndex - 1 + total) % total;
  playTrack(currentAlbumIndex, prevIdx);
}

audio.addEventListener('timeupdate', () => {
  if (isNaN(audio.duration) || !isFinite(audio.duration)) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  updateSeekUI(audio.currentTime, pct);
  updateMediaSessionPosition();
});
audio.addEventListener('loadedmetadata', () => {
  els.timeTotal.textContent = formatTime(audio.duration);
});
audio.addEventListener('waiting', () => setBuffering(true));
audio.addEventListener('playing', () => { setBuffering(false); setPlayingState(true); });
audio.addEventListener('pause', () => { if (!audio.ended) setPlayingState(false); });
audio.addEventListener('ended', () => { nextTrack(); });
audio.addEventListener('error', () => { setBuffering(false); });

function updateSeekUI(currentTime, pct){
  els.seekSlider.value = pct;
  els.rangeFill.style.width = pct + '%';
  els.timeCurrent.textContent = formatTime(currentTime);
  els.miniProgressFill.style.width = pct + '%';
}

function formatTime(seconds){
  if (isNaN(seconds) || !isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function updateFavButtonUI(){
  if (currentAlbumIndex === -1 || currentSongIndex === -1) {
    els.favBtn.classList.remove('active');
    return;
  }
  const song = library[currentAlbumIndex].songs[currentSongIndex];
  els.favBtn.classList.toggle('active', state.liked.includes(song.id));
}

function toggleLikeCurrent(){
  if (currentAlbumIndex === -1 || currentSongIndex === -1) return;
  const song = library[currentAlbumIndex].songs[currentSongIndex];
  toggleLike(song.id);
  updateFavButtonUI();
}

function toggleLike(songId){
  const i = state.liked.indexOf(songId);
  if (i === -1) {
    state.liked.push(songId);
    showToast('Added to Liked Songs');
  } else {
    state.liked.splice(i, 1);
    showToast('Removed from Liked Songs');
  }
  saveState();
  updateFavButtonUI();
}

function addToRecent(songId){
  state.recent = state.recent.filter(id => id !== songId);
  state.recent.unshift(songId);
  if (state.recent.length > 12) state.recent = state.recent.slice(0, 12);
  saveState();
  renderRecentRail();
}

function addToQueue(songId){
  state.queue.push(songId);
  saveState();
  renderQueueSheet();
  showToast('Added to queue');
}

function renderQueueSheet(){
  els.queueList.innerHTML = '';

  if (currentAlbumIndex !== -1) {
    const song = library[currentAlbumIndex].songs[currentSongIndex];
    els.queueList.innerHTML += `<div class="queue-now-label">Now Playing</div>`;
    els.queueList.innerHTML += queueItemHtml(song, false);
  }

  const queuedTracks = state.queue.map(id => findTrackById(id)).filter(Boolean);
  els.queueList.innerHTML += `<div class="queue-next-label">Next Up</div>`;
  if (!queuedTracks.length) {
    els.queueList.innerHTML += `<div class="empty-state">Queue is empty. Add songs with the "..." menu.</div>`;
  } else {
    queuedTracks.forEach((t, i) => {
      els.queueList.innerHTML += queueItemHtml(t.song, true, i);
    });
  }

  document.querySelectorAll('.queue-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.dataset.idx, 10);
      state.queue.splice(idx, 1);
      saveState();
      renderQueueSheet();
    });
  });

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function queueItemHtml(song, removable, idx){
  const cover = song.cover || FALLBACK_COVER;
  return `
    <div class="queue-item">
      <img src="${cover}" alt="">
      <div class="song-meta">
        <div class="song-title">${escapeHtml(song.title)}</div>
        <div class="song-artist">${escapeHtml(song.artist)}</div>
      </div>
      ${removable ? `<button class="song-more queue-remove" data-idx="${idx}"><i data-lucide="x"></i></button>` : ''}
    </div>
  `;
}

function openQueueSheet(){
  renderQueueSheet();
  openSheet(els.queueSheet);
}

function openActionSheet(songId){
  const track = findTrackById(songId);
  if (!track) return;
  sheetActionSong = track;
  els.actionSheetTitle.textContent = track.song.title;
  const liked = state.liked.includes(songId);
  els.actionLikeLabel.textContent = liked ? 'Remove from Liked Songs' : 'Add to Liked Songs';
  els.actionLike.querySelector('svg').setAttribute('data-lucide', liked ? 'heart-crack' : 'heart');

  els.actionPlaylistList.innerHTML = '';
  if (!state.playlists.length) {
    els.actionPlaylistList.innerHTML = '<div class="suggest-empty">No playlists yet</div>';
  } else {
    state.playlists.forEach(pl => {
      const item = document.createElement('div');
      item.className = 'action-item';
      const already = pl.songIds.includes(songId);
      item.innerHTML = `<i data-lucide="${already ? 'check-circle' : 'plus-circle'}"></i><span>${escapeHtml(pl.name)}</span>`;
      item.addEventListener('click', () => {
        if (already) {
          pl.songIds = pl.songIds.filter(id => id !== songId);
          showToast(`Removed from ${pl.name}`);
        } else {
          pl.songIds.push(songId);
          showToast(`Added to ${pl.name}`);
        }
        saveState();
        closeSheet(els.actionSheet);
      });
      els.actionPlaylistList.appendChild(item);
    });
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();
  openSheet(els.actionSheet);
}

function openSheet(sheetEl){
  els.overlay.classList.add('open');
  sheetEl.classList.add('open');
}

function closeSheet(sheetEl){
  sheetEl.classList.remove('open');
  const anyOpen = document.querySelector('.sheet.open, .modal-wrap.open');
  if (!anyOpen) els.overlay.classList.remove('open');
}

function openCreatePlaylistModal(){
  els.createModalInput.value = '';
  els.createModal.classList.add('open');
  els.overlay.classList.add('open');
  setTimeout(() => els.createModalInput.focus(), 200);
}

function closeCreatePlaylistModal(){
  els.createModal.classList.remove('open');
  const anyOpen = document.querySelector('.sheet.open');
  if (!anyOpen) els.overlay.classList.remove('open');
}

function confirmCreatePlaylist(){
  const name = els.createModalInput.value.trim();
  if (!name) return;
  state.playlists.push({ id: 'pl_' + Date.now(), name, songIds: [] });
  saveState();
  closeCreatePlaylistModal();
  renderPlaylistList();
  showToast('Playlist created');
}

let toastTimer = null;
function showToast(message){
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2200);
}

function updateVolumeUI(){
  const pct = Math.round(audio.volume * 100);
  els.volumeSlider.value = pct;
  els.volumeFill.style.width = pct + '%';
  const iconName = audio.volume === 0 ? 'volume-x' : audio.volume < 0.5 ? 'volume-1' : 'volume-2';
  const iconEl = els.volumeIconBtn.querySelector('svg');
  if (iconEl) iconEl.setAttribute('data-lucide', iconName);
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function renderSearchSuggestions(query){
  if (!query) {
    els.suggestPanel.classList.remove('open');
    return;
  }
  const q = query.toLowerCase();
  const matches = allSongsFlat().filter(t =>
    t.song.title.toLowerCase().includes(q) || t.song.artist.toLowerCase().includes(q) || t.album.title.toLowerCase().includes(q)
  ).slice(0, 6);

  els.suggestPanel.innerHTML = '';
  if (!matches.length) {
    els.suggestPanel.innerHTML = '<div class="suggest-empty">No matches found</div>';
  } else {
    matches.forEach(t => {
      const cover = t.song.cover || t.album.cover || FALLBACK_COVER;
      const item = document.createElement('div');
      item.className = 'suggest-item';
      item.innerHTML = `
        <img src="${cover}" alt="">
        <div class="suggest-meta">
          <div class="suggest-title">${escapeHtml(t.song.title)}</div>
          <div class="suggest-sub">${escapeHtml(t.song.artist)} · ${escapeHtml(t.album.title)}</div>
        </div>
      `;
      item.addEventListener('click', () => {
        playTrack(t.albumIdx, t.songIdx);
        els.searchInput.value = '';
        els.suggestPanel.classList.remove('open');
        els.searchInput.blur();
      });
      els.suggestPanel.appendChild(item);
    });
  }
  els.suggestPanel.classList.add('open');
}

function registerServiceWorker(){
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

function bindEvents(){
  els.searchInput.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    renderSearchSuggestions(e.target.value.trim());
    if (!q) { renderAlbumsGrid(library); return; }
    const filtered = library.filter(album => {
      if (album.title.toLowerCase().includes(q)) return true;
      return (album.songs || []).some(s =>
        s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q)
      );
    });
    renderAlbumsGrid(filtered);
  });
  els.searchInput.addEventListener('blur', () => {
    setTimeout(() => els.suggestPanel.classList.remove('open'), 150);
  });

  els.featureBtn.addEventListener('click', () => {
    window.open('https://instagram.com/f1.yuvraj', '_blank', 'noopener');
  });

  els.libraryHeaderBtn.addEventListener('click', openLibraryView);

  els.albumBack.addEventListener('click', popView);
  els.playerBack.addEventListener('click', popView);
  els.libraryBack.addEventListener('click', popView);
  els.playlistBack.addEventListener('click', popView);
  els.exploreBtn.addEventListener('click', resetToHome);

  els.likedRow.addEventListener('click', openLikedSongs);
  els.createPlaylistBtn.addEventListener('click', openCreatePlaylistModal);
  els.playlistDeleteBtn.addEventListener('click', deleteActivePlaylist);

  els.miniInfoTap.addEventListener('click', () => pushView('view-player'));
  els.miniThumb.addEventListener('click', () => pushView('view-player'));

  els.miniPlay.addEventListener('click', (e) => { e.stopPropagation(); togglePlayPause(); });
  els.miniPrev.addEventListener('click', (e) => { e.stopPropagation(); prevTrack(); });
  els.miniNext.addEventListener('click', (e) => { e.stopPropagation(); nextTrack(); });

  els.btnPlay.addEventListener('click', togglePlayPause);
  els.btnPrev.addEventListener('click', prevTrack);
  els.btnNext.addEventListener('click', nextTrack);
  els.btnShuffle.addEventListener('click', () => {
    isShuffle = !isShuffle;
    els.btnShuffle.classList.toggle('active', isShuffle);
  });
  els.btnRepeat.addEventListener('click', () => {
    isRepeat = !isRepeat;
    els.btnRepeat.classList.toggle('active', isRepeat);
  });
  els.favBtn.addEventListener('click', toggleLikeCurrent);

  els.queueOpenBtn.addEventListener('click', openQueueSheet);

  els.seekSlider.addEventListener('input', (e) => {
    if (!audio.duration) return;
    const pct = e.target.value;
    els.rangeFill.style.width = pct + '%';
    els.timeCurrent.textContent = formatTime((pct / 100) * audio.duration);
  });
  els.seekSlider.addEventListener('change', (e) => {
    if (!audio.duration) return;
    audio.currentTime = (e.target.value / 100) * audio.duration;
  });

  els.volumeSlider.addEventListener('input', (e) => {
    const vol = e.target.value / 100;
    audio.volume = vol;
    state.volume = vol;
    updateVolumeUI();
  });
  els.volumeSlider.addEventListener('change', saveState);
  els.volumeIconBtn.addEventListener('click', () => {
    audio.volume = audio.volume === 0 ? (state.volume || 0.85) : 0;
    if (audio.volume !== 0) state.volume = audio.volume;
    updateVolumeUI();
    saveState();
  });

  els.speedBtn.addEventListener('click', () => {
    speedIndex = (speedIndex + 1) % SPEED_STEPS.length;
    audio.playbackRate = SPEED_STEPS[speedIndex];
    els.speedBtn.textContent = SPEED_STEPS[speedIndex] + 'x';
  });

  els.overlay.addEventListener('click', () => {
    document.querySelectorAll('.sheet.open').forEach(s => closeSheet(s));
    closeCreatePlaylistModal();
  });

  els.actionLike.addEventListener('click', () => {
    if (!sheetActionSong) return;
    toggleLike(sheetActionSong.song.id);
    closeSheet(els.actionSheet);
  });
  els.actionQueue.addEventListener('click', () => {
    if (!sheetActionSong) return;
    addToQueue(sheetActionSong.song.id);
    closeSheet(els.actionSheet);
  });

  els.createModalCancel.addEventListener('click', closeCreatePlaylistModal);
  els.createModalConfirm.addEventListener('click', confirmCreatePlaylist);
  els.createModalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmCreatePlaylist();
  });

  document.querySelectorAll('.sheet-handle').forEach(handle => {
    handle.addEventListener('click', () => {
      const sheet = handle.closest('.sheet');
      if (sheet) closeSheet(sheet);
    });
  });
}
