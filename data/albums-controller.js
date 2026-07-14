function getRestifyLibrary() {
  try { return window.parent.RestifyLibrary || null; } catch (e) { return null; }
}

function renderAlbumsGridPage() {
  const library = getRestifyLibrary();
  const mesh = document.getElementById('albums-mesh');
  const empty = document.getElementById('albums-empty');
  if (!mesh || !empty) return;
  if (!library || !library.length) {
    mesh.innerHTML = '';
    empty.style.display = 'block';
    if (window.lucide) lucide.createIcons();
    return;
  }
  empty.style.display = 'none';
  mesh.innerHTML = library.map(album => {
    const count = (album.songs || []).length;
    return `
      <div class="mesh-album-card" data-id="${album.id}">
        <div class="mesh-cover-wrap">
          <img src="${album.cover}" alt="${album.title}">
          <div class="mesh-play-overlay"><i data-lucide="play"></i></div>
        </div>
        <div class="mesh-meta">
          <div class="mesh-title">${album.title}</div>
          <div class="mesh-artist">${count} track${count !== 1 ? 's' : ''}</div>
        </div>
      </div>
    `;
  }).join('');
  mesh.querySelectorAll('.mesh-album-card').forEach(card => {
    card.addEventListener('click', () => {
      const album = library.find(a => String(a.id) === card.dataset.id);
      if (album && window.parent.openAlbum) window.parent.openAlbum(album.id);
    });
  });
  if (window.lucide) lucide.createIcons();
}

renderAlbumsGridPage();
try { window.parent.addEventListener('restify-data-ready', renderAlbumsGridPage); } catch (e) {}
document.addEventListener('DOMContentLoaded', () => { if (window.lucide) lucide.createIcons(); });
