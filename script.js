import * as THREE from "three";
import { CITY_DATA } from "./city-data.js";
import { makePairKey, TRANSPORT_CONNECTIONS, TRANSPORT_DEFINITIONS } from "./transport-data.js";
import { createCountryBoundaryOverlay } from "./country-overlay.js";
import { createCityExplorer } from "./city-explorer.js";

// Startup overlay: wait for the first rendered frame and texture loading,
// with a short fallback so a slow texture host cannot trap the user on it.
const startupLoader = document.getElementById("startup-loader");
let startupFirstFrameReady = false;
let startupAssetsReady = false;
let startupHideScheduled = false;
function finishStartupLoaderIfReady() {
  if (!startupLoader || !startupFirstFrameReady || !startupAssetsReady || startupHideScheduled) return;
  startupHideScheduled = true;
  window.setTimeout(() => {
    startupLoader.classList.add("is-hidden");
    startupLoader.setAttribute("aria-hidden", "true");
    window.setTimeout(() => startupLoader.remove(), 500);
  }, 220);
}
const startupAssetFallbackTimer = window.setTimeout(() => {
  startupAssetsReady = true;
  finishStartupLoaderIfReady();
}, 4500);

/* ============================================================
   WAY●MARK — Prototype 1.32
   Adaptive globe + city exploration:
   - Full-screen 3D globe
   - 215 cities
   - Surprise route generator
   - Mouse/touch drag, wheel and pinch interaction
   - Edge-hover automatic rotation
   - Search
   - City selection
   - City info card
   - Full-screen shared-style modal
   - Country boundary layer at distant zoom
   - Lazy-loaded vector city map with OpenStreetMap places
   ============================================================ */

// ============================================================
// City catalog architecture
// ============================================================
// Search and route logic use stable ids. The visibility tier is
// intentionally separated from the city object so adding future
// cities only requires adding a new entry to CITY_DATA; unless a
// city is promoted explicitly, it appears at closer zoom levels.
const cityById = new Map(CITY_DATA.map((city) => [city.id, city]));

const CITY_VISIBILITY_THRESHOLDS = {
  far: 88,
  mid: 70
};

function getCityVisibilityTier(city) {
  const popularity = Number.isFinite(city.popularity) ? city.popularity : 0;

  if (popularity >= CITY_VISIBILITY_THRESHOLDS.far) return 1;
  if (popularity >= CITY_VISIBILITY_THRESHOLDS.mid) return 2;
  return 3;
}

function getRequiredCityIds() {
  return new Set(
    state.tripSegments.flatMap((segment) => [segment.origin.id, segment.destination.id])
      .concat([state.selectedOrigin?.id, state.selectedDestination?.id].filter(Boolean))
  );
}

function validateCityCatalog() {
  const seenIds = new Set();
  const seenCoordinates = new Map();
  const requiredFields = ["id", "name", "country", "flag", "timezone", "currency", "language"];

  for (const city of CITY_DATA) {
    for (const field of requiredFields) {
      if (!city[field]) {
        console.warn(`WAY●MARK: missing city field: ${field}`, city.id || city.name || city);
      }
    }

    if (!city.id || seenIds.has(city.id)) {
      console.warn("WAY●MARK: duplicate or missing city id", city);
    }
    seenIds.add(city.id);

    if (!Number.isFinite(city.lat) || city.lat < -90 || city.lat > 90 ||
        !Number.isFinite(city.lon) || city.lon < -180 || city.lon > 180) {
      console.warn("WAY●MARK: invalid coordinates", city.id);
    }

    const coordinateKey = `${Number(city.lat).toFixed(4)}|${Number(city.lon).toFixed(4)}`;
    if (seenCoordinates.has(coordinateKey)) {
      console.warn("WAY●MARK: duplicated coordinates", city.id, seenCoordinates.get(coordinateKey));
    } else {
      seenCoordinates.set(coordinateKey, city.id);
    }

    if (!Number.isFinite(city.popularity) || city.popularity < 0 || city.popularity > 100) {
      console.warn("WAY●MARK: popularity should be a number from 0 to 100", city.id);
    }

    if (!Array.isArray(city.attractions) || city.attractions.length < 6) {
      console.warn("WAY●MARK: city should contain at least 6 attractions", city.id);
    }

    if (!city.weather || !Number.isFinite(city.weather.temp) || !city.weather.condition) {
      console.warn("WAY●MARK: incomplete weather data", city.id);
    }
  }
}

validateCityCatalog();

const state = {
  selectedOrigin: null,
  selectedDestination: null,
  previewCity: null,
  pointerX: window.innerWidth / 2,
  pointerY: window.innerHeight / 2,
  pointerOverUI: false,
  activeModal: null,
  isFocusingCity: false,
  isDragging: false,
  dragMoved: false,
  lastPointerX: 0,
  lastPointerTime: 0,
  mobileSwipeVelocityY: 0,
  mobileSwipeVelocityX: 0,
  globeVelocityY: 0,
  globeVelocityX: 0,
  labelsDirty: true,
  labelFrameSkip: 0,
  lastRenderTime: performance.now(),
  performanceMode: false,
  qualityRestoreTimer: 0,
  labelAccumulator: 0,
  sceneDirty: true,
  lastRenderedAt: performance.now(),
  routePhase: "idle",
  selectedTransport: null,
  currentRoute: null,
  routeAnimation: null,
  tripSegments: [],
  savedTrips: JSON.parse(localStorage.getItem("waymarkSavedTrips") || "[]"),
  routeDetailsReturn: null,
  surprisePlan: null,
  surpriseMode: "random",
  surpriseCityCount: 3,
  surpriseFilters: {
    climate: "any",
    budget: "any",
    cityCount: "3",
    season: "any",
    pace: "balanced",
    duration: "any",
    transport: "any",
    popularity: "mixed"
  }
};

const canvas = document.getElementById("globe-canvas");
const cityLabelsRoot = document.getElementById("city-labels");
const countryLabelsRoot = document.getElementById("country-labels");
const reusableWorld = new THREE.Vector3();
const reusableProjected = new THREE.Vector3();
const reusableCameraDirection = new THREE.Vector3();
const reusableNormal = new THREE.Vector3();

const bottomPanelText = document.getElementById("bottom-panel-text");
const bottomPanelContent = document.getElementById("bottom-panel-content");
const cityCard = document.getElementById("city-card");
let cityCardHideTimer = 0;
const transportPanel = document.getElementById("transport-panel");
const transportRouteTitle = document.getElementById("transport-route-title");
const transportDistance = document.getElementById("transport-distance");
const transportOptions = document.getElementById("transport-options");
const searchInput = document.getElementById("city-search");
const searchResults = document.getElementById("search-results");
const toast = document.getElementById("toast");
const modalBackdrop = document.getElementById("modal-backdrop");
const modalTitle = document.getElementById("modal-title");
const modalContent = document.getElementById("modal-content");
const modalClose = document.getElementById("modal-close");
const modalBack = document.getElementById("modal-back");
const navButtons = [...document.querySelectorAll(".nav-button")];
const surpriseButton = document.getElementById("surprise-button");
const mobileMenuToggle = document.getElementById("mobile-menu-toggle");

function setMobileMenuOpen(open) {
  const topbar = mobileMenuToggle?.closest(".topbar");
  if (!topbar || !mobileMenuToggle) return;
  topbar.classList.toggle("mobile-menu-open", open);
  mobileMenuToggle.setAttribute("aria-expanded", String(open));
  mobileMenuToggle.setAttribute("aria-label", open ? "Закрыть меню" : "Открыть меню");
}

mobileMenuToggle?.addEventListener("click", () => {
  setMobileMenuOpen(mobileMenuToggle.getAttribute("aria-expanded") !== "true");
});
const edgeHintLeft = document.querySelector(".edge-hint-left");
const edgeHintRight = document.querySelector(".edge-hint-right");

function getAdaptivePixelRatio(active = false) {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  const pixelBudget = active ? 3_800_000 : 7_000_000;
  const budgetRatio = Math.sqrt(pixelBudget / (width * height));
  const cap = active ? 1.2 : 1.65;
  const floor = active ? 0.95 : 1.0;
  return THREE.MathUtils.clamp(Math.min(dpr, cap, budgetRatio), floor, cap);
}

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  powerPreference: "high-performance",
  precision: "highp"
});

renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(getAdaptivePixelRatio(false));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.16;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  36,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
camera.position.set(0, 0.15, 4.95);

// Waymark uses free horizontal rotation and broad, controlled vertical tilt.
// The globe can be moved around the world without being allowed to flip over.
const dragSensitivity = 0.00435;
const dragPitchSensitivity = 0.00315;
const edgeRotationMaxSpeed = 0.34;
const globeDamping = 7.5;
const MIN_PITCH = THREE.MathUtils.degToRad(-66);
const MAX_PITCH = THREE.MathUtils.degToRad(66);
const isMobileUiActive = () => document.documentElement.dataset.device === "mobile";
const getMaxZoomOut = () => isMobileUiActive() ? 8.5 : 7.6;
// Mobile touch rotation is mapped directly from CSS-pixel movement to angle.
// A 300px horizontal swipe rotates the globe about 86 degrees; a quick release
// adds only a modest, capped glide. These constants are mobile-touch only.
const MOBILE_TOUCH_RADIANS_PER_PIXEL = 0.005;
const MOBILE_TOUCH_PITCH_RADIANS_PER_PIXEL = 0.0042;
const MOBILE_TOUCH_MIN_ZOOM_SENSITIVITY = 0.55;
const MOBILE_TOUCH_MAX_YAW_SPEED = 4.2; // radians/second before release damping
const MOBILE_TOUCH_MAX_PITCH_SPEED = 2.4;
const MOBILE_TOUCH_RELEASE_INERTIA = 0.62;

// On mobile, reduce globe rotation gradually as the camera zooms in so that
// close-up browsing remains precise. Keep the existing fast feel when zoomed out.
function getMobileSwipeZoomSensitivity() {
  const minZoom = 3.25;
  const maxZoom = getMaxZoomOut();
  const zoomProgress = THREE.MathUtils.clamp(
    (camera.position.z - minZoom) / (maxZoom - minZoom),
    0,
    1
  );
  // Smoothstep avoids sudden jumps in sensitivity between zoom levels.
  const easedProgress = zoomProgress * zoomProgress * (3 - 2 * zoomProgress);
  return THREE.MathUtils.lerp(MOBILE_TOUCH_MIN_ZOOM_SENSITIVITY, 1, easedProgress);
}

const ambientLight = new THREE.HemisphereLight(0xeaf4ff, 0x647180, 1.85);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffffff, 0.62);
sunLight.position.set(4.5, 4.0, 4.5);
scene.add(sunLight);

const rimLight = new THREE.DirectionalLight(0x9dcfff, 0.12);
rimLight.position.set(-3.5, 1.0, -3.0);
scene.add(rimLight);

const globeGroup = new THREE.Group();
globeGroup.rotation.x = 0;
globeGroup.rotation.y = THREE.MathUtils.degToRad(-105);
globeGroup.scale.set(1, 1, 1);
scene.add(globeGroup);

const GLOBE_RADIUS = 2.0;

const routeGroup = new THREE.Group();
routeGroup.renderOrder = 3;
globeGroup.add(routeGroup);

const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin("anonymous");

function loadTexture(url, colorSpace = null) {
  return new Promise((resolve) => {
    textureLoader.load(
      url,
      (texture) => {
        if (colorSpace) {
          texture.colorSpace = colorSpace;
        }
        resolve(texture);
      },
      undefined,
      () => resolve(null)
    );
  });
}

const earthMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.96,
  metalness: 0.0,
  emissive: new THREE.Color(0x30465c),
  emissiveIntensity: 0.15
});

const earth = new THREE.Mesh(
  new THREE.SphereGeometry(GLOBE_RADIUS, 256, 160),
  earthMaterial
);
globeGroup.add(earth);

const atmosphereMaterial = new THREE.ShaderMaterial({
  uniforms: {
    c: { value: 0.09 },
    p: { value: 3.2 },
    glowColor: { value: new THREE.Color(0x79bfff) }
  },
  vertexShader: `
    varying vec3 vNormal;
    varying vec3 vViewPosition;

    void main() {
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vNormal = normalize(normalMatrix * normal);
      vViewPosition = -mvPosition.xyz;
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    uniform float c;
    uniform float p;
    uniform vec3 glowColor;

    varying vec3 vNormal;
    varying vec3 vViewPosition;

    void main() {
      vec3 viewDir = normalize(vViewPosition);
      float fresnel = pow(1.0 - max(dot(vNormal, viewDir), 0.0), p);
      float intensity = smoothstep(0.02, 1.0, fresnel) * c;
      gl_FragColor = vec4(glowColor, intensity);
    }
  `,
  blending: THREE.AdditiveBlending,
  side: THREE.BackSide,
  transparent: true,
  depthWrite: false
});

const atmosphere = new THREE.Mesh(
  new THREE.SphereGeometry(GLOBE_RADIUS * 1.022, 192, 128),
  atmosphereMaterial
);
globeGroup.add(atmosphere);

const cloudMaterial = new THREE.MeshPhongMaterial({
  transparent: true,
  opacity: 0.16,
  depthWrite: false,
  shininess: 0,
  side: THREE.DoubleSide
});

const clouds = new THREE.Mesh(
  new THREE.SphereGeometry(GLOBE_RADIUS * 1.008, 192, 128),
  cloudMaterial
);
globeGroup.add(clouds);

const countryOverlay = createCountryBoundaryOverlay({
  THREE,
  globeGroup,
  camera,
  labelRoot: countryLabelsRoot,
  radius: GLOBE_RADIUS
});
// Load low-resolution country borders separately; failures must not affect the globe.
countryOverlay.load().then(() => {
  state.labelsDirty = true;
  state.sceneDirty = true;
});

let loadedTopologyTexture = null;

// Load nice Earth textures. If a remote asset is unavailable,
// the fallback base color remains usable.
Promise.all([
  loadTexture(
    "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography/january/world.topo.200401.3x5400x2700.jpg",
    THREE.SRGBColorSpace
  ),
  loadTexture("https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-topology.png"),
  loadTexture("https://threejs.org/examples/textures/planets/earth_clouds_1024.png", THREE.SRGBColorSpace)
]).then(async ([nasaMap, topologyMap, cloudsMap]) => {
  const earthMap = nasaMap || await loadTexture(
    "https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-blue-marble.jpg",
    THREE.SRGBColorSpace
  );

  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

  for (const texture of [earthMap, topologyMap, cloudsMap]) {
    if (!texture) continue;
    texture.anisotropy = maxAnisotropy;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
  }

  if (earthMap) {
    earthMap.colorSpace = THREE.SRGBColorSpace;
    earthMaterial.map = earthMap;
  }

  if (topologyMap) {
    loadedTopologyTexture = topologyMap;
    earthMaterial.bumpMap = topologyMap;
    earthMaterial.bumpScale = 0.045;
  }

  earthMaterial.needsUpdate = true;

  if (cloudsMap) {
    cloudMaterial.map = cloudsMap;
    cloudMaterial.color.set(0xffffff);
    cloudMaterial.opacity = 0.075;
    cloudMaterial.needsUpdate = true;
  }
}).catch((error) => {
  console.warn("WAY●MARK: texture loading had a problem; continuing with fallback materials.", error);
}).finally(() => {
  startupAssetsReady = true;
  window.clearTimeout(startupAssetFallbackTimer);
  finishStartupLoaderIfReady();
});

function setPerformanceMode(active) {
  if (state.performanceMode === active) return;

  state.performanceMode = active;

  document.getElementById("app")?.classList.toggle("performance-mode", active);

  if (active) {
    // Strong fill-rate reduction while the globe is actively moving.
    // Texture files and their resolution are untouched.
    renderer.setPixelRatio(getAdaptivePixelRatio(true));

    // Temporarily remove the most expensive surface details. The original
    // textures remain untouched and are restored immediately after input.
    if (earthMaterial.bumpMap) {
      earthMaterial.bumpMap = null;
      earthMaterial.needsUpdate = true;
    }

    cloudMaterial.opacity = 0.0;
  } else {
    renderer.setPixelRatio(getAdaptivePixelRatio(false));

    if (loadedTopologyTexture) {
      earthMaterial.bumpMap = loadedTopologyTexture;
      earthMaterial.bumpScale = 0.045;
      earthMaterial.needsUpdate = true;
    }

    cloudMaterial.opacity = 0.075;
  }

  renderer.setSize(window.innerWidth, window.innerHeight, false);
  state.sceneDirty = true;
}

function cityToVector3(city, radius = GLOBE_RADIUS) {
  const lat = THREE.MathUtils.degToRad(city.lat);
  const lon = THREE.MathUtils.degToRad(city.lon);

  const cosLat = Math.cos(lat);

  return new THREE.Vector3(
    radius * cosLat * Math.cos(lon),
    radius * Math.sin(lat),
    -radius * cosLat * Math.sin(lon)
  );
}

const cityEntriesById = new Map();
const CITY_MARKER_GEOMETRY = new THREE.SphereGeometry(0.027, 10, 10);

const cityEntries = CITY_DATA.map((city) => {
  const label = document.createElement("button");
  label.type = "button";
  label.className = "city-label";
  label.innerHTML = `
    <span class="city-dot"></span>
    <span class="city-name">${city.name}</span>
  `;
  label.title = `${city.name}, ${city.country}`;
  label.addEventListener("click", (event) => {
    event.stopPropagation();
    showCityCard(city);
  });

  cityLabelsRoot.appendChild(label);

  const marker = new THREE.Mesh(
    CITY_MARKER_GEOMETRY,
    new THREE.MeshBasicMaterial({
      color: 0x91a0ae,
      transparent: true,
      opacity: 0.55
    })
  );

  marker.position.copy(cityToVector3(city, GLOBE_RADIUS * 1.004));
  marker.userData.cityId = city.id;
  globeGroup.add(marker);

  const entry = {
    city,
    label,
    marker,
    localPosition: cityToVector3(city, GLOBE_RADIUS * 1.015),
    labelWidth: Math.max(74, 12 + city.name.length * 7.1),
    labelHeight: 22
  };

  cityEntriesById.set(city.id, entry);
  return entry;
});

function findCity(cityId) {
  return cityById.get(cityId) || null;
}

function isSameCity(city) {
  return state.selectedOrigin?.id === city.id || state.selectedDestination?.id === city.id;
}



const transportById = new Map(TRANSPORT_DEFINITIONS.map((definition) => [definition.id, definition]));

function getTransportDefinitionById(transportId) {
  return transportById.get(transportId) || null;
}

function validateTransportNetwork() {
  for (const [type, connections] of Object.entries(TRANSPORT_CONNECTIONS)) {
    for (const key of connections) {
      const [originId, destinationId] = key.split("|");
      if (!cityById.has(originId) || !cityById.has(destinationId)) {
        console.warn(`WAY●MARK: unknown city in ${type} connection`, key);
      }
    }
  }
}

validateTransportNetwork();

const normalizeSearchText = (value) => String(value || "").trim().toLocaleLowerCase("ru");
const CITY_SEARCH_INDEX = CITY_DATA.map((city) => ({
  city,
  name: normalizeSearchText(city.name),
  country: normalizeSearchText(city.country),
  id: normalizeSearchText(city.id)
}));

function haversineDistanceKm(a, b) {
  const R = 6371;
  const lat1 = THREE.MathUtils.degToRad(a.lat);
  const lat2 = THREE.MathUtils.degToRad(b.lat);
  const dLat = lat2 - lat1;
  const dLon = THREE.MathUtils.degToRad(b.lon - a.lon);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(h));
}

function formatDuration(hours) {
  if (hours < 1) {
    return `${Math.max(20, Math.round(hours * 60))} мин`;
  }

  const whole = Math.floor(hours);
  const mins = Math.round((hours - whole) * 60);

  if (mins === 60) {
    return `${whole + 1} ч`;
  }

  return mins
    ? `${whole} ч ${mins} мин`
    : `${whole} ч`;
}

function formatMoneyRub(value) {
  return `≈ ${Math.max(700, Math.round(value / 100) * 100).toLocaleString("ru-RU")} ₽`;
}

function getTransportOptions(origin, destination) {
  const distance = haversineDistanceKm(origin, destination);

  return TRANSPORT_DEFINITIONS.map((definition) => {
    const available = Boolean(definition.availability({
      origin,
      destination,
      distance
    }));

    const hours = distance / definition.speed + definition.overhead;
    const price = distance * definition.pricePerKm + definition.overhead * 250;

    return {
      ...definition,
      distance,
      available,
      durationHours: hours,
      durationText: formatDuration(hours),
      priceValue: price,
      priceText: formatMoneyRub(price)
    };
  }).sort((a, b) => {
    if (a.available !== b.available) {
      return a.available ? -1 : 1;
    }
    return a.durationHours - b.durationHours;
  });
}

function openTransportPanel(origin, destination) {
  if (state.tripSegments.length) {
    dimCompletedRouteVisuals();
  }

  const options = getTransportOptions(origin, destination);

  transportRouteTitle.textContent = `${origin.name} → ${destination.name}`;
  transportDistance.textContent = `${Math.round(options[0].distance).toLocaleString("ru-RU")} км`;

  transportOptions.innerHTML = options.map((option) => `
    <button
      class="transport-card${option.available ? "" : " disabled"}"
      type="button"
      data-transport-id="${option.id}"
      ${option.available ? "" : "disabled"}
    >
      <div class="transport-icon">${option.icon}</div>
      <div class="transport-name">${option.name}</div>
      <div class="transport-time">${option.available ? option.durationText : "Недоступно"}</div>
      <div class="transport-price">${option.available ? option.priceText : "Для этого направления"}</div>
      <div class="transport-description">${option.available ? option.description : "Этот вид транспорта не используется для выбранного направления."}</div>
      <div class="transport-note">${option.available ? option.note : ""}</div>
    </button>
  `).join("");

  transportOptions.querySelectorAll(".transport-card:not(.disabled)").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.transportId;
      const selected = options.find((option) => option.id === id);
      if (selected) {
        selectTransport(selected);
      }
    });
  });

  transportPanel.classList.remove("hidden", "closing");
  requestAnimationFrame(() => {
    transportPanel.classList.add("visible");
  });

  state.routePhase = "transport";
  state.labelsDirty = true;
}

function closeTransportPanel() {
  transportPanel.classList.remove("visible");
  transportPanel.classList.add("closing");

  window.setTimeout(() => {
    transportPanel.classList.add("hidden");
    transportPanel.classList.remove("closing");
  }, 260);
}

function clearRouteVisual() {
  while (routeGroup.children.length) {
    const child = routeGroup.children.pop();
    child.geometry?.dispose();
    child.material?.dispose?.();
  }
  state.sceneDirty = true;
}

function getRouteArcPoints(origin, destination, segments = 100) {
  const start = cityToVector3(origin, GLOBE_RADIUS * 1.018).normalize();
  const end = cityToVector3(destination, GLOBE_RADIUS * 1.018).normalize();
  const angle = start.angleTo(end);

  const points = [];
  // Keep the route close to the globe: the arc is intentionally a little lower
  // than in the previous version while preserving the same route geometry.
  const arcHeight = THREE.MathUtils.clamp(
    0.18 + angle * 0.32,
    0.21,
    0.82
  );

  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;

    const blended = start.clone().lerp(end, t).normalize();
    const lift = Math.sin(Math.PI * t) * arcHeight;

    points.push(
      blended.multiplyScalar(GLOBE_RADIUS * 1.018 + lift)
    );
  }

  return points;
}

function dimCompletedRouteVisuals() {
  for (const segment of state.tripSegments) {
    if (!segment?.routeTube?.material) continue;
    segment.routeTube.material.transparent = true;
    segment.routeTube.material.color.set(0x8a9bb0);
    segment.routeTube.material.opacity = 0.34;
  }
  state.sceneDirty = true;
}

function startRouteAnimation(origin, destination, transport) {
  // A new leg is added to the existing trip; previous legs remain visible.
  dimCompletedRouteVisuals();

  const points = getRouteArcPoints(origin, destination, 150);

  // One solid route tube: no translucent underlay and no second line.
  // TubeGeometry gives us a visible thickness across browsers.
  const curve = new THREE.CatmullRomCurve3(
    points,
    false,
    "centripetal",
    0.35
  );

  const tubeRadialSegments = 6;
  const tubeGeometry = new THREE.TubeGeometry(
    curve,
    120,
    0.009,
    tubeRadialSegments,
    false
  );

  tubeGeometry.setDrawRange(0, 0);

  const routeMaterial = new THREE.MeshBasicMaterial({
    color: 0x66a4ff,
    transparent: false,
    opacity: 1,
    depthTest: true,
    depthWrite: false
  });

  const routeTube = new THREE.Mesh(tubeGeometry, routeMaterial);
  routeTube.renderOrder = 4;
  routeGroup.add(routeTube);

  const movingMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.034, 8, 6),
    new THREE.MeshBasicMaterial({
      color: 0x66a4ff
    })
  );
  movingMarker.renderOrder = 5;
  routeGroup.add(movingMarker);

  state.currentRoute = {
    origin,
    destination,
    transport,
    distanceKm: haversineDistanceKm(origin, destination),
    routeTube,
    tubeRadialSegments,
    points,
    movingMarker
  };
  state.sceneDirty = true;
  state.labelsDirty = true;

  state.routeAnimation = {
    startedAt: performance.now(),
    duration: 1500,
    totalPoints: points.length
  };
  state.routePhase = "animating";
}

function finishRouteAnimation() {
  const route = state.currentRoute;
  if (!route) return;

  const tubeIndexCount =
    Math.max(0, (route.points.length - 1) * route.tubeRadialSegments * 6);

  route.routeTube.geometry.setDrawRange(0, tubeIndexCount);
  route.movingMarker.position.copy(route.points[route.points.length - 1]);

  state.routeAnimation = null;
  state.sceneDirty = true;

  if (!state.tripSegments.includes(route)) {
    route.completedAt = Date.now();
    state.tripSegments.push(route);
  }

  showCityCard(route.destination);
  updateCityLabelStyles();

  // Surprise mode chains several legs into one automatically generated trip.
  // Each leg still uses the same core route animation and transport logic as
  // a manually built journey, so no special globe mechanics are introduced.
  if (state.surprisePlan) {
    const plan = state.surprisePlan;
    if (plan.nextIndex < plan.cities.length) {
      const nextOrigin = route.destination;
      const nextDestination = plan.cities[plan.nextIndex];
      const transport = chooseSurpriseTransport(nextOrigin, nextDestination, plan.mode, plan.filters);
      plan.nextIndex += 1;

      if (transport) {
        state.selectedOrigin = nextOrigin;
        state.selectedDestination = nextDestination;
        state.selectedTransport = transport;
        state.currentRoute = null;
        state.routePhase = "animating";
        renderSurpriseBuildingPanel(nextDestination, plan.nextIndex, plan.cities.length);
        state.labelsDirty = true;

        window.setTimeout(() => {
          startRouteAnimation(nextOrigin, nextDestination, transport);
        }, 180);
        return;
      }

      // The universal plane option should normally prevent this branch, but
      // safely abort if a future transport rule makes the pair unavailable.
      state.surprisePlan = null;
      state.routePhase = "ready";
      showToast("Не удалось построить следующий сегмент. Маршрут сохранён до этой точки.");
    } else {
      state.surprisePlan = null;
      state.routePhase = "ready";
      showRouteReadyPanel(route);
      showToast("Маршрут составлен — путешествие готово.");
      return;
    }
  }

  state.routePhase = "ready";
  showRouteReadyPanel(route);
}

function selectTransport(transport) {
  if (!state.selectedOrigin || !state.selectedDestination) return;

  state.selectedTransport = transport;
  transportPanel.classList.add("closing");
  transportPanel.classList.remove("visible");

  window.setTimeout(() => {
    transportPanel.classList.add("hidden");
    transportPanel.classList.remove("closing");
  }, 260);

  startRouteAnimation(
    state.selectedOrigin,
    state.selectedDestination,
    transport
  );
  state.labelsDirty = true;
}

function renderTripProgress() {
  const completed = state.tripSegments;
  if (!completed.length) {
    setBottomOriginState(state.selectedOrigin);
    return;
  }

  const current = completed[completed.length - 1];
  const nodes = [];

  completed.forEach((segment, index) => {
    if (index === 0) {
      nodes.push(`<span class="trip-node">${segment.origin.name}</span>`);
    }
    nodes.push(`
      <span class="trip-leg ${index === completed.length - 1 ? "trip-leg-current" : "trip-leg-complete"}">
        <span class="trip-leg-line"></span>
        <span class="trip-leg-transport">${segment.transport.icon}</span>
      </span>
    `);
    nodes.push(`<span class="trip-node ${index === completed.length - 1 ? "trip-node-current" : ""}">${segment.destination.name}</span>`);
  });

  bottomPanelContent.innerHTML = `
    <div class="trip-progress">
      <div class="trip-progress-route">${nodes.join("")}</div>
      <div class="trip-progress-actions">
        <button class="route-action" id="route-details-button" type="button">Подробнее</button>
        <button class="route-action secondary" id="route-finish-button" type="button">Закончить маршрут</button>
        <button class="route-action secondary" id="route-new-trip-button" type="button">Начать новое путешествие</button>
      </div>
    </div>
  `;

  document.getElementById("route-details-button")?.addEventListener("click", () => {
    openRouteDetailsModal(current);
  });

  document.getElementById("route-finish-button")?.addEventListener("click", () => {
    openTripSummaryModal(true);
  });

  document.getElementById("route-new-trip-button")?.addEventListener("click", startNewTrip);
}

function showRouteReadyPanel(route) {
  renderTripProgress();
}

function continueTrip() {
  const lastRoute = state.tripSegments[state.tripSegments.length - 1];
  if (!lastRoute) return;

  if (state.tripSegments.length >= 5) {
    openTripSummaryModal(true);
    return;
  }

  state.selectedOrigin = lastRoute.destination;
  state.selectedDestination = null;
  state.selectedTransport = null;
  state.currentRoute = null;
  state.routeAnimation = null;
  state.routePhase = "selecting";
  closeTransportPanel();
  showCityCard(lastRoute.destination);
  updateCityLabelStyles();
  renderTripSelectionPanel();
  showToast(`Выберите следующую точку после ${lastRoute.destination.name}`);
}

function renderTripSelectionPanel() {
  const origin = state.selectedOrigin;
  if (!origin) return;

  bottomPanelContent.innerHTML = `
    <span class="bottom-panel-icon">📍</span>
    <span class="bottom-city">${origin.name}</span>
    <span class="bottom-arrow">→</span>
    <span>Выберите место, куда отправиться</span>
  `;
}

function getTripTotals() {
  return state.tripSegments.reduce((total, segment) => {
    const hours = segment.transport.durationHours;
    const priceValue = Number.isFinite(segment.transport.priceValue)
      ? segment.transport.priceValue
      : 0;

    total.distanceKm += segment.distanceKm;
    total.hours += hours;
    total.priceRub += priceValue;
    return total;
  }, { distanceKm: 0, hours: 0, priceRub: 0 });
}

function getCityById(cityId) {
  return cityById.get(cityId) || null;
}

function hydrateSavedSegment(savedSegment) {
  const origin = getCityById(savedSegment?.originId);
  const destination = getCityById(savedSegment?.destinationId);
  const definition = getTransportDefinitionById(savedSegment?.transportId);

  if (!origin || !destination || !definition) return null;

  const durationHours = Number.isFinite(Number(savedSegment.durationHours))
    ? Number(savedSegment.durationHours)
    : 0;
  const distanceKm = Number.isFinite(Number(savedSegment.distanceKm))
    ? Number(savedSegment.distanceKm)
    : 0;
  const priceValue = Number.isFinite(Number(savedSegment.priceRub))
    ? Number(savedSegment.priceRub)
    : 0;

  return {
    origin,
    destination,
    distanceKm,
    transport: {
      ...definition,
      durationHours,
      durationText: savedSegment.durationText || formatDuration(durationHours),
      priceValue,
      priceText: savedSegment.priceText || formatMoneyRub(priceValue)
    }
  };
}

function getTripViewData(trip) {
  const segments = trip
    ? trip.segments.map(hydrateSavedSegment).filter(Boolean)
    : state.tripSegments.slice();

  if (!segments.length) return null;

  const first = segments[0];
  const last = segments[segments.length - 1];
  const fallbackTotals = segments.reduce((totals, segment) => {
    totals.distanceKm += segment.distanceKm;
    totals.hours += segment.transport.durationHours;
    totals.priceRub += segment.transport.priceValue;
    return totals;
  }, { distanceKm: 0, hours: 0, priceRub: 0 });

  return {
    trip,
    segments,
    first,
    last,
    totals: trip?.totals || fallbackTotals
  };
}

function openTripSummaryModal(finishMode = false, savedTrip = null) {
  const view = getTripViewData(savedTrip);
  if (!view) {
    modalTitle.textContent = finishMode ? "Путешествие завершено" : "Моё путешествие";
    modalContent.innerHTML = `
      <div class="modal-empty">
        <div>
          <strong>Путешествие пока пустое</strong>
          <div>Добавьте хотя бы один маршрут, чтобы увидеть его подробности.</div>
        </div>
      </div>
    `;
    openModal();
    return;
  }

  const { trip, segments, first, last, totals } = view;
  modalTitle.textContent = finishMode ? "Путешествие завершено" : "Моё путешествие";
  modalContent.innerHTML = `
    <div class="modal-grid">
      <div class="modal-hero">
        <div>
          <div class="modal-city-name">${first.origin.name} → ${last.destination.name}</div>
          <div class="modal-city-description">
            ${segments.length} ${segments.length === 1 ? "сегмент" : "сегмента"} путешествия · все расчёты ориентировочные.${trip?.createdAt ? ` · Сохранено ${new Date(trip.createdAt).toLocaleDateString("ru-RU")}` : ""}
          </div>
        </div>
        <div class="modal-stat-grid">
          <div class="modal-stat">
            <div class="stat-label">Расстояние</div>
            <div class="stat-value">${Math.round(totals.distanceKm).toLocaleString("ru-RU")} км</div>
          </div>
          <div class="modal-stat">
            <div class="stat-label">Время в пути</div>
            <div class="stat-value">${formatDuration(totals.hours)}</div>
          </div>
          <div class="modal-stat">
            <div class="stat-label">Примерная стоимость</div>
            <div class="stat-value">${formatMoneyRub(totals.priceRub)}</div>
          </div>
          <div class="modal-stat">
            <div class="stat-label">Маршрутов</div>
            <div class="stat-value">${segments.length} / 5</div>
          </div>
        </div>
      </div>

      <div class="modal-section">
        <h3>Сегменты путешествия</h3>
        <div class="trip-summary-list">
          ${segments.map((segment, index) => `
            <button class="trip-summary-segment" type="button" data-trip-segment-index="${index}" aria-label="Открыть подробности: ${segment.origin.name} → ${segment.destination.name}">
              <div class="trip-summary-index">${index + 1}</div>
              <div class="trip-summary-main">
                <strong>${segment.origin.name} → ${segment.destination.name}</strong>
                <span>${segment.transport.icon} ${segment.transport.name} · ${segment.transport.durationText} · ${Math.round(segment.distanceKm).toLocaleString("ru-RU")} км</span>
              </div>
              <div class="trip-summary-price">${segment.transport.priceText}</div>
            </button>
          `).join("")}
        </div>
      </div>

      ${finishMode ? `
        <div class="trip-finish-actions">
          <button class="route-action" id="save-trip-button" type="button">Сохранить в «Мои путешествия»</button>
          <button class="route-action secondary" id="new-trip-button" type="button">Начать новое путешествие</button>
        </div>
      ` : `
        <div class="trip-finish-actions">
          <button class="route-action secondary" id="saved-new-trip-button" type="button">Начать новое путешествие</button>
        </div>
      `}
    </div>
  `;

  openModal();

  document.querySelectorAll("[data-trip-segment-index]").forEach((segmentButton) => {
    segmentButton.addEventListener("click", () => {
      const index = Number(segmentButton.dataset.tripSegmentIndex);
      const segment = segments[index];
      if (!segment) return;

      state.routeDetailsReturn = savedTrip
        ? { type: "saved", trip: savedTrip }
        : { type: "active" };

      openRouteDetailsModal(segment, { fromTripSummary: true });
    });
  });

  document.getElementById("save-trip-button")?.addEventListener("click", saveCurrentTrip);
  document.getElementById("new-trip-button")?.addEventListener("click", startNewTrip);
  document.getElementById("saved-new-trip-button")?.addEventListener("click", startNewTrip);
}

function saveCurrentTrip() {
  if (!state.tripSegments.length) return;

  const totals = getTripTotals();
  const first = state.tripSegments[0];
  const last = state.tripSegments[state.tripSegments.length - 1];

  const savedTrip = {
    id: `trip-${Date.now()}`,
    title: `${first.origin.name} → ${last.destination.name}`,
    createdAt: new Date().toISOString(),
    segments: state.tripSegments.map((segment) => ({
      originId: segment.origin.id,
      destinationId: segment.destination.id,
      transportId: segment.transport.id,
      distanceKm: segment.distanceKm,
      durationHours: segment.transport.durationHours,
      durationText: segment.transport.durationText,
      priceRub: segment.transport.priceValue,
      priceText: segment.transport.priceText
    })),
    totals
  };

  state.savedTrips.push(savedTrip);
  localStorage.setItem("waymarkSavedTrips", JSON.stringify(state.savedTrips));

  showToast("Путешествие сохранено в «Моих путешествиях»");
  openNavigationModal("trips");
}

function startNewTrip() {
  closeModal();

  state.selectedOrigin = null;
  state.selectedDestination = null;
  state.selectedTransport = null;
  state.currentRoute = null;
  state.routeAnimation = null;
  state.routePhase = "idle";
  state.tripSegments = [];

  clearRouteVisual();
  closeTransportPanel();
  hideCityCard();

  bottomPanelContent.innerHTML = `
    <span class="bottom-panel-icon">📍</span>
    <span>Выберите место отправления</span>
  `;

  updateCityLabelStyles();
  state.labelsDirty = true;
  showToast("Начато новое путешествие");
}


const SURPRISE_MODES = {
  random: {
    title: "Случайный маршрут",
    short: "Неожиданная подборка городов",
    icon: "✦",
    description: "Неожиданная последовательность городов с учётом выбранных параметров."
  },
  budget: {
    title: "Экономичный маршрут",
    short: "Меньше расстояний и затрат",
    icon: "₽",
    description: "Маршрут с акцентом на более доступные переезды и компактную географию."
  },
  warm: {
    title: "Тёплый климат",
    short: "Солнце и мягкий климат",
    icon: "☀️",
    description: "Подборка городов с тёплой погодой и подходящим климатом для отдыха."
  },
  culture: {
    title: "Культурный маршрут",
    short: "История, искусство и архитектура",
    icon: "🏛️",
    description: "Города, где маршрут сосредоточен на культуре и популярных достопримечательностях."
  },
  megacities: {
    title: "Мировые мегаполисы",
    short: "Главные мировые мегаполисы",
    icon: "🌆",
    description: "Самые известные и крупные города из базы WAY●MARK."
  },
  gastronomy: {
    title: "Гастрономический маршрут",
    short: "Кухни и вкусы разных стран",
    icon: "🍽️",
    description: "Маршрут через города с ярко выраженной местной кухней."
  }
};

const SURPRISE_FILTERS = {
  climate: {
    label: "Климат",
    options: [
      ["any", "Любой климат"],
      ["tropical", "Тропический"],
      ["subtropical", "Субтропический"],
      ["mediterranean", "Средиземноморский"],
      ["temperate", "Умеренный"],
      ["cold", "Холодный"],
      ["desert", "Пустынный"]
    ]
  },
  budget: {
    label: "Бюджет",
    options: [
      ["any", "Без ограничений"],
      ["economy", "До 50 тыс. ₽"],
      ["moderate", "50–100 тыс. ₽"],
      ["comfort", "100–200 тыс. ₽"],
      ["premium", "Более 200 тыс. ₽"]
    ]
  },
  cityCount: {
    label: "Количество городов",
    options: [
      ["2", "2 города"],
      ["3", "3 города"],
      ["4", "4 города"],
      ["5", "5 городов"],
      ["unlimited", "Без ограничения"]
    ]
  },
  season: {
    label: "Время года",
    options: [
      ["any", "Любое время"],
      ["spring", "Весна"],
      ["summer", "Лето"],
      ["autumn", "Осень"],
      ["winter", "Зима"]
    ]
  },
  pace: {
    label: "Темп путешествия",
    options: [
      ["balanced", "Сбалансированный"],
      ["dynamic", "Динамичный"],
      ["relaxed", "Неторопливый"]
    ]
  },
  duration: {
    label: "Продолжительность",
    options: [
      ["any", "Без ограничений"],
      ["short", "До 12 часов"],
      ["medium", "12–24 часа"],
      ["long", "24–48 часов"],
      ["verylong", "Более 48 часов"]
    ]
  },
  transport: {
    label: "Транспорт",
    options: [
      ["any", "Любой доступный"],
      ["plane", "✈ Самолёт"],
      ["train", "🚆 Поезд"],
      ["car", "🚗 Автомобиль"],
      ["bus", "🚌 Автобус"],
      ["ship", "🚢 Корабль"]
    ]
  },
  popularity: {
    label: "Известность городов",
    options: [
      ["mixed", "Смешанный выбор"],
      ["top", "Самые популярные"],
      ["discovery", "Менее очевидные"]
    ]
  }
};

function getClimateMatch(city, climate) {
  if (climate === "any") return true;
  const value = String(city.climate || "").toLowerCase();
  const patterns = {
    tropical: /троп|экватор|муссон/,
    subtropical: /субтроп/,
    mediterranean: /средиземномор/,
    temperate: /умерен|океаничес|континентал/,
    cold: /холод|субарктич|поляр|тундр/,
    desert: /пустын|арид/
  };
  return Boolean(patterns[climate]?.test(value));
}

function getSeasonMatch(city, season) {
  if (season === "any") return true;
  const best = String(city.bestTime || "").toLowerCase();
  const monthMap = {
    spring: /март|апрел|май|весн/,
    summer: /июн|июл|август|лет/,
    autumn: /сентябр|октябр|ноябр|осен/,
    winter: /декабр|январ|феврал|зим/ 
  };
  return Boolean(monthMap[season]?.test(best));
}

function getPopularityMatch(city, popularity) {
  const value = Number(city.popularity) || 0;
  if (popularity === "top") return value >= 84;
  if (popularity === "discovery") return value <= 72;
  return true;
}

function getCityFilterCandidates(filters) {
  return CITY_DATA.filter((city) =>
    getClimateMatch(city, filters.climate) &&
    getSeasonMatch(city, filters.season) &&
    getPopularityMatch(city, filters.popularity)
  );
}

function getPreferredTransportOptions(origin, destination, transportId) {
  const options = getTransportOptions(origin, destination).filter((option) => option.available);
  if (!options.length) return [];
  if (transportId === "any") return options;

  const preferred = options.filter((option) => option.id === transportId);
  // A transport filter is treated as a preference rather than a hard block.
  // This prevents impossible combinations (for example 5 ship legs) from
  // producing a broken surprise route while still strongly preferring the choice.
  return preferred.length ? preferred : options;
}

function getCheapestAvailableTransport(origin, destination) {
  return getTransportOptions(origin, destination)
    .filter((option) => option.available)
    .sort((a, b) => a.priceValue - b.priceValue)[0] || null;
}

function getBudgetFit(value, budget) {
  if (budget === "any") return 20;
  const limits = {
    economy: [0, 50000],
    moderate: [50000, 100000],
    comfort: [100000, 200000],
    premium: [200000, Infinity]
  };
  const [min, max] = limits[budget] || [0, Infinity];
  if (value >= min && value <= max) return 30;
  const distance = value < min ? min - value : value - max;
  return Math.max(-50, 18 - distance / 8000);
}

function getDurationFit(value, duration) {
  if (duration === "any") return 20;
  const ranges = {
    short: [0, 12],
    medium: [12, 24],
    long: [24, 48],
    verylong: [48, Infinity]
  };
  const [min, max] = ranges[duration] || [0, Infinity];
  if (value >= min && value <= max) return 26;
  const distance = value < min ? min - value : value - max;
  return Math.max(-44, 14 - distance * 1.25);
}

function getPaceFit(distance, pace) {
  if (pace === "dynamic") {
    return distance <= 1500 ? 20 : distance <= 3500 ? 7 : -8;
  }
  if (pace === "relaxed") {
    return distance >= 800 ? 18 : distance >= 350 ? 7 : -5;
  }
  return 12;
}

function getSurpriseModeScore(city, mode) {
  const popularity = Number(city.popularity) || 0;
  const temp = Number(city.weather?.temp) || 0;
  const cuisine = String(city.cuisine || "").toLowerCase();
  const climate = String(city.climate || "").toLowerCase();
  const description = String(city.description || "").toLowerCase();

  switch (mode) {
    case "budget":
      return popularity * 0.18;
    case "warm":
      return temp * 3.2 + popularity * 0.35 + (/троп|субтроп|муссон|средиземномор|пустын|экватор|саван/i.test(climate) ? 18 : 0);
    case "culture":
      return popularity * 0.62 + (/музе|истор|архит|культур|дворец|собор|галере/i.test(description) ? 28 : 0);
    case "megacities":
      return popularity * 1.15;
    case "gastronomy":
      return popularity * 0.38 + (/кухня|гастр|ресторан|street|уличн/i.test(cuisine) ? 22 : 10);
    case "random":
    default:
      return Math.random() * 100;
  }
}

function pickSurpriseOrigin(mode, pool, filters) {
  const ranked = pool
    .map((city) => ({
      city,
      score: getSurpriseModeScore(city, mode) + (filters.popularity === "top" ? (Number(city.popularity) || 0) * 0.6 : 0) + Math.random() * 25
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(40, pool.length));

  return ranked[Math.floor(Math.random() * ranked.length)]?.city || pool[0];
}

function getRequestedCityCount(filters) {
  // The core WAY●MARK route UI currently supports up to 5 legs = 6 cities.
  // “Без ограничения” therefore means the maximum supported journey length.
  if (filters.cityCount === "unlimited") return 6;
  return THREE.MathUtils.clamp(Number(filters.cityCount) || 3, 2, 6);
}

function buildSurpriseCities(mode, count, filters = state.surpriseFilters) {
  const pool = getCityFilterCandidates(filters);
  if (pool.length < 2) return [];

  const targetCount = Math.min(getRequestedCityCount(filters), count || getRequestedCityCount(filters), CITY_DATA.length);
  const cities = [];
  const first = pickSurpriseOrigin(mode, pool, filters);
  if (!first) return [];
  cities.push(first);

  let totalHours = 0;
  let totalCost = 0;

  while (cities.length < targetCount) {
    const current = cities[cities.length - 1];
    const usedIds = new Set(cities.map((city) => city.id));
    const ranked = pool
      .filter((city) => !usedIds.has(city.id))
      .map((city) => {
        const distance = haversineDistanceKm(current, city);
        const options = getPreferredTransportOptions(current, city, filters.transport);
        if (!options.length) return null;

        const preferred = filters.transport === "any"
          ? options[0]
          : options.find((option) => option.id === filters.transport) || options[0];
        const nextHours = totalHours + preferred.durationHours;
        const nextCost = totalCost + (filters.budget === "any" ? preferred.priceValue : (getCheapestAvailableTransport(current, city)?.priceValue || preferred.priceValue));

        let score = getSurpriseModeScore(city, mode);
        score += getPaceFit(distance, filters.pace);
        score += getBudgetFit(preferred.priceValue, filters.budget);
        score += getDurationFit(nextHours, filters.duration);
        score += filters.transport !== "any" && preferred.id === filters.transport ? 28 : 0;
        score += filters.popularity === "top" ? (Number(city.popularity) || 0) * 0.45 : 0;
        score += filters.popularity === "discovery" ? Math.max(0, 78 - (Number(city.popularity) || 0)) * 0.9 : 0;
        score += city.country === current.country ? -18 : 10;
        score -= Math.min(distance / (filters.pace === "dynamic" ? 60 : 150), 45);
        score += Math.random() * (mode === "random" ? 70 : 14);

        return { city, score, preferred, nextHours, nextCost };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    if (!ranked.length) break;
    const best = ranked[0];
    cities.push(best.city);
    totalHours = best.nextHours;
    totalCost = best.nextCost;
  }

  return cities;
}

function chooseSurpriseTransport(origin, destination, mode, filters = state.surpriseFilters) {
  const options = getTransportOptions(origin, destination).filter((option) => option.available);
  if (!options.length) return null;

  if (filters.transport && filters.transport !== "any") {
    const preferred = options.find((option) => option.id === filters.transport);
    if (preferred) return preferred;
  }

  if (mode === "budget") {
    return options.slice().sort((a, b) => a.priceValue - b.priceValue)[0];
  }

  if (mode === "random") {
    return options[Math.floor(Math.random() * options.length)];
  }

  return options.slice().sort((a, b) => a.durationHours - b.durationHours)[0];
}

function renderSurpriseBuildingPanel(nextDestination, step, totalCities) {
  bottomPanelContent.innerHTML = `
    <span class="bottom-panel-icon">✦</span>
    <span class="bottom-city">${nextDestination.name}</span>
    <span class="bottom-arrow">·</span>
    <span>WAY●MARK составляет маршрут ${Math.min(step, totalCities)} / ${totalCities}</span>
  `;
}

function openSurpriseModal() {
  closeTransportPanel();
  navButtons.forEach((button) => button.classList.remove("active"));
  surpriseButton?.classList.add("active");

  modalTitle.textContent = "Удиви меня";
  modalContent.innerHTML = `
    <div class="surprise-header">
      <div>
        <div class="surprise-lead">Выбор параметров путешествия</div>
      </div>
    </div>

    <div class="surprise-section-heading">
      <span class="surprise-section-kicker">Готовые шаблоны</span>
      <span class="surprise-section-line"></span>
    </div>

    <div class="surprise-options-grid">
      ${Object.entries(SURPRISE_MODES).map(([id, mode]) => `
        <button class="surprise-option ${id === state.surpriseMode ? "selected" : ""}" type="button" data-surprise-mode="${id}">
          <span class="surprise-option-icon">${mode.icon}</span>
          <span class="surprise-option-copy">
            <strong>${mode.title}</strong>
            <span>${mode.short}</span>
          </span>
          <span class="surprise-option-check">✓</span>
        </button>
      `).join("")}
    </div>

    <div class="surprise-section-heading detailed-heading">
      <div>
        <span class="surprise-section-kicker">Подробный выбор</span>
        <span class="surprise-section-subtitle">Настройте маршрут под свои предпочтения</span>
      </div>
      <span class="surprise-section-line"></span>
    </div>

    <div class="surprise-filter-grid">
      ${Object.entries(SURPRISE_FILTERS).map(([key, filter]) => `
        <label class="surprise-filter-card">
          <span class="surprise-filter-label">${filter.label}</span>
          <span class="surprise-select-wrap">
            <select class="surprise-select" data-surprise-filter="${key}">
              ${filter.options.map(([value, label]) => `
                <option value="${value}" ${state.surpriseFilters[key] === value ? "selected" : ""}>${label}</option>
              `).join("")}
            </select>
          </span>
        </label>
      `).join("")}
    </div>

    <div class="surprise-footer">
      <div class="surprise-footer-copy">
        <strong id="surprise-selected-title">${SURPRISE_MODES[state.surpriseMode].title}</strong>
        <span id="surprise-selected-description">${SURPRISE_MODES[state.surpriseMode].description}</span>
      </div>
      <button class="route-action surprise-build-button" id="surprise-build-button" type="button">Составить маршрут</button>
    </div>
  `;

  openModal();

  const updateSurpriseSelection = () => {
    document.querySelectorAll("[data-surprise-mode]").forEach((card) => {
      card.classList.toggle("selected", card.dataset.surpriseMode === state.surpriseMode);
    });

    const mode = SURPRISE_MODES[state.surpriseMode];
    const title = document.getElementById("surprise-selected-title");
    const description = document.getElementById("surprise-selected-description");
    if (title) title.textContent = mode.title;
    if (description) description.textContent = mode.description;
  };

  document.querySelectorAll("[data-surprise-mode]").forEach((card) => {
    card.addEventListener("click", () => {
      state.surpriseMode = card.dataset.surpriseMode;
      updateSurpriseSelection();
    });
  });

  document.querySelectorAll("[data-surprise-filter]").forEach((select) => {
    select.addEventListener("change", () => {
      const key = select.dataset.surpriseFilter;
      state.surpriseFilters[key] = select.value;
      if (key === "cityCount") {
        state.surpriseCityCount = select.value === "unlimited" ? 6 : Number(select.value) || 3;
      }
    });
  });

  document.getElementById("surprise-build-button")?.addEventListener("click", () => {
    startSurpriseJourney(state.surpriseMode, getRequestedCityCount(state.surpriseFilters), state.surpriseFilters);
  });
}

function startSurpriseJourney(mode, count, filters = state.surpriseFilters) {
  const cities = buildSurpriseCities(mode, count, filters);
  if (cities.length < 2) {
    showToast("Не удалось подобрать маршрут.");
    return;
  }

  // Surprise replaces the current unsaved route, matching the behavior of
  // starting a new journey while keeping the user inside the same map UI.
  closeModal();
  closeTransportPanel();
  state.selectedOrigin = cities[0];
  state.selectedDestination = cities[1];
  state.selectedTransport = null;
  state.currentRoute = null;
  state.routeAnimation = null;
  state.tripSegments = [];
  state.surprisePlan = { mode, filters, cities, nextIndex: 2 };
  state.routePhase = "animating";

  clearRouteVisual();
  hideCityCard();
  updateCityLabelStyles();
  renderSurpriseBuildingPanel(cities[1], 2, cities.length);
  showToast(`Составляем: ${SURPRISE_MODES[mode].title}`);

  const transport = chooseSurpriseTransport(cities[0], cities[1], mode, filters);
  if (!transport) {
    state.surprisePlan = null;
    state.routePhase = "ready";
    showToast("Не удалось подобрать транспорт для маршрута.");
    return;
  }

  state.selectedTransport = transport;
  startRouteAnimation(cities[0], cities[1], transport);
}

const CURRENCY_TO_RUB = {
  RUB: 1, USD: 95, EUR: 105, GBP: 125, CHF: 132, JPY: 0.65, CNY: 13.2, HKD: 12.1,
  MOP: 11.8, TWD: 3.0, KRW: 0.069, SGD: 74, AUD: 63, CAD: 70, NZD: 55, AED: 26,
  TRY: 2.65, INR: 1.13, THB: 2.75, MXN: 5.5, BRL: 18, ARS: 0.08, EGP: 1.95, ZAR: 5.2,
  CZK: 4.25, SEK: 9.2, NOK: 9.3, DKK: 14.1, ISK: 0.68, PLN: 24.5, RON: 21.1, BGN: 53.7,
  RSD: 0.90, BAM: 53.7, VND: 0.0037, PHP: 1.7, MYR: 22.2, IDR: 0.0058, MMK: 0.045, KHR: 0.023,
  LAK: 0.0045, NPR: 0.71, LKR: 0.31, BDT: 0.80, PKR: 0.34, JOD: 134, ILS: 26, QAR: 26.1, OMR: 247,
  SAR: 25.3, KWD: 310, BHD: 252, AZN: 56, GEL: 34, AMD: 0.24, KZT: 0.19, BSD: 95, DOP: 1.55,
  JMD: 0.61, GTQ: 12.4, PAB: 95, CLP: 0.10, PEN: 26, BOB: 13.8, COP: 0.023, VES: 1.7, UYU: 2.35,
  PYG: 0.012, XOF: 0.17, GHS: 6.9, NGN: 0.070, ETB: 0.69, KES: 0.74, TZS: 0.035, UGX: 0.026,
  RWF: 0.066, NAD: 5.2, MZN: 1.5, AOA: 0.105, SCR: 7.0, FJD: 44, XPF: 0.88
};

const CURRENCY_LABELS = {
  RUB: "Российский рубль", USD: "Доллар США", EUR: "Евро", GBP: "Фунт стерлингов", CHF: "Швейцарский франк",
  JPY: "Японская иена", CNY: "Китайский юань", HKD: "Гонконгский доллар", MOP: "Патака Макао", TWD: "Новый тайваньский доллар",
  KRW: "Южнокорейская вона", SGD: "Сингапурский доллар", AUD: "Австралийский доллар", CAD: "Канадский доллар", NZD: "Новозеландский доллар",
  AED: "Дирхам ОАЭ", TRY: "Турецкая лира", INR: "Индийская рупия", THB: "Тайский бат", MXN: "Мексиканское песо", BRL: "Бразильский реал",
  ARS: "Аргентинское песо", EGP: "Египетский фунт", ZAR: "Южноафриканский рэнд", CZK: "Чешская крона", SEK: "Шведская крона", NOK: "Норвежская крона",
  DKK: "Датская крона", ISK: "Исландская крона", PLN: "Польский злотый", RON: "Румынский лей", BGN: "Болгарский лев", RSD: "Сербский динар",
  BAM: "Конвертируемая марка", VND: "Вьетнамский донг", PHP: "Филиппинское песо", MYR: "Малайзийский ринггит", IDR: "Индонезийская рупия", MMK: "Мьянманский кьят",
  KHR: "Камбоджийский риель", LAK: "Лаосский кип", NPR: "Непальская рупия", LKR: "Шри-ланкийская рупия", BDT: "Бангладешская така", PKR: "Пакистанская рупия",
  JOD: "Иорданский динар", ILS: "Новый израильский шекель", QAR: "Катарский риал", OMR: "Оманский риал", SAR: "Саудовский риял", KWD: "Кувейтский динар",
  BHD: "Бахрейнский динар", AZN: "Азербайджанский манат", GEL: "Грузинский лари", AMD: "Армянский драм", KZT: "Казахстанский тенге",
  BSD: "Багамский доллар", DOP: "Доминиканское песо", JMD: "Ямайский доллар", GTQ: "Гватемальский кетсаль", PAB: "Панамский бальбоа",
  CLP: "Чилийское песо", PEN: "Перуанский соль", BOB: "Боливиано", COP: "Колумбийское песо", VES: "Венесуэльский боливар", UYU: "Уругвайское песо",
  PYG: "Парагвайский гуарани", XOF: "Франк КФА BCEAO", GHS: "Ганский седи", NGN: "Нигерийская найра", ETB: "Эфиопский быр", KES: "Кенийский шиллинг",
  TZS: "Танзанийский шиллинг", UGX: "Угандийский шиллинг", RWF: "Франк Руанды", NAD: "Намибийский доллар", MZN: "Мозамбикский метикал",
  AOA: "Ангольская кванза", SCR: "Сейшельская рупия", FJD: "Доллар Фиджи", XPF: "Франк КФП"
};

const POPULAR_CURRENCY_ORDER = [
  "RUB", "USD", "EUR", "GBP", "JPY", "CNY", "CHF", "CAD", "AUD", "HKD",
  "SGD", "AED", "TRY", "INR", "KRW", "THB", "MXN", "BRL", "ARS", "ZAR", "EGP", "CZK", "SEK", "NOK", "NZD"
];

function currencyRateToRub(currency) {
  return CURRENCY_TO_RUB[currency] ?? 1;
}

function getConverterCurrencyCodes(route) {
  const cityCurrencies = new Set(CITY_DATA.map((city) => city.currency));
  if (route?.origin?.currency) cityCurrencies.add(route.origin.currency);
  if (route?.destination?.currency) cityCurrencies.add(route.destination.currency);

  const ordered = POPULAR_CURRENCY_ORDER.filter((code) => cityCurrencies.has(code) || code === "RUB");
  for (const code of cityCurrencies) {
    if (!ordered.includes(code) && CURRENCY_TO_RUB[code]) ordered.push(code);
  }
  return ordered;
}

function renderCurrencyOptions(selectedCode, route) {
  return getConverterCurrencyCodes(route).map((code) => `
    <option value="${code}" ${code === selectedCode ? "selected" : ""}>${CURRENCY_LABELS[code] || code} (${code})</option>
  `).join("");
}

function getCityTourRoute(city) {
  const names = city.attractions.slice(0, 6).map(([name]) => name);
  if (names.length < 6) return names.join(" → ");
  return `${names.slice(0, 3).join(" → ")} → ${names.slice(3).join(" → ")}`;
}

function openRouteDetailsModal(route, options = {}) {
  navButtons.forEach((button) => button.classList.remove("active"));

  const originRate = currencyRateToRub(route.origin.currency);
  const exampleRub = Math.max(700, Math.round(route.transport.priceValue / 100) * 100);
  const originExample = Math.max(1, Math.round((exampleRub / originRate) * 10) / 10);

  modalTitle.textContent = "Подробности о маршруте";
  modalContent.innerHTML = `
    <div class="modal-grid">
      <div class="modal-hero">
        <div>
          <div class="modal-city-name">${route.origin.name} → ${route.destination.name}</div>
          <div class="modal-city-description">${route.transport.icon} ${route.transport.name} · ${route.transport.description}</div>
        </div>
        <div class="modal-stat-grid">
          <div class="modal-stat"><div class="stat-label">Транспорт</div><div class="stat-value">${route.transport.icon} ${route.transport.name}</div></div>
          <div class="modal-stat"><div class="stat-label">Расстояние</div><div class="stat-value">${Math.round(route.distanceKm).toLocaleString("ru-RU")} км</div></div>
          <div class="modal-stat"><div class="stat-label">Время в пути</div><div class="stat-value">${route.transport.durationText}</div></div>
          <div class="modal-stat"><div class="stat-label">Примерная цена</div><div class="stat-value">${route.transport.priceText}</div></div>
        </div>
      </div>

      <div class="modal-section">
        <h3>Рекомендации</h3>
        <div class="modal-stat-grid">
          <div class="modal-stat"><div class="stat-label">Погода</div><div class="stat-value">${route.destination.weather.temp}°C · ${route.destination.weather.condition}</div></div>
          <div class="modal-stat"><div class="stat-label route-season-label">Лучшее время года для посещения</div><div class="stat-value">${route.destination.bestTime}</div></div>
          <div class="modal-stat"><div class="stat-label">Климат</div><div class="stat-value">${route.destination.climate}</div></div>
          <div class="modal-stat"><div class="stat-label">Кухня</div><div class="stat-value">${route.destination.cuisine}</div></div>
        </div>
      </div>

      <div class="modal-section">
        <h3>Тур по городу</h3>
        <div class="route-tour-copy">
          <div class="route-tour-route">${getCityTourRoute(route.destination)}</div>
          <div class="route-tour-note">Удобный порядок для первого знакомства с главными местами города. Начните утром и двигайтесь по маршруту без лишних возвращений.</div>
        </div>
      </div>

      <div class="modal-section">
        <h3>Конвертер валют</h3>
        <div class="converter-box">
          <div class="converter-row">
            <div class="converter-field">
              <label class="stat-label" for="converter-from">Из валюты</label>
              <select id="converter-from" class="converter-select">${renderCurrencyOptions(route.origin.currency, route)}</select>
            </div>
            <div class="converter-arrow">→</div>
            <div class="converter-field">
              <label class="stat-label" for="converter-to">В валюту</label>
              <select id="converter-to" class="converter-select">${renderCurrencyOptions(route.destination.currency, route)}</select>
            </div>
          </div>
          <div class="converter-input-row">
            <input id="converter-input" class="converter-input" type="number" min="0" step="0.01" value="${originExample}" aria-label="Сумма для конвертации" />
            <div class="converter-equals">=</div>
            <div id="converter-result" class="converter-result">—</div>
          </div>
        </div>
      </div>
    </div>
  `;

  openModal();
  setModalBackButton(Boolean(options.fromTripSummary && state.routeDetailsReturn), () => {
    const returnContext = state.routeDetailsReturn;
    state.routeDetailsReturn = null;

    if (returnContext?.type === "saved" && returnContext.trip) {
      openTripSummaryModal(false, returnContext.trip);
      return;
    }

    if (returnContext?.type === "active") {
      openTripSummaryModal(true);
    }
  });

  const converterInput = document.getElementById("converter-input");
  const converterFrom = document.getElementById("converter-from");
  const converterTo = document.getElementById("converter-to");
  const converterResult = document.getElementById("converter-result");

  const updateConverter = () => {
    const amount = Math.max(0, Number(converterInput?.value) || 0);
    const fromRate = currencyRateToRub(converterFrom?.value || route.origin.currency);
    const toRate = currencyRateToRub(converterTo?.value || route.destination.currency);
    const converted = toRate > 0 ? amount * fromRate / toRate : 0;
    converterResult.textContent = `${converted.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ${converterTo?.value || route.destination.currency}`;
  };

  const preserveRubValueWhenChangingFrom = () => {
    const amount = Math.max(0, Number(converterInput?.value) || 0);
    const previousCode = converterInput?.dataset.currency || route.origin.currency;
    const previousRate = currencyRateToRub(previousCode);
    const rub = amount * previousRate;
    const nextCode = converterFrom?.value || route.origin.currency;
    const nextRate = currencyRateToRub(nextCode);
    converterInput.value = nextRate > 0 ? String(Math.round((rub / nextRate) * 100) / 100) : "0";
    converterInput.dataset.currency = nextCode;
    updateConverter();
  };

  if (converterInput && converterFrom && converterTo) {
    converterInput.dataset.currency = converterFrom.value;
    converterInput.addEventListener("input", updateConverter);
    converterTo.addEventListener("change", updateConverter);
    converterFrom.addEventListener("change", preserveRubValueWhenChangingFrom);
    updateConverter();
  }
}

function selectCity(city) {
  if (state.routePhase !== "ready" && isSameCity(city)) {
    showCityCard(city);
    if (state.selectedDestination?.id === city.id && state.routePhase === "transport") {
      openTransportPanel(state.selectedOrigin, city);
    }
    return;
  }

  if (state.routePhase === "animating") {
    showToast("Дождитесь завершения построения маршрута.");
    return;
  }

  if (state.routePhase === "ready") {
    const lastRoute = state.tripSegments[state.tripSegments.length - 1];

    if (!lastRoute) {
      state.routePhase = "idle";
    } else if (state.tripSegments.length >= 5) {
      showToast("Достигнут лимит в 5 сегментов. Завершите путешествие или начните новое.");
      return;
    } else if (city.id === lastRoute.destination.id) {
      showCityCard(city);
      return;
    } else {
      state.selectedOrigin = lastRoute.destination;
      state.selectedDestination = city;
      state.selectedTransport = null;
      state.currentRoute = null;
      state.routeAnimation = null;
      state.routePhase = "selecting";
      dimCompletedRouteVisuals();
      updateBottomDestinationState(city);
      updateCityLabelStyles();
      showCityCard(city);
      openTransportPanel(state.selectedOrigin, city);
      showToast(`${city.name} выбрана как следующая точка`);
      return;
    }
  }

  if (state.routePhase !== "idle" && state.routePhase !== "transport" && state.routePhase !== "selecting") {
    showToast("Для нового маршрута начните новое путешествие.");
    return;
  }

  if (state.selectedOrigin && state.selectedDestination) {
    showToast("Выберите транспорт для текущего маршрута.");
    return;
  }

  if (!state.selectedOrigin) {
    state.selectedOrigin = city;
    setBottomOriginState(city);
    updateCityLabelStyles();
    showCityCard(city);
    showToast(`${city.name} выбрана как точка отправления`);
    return;
  }

  state.selectedDestination = city;
  updateBottomDestinationState(city);
  updateCityLabelStyles();
  state.labelsDirty = true;
  showCityCard(city);
  openTransportPanel(state.selectedOrigin, city);
  showToast(`${city.name} выбрана как направление`);
}

function setBottomOriginState(city) {
  bottomPanelContent.innerHTML = `
    <span class="bottom-panel-icon">📍</span>
    <span class="bottom-city">${city.name}</span>
    <span class="bottom-arrow">→</span>
    <span>Выберите место, куда отправиться</span>
  `;
}

function updateBottomDestinationState(city) {
  bottomPanelContent.innerHTML = `
    <span class="bottom-panel-icon">📍</span>
    <span class="bottom-city">${state.selectedOrigin.name}</span>
    <span class="bottom-arrow">→</span>
    <span class="bottom-city">${city.name}</span>
  `;
}

function updateCityLabelStyles() {
  const tripCityIds = new Set();
  for (const segment of state.tripSegments) {
    tripCityIds.add(segment.origin.id);
    tripCityIds.add(segment.destination.id);
  }

  for (const entry of cityEntries) {
    const isSelected =
      tripCityIds.has(entry.city.id) ||
      entry.city.id === state.selectedOrigin?.id ||
      entry.city.id === state.selectedDestination?.id;

    entry.label.classList.toggle("selected", Boolean(isSelected));

    if (entry.marker.material instanceof THREE.MeshBasicMaterial) {
      entry.marker.material.color.set(
        entry.city.id === state.selectedDestination?.id
          ? 0x4f8cff
          : entry.city.id === state.selectedOrigin?.id
            ? 0x6589ba
            : tripCityIds.has(entry.city.id)
              ? 0x7b9bc8
              : 0x91a0ae
      );

      entry.marker.material.opacity = isSelected ? 0.95 : 0.55;
    }
  }
  state.sceneDirty = true;
}

function getCityWorldPosition(city) {
  const entry = cityEntriesById.get(city.id);
  reusableWorld.copy(entry.localPosition).applyMatrix4(globeGroup.matrixWorld);
  return reusableWorld;
}


function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function formatLocalTime(city) {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: city.timezone
    }).format(new Date());
  } catch {
    return "--:--";
  }
}

function showCityCard(city) {
  window.clearTimeout(cityCardHideTimer);
  globeGroup.updateMatrixWorld();
  state.previewCity = city;
  cityCard.innerHTML = `
    <div class="city-card-title-row">
      <div class="city-card-heading">
        <h3 class="city-card-title">${escapeHtml(city.name)}</h3>
        <div class="city-card-country">${escapeHtml(city.flag || "")} ${escapeHtml(city.country || "")}</div>
      </div>
      <div class="city-card-time" aria-label="Местное время"><strong data-city-time>${formatLocalTime(city)}</strong></div>
    </div>
    <div class="city-card-actions">
      <button class="city-card-button city-card-button-primary" id="city-add-route-button" type="button">Добавить в маршрут</button>
      <button class="city-card-button city-card-button-explore" id="city-explore-button" type="button">Исследовать город <span aria-hidden="true">↗</span></button>
      <button class="city-card-details-link" id="city-details-button" type="button">Подробнее о городе</button>
    </div>
  `;

  cityCard.classList.remove("hidden");
  cityCard.style.opacity = "0";
  cityCard.style.visibility = "hidden";
  requestAnimationFrame(() => {
    positionCityCard();
    cityCard.style.visibility = "visible";
    cityCard.classList.add("visible");
  });

  document.getElementById("city-add-route-button")?.addEventListener("click", (event) => {
    event.stopPropagation();
    selectCity(city);
  });
  document.getElementById("city-explore-button")?.addEventListener("click", (event) => {
    event.stopPropagation();
    hideCityCard();
    cityExplorerController.open(city);
  });
  document.getElementById("city-details-button")?.addEventListener("click", (event) => {
    event.stopPropagation();
    openCityDetailsModal(city);
  });
}

function hideCityCard() {
  window.clearTimeout(cityCardHideTimer);
  cityCard.classList.remove("visible");
  cityCardHideTimer = window.setTimeout(() => {
    cityCard.classList.add("hidden");
    state.previewCity = null;
  }, 220);
}

function positionCityCard() {
  const targetCity = state.previewCity || state.selectedDestination || state.selectedOrigin;
  if (!targetCity || cityCard.classList.contains("hidden")) return;

  const position = projectCity(targetCity);
  if (!position.visible) {
    cityCard.style.opacity = "1";
    return;
  }

  const pad = 14;
  const safeTop = 82;
  const safeBottom = 118;
  const gap = 16;
  const width = Math.min(isMobileUiActive() ? 270 : 310, window.innerWidth - pad * 2);
  cityCard.style.width = `${width}px`;
  // Measure the real compact card before choosing a location around the selected city.
  cityCard.style.left = `${pad}px`;
  cityCard.style.top = `${safeTop}px`;
  cityCard.style.transform = "none";
  const rect = cityCard.getBoundingClientRect();
  const height = Math.max(100, rect.height || 140);
  const x = position.x;
  const y = position.y;
  const viewportRight = window.innerWidth - pad;
  const viewportBottom = window.innerHeight - safeBottom;
  const candidates = [
    { side: "right", left: x + gap, top: y - height / 2, fits: x + gap + width <= viewportRight && y - height / 2 >= safeTop && y + height / 2 <= viewportBottom },
    { side: "left", left: x - gap - width, top: y - height / 2, fits: x - gap - width >= pad && y - height / 2 >= safeTop && y + height / 2 <= viewportBottom },
    { side: "below", left: x - width / 2, top: y + gap, fits: x - width / 2 >= pad && x + width / 2 <= viewportRight && y + gap + height <= viewportBottom },
    { side: "above", left: x - width / 2, top: y - gap - height, fits: x - width / 2 >= pad && x + width / 2 <= viewportRight && y - gap - height >= safeTop }
  ];
  let chosen = candidates.find((candidate) => candidate.fits);
  if (!chosen) {
    // When no side fits completely, choose the side with most usable space and clamp it to the viewport.
    const spaces = [
      { side: "right", space: viewportRight - x, left: x + gap, top: y - height / 2 },
      { side: "left", space: x - pad, left: x - gap - width, top: y - height / 2 },
      { side: "below", space: viewportBottom - y, left: x - width / 2, top: y + gap },
      { side: "above", space: y - safeTop, left: x - width / 2, top: y - gap - height }
    ].sort((a, b) => b.space - a.space);
    chosen = spaces[0];
  }
  const left = THREE.MathUtils.clamp(chosen.left, pad, Math.max(pad, window.innerWidth - width - pad));
  const top = THREE.MathUtils.clamp(chosen.top, safeTop, Math.max(safeTop, viewportBottom - height));
  cityCard.classList.remove("card-left", "card-right", "card-above", "card-below");
  cityCard.classList.add(`card-${chosen.side}`);
  cityCard.style.left = `${left}px`;
  cityCard.style.top = `${top}px`;
  cityCard.style.opacity = "1";
}

function projectCity(city) {
  const entry = cityEntriesById.get(city.id);
  if (!entry) return { x: 0, y: 0, visible: false };

  reusableWorld.copy(entry.localPosition).applyMatrix4(globeGroup.matrixWorld);
  reusableProjected.copy(reusableWorld).project(camera);

  const x = (reusableProjected.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-reusableProjected.y * 0.5 + 0.5) * window.innerHeight;

  reusableCameraDirection.subVectors(camera.position, reusableWorld).normalize();
  reusableNormal.copy(reusableWorld).normalize();
  const frontFacing = reusableNormal.dot(reusableCameraDirection) > 0.05;

  const visible =
    frontFacing &&
    reusableProjected.z > -1 &&
    reusableProjected.z < 1 &&
    x > -120 &&
    x < window.innerWidth + 120 &&
    y > 70 &&
    y < window.innerHeight - 50;

  return { x, y, visible };
}
function getLabelCollisionPadding() {
  // A small buffer keeps labels visually separate even when city names are close.
  return 7;
}

function rectsOverlap(a, b) {
  return !(
    a.right <= b.left ||
    a.left >= b.right ||
    a.bottom <= b.top ||
    a.top >= b.bottom
  );
}

function getGridKeys(rect, cellSize = 120) {
  const minX = Math.floor(rect.left / cellSize);
  const maxX = Math.floor(rect.right / cellSize);
  const minY = Math.floor(rect.top / cellSize);
  const maxY = Math.floor(rect.bottom / cellSize);
  const keys = [];

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      keys.push(`${x}:${y}`);
    }
  }

  return keys;
}

function updateCityLabels() {
  globeGroup.updateMatrixWorld();

  const requiredCityIds = getRequiredCityIds();
  const cameraZ = camera.position.z;
  const zoomTier = cameraZ >= 5.75 ? 1 : cameraZ >= 5.05 ? 2 : 3;
  // Keep country names at distant zoom and city names at medium zoom; avoid
  // the broad overlap that previously showed both label systems together.
  const cityLayerFade = 1; // Keep city labels at stable opacity across globe zoom levels.
  // At very close globe zoom, city labels become visual clutter and disappear.
  // Globe city labels remain available even at maximum globe zoom. The close-zoom
  // label fade belongs to the city-map view, not to this globe overlay.
  const closeZoomCityFade = 1;
  const candidates = [];

  for (const entry of cityEntries) {
    reusableWorld.copy(entry.localPosition).applyMatrix4(globeGroup.matrixWorld);
    reusableProjected.copy(reusableWorld).project(camera);

    const x = (reusableProjected.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-reusableProjected.y * 0.5 + 0.5) * window.innerHeight;

    reusableCameraDirection.subVectors(camera.position, reusableWorld).normalize();
    reusableNormal.copy(reusableWorld).normalize();
    const frontFacing = reusableNormal.dot(reusableCameraDirection) > 0.04;

    const inScreen =
      reusableProjected.z > -1 &&
      reusableProjected.z < 1 &&
      x > -120 &&
      x < window.innerWidth + 120 &&
      y > 58 &&
      y < window.innerHeight + 24;

    const tier = getCityVisibilityTier(entry.city);
    const forced = requiredCityIds.has(entry.city.id);

    candidates.push({
      entry,
      x,
      y,
      labelWidth: entry.labelWidth,
      labelHeight: entry.labelHeight,
      frontFacing,
      inScreen,
      zoomAllows: forced || tier <= zoomTier,
      forced,
      tier,
      priority: forced
        ? (entry.city.id === state.selectedDestination?.id ? 0 : entry.city.id === state.selectedOrigin?.id ? 1 : 2)
        : tier * 10,
      coverageEligible: zoomTier === 1 && frontFacing && inScreen && !forced
    });
  }

  if (zoomTier === 1) {
    const coverageCellW = Math.max(240, Math.min(330, window.innerWidth / 4.2));
    const coverageCellH = Math.max(190, Math.min(260, window.innerHeight / 3.2));
    const coverageMap = new Map();

    for (const candidate of candidates) {
      if (!candidate.coverageEligible) continue;
      const key = `${Math.floor((candidate.x + window.innerWidth) / coverageCellW)}:${Math.floor((candidate.y + 80) / coverageCellH)}`;
      const existing = coverageMap.get(key);
      if (!existing || candidate.entry.city.popularity > existing.entry.city.popularity) {
        coverageMap.set(key, candidate);
      }
    }

    for (const candidate of coverageMap.values()) {
      candidate.zoomAllows = true;
      // Coverage representatives sit just behind true far-tier cities,
      // so popular global hubs retain visual emphasis.
      candidate.priority = Math.min(candidate.priority, 24);
    }
  }

  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return Math.hypot(a.x - window.innerWidth / 2, a.y - window.innerHeight / 2) -
      Math.hypot(b.x - window.innerWidth / 2, b.y - window.innerHeight / 2);
  });

  const occupiedGrid = new Map();
  const placed = [];
  const offsets = [
    [0, 0], [0, -18], [0, 18], [22, 0], [-22, 0],
    [18, -18], [-18, -18], [18, 18], [-18, 18],
    [0, -32], [0, 32], [32, 0], [-32, 0]
  ];

  const safeTop = 70;
  const safeBottom = 62;
  const padding = getLabelCollisionPadding();

  const canPlace = (rect) => {
    if (rect.top < safeTop || rect.bottom > window.innerHeight - safeBottom) return false;
    for (const key of getGridKeys(rect)) {
      const bucket = occupiedGrid.get(key);
      if (!bucket) continue;
      for (const other of bucket) {
        if (rectsOverlap(rect, other)) return false;
      }
    }
    return true;
  };

  const occupy = (rect) => {
    for (const key of getGridKeys(rect)) {
      if (!occupiedGrid.has(key)) occupiedGrid.set(key, []);
      occupiedGrid.get(key).push(rect);
    }
    placed.push(rect);
  };

  for (const candidate of candidates) {
    const { entry, x, y, labelWidth, labelHeight, frontFacing, inScreen, zoomAllows } = candidate;
    const baseVisible = frontFacing && inScreen && zoomAllows;

    let chosen = null;
    if (baseVisible) {
      for (const [offsetX, offsetY] of offsets) {
        const rect = {
          left: x + offsetX - labelWidth / 2 - padding,
          right: x + offsetX + labelWidth / 2 + padding,
          top: y + offsetY - labelHeight / 2 - padding,
          bottom: y + offsetY + labelHeight / 2 + padding,
          x: x + offsetX,
          y: y + offsetY
        };
        if (canPlace(rect)) {
          chosen = rect;
          break;
        }
      }
    }

    const visible = Boolean(chosen);
    entry.label.style.left = `${chosen?.x ?? x}px`;
    entry.label.style.top = `${chosen?.y ?? y}px`;
    const combinedCityFade = cityLayerFade * closeZoomCityFade;
    entry.label.style.opacity = visible ? String(combinedCityFade) : "0";
    entry.label.style.pointerEvents = visible && combinedCityFade > 0.22 ? "auto" : "none";

    entry.marker.visible = (visible || candidate.forced) && combinedCityFade > 0.02;
    if (candidate.forced) {
      entry.marker.visible = frontFacing && inScreen && combinedCityFade > 0.02;
    }
    if (entry.marker.material instanceof THREE.MeshBasicMaterial) {
      entry.marker.material.opacity = (candidate.forced ? 0.95 : 0.55) * combinedCityFade;
    }

    if (chosen) occupy(chosen);
  }

  countryOverlay.update();
  positionCityCard();
  state.labelsDirty = false;
}

function updateCityClock() {
  const city = state.selectedDestination || state.selectedOrigin;
  if (!city || cityCard.classList.contains("hidden")) return;

  const timeElement = cityCard.querySelector("[data-city-time]");
  if (timeElement) {
    timeElement.textContent = formatLocalTime(city);
  }
}

function openCityDetailsModal(city) {
  navButtons.forEach((button) => button.classList.remove("active"));

  modalTitle.textContent = "Подробности о городе";
  modalContent.innerHTML = `
    <div class="modal-grid">
      <div class="modal-hero">
        <div>
          <div class="modal-city-name">${city.name} ${city.flag}</div>
          <div class="modal-city-description">${city.description}</div>
        </div>
        <div class="modal-stat-grid">
          <div class="modal-stat">
            <div class="stat-label">Страна</div>
            <div class="stat-value">${city.country}</div>
          </div>
          <div class="modal-stat">
            <div class="stat-label">Местное время</div>
            <div class="stat-value">${formatLocalTime(city)}</div>
          </div>
          <div class="modal-stat">
            <div class="stat-label">Язык</div>
            <div class="stat-value">${city.language}</div>
          </div>
          <div class="modal-stat">
            <div class="stat-label">Валюта</div>
            <div class="stat-value">${city.currency}</div>
          </div>
        </div>
      </div>

      <div class="modal-section">
        <h3>О городе</h3>
        <div class="modal-stat-grid">
          <div class="modal-stat">
            <div class="stat-label">Погода</div>
            <div class="stat-value">${city.weather.temp}°C · ${city.weather.condition}</div>
          </div>
          <div class="modal-stat">
            <div class="stat-label">Климат</div>
            <div class="stat-value">${city.climate}</div>
          </div>
          <div class="modal-stat">
            <div class="stat-label">Лучшее время</div>
            <div class="stat-value">${city.bestTime}</div>
          </div>
          <div class="modal-stat">
            <div class="stat-label">Кухня</div>
            <div class="stat-value">${city.cuisine}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="modal-section" style="margin-top: 14px;">
      <h3>Популярные достопримечательности</h3>
      <div class="attraction-list">
        ${city.attractions.slice(0, 3).map(([name, note]) => `
          <article class="attraction">
            <div class="attraction-name">${name}</div>
            <div class="attraction-note">${note}</div>
          </article>
        `).join("")}
      </div>
    </div>
  `;

  openModal();
}

function openNavigationModal(view) {
  closeTransportPanel();
  if (view === "map") {
    closeModal();
    return;
  }

  modalTitle.textContent = view === "favorites" ? "Избранное" : "Моё путешествие";

  if (view === "trips" && state.savedTrips.length) {
    const tripsMarkup = state.savedTrips.slice().reverse().map((trip) => `
      <article class="saved-trip-card" data-saved-trip-id="${trip.id}" role="button" tabindex="0" aria-label="Открыть путешествие ${trip.title}">
        <div>
          <strong>${trip.title}</strong>
          <div class="saved-trip-meta">
            ${trip.segments.length} ${trip.segments.length === 1 ? "сегмент" : "сегмента"} ·
            ${Math.round(trip.totals.distanceKm).toLocaleString("ru-RU")} км ·
            ${formatDuration(trip.totals.hours)} ·
            ${formatMoneyRub(trip.totals.priceRub)}
          </div>
        </div>
        <span class="saved-trip-date">${new Date(trip.createdAt).toLocaleDateString("ru-RU")}</span>
      </article>
    `).join("");

    modalContent.innerHTML = `
      <div class="saved-trips-list">
        ${tripsMarkup}
      </div>
    `;
  } else {
    modalContent.innerHTML = `
      <div class="modal-empty">
        <div>
          <strong>${view === "favorites" ? "Здесь появятся ваши места" : "Здесь появятся сохранённые путешествия"}</strong>
          <div>
            ${view === "favorites"
              ? "Добавление избранных городов подключим отдельным этапом."
              : "Закончите путешествие и сохраните его — оно появится здесь."}
          </div>
        </div>
      </div>
    `;
  }

  openModal();

  document.querySelectorAll("[data-saved-trip-id]").forEach((card) => {
    const trip = state.savedTrips.find((item) => item.id === card.dataset.savedTripId);
    if (!trip) return;

    const openSavedTrip = () => openTripSummaryModal(false, trip);
    card.addEventListener("click", openSavedTrip);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openSavedTrip();
      }
    });
  });
}

function setModalBackButton(visible, handler) {
  if (!modalBack) return;

  modalBack.classList.toggle("hidden", !visible);
  modalBack.onclick = visible && typeof handler === "function" ? handler : null;
}

function openModal() {
  setModalBackButton(false);
  modalBackdrop.classList.remove("hidden");
  state.activeModal = true;
}

function closeModal() {
  setModalBackButton(false);
  state.routeDetailsReturn = null;
  modalBackdrop.classList.add("hidden");
  state.activeModal = false;

  navButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === "map");
  });
  surpriseButton?.classList.remove("active");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");

  window.clearTimeout(showToast.timeoutId);
  showToast.timeoutId = window.setTimeout(() => {
    toast.classList.remove("visible");
  }, 2200);
}

const cityExplorerController = createCityExplorer({
  onToast: (message) => showToast(message)
});

// Smoothly bring a searched city to the front of the globe at a comfortable mid zoom.
let cityFocusFrame = 0;
function focusCityOnGlobe(city) {
  if (!city) return;

  if (cityFocusFrame) cancelAnimationFrame(cityFocusFrame);

  const startQuaternion = globeGroup.quaternion.clone();
  const localDirection = cityToVector3(city, 1).normalize();
  const worldDirection = localDirection.clone().applyQuaternion(startQuaternion).normalize();
  const facingDirection = new THREE.Vector3(0, 0, 1);
  const alignment = new THREE.Quaternion().setFromUnitVectors(worldDirection, facingDirection);
  const targetQuaternion = alignment.multiply(startQuaternion.clone()).normalize();

  const startZoom = camera.position.z;
  const targetZoom = 4.85;
  const startedAt = performance.now();
  const duration = 680;

  state.globeVelocityY = 0;
  state.globeVelocityX = 0;
  clearTimeout(state.qualityRestoreTimer);
  setPerformanceMode(true);

  const animateFocus = (now) => {
    const progress = THREE.MathUtils.clamp((now - startedAt) / duration, 0, 1);
    const eased = 1 - Math.pow(1 - progress, 3);

    globeGroup.quaternion.slerpQuaternions(startQuaternion, targetQuaternion, eased);
    camera.position.z = startZoom + (targetZoom - startZoom) * eased;
    state.labelsDirty = true;
    state.sceneDirty = true;

    if (progress < 1) {
      cityFocusFrame = requestAnimationFrame(animateFocus);
    } else {
      cityFocusFrame = 0;
      clearTimeout(state.qualityRestoreTimer);
      state.qualityRestoreTimer = setTimeout(() => setPerformanceMode(false), 180);
    }
  };

  cityFocusFrame = requestAnimationFrame(animateFocus);
}

// Mobile-only search focus. Animate Euler yaw/pitch (with roll fixed to zero)
// rather than a free quaternion, so finding a city cannot turn the globe upside down
// or invert the horizontal swipe direction afterward.
function focusCityOnGlobeMobile(city) {
  if (!city) return;

  if (cityFocusFrame) cancelAnimationFrame(cityFocusFrame);

  const localDirection = cityToVector3(city, 1).normalize();
  const latitudeAngle = Math.atan2(
    localDirection.y,
    Math.hypot(localDirection.x, localDirection.z)
  );
  // Match the camera's slightly-above-equator center line.
  const viewCenterY = THREE.MathUtils.clamp(camera.position.y / GLOBE_RADIUS, -0.95, 0.95);
  const centerAngle = Math.atan2(viewCenterY, Math.sqrt(1 - viewCenterY * viewCenterY));

  // With rotation order XYZ and roll fixed to zero, this yaw puts the city's
  // longitude on the front-facing meridian; pitch then brings it toward center.
  const baseTargetYaw = Math.atan2(-localDirection.x, localDirection.z);
  const startRotationX = THREE.MathUtils.clamp(globeGroup.rotation.x, MIN_PITCH, MAX_PITCH);
  const startRotationY = globeGroup.rotation.y;
  const startRotationZ = globeGroup.rotation.z;
  const targetRotationX = THREE.MathUtils.clamp(
    latitudeAngle - centerAngle,
    MIN_PITCH,
    MAX_PITCH
  );
  // Choose the equivalent yaw nearest the current orientation to avoid a long spin.
  const targetRotationY = startRotationY + Math.atan2(
    Math.sin(baseTargetYaw - startRotationY),
    Math.cos(baseTargetYaw - startRotationY)
  );

  const startZoom = camera.position.z;
  const targetZoom = 4.85;
  const startedAt = performance.now();
  const duration = 760;

  // Start from a valid, unflipped pitch and smoothly remove any residual roll.
  globeGroup.rotation.x = startRotationX;
  state.isFocusingCity = true;
  state.globeVelocityY = 0;
  state.globeVelocityX = 0;
  clearTimeout(state.qualityRestoreTimer);
  setPerformanceMode(true);

  const animateFocus = (now) => {
    const progress = THREE.MathUtils.clamp((now - startedAt) / duration, 0, 1);
    const eased = 1 - Math.pow(1 - progress, 3);

    globeGroup.rotation.x = startRotationX + (targetRotationX - startRotationX) * eased;
    globeGroup.rotation.y = startRotationY + (targetRotationY - startRotationY) * eased;
    globeGroup.rotation.z = startRotationZ * (1 - eased);
    camera.position.z = startZoom + (targetZoom - startZoom) * eased;
    state.labelsDirty = true;
    state.sceneDirty = true;

    if (progress < 1) {
      cityFocusFrame = requestAnimationFrame(animateFocus);
    } else {
      globeGroup.rotation.x = targetRotationX;
      globeGroup.rotation.y = targetRotationY;
      globeGroup.rotation.z = 0;
      state.isFocusingCity = false;
      state.globeVelocityY = 0;
      state.globeVelocityX = 0;
      state.labelsDirty = true;
      state.sceneDirty = true;
      cityFocusFrame = 0;
      clearTimeout(state.qualityRestoreTimer);
      state.qualityRestoreTimer = setTimeout(() => setPerformanceMode(false), 180);
    }
  };

  cityFocusFrame = requestAnimationFrame(animateFocus);
}

function showSearchResults(query) {
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    searchResults.classList.add("hidden");
    searchResults.innerHTML = "";
    return;
  }

  const matches = CITY_SEARCH_INDEX
    .map((item) => {
      const fields = [item.name, item.country, item.id];
      let score = 999;

      for (const value of fields) {
        const index = value.indexOf(normalized);
        if (index === -1) continue;
        const prefixBonus = index === 0 ? -12 : 0;
        score = Math.min(score, index + prefixBonus);
      }

      return { city: item.city, score };
    })
    .filter((item) => item.score < 999)
    .sort((a, b) => a.score - b.score || a.city.name.localeCompare(b.city.name, "ru"))
    .slice(0, 10)
    .map((item) => item.city);

  if (!matches.length) {
    searchResults.innerHTML = `
      <div style="padding: 13px; color: #7d8792; font-size: 11px;">
        Ничего не найдено
      </div>
    `;
    searchResults.classList.remove("hidden");
    return;
  }

  searchResults.innerHTML = matches.map((city) => `
    <button class="search-result" type="button" data-city-id="${city.id}">
      <span class="search-result-main">
        <span class="search-result-name">${city.name}</span>
        <span class="search-result-country">${city.country}</span>
      </span>
      <span class="search-result-flag">${city.flag}</span>
    </button>
  `).join("");

  searchResults.querySelectorAll(".search-result").forEach((button) => {
    button.addEventListener("click", () => {
      const city = findCity(button.dataset.cityId);
      if (!city) return;

      // Use the stable Euler-based focus animation on every screen size. The old
      // desktop quaternion path could rotate the globe around an unexpected axis.
      focusCityOnGlobeMobile(city);
      showCityCard(city);

      searchInput.value = "";
      searchResults.classList.add("hidden");
    });
  });

  searchResults.classList.remove("hidden");
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const activeTouchPointers = new Map();
let pinchZoomStart = null;

function getActiveTouchDistance() {
  const points = [...activeTouchPointers.values()].slice(0, 2);
  if (points.length < 2) return 0;
  return Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
}

function isOverUiElement(target) {
  return Boolean(target?.closest?.(".topbar, .bottom-panel, .city-card, .transport-panel, .modal-backdrop, .search-results, .city-explorer"));
}

function handlePointerMove(event) {
  state.pointerX = event.clientX;
  state.pointerY = event.clientY;

  if (event.pointerType === "touch" && activeTouchPointers.has(event.pointerId)) {
    activeTouchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pinchZoomStart && activeTouchPointers.size >= 2) {
      const currentDistance = getActiveTouchDistance();
      if (currentDistance > 0 && pinchZoomStart.distance > 0) {
        const zoomedZ = pinchZoomStart.cameraZ * (pinchZoomStart.distance / currentDistance);
        camera.position.z = THREE.MathUtils.clamp(zoomedZ, 3.25, getMaxZoomOut());
        state.labelsDirty = true;
        state.sceneDirty = true;
        if (!cityCard.classList.contains("hidden")) hideCityCard();
      }
      return;
    }
  }

  const target = document.elementFromPoint(event.clientX, event.clientY);
  state.pointerOverUI = isOverUiElement(target);

  if (state.isDragging) {
    const dx = event.clientX - state.lastPointerX;
    const dy = event.clientY - (state.lastPointerY ?? event.clientY);

    if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
      state.dragMoved = true;

      if (isMobileUiActive() && event.pointerType === "touch") {
        // Apply the angle change directly from the distance travelled. The old
        // touch path treated pixels-per-event as angular velocity and multiplied
        // by frame delta again, making rotation too slow and frame-rate dependent.
        const now = performance.now();
        const elapsed = Math.max((now - (state.lastPointerTime || (now - 16))) / 1000, 1 / 240);
        const zoomSensitivity = getMobileSwipeZoomSensitivity();
        const yawDelta = dx * MOBILE_TOUCH_RADIANS_PER_PIXEL * zoomSensitivity;
        const pitchDelta = dy * MOBILE_TOUCH_PITCH_RADIANS_PER_PIXEL * zoomSensitivity;
        const previousPitch = globeGroup.rotation.x;
        globeGroup.rotation.y += yawDelta;
        globeGroup.rotation.x = THREE.MathUtils.clamp(
          previousPitch + pitchDelta,
          MIN_PITCH,
          MAX_PITCH
        );
        const actualPitchDelta = globeGroup.rotation.x - previousPitch;

        // Keep a capped release velocity for a small, predictable glide.
        const instantYawVelocity = THREE.MathUtils.clamp(
          yawDelta / elapsed,
          -MOBILE_TOUCH_MAX_YAW_SPEED,
          MOBILE_TOUCH_MAX_YAW_SPEED
        );
        const instantPitchVelocity = THREE.MathUtils.clamp(
          actualPitchDelta / elapsed,
          -MOBILE_TOUCH_MAX_PITCH_SPEED,
          MOBILE_TOUCH_MAX_PITCH_SPEED
        );
        state.mobileSwipeVelocityY = instantYawVelocity;
        state.mobileSwipeVelocityX = instantPitchVelocity;
        state.globeVelocityY = 0;
        state.globeVelocityX = 0;
        state.sceneDirty = true;
        state.labelsDirty = true;
        state.lastPointerTime = now;
      } else {
        // Preserve the existing desktop mouse/touch interaction exactly.
        state.globeVelocityY = dx * dragSensitivity * 6;
        state.globeVelocityX = dy * dragPitchSensitivity * 6;
      }

      if (!cityCard.classList.contains("hidden")) {
        hideCityCard();
      }
    }

    state.lastPointerX = event.clientX;
    state.lastPointerY = event.clientY;
    if (!(isMobileUiActive() && event.pointerType === "touch")) {
      state.lastPointerTime = performance.now();
    }
    state.labelsDirty = true;
  }

  const leftEdge = event.clientX < window.innerWidth * 0.14;
  const rightEdge = event.clientX > window.innerWidth * 0.86;
  const canAutoRotate = !isMobileUiActive() && !state.pointerOverUI && !state.activeModal && !state.isDragging;

  edgeHintLeft.classList.toggle("active", canAutoRotate && leftEdge);
  edgeHintRight.classList.toggle("active", canAutoRotate && rightEdge);

  canvas.style.cursor = state.isDragging ? "grabbing" : "grab";
}

function handleCanvasPointerDown(event) {
  if (state.activeModal) return;

  // A deliberate new touch drag may interrupt the mobile search animation.
  if (isMobileUiActive() && state.isFocusingCity) {
    if (cityFocusFrame) cancelAnimationFrame(cityFocusFrame);
    cityFocusFrame = 0;
    state.isFocusingCity = false;
    state.globeVelocityY = 0;
    state.globeVelocityX = 0;
    globeGroup.rotation.z = 0;
  }

  if (event.pointerType === "touch") {
    activeTouchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activeTouchPointers.size >= 2) {
      if (activeTouchPointers.size === 2) {
        pinchZoomStart = {
          distance: Math.max(1, getActiveTouchDistance()),
          cameraZ: camera.position.z
        };
      }
      state.isDragging = false;
      state.dragMoved = true;
      state.globeVelocityY = 0;
      state.globeVelocityX = 0;
      if (!cityCard.classList.contains("hidden")) hideCityCard();
      clearTimeout(state.qualityRestoreTimer);
      setPerformanceMode(true);
      canvas.setPointerCapture?.(event.pointerId);
      return;
    }
  }

  // Moving the globe hides only the floating card.
  // The selected city itself remains selected.
  if (!cityCard.classList.contains("hidden")) {
    hideCityCard();
  }

  state.isDragging = true;
  state.dragMoved = false;
  state.lastPointerX = event.clientX;
  setPerformanceMode(true);
  state.lastPointerY = event.clientY;
  state.lastPointerTime = performance.now();
  state.mobileSwipeVelocityY = 0;
  state.mobileSwipeVelocityX = 0;
  state.globeVelocityY = 0;
  state.globeVelocityX = 0;
  canvas.setPointerCapture?.(event.pointerId);
}

function handleCanvasPointerUp(event) {
  if (event.pointerType === "touch") {
    activeTouchPointers.delete(event.pointerId);
    if (pinchZoomStart) {
      if (activeTouchPointers.size < 2) {
        pinchZoomStart = null;
        state.isDragging = false;
        canvas.releasePointerCapture?.(event.pointerId);
        clearTimeout(state.qualityRestoreTimer);
        state.qualityRestoreTimer = setTimeout(() => setPerformanceMode(false), 180);
      }
      return;
    }
  }

  if (!state.isDragging) return;

  if (isMobileUiActive() && event.pointerType === "touch") {
    const idleSinceLastMove = performance.now() - state.lastPointerTime;
    if (state.dragMoved && idleSinceLastMove < 100) {
      state.globeVelocityY = state.mobileSwipeVelocityY * MOBILE_TOUCH_RELEASE_INERTIA;
      state.globeVelocityX = state.mobileSwipeVelocityX * MOBILE_TOUCH_RELEASE_INERTIA;
    } else {
      state.globeVelocityY = 0;
      state.globeVelocityX = 0;
    }
  }

  state.isDragging = false;
  canvas.releasePointerCapture?.(event.pointerId);

  clearTimeout(state.qualityRestoreTimer);
  state.qualityRestoreTimer = setTimeout(() => {
    if (!state.isDragging) setPerformanceMode(false);
  }, 150);

  if (!state.dragMoved) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);
    const intersections = raycaster.intersectObjects(
      cityEntries.map((entry) => entry.marker),
      false
    );

    if (intersections.length) {
      const city = findCity(intersections[0].object.userData.cityId);
      if (city) showCityCard(city);
    }
  }
}

function updateEdgeRotation(delta) {
  // Do not touch Euler rotation while a mobile search-focus quaternion is animating.
  if (isMobileUiActive() && state.isFocusingCity) return;

  const mobileUi = isMobileUiActive();
  // Direct mobile touch dragging already applies the globe rotation per pixel;
  // do not integrate inertia again until the finger is released.
  if (mobileUi && state.isDragging) {
    state.globeVelocityY = 0;
    state.globeVelocityX = 0;
    return;
  }
  const x = state.pointerX / window.innerWidth;
  const left = !mobileUi && state.pointerX < window.innerWidth * 0.14 && !state.pointerOverUI;
  const right = !mobileUi && state.pointerX > window.innerWidth * 0.86 && !state.pointerOverUI;

  let targetVelocityY = 0;

  if (!state.activeModal && !state.isDragging && !mobileUi) {
    if (left) {
      if (!cityCard.classList.contains("hidden")) {
        hideCityCard();
      }
      targetVelocityY = edgeRotationMaxSpeed * Math.max(0.15, (0.14 - x) / 0.14);
    } else if (right) {
      if (!cityCard.classList.contains("hidden")) {
        hideCityCard();
      }
      targetVelocityY = -edgeRotationMaxSpeed * Math.max(0.15, (x - 0.86) / 0.14);
    }
  }

  state.globeVelocityY = THREE.MathUtils.damp(
    state.globeVelocityY,
    targetVelocityY,
    globeDamping,
    delta
  );

  state.globeVelocityX = THREE.MathUtils.damp(
    state.globeVelocityX,
    0,
    globeDamping,
    delta
  );

  const beforeY = globeGroup.rotation.y;
  const beforeX = globeGroup.rotation.x;

  globeGroup.rotation.y += state.globeVelocityY * delta;
  globeGroup.rotation.x += state.globeVelocityX * delta;
  // Keep the globe inside its existing pitch range on desktop, and apply the
  // same no-flip limit to mobile as well. Horizontal rotation remains unrestricted.
  globeGroup.rotation.x = THREE.MathUtils.clamp(
    globeGroup.rotation.x,
    MIN_PITCH,
    MAX_PITCH
  );

  const moving = Math.abs(globeGroup.rotation.y - beforeY) > 0.00001 ||
    Math.abs(globeGroup.rotation.x - beforeX) > 0.00001;

  if (moving) {
    state.sceneDirty = true;
    state.labelsDirty = true;

    if (!state.performanceMode && !state.isDragging) {
      setPerformanceMode(true);
      clearTimeout(state.qualityRestoreTimer);
      state.qualityRestoreTimer = setTimeout(() => {
        if (!state.isDragging && Math.abs(state.globeVelocityY) < 0.002 && Math.abs(state.globeVelocityX) < 0.002) {
          setPerformanceMode(false);
        }
      }, 170);
    }
  }
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  renderer.setPixelRatio(getAdaptivePixelRatio(state.performanceMode));
  renderer.setSize(width, height, false);
  state.labelsDirty = true;
}

document.addEventListener("pointermove", handlePointerMove);
canvas.addEventListener("pointerdown", handleCanvasPointerDown);
canvas.addEventListener("pointerup", handleCanvasPointerUp);
canvas.addEventListener("pointercancel", (event) => {
  activeTouchPointers.delete(event.pointerId);
  pinchZoomStart = null;
  state.isDragging = false;
  state.globeVelocityY = 0;
  state.globeVelocityX = 0;
  clearTimeout(state.qualityRestoreTimer);
  setPerformanceMode(false);
});


canvas.addEventListener("wheel", (event) => {
  if (state.activeModal) return;

  event.preventDefault();

  const zoomDelta = THREE.MathUtils.clamp(event.deltaY * 0.0032, -0.28, 0.28);
  const previousZ = camera.position.z;
  camera.position.z = THREE.MathUtils.clamp(
    camera.position.z + zoomDelta,
    3.25,
    getMaxZoomOut()
  );
  if (camera.position.z !== previousZ) {
    state.labelsDirty = true;
    state.sceneDirty = true;
  }

  if (!cityCard.classList.contains("hidden")) {
    hideCityCard();
  }

  setPerformanceMode(true);
  clearTimeout(state.qualityRestoreTimer);
  state.qualityRestoreTimer = setTimeout(() => setPerformanceMode(false), 170);
}, { passive: false });

window.addEventListener("resize", resize);

searchInput.addEventListener("input", (event) => {
  showSearchResults(event.target.value);
});

document.addEventListener("pointerdown", (event) => {
  if (
    !event.target.closest(".search-wrap") &&
    !event.target.closest("#search-results")
  ) {
    searchResults.classList.add("hidden");
  }

  if (!event.target.closest(".topbar")) {
    setMobileMenuOpen(false);
  }
});

navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setMobileMenuOpen(false);
    const view = button.dataset.view;

    navButtons.forEach((item) => item.classList.toggle("active", item === button));

    if (view === "map") {
      closeModal();
      return;
    }

    openNavigationModal(view);
  });
});

surpriseButton?.addEventListener("click", openSurpriseModal);

document.getElementById("brandButton").addEventListener("click", () => {
  setMobileMenuOpen(false);
  closeModal();

  state.selectedOrigin = null;
  state.selectedDestination = null;
  state.selectedTransport = null;
  state.routePhase = "idle";
  state.currentRoute = null;
  state.routeAnimation = null;
  state.tripSegments = [];
  state.surprisePlan = null;
  clearRouteVisual();
  closeTransportPanel();
  hideCityCard();

  bottomPanelContent.innerHTML = `
    <span class="bottom-panel-icon">📍</span>
    <span>Выберите место отправления</span>
  `;

  updateCityLabelStyles();
  globeGroup.rotation.x = 0;
  globeGroup.rotation.y = THREE.MathUtils.degToRad(-105);
  camera.position.z = 4.95;
  state.labelsDirty = true;
  state.sceneDirty = true;
  showToast("Waymark готов к новому путешествию");
});

modalClose.addEventListener("click", closeModal);

modalBackdrop.addEventListener("click", (event) => {
  if (event.target === modalBackdrop) {
    closeModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (state.activeModal) closeModal();
  setMobileMenuOpen(false);
});

let lastFrame = performance.now();
let clockUpdateAccumulator = 0;

function animate(now) {
  requestAnimationFrame(animate);

  const delta = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;

  updateEdgeRotation(delta);
  if (!isMobileUiActive()) {
    globeGroup.rotation.x = THREE.MathUtils.clamp(
      globeGroup.rotation.x,
      MIN_PITCH,
      MAX_PITCH
    );
  }

  clouds.rotation.y += delta * 0.0018;

  // The 3D globe keeps rendering every frame, but DOM labels are only projected
  // while the scene actually changes. This removes unnecessary layout work.
  const moving = state.isDragging ||
    Math.abs(state.globeVelocityY) > 0.0005 ||
    Math.abs(state.globeVelocityX) > 0.0005;

  if (moving) {
    state.labelAccumulator += delta;

    if (state.labelAccumulator >= (1 / 28) && state.labelsDirty) {
      updateCityLabels();
      state.labelAccumulator = 0;
    }
  } else if (state.labelsDirty) {
    updateCityLabels();
    state.labelAccumulator = 0;
  }


  if (state.routeAnimation && state.currentRoute) {
    const animation = state.routeAnimation;
    const route = state.currentRoute;
    const progress = Math.min(
      (now - animation.startedAt) / animation.duration,
      1
    );

    const eased = 1 - Math.pow(1 - progress, 3);
    const pointIndex = Math.max(
      1,
      Math.min(
        route.points.length,
        Math.floor(eased * route.points.length)
      )
    );

    const tubeIndexCount = Math.max(
      0,
      (pointIndex - 1) * route.tubeRadialSegments * 6
    );
    route.routeTube.geometry.setDrawRange(0, tubeIndexCount);

    const markerIndex = Math.min(
      route.points.length - 1,
      Math.floor(eased * (route.points.length - 1))
    );
    route.movingMarker.position.copy(route.points[markerIndex]);

    if (progress >= 1) {
      finishRouteAnimation();
    }
  }

  clockUpdateAccumulator += delta;
  if (clockUpdateAccumulator > 10) {
    updateCityClock();
    clockUpdateAccumulator = 0;
  }

  // Adaptive render loop:
  // - full frame rate while the scene is moving or a route is animating;
  // - a light 30 FPS refresh while idle, enough to preserve the subtle cloud motion;
  // - no redundant DOM projection work unless labels are actually dirty.
  const activelyChanging = moving || Boolean(state.routeAnimation);
  const nowSinceRender = now - state.lastRenderedAt;
  const idleRefreshReady = nowSinceRender >= 33.3;
  // The full-screen city map owns the screen while open. Pause globe rendering
  // underneath it to save GPU/battery on phones; the next frame renders the globe
  // again after the user returns.
  const cityExplorerOpen = Boolean(cityExplorerController?.isOpen);
  if (!cityExplorerOpen && (state.sceneDirty || activelyChanging || idleRefreshReady)) {
    renderer.render(scene, camera);
    state.lastRenderedAt = now;
    state.sceneDirty = false;

    if (!startupFirstFrameReady) {
      startupFirstFrameReady = true;
      finishStartupLoaderIfReady();
    }
  }
}

resize();
updateCityLabels();
requestAnimationFrame(animate);
