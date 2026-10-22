/* WAY●MARK — country borders and labels for the distant-globe zoom level.
 * Country geometry is loaded lazily from a small-scale Natural Earth GeoJSON.
 * Country shapes are drawn as lines over the existing Three.js globe; this
 * does not replace the globe's texture or alter its interaction logic.
 */

const COUNTRY_GEOJSON_URL =
  "https://raw.githubusercontent.com/martynafford/natural-earth-geojson/master/110m/cultural/ne_110m_admin_0_countries.json";

const COUNTRY_ALIASES_RU = {
  "United States of America": "США",
  "United States": "США",
  "United Kingdom": "Великобритания",
  "Russia": "Россия",
  "Russian Federation": "Россия",
  "South Korea": "Южная Корея",
  "Democratic Republic of the Congo": "ДР Конго",
  "Republic of the Congo": "Республика Конго",
  "Czechia": "Чехия",
  "Czech Republic": "Чехия",
  "Türkiye": "Турция",
  "Turkey": "Турция",
  "Iran": "Иран",
  "Syria": "Сирия",
  "North Korea": "Северная Корея",
  "Taiwan": "Тайвань",
  "Vietnam": "Вьетнам",
  "Laos": "Лаос",
  "Moldova": "Молдова",
  "Bolivia": "Боливия",
  "Venezuela": "Венесуэла",
  "Tanzania": "Танзания",
  "The Bahamas": "Багамы",
  "The Gambia": "Гамбия",
  "Ivory Coast": "Кот-д’Ивуар",
  "Côte d'Ivoire": "Кот-д’Ивуар",
  "Dem. Rep. Korea": "Северная Корея",
  "Antarctica": "Антарктида"
};

function smoothStep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function allRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return geometry.coordinates || [];
  if (geometry.type === "MultiPolygon") return (geometry.coordinates || []).flatMap((polygon) => polygon || []);
  return [];
}

function getLabelPosition(feature) {
  const properties = feature.properties || {};
  const x = Number(properties.LABEL_X ?? properties.label_x);
  const y = Number(properties.LABEL_Y ?? properties.label_y);
  if (Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 180 && Math.abs(y) <= 90) {
    return { lon: x, lat: y };
  }

  const rings = allRings(feature.geometry).filter((ring) => Array.isArray(ring) && ring.length > 3);
  rings.sort((a, b) => b.length - a.length);
  const ring = rings[0];
  if (!ring) return null;

  let vx = 0;
  let vy = 0;
  let vz = 0;
  const limit = Math.max(1, ring.length - 1);
  const sampleStep = Math.max(1, Math.floor(limit / 160));
  let samples = 0;
  for (let index = 0; index < limit; index += sampleStep) {
    const [lonDeg, latDeg] = ring[index];
    const lon = lonDeg * Math.PI / 180;
    const lat = latDeg * Math.PI / 180;
    const cosLat = Math.cos(lat);
    vx += cosLat * Math.cos(lon);
    vy += Math.sin(lat);
    vz += -cosLat * Math.sin(lon);
    samples += 1;
  }
  if (!samples || Math.hypot(vx, vy, vz) < 1e-7) return null;
  const magnitude = Math.hypot(vx, vy, vz);
  vx /= magnitude;
  vy /= magnitude;
  vz /= magnitude;
  return {
    lon: Math.atan2(-vz, vx) * 180 / Math.PI,
    lat: Math.asin(Math.max(-1, Math.min(1, vy))) * 180 / Math.PI
  };
}

function getRussianCountryName(properties) {
  const englishName = String(properties.ADMIN || properties.NAME || properties.name || "").trim();
  if (COUNTRY_ALIASES_RU[englishName]) return COUNTRY_ALIASES_RU[englishName];
  const alpha2 = String(properties.ISO_A2_EH || properties.ISO_A2 || "").toUpperCase();
  if (/^[A-Z]{2}$/.test(alpha2)) {
    try {
      const displayNames = new Intl.DisplayNames(["ru-RU", "ru"], { type: "region" });
      const localized = displayNames.of(alpha2);
      if (localized && localized.toUpperCase() !== alpha2) return localized;
    } catch {
      // Older browsers may not implement Intl.DisplayNames.
    }
  }
  return englishName;
}

export function createCountryBoundaryOverlay({ THREE, globeGroup, camera, labelRoot, radius = 2 }) {
  const boundaryGroup = new THREE.Group();
  boundaryGroup.name = "WAYMARK country boundaries";
  boundaryGroup.renderOrder = 1.5;
  globeGroup.add(boundaryGroup);

  const borderMaterial = new THREE.LineBasicMaterial({
    color: 0xe8f0fa,
    transparent: true,
    opacity: 0,
    depthTest: true,
    depthWrite: false
  });
  const labels = [];
  let loaded = false;
  let loading = false;
  let loadError = null;

  function toSpherePoint(lonDeg, latDeg, targetRadius = radius * 1.006) {
    const lon = lonDeg * Math.PI / 180;
    const lat = latDeg * Math.PI / 180;
    const cosLat = Math.cos(lat);
    return new THREE.Vector3(
      targetRadius * cosLat * Math.cos(lon),
      targetRadius * Math.sin(lat),
      -targetRadius * cosLat * Math.sin(lon)
    );
  }

  function addCountryLabels(features) {
    const sorted = [...features].sort((a, b) => {
      const rankA = Number(a.properties?.LABELRANK ?? 6);
      const rankB = Number(b.properties?.LABELRANK ?? 6);
      return rankA - rankB;
    });

    for (const feature of sorted) {
      const properties = feature.properties || {};
      const labelRank = Number(properties.LABELRANK ?? 6);
      if (labelRank > 6) continue;
      const position = getLabelPosition(feature);
      const name = getRussianCountryName(properties);
      if (!position || !name) continue;

      const element = document.createElement("span");
      element.className = "country-label";
      element.textContent = name;
      element.setAttribute("aria-hidden", "true");
      labelRoot.appendChild(element);
      labels.push({
        element,
        name,
        labelRank,
        localPosition: toSpherePoint(position.lon, position.lat, radius * 1.022),
        width: Math.min(170, Math.max(40, name.length * 6.4 + 14)),
        height: 22
      });
    }
  }

  async function load() {
    if (loaded || loading) return;
    loading = true;
    try {
      const response = await fetch(COUNTRY_GEOJSON_URL, { mode: "cors", cache: "force-cache" });
      if (!response.ok) throw new Error(`GeoJSON HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data.features)) throw new Error("Invalid country GeoJSON");

      const positions = [];
      for (const feature of data.features) {
        for (const ring of allRings(feature.geometry)) {
          if (!Array.isArray(ring) || ring.length < 2) continue;
          for (let index = 1; index < ring.length; index += 1) {
            const [lonA, latA] = ring[index - 1];
            const [lonB, latB] = ring[index];
            if (![lonA, latA, lonB, latB].every(Number.isFinite)) continue;
            const a = toSpherePoint(lonA, latA);
            const b = toSpherePoint(lonB, latB);
            positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
          }
        }
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      const lines = new THREE.LineSegments(geometry, borderMaterial);
      lines.name = "WAYMARK country outlines";
      lines.renderOrder = 1.5;
      boundaryGroup.add(lines);
      addCountryLabels(data.features);
      loaded = true;
    } catch (error) {
      loadError = error;
      console.warn("WAY●MARK: country borders could not be loaded; globe remains usable.", error);
    } finally {
      loading = false;
    }
  }

  function update() {
    const zoom = camera.position.z;
    // Complement the globe city-label fade interval so there is no zoom range
    // in which both countries and cities disappear. The two layers cross-fade.
    const countryOpacity = smoothStep(5.25, 5.58, zoom);
    borderMaterial.opacity = countryOpacity * 0.76;
    boundaryGroup.visible = loaded && countryOpacity > 0.015;

    if (!loaded || countryOpacity < 0.025) {
      for (const label of labels) {
        label.element.style.opacity = "0";
        label.element.style.visibility = "hidden";
      }
      return;
    }

    globeGroup.updateMatrixWorld();
    const candidates = [];
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const cameraDirection = new THREE.Vector3();
    const normal = new THREE.Vector3();

    for (const label of labels) {
      const world = label.localPosition.clone().applyMatrix4(globeGroup.matrixWorld);
      const projected = world.clone().project(camera);
      cameraDirection.subVectors(camera.position, world).normalize();
      normal.copy(world).normalize();
      const frontFacing = normal.dot(cameraDirection) > 0.12;
      const x = (projected.x * 0.5 + 0.5) * viewportWidth;
      const y = (-projected.y * 0.5 + 0.5) * viewportHeight;
      const inBounds = projected.z > -1 && projected.z < 1 && x > -140 && x < viewportWidth + 140 && y > 40 && y < viewportHeight - 28;
      candidates.push({ label, x, y, visible: frontFacing && inBounds });
    }

    candidates.sort((a, b) => a.label.labelRank - b.label.labelRank ||
      Math.hypot(a.x - viewportWidth / 2, a.y - viewportHeight / 2) - Math.hypot(b.x - viewportWidth / 2, b.y - viewportHeight / 2));

    const accepted = [];
    const alphaGrid = countryOpacity;
    const topGuard = 68;
    const bottomGuard = 66;
    for (const candidate of candidates) {
      const { label, x, y, visible } = candidate;
      let keep = visible && y - label.height / 2 > topGuard && y + label.height / 2 < viewportHeight - bottomGuard;
      if (keep) {
        const rect = { left: x - label.width / 2 - 8, right: x + label.width / 2 + 8, top: y - label.height / 2 - 3, bottom: y + label.height / 2 + 3 };
        for (const other of accepted) {
          if (rect.left < other.right && rect.right > other.left && rect.top < other.bottom && rect.bottom > other.top) {
            keep = false;
            break;
          }
        }
        if (keep) accepted.push(rect);
      }
      label.element.style.left = `${x}px`;
      label.element.style.top = `${y}px`;
      label.element.style.opacity = keep ? String(alphaGrid) : "0";
      label.element.style.visibility = keep ? "visible" : "hidden";
    }
  }

  return { load, update, get loaded() { return loaded; }, get error() { return loadError; } };
}
