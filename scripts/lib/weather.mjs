// Open-Meteo WMO weather codes → short display strings.
export const WEATHER_CONDITIONS = {
  0: "Clear sky", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Fog", 48: "Depositing rime fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
  56: "Freezing drizzle", 57: "Freezing drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain",
  66: "Freezing rain", 67: "Freezing rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
  80: "Rain showers", 81: "Rain showers", 82: "Heavy rain showers",
  85: "Snow showers", 86: "Heavy snow showers",
  95: "Thunderstorm", 96: "Thunderstorm w/ hail", 99: "Severe thunderstorm",
};

export async function fetchWeather({ lat, lon, locationName, timezone }) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", lat);
  url.searchParams.set("longitude", lon);
  url.searchParams.set("current", "temperature_2m,weather_code");
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code");
  url.searchParams.set("timezone", timezone);
  url.searchParams.set("forecast_days", "1");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const data = await res.json();
  const code = data.daily.weather_code?.[0] ?? data.current.weather_code;

  return {
    location: locationName,
    tempC: data.current.temperature_2m,
    condition: WEATHER_CONDITIONS[code] || "Unknown",
    code,
    highC: data.daily.temperature_2m_max[0],
    lowC: data.daily.temperature_2m_min[0],
    rainChance: data.daily.precipitation_probability_max[0] ?? 0,
  };
}
