/**
 * Turns a user-supplied plot file into a GeoJSON FeatureCollection the API
 * accepts (POST /api/plots/import). KML (Google Earth, most field-survey
 * apps) is converted here; GeoJSON is passed through after a shape check.
 * Only Point / Polygon / MultiPolygon survive — lines and other shapes aren't plots.
 */

export interface PlotFeature {
  type: 'Feature'
  geometry: { type: 'Point' | 'Polygon' | 'MultiPolygon'; coordinates: unknown }
  properties: Record<string, unknown>
}

export interface PlotFeatureCollection {
  type: 'FeatureCollection'
  features: PlotFeature[]
}

const ACCEPTED = new Set(['Point', 'Polygon', 'MultiPolygon'])

/** "lon,lat[,alt] lon,lat ..." → [[lon, lat], ...] (altitude dropped). */
function parseKmlCoordinates(text: string): number[][] {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tuple) => tuple.split(',').slice(0, 2).map(Number))
    .filter((p) => p.length === 2 && p.every(Number.isFinite))
}

function closeRing(ring: number[][]): number[][] {
  if (ring.length === 0) return ring
  const [first, last] = [ring[0], ring[ring.length - 1]]
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first]
}

export function kmlToFeatureCollection(kmlText: string): PlotFeatureCollection {
  const doc = new DOMParser().parseFromString(kmlText, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) throw new Error('Tệp KML không hợp lệ')
  const features: PlotFeature[] = []
  for (const placemark of Array.from(doc.getElementsByTagName('Placemark'))) {
    const name = placemark.getElementsByTagName('name')[0]?.textContent?.trim()
    const properties: Record<string, unknown> = name ? { name, code: name } : {}
    for (const data of Array.from(placemark.getElementsByTagName('Data'))) {
      const key = data.getAttribute('name')
      const value = data.getElementsByTagName('value')[0]?.textContent?.trim()
      if (key && value !== undefined) properties[key] = value
    }

    const polygons = Array.from(placemark.getElementsByTagName('Polygon')).map((poly) => {
      const outer = poly.getElementsByTagName('outerBoundaryIs')[0]?.getElementsByTagName('coordinates')[0]?.textContent ?? ''
      const inners = Array.from(poly.getElementsByTagName('innerBoundaryIs')).map(
        (ib) => ib.getElementsByTagName('coordinates')[0]?.textContent ?? '',
      )
      return [closeRing(parseKmlCoordinates(outer)), ...inners.map((t) => closeRing(parseKmlCoordinates(t)))]
    })
    if (polygons.length === 1) {
      features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: polygons[0] }, properties })
      continue
    }
    if (polygons.length > 1) {
      features.push({ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: polygons }, properties })
      continue
    }
    const point = placemark.getElementsByTagName('Point')[0]?.getElementsByTagName('coordinates')[0]?.textContent
    if (point) {
      const [p] = parseKmlCoordinates(point)
      if (p) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties })
    }
  }
  if (features.length === 0) throw new Error('Không tìm thấy lô đất (Point/Polygon) nào trong tệp KML')
  return { type: 'FeatureCollection', features }
}

export function geoJsonToFeatureCollection(text: string): PlotFeatureCollection {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('Tệp GeoJSON không hợp lệ')
  }
  const obj = json as { type?: string; features?: unknown[]; geometry?: unknown; coordinates?: unknown }
  const raw: Array<{ geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> | null }> =
    obj.type === 'FeatureCollection'
      ? ((obj.features ?? []) as never)
      : obj.type === 'Feature'
        ? [obj as never]
        : ACCEPTED.has(obj.type ?? '')
          ? [{ geometry: obj as never }]
          : []
  const features = raw
    .filter((f) => f.geometry && ACCEPTED.has(f.geometry.type ?? ''))
    .map((f) => ({ type: 'Feature' as const, geometry: f.geometry as PlotFeature['geometry'], properties: f.properties ?? {} }))
  if (features.length === 0) throw new Error('Không tìm thấy lô đất (Point/Polygon) nào trong tệp GeoJSON')
  return { type: 'FeatureCollection', features }
}

export function parsePlotFile(fileName: string, text: string): PlotFeatureCollection {
  return /\.kml$/i.test(fileName) ? kmlToFeatureCollection(text) : geoJsonToFeatureCollection(text)
}
