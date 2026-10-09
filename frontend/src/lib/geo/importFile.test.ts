import { describe, expect, it } from 'vitest'
import { geoJsonToFeatureCollection, kmlToFeatureCollection, parsePlotFile } from './importFile'

const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <Placemark><name>L-01</name>
    <ExtendedData><Data name="areaHa"><value>1.2</value></Data></ExtendedData>
    <Polygon><outerBoundaryIs><LinearRing><coordinates>
      108.1,11.9,0 108.101,11.9,0 108.101,11.901,0 108.1,11.901,0
    </coordinates></LinearRing></outerBoundaryIs></Polygon>
  </Placemark>
  <Placemark><name>L-02</name><Point><coordinates>108.2,11.8,650</coordinates></Point></Placemark>
  <Placemark><name>Đường</name><LineString><coordinates>108,11 108.1,11.1</coordinates></LineString></Placemark>
</Document></kml>`

describe('plot file import', () => {
  it('converts KML polygons (closing the ring, dropping altitude) and points, skipping lines', () => {
    const fc = kmlToFeatureCollection(KML)
    expect(fc.features).toHaveLength(2)
    expect(fc.features[0]).toMatchObject({
      geometry: { type: 'Polygon' },
      properties: { name: 'L-01', code: 'L-01', areaHa: '1.2' },
    })
    const ring = (fc.features[0].geometry.coordinates as number[][][])[0]
    expect(ring[0]).toEqual([108.1, 11.9])
    expect(ring[ring.length - 1]).toEqual(ring[0])
    expect(fc.features[1].geometry).toEqual({ type: 'Point', coordinates: [108.2, 11.8] })
  })

  it('accepts a FeatureCollection, a single Feature or a bare geometry', () => {
    const poly = { type: 'Polygon', coordinates: [[[108, 11], [108.1, 11], [108.1, 11.1], [108, 11]]] }
    expect(geoJsonToFeatureCollection(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: poly, properties: { code: 'A' } }] })).features).toHaveLength(1)
    expect(geoJsonToFeatureCollection(JSON.stringify({ type: 'Feature', geometry: poly, properties: null })).features[0].properties).toEqual({})
    expect(geoJsonToFeatureCollection(JSON.stringify(poly)).features).toHaveLength(1)
  })

  it('rejects files with no usable plot', () => {
    expect(() => geoJsonToFeatureCollection('{"type":"LineString","coordinates":[]}')).toThrow(/Không tìm thấy/)
    expect(() => geoJsonToFeatureCollection('not json')).toThrow(/không hợp lệ/)
    expect(() => parsePlotFile('x.kml', '<kml><Document/></kml>')).toThrow(/Không tìm thấy/)
  })
})
