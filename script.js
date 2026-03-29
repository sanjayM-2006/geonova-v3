// ==================== GEO-NOVA V3 CORE ENGINE ====================
const geoCache = new Map(); // Global Spatial Cache
let searchMarker = null;    // Global Search Pin

// --- Accordion Logic ---
document.querySelectorAll('.accordion-header').forEach(btn => {
  btn.onclick = () => {
    const item = btn.parentElement;
    item.classList.toggle('active');
  };
});

// --- Map Initialization ---
const map = new maplibregl.Map({
  container: 'map',
  preserveDrawingBuffer: true,
  center: [78.9629, 20.5937],
  zoom: 2.2, // Start zoomed out to see the globe
  pitch: 0,
  maxPitch: 85,
  style: {
    version: 8,
    sources: {
      'google-hybrid': { type: 'raster', tiles: ['https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}'], tileSize: 256 },
      'google-sat': { type: 'raster', tiles: ['https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'], tileSize: 256 },
      'osm-street': { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256 },
      'aws-terrain': {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 14
      }
    },
    layers: [
      { id: 'hybrid-layer', type: 'raster', source: 'google-hybrid', layout: { visibility: 'visible' } },
      { id: 'satellite-layer', type: 'raster', source: 'google-sat', layout: { visibility: 'none' } },
      { id: 'osm-layer', type: 'raster', source: 'osm-street', layout: { visibility: 'none' } },
      { id: 'hillshade-layer', type: 'hillshade', source: 'aws-terrain', layout: { visibility: 'none' }, paint: { 'hillshade-shadow-color': '#0f172a', 'hillshade-exaggeration': 0.8 } }
    ]
  }
});

map.on('style.load', () => {
  map.setProjection({ type: 'globe' });
});

// ==================== AUTO SPACE ROTATION ====================
// Animates a realistic rotation in space when fully zoomed out
let userInteracting = false;
map.on('mousedown', () => userInteracting = true);
map.on('dragstart', () => userInteracting = true);
map.on('zoomstart', () => userInteracting = true);
map.on('mouseup', () => userInteracting = false);
map.on('dragend', () => userInteracting = false);
map.on('zoom', () => {
  // If user scrolls all the way out past the Earth's orbit, automatically enter deep space
  if (map.getZoom() < 1.0 && !spaceActive) {
    smoothTransition('space');
  }
});
map.on('zoomend', () => userInteracting = false);
function rotateCamera(timestamp) {
  // Only rotate if not interacting, zoomed out, and not in Solar System mode
  if (!userInteracting && map.getZoom() < 3.5 && (typeof spaceActive === 'undefined' || !spaceActive)) {
    const center = map.getCenter();
    center.lng += 0.05; // degree increment per frame
    map.jumpTo({ center: center });
  }
  requestAnimationFrame(rotateCamera);
}
requestAnimationFrame(rotateCamera);

// map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-left'); // Removed Zoom +/- boxes
map.addControl(new maplibregl.ScaleControl({ maxWidth: 80, unit: 'metric' }), 'bottom-left');

// --- Compass HUD Sync ---
const initCompassTicks = () => {
  const container = document.querySelector('.compass-ticks');
  if(!container) return;
  for(let i=0; i<360; i+=10) {
    const tick = document.createElement('div');
    tick.style.cssText = `position:absolute;top:50%;left:50%;width:1px;height:${i%30===0?8:4}px;background:rgba(255,255,255,${i%90===0?0.8:0.3});transform:translate(-50%, -50%) rotate(${i}deg) translateY(-58px);`;
    container.appendChild(tick);
  }
};
initCompassTicks();

const updateCompass = () => {
  const dial = document.querySelector('.compass-dial');
  const needle = document.querySelector('.compass-needle');
  if (!dial || !needle) return;
  
  const bearing = map.getBearing();
  const pitch = map.getPitch();
  
  // Rotate dial and needle
  dial.style.transform = `rotate(${-bearing}deg)`;
  needle.style.transform = `rotate(${-bearing}deg) rotateX(${pitch}deg)`;
  
  // Update telemetry
  const headingStr = Math.round((bearing + 360) % 360).toString().padStart(3, '0');
  document.getElementById('telHeading').innerText = `${headingStr}°`;
  document.getElementById('telDip').innerText = `${Math.round(pitch)}°`;
};
map.on('rotate', updateCompass);
map.on('pitch', updateCompass);
map.on('move', updateCompass);

document.getElementById('resetViewBtn')?.addEventListener('click', () => {
  map.easeTo({ bearing: 0, pitch: 0, duration: 1500 });
});

// --- Loader Removal ---
map.once('idle', () => {
  const loader = document.getElementById('loader');
  loader.style.opacity = '0';
  setTimeout(() => loader.style.visibility = 'hidden', 1500);
});

let mapLoaded = false;
map.on('load', () => {
  mapLoaded = true;

  // Environment Sources
  map.addSource('google-traffic', { type: 'raster', tiles: ['https://mt1.google.com/vt?lyrs=h@159000000,traffic|seconds_into_week:-1&style=3&x={x}&y={y}&z={z}'], tileSize: 256 });
  map.addLayer({ id: 'traffic-layer', type: 'raster', source: 'google-traffic', layout: { visibility: 'none' } });

  map.addSource('landcover-wms', { type: 'raster', tiles: ['https://services.terrascope.be/wms/v2?service=WMS&request=GetMap&layers=WORLDCOVER_2021_MAP&styles=&format=image/png&transparent=true&version=1.1.1&width=256&height=256&srs=EPSG:3857&bbox={bbox-epsg-3857}'], tileSize: 256 });
  map.addLayer({ id: 'landcover-layer', type: 'raster', source: 'landcover-wms', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.7 } });

  map.addSource('faults', { type: 'geojson', data: 'https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json' });
  map.addLayer({ id: 'faults-layer', type: 'line', source: 'faults', layout: { visibility: 'none' }, paint: { 'line-color': '#ef4444', 'line-width': 2 } });

  // Rainviewer Weather Radar
  const currentTime = Math.floor(Date.now() / 1000) - 1800; // Approx 30 mins ago
  map.addSource('radar', { type: 'raster', tiles: [`https://tilecache.rainviewer.com/v2/radar/${currentTime}/256/{z}/{x}/{y}/2/1_1.png`], tileSize: 256 });
  map.addLayer({ id: 'radar-layer', type: 'raster', source: 'radar', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.7 } });

  // UI Layers
  map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'route-layer', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#0ea5e9', 'line-width': 5 } });

  map.addSource('pois', { type: 'geojson', cluster: true, clusterMaxZoom: 14, clusterRadius: 50, data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'poi-layer', type: 'circle', source: 'pois', filter: ['!', ['has', 'point_count']], paint: { 'circle-color': '#f97316', 'circle-radius': 6, 'circle-stroke-width': 1, 'circle-stroke-color': '#fff' } });

  map.addSource('earthquakes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'eq-layer', type: 'circle', source: 'earthquakes', layout: { visibility: 'none' }, paint: { 'circle-color': '#ef4444', 'circle-radius': ['*', ['get', 'mag'], 2], 'circle-opacity': 0.8 } });

  // ISS Tracker Source
  map.addSource('iss', { type: 'geojson', data: { type: 'Point', coordinates: [0, 0] } });
  const issEl = document.createElement('div');
  issEl.className = 'iss-icon';
  window.issMarker = new maplibregl.Marker({ element: issEl }).setLngLat([0, 0]);

  // USGS GEOLOGIC WMS
  map.addSource('usgs-geology', { type: 'raster', tiles: ['https://mrdata.usgs.gov/services/geology?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=geology&STYLES=&SRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=TRUE'], tileSize: 256 });
  map.addLayer({ id: 'usgs-geology-layer', type: 'raster', source: 'usgs-geology', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.6 } });

  map.addSource('usgs-faults', { type: 'raster', tiles: ['https://mrdata.usgs.gov/services/qfaults?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=qfaults&STYLES=&SRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=TRUE'], tileSize: 256 });
  map.addLayer({ id: 'usgs-faults-layer', type: 'raster', source: 'usgs-faults', layout: { visibility: 'none' } });
});

// ==================== SIDEBAR & MODULE TOGGLES ====================
const sidebar = document.getElementById('sidebar');
const toggleIcon = document.getElementById('toggleIcon');
document.getElementById('toggleSidebarBtn').onclick = () => {
  sidebar.classList.toggle('collapsed');
  toggleIcon.classList.toggle('fa-chevron-right');
  toggleIcon.classList.toggle('fa-chevron-left');
};

function setBasemap(type) {
  if (!mapLoaded) return;
  const layers = ['hybrid-layer', 'satellite-layer', 'osm-layer'];
  const btns = ['hybridBtn', 'satelliteBtn', 'osmBtn', 'clearBasemapBtn'];
  
  // Reset UI
  btns.forEach(id => {
    const el = document.getElementById(id);
    if(el) { el.classList.remove('active'); el.style.background = 'rgba(255,255,255,0.05)'; }
  });
  
  // Hide all
  layers.forEach(lyr => map.setLayoutProperty(lyr, 'visibility', 'none'));

  if (type === 'none') {
    document.getElementById('clearBasemapBtn').classList.add('active');
    toast("Basemaps Deactivated.");
    return;
  }

  const targetLayer = `${type}-layer`;
  const targetBtn = `${type}Btn`;
  
  if (map.getLayer(targetLayer)) {
    map.setLayoutProperty(targetLayer, 'visibility', 'visible');
    document.getElementById(targetBtn).classList.add('active');
    toast(`Basemap set to: ${type.toUpperCase()}`);
  }
}

document.getElementById('hybridBtn').onclick = () => setBasemap('hybrid');
document.getElementById('satelliteBtn').onclick = () => setBasemap('satellite');
document.getElementById('osmBtn').onclick = () => setBasemap('osm');
document.getElementById('clearBasemapBtn').onclick = () => setBasemap('none');

let terrainActive = false;
document.getElementById('terrainBtn').onclick = function() {
  terrainActive = !terrainActive;
  if(terrainActive) {
    this.style.background = '#f59e0b';
    this.style.color = '#fff';
    map.setTerrain({ source: 'aws-terrain', exaggeration: 1.5 });
    map.setLayoutProperty('hillshade-layer', 'visibility', 'visible');
    map.easeTo({ pitch: 70, duration: 1500 });
    toast("3D Topography Activated");
  } else {
    this.style.background = '#1e293b';
    map.setTerrain(null);
    map.setLayoutProperty('hillshade-layer', 'visibility', 'none');
    map.easeTo({ pitch: 0, duration: 1000 });
    toast("Flat Plane Resumed");
  }
};

function setupToggle(btnId, layerId, label) {
  document.getElementById(btnId).onclick = function() {
    if(!mapLoaded) return;
    const isVis = map.getLayoutProperty(layerId, 'visibility') === 'visible';
    map.setLayoutProperty(layerId, 'visibility', isVis ? 'none' : 'visible');
    this.classList.toggle('active');
    toast(`${label} ${isVis ? 'Deactivated' : 'Activated'}`);
  };
}
setupToggle('trafficBtn', 'traffic-layer', 'Live Traffic');
setupToggle('landcoverBtn', 'landcover-layer', 'ESA Land Cover');
setupToggle('faultLineBtn', 'faults-layer', 'Tectonic Faults');
setupToggle('radarBtn', 'radar-layer', 'Live Weather Radar');
setupToggle('usgsMapBtn', 'usgs-geology-layer', 'USGS Geological Map');
setupToggle('usgsFaultBtn', 'usgs-faults-layer', 'USGS Quaternary Faults');


// ==================== LIVE ISS TRACKER ====================
let issInterval = null;
document.getElementById('issBtn').onclick = function() {
  this.classList.toggle('active');
  if(this.classList.contains('active')) {
    toast("Locating International Space Station...");
    window.issMarker.addTo(map);
    
    // Poll API immediately and then every 3 seconds
    const fetchISS = async () => {
      try {
        const res = await fetch('http://api.open-notify.org/iss-now.json');
        if(!res.ok) return;
        const data = await res.json();
        const lat = parseFloat(data.iss_position.latitude);
        const lon = parseFloat(data.iss_position.longitude);
        window.issMarker.setLngLat([lon, lat]);
        map.getSource('iss').setData({ type: 'Point', coordinates: [lon, lat] });
      } catch (e) {}
    };
    fetchISS();
    issInterval = setInterval(fetchISS, 3000);
  } else {
    clearInterval(issInterval);
    window.issMarker.remove();
    toast("ISS Tracker Disabled");
  }
};


// ==================== CINEMATIC TOUR ====================
const tourLocations = [
  { coord: [86.9250, 27.9881], title: "Mount Everest Suite", zoom: 12, pitch: 75, bearing: 45 },
  { coord: [-112.1129, 36.1069], title: "Grand Canyon Depths", zoom: 11, pitch: 65, bearing: 120 },
  { coord: [8.6515, 46.5771], title: "The Swiss Alps", zoom: 10, pitch: 70, bearing: -30 },
  { coord: [138.7274, 35.3606], title: "Mount Fuji Summit", zoom: 11, pitch: 60, bearing: 90 }
];
let tourActive = false;
let tourIndex = 0;

document.getElementById('tourBtn').onclick = function() {
  if(!terrainActive) document.getElementById('terrainBtn').click(); // Force 3D
  tourActive = !tourActive;
  
  if(tourActive) {
    this.innerHTML = '<i class="fas fa-stop"></i> Abort Tour';
    this.style.background = '#ef4444';
    toast("Initiating Cinematic World Tour...");
    sidebar.classList.add('collapsed'); toggleIcon.classList.replace('fa-chevron-right', 'fa-chevron-left');
    playTour();
  } else {
    this.innerHTML = '<i class="fas fa-video"></i> Start Cinematic Tour';
    this.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
    toast("Guided Tour Aborted");
  }
};

function playTour() {
  if(!tourActive) return;
  const loc = tourLocations[tourIndex];
  toast(`Approaching: ${loc.title}`);
  
  map.flyTo({ center: loc.coord, zoom: loc.zoom, pitch: loc.pitch, bearing: loc.bearing, duration: 12000, essential: true });
  
  map.once('moveend', () => {
    if(!tourActive) return;
    setTimeout(() => {
      tourIndex = (tourIndex + 1) % tourLocations.length;
      playTour();
    }, 4000); // Wait 4 seconds taking in the view before flying to next
  });
}


// ==================== ADVANCED ANALYSIS & ROUTING ====================
let routingMode = false;
let routePoints = [];

document.getElementById('routeBtn').onclick = function() {
  routingMode = !routingMode;
  this.classList.toggle('active');
  document.getElementById('routingPanel').style.display = routingMode ? 'block' : 'none';
  routePoints = [];
  if(mapLoaded) map.getSource('route').setData({ type: 'FeatureCollection', features: [] });
  document.getElementById('routeResult').innerText = '';
  if(routingMode) toast("Routing Ops active: Click Map to set Waypoints");
};

// ==================== UPGRADED DRAWING KIT ====================
let draw = null;
document.getElementById('drawBtn').onclick = function() {
  if(!mapLoaded) return;
  this.classList.toggle('active');
  if (this.classList.contains('active')) {
    draw = new MapboxDraw({ displayControlsDefault: false, controls: { polygon: true, line_string: true, point: true, trash: true }, defaultMode: 'draw_polygon' });
    map.addControl(draw, 'top-left');
    document.getElementById('drawingPanel').style.display = 'block';
    map.on('draw.create', upgradeDrawMeasurement);
    map.on('draw.update', upgradeDrawMeasurement);
    toast("Measurement Kit Armed");
  } else {
    document.getElementById('drawingPanel').style.display = 'none';
    if(draw) { map.removeControl(draw); map.off('draw.create', upgradeDrawMeasurement); map.off('draw.update', upgradeDrawMeasurement); }
    draw = null;
    toast("Measurement Kit Disarmed");
  }
};

document.getElementById('clearDrawBtn').onclick = function() {
  if (draw) { draw.deleteAll(); draw.changeMode('draw_polygon'); toast("Canvas Cleared"); }
};

function upgradeDrawMeasurement(e) {
  const data = draw.getAll();
  const lastFeature = data.features[data.features.length - 1]; 
  if (!lastFeature || !window.turf) return;
  
  let msg = ''; let lngLat = null;
  if (lastFeature.geometry.type === 'Polygon') {
    const area = turf.area(lastFeature);
    msg = `<b>Area:</b> ${area > 10000 ? (area/1000000).toFixed(2)+' sq km' : area.toFixed(2)+' sq m'}`;
    lngLat = lastFeature.geometry.coordinates[0][0];
  } else if (lastFeature.geometry.type === 'LineString') {
    const dist = turf.length(lastFeature, { units: 'kilometers' });
    msg = `<b>Distance:</b> ${dist.toFixed(2)} km`;
    lngLat = lastFeature.geometry.coordinates[lastFeature.geometry.coordinates.length - 1];
  }
  if(msg && lngLat) new maplibregl.Popup({ className: 'custom-popup' }).setLngLat(lngLat).setHTML(msg).addTo(map);
}

// ==================== GEOLOGY CORE ====================
async function fetchElevation(lat, lng) {
  const key = `elev_${lat.toFixed(4)}_${lng.toFixed(4)}`;
  if (geoCache.has(key)) return geoCache.get(key);
  try {
    const res = await fetch(`https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lng}`);
    const data = await res.json();
    const val = data.results?.[0]?.elevation ?? null;
    geoCache.set(key, val);
    return val;
  } catch { return null; }
}

async function getLocationName(lat, lng) {
  const key = `loc_${lat.toFixed(4)}_${lng.toFixed(4)}`;
  if (geoCache.has(key)) return geoCache.get(key);
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10`);
    const data = await res.json();
    const val = data.display_name?.split(',')[0] || "Unknown Sector";
    geoCache.set(key, val);
    return val;
  } catch { return "Unknown"; }
}

async function getUSGSGeologicUnit(lat, lng) {
  const key = `usgs_${lat.toFixed(4)}_${lng.toFixed(4)}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const buffer = 0.001;
  const bbox = `${lat-buffer},${lng-buffer},${lat+buffer},${lng+buffer}`;
  const url = `https://mrdata.usgs.gov/services/geology?service=WMS&version=1.3.0&request=GetFeatureInfo&layers=geology&query_layers=geology&crs=EPSG:4326&bbox=${bbox}&width=101&height=101&i=50&j=50&info_format=text/plain`;
  try {
    const res = await fetch(url);
    const text = await res.text();
    const match = text.match(/UNIT_NAME:\s*(.*)/i);
    const val = match ? match[1].trim() : "Unspecified Unit";
    geoCache.set(key, val);
    return val;
  } catch { return "N/A"; }
}

async function fetchMacrostrat(lat, lng) {
  const key = `macro_${lat.toFixed(4)}_${lng.toFixed(4)}`;
  if (geoCache.has(key)) return geoCache.get(key);
  try {
    const res = await fetch(`https://macrostrat.org/api/geologic_units/map?lat=${lat}&lng=${lng}`);
    const data = await res.json();
    const unit = data.success?.data?.[0] || null;
    geoCache.set(key, unit);
    return unit;
  } catch { return null; }
}

function classifyRockType(lat, lng, elevation, macroData) {
  const lith = macroData?.lith?.toLowerCase() || "";
  let type = "Continental Basement";
  let color = "#94a3b8"; 
  let desc = "Standard silicate-rich continental crust.";
  let minerals = "Quartz, Feldspar, Mica";

  // Granular Mineral Correlation Engine (50+ specific lithologies)
  const mineralDictionary = {
    "granite": { m: "Quartz, Orthoclase Feldspar, Biotite Mica, Muscovite", d: "Intrusive igneous rock with large crystals." },
    "basalt": { m: "Pyroxene, Olivine, Plagioclase Feldspar, Magnetite", d: "Dark, fine-grained volcanic rock." },
    "sandstone": { m: "Quartz, Feldspar, Clay, Hematite", d: "Clastic sedimentary rock composed of sand-sized grains." },
    "shale": { m: "Illite, Kaolinite, Quartz, Chlorite", d: "Fine-grained, clastic sedimentary rock from clay/silt." },
    "limestone": { m: "Calcite, Aragonite, Dolomite", d: "Sedimentary rock composed of skeletal fragments of marine organisms." },
    "schist": { m: "Mica, Chlorite, Talc, Garnet, Graphite", d: "Medium-grade metamorphic rock with visible flakes." },
    "gneiss": { m: "Feldspar, Quartz, Hornblende, Garnet", d: "High-grade metamorphic rock with distinct banding." },
    "andesite": { m: "Plagioclase, Pyroxene, Amphibole, Magnetite", d: "Intermediate volcanic rock from subduction zones." },
    "rhyolite": { m: "Quartz, Sanidine, Plagioclase, Biotite", d: "High-silica volcanic rock." },
    "diorite": { m: "Plagioclase, Hornblende, Pyroxene", d: "Intrusive igneous rock between granite and gabbro." },
    "gabbro": { m: "Pyroxene, Plagioclase, Olivine", d: "Mafic intrusive igneous rock." },
    "marble": { m: "Calcite, Dolomite, Wollastonite", d: "Metamorphosed limestone." },
    "quartzite": { m: "Quartz, Sericite, Zircon", d: "Metamorphosed sandstone." },
    "slate": { m: "Quartz, Muscovite, Illite", d: "Low-grade metamorphosed shale." },
    "coal": { m: "Carbon, Vitrinite, Pyrite (minor)", d: "Organic sedimentary rock." },
    "chert": { m: "Microcrystalline Quartz, Chalcedony", d: "Fine-grained silica-rich sedimentary rock." }
  };

  // Fuzzy-match the dictionary
  for (const rock in mineralDictionary) {
    if (lith.includes(rock)) {
       minerals = mineralDictionary[rock].m;
       desc = mineralDictionary[rock].d;
       break;
    }
  }

  // Broad Classification Logic (Fallback)
  if (lith.includes("volcanic") || lith.includes("igneous")) {
    type = "Igneous Unit"; color = "#ef4444";
    if (minerals === "Quartz, Feldspar, Mica") minerals = "Pyroxene, Olivine, Plagioclase";
  } else if (lith.includes("sedimentary")) {
    type = "Sedimentary Unit"; color = "#f59e0b";
  } else if (lith.includes("metamorphic")) {
    type = "Metamorphic Unit"; color = "#6366f1";
  }

  // Regional Heuristics (e.g. Himalayas)
  const isIndia = (lat > 8 && lat < 37 && lng > 68 && lng < 97);
  if (isIndia && lat > 26 && lat < 36 && elevation > 3000) {
    type = "Himalayan Complex"; color = "#8b5cf6"; 
    minerals = "Sillimanite, Kyanite, Quartz, Muscovite";
  }

  return { type, color, desc, minerals };
}

map.on('click', async (e) => {
  if (spaceActive) return;
  const lat = e.lngLat.lat; const lng = e.lngLat.lng;
  triggerProbe(lat, lng);
});

async function triggerProbe(lat, lng) {
  const detailsDiv = document.getElementById('dynamicDetails');
  detailsDiv.innerHTML = '<i class="fas fa-satellite-dish fa-spin"></i> Initializing Geophysical Probe...';
  
  try {
    const [elev, locName, usgsUnit, macroData] = await Promise.all([
      fetchElevation(lat, lng),
      getLocationName(lat, lng),
      getUSGSGeologicUnit(lat, lng),
      fetchMacrostrat(lat, lng)
    ]);

    const classification = classifyRockType(lat, lng, elev, macroData);
    
    // Update Grid
    document.getElementById('latLonVal').innerText = `Sector: ${lat.toFixed(3)}, ${lng.toFixed(3)}`;
    document.getElementById('elevVal').innerText = `MSL: ${elev !== null ? elev+'m' : 'N/A'}`;
    document.getElementById('locDisplay').innerText = `Location: ${locName}`;
    document.getElementById('usgsUnitVal').innerText = usgsUnit;
    document.getElementById('ageVal').innerText = macroData?.age || "Unknown";
    document.getElementById('mineralVal').innerText = classification.minerals;
    document.getElementById('msiVal').innerText = macroData?.strat_name || "N/A (Cratonic)";
    document.getElementById('extraGeology').innerText = classification.desc;

    // Rock Type Badge (Dynamic Color)
    const rockBadge = document.getElementById('rockTypeDisplay');
    rockBadge.innerHTML = `<i class="fas fa-gem"></i> ${classification.type}`;
    rockBadge.style.borderLeftColor = classification.color;
    rockBadge.style.color = classification.color;

    detailsDiv.innerHTML = `<i class="fas fa-location-dot"></i> <b>Site Assessment: ${lat.toFixed(4)}, ${lng.toFixed(4)}</b>`;
    
    new maplibregl.Popup({ className:'custom-popup' }).setLngLat([lng, lat])
      .setHTML(`<b>Geological Dossier</b><br>Unit: ${usgsUnit}<br>MSL: ${elev?elev+'m':'N/A'}<br>System: ${classification.type}`).addTo(map);

    toast("Geophysical dossier updated.");
  } catch (err) {
    detailsDiv.innerText = "Probe interruption detected.";
    console.error(err);
  }
}

// Search Logic
document.getElementById('searchBtn').onclick = async () => {
  const val = document.getElementById('searchBox').value.trim();
  if (!val) return;
  toast(`Teleporting to ${val}...`);
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(val)}&limit=1`);
    const data = await res.json();
    if(data.length) {
      const lat = parseFloat(data[0].lat); const lng = parseFloat(data[0].lon);
      map.flyTo({ center: [lng, lat], zoom: 12 });
      
      // Pin dropping
      if(searchMarker) searchMarker.remove();
      searchMarker = new maplibregl.Marker({ color: "#f43f5e" }).setLngLat([lng, lat]).addTo(map);
      
      // Auto-probe
      triggerProbe(lat, lng);
    } else { toast("Location invalid."); }
  } catch { toast("Navigation Array Offline."); }
};

// ==================== MISC MODULES ====================
document.getElementById('weatherBtn').onclick = async function() {
  const center = map.getCenter();
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${center.lat}&longitude=${center.lng}&current_weather=true`);
    const data = await res.json();
    if(data.current_weather) {
      new maplibregl.Popup({ className:'custom-popup' }).setLngLat([center.lng, center.lat])
        .setHTML(`<b>☁️ Climate Readout</b><br>Temp: ${data.current_weather.temperature}°C<br>Wind: ${data.current_weather.windspeed} km/h`).addTo(map);
    }
  } catch { toast("Meteorological systems offline."); }
};

document.getElementById('poiBtn').onclick = async function() {
  if (map.getZoom() < 12) return toast("Zoom in to a sector to scan for POIs.");
  this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Scanning...';
  const b = map.getBounds();
  const query = `[out:json][timeout:25];(node["amenity"="cafe"](${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}););out body;`;
  try {
    const res = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`);
    const data = await res.json();
    const f = data.elements.filter(e => e.lat).map(e => ({ type: 'Feature', geometry:{type:'Point', coordinates:[e.lon, e.lat]}, properties:{name: e.tags.name||'Structure'} }));
    map.getSource('pois').setData({ type: 'FeatureCollection', features: f });
    if(!f.length) toast("No anomalous structures found.");
    else toast(`${f.length} Local POIs detected.`);
  } catch { toast("Scan failed."); }
  this.innerHTML = '<i class="fas fa-map-pin"></i> Neighborhood POIs';
};

// Earthquakes Slider
let eqDataCache = null;
const eqSlider = document.getElementById('eqSlider');
eqSlider.oninput = function() {
  const dayAgo = 30 - this.value;
  document.getElementById('eqDateLabel').innerText = dayAgo === 0 ? "Now" : `${dayAgo}d ago`;
  if(!eqDataCache || !mapLoaded) return;
  const currentMs = (Date.now() - (30*86400000)) + (30*86400000 * (this.value / 30));
  map.getSource('earthquakes').setData({ type: 'FeatureCollection', features: eqDataCache.features.filter(f => f.properties.time <= currentMs) });
};

document.getElementById('earthquakeBtn').onclick = async function() {
  this.classList.toggle('active');
  const visible = this.classList.contains('active');
  map.setLayoutProperty('eq-layer', 'visibility', visible ? 'visible' : 'none');
  
  if (visible) {
    document.getElementById('eqSliderContainer').style.display = 'block';
    if(!eqDataCache) {
      toast("Downloading USGS Seismic Data...");
      try {
        const res = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_month.geojson');
        eqDataCache = await res.json();
        map.getSource('earthquakes').setData(eqDataCache);
        toast("Seismic Feed Established");
      } catch { toast("Seismic fetch failed"); }
    }
  } else { document.getElementById('eqSliderContainer').style.display = 'none'; }
};

// Search / Geocode
document.getElementById('searchBtn').onclick = async () => {
  const val = document.getElementById('searchBox').value.trim();
  if (!val) return;
  toast(`Teleporting to ${val}...`);
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(val)}&limit=1`);
    const data = await res.json();
    if(data.length) map.flyTo({ center: [parseFloat(data[0].lon), parseFloat(data[0].lat)], zoom: 12, pitch: terrainActive ? 60 : 0 });
    else toast("Location invalid.");
  } catch { toast("Navigation Array Offline."); }
};

// PDF Report
document.getElementById('pdfBtn').onclick = function() {
  toast("Compiling PDF Dossier...");
  html2canvas(document.getElementById('map'), { useCORS: true }).then(canvas => {
    const { jsPDF } = window.jspdf; const doc = new jsPDF('landscape');
    doc.setFillColor(15, 23, 42); doc.rect(0, 0, 297, 210, "F");
    doc.addImage(canvas.toDataURL('image/jpeg', 0.8), 'JPEG', 10, 10, 277, 130);
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(22);
    doc.text("GeoNova 3D Insight Report", 10, 155);
    doc.setFontSize(10); doc.setTextColor(156, 163, 175);
    doc.text(`Generated by GeoNova Ultimate on ${new Date().toLocaleString()}`, 10, 195);
    doc.save('geonova-v3-dossier.pdf');
    toast("Dossier Downloaded.");
  });
};

// ==================== MAPLIBRE GEOLOGY (SURFACE METRICS) ====================
map.on('click', async (e) => {
  if (spaceActive) return; // Prevent click processing if looking at solar system
  
  const lng = e.lngLat.lng;
  const lat = e.lngLat.lat;
  
  const rockDisplay = document.getElementById('rockTypeDisplay');
  const dynamicDetails = document.getElementById('dynamicDetails');
  const extraGeology = document.getElementById('extraGeology');

  if (rockDisplay && dynamicDetails && extraGeology) {
    rockDisplay.innerHTML = `<i class="fas fa-satellite-dish"></i> Scanning Lithosphere...`;
    rockDisplay.style.color = "#fcd34d";
    dynamicDetails.innerText = `Coordinates: [${lng.toFixed(4)}, ${lat.toFixed(4)}]`;
    extraGeology.innerText = "Querying USGS / Macrostrat Database...";

    try {
      // Connect to Macrostrat API (Official USGS aggregated backend)
      const response = await fetch(`https://macrostrat.org/api/geologic_units/map?lat=${lat}&lng=${lng}&format=json`);
      const payload = await response.json();
      
      if (payload && payload.success && payload.success.data && payload.success.data.length > 0) {
        // Macrostrat provides multiple matching units over different scales, we pick the most localized (usually first or last)
        const geoData = payload.success.data[0]; 
        
        const rockType = geoData.name || geoData.strat_name || "Unclassified Rock Unit";
        const lithology = geoData.lith || "Unknown";
        const age = geoData.t_int_name ? `${geoData.b_int_name} to ${geoData.t_int_name}` : "Undetermined";
        const desc = geoData.descrip || "No detailed surveyor description provided for this boundary.";

        rockDisplay.innerHTML = `<i class="fas fa-gem"></i> ${rockType}`;
        rockDisplay.style.color = "#38bdf8"; 
        dynamicDetails.innerText = `Lithology: ${lithology}`;
        extraGeology.innerText = `Geochronology Era: ${age}\n\n${desc}`;
        toast("USGS Geological array retrieved.");
      } else {
        rockDisplay.innerHTML = `<i class="fas fa-water"></i> Oceanic Crust / Unknown Node`;
        rockDisplay.style.color = "#94a3b8";
        dynamicDetails.innerText = `Coordinates: [${lng.toFixed(2)}, ${lat.toFixed(2)}]`;
        extraGeology.innerText = "API returned no terrestrial formations. Sector is likely deep-ocean basalt or uncatalogued.";
      }
    } catch (err) {
      console.error(err);
      rockDisplay.innerHTML = `<i class="fas fa-exclamation-triangle"></i> Network Defect`;
      rockDisplay.style.color = "#ef4444";
      extraGeology.innerText = "Failed to establish handshake with USGS Macrostrat API servers.";
    }
  }
});

// ==================== THREE.JS SOLAR SYSTEM ====================
let spaceInitiated = true;
let spaceActive = true;
let scene, spaceCamera, renderer, solarOrbitControls;
const sysPlanets = [];
let starMats = [];
let starGroups = [];
let shootingStars = []; // Upgraded to pool
let sunGlow;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const planetDatabase = {
  "Sun": { comp: "Hydrogen/Helium Plasma", minerals: "Photons, Gamma rays", res: "Nuclear Fusion", moons: 0, desc: "A G-type main-sequence star at the center of our system." },
  "Mercury": { comp: "Iron-nickel core, Silicate crust", minerals: "Iron, Magnesium, Silicon", res: "Helium-3, Solar Energy", moons: 0, desc: "Highly dense, metallic planet heavily bombarded by solar radiation." },
  "Venus": { comp: "Silicate rock mantle, Iron core", minerals: "Basalt, Iron sulfide", res: "Carbon dioxide, Sulfur", moons: 0, desc: "Extreme greenhouse effect with surface temperatures high enough to melt lead." },
  "Earth": { comp: "Silicate rock, Iron core, Liquid water", minerals: "Quartz, Feldspar, Olivine", res: "Water, Biomass", moons: 1, desc: "The only known planetary body harboring life natively." },
  "Mars": { comp: "Basaltic rock, Iron oxide", minerals: "Iron(III) oxide, Plagioclase", res: "Water ice, Perchlorates", moons: 2, desc: "Rusty, desert planet with monumental volcanoes and ancient riverbeds." },
  "Jupiter": { comp: "Metallic Hydrogen, Helium", minerals: "Ammonia ice, Water ice", res: "Hydrogen, Helium-3", moons: 95, desc: "A massive gas giant lacking a solid surface, wrapped in violent storms." },
  "Saturn": { comp: "Hydrogen, Helium, Rocky core", minerals: "Ammonia ice, Water ice (Rings)", res: "Helium-3, Water ice", moons: 146, desc: "Famous for its extensive ring system composed of billions of ice chunks." },
  "Uranus": { comp: "Water, Ammonia, Methane ices", minerals: "Methane ice, Water ice", res: "Methane, Hydrogen", moons: 28, desc: "An ice giant rotating on its side, emitting a pale blue hue from atmospheric methane." },
  "Neptune": { comp: "Water, Ammonia, Methane ices", minerals: "Methane ice, Silicate rock core", res: "Methane, Water", moons: 16, desc: "A dark, cold, and supersonic wind-swept ice giant." }
};

// Initiate immediately rather than waiting for button
setTimeout(() => {
  initSolarSystem();
  animateSolarSystem();
}, 500); // Slight delay to let DOM load

function initSolarSystem() {
  const container = document.getElementById('spaceLayer');
  
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02040a);

  spaceCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 50000);
  spaceCamera.position.set(0, 800, 2000);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  solarOrbitControls = new THREE.OrbitControls(spaceCamera, renderer.domElement);
  solarOrbitControls.enableDamping = true;
  solarOrbitControls.dampingFactor = 0.05;

  // Lighting
  scene.add(new THREE.AmbientLight(0xffffff, 0.15));
  const sunLight = new THREE.PointLight(0xfffdf0, 1.5, 20000);
  scene.add(sunLight);

  // Background Stars (Asynchronous Twinkling, Higher Brightness)
  for(let g=0; g<5; g++) {
    const geo = new THREE.BufferGeometry();
    const mat = new THREE.PointsMaterial({ color: 0xffffff, size: Math.random() * 3 + 2, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
    const pos = [];
    for(let i=0; i<600; i++) {
      pos.push((Math.random()-0.5)*30000, (Math.random()-0.5)*30000, (Math.random()-0.5)*30000);
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const stars = new THREE.Points(geo, mat);
    scene.add(stars);
    starMats.push(mat);
    starGroups.push(stars);
  }

  // Sun Glow Effect (Circular Precision Fix)
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = 512; glowCanvas.height = 512;
  const ctx = glowCanvas.getContext('2d');
  ctx.clearRect(0,0,512,512);
  const gradient = ctx.createRadialGradient(256,256,0,256,256,240);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.2, 'rgba(255, 253, 240, 0.8)');
  gradient.addColorStop(0.5, 'rgba(245, 158, 11, 0.3)');
  gradient.addColorStop(1, 'rgba(245, 158, 11, 0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(256,256,256,0,Math.PI*2);
  ctx.fill();
  const glowTex = new THREE.CanvasTexture(glowCanvas);
  const glowMat = new THREE.SpriteMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  sunGlow = new THREE.Sprite(glowMat);
  sunGlow.scale.set(1300, 1300, 1);
  scene.add(sunGlow);

  // Shooting Star Pool (Upgraded to 3)
  for(let i=0; i<3; i++) {
    const ssGeo = new THREE.BufferGeometry();
    ssGeo.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 0,0,2000], 3));
    const ssMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending });
    const s = new THREE.Line(ssGeo, ssMat);
    s.userData = { velocity: new THREE.Vector3(), active: false };
    scene.add(s);
    shootingStars.push(s);
  }

  // Sun
  const texLoader = new THREE.TextureLoader();
  const P_BASE = 'https://raw.githubusercontent.com/jeromeetienne/threex.planets/master/images/';

  const sunMat = new THREE.MeshBasicMaterial({ map: texLoader.load(P_BASE + 'sunmap.jpg') }); 
  const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(150, 64, 64), sunMat);
  sunMesh.userData.name = "Sun"; // Tag Sun
  scene.add(sunMesh);
  sysPlanets.push({ mesh: sunMesh, pivot: new THREE.Object3D(), speed: 0 }); // Sun is index 0

  // Planets Data (Ultra-realistic textures from NASA composites)
  const pData = [
    { name: "Mercury", r: 8, dist: 250, speed: 0.02, map: 'mercurymap.jpg', moons: [] },
    { name: "Venus", r: 16, dist: 350, speed: 0.015, map: 'venusmap.jpg', moons: [] },
    { name: "Earth", r: 18, dist: 480, speed: 0.01, map: 'earthmap1k.jpg', moons: [{ name: "Moon", r: 4, dist: 35, speed: 0.04, color: 0xcccccc }] },
    { name: "Mars", r: 12, dist: 600, speed: 0.008, map: 'marsmap1k.jpg', moons: [{ name: "Phobos", r: 2, dist: 20, speed: 0.06, color: 0x94a3b8 }, { name: "Deimos", r: 2, dist: 28, speed: 0.04, color: 0x64748b }] },
    { name: "Jupiter", r: 50, dist: 950, speed: 0.002, map: 'jupitermap.jpg', moons: [{ name: "Io", r: 6, dist: 75, speed: 0.03, color: 0xfde047 }, { name: "Europa", r: 5, dist: 90, speed: 0.02, color: 0xbae6fd }, { name: "Ganymede", r: 8, dist: 110, speed: 0.015, color: 0xd1d5db }, { name: "Callisto", r: 7, dist: 130, speed: 0.01, color: 0x9ca3af }] },
    { name: "Saturn", r: 42, dist: 1350, speed: 0.0009, map: 'saturnmap.jpg', rings: 'saturnringcolor.jpg', moons: [{ name: "Titan", r: 10, dist: 90, speed: 0.02, color: 0xfbbf24 }, { name: "Rhea", r: 5, dist: 110, speed: 0.015, color: 0xe5e7eb }] },
    { name: "Uranus", r: 25, dist: 1750, speed: 0.0004, map: 'uranusmap.jpg', rings: 'uranusringcolour.jpg', moons: [{ name: "Titania", r: 6, dist: 60, speed: 0.02, color: 0xe2e8f0 }] },
    { name: "Neptune", r: 24, dist: 2100, speed: 0.0001, map: 'neptunemap.jpg', moons: [{ name: "Triton", r: 6, dist: 55, speed: 0.02, color: 0x93c5fd }] }
  ];

  pData.forEach(p => {
    const pivot = new THREE.Object3D();
    scene.add(pivot);

    const mat = new THREE.MeshStandardMaterial({ 
      map: texLoader.load(P_BASE + p.map),
      roughness: 0.8, metalness: 0.2
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(p.r, 32, 32), mat);
    mesh.position.x = p.dist;
    mesh.userData.name = p.name;

    if(p.rings) {
      const ringMat = new THREE.MeshStandardMaterial({ 
        map: texLoader.load(P_BASE + p.rings),
        side: THREE.DoubleSide, opacity: 0.8, transparent: true
      });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(p.r * 1.8, 8, 2, 64), ringMat);
      ring.rotation.x = Math.PI / 2.2;
      mesh.add(ring);
    }

    pivot.add(mesh);
    
    // Moon Creation
    const moons = [];
    p.moons.forEach(m => {
      const moonPivot = new THREE.Object3D();
      mesh.add(moonPivot);
      const moonMesh = new THREE.Mesh(new THREE.SphereGeometry(m.r, 16, 16), new THREE.MeshStandardMaterial({ color: m.color, roughness: 0.9 }));
      moonMesh.position.x = m.dist;
      moonPivot.add(moonMesh);

      moons.push({ 
        pivot: moonPivot, mesh: moonMesh, speed: m.speed
      });
    });

    sysPlanets.push({ pivot: pivot, mesh: mesh, speed: p.speed, moons: moons });

    // Orbital trail line
    const orbitPts = [];
    for(let i=0; i<=64; i++) {
      const angle = (i / 64) * Math.PI * 2;
      orbitPts.push(Math.cos(angle)*p.dist, 0, Math.sin(angle)*p.dist);
    }
    const orbitGeo = new THREE.BufferGeometry();
    orbitGeo.setAttribute('position', new THREE.Float32BufferAttribute(orbitPts, 3));
    scene.add(new THREE.Line(orbitGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.15 })));
  });

  window.addEventListener('resize', () => {
    if(!spaceActive) return;
    spaceCamera.aspect = window.innerWidth / window.innerHeight;
    spaceCamera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

function animateSolarSystem() {
  if(!spaceActive) return;
  requestAnimationFrame(animateSolarSystem);

  const t = Date.now() * 0.001;
  
  starMats.forEach((mat, i) => {
    mat.opacity = 0.5 + Math.sin(t * (2 + i*0.5) + i) * 0.5;
  });
  starGroups.forEach((group, i) => {
    group.rotation.y += 0.0001 * (i % 2 === 0 ? 1 : -1);
  });

  // Animate Shooting Stars Pool
  shootingStars.forEach(s => {
    if (s.material.opacity > 0) {
      s.position.add(s.userData.velocity);
      s.material.opacity -= 0.012; // Slower fade
    } else if (Math.random() < 0.003) {
      s.position.set((Math.random()-0.5)*20000, (Math.random()-0.5)*20000, (Math.random()-0.5)*20000);
      s.userData.velocity = new THREE.Vector3((Math.random()-0.5)*400, (Math.random()-0.5)*400, (Math.random()-0.5)*400);
      s.lookAt(s.position.clone().add(s.userData.velocity));
      s.material.opacity = 0.9;
    }
  });

  sysPlanets.forEach(p => {
    if(p.speed > 0) p.pivot.rotation.y += p.speed;
    p.mesh.rotation.y += 0.005;

    // Animate Moons (Clean Orbits)
    if(p.moons) {
      p.moons.forEach(m => {
        m.pivot.rotation.y += m.speed;
      });
    }
  });

  solarOrbitControls.update();
  renderer.render(scene, spaceCamera);
}

function focusOnObject(obj) {
  if(!obj) return;
  const targetVec = new THREE.Vector3();
  obj.getWorldPosition(targetVec);
  
  // Smoothly move the controls target
  gsap.to(solarOrbitControls.target, {
    x: targetVec.x, y: targetVec.y, z: targetVec.z,
    duration: 1.5, ease: "power2.inOut"
  });

  const pName = obj.userData.name;
  if(pName === "Sun") {
    toast("Warning: Direct solar observation engaged.");
    document.getElementById('planetIntelOverlay').style.display = 'none';
    return;
  }

  if(pName === "Earth") {
    toast("Earth detected. Fetching Global array...");
    setTimeout(() => document.getElementById('returnToEarthBtn').click(), 1200);
    return;
  }

  const data = planetDatabase[pName];
  if (data) {
    document.getElementById('planetTitle').innerText = pName;
    document.getElementById('planetComp').innerText = data.comp;
    document.getElementById('planetMinerals').innerText = data.minerals;
    document.getElementById('planetResources').innerText = data.res;
    document.getElementById('planetDesc').innerText = data.desc;
    document.getElementById('planetIntelOverlay').style.display = 'block';
    toast(`Node lock: ${pName} Sector.`);
  }
}

// Bind Navigation HUD
document.querySelectorAll('.nav-planet-btn').forEach(btn => {
  btn.onclick = () => {
    const name = btn.getAttribute('data-planet');
    // For planetary index in sysPlanets (Sun is 0)
    const p = sysPlanets.find(item => item.mesh.userData.name === name);
    if(p) focusOnObject(p.mesh);
  };
});


// Raycaster Click Event
window.addEventListener('pointerdown', (e) => {
  if (!spaceActive) return;
  if(e.target.closest('#planetIntelOverlay') || e.target.closest('.sidebar') || e.target.closest('button')) return;

  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, spaceCamera);

  const meshes = sysPlanets.map(p => p.mesh);
  const intersects = raycaster.intersectObjects(meshes);

  if (intersects.length > 0) {
    const pName = intersects[0].object.userData.name;
    if(pName === "Earth") {
      toast("Earth detected. Initiating atmospheric re-entry...");
      setTimeout(() => smoothTransition('earth'), 1000);
      return;
    }
    
    // Animate camera focus manually (smooth lookAt)
    const targetObj = intersects[0].object;
    const targetVec = new THREE.Vector3();
    targetObj.getWorldPosition(targetVec);
    solarOrbitControls.target.copy(targetVec);

    const data = planetDatabase[pName];
    if (data) {
      document.getElementById('planetTitle').innerText = pName;
      document.getElementById('planetComp').innerText = data.comp;
      document.getElementById('planetMinerals').innerText = data.minerals;
      document.getElementById('planetResources').innerText = data.res;
      document.getElementById('planetMoons').innerText = data.moons;
      document.getElementById('planetDesc').innerText = data.desc;
      document.getElementById('planetIntelOverlay').style.display = 'block';
      toast(`Scanning ${pName}...`);
    }
  }
});

// Bind close button directly
document.getElementById('closeIntelBtn').onclick = () => {
  document.getElementById('planetIntelOverlay').style.display = 'none';
};

function smoothTransition(target) {
  const mapEl = document.getElementById('mapLayer');
  const spaceEl = document.getElementById('spaceLayer');
  const sidebarToggle = document.getElementById('toggleSidebarBtn');
  const sidebar = document.getElementById('sidebar');

  if (target === 'space') {
    spaceActive = true;
    if(!spaceInitiated) { initSolarSystem(); spaceInitiated = true; }
    animateSolarSystem();

    // Cross-fade
    mapEl.classList.replace('engine-active', 'engine-sleep');
    spaceEl.classList.replace('engine-sleep', 'engine-active');
    
    // UI hide
    sidebarToggle.style.display = 'none';
    sidebar.style.display = 'none';

    // Cinematic Zoom-out from Earth in Space
    const earthObj = sysPlanets.find(p => p.name === 'Earth');
    if(earthObj) {
      spaceCamera.position.set(earthObj.mesh.position.x + 800, earthObj.mesh.position.y + 400, earthObj.mesh.position.z + 800);
      spaceCamera.lookAt(earthObj.mesh.position);
      solarOrbitControls.target.copy(earthObj.mesh.position);
      
      gsap.to(spaceCamera.position, {
        x: 0, y: 1500, z: 3000,
        duration: 3,
        ease: "power2.inOut",
        onUpdate: () => spaceCamera.lookAt(0,0,0)
      });
      gsap.to(solarOrbitControls.target, { x: 0, y: 0, z: 0, duration: 3 });
    }
    
    toast("Launching to Deep Space...");
  } else {
    spaceActive = false;
    // Cross-fade
    spaceEl.classList.replace('engine-active', 'engine-sleep');
    mapEl.classList.replace('engine-sleep', 'engine-active');
    
    // UI show
    sidebarToggle.style.display = 'flex';
    sidebar.style.display = 'flex';
    
    map.flyTo({ center: [78.9629, 20.5937], zoom: 2.2, duration: 2000 });
    toast("Atmospheric Re-entry Complete.");
  }
}

document.getElementById('launchSpaceBtn').onclick = () => smoothTransition('space');
document.getElementById('returnToEarthBtn').onclick = () => smoothTransition('earth');
