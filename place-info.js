/* WAY●MARK — pure helpers for place cards (v1.48).
 * Address composition, real-description filtering and map-click rules.
 * The module has no DOM or MapLibre dependency, so scripts/probe-place-cards.mjs
 * can exercise exactly the same code the site uses.
 */

// A trailing "55.7601, 37.6186" (optionally labelled "координаты") is technical
// noise: it must never reach a card title, description or address.
const COORDINATE_PAIR_TAIL = /(?:^|[\s,;:—–-])-?\d{1,3}[.,]\d{3,}\s*[,;]\s*-?\d{1,3}[.,]\d{3,}\s*$/u;
const COORDINATE_LABELLED = /^\s*координаты\s*[:—–-]?\s*-?\d{1,3}[.,]\d{3,}\s*[,;]\s*-?\d{1,3}[.,]\d{3,}\s*$/iu;

// The old disclaimer that used to be generated for unknown objects.
const GENERIC_DISCLAIMER = /картографическ|недостаточно сведений|уточнить его назначение|назначение не указано|точное назначение/iu;

// House / unit / floor tokens, for example "д. 12", "корп. 3", "кв 5", "офис 7".
const HOUSE_NUMBER_TOKENS = /(?:^|[\s,;])(?:дом|д|корпус|корп|к|строение|стр|владение|вл|квартира|кв|офис|оф|помещение|пом|литера|литер|этаж|эт|подъезд|здание)\.?\s*№?\s*\d+[\p{L}\d/-]*/giu;
// A bare number at the very end: "Тверская улица, 7" or "Тверская улица 7".
const TRAILING_NUMBER = /[\s,;]+(?:№\s*)?\d+[\p{L}]?(?:[/-]\d+[\p{L}]?)*\.?\s*$/u;
const TRAILING_POSTCODE = /\s+\d{6}\s*$/u;
const LEADING_POSTCODE = /^\s*\d{6}\s*,\s*/u;
const ONLY_TECHNICAL = /^[\d\s.,;:/№—–-]*$/u;
const NUMBER_ONLY_NAME = /^\s*\d+(?:[.,]\d+)?\s*$/u;

/**
 * Remove coordinate tails and dangling separators from a single string.
 * @param {unknown} value
 * @returns {string}
 */
export function stripCoordinateTail(value) {
  let text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (COORDINATE_LABELLED.test(text)) return "";
  text = text.replace(COORDINATE_PAIR_TAIL, "").trim();
  return text.replace(/[\s,;:—–-]+$/u, "").trim();
}

/**
 * Clean one address component: no house numbers, no postcodes, no coordinates.
 * Digits that are part of an official name ("улица 8 Марта", "1-я Тверская-Ямская")
 * are preserved.
 * @param {unknown} value
 * @returns {string}
 */
export function cleanAddressPart(value) {
  let text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  text = stripCoordinateTail(text);
  if (!text) return "";

  text = text.replace(HOUSE_NUMBER_TOKENS, " ");
  text = text.replace(LEADING_POSTCODE, "");
  text = text.replace(TRAILING_NUMBER, "");
  text = text.replace(TRAILING_POSTCODE, "");
  text = text.replace(/\s*[,;]\s*(?=[,;]|$)/g, "");
  text = text.replace(/\s+/g, " ").replace(/[\s,;:—–-]+$/u, "").trim();

  if (!text || ONLY_TECHNICAL.test(text)) return "";
  return text;
}

/**
 * Build a readable address and report whether it contains a street or district
 * (country + city alone is not worth a separate row in the card).
 * @param {{country?: string, region?: string, city?: string, district?: string, street?: string, fallbackCity?: string, fallbackCountry?: string}} input
 * @returns {{text: string, hasDetail: boolean}}
 */
export function composeAddress({
  country = "",
  region = "",
  city = "",
  district = "",
  street = "",
  fallbackCity = "",
  fallbackCountry = ""
} = {}) {
  const resolvedCountry = cleanAddressPart(country || fallbackCountry);
  const resolvedCity = cleanAddressPart(city || fallbackCity);
  const resolvedRegion = cleanAddressPart(region);
  const resolvedDistrict = cleanAddressPart(district);
  const resolvedStreet = cleanAddressPart(street);

  const parts = [];
  const push = (value) => {
    if (!value) return;
    const key = value.toLocaleLowerCase("ru-RU");
    if (parts.some((item) => item.toLocaleLowerCase("ru-RU") === key)) return;
    parts.push(value);
  };

  push(resolvedCountry);
  if (resolvedRegion && resolvedRegion.toLocaleLowerCase("ru-RU") !== resolvedCity.toLocaleLowerCase("ru-RU")) {
    push(resolvedRegion);
  }
  push(resolvedCity);
  if (resolvedDistrict && resolvedDistrict.toLocaleLowerCase("ru-RU") !== resolvedCity.toLocaleLowerCase("ru-RU")) {
    push(resolvedDistrict);
  }
  push(resolvedStreet);

  return {
    text: parts.join(", "),
    hasDetail: Boolean(resolvedStreet || resolvedDistrict)
  };
}

/**
 * Address of a Nominatim reverse-geocoding response. House number and postcode
 * are ignored by design.
 * @param {Record<string, string>} address
 * @param {string} fallbackCity
 * @param {string} fallbackCountry
 * @returns {{text: string, hasDetail: boolean}}
 */
export function formatNominatimAddress(address = {}, fallbackCity = "", fallbackCountry = "") {
  const source = address || {};
  return composeAddress({
    country: source.country || "",
    region: source.state || source.region || source.province || "",
    city: source.city || source.town || source.village || source.municipality || "",
    district: source.city_district || source.suburb || source.district || source.neighbourhood || "",
    street: source.road || source.pedestrian || source.residential || source.footway || "",
    fallbackCity,
    fallbackCountry
  });
}

/**
 * Keep only real descriptive text. Generic disclaimers and coordinate tails are
 * dropped instead of being replaced with another placeholder.
 * @param {unknown} value
 * @returns {string}
 */
export function cleanPlaceDescription(value) {
  let text = String(value ?? "").trim();
  if (!text) return "";
  if (GENERIC_DISCLAIMER.test(text)) return "";
  text = stripCoordinateTail(text);
  if (!text) return "";
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Description taken from explicit map data only ("description", "description:ru",
 * "description:en"). No template text is invented when these tags are missing.
 * @param {Record<string, unknown>} properties
 * @returns {string}
 */
export function descriptionFromProperties(properties = {}) {
  const source = properties || {};
  return cleanPlaceDescription(
    source["description:ru"] || source.description || source["description:en"] || ""
  );
}

/**
 * Display name of a map feature. `ref` is intentionally ignored: for roads and
 * buildings it usually contains a house number or a road code, not a name.
 * @param {Record<string, unknown>} properties
 * @returns {string}
 */
export function featureDisplayName(properties = {}) {
  const source = properties || {};
  const candidates = [source["name:ru"], source.name, source["name:en"], source.name_en];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const name = candidate.trim();
    if (!name || NUMBER_ONLY_NAME.test(name)) continue;
    return name;
  }
  return "";
}

const CLICKABLE_SOURCE_LAYERS = new Set(["poi", "aerodrome_label", "building", "park", "landuse"]);
const CLICKABLE_LANDUSE = /park|garden|wood|forest|cemetery|zoo|recreation_ground|nature_reserve/i;

/**
 * A map click may open a card only for a recognisable object. Labels of the
 * basemap (city/country names), road names, water bodies, boundaries and road
 * shields are not places the user can "open", so they are rejected here.
 * @param {string} sourceLayer
 * @param {Record<string, unknown>} properties
 * @returns {boolean}
 */
export function isClickableMapFeature(sourceLayer, properties = {}) {
  const layer = String(sourceLayer || "").toLowerCase();
  if (!CLICKABLE_SOURCE_LAYERS.has(layer)) return false;
  const name = featureDisplayName(properties);
  if (!name) return false;
  if (layer === "landuse") {
    return CLICKABLE_LANDUSE.test(String(properties.class || properties.landuse || ""));
  }
  return true;
}
