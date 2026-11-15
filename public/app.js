// Frontend: draws the Mapbox GL map with R/A/G markers, a synced sidebar list,
// and a per-library busyness chart built from /api/history.
//
// Coordinates: our data stores [lat, lng], but Mapbox expects [lng, lat], so
// everything handed to Mapbox goes through toLngLat().

const UCL_CENTER = [51.5246, -0.1339];
const RAG_COLORS = { green: '#2e9e4f', amber: '#e8a33d', red: '#d64545', unknown: '#9aa0a6' };

let map;
let markers = {}; // libraryId -> mapboxgl.Marker (with an attached Popup)
let libraries = []; // static metadata
let chart = null;

// User location state.
let userLatLng = null; // [lat, lng] once located
let userMarker = null; // mapboxgl.Marker for "you are here"
let lastThresholds = null; // cached so we can re-render the list after locating

const toLngLat = ([lat, lng]) => [lng, lat];

// ---- Library buildings -----------------------------------------------------
// When zoomed in, each library's whole building is coloured R/A/G instead of
// relying on a circle alone. We don't copy any building shapes: we find the
// building that Mapbox already draws under each library's coordinates and tag
// it with "feature state", which the building layer's colour then reads.

const BUILDING_ZOOM = 15; // Mapbox only includes building outlines from here
const libRag = {}; // libraryId -> 'green' | 'amber' | 'red' | 'unknown'
const libBuildingIds = {}; // libraryId -> Set of Mapbox building feature ids
const buildingToLib = new Map(); // building feature id -> libraryId

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function geometryContains(geometry, point) {
  const polygons =
    geometry.type === 'Polygon' ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates
    : [];
  return polygons.some((rings) => pointInRing(point, rings[0]));
}

function paintLibraryBuildings(libraryId) {
  const ids = libBuildingIds[libraryId];
  if (!map || !ids) return;
  ids.forEach((id) =>
    map.setFeatureState({ source: 'composite', sourceLayer: 'building', id }, { rag: libRag[libraryId] }),
  );
}

// Look through the building outlines currently loaded for ones that contain a
// library's coordinates. Runs whenever the map settles, so libraries further
// away are picked up once the user pans or zooms to them.
function findLibraryBuildings() {
  if (!map.getSource('composite') || map.getZoom() < BUILDING_ZOOM) return;
  const pending = libraries.filter((lib) => !libBuildingIds[lib.id]);
  if (!pending.length) return;

  const buildings = map
    .querySourceFeatures('composite', { sourceLayer: 'building' })
    .filter((f) => f.id != null && f.properties.underground !== 'true');

  pending.forEach((lib) => {
    const point = toLngLat(lib.coords);
    const ids = new Set(buildings.filter((f) => geometryContains(f.geometry, point)).map((f) => f.id));
    if (!ids.size) return;
    libBuildingIds[lib.id] = ids;
    ids.forEach((id) => buildingToLib.set(id, lib.id));
    paintLibraryBuildings(lib.id);
  });
  updateMarkerSizes();
}

// Zoomed in, a library whose building is coloured only needs a small dot;
// zoomed out (no buildings drawn), it keeps the full-size circle.
function updateMarkerSizes() {
  const zoomedIn = map.getZoom() >= BUILDING_ZOOM;
  libraries.forEach((lib) => {
    const marker = markers[lib.id];
    if (marker) marker.getElement().classList.toggle('small', zoomedIn && !!libBuildingIds[lib.id]);
  });
}

// Two extra layers over Mapbox's building data: a fill and an outline that are
// invisible except on buildings tagged with a library's R/A/G. We add our own
// layers rather than restyling the map's "building" layer because that layer
// hides some shapes (e.g. "building:part"), and the Main Library sits in one.
function styleLibraryBuildings() {
  const rag = ['coalesce', ['feature-state', 'rag'], ''];
  const tagged = (value) => ['match', rag, '', 0, value];
  const common = {
    source: 'composite',
    'source-layer': 'building',
    minzoom: BUILDING_ZOOM,
    filter: ['!=', ['get', 'underground'], 'true'],
  };
  // Draw below the map's labels so street and place names stay readable.
  const firstLabel = map.getStyle().layers.find((l) => l.type === 'symbol');
  const beforeId = firstLabel && firstLabel.id;

  map.addLayer(
    {
      ...common,
      id: 'library-building-fill',
      type: 'fill',
      paint: {
        'fill-color': [
          'match', rag,
          'green', RAG_COLORS.green,
          'amber', RAG_COLORS.amber,
          'red', RAG_COLORS.red,
          RAG_COLORS.unknown,
        ],
        'fill-opacity': tagged(0.75),
      },
    },
    beforeId,
  );
  map.addLayer(
    {
      ...common,
      id: 'library-building-outline',
      type: 'line',
      paint: {
        'line-color': [
          'match', rag,
          'green', '#1d6b35',
          'amber', '#a86f1a',
          'red', '#962d2d',
          '#6b7075',
        ],
        'line-width': 1.5,
        'line-opacity': tagged(1),
      },
    },
    beforeId,
  );
}

// A circle of `radiusM` metres around [lat, lng], as a GeoJSON polygon, used to
// draw the GPS accuracy halo (Mapbox has no built-in metre-radius circle).
function circlePolygon([lat, lng], radiusM, steps = 64) {
  const coords = [];
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    coords.push([lng + dLng * Math.cos(t), lat + dLat * Math.sin(t)]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] } };
}

// Haversine great-circle distance between two [lat, lng] points, in metres.
function distanceMetres([lat1, lng1], [lat2, lng2]) {
  const R = 6371000; // Earth radius (m)
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Human-friendly distance label.
function formatDistance(m) {
  if (m < 1000) return `${Math.round(m)} m away`;
  return `${(m / 1000).toFixed(1)} km away`;
}

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

function ragOf(occupancy, thresholds) {
  if (occupancy == null) return 'unknown';
  if (occupancy >= thresholds.redAt) return 'red';
  if (occupancy >= thresholds.amberAt) return 'amber';
  return 'green';
}

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Colours the busyness chart by RAG region. The y-axis is fixed at 0-100 (% full),
// so a vertical gradient with hard stops at the thresholds makes the line change
// colour exactly where it crosses into a new region.
function ragGradient(chart, alpha) {
  const { ctx, chartArea } = chart;
  if (!chartArea) return RAG_COLORS.green; // first layout pass, no area yet
  const norm = (v) => Math.min(1, Math.max(0, v > 1 ? v / 100 : v)); // accept 0.6 or 60
  const amberAt = norm(lastThresholds && lastThresholds.amberAt != null ? lastThresholds.amberAt : 0.6);
  const redAt = norm(lastThresholds && lastThresholds.redAt != null ? lastThresholds.redAt : 0.85);
  const c = (k) => hexToRgba(RAG_COLORS[k], alpha);
  const g = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
  g.addColorStop(0, c('green'));
  g.addColorStop(amberAt, c('green'));
  g.addColorStop(amberAt, c('amber'));
  g.addColorStop(redAt, c('amber'));
  g.addColorStop(redAt, c('red'));
  g.addColorStop(1, c('red'));
  return g;
}

function directionsUrl(coords, name) {
  const [lat, lng] = coords;
  // Universal Google Maps directions link (works on desktop + mobile).
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_place_id=${encodeURIComponent(
    name,
  )}`;
}

function popupHtml(lib, rec) {
  const pct = rec && rec.occupancy != null ? Math.round(rec.occupancy * 100) : null;
  const statLine =
    rec && rec.total
      ? `<p class="popup-stat">${rec.free} free of ${rec.total} desks${
          pct != null ? ` — <strong>${pct}% full</strong>` : ''
        }</p>`
      : `<p class="popup-stat muted">No live data</p>`;
  return `
    <div class="popup-title">${lib.name}</div>
    ${statLine}
    <div class="popup-actions">
      <a href="${directionsUrl(lib.coords, lib.name)}" target="_blank" rel="noopener">Directions ↗</a>
      <a href="#" data-chart="${lib.id}">Busyness graph</a>
    </div>
  `;
}

function render(current, thresholds) {
  lastThresholds = thresholds;
  const byId = {};
  (current.libraries || []).forEach((r) => (byId[r.libraryId] = r));

  // Markers
  libraries.forEach((lib) => {
    const rec = byId[lib.id];
    const rag = rec ? rec.rag || ragOf(rec.occupancy, thresholds) : 'unknown';
    libRag[lib.id] = rag;
    paintLibraryBuildings(lib.id);
    const marker = markers[lib.id];
    if (marker) {
      marker.getElement().style.background = RAG_COLORS[rag];
      marker.getPopup().setHTML(popupHtml(lib, rec));
    }
  });

  // Sidebar
  const list = document.getElementById('library-list');
  list.innerHTML = '';

  const rows = libraries.map((lib) => {
    const dist = userLatLng ? distanceMetres(userLatLng, lib.coords) : null;
    return { lib, rec: byId[lib.id], dist };
  });

  // Sort by nearest when we know the user's location, otherwise busiest first.
  rows.sort((a, b) => {
    if (userLatLng) return a.dist - b.dist;
    const oa = a.rec && a.rec.occupancy != null ? a.rec.occupancy : -1;
    const ob = b.rec && b.rec.occupancy != null ? b.rec.occupancy : -1;
    return ob - oa;
  });

  rows.forEach(({ lib, rec, dist }, index) => {
    const rag = rec ? rec.rag || ragOf(rec.occupancy, thresholds) : 'unknown';
    const pct = rec && rec.occupancy != null ? Math.round(rec.occupancy * 100) : null;

    const occText = rec && rec.total
      ? `${rec.free} free / ${rec.total}${pct != null ? ` · ${pct}% full` : ''}`
      : 'No live data';
    const distText = dist != null ? ` · ${formatDistance(dist)}` : '';
    const nearestBadge = userLatLng && index === 0 ? ' <span class="nearest-badge">Nearest</span>' : '';

    const li = document.createElement('li');
    li.className = 'lib-item';
    li.dataset.id = lib.id;
    li.innerHTML = `
      <span class="dot ${rag}"></span>
      <div class="lib-meta">
        <div class="lib-name">${lib.name}${nearestBadge}</div>
        <div class="lib-sub">${occText}${distText}</div>
        <div class="bar ${rag}"><span style="width:${pct != null ? pct : 0}%"></span></div>
      </div>`;
    li.addEventListener('click', () => {
      if (map) map.flyTo({ center: toLngLat(lib.coords), zoom: 16 });
      const marker = markers[lib.id];
      if (marker && !marker.getPopup().isOpen()) marker.togglePopup();
      showChart(lib.id, lib.name);
      document.querySelectorAll('.lib-item').forEach((el) => el.classList.remove('active'));
      li.classList.add('active');
    });
    list.appendChild(li);
  });
}

function closeChart() {
  const overlay = document.getElementById('chart-overlay');
  overlay.hidden = true;
  if (chart) {
    chart.destroy();
    chart = null;
  }
}

async function showChart(libraryId, name) {
  const overlay = document.getElementById('chart-overlay');
  const title = document.getElementById('chart-title');
  const note = document.getElementById('chart-note');
  overlay.hidden = false;
  title.textContent = `Busyness — ${name}`;

  const data = await getJSON(`/api/history?libraryId=${encodeURIComponent(libraryId)}&sinceHours=24`);
  const points = [];
  data.snapshots.forEach((snap) => {
    const rec = snap.libraries[0];
    if (rec && rec.occupancy != null) {
      points.push({ x: new Date(snap.ts), y: Math.round(rec.occupancy * 100) });
    }
  });

  if (points.length < 2) {
    note.textContent =
      'Not enough history yet — data accumulates as the tracker polls. Check back after a few polls.';
  } else {
    note.textContent = `${points.length} data points over the last 24h.`;
  }

  const labels = points.map((p) =>
    p.x.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  );
  const values = points.map((p) => p.y);

  if (chart) chart.destroy();
  const ctx = document.getElementById('busyness-chart').getContext('2d');
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: '% full',
          data: values,
          borderColor: (c) => ragGradient(c.chart, 1),
          backgroundColor: (c) => ragGradient(c.chart, 0.15),
          pointBackgroundColor: values.map((v) => RAG_COLORS[ragOf(v / 100, lastThresholds)]),
          pointBorderColor: values.map((v) => RAG_COLORS[ragOf(v / 100, lastThresholds)]),
          fill: true,
          tension: 0.3,
          pointRadius: 2,
        },
      ],
    },
    options: {
      responsive: true,
      scales: { y: { min: 0, max: 100, title: { display: true, text: '% full' } } },
      plugins: { legend: { display: false } },
    },
  });
}

// Place/refresh the "you are here" marker, center the map on it, and re-sort
// the sidebar by distance. `latlng` is [lat, lng], `accuracy` is in metres.
function setUserLocation(latlng, accuracy) {
  userLatLng = latlng;
  if (!map) {
    // No map (missing token): still re-sort the list by distance.
    if (lastThresholds) render({ libraries: buildCurrentFromMarkers() }, lastThresholds);
    return;
  }

  if (userMarker) {
    userMarker.setLngLat(toLngLat(latlng));
  } else {
    const el = document.createElement('div');
    el.className = 'user-marker';
    el.title = 'Your location';
    userMarker = new mapboxgl.Marker({ element: el })
      .setLngLat(toLngLat(latlng))
      .setPopup(new mapboxgl.Popup({ offset: 12 }).setHTML('<strong>You are here</strong>'))
      .addTo(map);
  }

  // Accuracy halo, drawn as a filled polygon layer (needs the style loaded).
  if (map.isStyleLoaded()) drawAccuracyHalo(latlng, accuracy);
  else map.once('load', () => drawAccuracyHalo(latlng, accuracy));

  // Center on the user, zoomed in enough to see nearby libraries.
  map.flyTo({ center: toLngLat(latlng), zoom: 16 });

  // Re-render the sidebar so it sorts by distance and shows "X m away".
  if (lastThresholds) {
    render({ libraries: buildCurrentFromMarkers() }, lastThresholds);
  }
}

function drawAccuracyHalo(latlng, accuracy) {
  const halo = circlePolygon(latlng, accuracy || 0);
  const source = map.getSource('user-accuracy');
  if (source) {
    source.setData(halo);
  } else {
    map.addSource('user-accuracy', { type: 'geojson', data: halo });
    map.addLayer({
      id: 'user-accuracy-fill',
      type: 'fill',
      source: 'user-accuracy',
      paint: { 'fill-color': '#1a56db', 'fill-opacity': 0.1 },
    });
    map.addLayer({
      id: 'user-accuracy-line',
      type: 'line',
      source: 'user-accuracy',
      paint: { 'line-color': '#1a56db', 'line-width': 1 },
    });
  }
}

// Reconstruct the "current" occupancy shape from what the markers already hold,
// so we can re-render the list after locating without refetching.
let lastCurrent = null;
function buildCurrentFromMarkers() {
  return lastCurrent ? lastCurrent.libraries : [];
}

// Ask the browser for the user's location.
function locateUser() {
  const btn = document.getElementById('locate-btn');
  const status = document.getElementById('locate-status');

  if (!('geolocation' in navigator)) {
    status.textContent = 'Geolocation is not supported by this browser.';
    return;
  }

  // Geolocation requires a secure context (https or localhost).
  if (!window.isSecureContext) {
    status.textContent = 'Location needs a secure (https) connection.';
    return;
  }

  btn.disabled = true;
  status.textContent = 'Locating…';

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      setUserLocation([latitude, longitude], accuracy);
      btn.disabled = false;
      btn.textContent = '📍 Recentre on me';
      status.textContent = '';
    },
    (err) => {
      btn.disabled = false;
      const messages = {
        1: 'Location permission denied.',
        2: 'Location unavailable right now.',
        3: 'Location request timed out.',
      };
      status.textContent = messages[err.code] || 'Could not get your location.';
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
  );
}

async function init() {
  // Static metadata (includes the Mapbox token and style from the server).
  const meta = await getJSON('/api/libraries');
  libraries = meta.libraries;
  document.getElementById('source-name').textContent = meta.source;

  // Map
  const mapEl = document.getElementById('map');
  if (!meta.mapbox || !meta.mapbox.token) {
    mapEl.innerHTML =
      '<p class="map-message">Map unavailable: set MAPBOX_TOKEN in .env (see .env.example) and restart the server.</p>';
  } else {
    mapboxgl.accessToken = meta.mapbox.token;
    map = new mapboxgl.Map({
      container: mapEl,
      style: meta.mapbox.style,
      center: toLngLat(UCL_CENTER),
      zoom: 15,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-left');
    // Don't wait for the map's 'load' event here: markers can be added straight
    // away, and waiting would leave the library list empty until every map
    // label has downloaded.
  }

  // "Find my location" button.
  const locateBtn = document.getElementById('locate-btn');
  if (locateBtn) locateBtn.addEventListener('click', locateUser);

  // Chart overlay: close on backdrop/button click or Escape.
  document.querySelectorAll('#chart-overlay [data-close]').forEach((el) => {
    el.addEventListener('click', closeChart);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeChart();
  });

  // "Busyness graph" links inside popups. Popups are re-rendered on every
  // refresh, so listen once at the document level instead of per popup.
  document.addEventListener('click', (ev) => {
    const link = ev.target.closest('[data-chart]');
    if (!link) return;
    ev.preventDefault();
    const lib = libraries.find((l) => l.id === link.dataset.chart);
    if (lib) showChart(lib.id, lib.name);
  });

  // Markers: one HTML element per library, coloured by R/A/G in render().
  if (map) {
    libraries.forEach((lib) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'lib-marker';
      el.style.background = RAG_COLORS.unknown;
      el.setAttribute('aria-label', lib.name);
      markers[lib.id] = new mapboxgl.Marker({ element: el })
        .setLngLat(toLngLat(lib.coords))
        .setPopup(new mapboxgl.Popup({ offset: 14, maxWidth: '260px', focusAfterOpen: false }))
        .addTo(map);
    });

    // Coloured library buildings (see "Library buildings" above).
    const setUpBuildings = () => {
      styleLibraryBuildings();
      findLibraryBuildings();
    };
    if (map.isStyleLoaded()) setUpBuildings();
    else map.once('style.load', setUpBuildings);
    map.on('idle', findLibraryBuildings);
    map.on('zoom', updateMarkerSizes);

    // Tapping a coloured building opens that library's popup.
    map.on('click', 'library-building-fill', (e) => {
      const hit = e.features.find((f) => buildingToLib.has(f.id));
      const marker = hit && markers[buildingToLib.get(hit.id)];
      if (marker && !marker.getPopup().isOpen()) marker.togglePopup();
    });
    map.on('mousemove', 'library-building-fill', (e) => {
      map.getCanvas().style.cursor = e.features.some((f) => buildingToLib.has(f.id)) ? 'pointer' : '';
    });
    map.on('mouseleave', 'library-building-fill', () => {
      map.getCanvas().style.cursor = '';
    });
  }

  // Current data + periodic refresh
  async function refresh() {
    try {
      const current = await getJSON('/api/current');
      lastCurrent = current;
      render(current, meta.thresholds);
      const status = document.getElementById('status');
      const ts = new Date(current.ts);
      status.textContent = `Updated ${ts.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })} · source: ${current.source}`;
    } catch (err) {
      document.getElementById('status').textContent = `Error: ${err.message}`;
    }
  }

  await refresh();
  setInterval(refresh, 60 * 1000); // refresh the view every minute
}

init();