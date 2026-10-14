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
    presIndex: -1,
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

  // Géolocalisation temps réel
  const geoState = {
    watchId: null,
    active: false,
    lat: null,
    lng: null,
    accuracy: null,
    markerProd: null,
    markerVisite: null,
    accuracyCircleProd: null,
    accuracyCircleVisite: null,
    follow: true   // centre la carte sur la position au premier fix / si activé
  };

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
    document.getElementById('panel-presentation').classList.toggle('active', mode === 'presentation');

    // Redimensionner les cartes
    setTimeout(() => {
      if (mode === 'production' && mapProd) mapProd.invalidateSize();
      if (mode === 'visite' && mapVisite) mapVisite.invalidateSize();
    }, 100);

    if (mode === 'presentation') {
      initPresentation();
    } else {
      stopPresentationMedia();
    }
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
      html += `<video controls playsinline src="${src}" class="exc-popup-video" data-fullsrc="${src}" title="Cliquer pour agrandir"></video>`;
      html += `<button type="button" class="exc-popup-link exc-btn-agrandir-video" data-fullsrc="${src}">Agrandir</button>`;
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

  // Médias marqués pour suppression (avant Enregistrer)
  const pendingRemove = { photo: false, video: false, audio: false, html: false };

  function updateMediaStatus(wp) {
    ['photo', 'video', 'audio', 'html'].forEach((key) => {
      const el = document.getElementById(`wp-${key}-status`);
      if (!el) return;
      const has = !!(wp && wp[key]) && !pendingRemove[key];
      el.classList.toggle('hidden', !has);
    });
  }

  function selectWaypoint(id) {
    state.currentWpId = id;
    const wp = state.waypoints.find(w => w.id === id);
    if (!wp) return;

    // Réinitialiser les suppressions en attente
    pendingRemove.photo = false;
    pendingRemove.video = false;
    pendingRemove.audio = false;
    pendingRemove.html = false;

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

    updateMediaStatus(wp);

    if (wp.marker) {
      mapProd.panTo([wp.lat, wp.lng]);
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

    // Appliquer les retraits demandés
    if (pendingRemove.photo) wp.photo = null;
    if (pendingRemove.video) wp.video = null;
    if (pendingRemove.audio) wp.audio = null;
    if (pendingRemove.html) wp.html = null;

    // Puis les nouveaux fichiers (remplacent ou ajoutent)
    if (photoFile) wp.photo = photoFile;
    if (videoFile) wp.video = videoFile;
    if (audioFile) wp.audio = audioFile;
    if (htmlFile) wp.html = htmlFile;

    if (!hasMedia(wp)) {
      showStatus('⚠️ Un waypoint doit avoir au moins un élément (commentaire, photo, vidéo, audio ou HTML)');
      return;
    }

    pendingRemove.photo = pendingRemove.video = pendingRemove.audio = pendingRemove.html = false;

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

  // ---------- Géolocalisation temps réel ----------
  function createUserLocIcon() {
    return L.divIcon({
      className: 'user-loc-marker',
      html: '<div class="user-loc-wrap"><div class="user-loc-pulse"></div><div class="user-loc-dot"></div></div>',
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
  }

  function updateUserLocationMarkers(lat, lng, accuracy) {
    const latlng = [lat, lng];
    const icon = createUserLocIcon();

    // Production
    if (mapProd) {
      if (geoState.markerProd) {
        geoState.markerProd.setLatLng(latlng);
      } else {
        geoState.markerProd = L.marker(latlng, {
          icon,
          zIndexOffset: 1000,
          interactive: false
        }).addTo(mapProd);
      }
      if (geoState.accuracyCircleProd) {
        geoState.accuracyCircleProd.setLatLng(latlng);
        geoState.accuracyCircleProd.setRadius(accuracy || 0);
      } else if (accuracy) {
        geoState.accuracyCircleProd = L.circle(latlng, {
          radius: accuracy,
          color: '#1e88e5',
          weight: 1,
          opacity: 0.4,
          fillColor: '#1e88e5',
          fillOpacity: 0.1,
          interactive: false
        }).addTo(mapProd);
      }
    }

    // Visite
    if (mapVisite) {
      if (geoState.markerVisite) {
        geoState.markerVisite.setLatLng(latlng);
      } else {
        geoState.markerVisite = L.marker(latlng, {
          icon,
          zIndexOffset: 1000,
          interactive: false
        }).addTo(mapVisite);
      }
      if (geoState.accuracyCircleVisite) {
        geoState.accuracyCircleVisite.setLatLng(latlng);
        geoState.accuracyCircleVisite.setRadius(accuracy || 0);
      } else if (accuracy) {
        geoState.accuracyCircleVisite = L.circle(latlng, {
          radius: accuracy,
          color: '#1e88e5',
          weight: 1,
          opacity: 0.4,
          fillColor: '#1e88e5',
          fillOpacity: 0.1,
          interactive: false
        }).addTo(mapVisite);
      }
    }
  }

  function removeUserLocationMarkers() {
    if (geoState.markerProd && mapProd) {
      mapProd.removeLayer(geoState.markerProd);
      geoState.markerProd = null;
    }
    if (geoState.markerVisite && mapVisite) {
      mapVisite.removeLayer(geoState.markerVisite);
      geoState.markerVisite = null;
    }
    if (geoState.accuracyCircleProd && mapProd) {
      mapProd.removeLayer(geoState.accuracyCircleProd);
      geoState.accuracyCircleProd = null;
    }
    if (geoState.accuracyCircleVisite && mapVisite) {
      mapVisite.removeLayer(geoState.accuracyCircleVisite);
      geoState.accuracyCircleVisite = null;
    }
  }

  function setGeolocButtonsActive(active) {
    ['btn-geoloc-prod', 'btn-geoloc-visite'].forEach((id) => {
      const btn = document.getElementById(id);
      if (btn) btn.classList.toggle('active', active);
    });
  }

  function startGeolocation() {
    if (!navigator.geolocation) {
      showStatus('Géolocalisation non supportée par ce navigateur', 3500);
      return;
    }

    if (geoState.watchId != null) {
      stopGeolocation();
      return;
    }

    showStatus('Activation GPS…');
    geoState.follow = true;

    geoState.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        geoState.lat = latitude;
        geoState.lng = longitude;
        geoState.accuracy = accuracy;
        geoState.active = true;
        setGeolocButtonsActive(true);

        updateUserLocationMarkers(latitude, longitude, accuracy);

        // Centrer au premier fix (ou si follow encore actif)
        if (geoState.follow) {
          const map = state.mode === 'production' ? mapProd : mapVisite;
          if (map) {
            map.setView([latitude, longitude], Math.max(map.getZoom(), 15));
          }
          geoState.follow = false; // ne pas recentrer en continu (l’utilisateur peut explorer)
        }
      },
      (err) => {
        let msg = 'Erreur GPS';
        if (err.code === 1) msg = 'Permission de localisation refusée';
        else if (err.code === 2) msg = 'Position indisponible';
        else if (err.code === 3) msg = 'Délai GPS dépassé';
        showStatus(msg, 4000);
        stopGeolocation();
      },
      {
        enableHighAccuracy: true,
        maximumAge: 3000,
        timeout: 15000
      }
    );
  }

  function stopGeolocation() {
    if (geoState.watchId != null) {
      navigator.geolocation.clearWatch(geoState.watchId);
      geoState.watchId = null;
    }
    geoState.active = false;
    geoState.lat = null;
    geoState.lng = null;
    removeUserLocationMarkers();
    setGeolocButtonsActive(false);
    showStatus('GPS désactivé');
  }

  function toggleGeolocation() {
    if (geoState.watchId != null) stopGeolocation();
    else startGeolocation();
  }

  function centerOnUser() {
    if (geoState.lat == null || geoState.lng == null) {
      showStatus('Position GPS pas encore disponible');
      return;
    }
    const map = state.mode === 'production' ? mapProd : mapVisite;
    if (map) map.setView([geoState.lat, geoState.lng], Math.max(map.getZoom(), 16));
  }

  // ---------- Mode Présentation ----------
  function stopPresentationMedia() {
    const v = document.getElementById('pres-video');
    const a = document.getElementById('pres-audio');
    if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
    if (a) { a.pause(); a.removeAttribute('src'); a.load(); }
  }

  function initPresentation() {
    const has = state.waypoints.length > 0;
    document.getElementById('btn-pres-export-pptx').disabled = !has;
    document.getElementById('btn-pres-export-html').disabled = !has;
    if (!has) {
      state.presIndex = -1;
      document.getElementById('pres-empty').classList.remove('hidden');
      document.getElementById('pres-slide').classList.add('hidden');
      document.getElementById('pres-counter').textContent = '0 / 0';
      document.getElementById('btn-pres-prev').disabled = true;
      document.getElementById('btn-pres-next').disabled = true;
      document.getElementById('btn-pres-comment').disabled = true;
      return;
    }
    if (state.presIndex < 0 || state.presIndex >= state.waypoints.length) {
      state.presIndex = 0;
    }
    showPresentationSlide(state.presIndex);
  }

  function showPresentationSlide(index) {
    if (index < 0 || index >= state.waypoints.length) return;
    stopPresentationMedia();
    state.presIndex = index;
    const wp = state.waypoints[index];
    const n = state.waypoints.length;

    document.getElementById('pres-empty').classList.add('hidden');
    document.getElementById('pres-slide').classList.remove('hidden');
    document.getElementById('pres-counter').textContent = `${index + 1} / ${n}`;
    document.getElementById('btn-pres-prev').disabled = index === 0;
    document.getElementById('btn-pres-next').disabled = index === n - 1;
    document.getElementById('btn-pres-export-pptx').disabled = false;
    document.getElementById('btn-pres-export-html').disabled = false;

    document.getElementById('pres-caption').textContent = wp.name || `Point ${index + 1}`;

    // Photo pleine page
    const photoEl = document.getElementById('pres-photo');
    const noPhoto = document.getElementById('pres-no-photo');
    if (wp.photo) {
      const src = mediaUrl(wp.photo);
      photoEl.src = src;
      photoEl.classList.remove('hidden');
      noPhoto.classList.add('hidden');
    } else {
      photoEl.removeAttribute('src');
      photoEl.classList.add('hidden');
      noPhoto.classList.remove('hidden');
    }

    // Vidéo / audio
    const vid = document.getElementById('pres-video');
    const aud = document.getElementById('pres-audio');
    if (wp.video) {
      vid.src = mediaUrl(wp.video);
      vid.classList.remove('hidden');
      aud.classList.add('hidden');
    } else if (wp.audio) {
      aud.src = mediaUrl(wp.audio);
      aud.classList.remove('hidden');
      vid.classList.add('hidden');
    } else {
      vid.classList.add('hidden');
      aud.classList.add('hidden');
    }

    // Bouton commentaire (HTML page ou texte)
    const hasComment = !!(wp.html || cleanComment(wp.comment));
    document.getElementById('btn-pres-comment').disabled = !hasComment;
  }

  function openPresComment() {
    const wp = state.waypoints[state.presIndex];
    if (!wp) return;
    const modal = document.getElementById('pres-comment-modal');
    const frame = document.getElementById('pres-comment-frame');
    const textEl = document.getElementById('pres-comment-text');
    document.getElementById('pres-comment-title').textContent = wp.name || 'Commentaire';

    if (wp.html) {
      frame.src = mediaUrl(wp.html);
      frame.classList.remove('hidden');
      textEl.classList.add('hidden');
    } else {
      frame.removeAttribute('src');
      frame.classList.add('hidden');
      textEl.textContent = cleanComment(wp.comment) || '';
      textEl.classList.remove('hidden');
    }
    modal.classList.remove('hidden');
  }

  function closePresComment() {
    const modal = document.getElementById('pres-comment-modal');
    const frame = document.getElementById('pres-comment-frame');
    modal.classList.add('hidden');
    frame.removeAttribute('src');
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      if (!blob) return resolve(null);
      if (typeof blob === 'string') return resolve(blob);
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  async function exportPresentationPptx() {
    if (!state.waypoints.length) {
      showStatus('Aucun slide à exporter');
      return;
    }
    if (typeof PptxGenJS === 'undefined') {
      showStatus('Bibliothèque PPTX non chargée');
      return;
    }
    showStatus('Création du PPTX…');
    try {
      const pptx = new PptxGenJS();
      pptx.defineLayout({ name: 'LAYOUT_16x9', width: 13.333, height: 7.5 });
      pptx.layout = 'LAYOUT_16x9';
      pptx.author = 'Excursion';
      pptx.title = 'Présentation Excursion';

      for (let i = 0; i < state.waypoints.length; i++) {
        const wp = state.waypoints[i];
        const slide = pptx.addSlide();
        slide.background = { color: '000000' };

        if (wp.photo) {
          const dataUrl = await blobToDataUrl(wp.photo instanceof Blob ? wp.photo : await fetch(wp.photo).then(r => r.blob()));
          if (dataUrl) {
            slide.addImage({
              data: dataUrl,
              x: 0.3,
              y: 0.2,
              w: 12.7,
              h: 6.2,
              sizing: { type: 'contain', w: 12.7, h: 6.2 }
            });
          }
        } else {
          slide.addText(wp.name || `Point ${i + 1}`, {
            x: 0.5, y: 3, w: 12.3, h: 1,
            color: 'FFFFFF', fontSize: 28, align: 'center'
          });
        }

        slide.addText(wp.name || `Point ${i + 1}`, {
          x: 0.3, y: 6.5, w: 12.7, h: 0.5,
          color: 'FFFFFF', fontSize: 16, align: 'center', bold: true
        });

        const note = cleanComment(wp.comment);
        if (note) slide.addNotes(note);
        if (wp.video || wp.audio) {
          slide.addNotes((slide._slideLayout?.notes || '') +
            (wp.video ? '\n[Vidéo jointe dans le KMZ / export HTML]' : '') +
            (wp.audio ? '\n[Audio joint dans le KMZ / export HTML]' : ''));
        }
      }

      await pptx.writeFile({ fileName: 'excursion-presentation.pptx' });
      showStatus('PPTX téléchargé');
    } catch (err) {
      console.error(err);
      showStatus('Erreur PPTX : ' + err.message, 4000);
    }
  }

  async function exportPresentationHtml() {
    if (!state.waypoints.length) {
      showStatus('Aucun slide à exporter');
      return;
    }
    showStatus('Création de la présentation HTML…');
    try {
      const zip = new JSZip();
      const mediaFolder = zip.folder('media');
      const slidesData = [];

      for (let i = 0; i < state.waypoints.length; i++) {
        const wp = state.waypoints[i];
        const entry = {
          name: wp.name || `Point ${i + 1}`,
          comment: cleanComment(wp.comment),
          photo: null,
          video: null,
          audio: null,
          html: null
        };
        const pad = String(i + 1).padStart(2, '0');

        if (wp.photo) {
          const blob = wp.photo instanceof Blob ? wp.photo : await fetch(wp.photo).then(r => r.blob());
          const fname = `photo_${pad}.jpg`;
          mediaFolder.file(fname, blob);
          entry.photo = 'media/' + fname;
        }
        if (wp.video) {
          const blob = wp.video instanceof Blob ? wp.video : await fetch(wp.video).then(r => r.blob());
          const fname = `video_${pad}.mp4`;
          mediaFolder.file(fname, blob);
          entry.video = 'media/' + fname;
        }
        if (wp.audio) {
          const blob = wp.audio instanceof Blob ? wp.audio : await fetch(wp.audio).then(r => r.blob());
          const fname = `audio_${pad}.mp3`;
          mediaFolder.file(fname, blob);
          entry.audio = 'media/' + fname;
        }
        if (wp.html) {
          const blob = wp.html instanceof Blob ? wp.html : await fetch(wp.html).then(r => r.blob());
          const fname = `page_${pad}.htm`;
          mediaFolder.file(fname, blob);
          entry.html = 'media/' + fname;
        }
        slidesData.push(entry);
      }

      const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Présentation Excursion</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#111;color:#fff;height:100vh;display:flex;flex-direction:column}
.bar{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;padding:.6rem;background:#f4f4f4;color:#222}
button{padding:.4rem .8rem;border-radius:6px;border:1px solid #ccc;background:#fff;cursor:pointer}
button:disabled{opacity:.4}
#stage{flex:1;display:flex;flex-direction:column;min-height:0;background:#000}
#photoWrap{flex:1;display:flex;align-items:center;justify-content:center;min-height:0}
#photo{max-width:100%;max-height:100%;object-fit:contain}
#caption{text-align:center;padding:.5rem;background:rgba(0,0,0,.8);font-weight:600}
#media{padding:.5rem;background:rgba(0,0,0,.85);text-align:center}
video,audio{max-width:min(100%,640px)}
#modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);align-items:center;justify-content:center;padding:1rem;z-index:9}
#modal.open{display:flex}
#modalInner{background:#fff;color:#222;border-radius:10px;width:min(96vw,900px);height:min(88vh,700px);display:flex;flex-direction:column;overflow:hidden}
#modalInner header{display:flex;justify-content:space-between;padding:.6rem 1rem;border-bottom:1px solid #ddd}
iframe{flex:1;border:0;width:100%}
#commentText{flex:1;overflow:auto;padding:1rem;white-space:pre-wrap}
</style>
</head>
<body>
<div class="bar">
  <button id="prev">◀</button>
  <span id="counter">1 / 1</span>
  <button id="next">▶</button>
  <button id="btnComment">💬 Commentaire</button>
</div>
<div id="stage">
  <div id="photoWrap"><img id="photo" alt=""/></div>
  <div id="caption"></div>
  <div id="media"></div>
</div>
<div id="modal"><div id="modalInner">
  <header><strong id="modalTitle">Commentaire</strong><button id="closeModal">✕</button></header>
  <iframe id="frame"></iframe>
  <div id="commentText" style="display:none"></div>
</div></div>
<script>
const slides = ${JSON.stringify(slidesData)};
let i = 0;
const photo = document.getElementById('photo');
const caption = document.getElementById('caption');
const media = document.getElementById('media');
const counter = document.getElementById('counter');
const prev = document.getElementById('prev');
const next = document.getElementById('next');
const btnComment = document.getElementById('btnComment');
const modal = document.getElementById('modal');
function show(idx){
  i = idx;
  const s = slides[i];
  counter.textContent = (i+1)+' / '+slides.length;
  prev.disabled = i===0; next.disabled = i===slides.length-1;
  caption.textContent = s.name;
  photo.style.display = s.photo ? 'block' : 'none';
  photo.src = s.photo || '';
  media.innerHTML = '';
  if(s.video){ const v=document.createElement('video'); v.controls=true; v.playsInline=true; v.src=s.video; media.appendChild(v); }
  else if(s.audio){ const a=document.createElement('audio'); a.controls=true; a.src=s.audio; media.appendChild(a); }
  btnComment.disabled = !(s.html || s.comment);
}
prev.onclick=()=>show(i-1);
next.onclick=()=>show(i+1);
btnComment.onclick=()=>{
  const s=slides[i];
  document.getElementById('modalTitle').textContent=s.name;
  const frame=document.getElementById('frame');
  const ct=document.getElementById('commentText');
  if(s.html){ frame.src=s.html; frame.style.display='block'; ct.style.display='none'; }
  else { frame.removeAttribute('src'); frame.style.display='none'; ct.textContent=s.comment||''; ct.style.display='block'; }
  modal.classList.add('open');
};
document.getElementById('closeModal').onclick=()=>{ modal.classList.remove('open'); document.getElementById('frame').removeAttribute('src'); };
document.addEventListener('keydown',e=>{
  if(e.key==='ArrowRight') show(Math.min(i+1,slides.length-1));
  if(e.key==='ArrowLeft') show(Math.max(i-1,0));
  if(e.key==='Escape') modal.classList.remove('open');
});
show(0);
</script>
</body>
</html>`;

      zip.file('index.html', html);
      const content = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(content);
      a.download = 'excursion-presentation.zip';
      a.click();
      URL.revokeObjectURL(a.href);
      showStatus('Présentation HTML (ZIP) téléchargée');
    } catch (err) {
      console.error(err);
      showStatus('Erreur export HTML : ' + err.message, 4000);
    }
  }

  // ---------- Événements ----------
  function bindEvents() {
    // Mode switch
    document.querySelectorAll('input[name="mode"]').forEach(r => {
      r.addEventListener('change', e => switchMode(e.target.value));
    });

    // Présentation
    document.getElementById('file-input-pres').addEventListener('change', async (e) => {
      if (e.target.files[0]) {
        await loadFileVisite(e.target.files[0]);
        initPresentation();
      }
      e.target.value = '';
    });
    document.getElementById('btn-pres-prev').addEventListener('click', () => showPresentationSlide(state.presIndex - 1));
    document.getElementById('btn-pres-next').addEventListener('click', () => showPresentationSlide(state.presIndex + 1));
    document.getElementById('btn-pres-comment').addEventListener('click', openPresComment);
    document.getElementById('pres-comment-close').addEventListener('click', closePresComment);
    document.getElementById('pres-comment-modal').addEventListener('click', (e) => {
      if (e.target.id === 'pres-comment-modal') closePresComment();
    });
    document.getElementById('btn-pres-export-pptx').addEventListener('click', exportPresentationPptx);
    document.getElementById('btn-pres-export-html').addEventListener('click', exportPresentationHtml);
    document.getElementById('btn-pres-fullscreen').addEventListener('click', () => {
      const stage = document.getElementById('panel-presentation');
      if (!document.fullscreenElement) stage.requestFullscreen?.().catch(() => {});
      else document.exitFullscreen?.();
    });
    document.addEventListener('keydown', (e) => {
      if (state.mode !== 'presentation') return;
      if (e.key === 'ArrowRight') showPresentationSlide(state.presIndex + 1);
      if (e.key === 'ArrowLeft') showPresentationSlide(state.presIndex - 1);
      if (e.key === 'Escape') closePresComment();
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
      pendingRemove.photo = pendingRemove.video = pendingRemove.audio = pendingRemove.html = false;
      refreshWpList();
    });

    // Retirer un média attaché (photo, vidéo, audio, HTML)
    document.querySelectorAll('.btn-remove-media').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.media;
        if (!key) return;
        pendingRemove[key] = true;
        const input = document.getElementById(`wp-${key}`);
        if (input) input.value = '';
        const wp = state.waypoints.find(w => w.id === state.currentWpId);
        updateMediaStatus(wp);
        showStatus(`${key} sera retiré à l’enregistrement`);
      });
    });

    // Nouveau fichier choisi → annule le retrait en attente pour ce type
    ['photo', 'video', 'audio', 'html'].forEach((key) => {
      const input = document.getElementById(`wp-${key}`);
      if (!input) return;
      input.addEventListener('change', () => {
        if (input.files[0]) {
          pendingRemove[key] = false;
          const status = document.getElementById(`wp-${key}-status`);
          if (status) {
            status.classList.remove('hidden');
            const label = status.querySelector('.media-status-label');
            if (label) label.textContent = `📎 ${input.files[0].name}`;
          }
        }
      });
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

    // GPS temps réel (Production + Visite)
    document.getElementById('btn-geoloc-prod').addEventListener('click', () => {
      if (geoState.active) {
        // Déjà actif : recentrer sur la position
        centerOnUser();
      } else {
        toggleGeolocation();
      }
    });
    document.getElementById('btn-geoloc-visite').addEventListener('click', () => {
      if (geoState.active) {
        centerOnUser();
      } else {
        toggleGeolocation();
      }
    });
    // Appui long (≈600 ms) pour désactiver le GPS
    ['btn-geoloc-prod', 'btn-geoloc-visite'].forEach((id) => {
      const btn = document.getElementById(id);
      let pressTimer = null;
      const startPress = (e) => {
        pressTimer = setTimeout(() => {
          pressTimer = null;
          if (geoState.active) stopGeolocation();
        }, 600);
      };
      const cancelPress = () => {
        if (pressTimer) {
          clearTimeout(pressTimer);
          pressTimer = null;
        }
      };
      btn.addEventListener('touchstart', startPress, { passive: true });
      btn.addEventListener('mousedown', startPress);
      btn.addEventListener('touchend', cancelPress);
      btn.addEventListener('mouseup', cancelPress);
      btn.addEventListener('mouseleave', cancelPress);
    });

    // Visite navigation
    document.getElementById('btn-prev').addEventListener('click', () => goToVisite(state.visiteIndex - 1));
    document.getElementById('btn-next').addEventListener('click', () => goToVisite(state.visiteIndex + 1));

    // Lightbox « Agrandir » (photo + vidéo)
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    const lightboxVideo = document.getElementById('lightbox-video');

    function openLightboxImage(src) {
      if (!src) return;
      lightboxVideo.pause();
      lightboxVideo.removeAttribute('src');
      lightboxVideo.classList.add('hidden');
      lightboxImg.src = src;
      lightboxImg.classList.remove('hidden');
      lightbox.classList.remove('hidden');
    }

    function openLightboxVideo(src) {
      if (!src) return;
      lightboxImg.removeAttribute('src');
      lightboxImg.classList.add('hidden');
      lightboxVideo.src = src;
      lightboxVideo.classList.remove('hidden');
      lightbox.classList.remove('hidden');
      // Lecture auto après ouverture
      lightboxVideo.play().catch(() => {});
    }

    function closeLightbox() {
      lightbox.classList.add('hidden');
      lightboxImg.removeAttribute('src');
      lightboxImg.classList.add('hidden');
      lightboxVideo.pause();
      lightboxVideo.removeAttribute('src');
      lightboxVideo.classList.add('hidden');
    }

    // Délégation : vignette / bouton Agrandir photo ou vidéo
    document.addEventListener('click', (e) => {
      const btnImg = e.target.closest('.exc-btn-agrandir');
      const btnVid = e.target.closest('.exc-btn-agrandir-video');
      const img = e.target.closest('.exc-popup-img');
      // Clic sur la zone vidéo (pas sur les contrôles natifs uniquement — dbl-safe)
      const vid = e.target.closest('.exc-popup-video');

      if (btnImg) {
        e.preventDefault();
        e.stopPropagation();
        openLightboxImage(btnImg.dataset.fullsrc);
      } else if (img && img.dataset.fullsrc) {
        e.preventDefault();
        e.stopPropagation();
        openLightboxImage(img.dataset.fullsrc);
      } else if (btnVid) {
        e.preventDefault();
        e.stopPropagation();
        openLightboxVideo(btnVid.dataset.fullsrc);
      } else if (vid && vid.dataset.fullsrc && e.target === vid) {
        // Clic sur l’élément video lui-même (hors contrôles selon navigateurs)
        e.preventDefault();
        e.stopPropagation();
        openLightboxVideo(vid.dataset.fullsrc);
      }
    });

    // Double-clic sur la vidéo de la popup → agrandir (plus fiable que le simple clic avec controls)
    document.addEventListener('dblclick', (e) => {
      const vid = e.target.closest('.exc-popup-video');
      if (vid && vid.dataset.fullsrc) {
        e.preventDefault();
        e.stopPropagation();
        openLightboxVideo(vid.dataset.fullsrc);
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
