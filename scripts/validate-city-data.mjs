#!/usr/bin/env node
/**
 * Structural regression check for the legacy CITY_DATA catalog.
 * Run from any directory: node scripts/validate-city-data.mjs
 * This checks structure and consistency, not factual accuracy of content.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const catalogPath = resolve(here, '..', 'city-data.js');
const source = await readFile(catalogPath, 'utf8');

let CITY_DATA;
try {
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
  ({ CITY_DATA } = await import(moduleUrl));
} catch (error) {
  console.error(`ОШИБКА: не удалось разобрать city-data.js: ${error.message}`);
  process.exit(1);
}

if (!Array.isArray(CITY_DATA)) {
  console.error('ОШИБКА: CITY_DATA должен быть массивом.');
  process.exit(1);
}

const errors = [];
const ids = new Set();
const coordinateOwners = new Map();
const required = ['id', 'name', 'country', 'flag', 'timezone', 'currency', 'language', 'description', 'climate', 'cuisine', 'bestTime'];

for (const [index, city] of CITY_DATA.entries()) {
  const label = city?.id || city?.name || `запись №${index + 1}`;
  for (const field of required) {
    if (city?.[field] === undefined || city?.[field] === null || city?.[field] === '') {
      errors.push(`${label}: отсутствует обязательное поле "${field}"`);
    }
  }

  if (typeof city?.id !== 'string' || !city.id.trim()) {
    errors.push(`${label}: id должен быть непустой строкой`);
  } else if (ids.has(city.id)) {
    errors.push(`${label}: дублирующийся id "${city.id}"`);
  } else {
    ids.add(city.id);
  }

  if (typeof city?.lat !== 'number' || !Number.isFinite(city.lat) || city.lat < -90 || city.lat > 90) {
    errors.push(`${label}: некорректная широта lat`);
  }
  if (typeof city?.lon !== 'number' || !Number.isFinite(city.lon) || city.lon < -180 || city.lon > 180) {
    errors.push(`${label}: некорректная долгота lon`);
  }

  if (Number.isFinite(city?.lat) && Number.isFinite(city?.lon)) {
    const key = `${city.lat.toFixed(4)}|${city.lon.toFixed(4)}`;
    if (coordinateOwners.has(key)) {
      errors.push(`${label}: координаты совпадают с городом "${coordinateOwners.get(key)}" (${key})`);
    } else {
      coordinateOwners.set(key, label);
    }
  }

  if (!Number.isFinite(city?.popularity) || city.popularity < 0 || city.popularity > 100) {
    errors.push(`${label}: popularity должен быть числом от 0 до 100`);
  }

  if (!Array.isArray(city?.attractions) || city.attractions.length < 6) {
    errors.push(`${label}: нужно не менее 6 достопримечательностей`);
  } else {
    city.attractions.forEach((attraction, attractionIndex) => {
      const validLegacyTuple = Array.isArray(attraction) && typeof attraction[0] === 'string' && attraction[0].trim() && typeof attraction[1] === 'string';
      const validObject = attraction && typeof attraction === 'object' && typeof attraction.name === 'string' && attraction.name.trim();
      if (!validLegacyTuple && !validObject) {
        errors.push(`${label}: некорректная достопримечательность №${attractionIndex + 1}`);
      }
    });
  }

  if (!city?.weather || typeof city.weather.temp !== 'number' || typeof city.weather.condition !== 'string' || !city.weather.condition.trim()) {
    errors.push(`${label}: неполные погодные поля текущего формата`);
  }
}

const countryCount = new Set(CITY_DATA.map(city => city.country).filter(Boolean)).size;
console.log(`WAY●MARK: проверено городов — ${CITY_DATA.length}; значений country — ${countryCount}.`);

if (errors.length) {
  console.error(`Найдено ошибок: ${errors.length}`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Ошибок структуры не найдено.');
console.log('Примечание: проверка не подтверждает фактическую достоверность описаний, координат, погодных или туристических сведений.');
