/* WAY●MARK city explorer, v1.34.
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
const CITY_OVERVIEW_RADIUS_METERS = 25000;
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
  const placeDetailsPanel = elementById("city-place-details");
  const placeDetailsTitle = elementById("city-place-details-title");
  const placeDetailsCategory = elementById("city-place-details-category");
  const placeDetailsDescription = elementById("city-place-details-description");
  const placeDetailsMeta = elementById("city-place-details-meta");
  const placeDetailsRouteButton = elementById("city-place-details-route");
  const placeDetailsCloseButton = elementById("city-place-details-close");

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
  let placeDetailsRequestId = 0;
  const placeEnrichmentCache = new Map();
  let lastReverseGeocodeAt = 0;
  let mapViewMode = "2d";
  let minZoomCityId = null;

  function setStatus(message) {
    statusElement.textContent = message;
  }

  function setFallbackMessage(message, show = true) {
    // Keep the map canvas visually clean; report service problems in the compact
    // status line of the search panel rather than a large floating toast.
    fallbackElement.textContent = message;
    fallbackElement.classList.add("hidden");
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

  function cleanPlaceValue(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function addressFromOsmTags(tags = {}, cityName = "") {
    const street = cleanPlaceValue(tags["addr:street"] || tags.street);
    const house = cleanPlaceValue(tags["addr:housenumber"]);
    const unit = cleanPlaceValue(tags["addr:unit"] || tags["addr:flats"]);
    const district = cleanPlaceValue(tags["addr:suburb"] || tags["addr:district"] || tags["addr:quarter"]);
    const city = cleanPlaceValue(tags["addr:city"] || tags["addr:town"] || tags["addr:village"] || cityName);
    const region = cleanPlaceValue(tags["addr:state"] || tags["addr:province"] || tags["addr:region"]);
    const postcode = cleanPlaceValue(tags["addr:postcode"]);
    const country = cleanPlaceValue(tags["addr:country"] || tags["addr:country_name"]);
    return [...new Set([country, region, city, district, street ? `${street}${house ? `, ${house}` : ""}${unit ? `, ${unit}` : ""}` : "", postcode].filter(Boolean))].join(", ");
  }

  function fullAddressFromReverse(result, fallback) {
    const address = result?.address || {};
    const parts = [
      address.country,
      address.state || address.province || address.region,
      address.city || address.town || address.village || address.municipality,
      address.suburb || address.city_district || address.county,
      [address.road || address.pedestrian || address.footway, address.house_number].filter(Boolean).join(" "),
      address.postcode
    ].map(cleanPlaceValue).filter(Boolean);
    return [...new Set(parts)].join(", ") || fallback;
  }

  async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 6500) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetch(url, { ...options, ...(controller ? { signal: controller.signal } : {}) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function enrichPlaceFromOpenSources(place) {
    const cacheKey = `${String(place.name || "").toLowerCase()}|${Number(place.lat).toFixed(5)},${Number(place.lon).toFixed(5)}`;
    if (placeEnrichmentCache.has(cacheKey)) return { ...place, ...placeEnrichmentCache.get(cacheKey) };
    const cityName = activeCity?.name || activeCity?.name_en || "";
    let properties = { ...(place.properties || {}) };
    let address = place.address || addressFromOsmTags(properties, cityName);
    let description = cleanPlaceValue(properties["description:ru"] || properties.description || properties["description:en"] || place.description);
    let categoryLabel = "";
    let wikipediaDescription = "";

    // Query nearby OSM objects on demand; all failures are intentionally non-fatal.
    if (Number.isFinite(Number(place.lat)) && Number.isFinite(Number(place.lon))) {
      const lat = Number(place.lat);
      const lon = Number(place.lon);
      const query = `[out:json][timeout:5];(nwr(around:35,${lat},${lon})[name];);out center tags 12;`;
      for (const endpoint of OVERPASS_ENDPOINTS) {
        try {
          const data = await fetchJsonWithTimeout(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
            body: `data=${encodeURIComponent(query)}`
          }, 7000);
          const candidates = (data.elements || []).filter((item) => item.tags && item.tags.name);
          candidates.sort((a, b) => {
            const point = (item) => [item.lat ?? item.center?.lat, item.lon ?? item.center?.lon];
            const distance = (item) => {
              const [aLat, aLon] = point(item);
              return Number.isFinite(aLat) && Number.isFinite(aLon) ? Math.hypot((aLat-lat)*111000, (aLon-lon)*78000) : Infinity;
            };
            const score = (item) => (String(item.tags.name).toLowerCase() === String(place.name).toLowerCase() ? -100000 : 0) + distance(item);
            return score(a) - score(b);
          });
          // Never attach another nearby business just because it is the closest result.
          const match = candidates.find((item) => String(item.tags.name).trim().toLowerCase() === String(place.name).trim().toLowerCase());
          if (match?.tags) {
            properties = { ...match.tags, ...properties };
            // Prefer the exact OSM match's address/contact/description fields when vector tiles omit them.
            for (const [key, value] of Object.entries(match.tags)) {
              if (/^(addr:|contact:|opening_hours$|phone$|website$|url$|operator$|brand$|cuisine$|description|wikidata$|wikipedia$|wheelchair$|payment:|delivery$|takeaway$|internet_access$|fee$|access$|capacity$|start_date$|architect$)/.test(key) && !cleanPlaceValue(properties[key])) properties[key] = value;
            }
            address = addressFromOsmTags({ ...match.tags, ...properties }, cityName) || address;
          }
          break;
        } catch (_) { /* Try the fallback endpoint; the card remains usable offline. */ }
      }

      // Reverse geocoding adds country → region → city → district → street when available.
      // Public Nominatim is throttled and cached to avoid repeated requests while browsing.
      try {
        const now = Date.now();
        const waitMs = Math.max(0, 1050 - (now - lastReverseGeocodeAt));
        if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
        lastReverseGeocodeAt = Date.now();
        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
        const reverse = await fetchJsonWithTimeout(url, { headers: { Accept: "application/json" } }, 5000);
        address = fullAddressFromReverse(reverse, address);
      } catch (_) { /* Address from OSM tags is the fallback. */ }
    }

    const category = categoryFromVectorProperties(properties, "");
    const explicitDescription = cleanPlaceValue(properties["description:ru"] || properties.description || properties["description:en"] || properties.note || properties.inscription);
    if (explicitDescription) description = explicitDescription;
    else if (!description || description === descriptionForPlace(place.category, place.name, place.properties || {})) {
      description = descriptionForPlace(category || place.category, place.name, properties);
    }

    // Wikipedia summaries are requested only when the map data links this exact place to an article.
    const wikipediaTag = cleanPlaceValue(properties["wikipedia:ru"] || properties.wikipedia || properties["wikipedia:en"]);
    if (wikipediaTag) {
      try {
        const splitAt = wikipediaTag.indexOf(":");
        const language = splitAt > 0 ? wikipediaTag.slice(0, splitAt) : "en";
        const title = splitAt > 0 ? wikipediaTag.slice(splitAt + 1) : wikipediaTag;
        const apiUrl = `https://${encodeURIComponent(language)}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replaceAll(" ", "_"))}`;
        const article = await fetchJsonWithTimeout(apiUrl, { headers: { Accept: "application/json" } }, 4500);
        if (article.type !== "disambiguation" && cleanPlaceValue(article.extract)) wikipediaDescription = article.extract;
      } catch (_) { /* Missing/unavailable Wikipedia data is not an error for the card. */ }
    }
    if (wikipediaDescription && (!description || description.length < 90)) description = wikipediaDescription;

    // Wikidata can supply a concise entity description even when no Wikipedia link is present.
    const wikidataId = cleanPlaceValue(properties.wikidata);
    if ((!description || description.length < 90) && /^Q\d+$/.test(wikidataId)) {
      try {
        const entityUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(wikidataId)}&props=labels%7Cdescriptions%7Cclaims&languages=ru%7Cen&format=json&origin=*`;
        const entityData = await fetchJsonWithTimeout(entityUrl, { headers: { Accept: "application/json" } }, 4500);
        const entity = entityData.entities?.[wikidataId];
        const entityDescription = cleanPlaceValue(entity?.descriptions?.ru?.value || entity?.descriptions?.en?.value);
        if (entityDescription && !/^(род|человек|населённый пункт|город|объект)$/i.test(entityDescription)) description = entityDescription;
        const inception = entity?.claims?.P571?.[0]?.mainsnak?.datavalue?.value?.time;
        if (inception && !properties.start_date) properties.start_date = String(inception).replace(/^\+/, "").slice(0, 10);
        const officialSite = entity?.claims?.P856?.[0]?.mainsnak?.datavalue?.value;
        if (typeof officialSite === "string" && /^https?:\/\//i.test(officialSite) && !properties.website) properties.website = officialSite;
      } catch (_) { /* Wikidata is optional; failures never block the place card. */ }
    }

    const result = {
      address,
      description,
      properties,
      category: category || place.category,
      sourceLinks: wikipediaTag ? [{ label: "Статья в Википедии", url: `https://${wikipediaTag.includes(":") ? wikipediaTag.split(":")[0] : "en"}.wikipedia.org/wiki/${encodeURIComponent(wikipediaTag.includes(":") ? wikipediaTag.split(":").slice(1).join(":").replaceAll(" ", "_") : wikipediaTag.replaceAll(" ", "_"))}` }] : []
    };
    placeEnrichmentCache.set(cacheKey, result);
    return { ...place, ...result };
  }

  function showPlaceDetails(place, extra = {}) {
    // Desktop-only place card; avoid changing the mobile experience.
    if (!place || document.documentElement.dataset.device !== "desktop") return;
    if (activePopup) activePopup.remove();
    activePopup = null;
    const props = place.properties || {};
    const categoryLabel = extra.categoryLabel || categoryLabelRu(props, place.category, false) || CATEGORY_META[place.category]?.label || "";
    const description = cleanPlaceValue(place.description || extra.description || "");
    const hasUsefulInfo = Boolean(categoryLabel || description || place.address || props.phone || props.website || props.opening_hours || props.operator || props.brand || props.wikipedia || props.wikidata);
    placeDetailsTitle.textContent = place.name || "Место на карте";
    placeDetailsCategory.textContent = hasUsefulInfo ? categoryLabel : "";
    placeDetailsCategory.hidden = !hasUsefulInfo || !categoryLabel;
    placeDetailsDescription.textContent = description;
    placeDetailsDescription.hidden = !description;
    placeDetailsMeta.replaceChildren();

    const addRow = (label, value, href = "") => {
      if (value === undefined || value === null || String(value).trim() === "") return;
      const row = document.createElement("div");
      row.className = "city-place-details-row";
      const caption = document.createElement("span");
      caption.textContent = label;
      const val = href ? document.createElement("a") : document.createElement("strong");
      val.textContent = String(value).trim();
      if (href) {
        val.href = href;
        val.target = "_blank";
        val.rel = "noopener noreferrer";
        val.className = "city-place-details-link";
      }
      row.append(caption, val);
      placeDetailsMeta.appendChild(row);
    };

    addRow("Адрес", place.address);
    const openingHours = props.opening_hours || props["opening_hours:ru"] || "";
    addRow("Часы работы", openingHours);
    const phone = props.phone || props["contact:phone"] || "";
    addRow("Телефон", phone, phone ? `tel:${String(phone).replace(/[^\d+*#;]/g, "")}` : "");
    const website = props.website || props["contact:website"] || props.url || "";
    const safeWebsite = /^https?:\/\//i.test(String(website)) ? String(website) : "";
    addRow("Сайт", website, safeWebsite);

    const operator = props.operator || props.brand || props["brand:ru"] || props["brand:en"] || "";
    addRow("Организация", operator);
    const cuisine = props.cuisine || "";
    if (cuisine) addRow("Кухня", String(cuisine).split(";").map((v) => v.trim().replaceAll("_", " ")).filter(Boolean).join(", "));
    if (props.wheelchair) {
      const wheelchairLabels = { yes: "Доступно для инвалидных колясок", limited: "Доступность ограничена", no: "Не приспособлено для инвалидных колясок" };
      addRow("Доступность", wheelchairLabels[props.wheelchair] || props.wheelchair);
    }
    if (props.levels) addRow("Этажи", props.levels);
    if (props.capacity) addRow("Вместимость", props.capacity);
    const internet = props.internet_access;
    if (internet) addRow("Интернет", ({ yes: "Есть Wi-Fi или доступ в интернет", wlan: "Доступен Wi-Fi", no: "Интернет не указан" })[internet] || internet);
    if (props.payment) addRow("Оплата", String(props.payment).split(";").map((v) => v.replaceAll("_", " ")).join(", "));
    if (props.fee) addRow("Вход", ({ yes: "Платный", no: "Бесплатный" })[props.fee] || props.fee);
    if (props.delivery) addRow("Доставка", props.delivery === "yes" ? "Доставка указана" : props.delivery);
    if (props.takeaway) addRow("Еда навынос", props.takeaway === "yes" ? "Доступно" : props.takeaway);
    if (props.start_date) addRow("Дата открытия", props.start_date);
    if (props.architect) addRow("Архитектор", props.architect);
    if (props.wikipedia || props.wikidata) addRow("Дополнительные сведения", props.wikipedia || `Wikidata: ${props.wikidata}`);
    placeDetailsPanel.classList.remove("hidden");
    placeDetailsPanel.classList.add("visible");
    placeDetailsRouteButton.dataset.placeName = place.name || "";
  }

  function descriptionForPlace(category, name = "", properties = {}) {
    const props = properties || {};
    const normalized = String(category || "").toLowerCase();
    const tag = (...keys) => {
      for (const key of keys) {
        const value = props[key];
        if (typeof value === "string" && value.trim()) return value.trim().toLowerCase();
      }
      return "";
    };
    const amenity = tag("amenity");
    const shop = tag("shop");
    const office = tag("office");
    const tourism = tag("tourism");
    const leisure = tag("leisure");
    const healthcare = tag("healthcare");
    const craft = tag("craft");
    const sport = tag("sport");
    const historic = tag("historic");
    const building = tag("building");
    const labels = {
      parcel_locker: "Постамат для самостоятельного получения или отправки посылок; доступные операции зависят от оператора.",
      post_office: "Почтовое отделение для отправки и получения писем и посылок.",
      marketplace: "Пункт выдачи заказов: здесь обычно получают интернет-заказы; возврат и отправка зависят от оператора.",
      convenience: "Небольшой магазин товаров повседневного спроса и продуктов.",
      supermarket: "Продуктовый супермаркет с товарами для повседневных покупок.",
      bakery: "Пекарня с хлебом и выпечкой.",
      butcher: "Мясной магазин.",
      greengrocer: "Магазин овощей и фруктов.",
      clothes: "Магазин одежды.",
      shoes: "Обувной магазин.",
      books: "Книжный магазин.",
      electronics: "Магазин электроники и бытовой техники.",
      computer: "Магазин компьютеров и компьютерных принадлежностей.",
      mobile_phone: "Магазин мобильных телефонов и аксессуаров.",
      furniture: "Магазин мебели.",
      florist: "Цветочный магазин.",
      chemist: "Магазин бытовой химии и товаров для дома.",
      cosmetics: "Магазин косметики и средств ухода.",
      optician: "Оптика: очки, линзы и товары для коррекции зрения.",
      laundry: "Прачечная для стирки одежды и текстиля.",
      dry_cleaning: "Химчистка для профессиональной чистки одежды и текстиля.",
      hairdresser: "Парикмахерская для стрижек и ухода за волосами.",
      beauty: "Салон красоты или место оказания косметических услуг.",
      car_repair: "Автомастерская для диагностики, обслуживания и ремонта автомобилей.",
      car_parts: "Магазин автомобильных запчастей и принадлежностей.",
      car_wash: "Автомойка.",
      bicycle: "Магазин или мастерская велосипедов.",
      pharmacy: "Аптека: лекарства и товары для здоровья.",
      bank: "Банковское отделение или точка банковского обслуживания.",
      atm: "Банкомат для доступных банковских операций, обычно снятия наличных.",
      fuel: "Автозаправочная станция.",
      charging_station: "Зарядная станция для электромобилей.",
      doctors: "Приём врача или медицинский кабинет; специализация зависит от учреждения.",
      clinic: "Клиника для диагностики и лечения.",
      hospital: "Больница, оказывающая медицинскую помощь.",
      dentist: "Стоматологическая клиника или кабинет.",
      veterinary: "Ветеринарная клиника или кабинет для животных.",
      school: "Школа для получения общего образования.",
      kindergarten: "Детский сад и дошкольное образование.",
      college: "Колледж или учреждение профессионального образования.",
      university: "Университет или другое учреждение высшего образования.",
      library: "Библиотека с книжным фондом и другими информационными материалами.",
      police: "Полицейское подразделение или пункт правоохранительной службы.",
      fire_station: "Пожарно-спасательное подразделение.",
      townhall: "Учреждение местного управления или администрации.",
      community_centre: "Общественный центр для встреч, занятий и мероприятий.",
      restaurant: "Ресторан с приготовленными блюдами; кухня и меню зависят от заведения.",
      cafe: "Кафе с напитками и едой; ассортимент зависит от заведения.",
      fast_food: "Заведение быстрого питания.",
      food_court: "Фуд-корт с несколькими точками питания.",
      bar: "Бар с напитками; наличие кухни зависит от заведения.",
      pub: "Паб — заведение с напитками, иногда с кухней.",
      ice_cream: "Точка продажи мороженого.",
      hotel: "Отель для временного проживания гостей.",
      guest_house: "Гостевой дом для временного проживания.",
      hostel: "Хостел с бюджетным размещением, часто в общих комнатах.",
      museum: "Музей с экспозицией по указанной тематике, если она известна.",
      gallery: "Галерея для выставок произведений искусства или других экспонатов.",
      attraction: "Достопримечательность или туристически интересное место.",
      viewpoint: "Смотровая площадка или место с обзорным видом.",
      information: "Информационный пункт для посетителей.",
      park: "Парк или зелёная территория для прогулок и отдыха.",
      garden: "Сад или озеленённая территория.",
      playground: "Детская игровая площадка.",
      sports_centre: "Спортивный комплекс для тренировок и занятий спортом.",
      fitness_centre: "Фитнес-клуб или тренажёрный зал.",
      stadium: "Стадион для спортивных мероприятий.",
      pitch: "Спортивная площадка; вид спорта уточняется, если указан.",
      bus_stop: "Остановка общественного транспорта.",
      bus_station: "Автобусная станция или автовокзал.",
      railway_station: "Железнодорожная станция для посадки и высадки пассажиров.",
      subway_entrance: "Вход на станцию метро.",
      taxi: "Место вызова или стоянки такси.",
      parking: "Парковка для временной стоянки автомобилей.",
      bicycle_parking: "Место для парковки велосипедов.",
      toilets: "Общественный туалет.",
      recycling: "Пункт приёма отдельных видов вторсырья; список принимаемых материалов нужно уточнять на месте.",
      waste_disposal: "Пункт или контейнер для сбора отходов.",
      place_of_worship: "Религиозное сооружение или место проведения богослужений.",
      theatre: "Театр или площадка для сценических представлений.",
      cinema: "Кинотеатр для показа фильмов.",
      arts_centre: "Культурный центр для выставок, занятий или мероприятий.",
      marketplace_shop: "Торговая точка или место обслуживания покупателей."
    };
    const direct = shop && labels[shop] ? labels[shop] : amenity && labels[amenity] ? labels[amenity] : tourism && labels[tourism] ? labels[tourism] : "";
    if (direct) return direct;
    if (office) {
      const officeLabels = {
        government: "Государственное или муниципальное учреждение.",
        company: "Офис компании или организации.",
        estate_agent: "Агентство недвижимости.",
        insurance: "Офис страховой организации.",
        lawyer: "Юридическая фирма или адвокатская практика.",
        accountant: "Бухгалтерские услуги.",
        travel_agent: "Туристическое агентство.",
        employment_agency: "Агентство по подбору персонала."
      };
      return officeLabels[office] || "Офис или место оказания профессиональных услуг.";
    }
    if (healthcare) return healthcare === "pharmacy" ? labels.pharmacy : healthcare === "dentist" ? labels.dentist : healthcare === "clinic" ? labels.clinic : healthcare === "hospital" ? labels.hospital : "Медицинское учреждение или специалист в сфере здравоохранения.";
    if (craft) {
      const craftLabels = { electrician: "Мастерская или специалист по электромонтажным работам.", plumber: "Сантехнические работы.", carpenter: "Столярная мастерская.", tailor: "Ателье по пошиву и ремонту одежды.", photographer: "Фотографические услуги.", painter: "Малярные или художественные работы.", locksmith: "Слесарная мастерская." };
      return craftLabels[craft] || "Мастерская или специалист, выполняющий профильные работы.";
    }
    if (leisure === "park" || leisure === "garden") return labels[leisure];
    if (leisure === "playground") return labels.playground;
    if (leisure === "sports_centre" || leisure === "stadium" || leisure === "pitch") return sport ? `Спортивная площадка для занятий: ${sport.replaceAll("_", " ")}.` : labels[leisure];
    if (historic) {
      const historicLabels = { monument: "Исторический памятник.", memorial: "Мемориальный объект.", castle: "Исторический замок или укреплённое сооружение.", ruins: "Руины исторического сооружения.", archaeological_site: "Археологический объект.", wayside_shrine: "Придорожное религиозное сооружение." };
      return historicLabels[historic] || "Историческое место или объект культурного наследия.";
    }
    if (/restaurant|cafe|food/.test(normalized)) return "Заведение, где можно заказать еду или напитки; точное меню зависит от места.";
    if (/hotel|lodging/.test(normalized)) return labels.hotel;
    if (/park|garden/.test(normalized)) return labels.park;
    if (/museum/.test(normalized)) return labels.museum;
    if (/attraction|viewpoint|historic|monument/.test(normalized)) return labels.attraction;
    if (/transport|station/.test(normalized)) return "Транспортный объект для посадки, высадки или пересадки пассажиров.";
    if (building && building !== "yes") {
      const buildingLabels = { commercial: "Коммерческое здание; конкретная организация внутри не определена.", retail: "Торговое здание; конкретный магазин не определён.", industrial: "Промышленное здание; назначение предприятия не указано.", school: "Здание учебного учреждения.", hospital: "Здание медицинского учреждения.", hotel: "Здание гостиницы.", church: "Религиозное сооружение.", office: "Офисное здание; организация внутри не определена.", warehouse: "Складское здание." };
      return buildingLabels[building] || "Здание; точное назначение не указано в доступных картографических данных.";
    }
    return "";
  }

  function categoryLabelRu(properties = {}, category = "other", isBuilding = false) {
    if (isBuilding) return "Здание";
    const props = properties || {};
    const value = String(props.amenity || props.shop || props.tourism || props.leisure || props.office || props.healthcare || props.craft || props.historic || props.class || props.type || props.subclass || "").toLowerCase();
    const labels = {
      restaurant: "Ресторан", cafe: "Кафе", fast_food: "Быстрое питание", food_court: "Фуд-корт", bar: "Бар", pub: "Паб",
      hotel: "Отель", guest_house: "Гостевой дом", hostel: "Хостел", museum: "Музей", gallery: "Галерея",
      attraction: "Достопримечательность", viewpoint: "Смотровая площадка", monument: "Памятник", memorial: "Мемориал",
      park: "Парк", garden: "Сад", playground: "Детская площадка", sports_centre: "Спортивный центр", fitness_centre: "Фитнес-клуб",
      supermarket: "Супермаркет", convenience: "Магазин у дома", bakery: "Пекарня", butcher: "Мясной магазин", greengrocer: "Овощной магазин",
      pharmacy: "Аптека", clothes: "Магазин одежды", shoes: "Обувной магазин", books: "Книжный магазин", electronics: "Магазин электроники",
      computer: "Компьютерный магазин", mobile_phone: "Магазин телефонов", furniture: "Мебельный магазин", florist: "Цветочный магазин",
      cosmetics: "Магазин косметики", optician: "Оптика", laundry: "Прачечная", dry_cleaning: "Химчистка", hairdresser: "Парикмахерская",
      beauty: "Салон красоты", parcel_locker: "Постамат", post_office: "Почтовое отделение", marketplace: "Пункт выдачи заказов",
      bank: "Банк", atm: "Банкомат", fuel: "Автозаправка", car_repair: "Автомастерская", car_parts: "Автозапчасти", car_wash: "Автомойка",
      doctors: "Медицинский кабинет", clinic: "Клиника", hospital: "Больница", dentist: "Стоматология", veterinary: "Ветеринарная клиника",
      school: "Школа", kindergarten: "Детский сад", college: "Колледж", university: "Университет", library: "Библиотека",
      police: "Полиция", fire_station: "Пожарная часть", townhall: "Администрация", community_centre: "Общественный центр",
      bus_stop: "Остановка", bus_station: "Автовокзал", railway_station: "Железнодорожная станция", subway_entrance: "Вход в метро",
      parking: "Парковка", bicycle_parking: "Велопарковка", toilets: "Общественный туалет", recycling: "Пункт приёма вторсырья",
      charging_station: "Зарядка электромобилей", place_of_worship: "Религиозное сооружение", theatre: "Театр", cinema: "Кинотеатр",
      company: "Офис компании", government: "Государственное учреждение", estate_agent: "Агентство недвижимости", insurance: "Страховая компания"
    };
    if (labels[value]) return labels[value];
    if (props.shop) return "Магазин";
    if (props.amenity) return "Объект обслуживания";
    if (props.office) return "Офис";
    if (props.healthcare) return "Медицинское учреждение";
    if (props.historic) return "Историческое место";
    return category && category !== "other" ? (CATEGORY_META[category]?.label || "") : "";
  }

  function hidePlaceDetails() {
    placeDetailsRequestId += 1;
    placeDetailsPanel.classList.add("hidden");
    placeDetailsPanel.classList.remove("visible");
  }

  function featureDisplayName(properties = {}) {
    const candidates = [properties["name:ru"], properties.name, properties["name:en"], properties.name_en, properties.ref];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
    return "";
  }

  function handleVectorFeatureClick(event) {
    if (!map || !mapReady || !event?.point) return;
    const features = map.queryRenderedFeatures(event.point) || [];
    if (!features.length) return; // Clicking empty map space must not create a place card.

    // Prefer a named/meaningful point or area. An anonymous building footprint is
    // deliberately ignored instead of being presented as "Building on map".
    const feature = features.find((item) => {
      const props = item.properties || {};
      const layer = map.getLayer(item.layer?.id);
      const sourceLayer = String(item.sourceLayer || layer?.["source-layer"] || "");
      const isBuilding = /building/i.test(sourceLayer) || /building/i.test(String(item.layer?.id || "")) || item.layer?.id === BUILDING_EXTRUSION_LAYER_ID;
      const name = featureDisplayName(props);
      if (isBuilding && !name) return false;
      const meaningful = name || props.amenity || props.shop || props.tourism || props.leisure || props.historic || props.office || props.public_transport || props.railway || props.highway === "bus_stop";
      return Boolean(meaningful);
    });
    if (!feature) return;

    const props = feature.properties || {};
    const layer = map.getLayer(feature.layer?.id);
    const sourceLayer = String(feature.sourceLayer || layer?.["source-layer"] || "");
    const isBuilding = /building/i.test(sourceLayer) || /building/i.test(String(feature.layer?.id || "")) || feature.layer?.id === BUILDING_EXTRUSION_LAYER_ID;
    const name = featureDisplayName(props);
    if (!name) return;

    const street = props["addr:street"] || props.street || "";
    const houseNumber = props["addr:housenumber"] || "";
    const cityName = activeCity?.name || activeCity?.name_en || "";
    const addressParts = [
      props["addr:country_name"] || props["addr:country"] || "",
      props["addr:state"] || props["addr:province"] || props["addr:region"] || "",
      cityName,
      props["addr:suburb"] || props["addr:district"] || props["addr:quarter"] || "",
      houseNumber && street ? `${street} ${houseNumber}` : street,
      props["addr:postcode"] || ""
    ].filter(Boolean);
    const category = isBuilding ? "other" : categoryFromVectorProperties(props, sourceLayer);
    const place = {
      id: `vector-${feature.source || "map"}-${feature.id ?? `${event.lngLat.lng.toFixed(5)}-${event.lngLat.lat.toFixed(5)}`}`,
      name,
      category,
      description: String(props["description:ru"] || props.description || props["description:en"] || "").trim() || descriptionForPlace(category, name, props),
      address: addressParts.join(", "),
      properties: { ...props },
      lat: event.lngLat.lat,
      lon: event.lngLat.lng
    };
    showPlaceDetails(place, { categoryLabel: categoryLabelRu(props, category, isBuilding) });
    const requestId = ++placeDetailsRequestId;
    // Enrichment is progressive: show the local map data immediately, then fill in public-source details.
    enrichPlaceFromOpenSources(place).then((enriched) => {
      if (requestId !== placeDetailsRequestId || !placeDetailsPanel.classList.contains("visible")) return;
      if (placeDetailsTitle.textContent !== place.name) return;
      const hasSourceDescription = cleanPlaceValue(enriched.description);
      const knownCategory = categoryLabelRu(enriched.properties || {}, enriched.category, false);
      // When no useful details exist, leave the title only rather than displaying a fake "no information" message.
      if (!hasSourceDescription && !knownCategory && !enriched.address && !Object.keys(enriched.properties || {}).some((key) => /^(phone|contact:phone|website|contact:website|opening_hours|operator|brand)$/.test(key))) {
        enriched.description = "";
      }
      showPlaceDetails(enriched, { categoryLabel: knownCategory });
    }).catch(() => { /* Public-source failures never break map interaction. */ });
  }

  function categoryFromVectorProperties(properties = {}, sourceLayer = "") {
    const value = String(properties.amenity || properties.shop || properties.tourism || properties.leisure || properties.historic || properties.office || properties.healthcare || properties.class || properties.type || properties.subclass || sourceLayer).toLowerCase();
    if (/restaurant|cafe|food|fast_food|bar|pub/.test(value)) return "restaurant";
    if (/hotel|hostel|guest_house|lodging/.test(value)) return "hotel";
    if (/park|garden|green|playground/.test(value)) return "park";
    if (/museum|gallery|theatre|cinema/.test(value)) return "museum";
    if (/attraction|historic|tourism|monument|memorial|viewpoint/.test(value)) return "attraction";
    if (/station|transport|railway|bus_stop|subway/.test(value)) return "transport";
    if (/shop|supermarket|convenience|bakery|pharmacy|books|clothes|electronics|florist/.test(value)) return "shopping";
    return "other";
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
        showPlaceDetails(place);
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
      // Keep the camera within a generous city-sized area so users cannot drift
      // far away from the city being explored. This is a fallback radius because
      // the current city catalogue stores centers, not official city boundaries.
      map.setMaxBounds(bounds);
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
      // Clickable vector features (including building footprints/extrusions) work in both 2D and 3D.
      map.on("click", handleVectorFeatureClick);
      map.on("mousemove", (event) => {
        if (!mapReady) return;
        const features = map.queryRenderedFeatures(event.point) || [];
        const clickable = features.some((feature) => {
          const layer = map.getLayer(feature.layer?.id);
          const sourceLayer = String(feature.sourceLayer || layer?.["source-layer"] || "");
          return feature.layer?.id === BUILDING_EXTRUSION_LAYER_ID || /building/i.test(sourceLayer) ||
            /building/i.test(String(feature.layer?.id || "")) || Boolean(featureDisplayName(feature.properties));
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

  async function open(city) {
    if (!city || !Number.isFinite(city.lat) || !Number.isFinite(city.lon)) {
      onToast("У этого города нет корректных координат для карты.");
      return;
    }
    activeCity = city;
    hidePlaceDetails();
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
    hidePlaceDetails();
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
  const searchButton = document.getElementById("city-place-search-button");
  const routeBuildButton = document.getElementById("city-route-build-button");
  const searchInput = document.getElementById("city-place-search");
  if (searchButton) searchButton.addEventListener("click", () => setStatus("Поиск мест будет подключён следующим этапом."));
  if (routeBuildButton) routeBuildButton.addEventListener("click", () => setStatus("Построение маршрутов будет подключено следующим этапом."));
  if (searchInput) searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") setStatus("Поиск мест будет подключён следующим этапом.");
  });
  clearRouteButton.addEventListener("click", clearRoute);
  placeDetailsCloseButton.addEventListener("click", hidePlaceDetails);
  placeDetailsRouteButton.addEventListener("click", () => {
    // The button is intentionally present but route integration is a later step.
    setStatus("Построение маршрута для выбранного места подключим следующим этапом.");
  });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });

  return { open, close, get isOpen() { return isOpen; } };
}
