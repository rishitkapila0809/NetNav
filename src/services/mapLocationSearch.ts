import type { LiveMeasurement, TelecomOperator } from '../types.ts';
import type { RouteCoordinate } from './walkingRoutes.ts';

export const MAP_SEARCH_MEASUREMENT_RADIUS_METERS = 100;
export interface MapSearchResult { id: string; name: string; address: string; position: RouteCoordinate }
export interface GeocoderResultLike { place_id?: string; formatted_address: string; geometry: { location: { lat: number | (() => number); lng: number | (() => number) } }; types?: string[] }

export function mapGeocoderResults(results: GeocoderResultLike[]): MapSearchResult[] {
  return results.flatMap((result, index) => {
    const lat = typeof result.geometry?.location?.lat === 'function' ? result.geometry.location.lat() : result.geometry?.location?.lat;
    const lng = typeof result.geometry?.location?.lng === 'function' ? result.geometry.location.lng() : result.geometry?.location?.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat! < -90 || lat! > 90 || lng! < -180 || lng! > 180) return [];
    const address = result.formatted_address || 'Unnamed search result';
    return [{ id: result.place_id || `${index}:${lat},${lng}`, name: address.split(',')[0] || address, address, position: { lat: lat!, lng: lng! } }];
  });
}

export async function searchMapLocationsWith(
  geocode: (request: { address: string; region: string }) => Promise<GeocoderResultLike[]>, query: string,
): Promise<MapSearchResult[]> {
  const address = query.trim();
  if (!address) throw new Error('Enter a building, landmark, or address to search.');
  try {
    const results = mapGeocoderResults(await geocode({ address, region: 'IN' }));
    if (!results.length) throw new Error('No matching location was found. Try a more specific name or address.');
    return results;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('No matching')) throw error;
    throw new Error('Location search failed. Check Google Geocoding API access and try again.');
  }
}

export function searchMapLocations(query: string): Promise<MapSearchResult[]> {
  if (typeof google === 'undefined' || !google.maps?.Geocoder) {
    return Promise.reject(new Error('Google Maps is not ready for location search.'));
  }
  const geocoder = new google.maps.Geocoder();
  return searchMapLocationsWith(async (request) => (await geocoder.geocode(request)).results, query);
}

export function geographicDistanceMeters(a: RouteCoordinate, b: RouteCoordinate): number {
  const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function findNearbyMeasurements(
  rows: LiveMeasurement[], operator: TelecomOperator, position: RouteCoordinate, radiusMeters = MAP_SEARCH_MEASUREMENT_RADIUS_METERS,
): Array<{ measurement: LiveMeasurement; distanceMeters: number }> {
  return rows.filter((row) => row.operator === operator && Number.isFinite(row.latitude) && row.latitude >= -90 && row.latitude <= 90 && Number.isFinite(row.longitude) && row.longitude >= -180 && row.longitude <= 180 && Number.isFinite(row.nqs) && row.nqs >= 0 && row.nqs <= 100)
    .map((measurement) => ({ measurement, distanceMeters: geographicDistanceMeters(position, { lat: measurement.latitude, lng: measurement.longitude }) }))
    .filter((row) => row.distanceMeters <= radiusMeters).sort((a, b) => a.distanceMeters - b.distanceMeters);
}

export function locationSearchStateMessage(status: 'idle' | 'loading' | 'loaded' | 'error', count: number): string | null {
  if (status === 'loading') return 'Searching saved measurements near this location…';
  if (status === 'error') return 'Could not load saved measurements for this location.';
  if (status === 'loaded' && count === 0) return 'No measurements available for this location.';
  return null;
}
