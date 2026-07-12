import { get, type Readable } from 'svelte/store';
import maplibregl, {
    type GeoJSONSource,
    type FilterSpecification,
    type MapLayerMouseEvent,
    type MapLayerTouchEvent,
} from 'maplibre-gl';
import { map } from '$lib/components/map/map';
import { waypointPopup, trackpointPopup } from './gpx-layer-popup';
import {
    ListTrackSegmentItem,
    ListWaypointItem,
    ListWaypointsItem,
    ListTrackItem,
    ListFileItem,
    ListRootItem,
} from '$lib/components/file-list/file-list';
import { getClosestLinePoint, getElevation, loadSVGIcon } from '$lib/utils';
import { selectedWaypoint } from '$lib/components/toolbar/tools/waypoint/waypoint';
import { MapPin, Square } from 'lucide-static';
import { getSymbolKey, symbols } from '$lib/assets/symbols';
import type { GPXFileWithStatistics } from '$lib/logic/statistics-tree';
import { selection } from '$lib/logic/selection';
import { settings } from '$lib/logic/settings';
import { currentTool, Tool } from '$lib/components/toolbar/tools';
import { fileActionManager } from '$lib/logic/file-action-manager';
import { fileActions } from '$lib/logic/file-actions';
import { splitAs } from '$lib/components/toolbar/tools/scissors/scissors';
import { mapCursor, MapCursorState } from '$lib/logic/map-cursor';
import { ANCHOR_LAYER_KEY } from '$lib/components/map/style';
import { gpxColors } from '$lib/components/map/gpx-layer/gpx-layers';

export type MarkerStyle = 'pin' | 'circle' | 'custom';

const MARKER_TYPE_PREFIX = 'condottiero:';

export const CUSTOM_ICON_LINK_TYPE = 'condottiero:customIcon';

export const DEFAULT_MARKER_COLOR = '#3fb1ce';

function parseMarkerType(
    wptType: string | undefined
): { style: string; color?: string; size?: number } | undefined {
    if (!wptType || !wptType.startsWith(MARKER_TYPE_PREFIX)) return undefined;
    const [style, color, size] = wptType.slice(MARKER_TYPE_PREFIX.length).split(':');
    const parsedSize = size !== undefined ? parseFloat(size) : undefined;
    return {
        style,
        color: color && /^[0-9a-fA-F]{6}$/.test(color) ? `#${color}` : undefined,
        size: parsedSize !== undefined && !isNaN(parsedSize) && parsedSize > 0 ? parsedSize : undefined,
    };
}

export function getMarkerStyle(wptType: string | undefined): MarkerStyle {
    const parsed = parseMarkerType(wptType);
    if (parsed?.style === 'circle') return 'circle';
    if (parsed?.style === 'custom') return 'custom';
    return 'pin';
}

export function getMarkerColor(wptType: string | undefined): string | undefined {
    return parseMarkerType(wptType)?.color;
}

export function getMarkerSize(wptType: string | undefined): number | undefined {
    return parseMarkerType(wptType)?.size;
}

export function encodeMarkerStyle(style: MarkerStyle, color?: string, size?: number): string | undefined {
    const normalizedColor = color?.replace('#', '').toLowerCase();
    const normalizedSize = size !== undefined && size > 0 ? size : undefined;
    if (style === 'pin' && !normalizedColor && normalizedSize === undefined) return undefined;
    if (normalizedSize !== undefined) {
        return `${MARKER_TYPE_PREFIX}${style}:${normalizedColor ?? ''}:${normalizedSize}`;
    }
    return `${MARKER_TYPE_PREFIX}${style}${normalizedColor ? ':' + normalizedColor : ''}`;
}

export function getCustomIconFromLinks(
    link: { attributes: { href: string }; type?: string } | undefined
): string | undefined {
    if (!link) return undefined;
    if (link.type === CUSTOM_ICON_LINK_TYPE) return link.attributes.href;
    return undefined;
}

const colors = [
    '#ff0000',
    '#0000ff',
    '#46e646',
    '#00ccff',
    '#ff9900',
    '#ff00ff',
    '#ffff32',
    '#288228',
    '#9933ff',
    '#50f0be',
    '#8c645a',
];

const colorCount: { [key: string]: number } = {};
for (let color of colors) {
    colorCount[color] = 0;
}

function getColor(fileId: string) {
    let color = colors.reduce((a, b) => (colorCount[a] <= colorCount[b] ? a : b));
    colorCount[color]++;
    gpxColors.update((colors) => {
        colors.set(fileId, color);
        return colors;
    });
    return color;
}

function replaceColor(fileId: string, oldColor: string, newColor: string) {
    if (colorCount.hasOwnProperty(oldColor)) {
        colorCount[oldColor]--;
    }
    colorCount[newColor]++;
    gpxColors.update((colors) => {
        colors.set(fileId, newColor);
        return colors;
    });
}

function removeColor(fileId: string, color: string) {
    if (colorCount.hasOwnProperty(color)) {
        colorCount[color]--;
    }
    gpxColors.update((colors) => {
        colors.delete(fileId);
        return colors;
    });
}

export function getSvgForSymbol(
    symbol?: string | undefined,
    layerColor?: string | undefined,
    markerStyle: MarkerStyle = 'pin',
    customIconDataUri?: string | undefined,
    markerColor?: string | undefined
): string {
    if (markerStyle === 'custom' && customIconDataUri) {
        if (customIconDataUri.startsWith('data:image/svg+xml')) {
            try {
                const raw = customIconDataUri.startsWith('data:image/svg+xml;base64,')
                    ? atob(customIconDataUri.split(',')[1])
                    : decodeURIComponent(customIconDataUri.split(',')[1]);
                return raw;
            } catch {
            }
        }
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
            <image href="${customIconDataUri}" x="0" y="0" width="24" height="24"/>
        </svg>`;
    }

    if (markerStyle === 'circle') {
        const color = markerColor ?? layerColor ?? DEFAULT_MARKER_COLOR;
        const symbolSvg = symbol ? symbols[symbol]?.iconSvg : undefined;

        const innerIcon = symbolSvg
            ? symbolSvg
                  .replace('width="24"', 'width="16"')
                  .replace('height="24"', 'height="16"')
                  .replace('stroke="currentColor"', 'stroke="white"')
                  .replace('stroke-width="2"', 'stroke-width="2.5" x="8" y="8"')
            : '';

        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
            <circle cx="16" cy="16" r="14" fill="${color}" stroke="white" stroke-width="2"/>
            ${innerIcon}
        </svg>`;
    }

    const pinColor = markerColor ?? DEFAULT_MARKER_COLOR;
    let symbolSvg = symbol ? symbols[symbol]?.iconSvg : undefined;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    ${
        layerColor
            ? Square.replace('width="24"', 'width="12"')
                  .replace('height="24"', 'height="12"')
                  .replace('stroke="currentColor"', 'stroke="SteelBlue"')
                  .replace('stroke-width="2"', 'stroke-width="1.5" x="9.6" y="0.4"')
                  .replace('fill="none"', `fill="${layerColor}"`)
            : ''
    }
    ${MapPin.replace('width="24"', '')
        .replace('height="24"', '')
        .replace('stroke="currentColor"', '')
        .replace('path', `path fill="${pinColor}" stroke="SteelBlue" stroke-width="1"`)
        .replace(
            'circle',
            `circle fill="${symbolSvg ? 'none' : 'white'}" stroke="${symbolSvg ? 'none' : 'white'}" stroke-width="2"`
        )} 
    ${
        symbolSvg
            ?.replace('width="24"', 'width="10"')
            .replace('height="24"', 'height="10"')
            .replace('stroke="currentColor"', 'stroke="white"')
            .replace('stroke-width="2"', 'stroke-width="2.5" x="7" y="5"') ?? ''
    }
    </svg>`;
}

function iconSizeExpression(defaultSize: number): maplibregl.ExpressionSpecification {
    return ['coalesce', ['get', 'size'], defaultSize] as maplibregl.ExpressionSpecification;
}

const { directionMarkers, treeFileView, defaultOpacity, defaultWidth, markerIconSize } = settings;

export class GPXLayer {
    fileId: string;
    file: Readable<GPXFileWithStatistics | undefined>;
    layerColor: string;
    selected: boolean = false;
    currentWaypointData: GeoJSON.FeatureCollection | null = null;
    draggedWaypointIndex: number | null = null;
    draggingStartingPosition: maplibregl.Point = new maplibregl.Point(0, 0);
    unsubscribe: Function[] = [];

    updateBinded: () => void = this.update.bind(this);
    layerOnMouseEnterBinded: (e: any) => void = this.layerOnMouseEnter.bind(this);
    layerOnMouseLeaveBinded: () => void = this.layerOnMouseLeave.bind(this);
    layerOnMouseMoveBinded: (e: any) => void = this.layerOnMouseMove.bind(this);
    layerOnClickBinded: (e: MapLayerMouseEvent) => void = this.layerOnClick.bind(this);
    layerOnContextMenuBinded: (e: MapLayerMouseEvent) => void = this.layerOnContextMenu.bind(this);
    waypointLayerOnMouseEnterBinded: (e: MapLayerMouseEvent) => void =
        this.waypointLayerOnMouseEnter.bind(this);
    waypointLayerOnMouseLeaveBinded: (e: MapLayerMouseEvent) => void =
        this.waypointLayerOnMouseLeave.bind(this);
    waypointLayerOnClickBinded: (e: MapLayerMouseEvent) => void =
        this.waypointLayerOnClick.bind(this);
    waypointLayerOnMouseDownBinded: (e: MapLayerMouseEvent) => void =
        this.waypointLayerOnMouseDown.bind(this);
    waypointLayerOnTouchStartBinded: (e: MapLayerTouchEvent) => void =
        this.waypointLayerOnTouchStart.bind(this);
    waypointLayerOnMouseMoveBinded: (e: MapLayerMouseEvent | MapLayerTouchEvent) => void =
        this.waypointLayerOnMouseMove.bind(this);
    waypointLayerOnMouseUpBinded: (e: MapLayerMouseEvent | MapLayerTouchEvent) => void =
        this.waypointLayerOnMouseUp.bind(this);

    constructor(fileId: string, file: Readable<GPXFileWithStatistics | undefined>) {
        this.fileId = fileId;
        this.file = file;
        this.layerColor = getColor(fileId);
        this.unsubscribe.push(
            map.subscribe(($map) => {
                if ($map) {
                    $map.on('style.load', this.updateBinded);
                    this.update();
                }
            })
        );
        this.unsubscribe.push(file.subscribe(this.updateBinded));
        this.unsubscribe.push(
            selection.subscribe(($selection) => {
                let newSelected = $selection.hasAnyChildren(new ListFileItem(this.fileId));
                this.selected = newSelected;
                this.update();
                if (newSelected) {
                    this.moveToFront();
                }
            })
        );
        this.unsubscribe.push(directionMarkers.subscribe(this.updateBinded));
        this.unsubscribe.push(
            markerIconSize.subscribe((size) => {
                const _map = get(map);
                const layerId = this.fileId + '-waypoints';
                if (_map && _map.getLayer(layerId)) {
                    _map.setLayoutProperty(layerId, 'icon-size', iconSizeExpression(size));
                }
            })
        );
    }

    update() {
        const _map = get(map);
        const layerEventManager = map.layerEventManager;
        let file = get(this.file)?.file;
        if (!_map || !layerEventManager || !file) {
            return;
        }

        if (
            file._data.style &&
            file._data.style.color &&
            this.layerColor !== `#${file._data.style.color}`
        ) {
            replaceColor(this.fileId, this.layerColor, `#${file._data.style.color}`);
            this.layerColor = `#${file._data.style.color}`;
        }

        this.loadIcons();

        try {
            let source = _map.getSource(this.fileId) as GeoJSONSource | undefined;
            if (source) {
                source.setData(this.getGeoJSON());
            } else {
                _map.addSource(this.fileId, {
                    type: 'geojson',
                    data: this.getGeoJSON(),
                });
            }

            if (!_map.getLayer(this.fileId)) {
                _map.addLayer(
                    {
                        id: this.fileId,
                        type: 'line',
                        source: this.fileId,
                        layout: {
                            'line-join': 'round',
                            'line-cap': 'round',
                        },
                        paint: {
                            'line-color': ['get', 'color'],
                            'line-width': ['get', 'width'],
                            'line-opacity': ['get', 'opacity'],
                        },
                    },
                    ANCHOR_LAYER_KEY.tracks
                );

                layerEventManager.on('click', this.fileId, this.layerOnClickBinded);
                layerEventManager.on('contextmenu', this.fileId, this.layerOnContextMenuBinded);
                layerEventManager.on('mouseenter', this.fileId, this.layerOnMouseEnterBinded);
                layerEventManager.on('mouseleave', this.fileId, this.layerOnMouseLeaveBinded);
                layerEventManager.on('mousemove', this.fileId, this.layerOnMouseMoveBinded);
            }

            let visibleTrackSegmentIds: string[] = [];
            file.forEachSegment((segment, trackIndex, segmentIndex) => {
                if (!segment._data.hidden) {
                    visibleTrackSegmentIds.push(`${trackIndex}-${segmentIndex}`);
                }
            });
            const segmentFilter: FilterSpecification = [
                'in',
                ['get', 'trackSegmentId'],
                ['literal', visibleTrackSegmentIds],
            ];

            _map.setFilter(this.fileId, segmentFilter, { validate: false });

            if (get(directionMarkers)) {
                if (!_map.getLayer(this.fileId + '-direction')) {
                    _map.addLayer(
                        {
                            id: this.fileId + '-direction',
                            type: 'symbol',
                            source: this.fileId,
                            layout: {
                                'text-field': '»',
                                'text-offset': [0, -0.1],
                                'text-keep-upright': false,
                                'text-max-angle': 361,
                                'text-allow-overlap': true,
                                'text-font': ['Noto Sans Bold'],
                                'symbol-placement': 'line',
                                'symbol-spacing': 20,
                            },
                            paint: {
                                'text-color': 'white',
                                'text-halo-width': 0.2,
                                'text-halo-color': 'white',
                            },
                        },
                        ANCHOR_LAYER_KEY.directionMarkers
                    );
                }

                _map.setFilter(this.fileId + '-direction', segmentFilter, { validate: false });
            } else {
                if (_map.getLayer(this.fileId + '-direction')) {
                    _map.removeLayer(this.fileId + '-direction');
                }
            }

            let waypointSource = _map.getSource(this.fileId + '-waypoints') as
                | GeoJSONSource
                | undefined;
            this.currentWaypointData = this.getWaypointsGeoJSON();
            if (waypointSource) {
                waypointSource.setData(this.currentWaypointData);
            } else {
                _map.addSource(this.fileId + '-waypoints', {
                    type: 'geojson',
                    data: this.currentWaypointData,
                    promoteId: 'waypointIndex',
                });
            }

            if (!_map.getLayer(this.fileId + '-waypoints')) {
                _map.addLayer(
                    {
                        id: this.fileId + '-waypoints',
                        type: 'symbol',
                        source: this.fileId + '-waypoints',
                        layout: {
                            'icon-image': ['get', 'icon'],
                            'icon-size': iconSizeExpression(get(markerIconSize)),
                            'icon-allow-overlap': true,
                            'icon-anchor': 'bottom',
                            'icon-padding': 0,
                        },
                    },
                    ANCHOR_LAYER_KEY.waypoints
                );

                layerEventManager.on(
                    'mouseenter',
                    this.fileId + '-waypoints',
                    this.waypointLayerOnMouseEnterBinded
                );
                layerEventManager.on(
                    'mouseleave',
                    this.fileId + '-waypoints',
                    this.waypointLayerOnMouseLeaveBinded
                );
                layerEventManager.on(
                    'click',
                    this.fileId + '-waypoints',
                    this.waypointLayerOnClickBinded
                );
                layerEventManager.on(
                    'mousedown',
                    this.fileId + '-waypoints',
                    this.waypointLayerOnMouseDownBinded
                );
                layerEventManager.on(
                    'touchstart',
                    this.fileId + '-waypoints',
                    this.waypointLayerOnTouchStartBinded
                );
            }

            let visibleWaypoints: number[] = [];
            file.wpt.forEach((waypoint, waypointIndex) => {
                if (!waypoint._data.hidden) {
                    visibleWaypoints.push(waypointIndex);
                }
            });

            _map.setFilter(
                this.fileId + '-waypoints',
                ['in', ['get', 'waypointIndex'], ['literal', visibleWaypoints]],
                { validate: false }
            );
        } catch (e) {
            console.error(e);
        }
    }

    remove() {
        removeColor(this.fileId, this.layerColor);
        this.unsubscribe.forEach((fn) => fn());
        const _map = get(map);
        if (_map) {
            _map.off('style.load', this.updateBinded);

            const layerEventManager = map.layerEventManager;
            if (layerEventManager) {
                layerEventManager.off('click', this.fileId, this.layerOnClickBinded);
                layerEventManager.off('contextmenu', this.fileId, this.layerOnContextMenuBinded);
                layerEventManager.off('mouseenter', this.fileId, this.layerOnMouseEnterBinded);
                layerEventManager.off('mouseleave', this.fileId, this.layerOnMouseLeaveBinded);
                layerEventManager.off('mousemove', this.fileId, this.layerOnMouseMoveBinded);
                layerEventManager.off(
                    'mouseenter',
                    this.fileId + '-waypoints',
                    this.waypointLayerOnMouseEnterBinded
                );
                layerEventManager.off(
                    'mouseleave',
                    this.fileId + '-waypoints',
                    this.waypointLayerOnMouseLeaveBinded
                );
                layerEventManager.off(
                    'click',
                    this.fileId + '-waypoints',
                    this.waypointLayerOnClickBinded
                );
                layerEventManager.off(
                    'mousedown',
                    this.fileId + '-waypoints',
                    this.waypointLayerOnMouseDownBinded
                );
                layerEventManager.off(
                    'touchstart',
                    this.fileId + '-waypoints',
                    this.waypointLayerOnTouchStartBinded
                );
            }

            if (_map.getLayer(this.fileId + '-direction')) {
                _map.removeLayer(this.fileId + '-direction');
            }
            if (_map.getLayer(this.fileId)) {
                _map.removeLayer(this.fileId);
            }
            if (_map.getLayer(this.fileId + '-waypoints')) {
                _map.removeLayer(this.fileId + '-waypoints');
            }
            if (_map.getSource(this.fileId)) {
                _map.removeSource(this.fileId);
            }
            if (_map.getSource(this.fileId + '-waypoints')) {
                _map.removeSource(this.fileId + '-waypoints');
            }
        }
    }

    moveToFront() {
        const _map = get(map);
        if (_map) {
            if (_map.getLayer(this.fileId)) {
                _map.moveLayer(this.fileId);
            }
            if (_map.getLayer(this.fileId + '-waypoints')) {
                _map.moveLayer(this.fileId + '-waypoints');
            }
        }
    }

    layerOnMouseEnter(e: any) {
        mapCursor.notify(MapCursorState.HOVERING_FEATURE, true);
    }

    layerOnMouseLeave() {
        mapCursor.notify(MapCursorState.HOVERING_FEATURE, false);
    }

    layerOnMouseMove(e: any) {}

    layerOnClick(e: MapLayerMouseEvent) {
        if (e.features === undefined || e.features.length === 0) {
            return;
        }
        const _map = get(map);
        if (!_map) {
            return;
        }

        let trackIndex = e.features[0].properties!.trackIndex;
        let segmentIndex = e.features[0].properties!.segmentIndex;
        let file = get(this.file)?.file;
        if (!file) {
            return;
        }

        if (get(currentTool) === Tool.SCISSORS) {
            splitAs(e, file, this.fileId, trackIndex, segmentIndex);
        } else {
            if (get(treeFileView)) {
                if ((e.originalEvent.ctrlKey || e.originalEvent.metaKey) && this.selected) {
                    selection.addSelectItem(
                        new ListTrackSegmentItem(this.fileId, trackIndex, segmentIndex)
                    );
                } else {
                    selection.selectItem(
                        new ListTrackSegmentItem(this.fileId, trackIndex, segmentIndex)
                    );
                }
            } else {
                if (!this.selected) {
                    selection.selectItem(new ListFileItem(this.fileId));
                }
                trackpointPopup?.setItem({
                    item: file.trk[trackIndex].trkseg[segmentIndex],
                    fileId: this.fileId,
                    coordinates: e.lngLat,
                });
            }
        }
    }

    layerOnContextMenu(e: MapLayerMouseEvent) {
        if (e.features === undefined || e.features.length === 0) {
            return;
        }
        const _map = get(map);
        if (!_map) {
            return;
        }

        let trackIndex = e.features[0].properties!.trackIndex;
        let segmentIndex = e.features[0].properties!.segmentIndex;
        let file = get(this.file)?.file;
        if (!file) {
            return;
        }

        if (get(treeFileView)) {
            selection.selectItem(
                new ListTrackSegmentItem(this.fileId, trackIndex, segmentIndex)
            );
        } else {
            if (!this.selected) {
                selection.selectItem(new ListFileItem(this.fileId));
            }
        }
    }

    waypointLayerOnMouseEnter(e: MapLayerMouseEvent) {
        mapCursor.notify(MapCursorState.HOVERING_FEATURE, true);
    }

    waypointLayerOnMouseLeave(e: MapLayerMouseEvent) {
        mapCursor.notify(MapCursorState.HOVERING_FEATURE, false);
    }

    waypointLayerOnClick(e: MapLayerMouseEvent) {
        if (e.features === undefined || e.features.length === 0) {
            return;
        }

        const _map = get(map);
        if (!_map) return;

        // Trova il waypoint più vicino al punto cliccato
        let closestFeature = e.features[0];
        let minDist = Infinity;
        for (const feature of e.features) {
            const coords = (feature.geometry as GeoJSON.Point).coordinates;
            const projected = _map.project([coords[0], coords[1]]);
            const dist = Math.hypot(projected.x - e.point.x, projected.y - e.point.y);
            if (dist < minDist) {
                minDist = dist;
                closestFeature = feature;
            }
        }

        let waypointIndex = closestFeature.properties!.waypointIndex;
        let file = get(this.file)?.file;
        if (!file) {
            return;
        }
        let waypoint = file.wpt[waypointIndex];

        if (get(currentTool) === Tool.WAYPOINT) {
            if (get(treeFileView)) {
                if (
                    (e.originalEvent.ctrlKey || e.originalEvent.metaKey) &&
                    this.selected
                ) {
                    selection.addSelectItem(new ListWaypointItem(this.fileId, waypointIndex));
                } else {
                    selection.selectItem(new ListWaypointItem(this.fileId, waypointIndex));
                }
            } else {
                selectedWaypoint.set([waypoint, this.fileId]);
            }
        } else {
            if (get(treeFileView)) {
                if (
                    (e.originalEvent.ctrlKey || e.originalEvent.metaKey) &&
                    this.selected
                ) {
                    selection.addSelectItem(new ListWaypointItem(this.fileId, waypointIndex));
                } else {
                    selection.selectItem(new ListWaypointItem(this.fileId, waypointIndex));
                }
            } else {
                if (!this.selected) {
                    selection.selectItem(new ListFileItem(this.fileId));
                }
                waypointPopup?.setItem({ item: waypoint, fileId: this.fileId });
            }
        }
    }

    waypointLayerOnMouseDown(e: MapLayerMouseEvent) {
        if (get(currentTool) !== Tool.WAYPOINT || !this.selected) {
            return;
        }
        const _map = get(map);
        if (!_map) {
            return;
        }

        e.preventDefault();
        _map.dragPan.disable();

        this.draggedWaypointIndex = e.features![0].properties!.waypointIndex;
        this.draggingStartingPosition = e.point;
        waypointPopup?.hide();

        _map.on('mousemove', this.waypointLayerOnMouseMoveBinded);
        _map.once('mouseup', this.waypointLayerOnMouseUpBinded);
    }

    waypointLayerOnTouchStart(e: MapLayerTouchEvent) {
        if (e.points.length !== 1 || get(currentTool) !== Tool.WAYPOINT || !this.selected) {
            return;
        }
        const _map = get(map);
        if (!_map) {
            return;
        }

        this.draggedWaypointIndex = e.features![0].properties!.waypointIndex;
        this.draggingStartingPosition = e.point;
        waypointPopup?.hide();

        e.preventDefault();
        _map.dragPan.disable();

        _map.on('touchmove', this.waypointLayerOnMouseMoveBinded);
        _map.once('touchend', this.waypointLayerOnMouseUpBinded);
    }

    waypointLayerOnMouseMove(e: MapLayerMouseEvent | MapLayerTouchEvent) {
        if (this.draggedWaypointIndex === null || e.point.equals(this.draggingStartingPosition)) {
            return;
        }

        mapCursor.notify(MapCursorState.WAYPOINT_DRAGGING, true);

        (
            this.currentWaypointData!.features[this.draggedWaypointIndex].geometry as GeoJSON.Point
        ).coordinates = [e.lngLat.lng, e.lngLat.lat];

        let waypointSource = get(map)?.getSource(this.fileId + '-waypoints') as
            | GeoJSONSource
            | undefined;
        if (waypointSource) {
            waypointSource.updateData({
                update: [
                    {
                        id: this.draggedWaypointIndex,
                        newGeometry: {
                            type: 'Point',
                            coordinates: [e.lngLat.lng, e.lngLat.lat],
                        },
                    },
                ],
            });
        }
    }

    waypointLayerOnMouseUp(e: MapLayerMouseEvent | MapLayerTouchEvent) {
        mapCursor.notify(MapCursorState.WAYPOINT_DRAGGING, false);

        const _map = get(map);
        if (!_map) {
            return;
        }

        _map.dragPan.enable();

        _map.off('mousemove', this.waypointLayerOnMouseMoveBinded);
        _map.off('touchmove', this.waypointLayerOnMouseMoveBinded);

        if (this.draggedWaypointIndex === null) {
            return;
        }
        if (e.point.equals(this.draggingStartingPosition)) {
            this.draggedWaypointIndex = null;
            return;
        }

        getElevation([
            {
                lat: e.lngLat.lat,
                lon: e.lngLat.lng,
            },
        ]).then((ele) => {
            if (this.draggedWaypointIndex === null) {
                return;
            }
            fileActionManager.applyToFile(this.fileId, (file) => {
                let wpt = file.wpt[this.draggedWaypointIndex!];
                wpt.setCoordinates({
                    lat: e.lngLat.lat,
                    lon: e.lngLat.lng,
                });
                wpt.ele = ele[0];
            });
            this.draggedWaypointIndex = null;
        });
    }

    getGeoJSON(): GeoJSON.FeatureCollection {
        let file = get(this.file)?.file;
        if (!file) {
            return {
                type: 'FeatureCollection',
                features: [],
            };
        }

        let data = file.toGeoJSON();

        let trackIndex = 0,
            segmentIndex = 0;
        for (let feature of data.features) {
            if (!feature.properties) {
                feature.properties = {};
            }
            if (!feature.properties.color) {
                feature.properties.color = this.layerColor;
            }
            if (!feature.properties.opacity) {
                feature.properties.opacity = get(defaultOpacity);
            }
            if (!feature.properties.width) {
                feature.properties.width = get(defaultWidth);
            }
            if (
                get(selection).hasAnyParent(
                    new ListTrackSegmentItem(this.fileId, trackIndex, segmentIndex)
                ) ||
                get(selection).hasAnyChildren(new ListWaypointsItem(this.fileId), true)
            ) {
                feature.properties.width = feature.properties.width + 2;
                feature.properties.opacity = Math.min(1, feature.properties.opacity + 0.1);
            }
            feature.properties.trackIndex = trackIndex;
            feature.properties.segmentIndex = segmentIndex;
            feature.properties.trackSegmentId = `${trackIndex}-${segmentIndex}`;

            segmentIndex++;
            if (segmentIndex >= file.trk[trackIndex].trkseg.length) {
                segmentIndex = 0;
                trackIndex++;
            }
        }
        return data;
    }

    getWaypointsGeoJSON(): GeoJSON.FeatureCollection {
        let file = get(this.file)?.file;

        let data: GeoJSON.FeatureCollection = {
            type: 'FeatureCollection',
            features: [],
        };

        if (!file) {
            return data;
        }

        file.wpt.forEach((waypoint, index) => {
            const markerStyle = getMarkerStyle(waypoint.type);
            const markerColor = getMarkerColor(waypoint.type);
            const markerSize = getMarkerSize(waypoint.type);
            const customIcon = getCustomIconFromLinks(waypoint.link);
            const iconId = this.getIconId(waypoint, markerStyle, markerColor, customIcon);

            const properties: GeoJSON.GeoJsonProperties = {
                fileId: this.fileId,
                waypointIndex: index,
                icon: iconId,
            };
            if (markerSize !== undefined) {
                properties.size = markerSize;
            }

            data.features.push({
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [waypoint.getLongitude(), waypoint.getLatitude()],
                },
                properties,
            });
        });

        return data;
    }

    getIconId(
        waypoint: { sym?: string },
        markerStyle: MarkerStyle,
        markerColor: string | undefined,
        customIcon: string | undefined
    ): string {
        const symbolKey = getSymbolKey(waypoint.sym);
        const colorPart = markerColor ? `-${markerColor.replace('#', '')}` : `-${this.layerColor}`;
        const customPart =
            markerStyle === 'custom' && customIcon ? '-' + btoa(customIcon).slice(0, 8) : '';
        return `waypoint-${symbolKey ?? 'default'}${colorPart}-${markerStyle}${customPart}`;
    }

    loadIcons() {
        const _map = get(map);
        let file = get(this.file)?.file;
        if (!_map || !file) {
            return;
        }

        file.wpt.forEach((waypoint) => {
            const symbolKey = getSymbolKey(waypoint.sym);
            const markerStyle = getMarkerStyle(waypoint.type);
            const markerColor = getMarkerColor(waypoint.type);
            const customIcon = getCustomIconFromLinks(waypoint.link);
            const iconId = this.getIconId(waypoint, markerStyle, markerColor, customIcon);

            loadSVGIcon(
                _map,
                iconId,
                getSvgForSymbol(
                    symbolKey,
                    this.layerColor,
                    markerStyle,
                    customIcon ?? undefined,
                    markerColor
                )
            );
        });
    }
}