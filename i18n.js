/* WAY●MARK — interface localization (ru / en).
 * The app is written in Russian; this module translates the visible interface
 * strings and restores them when Russian is selected again. City names,
 * descriptions and other catalogue data are not translated: they only exist
 * in Russian in CITY_DATA.
 */

const EN = {
  // Navigation and shell
  "Мои путешествия": "My trips",
  "Моё путешествие": "My trip",
  "Удиви меня": "Surprise me",
  "Карта": "Map",
  "Поиск города": "Search city",
  "Открыть меню": "Open menu",
  "Закрыть меню": "Close menu",
  "Основная навигация": "Main navigation",
  "Вернуться к карте": "Back to the map",
  "Закрыть": "Close",
  "Назад к путешествию": "Back to the trip",
  "Подробности": "Details",
  "Подробности о городе": "About the city",
  "Подробности о маршруте": "Route details",
  "Избранное": "Favorites",
  "Загрузка WAYMARK": "Loading WAYMARK",
  "Загрузка мира…": "Loading the world…",
  "Интерактивный глобус Waymark": "Waymark interactive globe",

  // Globe panels
  "Выберите место отправления": "Choose a departure place",
  "Выберите место, куда отправиться": "Choose where to go",
  "Выбор транспорта": "Transport choice",
  "Маршрут": "Route",
  "Сбросить маршрут": "Reset route",
  "Добавьте место в маршрут": "Add a place to the route",
  "Добавить в маршрут": "Add to route",
  "В маршруте ✓": "In route ✓",
  "Добавить в мои маршруты": "Save to my routes",
  "Добавлено в маршрут": "Added to route",
  "Убрать из маршрута": "Remove from route",
  "Место убрано из маршрута": "Place removed from the route",
  "Маршрут сброшен": "Route reset",
  "Это место уже в маршруте": "This place is already in the route",
  "Выберите как минимум два места": "Choose at least two places",
  "Сохранить в «Мои путешествия»": "Save to my trips",
  "Начать новое путешествие": "Start a new trip",
  "Продолжить путешествие": "Continue the trip",
  "Завершить путешествие": "Finish the trip",
  "Путешествие завершено": "Trip finished",
  "Путешествие сохранено в «Моих путешествиях»": "Trip saved to my trips",
  "Начато новое путешествие": "A new trip started",
  "Мои маршруты": "My routes",
  "Маршрут по городу": "Route in the city",
  "Мой маршрут": "My route",
  "Добавлено в мои маршруты": "Saved to my routes",

  // City card
  "Исследовать город": "Explore the city",
  "Подробнее о городе": "More about the city",
  "Местное время": "Local time",
  "Страна": "Country",
  "Язык": "Language",
  "Валюта": "Currency",
  "Погода": "Weather",
  "Климат": "Climate",
  "Лучшее время": "Best time",
  "Кухня": "Cuisine",
  "О городе": "About the city",
  "Популярные места": "Popular places",
  "Популярные достопримечательности": "Popular attractions",
  "Список популярных мест пока пуст.": "The list of popular places is empty for now.",

  // City explorer
  "Глобус": "Globe",
  "Вернуться к глобусу": "Back to the globe",
  "РЕЖИМ ИССЛЕДОВАНИЯ": "EXPLORATION MODE",
  "Векторная карта": "Vector map",
  "Векторная карта города": "City vector map",
  "Выберите места на карте": "Choose places on the map",
  "Найти место в городе": "Find a place in the city",
  "Поиск мест": "Place search",
  "Поиск места в городе": "Place search in the city",
  "Результаты поиска": "Search results",
  "Разделы города": "City sections",
  "Режим отображения карты": "Map view mode",
  "Загружаем места…": "Loading places…",
  "Подключаем карту и загружаем места…": "Connecting the map and loading places…",
  "Загрузка векторной карты продолжается…": "The vector map is still loading…",
  "Не удалось загрузить векторную карту.": "The vector map could not be loaded.",
  "Не удалось загрузить векторную карту. Проверьте подключение к интернету.": "The vector map could not be loaded. Check your internet connection.",
  "Не удалось загрузить места. Попробуйте позже.": "Places could not be loaded. Try again later.",
  "Для этого района пока не нашлись подписанные места.": "No named places were found in this area yet.",
  "Ищем места в этом городе…": "Searching places in this city…",
  "Ничего не найдено. Попробуйте другое название.": "Nothing found. Try another name.",
  "Ничего не найдено в загруженных данных этого города. Попробуйте другое название или категорию.": "Nothing found in the loaded data for this city. Try another name or category.",
  "Введите название места для поиска": "Enter a place name to search",
  "Информация о месте": "Place information",
  "Выбранное место": "Selected place",
  "Место на карте": "Place on the map",
  "Город": "City",
  "Исследование города": "City exploration",
  "Место": "Place",
  "Здание": "Building",
  "Адрес": "Address",
  "Краткая информация": "Quick facts",
  "О месте": "About the place",
  "Часы работы": "Opening hours",
  "Телефон": "Phone",
  "Сайт": "Website",
  "Вход": "Admission",
  "Платный": "Paid",
  "Бесплатный": "Free",
  "Построено": "Built",
  "Закрыть информацию": "Close information",
  "Вернуться к маршруту": "Back to the route",
  "Пока пусто. Откройте место на карте и нажмите «Добавить в маршрут».": "Empty for now. Open a place on the map and press “Add to route”.",
  "Пока нет сохранённых маршрутов. Соберите места на карте и нажмите «Добавить в мои маршруты».": "No saved routes yet. Collect places on the map and press “Save to my routes”.",
  "В сохранённом маршруте недостаточно мест.": "The saved route has too few places.",
  "Город этого маршрута недоступен.": "The city of this route is unavailable.",
  "Не удалось сохранить маршрут в этом браузере.": "The route could not be saved in this browser.",
  "СОХРАНЕНО": "SAVED",
  "О ГОРОДЕ": "ABOUT THE CITY",

  // Route themes
  "История": "History",
  "Музеи": "Museums",
  "Парки": "Parks",
  "Панорамы": "Views",
  "Главное": "Highlights",
  "Рядом": "Nearby",
  "Старый город и памятники": "Old town and monuments",
  "Коллекции и галереи": "Collections and galleries",
  "Зелень и прогулки": "Greenery and walks",
  "Смотровые площадки": "Observation decks",
  "Самое заметное в городе": "The city’s highlights",
  "Ближе к центру": "Closer to the centre",
  "Выберите тему — соберём маршрут по интересным местам города.": "Pick a theme — we will build a route through the city’s interesting places.",
  "Составить маршрут": "Build the route",
  "Для этой темы пока нет мест. Выберите другую.": "There are no places for this theme yet. Pick another one.",
  "Маршрут по интересам": "Route by interest",
  "Места ещё загружаются — кнопка станет активной через несколько секунд.": "Places are still loading — the button will become active in a few seconds.",

  // Categories
  "Достопримечательность": "Attraction",
  "Музей": "Museum",
  "Смотровая площадка": "Viewpoint",
  "Ресторан": "Restaurant",
  "Кафе": "Cafe",
  "Парк": "Park",
  "Отель": "Hotel",
  "Транспорт": "Transport",
  "Магазин": "Shop",
  "Офис": "Office",
  "Госучреждение": "Government office",
  "Услуги": "Services",
  "Галерея": "Gallery",
  "Памятник": "Monument",
  "Мемориал": "Memorial",
  "Сад": "Garden",
  "Детская площадка": "Playground",
  "Спортивный центр": "Sports centre",
  "Фитнес-клуб": "Fitness club",
  "Супермаркет": "Supermarket",
  "Магазин у дома": "Convenience store",
  "Пекарня": "Bakery",
  "Аптека": "Pharmacy",
  "Магазин одежды": "Clothing store",
  "Обувной магазин": "Shoe store",
  "Книжный магазин": "Bookstore",
  "Универмаг": "Department store",
  "Торговый центр": "Shopping mall",
  "Постамат": "Parcel locker",
  "Почтовое отделение": "Post office",
  "Пункт выдачи заказов": "Pick-up point",
  "Банк": "Bank",
  "Банкомат": "ATM",
  "Автозаправка": "Petrol station",
  "Автомастерская": "Car repair",
  "Медицинский кабинет": "Doctor’s office",
  "Клиника": "Clinic",
  "Больница": "Hospital",
  "Стоматология": "Dentistry",
  "Школа": "School",
  "Детский сад": "Kindergarten",
  "Библиотека": "Library",
  "Полиция": "Police",
  "Администрация": "City hall",
  "Остановка": "Bus stop",
  "Автовокзал": "Bus station",
  "Железнодорожная станция": "Railway station",
  "Вход в метро": "Metro entrance",
  "Парковка": "Parking",
  "Общественный туалет": "Public toilet",
  "Офис компании": "Company office",
  "Государственное учреждение": "Government office",
  "Объект обслуживания": "Service point",
  "Хостел": "Hostel",
  "Гостевой дом": "Guest house",
  "Бар": "Bar",
  "Паб": "Pub",
  "Быстрое питание": "Fast food",

  // Surprise
  "Выбор параметров путешествия": "Trip settings",
  "Готовые шаблоны": "Ready-made templates",
  "Подробный выбор": "Detailed settings",
  "Настройте маршрут под свои предпочтения": "Tune the route to your preferences",
  "Случайный маршрут": "Random route",
  "Экономичный маршрут": "Budget route",
  "Тёплый климат": "Warm climate",
  "Культурный маршрут": "Culture route",
  "Мировые мегаполисы": "World megacities",
  "Гастрономический маршрут": "Food route",
  "Неожиданная подборка городов": "An unexpected city mix",
  "Меньше расстояний и затрат": "Shorter distances, lower cost",
  "Солнце и мягкий климат": "Sun and a mild climate",
  "История, искусство и архитектура": "History, art and architecture",
  "Главные мировые мегаполисы": "The world’s major cities",
  "Кухни и вкусы разных стран": "Cuisines from different countries",
  "Неожиданная последовательность городов с учётом выбранных параметров.": "An unexpected sequence of cities based on your settings.",
  "Маршрут с акцентом на более доступные переезды и компактную географию.": "A route focused on affordable transfers and compact geography.",
  "Подборка городов с тёплой погодой и подходящим климатом для отдыха.": "Cities with warm weather and a comfortable climate.",
  "Города, где маршрут сосредоточен на культуре и популярных достопримечательностях.":
    "Cities where the route focuses on culture and popular attractions.",
  "Самые известные и крупные города из базы WAY●MARK.": "The most famous and largest cities in the WAY●MARK catalogue.",
  "Маршрут через города с ярко выраженной местной кухней.": "A route through cities with a strong local cuisine.",
  "Климат": "Climate",
  "Бюджет": "Budget",
  "Количество городов": "Number of cities",
  "Время года": "Season",
  "Темп путешествия": "Trip pace",
  "Продолжительность": "Duration",
  "Известность городов": "City popularity",
  "Любой климат": "Any climate",
  "Тропический": "Tropical",
  "Субтропический": "Subtropical",
  "Средиземноморский": "Mediterranean",
  "Умеренный": "Temperate",
  "Холодный": "Cold",
  "Пустынный": "Desert",
  "Без ограничений": "No limits",
  "Без ограничения": "No limit",
  "До 50 тыс. ₽": "Up to ₽50k",
  "50–100 тыс. ₽": "₽50–100k",
  "100–200 тыс. ₽": "₽100–200k",
  "Более 200 тыс. ₽": "Over ₽200k",
  "2 города": "2 cities",
  "3 города": "3 cities",
  "4 города": "4 cities",
  "5 городов": "5 cities",
  "Любое время": "Any time",
  "Весна": "Spring",
  "Лето": "Summer",
  "Осень": "Autumn",
  "Зима": "Winter",
  "Сбалансированный": "Balanced",
  "Динамичный": "Dynamic",
  "Неторопливый": "Relaxed",
  "До 12 часов": "Up to 12 hours",
  "12–24 часа": "12–24 hours",
  "24–48 часов": "24–48 hours",
  "Более 48 часов": "Over 48 hours",
  "Любой доступный": "Any available",
  "✈ Самолёт": "✈ Plane",
  "🚆 Поезд": "🚆 Train",
  "🚗 Автомобиль": "🚗 Car",
  "🚌 Автобус": "🚌 Bus",
  "🚢 Корабль": "🚢 Ship",
  "Смешанный выбор": "Mixed selection",
  "Самые популярные": "Most popular",
  "Менее очевидные": "Less obvious",

  // Transport and money
  "Самолёт": "Plane",
  "Поезд": "Train",
  "Автомобиль": "Car",
  "Автобус": "Bus",
  "Корабль": "Ship",
  "Этот вид транспорта не используется для выбранного направления.": "This transport is not available for the selected direction.",
  "км": "km",
  "ч": "h",
  "мин": "min",
  "Российский рубль": "Russian ruble",
  "Доллар США": "US dollar",
  "Евро": "Euro",
  "Фунт стерлингов": "Pound sterling",
  "Швейцарский франк": "Swiss franc",
  "Японская иена": "Japanese yen",
  "Китайский юань": "Chinese yuan",
  "Турецкая лира": "Turkish lira",
  "Казахстанский тенге": "Kazakhstani tenge",
  "Грузинский лари": "Georgian lari",
  "Армянский драм": "Armenian dram",
  "Азербайджанский манат": "Azerbaijani manat",

  // Toasts and states
  "Дождитесь завершения построения маршрута.": "Wait until the route is built.",
  "Для нового маршрута начните новое путешествие.": "Start a new trip for a new route.",
  "Выберите транспорт для текущего маршрута.": "Choose transport for the current route.",
  "Достигнут лимит в 5 сегментов. Завершите путешествие или начните новое.":
    "The limit of 5 segments is reached. Finish the trip or start a new one.",
  "Не удалось подобрать маршрут.": "A route could not be selected.",
  "Не удалось подобрать транспорт для маршрута.": "Transport for the route could not be selected.",
  "Не удалось построить следующий сегмент. Маршрут сохранён до этой точки.":
    "The next segment could not be built. The route is saved up to this point.",
  "Маршрут составлен — путешествие готово.": "The route is ready — the trip is complete.",
  "Маршрут сохранён в «Мои маршруты»": "Route saved to “My routes”",
  "У этого города нет корректных координат для карты.": "This city has no valid coordinates for the map.",
  "Проверьте подключение к интернету. Для карты улиц используется внешний картографический сервис.":
    "Check your internet connection. The street map uses an external map service.",
  "Профиль города и его достопримечательности остаются в WAY●MARK, но для карты улиц требуется доступ к картографическому сервису.":
    "The city profile stays in WAY●MARK, but the street map needs access to the map service.",
  "Waymark готов к новому путешествию": "Waymark is ready for a new trip",

  // Settings
  "Недоступно": "Unavailable",
  "Для этого направления": "For this direction",
  "сегмент": "segment",
  "сегмента": "segments",
  "Здесь появятся ваши места": "Your places will appear here",
  "Здесь появятся сохранённые путешествия": "Saved trips will appear here",
  "Добавление избранных городов подключим отдельным этапом.": "Favourite cities will be added in a later step.",
  "Закончите путешествие и сохраните его — оно появится здесь.": "Finish a trip and save it — it will appear here.",
  "Краткое описание города появится позже.": "A short city description will appear later.",
  "Настройки": "Settings",
  "Тема": "Theme",
  "Системная": "System",
  "Светлая": "Light",
  "Тёмная": "Dark",
  "Оформление сайта и язык интерфейса.": "Site appearance and interface language."
};

// Strings with dynamic parts are translated by pattern.
const PATTERNS = [
  [/^Найдено мест: (\d+)$/, (m) => `${m[1]} places found`],
  [/^(\d+) мест на карте · OpenStreetMap$/, (m) => `${m[1]} places on the map · OpenStreetMap`],
  [/^(.+) выбрана как точка отправления$/, (m) => `${m[1]} selected as the departure point`],
  [/^(.+) выбрана как направление$/, (m) => `${m[1]} selected as the destination`],
  [/^(.+) выбрана как следующая точка$/, (m) => `${m[1]} selected as the next stop`],
  [/^(.+) — в маршруте$/, (m) => `${m[1]} — in the route`],
  [/^(.+) уже в маршруте$/, (m) => `${m[1]} is already in the route`],
  [/^Убрать (.+) из маршрута$/, (m) => `Remove ${m[1]} from the route`],
  [/^Переместить (.+) выше$/, (m) => `Move ${m[1]} up`],
  [/^Переместить (.+) ниже$/, (m) => `Move ${m[1]} down`],
  [/^Выберите следующую точку после (.+)$/, (m) => `Choose the next stop after ${m[1]}`],
  [/^Открыть подробности: (.+) → (.+)$/, (m) => `Open details: ${m[1]} → ${m[2]}`],
  [/^Открыть путешествие (.+)$/, (m) => `Open trip ${m[1]}`],
  [/^Составляем: (.+)$/, (m) => `Building: ${m[1]}`],
  [/^WAY●MARK составляет маршрут (\d+) \/ (\d+)$/, (m) => `WAY●MARK is building the route ${m[1]} / ${m[2]}`],
  [/^Маршрут «(.+)» готов: (\d+) мест$/, (m) => `Route “${m[1]}” is ready: ${m[2]} places`],
  [/^Маршрут «(.+)» открыт на карте$/, (m) => `Route “${m[1]}” is open on the map`],
  [/^Максимум мест в маршруте: (\d+)\. Уберите место, чтобы добавить новое\.$/, (m) => `Maximum places in the route: ${m[1]}. Remove a place to add another one.`],
  [/^(.+) · Векторная карта$/, (m) => `${m[1]} · Vector map`],
  [/^(\d+) сегмент(а|ов)? путешествия · все расчёты ориентировочные\.$/, (m) => `${m[1]} trip segments · all estimates are approximate.`],
  [/^Выберите место, куда отправиться$/, () => "Choose where to go"],
  [/^Загрузка (.+)$/, (m) => `Loading ${m[1]}`]
];

let language = "ru";
const textRecords = new WeakMap();
const attributeRecords = new WeakMap();
let applying = false;

export function getLanguage() {
  return language;
}

export function setLanguage(next) {
  language = next === "en" ? "en" : "ru";
  document.documentElement.lang = language;
}

export function translate(text) {
  const value = String(text ?? "");
  if (language === "ru" || !value) return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (EN[trimmed]) return value.replace(trimmed, EN[trimmed]);
  for (const [pattern, build] of PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) return value.replace(trimmed, build(match));
  }
  return value;
}

function isGlobeLabel(node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  return Boolean(element?.closest?.("#city-labels, #country-labels"));
}

function translateTextNode(node) {
  if (isGlobeLabel(node)) return;
  const current = node.nodeValue;
  if (!current || !/\p{L}/u.test(current)) return;
  const record = textRecords.get(node);

  if (language === "ru") {
    if (record) node.nodeValue = record.source;
    return;
  }

  // If the app replaced the text after the last translation, the new text is a
  // fresh Russian source; otherwise reuse the stored source.
  const source = record && current === record.translated ? record.source : current;
  const translated = translate(source);
  textRecords.set(node, { source, translated });
  if (translated !== source && translated !== current) node.nodeValue = translated;
}

const ATTRIBUTES = ["placeholder", "aria-label", "title", "alt"];

function translateAttributes(element) {
  if (!element?.getAttribute || isGlobeLabel(element)) return;
  let store = attributeRecords.get(element);
  if (!store) {
    store = new Map();
    attributeRecords.set(element, store);
  }
  for (const name of ATTRIBUTES) {
    const value = element.getAttribute(name);
    if (!value) continue;
    const record = store.get(name);

    if (language === "ru") {
      if (record) element.setAttribute(name, record.source);
      continue;
    }

    const source = record && value === record.translated ? record.source : value;
    const translated = translate(source);
    store.set(name, { source, translated });
    if (translated !== source && translated !== value) element.setAttribute(name, translated);
  }
}

export function applyI18n(root = document.body) {
  if (!root) return;
  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root);
    return;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) translateTextNode(node);

  if (root.nodeType === Node.ELEMENT_NODE) translateAttributes(root);
  const elements = root.querySelectorAll ? root.querySelectorAll("[placeholder], [aria-label], [title], [alt]") : [];
  for (const element of elements) translateAttributes(element);
}

let observer = null;

export function startI18nObserver() {
  if (observer || typeof MutationObserver === "undefined") return;
  observer = new MutationObserver((records) => {
    if (language === "ru" || applying) return;
    applying = true;
    try {
      for (const record of records) {
        if (record.type === "characterData") {
          translateTextNode(record.target);
        } else {
          for (const node of record.addedNodes) {
            if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
            else if (node.nodeType === Node.ELEMENT_NODE) applyI18n(node);
          }
        }
      }
    } finally {
      applying = false;
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}
