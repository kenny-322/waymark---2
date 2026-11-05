/* WAY●MARK city explorer, v1.49.
 * Trip-first city exploration: a map with a compact search, a growing route
 * panel and two sections — "О городе" and "Мои маршруты".
 * Place cards use structured map fields only: no house numbers, no postcodes,
 * no coordinate tails and no invented descriptions.
 */

import {
  cleanPlaceDescription,
  composeAddress,
  descriptionFromProperties,
  featureDisplayName,
  formatNominatimAddress,
  isClickableMapFeature
} from "./place-info.js";

const MAPLIBRE_VERSION = "6.14.0";
const MAPLIBRE_MODULE_URL = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.mjs`;
const MAPLIBRE_CSS_URL = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`;
const VECTOR_STYLE_URL = "https://tiles.openfreemap.org/styles/bright";
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];
const MAX_DISPLAYED_PLACES = 240;
const DEFAULT_RADIUS_METERS = 7000;
const CITY_OVERVIEW_RADIUS_METERS = 25000;
const BUILDING_EXTRUSION_LAYER_ID = "waymark-3d-buildings";
const CITY_ROUTES_STORAGE_KEY = "waymarkCityRoutes";
const MAX_SAVED_ROUTES = 30;

const CATEGORY_META = {
  attraction: { label: "Достопримечательность", icon: "🏛️" },
  museum: { label: "Музей", icon: "🎨" },
  viewpoint: { label: "Смотровая площадка", icon: "🔭" },
  restaurant: { label: "Ресторан", icon: "🍽️" },
  cafe: { label: "Кафе", icon: "☕" },
  park: { label: "Парк", icon: "🌳" },
  hotel: { label: "Отель", icon: "🏨" },
  transport: { label: "Транспорт", icon: "🚇" },
  shop: { label: "Магазин", icon: "🛍️" },
  office: { label: "Офис", icon: "🏢" },
  government: { label: "Госучреждение", icon: "🏛️" },
  service: { label: "Услуги", icon: "🧾" },
  other: { label: "Место", icon: "📍" }
};

// Route themes only use "interesting" categories: parks, museums, viewpoints and
// attractions. Shops, pick-up points, hospitals and offices are never routed.
const ROUTE_THEMES = [
  { id: "history", title: "История", icon: "🏛️", caption: "Старый город и памятники", categories: ["attraction"] },
  { id: "museums", title: "Музеи", icon: "🎨", caption: "Коллекции и галереи", categories: ["museum"] },
  { id: "parks", title: "Парки", icon: "🌳", caption: "Зелень и прогулки", categories: ["park"] },
  { id: "views", title: "Панорамы", icon: "🔭", caption: "Смотровые площадки", categories: ["viewpoint"] },
  { id: "top", title: "Главное", icon: "★", caption: "Самое заметное в городе", categories: ["attraction", "museum", "park", "viewpoint"] },
  { id: "nearby", title: "Рядом", icon: "📍", caption: "Ближе к центру", categories: ["attraction", "museum", "park", "viewpoint"] }
];

const ROUTABLE_CATEGORIES = new Set(["attraction", "museum", "park", "viewpoint"]);

let maplibrePromise = null;
let maplibreCssRequested = false;

function ensureMapLibreCss() {
  if (maplibreCssRequested || document.querySelector(`link[href="${MAPLIBRE_CSS_URL}"]`)) return;
  maplibreCssRequested = true;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = MAPLIBRE_CSS_URL;
  link.crossOrigin = "anonymous";
  document.head.appendChild(link);
}

function loadMapLibre() {
  if (!maplibrePromise) {
    ensureMapLibreCss();
    maplibrePromise = import(MAPLIBRE_MODULE_URL).catch((error) => {
      maplibrePromise = null;
      throw error;
    });
  }
  return maplibrePromise;
}

function elementById(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`WAY●MARK: missing city explorer element #${id}`);
  return node;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]
  ));
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

function categoryFromTags(tags = {}) {
  if (["hotel", "hostel", "guest_house", "motel"].includes(tags.tourism)) return "hotel";
  if (["restaurant", "fast_food", "food_court", "canteen"].includes(tags.amenity)) return "restaurant";
  if (["cafe", "ice_cream"].includes(tags.amenity)) return "cafe";
  if (["park", "garden", "nature_reserve", "recreation_ground"].includes(tags.leisure)) return "park";
  if (tags.landuse === "recreation_ground") return "park";
  if (["museum", "gallery"].includes(tags.tourism)) return "museum";
  if (tags.tourism === "viewpoint") return "viewpoint";
  if (["attraction", "artwork", "zoo", "aquarium", "theme_park"].includes(tags.tourism)) return "attraction";
  if (tags.historic) return "attraction";
  if (["theatre", "arts_centre", "planetarium", "place_of_worship"].includes(tags.amenity)) return "attraction";
  if (tags.public_transport || tags.railway === "station" || tags.railway === "subway_entrance" || tags.amenity === "bus_station") return "transport";
  if (tags.shop) return "shop";
  if (tags.office === "government" || tags.amenity === "townhall") return "government";
  if (tags.office) return "office";
  if (["police", "courthouse", "embassy", "post_office", "military", "fire_station"].includes(tags.amenity)) return "government";
  if (["bank", "atm", "pharmacy", "hospital", "clinic", "doctors", "dentist", "school", "kindergarten", "university", "college", "library", "fuel", "parking", "marketplace", "veterinary", "recycling"].includes(tags.amenity)) return "service";
  return "other";
}

function coordinatesForElement(element) {
  if (Number.isFinite(element.lat) && Number.isFinite(element.lon)) {
    return { lat: element.lat, lon: element.lon };
  }
  if (Number.isFinite(element.center?.lat) && Number.isFinite(element.center?.lon)) {
    return { lat: element.center.lat, lon: element.center.lon };
  }
  return null;
}

function normalizeOverpassPlaces(payload) {
  const elements = Array.isArray(payload?.elements) ? payload.elements : [];
  const places = [];
  const seen = new Set();

  for (const element of elements) {
    const tags = element.tags || {};
    const name = String(tags["name:ru"] || tags.name || tags["name:en"] || "").trim();
    const coordinates = coordinatesForElement(element);
    if (!name || !coordinates) continue;

    const category = categoryFromTags(tags);
    if (category === "other") continue;
    const key = `${name.toLocaleLowerCase("ru-RU")}|${coordinates.lat.toFixed(4)}|${coordinates.lon.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    places.push({
      id: `osm-${element.type}-${element.id}`,
      name,
      category,
      lat: coordinates.lat,
      lon: coordinates.lon,
      description: String(tags["description:ru"] || tags.description || tags["description:en"] || "").trim(),
      address: [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(", "),
      website: tags.website || tags["contact:website"] || "",
      sourceName: "OpenStreetMap",
      tags
    });
  }
  return places;
}

function distanceApproxMeters(a, b) {
  const latitudeMean = (a.lat + b.lat) * 0.5 * Math.PI / 180;
  const dx = (a.lon - b.lon) * Math.cos(latitudeMean) * 111320;
  const dy = (a.lat - b.lat) * 110540;
  return Math.hypot(dx, dy);
}

function choosePlacesForMap(places) {
  const quotas = { attraction: 60, museum: 26, viewpoint: 12, park: 26, restaurant: 16, cafe: 12, hotel: 8, transport: 8, shop: 36, service: 18, government: 10, office: 14 };
  const selected = [];
  const selectedIds = new Set();
  const byCategory = new Map();
  for (const place of places) {
    if (!byCategory.has(place.category)) byCategory.set(place.category, []);
    byCategory.get(place.category).push(place);
  }
  for (const [category, limit] of Object.entries(quotas)) {
    const candidates = (byCategory.get(category) || []).slice().sort((a, b) => a.distanceMeters - b.distanceMeters);
    for (const place of candidates.slice(0, limit)) {
      if (selected.length >= MAX_DISPLAYED_PLACES) break;
      if (selectedIds.has(place.id)) continue;
      selectedIds.add(place.id);
      selected.push(place);
    }
  }
  if (selected.length < MAX_DISPLAYED_PLACES) {
    const remaining = places.slice().sort((a, b) => a.distanceMeters - b.distanceMeters);
    for (const place of remaining) {
      if (selected.length >= MAX_DISPLAYED_PLACES) break;
      if (selectedIds.has(place.id)) continue;
      selectedIds.add(place.id);
      selected.push(place);
    }
  }
  return selected;
}


export function createCityExplorer({ onToast = () => {}, findCity = () => null } = {}) {
  const root = elementById("city-explorer");
  const mapElement = elementById("city-explorer-map");
  const titleElement = elementById("city-explorer-title");
  const subtitleElement = elementById("city-explorer-subtitle");
  const statusElement = elementById("city-explorer-data-status");
  const fallbackElement = elementById("city-explorer-fallback");

  const searchPanel = root.querySelector(".city-explorer-search");
  const searchInput = elementById("city-place-search");
  const searchResults = elementById("city-search-results");

  const routePanel = elementById("city-explorer-route");
  const routeStopsElement = elementById("city-explorer-route-stops");
  const routeEmptyElement = elementById("city-explorer-route-empty");
  const routeSaveButton = elementById("city-route-save");
  const routeResetButton = elementById("city-route-reset");
  const routeReturnButton = elementById("city-route-return");

  const placeDetailsPanel = elementById("city-place-details");
  const placeDetailsTitle = elementById("city-place-details-title");
  const placeDetailsCategory = elementById("city-place-details-category");
  const placeDetailsDescription = elementById("city-place-details-description");
  const placeDetailsMeta = elementById("city-place-details-meta");
  const placeDetailsInfo = elementById("city-place-details-info");
  const placeDetailsInfoRows = elementById("city-place-details-info-rows");
  const placeDetailsAddButton = elementById("city-place-details-add");
  const placeDetailsCloseButton = elementById("city-place-details-close");

  const aboutButton = elementById("city-about-button");
  const aboutModal = elementById("city-about-modal");
  const aboutTitle = elementById("city-about-title");
  const aboutContent = elementById("city-about-content");
  const aboutClose = elementById("city-about-close");

  const routesButton = elementById("city-routes-button");
  const routesModal = elementById("city-routes-modal");
  const routesContent = elementById("city-routes-content");
  const routesClose = elementById("city-routes-close");

  let map = null;
  let mapLibrary = null;
  let mapReady = false;
  let mapInitializationPromise = null;
  let activeCity = null;
  let requestSequence = 0;
  let places = [];
  let markers = [];
  let routeStops = [];
  let currentPlace = null;
  let isOpen = false;
  let mapViewMode = "2d";
  let selectedPlaceRequestId = 0;
  let lastReverseGeocodeAt = 0;
  let maxRouteStops = 8;
  let selectedThemeId = null;
  const reverseGeocodeCache = new Map();
  let reverseGeocodeQueue = Promise.resolve();

  function setStatus(message) {
    statusElement.textContent = message;
  }

  function setFallbackMessage(message) {
    fallbackElement.textContent = message;
    fallbackElement.classList.add("hidden");
  }

  function emptyFeatureCollection() {
    return { type: "FeatureCollection", features: [] };
  }

  /* ---------------------------------------------------------------- route */

  function routeGeoJSON() {
    if (routeStops.length < 2) return emptyFeatureCollection();
    return {
      type: "Feature",
      properties: { routeType: "city-walk" },
      geometry: {
        type: "LineString",
        coordinates: routeStops.map((place) => [place.lon, place.lat])
      }
    };
  }

  function refreshRouteLine() {
    if (!mapReady || !map) return;
    const source = map.getSource("waymark-city-route");
    if (source) source.setData(routeGeoJSON());
  }

  function isInRoute(place) {
    return Boolean(place?.id) && routeStops.some((item) => item.id === place.id);
  }

  function layoutRoutePanel() {
    if (!isOpen) return;
    const isMobile = document.documentElement.dataset.device === "mobile";
    if (isMobile) {
      // Mobile keeps its own bottom-sheet height and a short stop list.
      const limited = Math.min(window.innerHeight * 0.36, 310);
      routePanel.style.maxHeight = `${limited}px`;
      maxRouteStops = Math.max(2, Math.min(6, Math.floor((limited - 110) / 40)));
      return;
    }
    // Desktop: the route panel sits under the search panel and grows downwards.
    const searchRect = searchPanel.getBoundingClientRect();
    const top = Math.max(120, searchRect.bottom + 12);
    routePanel.style.top = `${top}px`;
    routePanel.style.bottom = "auto";
    const available = Math.max(150, window.innerHeight - top - 16);
    const limited = Math.min(available, 520);
    routePanel.style.maxHeight = `${limited}px`;
    // The stop limit is derived from the panel height, so the list can never
    // grow past the bottom of the screen.
    const chrome = 120;
    const rows = Math.floor((limited - chrome) / 50);
    maxRouteStops = Math.max(3, Math.min(rows, 10));
  }

  function renderRouteStops() {
    routeStopsElement.replaceChildren();
    routeEmptyElement.classList.toggle("hidden", routeStops.length > 0);
    // The save button only appears when there is something to save.
    routeSaveButton.classList.toggle("hidden", routeStops.length === 0);

    routeStops.forEach((place, index) => {
      const row = document.createElement("li");
      row.className = "city-explorer-stop";

      const number = document.createElement("span");
      number.className = "city-explorer-stop-number";
      number.textContent = String(index + 1);

      const details = document.createElement("div");
      details.className = "city-explorer-stop-details";

      const name = document.createElement("strong");
      name.className = "city-explorer-stop-name";
      name.textContent = place.name;
      name.title = place.name;

      const category = document.createElement("span");
      category.className = "city-explorer-stop-category";
      category.textContent = categoryLabelRu(place.tags || {}, place.category);
      details.append(name, category);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "city-explorer-stop-remove";
      remove.textContent = "×";
      remove.title = "Убрать из маршрута";
      remove.setAttribute("aria-label", `Убрать ${place.name} из маршрута`);
      remove.addEventListener("click", () => removePlaceFromRoute(place.id));

      row.append(number, details, remove);
      routeStopsElement.appendChild(row);
    });

    refreshRouteLine();
    updateMarkerSelectionClasses();
    updateRouteControls();
    updateCardButtons();
    updateRouteReturnButton();
    layoutRoutePanel();
  }

  function updateRouteControls() {
    // One place is enough to press "Добавить в мои маршруты": the user then gets
    // the "Выберите как минимум два места" hint instead of a silent disabled button.
    routeSaveButton.disabled = routeStops.length === 0;
    // The reset link only exists while there is something to reset.
    routeResetButton.classList.toggle("hidden", routeStops.length === 0);
  }

  function clearRoute() {
    if (!routeStops.length) return;
    routeStops = [];
    renderRouteStops();
    onToast("Маршрут сброшен");
  }

  function removePlaceFromRoute(placeId) {
    routeStops = routeStops.filter((place) => place.id !== placeId);
    renderRouteStops();
    onToast("Место убрано из маршрута");
  }

  function addPlaceToRoute(place, { atStart = false, silent = false } = {}) {
    if (!place?.id) return false;
    if (isInRoute(place)) {
      onToast("Это место уже в маршруте");
      return false;
    }
    if (routeStops.length >= maxRouteStops) {
      onToast(`Максимум мест в маршруте: ${maxRouteStops}. Уберите место, чтобы добавить новое.`);
      return false;
    }
    if (atStart) routeStops.unshift(place);
    else routeStops.push(place);
    renderRouteStops();
    if (!silent) onToast(`${place.name} — в маршруте`);
    return true;
  }


  function fitRoute({ duration = 850 } = {}) {
    if (!mapReady || !map || !routeStops.length) return;
    if (routeStops.length === 1) {
      map.flyTo({
        center: [routeStops[0].lon, routeStops[0].lat],
        zoom: Math.max(map.getZoom(), 15),
        duration,
        essential: true
      });
      return;
    }
    const bounds = routeStops.reduce(
      (box, place) => box.extend([place.lon, place.lat]),
      new mapLibrary.LngLatBounds([routeStops[0].lon, routeStops[0].lat], [routeStops[0].lon, routeStops[0].lat])
    );
    map.fitBounds(bounds, {
      padding: { top: 110, right: 360, bottom: 120, left: 360 },
      maxZoom: 15.5,
      duration,
      essential: true
    });
  }

  function isRouteVisible() {
    if (!mapReady || !map || routeStops.length < 2) return true;
    const viewport = map.getBounds();
    return routeStops.every((place) => viewport.contains([place.lon, place.lat]));
  }

  function updateRouteReturnButton() {
    const show = routeStops.length >= 2 && mapReady && !isRouteVisible();
    routeReturnButton.classList.toggle("hidden", !show);
  }

  function readSavedRoutes() {
    try {
      const raw = localStorage.getItem(CITY_ROUTES_STORAGE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function writeSavedRoutes(list) {
    try {
      localStorage.setItem(CITY_ROUTES_STORAGE_KEY, JSON.stringify(list.slice(-MAX_SAVED_ROUTES)));
    } catch {
      onToast("Не удалось сохранить маршрут в этом браузере.");
    }
  }

  function serializeStops(stops) {
    return stops.map(({ id, name, lat, lon, category }) => ({ id, name, lat, lon, category }));
  }

  function saveCurrentRoute() {
    if (!activeCity) return;
    if (routeStops.length < 2) {
      onToast("Выберите как минимум два места");
      return;
    }
    const saved = {
      id: `city-route-${Date.now()}`,
      cityId: activeCity.id,
      cityName: activeCity.name,
      createdAt: Date.now(),
      stops: serializeStops(routeStops)
    };
    const list = readSavedRoutes();
    list.push(saved);
    writeSavedRoutes(list);
    onToast("Маршрут сохранён в «Мои маршруты»");
    if (!routesModal.classList.contains("hidden")) renderSavedRoutes();
  }

  function renderSavedRoutes() {
    const list = readSavedRoutes();
    if (!list.length) {
      routesContent.innerHTML = `<div class="city-routes-empty">Пока нет сохранённых маршрутов. Соберите места на карте и нажмите «Добавить в мои маршруты».</div>`;
      return;
    }
    routesContent.innerHTML = list.slice().reverse().map((route) => `
      <button type="button" class="city-saved-route" data-route-id="${escapeHtml(route.id)}">
        <span class="city-saved-route-main">
          <strong>${escapeHtml(route.cityName || "Маршрут")}</strong>
          <span>${route.stops?.length || 0} мест · ${new Date(route.createdAt || Date.now()).toLocaleDateString("ru-RU")}</span>
        </span>
        <span class="city-saved-route-arrow" aria-hidden="true">→</span>
      </button>
    `).join("");
    routesContent.querySelectorAll("[data-route-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const route = readSavedRoutes().find((item) => item.id === button.dataset.routeId);
        if (route) openSavedRoute(route);
      });
    });
  }

  async function openSavedRoute(route) {
    const city = findCity(route.cityId);
    if (!city) {
      onToast("Город этого маршрута недоступен.");
      return;
    }
    closeRoutesModal();
    if (activeCity?.id !== city.id) {
      await open(city);
    }
    routeStops = (route.stops || []).filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lon));
    if (routeStops.length < 2) {
      onToast("В сохранённом маршруте недостаточно мест.");
      return;
    }
    renderRouteStops();
    fitRoute({ duration: 800 });
    onToast(`Маршрут «${route.cityName}» открыт на карте`);
  }

  /* -------------------------------------------------------------- markers */

  function updateMarkerSelectionClasses() {
    const selected = new Set(routeStops.map((place) => place.id));
    for (const entry of markers) {
      entry.element.classList.toggle("in-city-route", selected.has(entry.place.id));
    }
  }

  function addMarkersForPlaces() {
    clearMarkers();
    if (!mapLibrary || !mapReady || !map) return;
    for (const place of places) {
      const meta = CATEGORY_META[place.category] || CATEGORY_META.other;
      const element = document.createElement("button");
      element.type = "button";
      element.className = `city-map-place-marker category-${place.category}`;
      element.title = `${place.name} — ${meta.label}`;
      element.setAttribute("aria-label", `${place.name}. ${meta.label}`);
      const icon = document.createElement("span");
      icon.className = "city-map-place-marker-icon";
      icon.textContent = meta.icon;
      element.appendChild(icon);

      const marker = new mapLibrary.Marker({ element, anchor: "bottom" })
        .setLngLat([place.lon, place.lat])
        .addTo(map);
      markers.push({ place, marker, element });

      element.addEventListener("click", (event) => {
        event.stopPropagation();
        showPlaceDetails(place);
      });
    }
    updateMarkerSelectionClasses();
  }

  function clearMarkers() {
    for (const entry of markers) entry.marker.remove();
    markers = [];
  }

  function cityPlacesQuery(city) {
    const lat = Number(city.lat).toFixed(6);
    const lon = Number(city.lon).toFixed(6);
    const radius = DEFAULT_RADIUS_METERS;
    return `[out:json][timeout:20];\n(\n  nwr(around:${radius},${lat},${lon})[tourism~"attraction|museum|viewpoint|gallery|artwork|zoo|aquarium|theme_park"];\n  nwr(around:${radius},${lat},${lon})[historic];\n  nwr(around:${radius},${lat},${lon})[leisure~"park|garden|nature_reserve"];\n  nwr(around:${radius},${lat},${lon})[amenity~"theatre|arts_centre|planetarium|place_of_worship"];\n  nwr(around:${radius},${lat},${lon})[amenity~"restaurant|cafe|fast_food|food_court"];\n  nwr(around:${radius},${lat},${lon})[tourism~"hotel|hostel|guest_house"];\n  nwr(around:${radius},${lat},${lon})[public_transport=station];\n  nwr(around:${radius},${lat},${lon})[railway~"station|subway_entrance"];\n  nwr(around:1500,${lat},${lon})[shop];
  nwr(around:2000,${lat},${lon})[office];
  nwr(around:2000,${lat},${lon})[amenity~"bank|atm|post_office|police|townhall|library|pharmacy|hospital|clinic|school|kindergarten|university|fuel|parking|marketplace|courthouse|embassy|fire_station"];
);\nout center tags 1000 qt;`;
  }

  async function fetchPlacesFromOverpass(city, requestId) {
    const query = cityPlacesQuery(city);
    let lastError = null;
    for (const endpoint of OVERPASS_ENDPOINTS) {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 23000);
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          mode: "cors",
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          body: `data=${encodeURIComponent(query)}`,
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
        const payload = await response.json();
        if (requestId !== requestSequence || activeCity?.id !== city.id) return;
        const center = { lat: city.lat, lon: city.lon };
        const ranked = normalizeOverpassPlaces(payload).map((place) => ({
          ...place,
          distanceMeters: distanceApproxMeters(place, center)
        }));
        places = choosePlacesForMap(ranked);
        if (!places.length) {
          setStatus("Для этого района пока не нашлись подписанные места.");
        } else {
          setStatus(`${places.length} мест на карте · OpenStreetMap`);
        }
        addMarkersForPlaces();
        renderRouteStops();
        refreshAboutModalIfOpen();
        return;
      } catch (error) {
        lastError = error;
      } finally {
        window.clearTimeout(timeout);
      }
    }

    if (requestId !== requestSequence || activeCity?.id !== city.id) return;
    places = [];
    setStatus("Не удалось загрузить места. Попробуйте позже.");
    addMarkersForPlaces();
    renderRouteStops();
    refreshAboutModalIfOpen();
    console.warn("WAY●MARK: place data request failed for city explorer.", lastError);
  }

  /* ----------------------------------------------------------- place card */

  function addressForPlace(place) {
    const tags = place?.tags || {};
    return composeAddress({
      country: activeCity?.country || "",
      region: activeCity?.region || "",
      city: tags["addr:city"] || activeCity?.name || "",
      district: tags["addr:suburb"] || tags["addr:district"] || tags["addr:neighbourhood"] || "",
      street: tags["addr:street"] || tags.street || "",
      fallbackCity: activeCity?.name || "",
      fallbackCountry: activeCity?.country || ""
    });
  }

  function hasStreetLevelData(place) {
    const tags = place?.tags || {};
    return Boolean(
      tags["addr:street"] || tags.street ||
      tags["addr:suburb"] || tags["addr:district"] || tags["addr:neighbourhood"]
    );
  }

  async function reverseGeocodeAddress(place) {
    if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return null;
    const cacheKey = `${place.lat.toFixed(5)},${place.lon.toFixed(5)}`;
    if (reverseGeocodeCache.has(cacheKey)) return reverseGeocodeCache.get(cacheKey);
    // Respect the public Nominatim service's rate limit: serialize requests and
    // keep at least 1.1 seconds between reverse-geocoding calls.
    const task = reverseGeocodeQueue.then(async () => {
      const wait = Math.max(0, 1100 - (Date.now() - lastReverseGeocodeAt));
      if (wait) await new Promise((resolve) => window.setTimeout(resolve, wait));
      lastReverseGeocodeAt = Date.now();
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 5000);
      try {
        const url = new URL("https://nominatim.openstreetmap.org/reverse");
        url.search = new URLSearchParams({ format: "jsonv2", lat: String(place.lat), lon: String(place.lon), zoom: "18", addressdetails: "1", "accept-language": "ru" }).toString();
        const response = await fetch(url.toString(), { signal: controller.signal, headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`Reverse geocoding HTTP ${response.status}`);
        const data = await response.json();
        const address = formatNominatimAddress(data.address || {}, activeCity?.name || "", activeCity?.country || "");
        reverseGeocodeCache.set(cacheKey, address);
        return address;
      } catch (error) {
        return null;
      } finally {
        window.clearTimeout(timeout);
      }
    });
    reverseGeocodeQueue = task.catch(() => null);
    return task;
  }

  function renderPlaceAddress(address) {
    placeDetailsMeta.replaceChildren();
    const hasAddress = Boolean(address?.text) && Boolean(address?.hasDetail);
    placeDetailsMeta.classList.toggle("hidden", !hasAddress);
    if (!hasAddress) return;
    const row = document.createElement("div");
    row.className = "city-place-details-row place-address";
    const label = document.createElement("span");
    label.className = "place-address-label";
    label.textContent = "Адрес";
    const value = document.createElement("strong");
    value.textContent = address.text;
    row.append(label, value);
    placeDetailsMeta.appendChild(row);
  }

  // A curated note from the city catalogue, matched by name, is the only extra
  // "source" available offline. It is shown as short information, never invented.
  function catalogNoteFor(place) {
    const list = Array.isArray(activeCity?.attractions) ? activeCity.attractions : [];
    const name = String(place?.name || "").toLocaleLowerCase("ru-RU").trim();
    if (name.length < 3) return "";
    const match = list.find((item) => {
      const title = String(item?.[0] || "").toLocaleLowerCase("ru-RU").trim();
      return title.length >= 3 && (name === title || name.includes(title) || title.includes(name));
    });
    return cleanPlaceDescription(match?.[1] || "");
  }

  // Short, practical facts only: catalogue note, opening hours, phone, website, price.
  function placeInfoRows(place) {
    const tags = place?.tags || {};
    const rows = [];
    const push = (label, value) => {
      const text = cleanPlaceDescription(value);
      if (text) rows.push({ label, text });
    };
    const note = catalogNoteFor(place);
    if (note) rows.push({ label: "О месте", text: note });
    push("Часы работы", tags.opening_hours);
    push("Телефон", tags.phone || tags["contact:phone"]);
    push("Сайт", tags.website || tags["contact:website"] || place?.website);
    if (/^(yes|no)$/i.test(String(tags.fee || ""))) {
      rows.push({ label: "Вход", text: tags.fee.toLowerCase() === "yes" ? "Платный" : "Бесплатный" });
    } else {
      push("Вход", tags.charge);
    }
    push("Построено", tags.start_date);
    return rows.slice(0, 4);
  }

  function renderPlaceInfo(place) {
    const rows = placeInfoRows(place);
    placeDetailsInfo.classList.toggle("hidden", rows.length === 0);
    placeDetailsInfoRows.replaceChildren();
    for (const row of rows) {
      const line = document.createElement("div");
      line.className = "city-place-info-row";
      const label = document.createElement("span");
      label.textContent = row.label;
      const value = document.createElement("strong");
      if (row.label === "Сайт") {
        const href = /^https?:\/\//i.test(row.text) ? row.text : `https://${row.text}`;
        const link = document.createElement("a");
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = row.text.replace(/^https?:\/\//i, "").replace(/\/$/, "");
        value.appendChild(link);
      } else {
        value.textContent = row.text;
      }
      line.append(label, value);
      placeDetailsInfoRows.appendChild(line);
    }
  }

  function updateCardButtons() {
    const inRoute = isInRoute(currentPlace);
    placeDetailsAddButton.disabled = !currentPlace || inRoute;
    placeDetailsAddButton.textContent = inRoute ? "В маршруте ✓" : "Добавить в маршрут";
  }

  function showPlaceDetails(place, extra = {}) {
    // Desktop iteration: the mobile card layer stays as it was.
    if (!place || document.documentElement.dataset.device !== "desktop") return;
    selectedPlaceRequestId += 1;
    const requestId = selectedPlaceRequestId;
    currentPlace = place;
    placeDetailsTitle.textContent = place.name || "Место на карте";
    placeDetailsCategory.textContent = extra.categoryLabel || CATEGORY_META[place.category]?.label || "Место";
    // Only real descriptive text from map data; nothing is generated to fill the card.
    const description = cleanPlaceDescription(place.description) || cleanPlaceDescription(extra.description);
    placeDetailsDescription.textContent = description;
    placeDetailsDescription.classList.toggle("hidden", !description);
    renderPlaceAddress(addressForPlace(place));
    renderPlaceInfo(place);
    placeDetailsPanel.classList.remove("hidden");
    placeDetailsPanel.classList.add("visible");
    updateCardButtons();

    if (!hasStreetLevelData(place) && Number.isFinite(place.lat) && Number.isFinite(place.lon)) {
      reverseGeocodeAddress(place).then((resolvedAddress) => {
        if (requestId !== selectedPlaceRequestId || placeDetailsPanel.classList.contains("hidden")) return;
        if (resolvedAddress?.hasDetail) renderPlaceAddress(resolvedAddress);
      });
    }
  }

  function hidePlaceDetails() {
    currentPlace = null;
    placeDetailsPanel.classList.add("hidden");
    placeDetailsPanel.classList.remove("visible");
  }

  /* ------------------------------------------------------------- map click */

  function categoryFromVectorProperties(properties = {}, sourceLayer = "") {
    const value = String(properties.class || properties.type || properties.subclass || sourceLayer).toLowerCase();
    if (/restaurant|cafe|food|fast_food/.test(value)) return "restaurant";
    if (/hotel|lodging/.test(value)) return "hotel";
    if (/park|garden|green/.test(value)) return "park";
    if (/museum|gallery/.test(value)) return "museum";
    if (/attraction|historic|tourism|monument/.test(value)) return "attraction";
    if (/station|transport|railway/.test(value)) return "transport";
    return "other";
  }

  function categoryLabelRu(properties = {}, category = "other", isBuilding = false) {
    if (isBuilding) return "Здание";
    const props = properties || {};
    const value = String(props.amenity || props.shop || props.tourism || props.leisure || props.office || props.healthcare || props.craft || props.class || props.type || props.subclass || "").toLowerCase();
    const labels = {
      restaurant: "Ресторан", cafe: "Кафе", fast_food: "Быстрое питание", bar: "Бар", pub: "Паб",
      hotel: "Отель", guest_house: "Гостевой дом", hostel: "Хостел", museum: "Музей", gallery: "Галерея",
      attraction: "Достопримечательность", viewpoint: "Смотровая площадка", monument: "Памятник", memorial: "Мемориал",
      park: "Парк", garden: "Сад", playground: "Детская площадка", sports_centre: "Спортивный центр", fitness_centre: "Фитнес-клуб",
      supermarket: "Супермаркет", convenience: "Магазин у дома", bakery: "Пекарня", pharmacy: "Аптека", clothes: "Магазин одежды",
      shoes: "Обувной магазин", books: "Книжный магазин", department_store: "Универмаг", mall: "Торговый центр",
      parcel_locker: "Постамат", post_office: "Почтовое отделение", marketplace: "Пункт выдачи заказов", bank: "Банк", atm: "Банкомат",
      fuel: "Автозаправка", car_repair: "Автомастерская", doctors: "Медицинский кабинет", clinic: "Клиника", hospital: "Больница",
      dentist: "Стоматология", school: "Школа", kindergarten: "Детский сад", library: "Библиотека", police: "Полиция",
      townhall: "Администрация", bus_stop: "Остановка", bus_station: "Автовокзал", railway_station: "Железнодорожная станция",
      subway_entrance: "Вход в метро", parking: "Парковка", toilets: "Общественный туалет", company: "Офис компании", government: "Государственное учреждение"
    };
    if (labels[value]) return labels[value];
    if (props.shop) return "Магазин";
    if (props.amenity) return "Объект обслуживания";
    if (props.office) return "Офис";
    return CATEGORY_META[category]?.label || "Место";
  }

  function handleVectorFeatureClick(event) {
    if (!map || !mapReady || !event?.point) return;
    // A click starts a new selection. Empty map clicks close the previous place
    // card and intentionally do not create a new one.
    hidePlaceDetails();
    selectedPlaceRequestId += 1;

    const features = map.queryRenderedFeatures(event.point) || [];
    const feature = features.find((item) => {
      const layer = map.getLayer(item.layer?.id);
      const sourceLayer = String(item.sourceLayer || layer?.["source-layer"] || "");
      return isClickableMapFeature(sourceLayer, item.properties || {});
    });
    if (!feature) return;

    const props = feature.properties || {};
    const layer = map.getLayer(feature.layer?.id);
    const sourceLayer = String(feature.sourceLayer || layer?.["source-layer"] || "");
    const isBuilding = sourceLayer === "building";
    const name = featureDisplayName(props);
    if (!name) return;

    const category = isBuilding ? "other" : categoryFromVectorProperties(props, sourceLayer);
    const place = {
      id: `vector-${feature.source || "map"}-${feature.id ?? `${event.lngLat.lng.toFixed(5)}-${event.lngLat.lat.toFixed(5)}`}`,
      name,
      category,
      description: descriptionFromProperties(props),
      address: "",
      tags: props,
      lat: event.lngLat.lat,
      lon: event.lngLat.lng
    };
    showPlaceDetails(place, { categoryLabel: categoryLabelRu(props, category, isBuilding) });
  }

  /* ------------------------------------------------------------ map setup */

  function setViewMode(mode, { animate = true } = {}) {
    if (!map || !mapReady) return;
    mapViewMode = mode === "3d" ? "3d" : "2d";
    const is3d = mapViewMode === "3d";

    const extrusion = map.getLayer(BUILDING_EXTRUSION_LAYER_ID);
    if (extrusion) map.setLayoutProperty(BUILDING_EXTRUSION_LAYER_ID, "visibility", is3d ? "visible" : "none");

    if (map.dragRotate) {
      if (is3d) map.dragRotate.enable();
      else map.dragRotate.disable();
    }
    if (map.touchZoomRotate) {
      if (is3d) map.touchZoomRotate.enableRotation();
      else map.touchZoomRotate.disableRotation();
    }

    document.querySelectorAll("[data-map-view]").forEach((button) => {
      const selected = button.dataset.mapView === mapViewMode;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });

    map.easeTo({
      pitch: is3d ? 52 : 0,
      bearing: is3d ? (map.getBearing() || -18) : 0,
      duration: animate ? 650 : 0,
      essential: true
    });
  }

  function add3DBuildingsLayer() {
    if (!map || map.getLayer(BUILDING_EXTRUSION_LAYER_ID)) return;
    const style = map.getStyle();
    const layers = Array.isArray(style?.layers) ? style.layers : [];
    const buildingLayer = layers.find((layer) =>
      layer.type === "fill" &&
      typeof layer["source-layer"] === "string" &&
      /building/i.test(layer["source-layer"]) &&
      layer.source && map.getSource(layer.source)
    );

    const sourceId = buildingLayer?.source || (map.getSource("openmaptiles") ? "openmaptiles" : null);
    const sourceLayer = buildingLayer?.["source-layer"] || (sourceId ? "building" : null);
    if (!sourceId || !sourceLayer) {
      console.info("WAY●MARK: this basemap style does not expose a building vector layer; 3D buildings are unavailable for this style.");
      return;
    }

    const firstSymbolLayer = layers.find((layer) => layer.type === "symbol");
    const extrusionLayer = {
      id: BUILDING_EXTRUSION_LAYER_ID,
      type: "fill-extrusion",
      source: sourceId,
      "source-layer": sourceLayer,
      minzoom: 12,
      filter: ["all", ["==", ["geometry-type"], "Polygon"]],
      layout: { visibility: "none" },
      paint: {
        "fill-extrusion-color": ["interpolate", ["linear"], ["to-number", ["coalesce", ["get", "render_height"], ["get", "height"], 8], 8], 0, "#d7dce2", 30, "#c4ccd6", 100, "#aebbc9"],
        "fill-extrusion-height": ["max", 3, ["to-number", ["coalesce", ["get", "render_height"], ["get", "height"], 8]]],
        "fill-extrusion-base": ["max", 0, ["to-number", ["coalesce", ["get", "render_min_height"], ["get", "min_height"], 0]]],
        "fill-extrusion-opacity": 0.92,
        "fill-extrusion-vertical-gradient": true
      }
    };
    try {
      map.addLayer(extrusionLayer, firstSymbolLayer?.id);
    } catch (error) {
      console.warn("WAY●MARK: unable to add 3D building layer.", error);
    }
  }

  function updateCityMinimumZoom(city = activeCity) {
    if (!map || !mapReady || !city || !Number.isFinite(city.lat) || !Number.isFinite(city.lon)) return;
    try {
      const latitudeDelta = CITY_OVERVIEW_RADIUS_METERS / 110540;
      const longitudeScale = Math.max(0.15, Math.cos(city.lat * Math.PI / 180));
      const longitudeDelta = CITY_OVERVIEW_RADIUS_METERS / (111320 * longitudeScale);
      const bounds = [
        [city.lon - longitudeDelta, city.lat - latitudeDelta],
        [city.lon + longitudeDelta, city.lat + latitudeDelta]
      ];
      map.setMaxBounds(bounds);
      const camera = map.cameraForBounds(bounds, {
        padding: { top: 90, right: 38, bottom: 70, left: 38 },
        pitch: 0,
        bearing: 0
      });
      if (Number.isFinite(camera?.zoom)) {
        const minZoom = Math.max(3, Math.min(11.5, camera.zoom - 0.25));
        map.setMinZoom(minZoom);
      }
    } catch (error) {
      console.warn("WAY●MARK: could not calculate city overview zoom.", error);
      map.setMinZoom(3);
    }
  }

  function ensureMap() {
    if (mapReady && map) return Promise.resolve(map);
    if (mapInitializationPromise) return mapInitializationPromise;
    mapInitializationPromise = loadMapLibre().then((library) => {
      mapLibrary = library;
      map = new library.Map({
        container: mapElement,
        style: VECTOR_STYLE_URL,
        center: [activeCity?.lon || 0, activeCity?.lat || 0],
        zoom: 12.2,
        minZoom: 3,
        maxZoom: 19,
        attributionControl: true,
        cooperativeGestures: false,
        dragRotate: false,
        pitchWithRotate: false,
        maxPitch: 55,
        pitch: 0
      });
      map.addControl(new library.NavigationControl({ showCompass: false, visualizePitch: false }), "bottom-right");
      map.addControl(new library.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-right");
      map.on("resize", () => {
        if (mapReady && isOpen && activeCity) {
          updateCityMinimumZoom(activeCity);
          layoutRoutePanel();
        }
      });

      map.once("load", () => {
        mapReady = true;
        add3DBuildingsLayer();
        map.addSource("waymark-city-route", { type: "geojson", data: emptyFeatureCollection() });
        map.addLayer({
          id: "waymark-city-route-line",
          type: "line",
          source: "waymark-city-route",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "#4f8cff", "line-width": 4, "line-opacity": 0.86, "line-dasharray": [2, 1.2] }
        });
        if (activeCity) {
          const city = activeCity;
          const requestId = requestSequence;
          updateCityMinimumZoom(city);
          map.flyTo({ center: [city.lon, city.lat], zoom: Math.max(12.2, map.getMinZoom()), pitch: 0, bearing: 0, duration: 650, essential: true });
          fetchPlacesFromOverpass(city, requestId);
        }
        map.resize();
      });
      map.on("error", (event) => {
        if (!mapReady && event?.error) {
          setStatus("Загрузка векторной карты продолжается…");
        }
      });
      map.on("click", handleVectorFeatureClick);
      map.on("moveend", updateRouteReturnButton);
      map.on("mousemove", (event) => {
        if (!mapReady) return;
        const features = map.queryRenderedFeatures(event.point) || [];
        const clickable = features.some((feature) => {
          const layer = map.getLayer(feature.layer?.id);
          const sourceLayer = String(feature.sourceLayer || layer?.["source-layer"] || "");
          return isClickableMapFeature(sourceLayer, feature.properties || {});
        });
        map.getCanvas().style.cursor = clickable ? "pointer" : "";
      });
      window.setTimeout(() => {
        if (isOpen && !mapReady) {
          setStatus("Не удалось загрузить векторную карту.");
          setFallbackMessage("Проверьте подключение к интернету. Для карты улиц используется внешний картографический сервис.");
        }
      }, 18000);
      return map;
    }).catch((error) => {
      mapInitializationPromise = null;
      throw error;
    });
    return mapInitializationPromise;
  }

  /* ----------------------------------------------------------- about modal */

  function routeCandidates(theme) {
    return places
      .filter((place) => ROUTABLE_CATEGORIES.has(place.category) && theme.categories.includes(place.category))
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  }

  function orderByWalk(list, start) {
    const remaining = list.slice();
    const ordered = [];
    let current = { lat: start.lat, lon: start.lon };
    while (remaining.length) {
      remaining.sort((a, b) => distanceApproxMeters(a, current) - distanceApproxMeters(b, current));
      const next = remaining.shift();
      ordered.push(next);
      current = next;
    }
    return ordered;
  }

  function buildThemeRoute(themeId) {
    const theme = ROUTE_THEMES.find((item) => item.id === themeId);
    if (!theme) return;
    const pool = routeCandidates(theme);
    if (!pool.length) {
      onToast("Для этой темы пока нет мест. Выберите другую.");
      return;
    }
    const limit = Math.min(5, maxRouteStops);
    const picks = pool.slice(0, limit);
    routeStops = orderByWalk(picks, activeCity);
    renderRouteStops();
    closeAboutModal();
    fitRoute({ duration: 850 });
    onToast(`Маршрут «${theme.title}» готов: ${routeStops.length} мест`);
  }

  function renderAboutContent() {
    if (!activeCity) return;
    const city = activeCity;
    const stats = [
      ["Погода", `${city.weather?.temp ?? "—"}°C · ${city.weather?.condition || "—"}`],
      ["Лучшее время", city.bestTime],
      ["Кухня", city.cuisine],
      ["Местное время", formatLocalTime(city)]
    ];
    const popular = (Array.isArray(city.attractions) ? city.attractions : []).slice(0, 6);
    const popularMarkup = popular.length
      ? popular.map(([name, note]) => `
          <div class="city-popular-item">
            <strong>${escapeHtml(name)}</strong>
            ${note ? `<span>${escapeHtml(note)}</span>` : ""}
          </div>`).join("")
      : `<div class="city-popular-empty">Список популярных мест пока пуст.</div>`;

    const themeMarkup = ROUTE_THEMES.map((theme) => `
      <button type="button" class="city-theme" data-theme="${theme.id}">
        <span class="city-theme-icon" aria-hidden="true">${theme.icon}</span>
        <span class="city-theme-title">${theme.title}</span>
        <span class="city-theme-caption">${theme.caption}</span>
      </button>`).join("");

    const routableCount = places.filter((place) => ROUTABLE_CATEGORIES.has(place.category)).length;

    aboutContent.innerHTML = `
      <div class="city-about-hero">
        <div class="city-about-lead">
          <div class="city-about-name">${escapeHtml(city.name)} <span class="city-about-flag">${escapeHtml(city.flag || "")}</span></div>
          <p class="city-about-description">${escapeHtml(city.description || "Краткое описание города появится позже.")}</p>
        </div>
        <div class="city-about-stats">
          ${stats.map(([label, value]) => `<div class="city-about-stat"><span>${label}</span><strong>${escapeHtml(value || "—")}</strong></div>`).join("")}
        </div>
      </div>
      <div class="city-about-columns">
        <section class="city-about-popular">
          <h3>Популярные места</h3>
          <div class="city-popular-list">${popularMarkup}</div>
        </section>
        <section class="city-about-routes">
          <h3>Маршрут по интересам</h3>
          <p class="city-about-hint">Выберите тему — соберём маршрут по интересным местам города.</p>
          <div class="city-theme-grid">${themeMarkup}</div>
          <button id="city-theme-build" class="city-theme-build" type="button" disabled>Составить маршрут</button>
          <p class="city-about-note">${routableCount ? `Доступно мест для маршрута: ${routableCount}` : "Места ещё загружаются — кнопка станет активной через несколько секунд."}</p>
        </section>
      </div>
    `;

    selectedThemeId = null;
    aboutContent.querySelectorAll("[data-theme]").forEach((button) => {
      button.addEventListener("click", () => {
        selectedThemeId = button.dataset.theme;
        aboutContent.querySelectorAll("[data-theme]").forEach((other) => {
          other.classList.toggle("active", other === button);
        });
        const buildButton = document.getElementById("city-theme-build");
        if (buildButton) buildButton.disabled = false;
      });
    });
    const buildButton = document.getElementById("city-theme-build");
    if (buildButton) {
      buildButton.addEventListener("click", () => {
        if (selectedThemeId) buildThemeRoute(selectedThemeId);
      });
    }
  }

  function refreshAboutModalIfOpen() {
    if (aboutModal.classList.contains("hidden")) return;
    const hadTheme = selectedThemeId;
    renderAboutContent();
    if (hadTheme) {
      const button = aboutContent.querySelector(`[data-theme="${hadTheme}"]`);
      if (button) {
        selectedThemeId = hadTheme;
        button.classList.add("active");
        const buildButton = document.getElementById("city-theme-build");
        if (buildButton) buildButton.disabled = false;
      }
    }
  }

  function openAboutModal() {
    if (!activeCity) return;
    aboutTitle.textContent = activeCity.name;
    renderAboutContent();
    aboutModal.classList.remove("hidden");
  }

  function closeAboutModal() {
    aboutModal.classList.add("hidden");
  }

  function openRoutesModal() {
    renderSavedRoutes();
    routesModal.classList.remove("hidden");
  }

  function closeRoutesModal() {
    routesModal.classList.add("hidden");
  }

  /* ---------------------------------------------------------------- search */

  function hideSearchResults() {
    searchResults.classList.add("hidden");
    searchResults.replaceChildren();
  }

  let searchTimer = 0;
  let searchSequence = 0;
  let searchLoading = false;

  function searchMatches(query) {
    const normalized = String(query || "").trim().toLocaleLowerCase("ru-RU");
    if (!normalized) return [];
    return places
      .filter((place) => {
        const haystack = [place.name, place.address, CATEGORY_META[place.category]?.label]
          .filter(Boolean).join(" ").toLocaleLowerCase("ru-RU");
        return haystack.includes(normalized);
      })
      .slice(0, 8);
  }

  function renderSearchResults(query, { loading = searchLoading } = {}) {
    const trimmed = String(query || "").trim();
    if (!trimmed) {
      hideSearchResults();
      return;
    }
    const matches = searchMatches(trimmed);

    if (!matches.length && !loading) {
      searchResults.innerHTML = `<div class="city-search-empty">Ничего не найдено. Попробуйте другое название.</div>`;
      searchResults.classList.remove("hidden");
      return;
    }

    searchResults.innerHTML = matches.map((place) => `
      <button type="button" class="city-search-result" data-place-id="${escapeHtml(place.id)}">
        <span class="city-search-result-icon" aria-hidden="true">${CATEGORY_META[place.category]?.icon || "📍"}</span>
        <span class="city-search-result-main">
          <strong>${escapeHtml(place.name)}</strong>
          <span>${escapeHtml(categoryLabelRu(place.tags || {}, place.category))}</span>
        </span>
      </button>
    `).join("") + (loading ? `<div class="city-search-loading">Ищем места в этом городе…</div>` : "");
    searchResults.classList.remove("hidden");

    searchResults.querySelectorAll("[data-place-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const place = places.find((item) => item.id === button.dataset.placeId);
        if (!place) return;
        hideSearchResults();
        showPlaceDetails(place);
        if (mapReady && map) {
          // A comfortable street-level view, slightly below the maximum zoom.
          map.flyTo({ center: [place.lon, place.lat], zoom: 16.5, duration: 800, essential: true });
        }
      });
    });
  }

  // OpenStreetMap name search limited to the selected city: this finds places
  // that are not part of the preloaded map sample.
  async function searchCityOnOverpass(query) {
    const city = activeCity;
    if (!city || !query) return;
    const requestId = ++searchSequence;
    // Quotes and backslashes would break the Overpass regex literal.
    const escaped = query.replace(/["\\\r\n]/g, " ").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const lat = Number(city.lat).toFixed(6);
    const lon = Number(city.lon).toFixed(6);
    const body = `[out:json][timeout:15];\n(\n  nwr(around:7000,${lat},${lon})[name~"${escaped}",i];\n  nwr(around:7000,${lat},${lon})["name:ru"~"${escaped}",i];\n);\nout center tags 30;`;
    searchLoading = true;
    renderSearchResults(query, { loading: true });

    for (const endpoint of OVERPASS_ENDPOINTS) {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          mode: "cors",
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          body: `data=${encodeURIComponent(body)}`,
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
        const payload = await response.json();
        if (requestId !== searchSequence || activeCity?.id !== city.id) return;
        const center = { lat: city.lat, lon: city.lon };
        const found = normalizeOverpassPlaces(payload)
          .map((place) => ({ ...place, distanceMeters: distanceApproxMeters(place, center) }))
          .filter((place) => !places.some((existing) => existing.id === place.id));
        if (found.length && places.length < 600) {
          places = places.concat(found);
          addMarkersForPlaces();
        }
        searchLoading = false;
        renderSearchResults(searchInput.value, { loading: false });
        return;
      } catch (error) {
        // Try the next endpoint; the local results stay usable meanwhile.
      } finally {
        window.clearTimeout(timeout);
      }
    }
    if (requestId !== searchSequence) return;
    searchLoading = false;
    renderSearchResults(searchInput.value, { loading: false });
  }

  function scheduleRemoteSearch(query) {
    window.clearTimeout(searchTimer);
    const trimmed = String(query || "").trim();
    if (trimmed.length < 3) return;
    if (searchMatches(trimmed).length >= 3) return;
    searchTimer = window.setTimeout(() => {
      searchCityOnOverpass(trimmed);
    }, 450);
  }
  /* ------------------------------------------------------------- open/close */

  async function open(city) {
    if (!city || !Number.isFinite(city.lat) || !Number.isFinite(city.lon)) {
      onToast("У этого города нет корректных координат для карты.");
      return;
    }
    activeCity = city;
    hidePlaceDetails();
    hideSearchResults();
    closeAboutModal();
    closeRoutesModal();
    routeStops = [];
    isOpen = true;
    requestSequence += 1;
    places = [];
    selectedThemeId = null;
    searchInput.value = "";
    setFallbackMessage("");

    renderRouteStops();
    titleElement.textContent = city.name;
    subtitleElement.textContent = `${city.country} · Векторная карта`;
    root.classList.remove("hidden");
    document.body.classList.add("city-explorer-open");
    setStatus("Подключаем карту и загружаем места…");
    routeReturnButton.classList.add("hidden");

    try {
      await ensureMap();
      if (!isOpen || activeCity?.id !== city.id) return;
      if (mapReady && map) {
        map.resize();
        updateCityMinimumZoom(city);
        setViewMode("2d", { animate: false });
        map.flyTo({ center: [city.lon, city.lat], zoom: Math.max(12.2, map.getMinZoom()), pitch: 0, bearing: 0, duration: 850, essential: true });
        clearMarkers();
        if (map.getSource("waymark-city-route")) map.getSource("waymark-city-route").setData(emptyFeatureCollection());
        const requestId = requestSequence;
        fetchPlacesFromOverpass(city, requestId);
      }
    } catch (error) {
      console.warn("WAY●MARK: city map could not be initialized.", error);
      setStatus("Не удалось загрузить векторную карту. Проверьте подключение к интернету.");
      setFallbackMessage("Профиль города и его достопримечательности остаются в WAY●MARK, но для карты улиц требуется доступ к картографическому сервису.");
    }

    requestAnimationFrame(layoutRoutePanel);
  }

  function close() {
    hidePlaceDetails();
    hideSearchResults();
    closeAboutModal();
    closeRoutesModal();
    isOpen = false;
    requestSequence += 1;
    // Leaving the city resets the current route; saved routes stay in storage.
    routeStops = [];
    renderRouteStops();
    routeReturnButton.classList.add("hidden");
    if (mapReady && map && map.getSource("waymark-city-route")) {
      map.getSource("waymark-city-route").setData(emptyFeatureCollection());
    }
    root.classList.add("hidden");
    document.body.classList.remove("city-explorer-open");
    if (map) window.setTimeout(() => map.resize(), 100);
  }

  /* --------------------------------------------------------------- wiring */

  document.querySelectorAll("[data-map-view]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!mapReady || !map) return;
      setViewMode(button.dataset.mapView || "2d");
    });
  });

  elementById("city-explorer-back").addEventListener("click", close);

  routeSaveButton.addEventListener("click", saveCurrentRoute);
  routeResetButton.addEventListener("click", clearRoute);
  routeReturnButton.addEventListener("click", () => fitRoute({ duration: 700 }));
  placeDetailsCloseButton.addEventListener("click", hidePlaceDetails);
  placeDetailsAddButton.addEventListener("click", () => {
    if (currentPlace) addPlaceToRoute(currentPlace);
  });

  searchInput.addEventListener("input", (event) => {
    renderSearchResults(event.target.value);
    scheduleRemoteSearch(event.target.value);
  });
  searchInput.addEventListener("focus", () => {
    if (searchInput.value.trim()) renderSearchResults(searchInput.value);
  });

  aboutButton.addEventListener("click", openAboutModal);
  aboutClose.addEventListener("click", closeAboutModal);
  aboutModal.addEventListener("click", (event) => {
    if (event.target === aboutModal) closeAboutModal();
  });

  routesButton.addEventListener("click", openRoutesModal);
  routesClose.addEventListener("click", closeRoutesModal);
  routesModal.addEventListener("click", (event) => {
    if (event.target === routesModal) closeRoutesModal();
  });

  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".city-explorer-search")) hideSearchResults();
  });

  window.addEventListener("resize", () => {
    if (isOpen) layoutRoutePanel();
  });

  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!aboutModal.classList.contains("hidden")) {
      closeAboutModal();
      return;
    }
    if (!routesModal.classList.contains("hidden")) {
      closeRoutesModal();
      return;
    }
    if (!searchResults.classList.contains("hidden")) {
      hideSearchResults();
      return;
    }
    close();
  });

  return { open, close, get isOpen() { return isOpen; } };
}
