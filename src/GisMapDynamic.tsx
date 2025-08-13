// @ts-nocheck

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Feature } from "ol";
import FeatureLike from "ol/Feature";
import Map from "ol/Map";
import View from "ol/View";
import { defaults as defaultControls } from "ol/control";
import { Coordinate } from "ol/coordinate";
import { GeoJSON } from "ol/format";
import { Point } from "ol/geom";
import MultiPolygon from "ol/geom/MultiPolygon";
import { defaults as defaultInteractions } from "ol/interaction";
import BaseLayer from "ol/layer/Base";
import VectorLayer from "ol/layer/Vector";
import "ol/ol.css";
import { fromLonLat, transform } from "ol/proj";
import { Cluster } from "ol/source";
import VectorSource from "ol/source/Vector";
import { Circle as CircleStyle, Fill, Stroke, Style, Text as TextStyle } from "ol/style";

import ScaleLine from "ol-ext/control/CanvasScaleLine";
import Compass from "ol-ext/control/Compass";
import ProgressBar from "ol-ext/control/ProgressBar";
import Scale from "ol-ext/control/Scale";
import "ol-ext/dist/ol-ext.css";
import ZoomAnimation from "ol-ext/featureanimation/Zoom";
import CropFilter from "ol-ext/filter/Crop";
import { easeOut, upAndDown } from "ol/easing";


export type LayerJsonBody = { table: string; column: string; id: string };
export type ClusterSummaryItem = { lon: string | number; lat: string | number; count: number };
export type BuildLegendBlobFn = (legendGraphicUrl: string) => Promise<Blob>;
export type MakeOlObjectFn = (node: any) => BaseLayer; 
export type GisMapDynamicProps = {
  centerLonLat: [number, number];
  initialZoom?: number;
  freezeMap?: boolean;
  showLatLon?: boolean;
  baseGroups?: BaseLayer[];
  layerJson?: { children?: any[] } | null; 
  makeOlObject?: MakeOlObjectFn; 
  onMapReady?: (map: Map) => void; 
  onPointSelected?: (data: any) => void;
  getSDTV: (body: { id: string }) => Promise<any[]>; 
  getClusterCount: () => Promise<ClusterSummaryItem[]>; 
  fetchBoundary: (body: LayerJsonBody) => Promise<Array<{ st_asgeojson: string }>>;
  buildLegendBlob: BuildLegendBlobFn;
  makeLegendUrl: (sourceUrl: string, layerName: string) => string;
  initialClip?: LayerJsonBody | null;
  skipClipLayerNames?: string[];
  notify?: {
    warn?: (msg: string) => void;
    error?: (msg: string) => void;
  };
  IdentifyComponent?: React.ReactNode;
  classNames?: {
    map?: string;
    latLon?: string;
    layersLegend?: string;
    legendItem?: string;
    addPointBtn?: string;
  };
};


export const POLYGON_BOUNDARY_STYLE = new Style({
  fill: new Fill({ color: "rgba(255, 255, 255, 0.0)" }),
  stroke: new Stroke({ color: "#0000ff", width: 4 }),
});

const GisMapDynamic: React.FC<GisMapDynamicProps> = (props) => {
  const {
    centerLonLat,
    initialZoom = 13,
    freezeMap = false,
    showLatLon = true,
    baseGroups = [],
    layerJson = null,
    makeOlObject,
    onMapReady,
    onPointSelected,
    getSDTV,
    getClusterCount,
    fetchBoundary,
    buildLegendBlob,
    makeLegendUrl,
    initialClip = null,
    skipClipLayerNames = ["Aerial", "Google"],
    notify,
    IdentifyComponent,
    classNames,
  } = props;

  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);

  const groups: BaseLayer[] = useMemo(() => {
    const extraLayers = layerJson?.children && makeOlObject
      ? layerJson.children.map(makeOlObject)
      : [];
    return [...baseGroups, ...extraLayers];
  }, [baseGroups, layerJson, makeOlObject]);

  const [summary, setSummary] = useState<ClusterSummaryItem[]>([]);
  const [clusterLayer, setClusterLayer] = useState<BaseLayer | undefined>(undefined);
  const [navigationCropFilter, setNavigationCropFilter] = useState<CropFilter | null>(null);
  const [clippedBoundary, setClippedBoundary] = useState<VectorLayer<VectorSource> | null>(null);
  const [legendUrls, setLegendUrls] = useState<string[]>([]);
  const [pointerLonLat, setPointerLonLat] = useState<Coordinate>([0, 0]);

  useEffect(() => {
    if (!mapDivRef.current) return;

    const controls = [
      new Scale(),
      new ScaleLine(),
      new Compass({ className: "bottom", src: "compact", style: new Stroke({ color: "#75869d", width: 0 }) }),
    ];

    const map = new Map({
      target: mapDivRef.current,
      layers: groups,
      view: new View({ center: fromLonLat(centerLonLat), zoom: initialZoom }),
      controls: freezeMap ? [] : [...defaultControls().getArray(), ...controls],
      interactions: freezeMap ? [] : defaultInteractions(),
    });

    const progressBar = new ProgressBar({ layers: map.getAllLayers() });
    map.addControl(progressBar);

    mapRef.current = map;
    onMapReady?.(map);

    const onPointerMove = (evt: any) => {
      try {
        const coordinate = transform(evt.coordinate, "EPSG:3857", "EPSG:4326");
        setPointerLonLat(coordinate);
      } catch {}
    };
    map.on("pointermove", onPointerMove);

    return () => {
      map.un("pointermove", onPointerMove);
      controls.forEach((c) => map.removeControl(c));
      map.setTarget(undefined);
      map.dispose();
      mapRef.current = null;
    };
  }, [groups, centerLonLat, initialZoom, freezeMap, onMapReady]);

  const createPulseFeature = useCallback((coordinate: number[]) => {
    const feature = new Feature(new Point(coordinate));
    feature.setStyle(
      new Style({
        image: new CircleStyle({ radius: 30, stroke: new Stroke({ color: "green", width: 2 }) }),
      })
    );
    return feature;
  }, []);

  const handlePulseAnimation = useCallback((evt: any, map: Map) => {
    const feature = createPulseFeature(evt.coordinate);
    (map as any).animateFeature(
      feature,
      new ZoomAnimation({ fade: easeOut, duration: 2800, easing: upAndDown })
    );
  }, [createPulseFeature]);

  const villageClickEvent = useCallback(async (evt: any) => {
    const map = mapRef.current;
    if (!map) return;
    handlePulseAnimation(evt, map);

    const [longitude, latitude] = transform(evt.coordinate, "EPSG:3857", "EPSG:4326");
    const wktPoint = `POINT (${longitude} ${latitude})`;

    try {
      const resp = await getSDTV({ id: wktPoint });
      if (resp?.[0]) {
        onPointSelected?.(resp[0]);
      } else {
        notify?.warn?.("No data found for the selected point.");
      }
    } catch (e: any) {
      notify?.error?.(String(e?.message || e));
    } finally {
      map.un("singleclick", villageClickEvent);
    }
  }, [getSDTV, onPointSelected, notify, handlePulseAnimation]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const bound = (evt: any) => handlePulseAnimation(evt, map);
    map.on("singleclick", bound);
    return () => map.un("singleclick", bound);
  }, [handlePulseAnimation]);

  const isBirthCertificateLayerVisible = useCallback(() => {
    const map = mapRef.current;
    if (!map) return false;
    const birth = map.getAllLayers().find((l: any) => l.get("name") === "Hospital Birth");
    return birth?.getVisible?.() || birth?.isVisible?.() || false;
  }, []);

  const refreshClusterSummary = useCallback(async () => {
    try {
      const resp = await getClusterCount();
      setSummary(Array.isArray(resp) ? resp : []);
    } catch (e: any) {
      notify?.error?.(String(e?.message || e));
    }
  }, [getClusterCount, notify]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (isBirthCertificateLayerVisible()) refreshClusterSummary();
    buildLegendsForVisibleWmsLayers().catch(() => void 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const existing = map.getAllLayers().find((l: any) => l.get("name") === "cluster-layer");
    if (existing) map.removeLayer(existing as any);

    if (!Array.isArray(summary) || summary.length === 0) {
      setClusterLayer(undefined);
      return;
    }

    const count = summary.length;
    const features = new Array(count);
    for (let i = 0; i < count; i++) {
      const lon = Number(summary[i].lon);
      const lat = Number(summary[i].lat);
      const point = new Point(transform([lon, lat], "EPSG:4326", "EPSG:3857"));
      const f = new Feature(point);
      (f as any).set("count", summary[i].count);
      features[i] = f;
    }

    const vectorSource = new VectorSource({ features });
    const clusterSource = new Cluster({ distance: 40, source: vectorSource });

    const layer = new (require("ol-ext/layer/AnimatedCluster").default)({
      source: clusterSource,
      animationDuration: 700,
      style: makeClusterStyle,
      properties: { name: "cluster-layer" },
    });

    setClusterLayer(layer);

    if (isBirthCertificateLayerVisible()) {
      map.addLayer(layer);
    }
  }, [summary, isBirthCertificateLayerVisible]);

  useEffect(() => {
    if (!initialClip) return;
    clip(initialClip).catch((e) => notify?.error?.(String(e?.message || e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialClip]);


  const addIdentifyPointMode = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.on("singleclick", villageClickEvent);
  }, [villageClickEvent]);

  const clip = useCallback(async (body: LayerJsonBody) => {
    const map = mapRef.current;
    if (!map) return;

    if (clippedBoundary) {
      clippedBoundary.getSource()?.clear();
      map.removeLayer(clippedBoundary);
    }

    const res = await fetchBoundary(body);
    const featureCollection = JSON.parse(res?.[0]?.st_asgeojson || "{}");

    const features = new GeoJSON({ featureProjection: "EPSG:3857", dataProjection: "EPSG:4326" }).readFeatures(
      featureCollection
    );

    const layer = new VectorLayer({
      style: POLYGON_BOUNDARY_STYLE,
      source: new VectorSource({ features }),
      properties: { name: "navigation-boundary" },
    });

    setClippedBoundary(layer);
    map.addLayer(layer);

    let coords: Coordinate[][][] = [];
    features.forEach((ft: any) => {
      coords = (ft.getGeometry() as MultiPolygon)?.getCoordinates();
    });

    const featureMulti = new Feature(new MultiPolygon(coords));
    const crop = new CropFilter({ feature: featureMulti as any, wrapX: true, inner: false });
    crop.setActive(true);

    map.getAllLayers().forEach((lyr: any) => {
      const nm = lyr.get?.("name");
      if (nm && skipClipLayerNames.includes(nm)) return;
      try {
        lyr.removeFilter?.(navigationCropFilter);
        lyr.addFilter?.(crop);
      } catch {}
    });

    setNavigationCropFilter(crop);
  }, [fetchBoundary, clippedBoundary, navigationCropFilter, skipClipLayerNames]);

  const buildLegendsForVisibleWmsLayers = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;

    const visibles = map.getAllLayers().filter((l: any) => l.getVisible?.());

    const promises: Promise<string>[] = [];
    visibles.forEach((layer: any) => {
      const src = layer.getSource?.();
      const LAYERS = src?.getParams?.()?.LAYERS;
      const urls: string[] | undefined = src?.getUrls?.();
      if (LAYERS && urls && urls[0]) {
        const legendUrl = makeLegendUrl(urls[0], LAYERS);
        const p = buildLegendBlob(legendUrl)
          .then((blob) => URL.createObjectURL(blob))
          .catch(() => "");
        promises.push(p);
      }
    });

    const urls = (await Promise.all(promises)).filter(Boolean);
    setLegendUrls(urls);
  }, [buildLegendBlob, makeLegendUrl]);

  
  return (
    <div className="w-full h-full relative">
      <div id="map" ref={mapDivRef} className={classNames?.map || "w-full h-[70vh] rounded-xl overflow-hidden"} />

      {legendUrls.length > 0 && (
        <ul className={classNames?.layersLegend || "absolute top-4 left-4 bg-white/90 rounded p-2 shadow list-none m-0"}>
          <li className="text-xs font-medium mb-1 opacity-70">Layers Legend</li>
          {legendUrls.map((u, i) => (
            <li key={`legend-${i}`} className={classNames?.legendItem || "mb-2"}>
              <img src={u} alt={`legend-${i}`} />
            </li>
          ))}
        </ul>
      )}

      {showLatLon && (
        <div className={classNames?.latLon || "absolute bottom-4 left-1/2 -translate-x-1/2 bg-white/90 rounded px-3 py-1 text-sm shadow flex items-center gap-4"}>
          <span>Lon: {Number(pointerLonLat?.[0] || 0).toFixed(4)}</span>
          <span>Lat: {Number(pointerLonLat?.[1] || 0).toFixed(4)}</span>
        </div>
      )}

      <button
        onClick={addIdentifyPointMode}
        className={classNames?.addPointBtn || "absolute top-4 right-4 bg-blue-600 text-white rounded-md px-3 py-2 shadow"}
      >
        Add Point
      </button>

      {IdentifyComponent}
    </div>
  );
};

const styleCache: Record<string, Style> = {};

function makeClusterStyle(feature: FeatureLike) {
  const first = (feature as any).get("features")?.[0];
  const size: number | undefined = first?.get?.("count");
  if (!size) return undefined as any;

  const key = String(size);
  if (styleCache[key]) return styleCache[key];

  const color = size > 25 ? "192,0,0" : size > 8 ? "255,128,0" : "0,128,0";
  const radius = Math.max(8, Math.min(size * 0.75, 20));
  const lineDash = new Array(7).fill((2 * Math.PI * radius) / 6);
  (lineDash as any)[0] = 0;

  const style = new Style({
    image: new CircleStyle({
      radius,
      stroke: new Stroke({ color: `rgba(${color},0.5)`, width: 15, lineDash, lineCap: "butt" }),
      fill: new Fill({ color: `rgba(${color},1)` }),
    }),
    text: new TextStyle({ text: String(size), fill: new Fill({ color: "#fff" }) }),
  });

  styleCache[key] = style;
  return style;
}

export default GisMapDynamic;


//   <GisMapDynamic
//   centerLonLat={[77.2154, 28.6285]}
//   initialZoom={13}
//   baseGroups={[highResImagesGroup]}
//   layerJson={layersJson || Defaultlayers} 
//   makeOlObject={makeOlObject || DefaultmakeOlObject }
//   getSDTV={GetSDTV}
//   getClusterCount={getClusterCount}
//   fetchBoundary={(body) => axiosInstance.post(`${API_URL}gis/get-boundary`, body).then((r)=> r.data)}
//   buildLegendBlob={(legendUrl) => fetch(eQuery(legendUrl)).then(res => res.blob())}
//   makeLegendUrl={(src, layer) => `${src}?REQUEST=GetLegendGraphic&layer=${layer}&format=image/png`}
//   onPointSelected={(data) => {
//    console.log("data",data)
//   }}
//   initialClip={tablename}
//   skipClipLayerNames={skipClipLayerNames}
// />