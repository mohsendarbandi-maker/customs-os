type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type ExternalJson = Record<string, unknown>;

const REQUEST_TIMEOUT_MS = 7_500;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

const maritimeJson = (
  payload: unknown,
  status = 200,
  cacheControl = 'no-store',
): Response => Response.json(payload, {
  status,
  headers: {
    'cache-control': cacheControl,
    'x-content-type-options': 'nosniff',
    'x-customs-os-proxy': 'cloudflare',
  },
});

const fetchExternalJson = async (
  endpoint: string,
  provider: string,
  fetchImpl: FetchLike,
): Promise<ExternalJson> => {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchImpl(endpoint, {
        method: 'GET',
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(provider + ' HTTP ' + response.status);

      const declaredLength = Number(response.headers.get('content-length') || 0);
      if (declaredLength > MAX_RESPONSE_BYTES) {
        throw new Error(provider + ' response exceeded the size limit');
      }

      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
        throw new Error(provider + ' response exceeded the size limit');
      }

      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error(provider + ' returned invalid JSON');
      }

      if (
        payload &&
        typeof payload === 'object' &&
        ((payload as { error?: unknown }).error === true ||
          typeof (payload as { reason?: unknown }).reason === 'string')
      ) {
        throw new Error(provider + ' returned unavailable model data');
      }
      return payload as ExternalJson;
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(provider + ' unavailable');
};

const setCoordinate = (url: URL, name: string, value: number) => {
  url.searchParams.set(name, value.toFixed(3));
};

const pick = (payload: ExternalJson, name: string) =>
  payload[name] ?? null;

export const handleMaritimeConditions = async (
  request: Request,
  fetchImpl: FetchLike = fetch,
): Promise<Response> => {
  if (!['GET', 'HEAD'].includes(request.method)) {
    return maritimeJson({ success: false, error: 'Method not allowed' }, 405, 'no-store');
  }

  const url = new URL(request.url);
  const latitudeRaw = url.searchParams.get('latitude');
  const longitudeRaw = url.searchParams.get('longitude');
  const latitude = latitudeRaw === null ? NaN : Number(latitudeRaw);
  const longitude = longitudeRaw === null ? NaN : Number(longitudeRaw);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 || latitude > 90 ||
    longitude < -180 || longitude > 180
  ) {
    return maritimeJson({
      success: false,
      error: 'مختصات جغرافیایی معتبر نیست.',
    }, 400, 'no-store');
  }

  const lat = Math.round(latitude * 1000) / 1000;
  const lon = Math.round(longitude * 1000) / 1000;

  const weatherUrl = new URL('https://api.open-meteo.com/v1/forecast');
  setCoordinate(weatherUrl, 'latitude', lat);
  setCoordinate(weatherUrl, 'longitude', lon);
  weatherUrl.searchParams.set('current', [
    'temperature_2m', 'relative_humidity_2m', 'apparent_temperature',
    'precipitation', 'weather_code', 'pressure_msl', 'wind_speed_10m',
    'wind_direction_10m', 'wind_gusts_10m',
  ].join(','));
  weatherUrl.searchParams.set('hourly', 'precipitation_probability');
  weatherUrl.searchParams.set('forecast_days', '2');
  weatherUrl.searchParams.set('timezone', 'auto');

  const marineUrl = new URL('https://marine-api.open-meteo.com/v1/marine');
  setCoordinate(marineUrl, 'latitude', lat);
  setCoordinate(marineUrl, 'longitude', lon);
  marineUrl.searchParams.set('current', [
    'wave_height', 'wave_direction', 'wave_period', 'wind_wave_height',
    'swell_wave_height', 'swell_wave_direction', 'sea_surface_temperature',
    'ocean_current_velocity', 'ocean_current_direction',
  ].join(','));
  marineUrl.searchParams.set('hourly', [
    'wave_height', 'wave_direction', 'wave_period', 'wind_wave_height',
    'swell_wave_height', 'sea_level_height_msl', 'ocean_current_velocity',
    'ocean_current_direction',
  ].join(','));
  marineUrl.searchParams.set('forecast_days', '2');
  marineUrl.searchParams.set('timezone', 'auto');

  const [weatherResult, marineResult] = await Promise.allSettled([
    fetchExternalJson(weatherUrl.toString(), 'Open-Meteo weather', fetchImpl),
    fetchExternalJson(marineUrl.toString(), 'Open-Meteo marine', fetchImpl),
  ]);

  const weatherPayload = weatherResult.status === 'fulfilled' ? weatherResult.value : null;
  const marinePayload = marineResult.status === 'fulfilled' ? marineResult.value : null;
  if (!weatherPayload && !marinePayload) {
    return maritimeJson({
      success: false,
      error: 'سرویس‌های دادهٔ آب‌وهوا و دریا موقتاً پاسخ نمی‌دهند.',
      warnings: ['weather_unavailable', 'marine_unavailable'],
    }, 503, 'no-store');
  }

  const warnings: string[] = [];
  if (!weatherPayload) warnings.push('weather_unavailable');
  if (!marinePayload) warnings.push('marine_unavailable');

  const payload = {
    success: true,
    partial: warnings.length > 0,
    updated_at: new Date().toISOString(),
    location: { latitude: lat, longitude: lon },
    weather: weatherPayload ? {
      current: pick(weatherPayload, 'current'),
      current_units: pick(weatherPayload, 'current_units'),
      hourly: pick(weatherPayload, 'hourly'),
      hourly_units: pick(weatherPayload, 'hourly_units'),
      timezone: pick(weatherPayload, 'timezone'),
    } : null,
    marine: marinePayload ? {
      current: pick(marinePayload, 'current'),
      current_units: pick(marinePayload, 'current_units'),
      hourly: pick(marinePayload, 'hourly'),
      hourly_units: pick(marinePayload, 'hourly_units'),
      minutely_15: pick(marinePayload, 'minutely_15'),
      minutely_15_units: pick(marinePayload, 'minutely_15_units'),
      timezone: pick(marinePayload, 'timezone'),
    } : null,
    sources: ['Open-Meteo Weather Forecast API', 'Open-Meteo Marine API'],
    warnings,
  };

  return maritimeJson(payload, 200, 'public, max-age=120, s-maxage=300');
};
