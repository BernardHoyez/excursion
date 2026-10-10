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

  // ---------- Initialisation des cartes ----------
  function initMaps() {
    mapProd = L.map('map-prod', { zoomControl: true }).setView([46.6, 2.4], 6);
    mapVisite = L.map('map-visite', { zoomControl: true }).setView([46.6, 2.4], 6);

    L.tileLayer(BASEMAPS.osm.url, { attribution: BASEMAPS.osm.attr, maxZoom: 19 }).addTo(mapProd);
    L.tileLayer(BASEMAPS.osm.url, { attribution: BASEMAPS.osm.attr, maxZoom: 19 }).addTo(mapVisite);

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

  function setBasemap(map, key) {
    map.eachLayer(l => {
      if (l instanceof L.TileLayer) map.removeLayer(l);
    });
    const bm = BASEMAPS[key] || BASEMAPS.osm;
    L.tileLayer(bm.url, { attribution: bm.attr, maxZoom: 19 }).addTo(map);
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

  function createMarkerIcon(wp) {
    const hasPhoto = !!wp.photo;
    const html = hasPhoto
      ? `<div style="background:#1a5f2a;color:white;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:14px;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)">📷</div>`
      : `<div style="background:#c0392b;color:white;border-radius:50%;width:22px;height:22px;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`;
    return L.divIcon({
      className: '',
      html,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });
  }

  function updateMarkers(mapType) {
    const group = mapType === 'prod' ? markersProd : markersVisite;
    const map = mapType === 'prod' ? mapProd : mapVisite;
    group.clearLayers();

    state.waypoints.forEach(wp => {
      const marker = L.marker([wp.lat, wp.lng], { icon: createMarkerIcon(wp), draggable: mapType === 'prod' });
      marker.wpId = wp.id;

      if (mapType === 'prod') {
        marker.on('dragend', (e) => {
          const pos = e.target.getLatLng();
          wp.lat = pos.lat;
          wp.lng = pos.lng;
        });
        marker.on('click', () => selectWaypoint(wp.id));
      } else {
        marker.on('click', () => {
          const idx = state.waypoints.findIndex(w => w.id === wp.id);
          goToVisite(idx);
        });
      }

      // Popup basique
      marker.bindPopup(() => buildPopupContent(wp, mapType === 'visite'));
      group.addLayer(marker);
      wp.marker = marker;
    });
  }

  function buildPopupContent(wp, isVisite) {
    let html = `<strong>${wp.name}</strong>`;
    if (wp.comment) {
      html += `<div style="margin:0.4rem 0;font-size:0.9rem">${wp.comment}</div>`;
    }
    html += '<div class="popup-media">';

    if (wp.photo) {
      const src = typeof wp.photo === 'string' ? wp.photo : URL.createObjectURL(wp.photo);
      html += `<img src="${src}" alt="photo" onclick="window.open(this.src)" title="Agrandir" />`;
      if (isVisite) html += `<a href="${src}" target="_blank">Agrandir</a>`;
    }
    if (wp.video) {
      const src = typeof wp.video === 'string' ? wp.video : URL.createObjectURL(wp.video);
      html += `<video controls src="${src}" style="max-width:240px"></video>`;
    }
    if (wp.audio) {
      const src = typeof wp.audio === 'string' ? wp.audio : URL.createObjectURL(wp.audio);
      html += `<audio controls src="${src}"></audio>`;
    }
    if (wp.html) {
      const src = typeof wp.html === 'string' ? wp.html : URL.createObjectURL(wp.html);
      html += `<a href="${src}" target="_blank">Ouvrir la page web</a>`;
    }
    html += '</div>';
    return html;
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
    document.getElementById('wp-comment').value = wp.comment || '';
    // Reset file inputs
    document.getElementById('wp-photo').value = '';
    document.getElementById('wp-video').value = '';
    document.getElementById('wp-audio').value = '';
    document.getElementById('wp-html').value = '';

    if (wp.marker) {
      mapProd.setView([wp.lat, wp.lng], Math.max(mapProd.getZoom(), 14));
      wp.marker.openPopup();
    }
  }

  function saveWaypointEdit() {
    const wp = state.waypoints.find(w => w.id === state.currentWpId);
    if (!wp) return;

    wp.name = document.getElementById('wp-name').value.trim() || 'Sans nom';
    wp.comment = document.getElementById('wp-comment').value.trim();

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
          comment: props.description || props.Description || props.comment || ''
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

    // Extraire les médias
    const mediaMap = {}; // nom de fichier → blob URL ou blob

    for (const [path, zipEntry] of Object.entries(zip.files)) {
      if (zipEntry.dir) continue;
      const lower = path.toLowerCase();
      const blob = await zipEntry.async('blob');
      const name = path.split('/').pop();

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
        let comment = props.description || props.Description || '';
        let photo = null, video = null, audio = null, html = null;

        // Chercher des liens vers médias dans la description ou les propriétés
        // Format simple : on regarde les ExtendedData ou la description
        if (props.photo) photo = mediaMap[props.photo] || null;
        if (props.video) video = mediaMap[props.video] || null;
        if (props.audio) audio = mediaMap[props.audio] || null;
        if (props.html) html = mediaMap[props.html] || null;

        // Fallback : chercher dans la description des noms de fichiers
        Object.keys(mediaMap).forEach(fname => {
          if (comment.includes(fname) || (props.description && props.description.includes(fname))) {
            if (/\.(jpe?g|png|gif|webp)$/i.test(fname) && !photo) photo = mediaMap[fname];
            if (/\.(mp4|webm)$/i.test(fname) && !video) video = mediaMap[fname];
            if (/\.(mp3|wav)$/i.test(fname) && !audio) audio = mediaMap[fname];
            if (/\.html?$/i.test(fname) && !html) html = mediaMap[fname];
          }
        });

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

      // Description enrichie
      let desc = wp.comment || '';
      if (photoName) desc += `\nPhoto: images/${photoName}`;
      if (videoName) desc += `\nVidéo: videos/${videoName}`;
      if (audioName) desc += `\nAudio: audios/${audioName}`;
      if (htmlName) desc += `\nHTML: html/${htmlName}`;

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

    document.getElementById('visite-info').innerHTML =
      `<strong>${wp.name}</strong><br>` +
      (wp.comment ? `<span style="font-size:0.9rem">${wp.comment}</span>` : '');

    mapVisite.setView([wp.lat, wp.lng], Math.max(mapVisite.getZoom(), 15));
    if (wp.marker) wp.marker.openPopup();

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
    document.getElementById('basemap-prod').addEventListener('change', e => setBasemap(mapProd, e.target.value));
    document.getElementById('basemap-visite').addEventListener('change', e => setBasemap(mapVisite, e.target.value));

    // Visite navigation
    document.getElementById('btn-prev').addEventListener('click', () => goToVisite(state.visiteIndex - 1));
    document.getElementById('btn-next').addEventListener('click', () => goToVisite(state.visiteIndex + 1));
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
