// === DOM refs ===
const locationInput = document.getElementById('locationInput');
const searchButton = document.getElementById('searchButton');
const locationElement = document.getElementById('location');
const temperatureElement = document.getElementById('temperature');
const descriptionElement = document.getElementById('description');

// === Storage keys ===
const STORAGE = {
  RAW: 'wx:lastRaw',
  LAT: 'wx:lastLat',
  LON: 'wx:lastLon',
  DISPLAY: 'wx:lastDisplay',
};

// === State abbreviations ===
const US_STATE_TO_ABBR = {
  "Alabama":"AL","Alaska":"AK","Arizona":"AZ","Arkansas":"AR","California":"CA","Colorado":"CO","Connecticut":"CT","Delaware":"DE","Florida":"FL","Georgia":"GA",
  "Hawaii":"HI","Idaho":"ID","Illinois":"IL","Indiana":"IN","Iowa":"IA","Kansas":"KS","Kentucky":"KY","Louisiana":"LA","Maine":"ME","Maryland":"MD",
  "Massachusetts":"MA","Michigan":"MI","Minnesota":"MN","Mississippi":"MS","Missouri":"MO","Montana":"MT","Nebraska":"NE","Nevada":"NV","New Hampshire":"NH",
  "New Jersey":"NJ","New Mexico":"NM","New York":"NY","North Carolina":"NC","North Dakota":"ND","Ohio":"OH","Oklahoma":"OK","Oregon":"OR","Pennsylvania":"PA",
  "Rhode Island":"RI","South Carolina":"SC","South Dakota":"SD","Tennessee":"TN","Texas":"TX","Utah":"UT","Vermont":"VT","Virginia":"VA","Washington":"WA",
  "West Virginia":"WV","Wisconsin":"WI","Wyoming":"WY","District of Columbia":"DC"
};
function toUSAbbr(nameOrAbbr) {
  if (!nameOrAbbr) return "";
  if (nameOrAbbr.length <= 3 && nameOrAbbr.toUpperCase() === nameOrAbbr) return nameOrAbbr; // already "NH", "NY"
  return US_STATE_TO_ABBR[nameOrAbbr] || nameOrAbbr;
}

// === Weather code map (Open-Meteo) ===
const weatherCodes = {
  0:  { icon: '0.png',  label: 'Clear sky' },
  1:  { icon: '2.png',  label: 'Mainly Clear' },
  2:  { icon: '2.png',  label: 'Partly cloudy' },
  3:  { icon: '3.png',  label: 'Overcast' },
  45: { icon: '0.png',  label: 'Fog' },
  48: { icon: '0.png',  label: 'Depositing rime fog' },
  51: { icon: '0.png',  label: 'Light drizzle' },
  53: { icon: '0.png',  label: 'Moderate drizzle' },
  55: { icon: '0.png',  label: 'Dense drizzle' },
  56: { icon: '0.png',  label: 'Light freezing drizzle' },
  57: { icon: '0.png',  label: 'Dense freezing drizzle' },
  61: { icon: '61.png', label: 'Slight rain' },
  63: { icon: '61.png', label: 'Moderate rain' },
  65: { icon: '65.png', label: 'Heavy rain' },
  66: { icon: '65.png', label: 'Light freezing rain' },
  67: { icon: '65.png', label: 'Heavy freezing rain' },
  71: { icon: '71.png', label: 'Slight snow' },
  73: { icon: '73.png', label: 'Moderate snow' },
  75: { icon: '73.png', label: 'Heavy snow' },
  77: { icon: '73.png', label: 'Snow grains' },
  80: { icon: '73.png', label: 'Slight rain showers' },
  81: { icon: '73.png', label: 'Moderate rain showers' },
  82: { icon: '73.png', label: 'Violent rain showers' },
  85: { icon: '73.png', label: 'Slight snow showers' },
  86: { icon: '73.png', label: 'Heavy snow showers' },
  95: { icon: '95.png', label: 'Thunderstorm' },
  96: { icon: '95.png', label: 'Thunderstorm with slight hail' },
  99: { icon: '95.png', label: 'Thunderstorm with heavy hail' }
};

// === Events ===
searchButton.addEventListener('click', handleSearch);
locationInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSearch(); });

// === Parse "City, State" OR "City State" OR "City" ===
function parseLocation(raw) {
  const parts = raw.split(/[\s,]+/).filter(Boolean);
  if (parts.length === 0) return { city: '', state: '' };
  if (parts.length === 1) return { city: parts[0], state: '' };
  const state = parts[parts.length - 1];
  const city = parts.slice(0, -1).join(' ');
  return { city, state };
}

function handleSearch() {
  const rawInput = locationInput.value.trim();
  if (!rawInput) return;

  setSearchingUI();
  const { city, state } = parseLocation(rawInput);

  // Save raw immediately
  localStorage.setItem(STORAGE.RAW, rawInput);

  fetchCoordinates(city, state, { rawInput });
}

// === Geocoding ===
function fetchCoordinates(city, state, meta = {}) {
  const base = 'https://geocoding-api.open-meteo.com/v1/search';
  const params = new URLSearchParams({
    name: city || '',
    country: 'US',
    count: '8'
  });
  if (state) params.set('state', state);

  fetch(`${base}?${params.toString()}`)
    .then(r => r.json())
    .then(data => {
      const results = (data && data.results) ? data.results : [];

      if (results.length === 0) {
        showNotFound();
        return;
      }

      // If user provided a state (NH / New Hampshire), prefer exact state matches
      let filtered = results;
      if (state) {
        const inputStateLower = state.toLowerCase();
        filtered = results.filter(p => {
          const st = (p.state || p.admin1 || p.admin1_code || '').toLowerCase();
          // match "NH" or "New Hampshire"
          return st === inputStateLower || toUSAbbr(st).toLowerCase() === inputStateLower || toUSAbbr(state).toLowerCase() === toUSAbbr(st).toLowerCase();
        });
        if (filtered.length === 0) filtered = results; // fall back to all if no exact match
      }

      // If only one plausible result, use it directly
      if (filtered.length === 1) {
        choosePlace(filtered[0]);
        return;
      }

      // Otherwise, show a chooser list
      showGeocodeCandidates(filtered);
      // Optional: also show all candidates if filtered got too narrow
      // showGeocodeCandidates(filtered.length ? filtered : results);
    })
    .catch(err => {
      console.error('Error fetching coordinates:', err);
      showFindError();
    });
}


// === Weather fetch (current + daily + hourly) ===
function fetchWeather(lat, lon) {
  const weatherUrl =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current_weather=true` +
    `&daily=temperature_2m_max,temperature_2m_min,weathercode` +
    `&hourly=temperature_2m,weathercode,precipitation_probability,precipitation,relativehumidity_2m,windspeed_10m` +
    `&temperature_unit=fahrenheit` +
    `&forecast_days=10` +
    `&timezone=auto`;

  fetch(weatherUrl)
  .then(r => r.json())
  .then(data => {
    // Current
    const current = data.current_weather;
    if (current) {
      temperatureElement.textContent = `${Math.round(current.temperature)}°F`;
      const currentWeather = weatherCodes[current.weathercode] || { label: 'Unknown conditions', icon: 'unknown.png' };
      const iconUrl = `icons/${currentWeather.icon}`;
      descriptionElement.innerHTML = `
        <img src="${iconUrl}" alt="${currentWeather.label}" class="weather-icon">
        ${currentWeather.label}
      `;

      
      setBackgroundVideo(current.weathercode);

    } else {
      temperatureElement.textContent = '';
      descriptionElement.textContent = '';
    }

    // Forecasts
    displayForecast(data.daily);
    displayHourly(data.hourly);
  })
  .catch(err => {
    console.error('Error fetching weather data:', err);
    temperatureElement.textContent = '';
    descriptionElement.textContent = 'Error loading weather';
    clearForecastAndHourly();
  });
}

// === UI Helpers ===
function setSearchingUI() {
  locationElement.textContent = 'Searching…';
  temperatureElement.textContent = '';
  descriptionElement.textContent = '';
  clearForecastAndHourly();
}

function updateHeader(display) {
  locationElement.textContent = display || '';
}

function showNotFound() {
  locationElement.textContent = 'Location not found';
  temperatureElement.textContent = '';
  descriptionElement.textContent = '';
  clearForecastAndHourly();
}

function showFindError() {
  locationElement.textContent = 'Error finding location';
  clearForecastAndHourly();
}

function clearForecastAndHourly() {
  const forecastContainer = document.getElementById('forecast');
  const hourlyContainer = document.getElementById('hourly');
  if (forecastContainer) forecastContainer.innerHTML = '';
  if (hourlyContainer) hourlyContainer.innerHTML = '';
}

// === Persistence ===
function saveLastLocation({ raw, lat, lon, display }) {
  try {
    if (raw) localStorage.setItem(STORAGE.RAW, raw);
    if (typeof lat === 'number') localStorage.setItem(STORAGE.LAT, String(lat));
    if (typeof lon === 'number') localStorage.setItem(STORAGE.LON, String(lon));
    if (display) localStorage.setItem(STORAGE.DISPLAY, display);
    // keep the input box in sync with what the user searched
    if (raw) locationInput.value = raw;
  } catch (e) {
    console.warn('Local storage not available:', e);
  }
}

function loadLastLocation() {
  try {
    const lat = parseFloat(localStorage.getItem(STORAGE.LAT));
    const lon = parseFloat(localStorage.getItem(STORAGE.LON));
    const display = localStorage.getItem(STORAGE.DISPLAY);
    const raw = localStorage.getItem(STORAGE.RAW);

    if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
      if (raw) locationInput.value = raw;
      updateHeader(display || '');
      fetchWeather(lat, lon);
      return true;
    }

    // Fallback: if only raw exists, re-geocode it
    if (raw) {
      locationInput.value = raw;
      const { city, state } = parseLocation(raw);
      setSearchingUI();
      fetchCoordinates(city, state, { rawInput: raw });
      return true;
    }
  } catch (e) {
    console.warn('Local storage read failed:', e);
  }
  return false;
}

// === 10-Day Forecast ===
function displayForecast(daily) {
  const forecastContainer = document.getElementById('forecast');
  if (!daily || !forecastContainer) return;

  forecastContainer.innerHTML = '<h3>10-Day Forecast</h3><div class="forecast-grid"></div>';
  const grid = forecastContainer.querySelector('.forecast-grid');

  for (let i = 0; i < daily.time.length; i++) {
    const date = new Date(daily.time[i]);
    const dayName = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const maxTemp = Math.round(daily.temperature_2m_max[i]);
    const minTemp = Math.round(daily.temperature_2m_min[i]);
    const code = daily.weathercode[i];

    const weather = weatherCodes[code] || { icon: 'unknown.png', label: 'Unknown' };
    const iconUrl = `icons/${weather.icon}`;

    const forecastItem = document.createElement('div');
    forecastItem.className = 'forecast-day';
    forecastItem.innerHTML = `
      <div class="day">${dayName}</div>
      <img src="${iconUrl}" alt="${weather.label}" class="weather-icon">
      <div class="label">${weather.label}</div>
      <div class="temps">High: ${maxTemp}°F<br>Low: ${minTemp}°F</div>
    `;
    grid.appendChild(forecastItem);
  }
}

// === Hourly (next 24 hours) ===
function displayHourly(hourly) {
  const hourlyContainer = document.getElementById('hourly');
  if (!hourly || !hourlyContainer) return;

  hourlyContainer.innerHTML = `
    <h3>Next 24 Hours</h3>
    <div class="hourly-row"></div>
  `;

  const row = hourlyContainer.querySelector('.hourly-row');

  const now = new Date();
  const times = (hourly.time || []).map(t => new Date(t));
  let startIdx = times.findIndex(t => t >= now);
  if (startIdx === -1) startIdx = 0;

  const endIdx = Math.min(startIdx + 24, times.length);

  for (let i = startIdx; i < endIdx; i++) {
    const time = times[i];
    const hourLabel = time.toLocaleTimeString([], { hour: 'numeric' }); // e.g., "3 PM"

    const code = hourly.weathercode?.[i];
    const weather = weatherCodes[code] || { icon: 'unknown.png', label: '—' };
    const iconUrl = `icons/${weather.icon}`;

    const tempF = Math.round(hourly.temperature_2m?.[i]);
    const pop = hourly.precipitation_probability?.[i]; // %
    const wind = Math.round(hourly.windspeed_10m?.[i]); // mph

    const details = [
      tempF != null ? `${tempF}°F` : null,
      pop != null ? `${pop}%` : null,
      wind != null ? `${wind} mph` : null
    ].filter(Boolean).join(' · ');

    const cell = document.createElement('div');
    cell.className = 'hour';
    cell.innerHTML = `
      <div class="time">${hourLabel}</div>
      <img src="${iconUrl}" alt="${weather.label}" class="weather-icon">
      <div class="desc">${weather.label}</div>
      <div class="meta">${details}</div>
    `;
    row.appendChild(cell);
  }
}

// === Init (no DOMContentLoaded needed because script is at end of <body>) ===
(function init() {
  // If we can load previous location, do it; otherwise show idle UI
  const restored = loadLastLocation();
  if (!restored) {
    locationElement.textContent = 'Search a city to begin';
  }
})();


const weatherVideos = {
  clear: "videos/RainBG.mp4",
  cloudy: "videos/RainBG.mp4",
  rain: "videos/RainBG.mp4",
  snow: "videos/RainBG.mp4",
  thunder: "videos/RainBG.mp4",
  default: "videos/RainBG.mp4"
};

function setBackgroundVideo(code) {
  const videoEl = document.getElementById("bg-video");
  let src;

  if ([0, 1].includes(code)) {
    src = weatherVideos.clear;
  } else if ([2, 3, 45, 48].includes(code)) {
    src = weatherVideos.cloudy;
  } else if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) {
    src = weatherVideos.rain;
  } else if ([71, 73, 75, 77, 85, 86].includes(code)) {
    src = weatherVideos.snow;
  } else if ([95, 96, 99].includes(code)) {
    src = weatherVideos.thunder;
  } else {
    src = weatherVideos.default;
  }

  if (videoEl.src !== src) {
    videoEl.src = src;   // only reload if it changed
    videoEl.load();
    videoEl.play().catch(err => console.log("Autoplay blocked:", err));
  }
}

const resultsContainer = document.getElementById('geocodeResults');

function placeDisplay(place) {
  const state = place.state || place.admin1 || "";
  const statePretty = toUSAbbr(state);
  if (place.country_code === 'US' || (place.country && place.country.toLowerCase().includes('united states'))) {
    return statePretty ? `${place.name}, ${statePretty}` : place.name;
  }
  // Non-US fallback
  return state ? `${place.name}, ${state}` : `${place.name}, ${place.country || ''}`.trim();
}

function clearGeocodeCandidates() {
  if (!resultsContainer) return;
  resultsContainer.innerHTML = '';
}

function showGeocodeCandidates(results) {
  clearGeocodeCandidates();
  if (!results || results.length === 0) return;

  const list = document.createElement('div');
  list.className = 'list';

  results.forEach(place => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'item';
    item.innerHTML = `
      <span class="city">${placeDisplay(place)}</span>
      <span class="meta">${place.latitude.toFixed(2)}, ${place.longitude.toFixed(2)}</span>
    `;
    item.addEventListener('click', () => choosePlace(place));
    list.appendChild(item);
  });

  resultsContainer.appendChild(list);

  // Close on outside click or Escape
  const onClickAway = (e) => {
    if (!resultsContainer.contains(e.target) && e.target !== locationInput) {
      clearGeocodeCandidates();
      window.removeEventListener('click', onClickAway);
      window.removeEventListener('keydown', onEsc);
    }
  };
  const onEsc = (e) => {
    if (e.key === 'Escape') {
      clearGeocodeCandidates();
      window.removeEventListener('click', onClickAway);
      window.removeEventListener('keydown', onEsc);
    }
  };
  setTimeout(()=>{ // defer so the first click (that opened it) doesn't immediately close it
    window.addEventListener('click', onClickAway);
    window.addEventListener('keydown', onEsc);
  },0);
}

function choosePlace(place) {
  clearGeocodeCandidates();

  const display = placeDisplay(place);
  updateHeader(display);
  saveLastLocation({
    raw: locationInput.value.trim(),
    lat: place.latitude,
    lon: place.longitude,
    display
  });
  fetchWeather(place.latitude, place.longitude);
}