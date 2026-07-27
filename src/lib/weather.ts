/**
 * Weather, via Open-Meteo — chosen because it needs no API key, so the weather
 * dimension works out of the box for every user rather than being a paid
 * feature behind a settings screen.
 */
import type { WeatherContext } from "./types";

const FORECAST = "https://api.open-meteo.com/v1/forecast";
const GEOCODE = "https://geocoding-api.open-meteo.com/v1/search";

export interface GeoResult {
  name: string;
  country: string;
  admin1?: string;
  latitude: number;
  longitude: number;
}

export async function geocode(query: string): Promise<GeoResult[]> {
  const url = `${GEOCODE}?name=${encodeURIComponent(query)}&count=5&format=json`;
  const res = await fetch(url, { next: { revalidate: 86400 } });
  if (!res.ok) return [];
  const json = (await res.json()) as { results?: GeoResult[] };
  return json.results ?? [];
}

const WEATHER_CODES: Record<number, string> = {
  0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Fog", 48: "Freezing fog", 51: "Light drizzle", 53: "Drizzle",
  55: "Heavy drizzle", 61: "Light rain", 63: "Rain", 65: "Heavy rain",
  66: "Freezing rain", 67: "Freezing rain", 71: "Light snow", 73: "Snow",
  75: "Heavy snow", 77: "Snow grains", 80: "Rain showers", 81: "Rain showers",
  82: "Violent rain showers", 85: "Snow showers", 86: "Snow showers",
  95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Thunderstorm with hail",
};

export interface Forecast extends WeatherContext {
  highC: number;
  lowC: number;
}

/**
 * Today's conditions. Uses the daytime mean rather than the current reading —
 * you're dressing for the day, not for the moment you opened the app.
 */
export async function getForecast(lat: number, lon: number): Promise<Forecast | null> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,weather_code",
    forecast_days: "1",
    timezone: "auto",
  });

  try {
    const res = await fetch(`${FORECAST}?${params}`, { next: { revalidate: 1800 } });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      current: Record<string, number>;
      daily: Record<string, number[]>;
    };

    const high = json.daily.temperature_2m_max?.[0];
    const low = json.daily.temperature_2m_min?.[0];
    // Weight toward the daytime high — most people are outdoors between 9 and 6.
    const dayMean = typeof high === "number" && typeof low === "number" ? low * 0.35 + high * 0.65 : json.current.temperature_2m;

    const code = json.daily.weather_code?.[0] ?? json.current.weather_code;

    return {
      tempC: dayMean,
      feelsLikeC: json.current.apparent_temperature + (dayMean - json.current.temperature_2m),
      windKph: json.daily.wind_speed_10m_max?.[0] ?? json.current.wind_speed_10m,
      precipitationMm: json.daily.precipitation_sum?.[0] ?? json.current.precipitation ?? 0,
      humidity: json.current.relative_humidity_2m,
      label: WEATHER_CODES[code] ?? "Unknown",
      highC: high,
      lowC: low,
    };
  } catch {
    // Weather is an enhancement, never a blocker — the scorer already handles
    // a missing forecast by dropping the dimension's confidence to zero.
    return null;
  }
}
