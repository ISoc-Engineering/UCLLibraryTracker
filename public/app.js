// Frontend: draws the Leaflet map with R/A/G markers, a synced sidebar list,
// and a per-library busyness chart built from /api/history.

const UCL_CENTER = [51.5246, -0.1339];
const RAG_COLORS = { green: '#2e9e4f', amber: '#e8a33d', red: '#d64545', unknown: '#9aa0a6' };

let map;
let markers = {}; // libraryId -> L.CircleMarker
let libraries = []; // static metadata
let chart = null;

// User location state.
let userLatLng = null; // [lat, lng] once located
let userMarker = null; // L.Marker for "you are here"
let userAccuracyCircle = null; // L.Circle showing GPS accuracy
let lastThresholds = null; // cached so we can re-render the list after locating

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
    const marker = markers[lib.id];
    if (marker) {
      marker.setStyle({ fillColor: RAG_COLORS[rag], color: '#fff' });
      marker.bindPopup(popupHtml(lib, rec));
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
      map.setView(lib.coords, 16, { animate: true });
      markers[lib.id] && markers[lib.id].openPopup();
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
          borderColor: '#1a56db',
          backgroundColor: 'rgba(26,86,219,0.12)',
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

  if (userMarker) {
    userMarker.setLatLng(latlng);
  } else {
    userMarker = L.marker(latlng, {
      title: 'Your location',
      zIndexOffset: 1000,
    }).addTo(map);
    userMarker.bindPopup('<strong>You are here</strong>');
  }

  // Accuracy halo.
  if (userAccuracyCircle) {
    userAccuracyCircle.setLatLng(latlng).setRadius(accuracy || 0);
  } else if (accuracy) {
    userAccuracyCircle = L.circle(latlng, {
      radius: accuracy,
      color: '#1a56db',
      weight: 1,
      fillColor: '#1a56db',
      fillOpacity: 0.1,
    }).addTo(map);
  }

  // Center on the user, zoomed in enough to see nearby libraries.
  map.setView(latlng, 16, { animate: true });

  // Re-render the sidebar so it sorts by distance and shows "X m away".
  if (lastThresholds) {
    render({ libraries: buildCurrentFromMarkers() }, lastThresholds);
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
  // Map
  map = L.map('map').setView(UCL_CENTER, 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map);

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

  // Static metadata + markers
  const meta = await getJSON('/api/libraries');
  libraries = meta.libraries;
  document.getElementById('source-name').textContent = meta.source;

  libraries.forEach((lib) => {
    const m = L.circleMarker(lib.coords, {
      radius: 12,
      weight: 2.5,
      color: '#fff',
      fillColor: RAG_COLORS.unknown,
      fillOpacity: 0.95,
    }).addTo(map);
    m.on('popupopen', (e) => {
      const link = e.popup.getElement().querySelector('[data-chart]');
      if (link) {
        link.addEventListener('click', (ev) => {
          ev.preventDefault();
          showChart(lib.id, lib.name);
        });
      }
    });
    markers[lib.id] = m;
  });

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
