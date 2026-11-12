// Weather through Open-Meteo: no API key, no account, no cookies. Coordinates are
// rounded to about 11 km before they leave the device.

export const WEATHER_PROVIDER = {
  name: "Open-Meteo",
  url: "https://open-meteo.com/",
  license: "Weather data by Open-Meteo.com, CC BY 4.0",
} as const;

export const WEATHER_CACHE_MS = 30 * 60 * 1000;
export const WEATHER_TIMEOUT_MS = 10 * 1000;

export interface WeatherPlace {
  name: string;
  detail: string;
  latitude: number;
  longitude: number;
}

export interface WeatherReport {
  temperature: number;
  high: number;
  low: number;
  code: number;
  isDay: boolean;
  fetchedAt: number;
}

export type TemperatureUnit = "celsius" | "fahrenheit";

export function roundCoordinate(value: number): number {
  return Math.round(value * 10) / 10;
}

export function forecastUrl(place: Pick<WeatherPlace, "latitude" | "longitude">, unit: TemperatureUnit): string {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(roundCoordinate(place.latitude)));
  url.searchParams.set("longitude", String(roundCoordinate(place.longitude)));
  url.searchParams.set("current", "temperature_2m,weather_code,is_day");
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min");
  url.searchParams.set("forecast_days", "1");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("temperature_unit", unit);
  return url.toString();
}

export function geocodeUrl(query: string, language = "en"): string {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", query.trim().slice(0, 100));
  url.searchParams.set("count", "6");
  url.searchParams.set("format", "json");
  url.searchParams.set("language", /^[a-z]{2}$/.test(language) ? language : "en");
  return url.toString();
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function parseForecast(raw: unknown, now: number): WeatherReport | null {
  const data = raw as {
    current?: { temperature_2m?: unknown; weather_code?: unknown; is_day?: unknown };
    daily?: { temperature_2m_max?: unknown[]; temperature_2m_min?: unknown[] };
  } | null;
  const temperature = data?.current?.temperature_2m;
  const code = data?.current?.weather_code;
  const high = data?.daily?.temperature_2m_max?.[0];
  const low = data?.daily?.temperature_2m_min?.[0];
  if (!isNumber(temperature) || !isNumber(code) || !isNumber(high) || !isNumber(low)) return null;
  return {
    temperature: Math.round(temperature),
    high: Math.round(high),
    low: Math.round(low),
    code,
    isDay: data?.current?.is_day !== 0,
    fetchedAt: now,
  };
}

export function parsePlaces(raw: unknown): WeatherPlace[] {
  const results = (raw as { results?: unknown[] } | null)?.results;
  if (!Array.isArray(results)) return [];
  const places: WeatherPlace[] = [];
  for (const item of results) {
    const entry = item as { name?: unknown; latitude?: unknown; longitude?: unknown; admin1?: unknown; country?: unknown };
    if (typeof entry.name !== "string" || !isNumber(entry.latitude) || !isNumber(entry.longitude)) continue;
    const detail = [entry.admin1, entry.country].filter((part) => typeof part === "string" && part).join(", ");
    places.push({ name: entry.name, detail, latitude: entry.latitude, longitude: entry.longitude });
  }
  return places;
}

/** WMO weather interpretation codes, as documented by Open-Meteo. */
/** The message name (in _locales) that describes a WMO weather code. */
export function weatherConditionKey(code: number): string {
  if (code === 0) return "weatherClear";
  if (code === 1) return "weatherMainlyClear";
  if (code === 2) return "weatherPartlyCloudy";
  if (code === 3) return "weatherOvercast";
  if (code === 45 || code === 48) return "weatherFog";
  if (code >= 51 && code <= 57) return "weatherDrizzle";
  if (code >= 61 && code <= 67) return "weatherRain";
  if (code >= 71 && code <= 77) return "weatherSnow";
  if (code >= 80 && code <= 82) return "weatherRainShowers";
  if (code === 85 || code === 86) return "weatherSnowShowers";
  if (code === 95) return "weatherThunderstorm";
  if (code === 96 || code === 99) return "weatherThunderstormHail";
  return "weatherUnknown";
}

export type WeatherIcon = "clear" | "partly" | "cloud" | "fog" | "rain" | "snow" | "storm";

export function weatherIcon(code: number): WeatherIcon {
  if (code <= 1) return "clear";
  if (code === 2) return "partly";
  if (code === 3) return "cloud";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "storm";
  return "rain";
}

export function isFresh(report: WeatherReport | null | undefined, now: number): boolean {
  return !!report && now - report.fetchedAt < WEATHER_CACHE_MS;
}
