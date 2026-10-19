/* WAY●MARK city explorer, v1.32.
 * One generic map workflow for every city in CITY_DATA. Street basemaps are
 * vector tiles; named places are loaded on demand from OpenStreetMap Overpass.
 * This module intentionally keeps city routes as ordered stops for now. A real
 * road/transit router can later consume the same stop coordinates and mode.
 */

const MAPLIBRE_VERSION = "6.14.0";
const MAPLIBRE_MODULE_URL = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.mjs`;
const MAPLIBRE_CSS_URL = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`;
const VECTOR_STYLE_URL = "https://tiles.openfreemap.org/styles/bright";
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];
const MAX_DISPLAYED_PLACES = 150;
const DEFAULT_RADIUS_METERS = 7000;
const CITY_OVERVIEW_RADIUS_METERS = 12000;
const BUILDING_EXTRUSION_LAYER_ID = "waymark-3d-buildings";

const FILTER_DEFINITIONS = {
  all: { label: "Все", categories: null },
  attraction: { label: "Места", categories: new Set(["attraction", "museum", "viewpoint"]) },
  food: { label: "Еда", categories: new Set(["restaurant", "cafe"]) },
  park: { label: "Парки", categories: new Set(["park"]) },
  hotel: { label: "Отели", categories: new Set(["hotel"]) },
  transport: { label: "Транспорт", categories: new Set(["transport"]) }
};

const CATEGORY_META = {
  attraction: { label: "Достопримечательность", icon: "🏛️" },
  museum: { label: "Музей", icon: "🎨" },
  viewpoint: { label: "Смотровая площадка", icon: "🔭" },
  restaurant: { label: "Ресторан", icon: "🍽️" },
  cafe: { label: "Кафе", icon: "☕" },
  park: { label: "Парк", icon: "🌳" },
  hotel: { label: "Отель", icon: "🏨" },
  transport: { label: "Транспорт", icon: "🚇" },
  other: { label: "Место", icon: "📍" }
};

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

function categoryFromTags(tags = {}) {
  if (tags.tourism === "hotel" || tags.tourism === "hostel" || tags.tourism === "guest_house" || tags.tourism === "motel") return "hotel";
  if (tags.amenity === "restaurant" || tags.amenity === "fast_food" || tags.amenity === "food_court") return "restaurant";
  if (tags.amenity === "cafe" || tags.amenity === "ice_cream") return "cafe";
  if (tags.leisure === "park" || tags.leisure === "garden" || tags.landuse === "recreation_ground") return "park";
  if (tags.tourism === "museum" || tags.tourism === "gallery") return "museum";
  if (tags.tourism === "viewpoint") return "viewpoint";
  if (tags.tourism === "attraction" || tags.tourism === "artwork" || tags.historic) return "attraction";
  if (tags.public_transport || tags.railway === "station" || tags.railway === "subway_entrance" || tags.amenity === "bus_station") return "transport";
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
      description: String(tags.description || tags["description:ru"] || "").trim(),
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
  const quotas = { attraction: 42, museum: 20, viewpoint: 10, park: 18, restaurant: 20, cafe: 16, hotel: 10, transport: 8 };
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

function buildFallbackAttractions(city) {
  return (Array.isArray(city.attractions) ? city.attractions : []).map((item, index) => ({
    id: `catalog-${city.id}-${index + 1}`,
    name: String(item?.[0] || "Достопримечательность"),
    category: "attraction",
    description: String(item?.[1] || ""),
    sourceName: "Каталог WAY●MARK",
    coordinatesUnavailable: true
  }));
}

function escapeText(value) {
  return String(value ?? "");
}

export function createCityExplorer({ onToast = () => {} } = {}) {
  const root = elementById("city-explorer");
  const mapElement = elementById("city-explorer-map");
  const titleElement = elementById("city-explorer-title");
  const subtitleElement = elementById("city-explorer-subtitle");
  const statusElement = elementById("city-explorer-data-status");
  const fallbackElement = elementById("city-explorer-fallback");
  const routeStopsElement = elementById("city-explorer-route-stops");
  const routeEmptyElement = elementById("city-explorer-route-empty");
  const routeCountElement = elementById("city-explorer-stop-count");
  const clearRouteButton = elementById("city-explorer-clear-route");

  let map = null;
  let mapLibrary = null;
  let mapReady = false;
  let mapInitializationPromise = null;
  let activeCity = null;
  let requestSequence = 0;
  let currentFilter = "all";
  let places = [];
  let fallbackAttractions = [];
  let markers = [];
  let routeStops = [];
  let activePopup = null;
  let isOpen = false;
  let mapViewMode = "2d";
  let minZoomCityId = null;

  function setStatus(message) {
    statusElement.textContent = message;
  }

  function setFallbackMessage(message, show = true) {
    fallbackElement.textContent = message;
    fallbackElement.classList.toggle("hidden", !show);
  }

  function emptyFeatureCollection() {
    return { type: "FeatureCollection", features: [] };
  }

  function routeGeoJSON() {
    if (routeStops.length < 2) return emptyFeatureCollection();
    return {
      type: "Feature",
      properties: { routeType: "draft-itinerary" },
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

  function renderRouteStops() {
    routeStopsElement.replaceChildren();
    routeCountElement.textContent = String(routeStops.length);
    routeEmptyElement.classList.toggle("hidden", routeStops.length > 0);
    clearRouteButton.disabled = routeStops.length === 0;

    routeStops.forEach((place, index) => {
      const row = document.createElement("li");
      row.className = "city-explorer-stop";

      const number = document.createElement("span");
      number.className = "city-explorer-stop-number";
      number.textContent = String(index + 1);

      const details = document.createElement("div");
      details.className = "city-explorer-stop-details";
      const name = document.createElement("strong");
      name.textContent = place.name;
      const category = document.createElement("span");
      category.textContent = CATEGORY_META[place.category]?.label || "Место";
      details.append(name, category);

      const actions = document.createElement("div");
      actions.className = "city-explorer-stop-actions";
      const up = document.createElement("button");
      up.type = "button";
      up.className = "city-explorer-mini-button";
      up.textContent = "↑";
      up.title = "Переместить выше";
      up.setAttribute("aria-label", `Переместить ${place.name} выше`);
      up.disabled = index === 0;
      up.addEventListener("click", () => moveRouteStop(index, -1));
      const down = document.createElement("button");
      down.type = "button";
      down.className = "city-explorer-mini-button";
      down.textContent = "↓";
      down.title = "Переместить ниже";
      down.setAttribute("aria-label", `Переместить ${place.name} ниже`);
      down.disabled = index === routeStops.length - 1;
      down.addEventListener("click", () => moveRouteStop(index, 1));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "city-explorer-mini-button remove";
      remove.textContent = "×";
      remove.title = "Убрать из маршрута";
      remove.setAttribute("aria-label", `Убрать ${place.name} из маршрута`);
      remove.addEventListener("click", () => removeRouteStop(place.id));
      actions.append(up, down, remove);
      row.append(number, details, actions);
      routeStopsElement.appendChild(row);
    });

    refreshRouteLine();
    updateMarkerSelectionClasses();
  }

  function moveRouteStop(index, delta) {
    const next = index + delta;
    if (next < 0 || next >= routeStops.length) return;
    [routeStops[index], routeStops[next]] = [routeStops[next], routeStops[index]];
    renderRouteStops();
  }

  function removeRouteStop(placeId) {
    routeStops = routeStops.filter((place) => place.id !== placeId);
    renderRouteStops();
  }

  function clearRoute() {
    routeStops = [];
    renderRouteStops();
    if (activePopup) activePopup.remove();
  }

  function addPlaceToRoute(place) {
    if (routeStops.some((item) => item.id === place.id)) {
      onToast(`${place.name} уже в городском маршруте`);
      return;
    }
    routeStops.push(place);
    renderRouteStops();
    onToast(`${place.name} добавлено в городской маршрут`);
    if (activePopup) {
      const action = activePopup.getElement()?.querySelector("[data-add-place]");
      if (action) {
        action.textContent = "Добавлено в маршрут ✓";
        action.disabled = true;
      }
    }
  }

  function updateMarkerSelectionClasses() {
    const selected = new Set(routeStops.map((place) => place.id));
    for (const entry of markers) {
      entry.element.classList.toggle("in-city-route", selected.has(entry.place.id));
      const button = entry.popupElement?.querySelector("[data-add-place]");
      if (button) {
        button.disabled = selected.has(entry.place.id);
        button.textContent = selected.has(entry.place.id) ? "Уже в маршруте ✓" : "Добавить в маршрут";
      }
    }
  }

  function popupForPlace(place) {
    const content = document.createElement("div");
    content.className = "city-place-popup";
    const title = document.createElement("strong");
    title.className = "city-place-popup-title";
    title.textContent = place.name;
    const category = document.createElement("div");
    category.className = "city-place-popup-category";
    category.textContent = CATEGORY_META[place.category]?.label || "Место";
    content.append(title, category);
    if (place.description) {
      const description = document.createElement("p");
      description.className = "city-place-popup-description";
      description.textContent = place.description;
      content.appendChild(description);
    }
    if (place.address) {
      const address = document.createElement("div");
      address.className = "city-place-popup-address";
      address.textContent = place.address;
      content.appendChild(address);
    }
    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "city-place-popup-add";
    addButton.dataset.addPlace = "true";
    addButton.textContent = routeStops.some((item) => item.id === place.id) ? "Уже в маршруте ✓" : "Добавить в маршрут";
    addButton.disabled = routeStops.some((item) => item.id === place.id);
    addButton.addEventListener("click", () => addPlaceToRoute(place));
    content.appendChild(addButton);
    return content;
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
      const markerEntry = { place, marker, element, popupElement: null };
      markers.push(markerEntry);

      element.addEventListener("click", (event) => {
        event.stopPropagation();
        if (activePopup) activePopup.remove();
        const popupContent = popupForPlace(place);
        markerEntry.popupElement = popupContent;
        activePopup = new mapLibrary.Popup({ closeButton: true, closeOnClick: false, offset: 24, maxWidth: "280px" })
          .setLngLat([place.lon, place.lat])
          .setDOMContent(popupContent)
          .addTo(map);
      });
    }
    applyPlaceFilter();
    updateMarkerSelectionClasses();
  }

  function clearMarkers() {
    for (const entry of markers) entry.marker.remove();
    markers = [];
    if (activePopup) activePopup.remove();
    activePopup = null;
  }

  function applyPlaceFilter() {
    const definition = FILTER_DEFINITIONS[currentFilter] || FILTER_DEFINITIONS.all;
    for (const entry of markers) {
      const matches = !definition.categories || definition.categories.has(entry.place.category);
      entry.element.style.display = matches ? "flex" : "none";
    }
    document.querySelectorAll("[data-place-filter]").forEach((button) => {
      const selected = button.dataset.placeFilter === currentFilter;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    const visibleCount = markers.filter((entry) => entry.element.style.display !== "none").length;
    if (places.length) {
      setStatus(`${visibleCount} мест на карте · данные OpenStreetMap`);
    }
  }

  function buildFallbackAttractionList(city) {
    fallbackAttractions = buildFallbackAttractions(city);
    const old = document.getElementById("city-explorer-catalog-fallback");
    if (old) old.remove();
    if (!fallbackAttractions.length) return;

    const section = document.createElement("section");
    section.id = "city-explorer-catalog-fallback";
    section.className = "city-explorer-catalog-fallback";
    const heading = document.createElement("strong");
    heading.textContent = "Достопримечательности из каталога WAY●MARK";
    const hint = document.createElement("p");
    hint.textContent = "Эти места уже описаны в профиле города, но в картографических данных пока не удалось найти их координаты.";
    const list = document.createElement("ul");
    for (const place of fallbackAttractions) {
      const item = document.createElement("li");
      item.textContent = place.description ? `${place.name} — ${place.description}` : place.name;
      list.appendChild(item);
    }
    section.append(heading, hint, list);
    routeStopsElement.parentElement.appendChild(section);
  }

  function cityPlacesQuery(city) {
    const lat = Number(city.lat).toFixed(6);
    const lon = Number(city.lon).toFixed(6);
    const radius = DEFAULT_RADIUS_METERS;
    return `[out:json][timeout:20];\n(\n  nwr(around:${radius},${lat},${lon})[tourism~"attraction|museum|viewpoint|hotel|gallery|artwork"];\n  nwr(around:${radius},${lat},${lon})[historic];\n  nwr(around:${radius},${lat},${lon})[leisure~"park|garden"];\n  nwr(around:${radius},${lat},${lon})[amenity~"restaurant|cafe|fast_food|food_court"];\n  nwr(around:${radius},${lat},${lon})[public_transport=station];\n  nwr(around:${radius},${lat},${lon})[railway~"station|subway_entrance"];\n);\nout center tags 600 qt;`;
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
          setFallbackMessage("Карта открыта. Попробуйте приблизить район или вернуться позже: данные мест предоставляются OpenStreetMap.");
          buildFallbackAttractionList(city);
        } else {
          setFallbackMessage("", false);
          const old = document.getElementById("city-explorer-catalog-fallback");
          if (old) old.remove();
          setStatus(`Найдено ${places.length} мест поблизости · OpenStreetMap`);
        }
        addMarkersForPlaces();
        renderRouteStops();
        return;
      } catch (error) {
        lastError = error;
      } finally {
        window.clearTimeout(timeout);
      }
    }

    if (requestId !== requestSequence || activeCity?.id !== city.id) return;
    places = [];
    setStatus("Не удалось загрузить места — карта может работать отдельно от каталога.");
    setFallbackMessage("Не удалось получить сведения о местах из OpenStreetMap. Проверьте подключение и попробуйте открыть город ещё раз.");
    buildFallbackAttractionList(city);
    addMarkersForPlaces();
    renderRouteStops();
    console.warn("WAY●MARK: place data request failed for city explorer.", lastError);
  }

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

    const camera = {
      pitch: is3d ? 52 : 0,
      bearing: is3d ? (map.getBearing() || -18) : 0,
      duration: animate ? 650 : 0,
      essential: true
    };
    map.easeTo(camera);
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

    // OpenFreeMap's standard vector schema uses the "building" source-layer.
    // Prefer the exact source discovered in the active style; otherwise use
    // the common OpenMapTiles source only when it is actually present.
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
      const camera = map.cameraForBounds(bounds, {
        padding: { top: 90, right: 38, bottom: 70, left: 38 },
        pitch: 0,
        bearing: 0
      });
      if (Number.isFinite(camera?.zoom)) {
        // The city catalog currently stores a center, not official city borders.
        // Use a generous overview window around the center as a safe fallback.
        const minZoom = Math.max(3, Math.min(11.5, camera.zoom - 0.25));
        map.setMinZoom(minZoom);
        minZoomCityId = city.id || `${city.lat},${city.lon}`;
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
        if (mapReady && isOpen && activeCity) updateCityMinimumZoom(activeCity);
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

  async function open(city) {
    if (!city || !Number.isFinite(city.lat) || !Number.isFinite(city.lon)) {
      onToast("У этого города нет корректных координат для карты.");
      return;
    }
    activeCity = city;
    isOpen = true;
    requestSequence += 1;
    currentFilter = "all";
    places = [];
    routeStops = [];
    setFallbackMessage("", false);
    const oldFallback = document.getElementById("city-explorer-catalog-fallback");
    if (oldFallback) oldFallback.remove();
    renderRouteStops();
    titleElement.textContent = city.name;
    subtitleElement.textContent = `${city.country} · Векторная карта`;
    root.classList.remove("hidden");
    document.body.classList.add("city-explorer-open");
    setStatus("Подключаем карту и загружаем места…");

    try {
      await ensureMap();
      if (!isOpen || activeCity?.id !== city.id) return;
      if (mapReady && map) {
        map.resize();
        updateCityMinimumZoom(city);
        mapViewMode = "2d";
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
      buildFallbackAttractionList(city);
    }
  }

  function close() {
    isOpen = false;
    requestSequence += 1;
    root.classList.add("hidden");
    document.body.classList.remove("city-explorer-open");
    if (map) window.setTimeout(() => map.resize(), 100);
  }

  document.querySelectorAll("[data-map-view]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!mapReady || !map) return;
      setViewMode(button.dataset.mapView || "2d");
    });
  });

  document.querySelectorAll("[data-place-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      currentFilter = button.dataset.placeFilter || "all";
      applyPlaceFilter();
    });
  });
  elementById("city-explorer-back").addEventListener("click", close);
  clearRouteButton.addEventListener("click", clearRoute);
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });

  return { open, close, get isOpen() { return isOpen; } };
}
