/* WAY●MARK transport catalog — data and route availability only.
 * Keep this file focused on real direct connections. Plane is handled as a universal route in UI logic.
 */

function makePairKey(a, b) {
  return [a, b].sort().join("|");
}

const TRANSPORT_CONNECTIONS = {
  train: new Set([
    ["moscow", "saint-petersburg"],
    ["paris", "london"], ["paris", "amsterdam"], ["paris", "berlin"],
    ["paris", "barcelona"], ["paris", "madrid"], ["paris", "rome"],
    ["london", "amsterdam"], ["london", "paris"],
    ["amsterdam", "berlin"], ["amsterdam", "prague"],
    ["berlin", "prague"], ["berlin", "vienna"], ["berlin", "amsterdam"],
    ["prague", "vienna"], ["prague", "rome"],
    ["barcelona", "madrid"], ["barcelona", "paris"],
    ["rome", "madrid"], ["rome", "barcelona"], ["rome", "paris"],
    ["tokyo", "osaka"]
  ].map(([a, b]) => makePairKey(a, b))),

  car: new Set([
    ["moscow", "saint-petersburg"],
    ["paris", "london"], ["paris", "amsterdam"], ["paris", "berlin"],
    ["paris", "barcelona"], ["paris", "madrid"], ["paris", "rome"],
    ["london", "amsterdam"], ["amsterdam", "berlin"], ["amsterdam", "prague"],
    ["berlin", "prague"], ["berlin", "vienna"], ["prague", "vienna"],
    ["barcelona", "madrid"], ["barcelona", "rome"], ["madrid", "rome"],
    ["tokyo", "osaka"], ["rio", "buenos-aires"], ["miami", "new-york"],
    ["toronto", "new-york"]
  ].map(([a, b]) => makePairKey(a, b))),

  bus: new Set([
    ["moscow", "saint-petersburg"],
    ["paris", "london"], ["paris", "amsterdam"], ["paris", "berlin"],
    ["paris", "barcelona"], ["paris", "madrid"],
    ["london", "amsterdam"], ["amsterdam", "berlin"], ["amsterdam", "prague"],
    ["berlin", "prague"], ["berlin", "vienna"], ["prague", "vienna"],
    ["barcelona", "madrid"], ["rome", "barcelona"], ["rome", "madrid"],
    ["tokyo", "osaka"], ["rio", "buenos-aires"], ["miami", "new-york"],
    ["toronto", "new-york"]
  ].map(([a, b]) => makePairKey(a, b))),

  ship: new Set([
    ["london", "paris"],
    ["london", "amsterdam"],
    ["barcelona", "rome"],
    ["miami", "new-york"],
    ["rio", "buenos-aires"],
    ["cairo", "istanbul"],
    ["cairo", "dubai"]
  ].map(([a, b]) => makePairKey(a, b)))
};

function hasPairConnection(set, origin, destination) {
  return set.has(makePairKey(origin.id, destination.id));
}


// Scalable fallback transport rules for the expanded 215-city catalog.
// Exact curated connections above remain the first source of truth. The fallback
// adds plausible regional land transport without creating cross-continental rail claims.
const COUNTRY_NEIGHBORS = new Set([
  ["Франция","Бельгия"],["Франция","Германия"],["Франция","Испания"],["Франция","Швейцария"],["Франция","Италия"],
  ["Бельгия","Германия"],["Бельгия","Нидерланды"],["Германия","Нидерланды"],["Германия","Швейцария"],["Германия","Австрия"],["Германия","Польша"],["Германия","Чехия"],["Германия","Дания"],
  ["Нидерланды","Бельгия"],["Нидерланды","Германия"],["Нидерланды","Польша"],["Испания","Португалия"],["Испания","Андорра"],["Испания","Франция"],
  ["Италия","Франция"],["Италия","Швейцария"],["Италия","Австрия"],["Италия","Словения"],["Австрия","Чехия"],["Австрия","Словения"],["Австрия","Венгрия"],["Австрия","Словакия"],
  ["Швейцария","Италия"],["Швейцария","Австрия"],["Швейцария","Германия"],["Швейцария","Франция"],
  ["Польша","Германия"],["Польша","Чехия"],["Польша","Словакия"],["Польша","Литва"],["Чехия","Германия"],["Чехия","Польша"],["Чехия","Австрия"],["Чехия","Словакия"],
  ["Словакия","Австрия"],["Словакия","Чехия"],["Словакия","Польша"],["Словакия","Венгрия"],["Венгрия","Австрия"],["Венгрия","Словакия"],["Венгрия","Хорватия"],["Венгрия","Сербия"],["Венгрия","Румыния"],
  ["Хорватия","Словения"],["Хорватия","Венгрия"],["Хорватия","Босния и Герцеговина"],["Словения","Италия"],["Словения","Австрия"],["Словения","Хорватия"],["Сербия","Венгрия"],["Сербия","Хорватия"],["Сербия","Босния и Герцеговина"],["Сербия","Румыния"],["Сербия","Болгария"],
  ["Румыния","Болгария"],["Румыния","Венгрия"],["Болгария","Греция"],["Болгария","Турция"],["Греция","Турция"],
  ["Эстония","Латвия"],["Латвия","Литва"],["Литва","Польша"],["Финляндия","Швеция"],["Швеция","Норвегия"],["Швеция","Дания"],["Норвегия","Дания"],
  ["Индия","Непал"],["Индия","Бангладеш"],["Индия","Пакистан"],["Индия","Шри-Ланка"],["Китай","Непал"],["Китай","Вьетнам"],["Китай","Мьянма"],["Китай","Казахстан"],
  ["Вьетнам","Камбоджа"],["Камбоджа","Лаос"],["Таиланд","Камбоджа"],["Малайзия","Таиланд"],["Малайзия","Сингапур"],["Индонезия","Малайзия"],
  ["Пакистан","Иран"],["Иран","Армения"],["Иран","Азербайджан"],["Иран","Туркменистан"],["Армения","Грузия"],["Грузия","Азербайджан"],["Грузия","Турция"],["Азербайджан","Грузия"],["Азербайджан","Иран"],
  ["Израиль","Иордания"],["Иордания","Саудовская Аравия"],["ОАЭ","Оман"],["ОАЭ","Саудовская Аравия"],["Катар","Саудовская Аравия"],["Бахрейн","Саудовская Аравия"],["Кувейт","Саудовская Аравия"],
  ["США","Канада"],["США","Мексика"],["Гватемала","Мексика"],["Гватемала","Белиз"],["Панама","Коста-Рика"],["Колумбия","Панама"],
  ["Чили","Перу"],["Перу","Боливия"],["Боливия","Парагвай"],["Бразилия","Парагвай"],["Бразилия","Уругвай"],["Бразилия","Перу"],["Аргентина","Уругвай"],["Аргентина","Парагвай"],["Эквадор","Перу"],["Колумбия","Эквадор"],
  ["ЮАР","Намибия"],["ЮАР","Мозамбик"],["ЮАР","Ботсвана"],["Кения","Танзания"],["Уганда","Кения"],["Руанда","Уганда"],["Танзания","Кения"],["Танзания","Мозамбик"],["Марокко","Алжир"],["Марокко","Тунис"],["Нигерия","Гана"]
].map(([a,b]) => makePairKey(a,b)));

function isSameOrNeighborCountry(origin, destination) {
  if (origin.country === destination.country) return true;
  return COUNTRY_NEIGHBORS.has(makePairKey(origin.country, destination.country));
}

function scalableLandConnection(origin, destination, distance, maxDistanceKm) {
  return isSameOrNeighborCountry(origin, destination) && distance <= maxDistanceKm;
}


const TRANSPORT_DEFINITIONS = [
  {
    id: "plane",
    icon: "✈️",
    name: "Самолёт",
    note: "Самый быстрый",
    description: "Прямой воздушный маршрут с минимальным временем в пути.",
    speed: 780,
    overhead: 0.8,
    pricePerKm: 9.5,
    availability: ({ origin, destination }) => origin.id !== destination.id
  },
  {
    id: "train",
    icon: "🚆",
    name: "Поезд",
    note: "Комфортнее",
    description: "Наземный маршрут с удобным темпом поездки и меньшей скоростью.",
    speed: 82,
    overhead: 1.6,
    pricePerKm: 6.2,
    availability: ({ origin, destination, distance }) => hasPairConnection(TRANSPORT_CONNECTIONS.train, origin, destination) || scalableLandConnection(origin, destination, distance, 900)
  },
  {
    id: "car",
    icon: "🚗",
    name: "Автомобиль",
    note: "Гибче",
    description: "Гибкий дорожный маршрут без обязательных пересадок.",
    speed: 82,
    overhead: 0.7,
    pricePerKm: 5.0,
    availability: ({ origin, destination, distance }) => hasPairConnection(TRANSPORT_CONNECTIONS.car, origin, destination) || scalableLandConnection(origin, destination, distance, 1600)
  },
  {
    id: "bus",
    icon: "🚌",
    name: "Автобус",
    note: "Выгоднее",
    description: "Более бюджетный наземный вариант, обычно с самым долгим временем пути.",
    speed: 64,
    overhead: 1.8,
    pricePerKm: 4.2,
    availability: ({ origin, destination, distance }) => hasPairConnection(TRANSPORT_CONNECTIONS.bus, origin, destination) || scalableLandConnection(origin, destination, distance, 1200)
  },
  {
    id: "ship",
    icon: "🚢",
    name: "Корабль",
    note: "Неторопливо",
    description: "Морской вариант подходит только для части прибрежных направлений.",
    speed: 34,
    overhead: 8,
    pricePerKm: 7.3,
    availability: ({ origin, destination }) => hasPairConnection(TRANSPORT_CONNECTIONS.ship, origin, destination)
  }
];

export { makePairKey, TRANSPORT_CONNECTIONS, TRANSPORT_DEFINITIONS };
