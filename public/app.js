// Frontend: draws the Leaflet map with R/A/G markers, a synced sidebar list,
// and a per-library busyness chart built from /api/history.

const UCL_CENTER = [51.5246, -0.1339];
const RAG_COLORS = { green: '#2e9e4f', amber: '#e8a33d', red: '#d64545', unknown: '#9aa0a6' };

let map;
let markers = {}; // libraryId -> L.CircleMarker
let libraries = []; // static metadata
let chart = null;

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
  libraries
    .map((lib) => ({ lib, rec: byId[lib.id] }))
    .sort((a, b) => {
      const oa = a.rec && a.rec.occupancy != null ? a.rec.occupancy : -1;
      const ob = b.rec && b.rec.occupancy != null ? b.rec.occupancy : -1;
      return ob - oa; // busiest first
    })
    .forEach(({ lib, rec }) => {
      const rag = rec ? rec.rag || ragOf(rec.occupancy, thresholds) : 'unknown';
      const pct = rec && rec.occupancy != null ? Math.round(rec.occupancy * 100) : null;
      const li = document.createElement('li');
      li.className = 'lib-item';
      li.dataset.id = lib.id;
      li.innerHTML = `
        <span class="dot ${rag}"></span>
        <div class="lib-meta">
          <div class="lib-name">${lib.name}</div>
          <div class="lib-sub">${
            rec && rec.total
              ? `${rec.free} free / ${rec.total}${pct != null ? ` · ${pct}% full` : ''}`
              : 'No live data'
          }</div>
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

async function showChart(libraryId, name) {
  const panel = document.getElementById('chart-panel');
  const title = document.getElementById('chart-title');
  const note = document.getElementById('chart-note');
  panel.hidden = false;
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

async function init() {
  // Map
  map = L.map('map').setView(UCL_CENTER, 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map);

  // Static metadata + markers
  const meta = await getJSON('/api/libraries');
  libraries = meta.libraries;
  document.getElementById('source-name').textContent = meta.source;

  libraries.forEach((lib) => {
    const m = L.circleMarker(lib.coords, {
      radius: 9,
      weight: 2,
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
