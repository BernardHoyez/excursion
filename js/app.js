/**
 * Excursion PWA - Première version fonctionnelle
 * Modes Production & Visite
 */

(() => {
  'use strict';

  // ---------- État global ----------
  const state = {
    mode: 'production',
    track: null,          // GeoJSON LineString
    waypoints: [],        // [{id, name, lat, lng, comment, photo, video, audio, html, marker}]
    currentWpId: null,
    visiteIndex: -1,
    files: {              // Blobs pour les médias (Production)
      photos: {},
      videos: {},
      audios: {},
      htmls: {}
    }
  };

  // ---------- Cartes ----------
  let mapProd = null;
  let mapVisite = null;
  let trackLayerProd = null;
  let trackLayerVisite = null;
  let markersProd = L.layerGroup();
  let markersVisite = L.layerGroup();
  let currentBaseProd = null;   // couche fond actuelle
  let currentBaseVisite = null;

  // MBTiles chargé en mémoire (partagé entre les deux cartes)
  const mbtilesState = {
    db: null,          // base sql.js
    metadata: null,    // { name, format, minzoom, maxzoom, bounds, attribution }
    fileName: null
  };

  const BASEMAPS = {
    osm: {
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attr: '© OpenStreetMap'
    },
    'ign-plan': {
      url: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
      attr: '© IGN'
    },
    'ign-ortho': {
      url: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
      attr: '© IGN'
    }
  };

  // ---------- Utilitaires ----------
  function uid() {
    return 'wp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function showStatus(msg, duration = 2500) {
    const el = document.getElementById('status');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), duration);
  }

  function hasMedia(wp) {
    return !!(wp.comment || wp.photo || wp.video || wp.audio || wp.html);
  }

  /** Retire les mentions techniques et le HTML média issus du KML/KMZ */
  function cleanComment(text) {
    if (!text) return '';
    let s = String(text);
    // Supprimer explicitement toutes les balises image (souvent laissées par Google Earth / KML)
    s = s.replace(/<img\b[^>]*>/gi, '');
    // Normaliser les sauts de ligne HTML
    s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n');
    // Retirer le reste des balises HTML
    s = s.replace(/<[^>]+>/g, '');
    // Décoder quelques entités courantes
    s = s.replace(/&nbsp;/gi, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    // Supprimer les mentions générées à la sauvegarde
    s = s.replace(/(?:^|\s)(?:Photo|Vidéo|Video|Audio|HTML)\s*:\s*\S+/gi, '');
    // Supprimer les chemins médias résiduels
    s = s.replace(/(?:^|\s)(?:images|videos|audios|html)\/[^\s"'<>]+/gi, '');
    // Nettoyer espaces / lignes vides
    s = s
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .join('\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
    return s;
  }

  // ---------- Couche Leaflet MBTiles (sql.js) ----------
  const MBTilesLayer = L.GridLayer.extend({
    initialize(options) {
      L.GridLayer.prototype.initialize.call(this, options);
      this._db = options.db;
      this._format = (options.format || 'png').toLowerCase();
      this._mime = this._format === 'jpg' || this._format === 'jpeg'
        ? 'image/jpeg'
        : this._format === 'webp'
          ? 'image/webp'
          : 'image/png';
    },

    createTile(coords, done) {
      const tile = document.createElement('img');
      tile.alt = '';
      tile.setAttribute('role', 'presentation');

      // MBTiles utilise le schéma TMS (Y inversé)
      const z = coords.z;
      const x = coords.x;
      const y = (Math.pow(2, z) - 1) - coords.y;

      try {
        const stmt = this._db.prepare(
          'SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?'
        );
        stmt.bind([z, x, y]);
        if (stmt.step()) {
          const data = stmt.get()[0]; // Uint8Array
          const blob = new Blob([data], { type: this._mime });
          tile.src = URL.createObjectURL(blob);
          tile.onload = () => {
            URL.revokeObjectURL(tile.src);
            done(null, tile);
          };
          tile.onerror = () => done(null, tile);
        } else {
          // Tuile absente → transparente
          tile.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
          done(null, tile);
        }
        stmt.free();
      } catch (err) {
        console.warn('MBTiles tile error', err);
        done(err, tile);
      }
      return tile;
    }
  });

  // ---------- Initialisation des cartes ----------
  function initMaps() {
    mapProd = L.map('map-prod', { zoomControl: true }).setView([46.6, 2.4], 6);
    mapVisite = L.map('map-visite', { zoomControl: true }).setView([46.6, 2.4], 6);

    currentBaseProd = L.tileLayer(BASEMAPS.osm.url, { attribution: BASEMAPS.osm.attr, maxZoom: 19 }).addTo(mapProd);
    currentBaseVisite = L.tileLayer(BASEMAPS.osm.url, { attribution: BASEMAPS.osm.attr, maxZoom: 19 }).addTo(mapVisite);

    markersProd.addTo(mapProd);
    markersVisite.addTo(mapVisite);

    // Clic sur la carte (Production) pour ajouter un waypoint
    mapProd.on('click', (e) => {
      if (state.mode !== 'production') return;
      const name = prompt('Nom du waypoint :', 'Point ' + (state.waypoints.length + 1));
      if (name === null) return;
      addWaypoint({
        name: name || 'Sans nom',
        lat: e.latlng.lat,
        lng: e.latlng.lng
      });
    });
  }

  function removeBaseLayer(map, which) {
    if (which === 'prod' && currentBaseProd) {
      map.removeLayer(currentBaseProd);
      currentBaseProd = null;
    }
    if (which === 'visite' && currentBaseVisite) {
      map.removeLayer(currentBaseVisite);
      currentBaseVisite = null;
    }
  }

  function setBasemap(map, key, which) {
    removeBaseLayer(map, which);

    if (key === 'mbtiles') {
      if (!mbtilesState.db) {
        showStatus('Chargez d’abord un fichier MBTiles');
        return;
      }
      const meta = mbtilesState.metadata || {};
      const layer = new MBTilesLayer({
        db: mbtilesState.db,
        format: meta.format || 'png',
        minZoom: meta.minzoom != null ? meta.minzoom : 0,
        maxZoom: meta.maxzoom != null ? meta.maxzoom : 22,
        attribution: meta.attribution || mbtilesState.fileName || 'MBTiles'
      });
      layer.addTo(map);
      if (which === 'prod') currentBaseProd = layer;
      else currentBaseVisite = layer;

      // Zoom / centrage sur les bounds du MBTiles si disponibles
      if (meta.bounds && meta.bounds.length === 4) {
        const [west, south, east, north] = meta.bounds;
        try {
          map.fitBounds([[south, west], [north, east]]);
        } catch (_) { /* ignore */ }
      }
      return;
    }

    const bm = BASEMAPS[key] || BASEMAPS.osm;
    const layer = L.tileLayer(bm.url, { attribution: bm.attr, maxZoom: 19 });
    layer.addTo(map);
    if (which === 'prod') currentBaseProd = layer;
    else currentBaseVisite = layer;
  }

  // ---------- Chargement MBTiles local ----------
  async function loadMBTilesFile(file) {
    if (!file) return;
    showStatus('Chargement MBTiles… (peut prendre un moment)');

    try {
      if (typeof initSqlJs !== 'function') {
        throw new Error('sql.js non chargé');
      }

      const SQL = await initSqlJs({
        locateFile: (f) => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${f}`
      });

      const buffer = await file.arrayBuffer();
      const db = new SQL.Database(new Uint8Array(buffer));

      // Lire metadata
      const meta = {};
      try {
        const res = db.exec('SELECT name, value FROM metadata');
        if (res.length && res[0].values) {
          res[0].values.forEach(([name, value]) => {
            meta[name] = value;
          });
        }
      } catch (e) {
        console.warn('Pas de table metadata', e);
      }

      const metadata = {
        name: meta.name || file.name,
        format: (meta.format || 'png').toLowerCase(),
        minzoom: meta.minzoom != null ? parseInt(meta.minzoom, 10) : 0,
        maxzoom: meta.maxzoom != null ? parseInt(meta.maxzoom, 10) : 18,
        attribution: meta.attribution || file.name,
        bounds: null
      };

      if (meta.bounds) {
        // "west,south,east,north"
        const parts = meta.bounds.split(',').map(Number);
        if (parts.length === 4 && parts.every(n => !isNaN(n))) {
          metadata.bounds = parts;
        }
      }

      // Vérifier que la table tiles existe
      const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='tiles'");
      if (!tables.length) {
        db.close();
        throw new Error('Fichier MBTiles invalide (pas de table tiles)');
      }

      // Fermer l’ancienne base si présente
      if (mbtilesState.db) {
        try { mbtilesState.db.close(); } catch (_) {}
      }

      mbtilesState.db = db;
      mbtilesState.metadata = metadata;
      mbtilesState.fileName = file.name;

      // Activer l’option dans les deux selects
      ['basemap-prod', 'basemap-visite'].forEach((id) => {
        const sel = document.getElementById(id);
        const opt = sel.querySelector('option[value="mbtiles"]');
        if (opt) {
          opt.disabled = false;
          opt.textContent = `MBTiles: ${file.name.length > 20 ? file.name.slice(0, 18) + '…' : file.name}`;
        }
        sel.value = 'mbtiles';
      });

      // Appliquer sur la carte active
      if (state.mode === 'production') {
        setBasemap(mapProd, 'mbtiles', 'prod');
      } else {
        setBasemap(mapVisite, 'mbtiles', 'visite');
      }

      showStatus(`MBTiles chargé : ${file.name} (z${metadata.minzoom}–${metadata.maxzoom})`);
    } catch (err) {
      console.error(err);
      showStatus('Erreur MBTiles : ' + err.message, 4000);
    }
  }

  // ---------- Gestion des modes ----------
  function switchMode(mode) {
    state.mode = mode;
    document.getElementById('panel-production').classList.toggle('active', mode === 'production');
    document.getElementById('panel-visite').classList.toggle('active', mode === 'visite');

    // Redimensionner les cartes
    setTimeout(() => {
      if (mode === 'production' && mapProd) mapProd.invalidateSize();
      if (mode === 'visite' && mapVisite) mapVisite.invalidateSize();
    }, 100);
  }

  // ---------- Affichage des waypoints ----------
  function refreshWpList() {
    const ul = document.getElementById('wp-list-prod');
    ul.innerHTML = '';
    state.waypoints.forEach(wp => {
      const li = document.createElement('li');
      li.dataset.id = wp.id;
      if (wp.id === state.currentWpId) li.classList.add('active');
      const icon = wp.photo ? '📷' : wp.video ? '🎬' : wp.audio ? '🔊' : wp.html ? '🌐' : '📍';
      li.innerHTML = `<span class="icon">${icon}</span> ${wp.name}`;
      li.addEventListener('click', () => selectWaypoint(wp.id));
      ul.appendChild(li);
    });
  }

  function refreshVisiteList() {
    const ul = document.getElementById('wp-list-visite');
    ul.innerHTML = '';
    state.waypoints.forEach((wp, i) => {
      const li = document.createElement('li');
      li.dataset.index = i;
      if (i === state.visiteIndex) li.classList.add('active');
      const icon = wp.photo ? '📷' : wp.video ? '🎬' : wp.audio ? '🔊' : wp.html ? '🌐' : '📍';
      li.innerHTML = `<span class="icon">${icon}</span> ${wp.name}`;
      li.addEventListener('click', () => goToVisite(i));
      ul.appendChild(li);
    });
  }

  function mediaUrl(media) {
    if (!media) return null;
    if (typeof media === 'string') return media;
    // Réutilise l’URL déjà créée si possible
    if (media._objectUrl) return media._objectUrl;
    media._objectUrl = URL.createObjectURL(media);
    return media._objectUrl;
  }

  function createMarkerIcon(wp) {
    const hasCamera = !!(wp.photo || wp.video);
    const cls = hasCamera ? 'exc-marker exc-marker-camera' : 'exc-marker';
    const inner = hasCamera ? '📷' : '';
    return L.divIcon({
      className: cls,
      html: `<div class="exc-marker-inner">${inner}</div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
      popupAnchor: [0, -16]
    });
  }

  function updateMarkers(mapType) {
    const group = mapType === 'prod' ? markersProd : markersVisite;
    group.clearLayers();

    state.waypoints.forEach(wp => {
      const marker = L.marker([wp.lat, wp.lng], {
        icon: createMarkerIcon(wp),
        draggable: mapType === 'prod',
        autoPan: true
      });
      marker.wpId = wp.id;

      // Contenu popup (fonction → recalculé à chaque ouverture)
      marker.bindPopup(() => buildPopupContent(wp, mapType === 'visite'), {
        maxWidth: 280,
        minWidth: 160,
        autoPan: true,
        closeButton: true,
        className: 'exc-popup'
      });

      if (mapType === 'prod') {
        marker.on('dragend', (e) => {
          const pos = e.target.getLatLng();
          wp.lat = pos.lat;
          wp.lng = pos.lng;
        });
        // Clic → sélectionne dans la sidebar + ouvre la popup
        marker.on('click', () => {
          selectWaypoint(wp.id);
          marker.openPopup();
        });
      } else {
        marker.on('click', () => {
          const idx = state.waypoints.findIndex(w => w.id === wp.id);
          goToVisite(idx);
          marker.openPopup();
        });
      }

      group.addLayer(marker);
      wp.marker = marker;
    });
  }

  function buildPopupContent(wp, isVisite) {
    let html = `<div class="exc-popup-title">${escapeHtml(wp.name)}</div>`;
    const comment = cleanComment(wp.comment);
    if (comment) {
      // Texte échappé pour éviter toute <img> résiduelle du KML ; les retours ligne → <br>
      html += `<div class="exc-popup-comment">${escapeHtml(comment).replace(/\n/g, '<br>')}</div>`;
    }
    html += '<div class="popup-media">';

    if (wp.photo) {
      const src = mediaUrl(wp.photo);
      if (src && (src.startsWith('blob:') || src.startsWith('data:') || /^https?:/i.test(src))) {
        html += `<img src="${src}" alt="" title="Agrandir" class="exc-popup-img" data-fullsrc="${src}" onerror="this.style.display='none'" />`;
        html += `<button type="button" class="exc-popup-link exc-btn-agrandir" data-fullsrc="${src}">Agrandir</button>`;
      }
    }
    if (wp.video) {
      const src = mediaUrl(wp.video);
      html += `<video controls playsinline src="${src}" class="exc-popup-video"></video>`;
    }
    if (wp.audio) {
      const src = mediaUrl(wp.audio);
      html += `<audio controls src="${src}" class="exc-popup-audio"></audio>`;
    }
    if (wp.html) {
      const src = mediaUrl(wp.html);
      html += `<a href="${src}" target="_blank" rel="noopener" class="exc-popup-link">Ouvrir la page web</a>`;
    }
    html += '</div>';
    return html;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---------- Gestion des waypoints (Production) ----------
  function addWaypoint({ name, lat, lng, comment = '', photo = null, video = null, audio = null, html = null }) {
    const wp = {
      id: uid(),
      name,
      lat,
      lng,
      comment,
      photo,
      video,
      audio,
      html
    };
    state.waypoints.push(wp);
    updateMarkers('prod');
    refreshWpList();
    document.getElementById('btn-save-kmz').disabled = false;
    document.getElementById('btn-add-wp').disabled = false;
    showStatus(`Waypoint « ${name} » ajouté`);
    return wp;
  }

  function selectWaypoint(id) {
    state.currentWpId = id;
    const wp = state.waypoints.find(w => w.id === id);
    if (!wp) return;

    refreshWpList();
    const editor = document.getElementById('wp-editor');
    editor.classList.remove('hidden');
    document.getElementById('wp-name').value = wp.name;
    document.getElementById('wp-comment').value = cleanComment(wp.comment || '');
    // Reset file inputs
    document.getElementById('wp-photo').value = '';
    document.getElementById('wp-video').value = '';
    document.getElementById('wp-audio').value = '';
    document.getElementById('wp-html').value = '';

    if (wp.marker) {
      mapProd.panTo([wp.lat, wp.lng]);
      // Laisser le handler click gérer openPopup pour éviter les conflits
      if (!wp.marker.isPopupOpen()) {
        wp.marker.openPopup();
      }
    }
  }

  function saveWaypointEdit() {
    const wp = state.waypoints.find(w => w.id === state.currentWpId);
    if (!wp) return;

    wp.name = document.getElementById('wp-name').value.trim() || 'Sans nom';
    wp.comment = cleanComment(document.getElementById('wp-comment').value);

    const photoFile = document.getElementById('wp-photo').files[0];
    const videoFile = document.getElementById('wp-video').files[0];
    const audioFile = document.getElementById('wp-audio').files[0];
    const htmlFile = document.getElementById('wp-html').files[0];

    if (photoFile) wp.photo = photoFile;
    if (videoFile) wp.video = videoFile;
    if (audioFile) wp.audio = audioFile;
    if (htmlFile) wp.html = htmlFile;

    if (!hasMedia(wp)) {
      showStatus('⚠️ Un waypoint doit avoir au moins un élément (commentaire, photo, vidéo, audio ou HTML)');
      return;
    }

    updateMarkers('prod');
    refreshWpList();
    document.getElementById('wp-editor').classList.add('hidden');
    state.currentWpId = null;
    showStatus('Waypoint enregistré');
  }

  function deleteWaypoint() {
    if (!state.currentWpId) return;
    if (!confirm('Supprimer ce waypoint ?')) return;
    state.waypoints = state.waypoints.filter(w => w.id !== state.currentWpId);
    state.currentWpId = null;
    document.getElementById('wp-editor').classList.add('hidden');
    updateMarkers('prod');
    refreshWpList();
    showStatus('Waypoint supprimé');
  }

  // ---------- Chargement de fichiers ----------
  async function loadFileProduction(file) {
    const name = file.name.toLowerCase();
    showStatus('Chargement…');

    try {
      if (name.endsWith('.gpx') || name.endsWith('.kml')) {
        const text = await file.text();
        const geo = name.endsWith('.gpx')
          ? toGeoJSON.gpx(new DOMParser().parseFromString(text, 'text/xml'))
          : toGeoJSON.kml(new DOMParser().parseFromString(text, 'text/xml'));
        processGeoJSON(geo);
      } else if (name.endsWith('.kmz')) {
        await loadKMZ(file, 'production');
      } else {
        showStatus('Format non supporté');
        return;
      }
      document.getElementById('btn-save-kmz').disabled = false;
      document.getElementById('btn-add-wp').disabled = false;
      showStatus('Fichier chargé');
    } catch (err) {
      console.error(err);
      showStatus('Erreur de chargement : ' + err.message);
    }
  }

  async function loadFileVisite(file) {
    showStatus('Chargement KMZ…');
    try {
      await loadKMZ(file, 'visite');
      document.getElementById('btn-prev').disabled = state.waypoints.length === 0;
      document.getElementById('btn-next').disabled = state.waypoints.length === 0;
      if (state.waypoints.length) {
        goToVisite(0);
      }
      showStatus('Circuit chargé – ' + state.waypoints.length + ' points');
    } catch (err) {
      console.error(err);
      showStatus('Erreur : ' + err.message);
    }
  }

  function processGeoJSON(geo) {
    // Réinitialiser
    state.waypoints = [];
    markersProd.clearLayers();
    if (trackLayerProd) {
      mapProd.removeLayer(trackLayerProd);
      trackLayerProd = null;
    }

    const features = geo.features || [];
    const coords = [];

    features.forEach(f => {
      if (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString') {
        const line = f.geometry.type === 'LineString' ? f.geometry.coordinates : f.geometry.coordinates.flat();
        coords.push(...line);
        trackLayerProd = L.geoJSON(f, { style: { color: '#1a5f2a', weight: 4 } }).addTo(mapProd);
        state.track = f;
      } else if (f.geometry.type === 'Point') {
        const [lng, lat] = f.geometry.coordinates;
        const props = f.properties || {};
        addWaypoint({
          name: props.name || props.Name || 'Point',
          lat,
          lng,
          comment: cleanComment(props.description || props.Description || props.comment || '')
        });
      }
    });

    if (coords.length) {
      const latlngs = coords.map(c => [c[1], c[0]]);
      mapProd.fitBounds(latlngs);
    } else if (state.waypoints.length) {
      const b = L.latLngBounds(state.waypoints.map(w => [w.lat, w.lng]));
      mapProd.fitBounds(b.pad(0.2));
    }
    refreshWpList();
  }

  async function loadKMZ(file, mode) {
    const zip = await JSZip.loadAsync(file);
    state.waypoints = [];
    state.files = { photos: {}, videos: {}, audios: {}, htmls: {} };

    // Chercher le KML principal
    let kmlFile = zip.file('doc.kml') || zip.file(/\.kml$/i)[0];
    if (!kmlFile) throw new Error('Aucun fichier KML trouvé dans le KMZ');

    const kmlText = await kmlFile.async('text');
    const geo = toGeoJSON.kml(new DOMParser().parseFromString(kmlText, 'text/xml'));

    // Extraire les médias (avec type MIME correct)
    const mimeFromName = (filename) => {
      const n = filename.toLowerCase();
      if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
      if (n.endsWith('.png')) return 'image/png';
      if (n.endsWith('.gif')) return 'image/gif';
      if (n.endsWith('.webp')) return 'image/webp';
      if (n.endsWith('.mp4')) return 'video/mp4';
      if (n.endsWith('.webm')) return 'video/webm';
      if (n.endsWith('.mov')) return 'video/quicktime';
      if (n.endsWith('.mp3')) return 'audio/mpeg';
      if (n.endsWith('.wav')) return 'audio/wav';
      if (n.endsWith('.ogg')) return 'audio/ogg';
      if (n.endsWith('.m4a')) return 'audio/mp4';
      if (n.endsWith('.html') || n.endsWith('.htm')) return 'text/html';
      return 'application/octet-stream';
    };

    const mediaMap = {}; // nom de fichier → Blob typé

    for (const [path, zipEntry] of Object.entries(zip.files)) {
      if (zipEntry.dir) continue;
      const lower = path.toLowerCase();
      const name = path.split('/').pop();
      const raw = await zipEntry.async('blob');
      // Forcer le type MIME (JSZip renvoie souvent application/octet-stream)
      const blob = new Blob([raw], { type: mimeFromName(name) });

      if (/\.(jpe?g|png|gif|webp)$/i.test(lower)) {
        mediaMap[name] = blob;
        state.files.photos[name] = blob;
      } else if (/\.(mp4|webm|ogg|mov)$/i.test(lower)) {
        mediaMap[name] = blob;
        state.files.videos[name] = blob;
      } else if (/\.(mp3|wav|ogg|m4a)$/i.test(lower)) {
        mediaMap[name] = blob;
        state.files.audios[name] = blob;
      } else if (/\.(html?|htm)$/i.test(lower)) {
        mediaMap[name] = blob;
        state.files.htmls[name] = blob;
      }
    }

    // Traiter les features
    const features = geo.features || [];
    let trackFeature = null;

    features.forEach(f => {
      if (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString') {
        trackFeature = f;
      } else if (f.geometry.type === 'Point') {
        const [lng, lat] = f.geometry.coordinates;
        const props = f.properties || {};
        const name = props.name || props.Name || 'Point';
        const rawDesc = props.description || props.Description || '';
        let photo = null, video = null, audio = null, html = null;

        // Résoudre un nom de média (fichier seul ou chemin type images/photo_01.jpg)
        const resolveMedia = (ref) => {
          if (!ref) return null;
          if (mediaMap[ref]) return mediaMap[ref];
          const base = String(ref).split('/').pop();
          return mediaMap[base] || null;
        };

        if (props.photo) photo = resolveMedia(props.photo);
        if (props.video) video = resolveMedia(props.video);
        if (props.audio) audio = resolveMedia(props.audio);
        if (props.html) html = resolveMedia(props.html);

        // Fallback : noms de fichiers présents dans la description brute
        Object.keys(mediaMap).forEach(fname => {
          if (rawDesc.includes(fname)) {
            if (/\.(jpe?g|png|gif|webp)$/i.test(fname) && !photo) photo = mediaMap[fname];
            if (/\.(mp4|webm)$/i.test(fname) && !video) video = mediaMap[fname];
            if (/\.(mp3|wav)$/i.test(fname) && !audio) audio = mediaMap[fname];
            if (/\.html?$/i.test(fname) && !html) html = mediaMap[fname];
          }
        });

        // Commentaire affiché = description sans les lignes techniques Photo:/HTML:/…
        const comment = cleanComment(rawDesc);

        state.waypoints.push({
          id: uid(),
          name,
          lat,
          lng,
          comment,
          photo,
          video,
          audio,
          html
        });
      }
    });

    // Affichage
    const map = mode === 'production' ? mapProd : mapVisite;
    const markers = mode === 'production' ? markersProd : markersVisite;

    if (mode === 'production') {
      if (trackLayerProd) { mapProd.removeLayer(trackLayerProd); trackLayerProd = null; }
    } else {
      if (trackLayerVisite) { mapVisite.removeLayer(trackLayerVisite); trackLayerVisite = null; }
    }
    markers.clearLayers();

    if (trackFeature) {
      const layer = L.geoJSON(trackFeature, { style: { color: '#1a5f2a', weight: 4 } }).addTo(map);
      if (mode === 'production') trackLayerProd = layer;
      else trackLayerVisite = layer;
      state.track = trackFeature;
    }

    updateMarkers(mode === 'production' ? 'prod' : 'visite');

    if (state.waypoints.length) {
      const b = L.latLngBounds(state.waypoints.map(w => [w.lat, w.lng]));
      map.fitBounds(b.pad(0.15));
    }

    if (mode === 'production') refreshWpList();
    else refreshVisiteList();
  }

  // ---------- Sauvegarde KMZ ----------
  async function saveKMZ() {
    if (!state.waypoints.length && !state.track) {
      showStatus('Rien à sauvegarder');
      return;
    }

    showStatus('Création du KMZ…');
    const zip = new JSZip();
    const images = zip.folder('images');
    const videos = zip.folder('videos');
    const audios = zip.folder('audios');
    const htmlFolder = zip.folder('html');

    // Construire le KML
    let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Excursion</name>
    <Style id="trackStyle">
      <LineStyle><color>ff2a5f1a</color><width>4</width></LineStyle>
    </Style>
`;

    // Trace
    if (state.track && state.track.geometry) {
      const coords = state.track.geometry.type === 'LineString'
        ? state.track.geometry.coordinates
        : state.track.geometry.coordinates.flat();
      kml += `    <Placemark>
      <name>Trace</name>
      <styleUrl>#trackStyle</styleUrl>
      <LineString>
        <coordinates>
`;
      coords.forEach(c => {
        kml += `          ${c[0]},${c[1]},0\n`;
      });
      kml += `        </coordinates>
      </LineString>
    </Placemark>
`;
    }

    // Waypoints
    for (let i = 0; i < state.waypoints.length; i++) {
      const wp = state.waypoints[i];
      let photoName = null, videoName = null, audioName = null, htmlName = null;

      if (wp.photo) {
        photoName = `photo_${String(i + 1).padStart(2, '0')}.jpg`;
        const blob = wp.photo instanceof Blob ? wp.photo : await fetch(wp.photo).then(r => r.blob());
        images.file(photoName, blob);
      }
      if (wp.video) {
        videoName = `film_${String(i + 1).padStart(2, '0')}.mp4`;
        const blob = wp.video instanceof Blob ? wp.video : await fetch(wp.video).then(r => r.blob());
        videos.file(videoName, blob);
      }
      if (wp.audio) {
        audioName = `son_${String(i + 1).padStart(2, '0')}.mp3`;
        const blob = wp.audio instanceof Blob ? wp.audio : await fetch(wp.audio).then(r => r.blob());
        audios.file(audioName, blob);
      }
      if (wp.html) {
        htmlName = `page_${String(i + 1).padStart(2, '0')}.htm`;
        const blob = wp.html instanceof Blob ? wp.html : await fetch(wp.html).then(r => r.blob());
        htmlFolder.file(htmlName, blob);
      }

      // Description = commentaire utilisateur uniquement (médias via ExtendedData)
      const desc = cleanComment(wp.comment || '');

      kml += `    <Placemark>
      <name>${escapeXml(wp.name)}</name>
      <description><![CDATA[${desc}]]></description>
      <ExtendedData>
`;
      if (photoName) kml += `        <Data name="photo"><value>${photoName}</value></Data>\n`;
      if (videoName) kml += `        <Data name="video"><value>${videoName}</value></Data>\n`;
      if (audioName) kml += `        <Data name="audio"><value>${audioName}</value></Data>\n`;
      if (htmlName) kml += `        <Data name="html"><value>${htmlName}</value></Data>\n`;
      kml += `      </ExtendedData>
      <Point>
        <coordinates>${wp.lng},${wp.lat},0</coordinates>
      </Point>
    </Placemark>
`;
    }

    kml += `  </Document>
</kml>`;

    zip.file('doc.kml', kml);

    const content = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(content);
    a.download = 'randonnee.kmz';
    a.click();
    URL.revokeObjectURL(a.href);
    showStatus('KMZ sauvegardé');
  }

  function escapeXml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---------- Mode Visite ----------
  function goToVisite(index) {
    if (index < 0 || index >= state.waypoints.length) return;
    state.visiteIndex = index;
    const wp = state.waypoints[index];
    refreshVisiteList();

    const visComment = cleanComment(wp.comment);
    document.getElementById('visite-info').innerHTML =
      `<strong>${escapeHtml(wp.name)}</strong><br>` +
      (visComment ? `<span style="font-size:0.9rem">${visComment}</span>` : '');

    mapVisite.panTo([wp.lat, wp.lng]);
    if (wp.marker && !wp.marker.isPopupOpen()) {
      wp.marker.openPopup();
    }

    document.getElementById('btn-prev').disabled = index === 0;
    document.getElementById('btn-next').disabled = index === state.waypoints.length - 1;
  }

  // ---------- Événements ----------
  function bindEvents() {
    // Mode switch
    document.querySelectorAll('input[name="mode"]').forEach(r => {
      r.addEventListener('change', e => switchMode(e.target.value));
    });

    // Fichiers
    document.getElementById('file-input-prod').addEventListener('change', e => {
      if (e.target.files[0]) loadFileProduction(e.target.files[0]);
      e.target.value = '';
    });
    document.getElementById('file-input-visite').addEventListener('change', e => {
      if (e.target.files[0]) loadFileVisite(e.target.files[0]);
      e.target.value = '';
    });

    // Boutons Production
    document.getElementById('btn-add-wp').addEventListener('click', () => {
      showStatus('Cliquez sur la carte pour placer le waypoint');
    });
    document.getElementById('btn-save-kmz').addEventListener('click', saveKMZ);
    document.getElementById('wp-save').addEventListener('click', saveWaypointEdit);
    document.getElementById('wp-delete').addEventListener('click', deleteWaypoint);
    document.getElementById('wp-cancel').addEventListener('click', () => {
      document.getElementById('wp-editor').classList.add('hidden');
      state.currentWpId = null;
      refreshWpList();
    });

    // Basemaps
    document.getElementById('basemap-prod').addEventListener('change', e => setBasemap(mapProd, e.target.value, 'prod'));
    document.getElementById('basemap-visite').addEventListener('change', e => setBasemap(mapVisite, e.target.value, 'visite'));

    // Chargement MBTiles local
    document.getElementById('mbtiles-input-prod').addEventListener('change', e => {
      if (e.target.files[0]) loadMBTilesFile(e.target.files[0]);
      e.target.value = '';
    });
    document.getElementById('mbtiles-input-visite').addEventListener('change', e => {
      if (e.target.files[0]) loadMBTilesFile(e.target.files[0]);
      e.target.value = '';
    });

    // Visite navigation
    document.getElementById('btn-prev').addEventListener('click', () => goToVisite(state.visiteIndex - 1));
    document.getElementById('btn-next').addEventListener('click', () => goToVisite(state.visiteIndex + 1));

    // Lightbox « Agrandir »
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');

    function openLightbox(src) {
      if (!src) return;
      lightboxImg.src = src;
      lightbox.classList.remove('hidden');
    }

    function closeLightbox() {
      lightbox.classList.add('hidden');
      lightboxImg.src = '';
    }

    // Délégation : clic sur vignette ou bouton Agrandir dans les popups
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.exc-btn-agrandir');
      const img = e.target.closest('.exc-popup-img');
      if (btn) {
        e.preventDefault();
        e.stopPropagation();
        openLightbox(btn.dataset.fullsrc);
      } else if (img && img.dataset.fullsrc) {
        e.preventDefault();
        e.stopPropagation();
        openLightbox(img.dataset.fullsrc);
      }
    });

    lightbox.querySelector('.lightbox-close').addEventListener('click', (e) => {
      e.stopPropagation();
      closeLightbox();
    });
    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox) closeLightbox();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !lightbox.classList.contains('hidden')) closeLightbox();
    });
  }

  // ---------- PWA (optimisé GitHub Pages) ----------
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;

    // Chemin relatif → fonctionne aussi en sous-dossier (user.github.io/repo/)
    const swUrl = new URL('sw.js', window.location.href).href;

    navigator.serviceWorker.register(swUrl, { scope: './' })
      .then((reg) => {
        // Nouvelle version détectée
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // Une mise à jour est prête → on l'active et on recharge
              showStatus('Mise à jour disponible – rechargement…');
              newWorker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });

        // Quand le nouveau SW prend le contrôle → recharger pour avoir le code frais
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (refreshing) return;
          refreshing = true;
          window.location.reload();
        });
      })
      .catch((err) => console.warn('SW registration failed:', err));
  }

  // ---------- Démarrage ----------
  document.addEventListener('DOMContentLoaded', () => {
    initMaps();
    bindEvents();
    registerSW();
    showStatus('Excursion prêt – mode Production');
  });
})();
