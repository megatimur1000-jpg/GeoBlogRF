// КРИТИЧНО: Инициализируем Leaflet в window ПЕРЕД импортом любых модулей,
// которые могут использовать window.L (mapFacade, projectManager, OSMMapRenderer)
import '../../utils/leafletInit';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { OSMMapRenderer } from '../../services/map_facade/adapters/OSMMapRenderer';
import CircularProgressBar from '../ui/CircularProgressBar';

// Leaflet и его стили инициализируются в `../../utils/leafletInit`.
// Используем `mapFacade` и глобальный `window.L` вместо прямых импортов.
// (импорты 'leaflet', 'leaflet/dist/leaflet.css' и 'leaflet.markercluster' удалены)

// Объявляем L как глобальную переменную (устанавливается в leafletInit.ts)
declare const L: any;

// Хук для рендеринга маркеров (кластеризация, события, попапы)
import { useMapMarkers } from './useMapMarkers.tsx';

import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { useMapStyle } from '../../hooks/useMapStyle';
import { MapContainer, MapWrapper, LoadingOverlay, ErrorMessage, GlobalLeafletPopupStyles } from './Map.styles';

import { createPortal } from 'react-dom';
import MarkerPopup from './MarkerPopup';
import { MarkerData } from '../../types/marker';
import styled from 'styled-components';
import MapLegend from './MapLegend';
import { ElegantAccordionForm } from './ElegantAccordionForm';
import { placeDiscoveryService, DiscoveredPlace } from '../../services/placeDiscoveryService';
import { GlassPanel } from '../Glass';
import MiniMarkerPopup from './MiniMarkerPopup';
import EventMiniPopup from './EventMiniPopup';
import { projectManager } from '../../services/projectManager';
import { activityService } from '../../services/activityService';
import { useRussiaRestrictions } from '../../hooks/useRussiaRestrictions';
import { canCreateMarker } from '../../services/zoneService';
import { useContentStore, ContentState } from '../../stores/contentStore';
import { useMapDisplayMode } from '../../hooks/useMapDisplayMode';
import { FEATURES } from '../../config/features';
import { getDistanceFromLatLonInKm } from '../../utils/russiaBounds';
import { getMarkerIconPath, getCategoryColor, getFontAwesomeIconName } from '../../constants/markerCategories';
import { mapFacade, INTERNAL } from '../../services/map_facade/index';
import type { MapConfig } from '../../services/map_facade/index';
import { useMapStateStore } from '../../stores/mapStateStore';
import { useEventsStore, EventsState } from '../../stores/eventsStore';
import { MockEvent } from '../TravelCalendar/mockEvents';
import { getCategoryById } from '../TravelCalendar/TravelCalendar';
import { markerService } from '../../services/markerService';
import {
    getTileLayer,
    getAdditionalLayers,
    createLayerIndicator,
    markerCategoryStyles,
    latLngToContainerPoint
} from './mapUtils';

const MapMessage = styled.div`
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  background-color: var(--glass-bg-dark);
  color: white;
  padding: 15px 25px;
  border-radius: 8px;
  font-size: 1.2em;
  z-index: 999;
  pointer-events: none;
  text-align: center;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
`;

interface MapProps {
    center: [number, number];
    zoom: number;
    markers: MarkerData[];
    onMapClick?: (coordinates: [number, number]) => void;
    onHashtagClickFromPopup?: (hashtag: string) => void;
    flyToCoordinates?: [number, number] | null;
    selectedMarkerIdForPopup?: string | null;
    setSelectedMarkerIdForPopup: (id: string | null) => void;
    onAddToFavorites: (marker: MarkerData) => void;
    onRemoveFromFavorites?: (id: string) => void;
    setSelectedMarkerIds?: React.Dispatch<React.SetStateAction<string[]>> | ((ids: string[]) => void);
    onAddToBlog?: (marker: MarkerData) => void;
    onFavoritesClick?: () => void;
    favoritesCount?: number;
    onBoundsChange?: (bounds: { north: number; south: number; east: number; west: number }) => void;
    radius: number;
    isAddingMarkerMode?: boolean;
    onAddMarkerModeChange?: (enabled: boolean) => void;
    legendOpen?: boolean;
    onLegendOpenChange?: (open: boolean) => void;
    isFavorite: (marker: MarkerData) => boolean;
    mapSettings: {
        mapType: string;
        showTraffic: boolean;
        showBikeLanes: boolean;
        showHints: boolean;
        themeColor: string;
    };
    filters: {
        categories: string[];
        radiusOn: boolean;
        radius: number;
        preset: string | null;
    };
    searchRadiusCenter: [number, number];
    onSearchRadiusCenterChange: (center: [number, number]) => void;
    selectedMarkerIds?: string[];
    zones?: Array<{ severity?: string; polygons: number[][][]; name?: string; type?: string }>;
    routeData?: {
        id: string;
        title: string;
        polyline: [number, number][];
        markers: any[];
    } | null;
}

function Map(props: MapProps) {
    const {
        center, zoom, markers, onMapClick, onHashtagClickFromPopup,
        flyToCoordinates, selectedMarkerIdForPopup, setSelectedMarkerIdForPopup, onAddToFavorites, onAddToBlog, isFavorite,
        onFavoritesClick, favoritesCount, mapSettings, filters, searchRadiusCenter, onSearchRadiusCenterChange, selectedMarkerIds, onBoundsChange, zones = [], routeData, isAddingMarkerMode: externalIsAddingMarkerMode, onAddMarkerModeChange, legendOpen: externalLegendOpen, onLegendOpenChange,
        onRemoveFromFavorites, setSelectedMarkerIds
    } = props;

    // --- СОСТОЯНИЕ ДЛЯ МАРКЕРОВ ---
    const [localMarkers, setLocalMarkers] = useState<MarkerData[]>([]);

    const markersData = useMemo(() => {
        const propsMarkers = markers || [];
        const localOnly = localMarkers.filter(lm => !propsMarkers.some(pm => pm.id === lm.id));
        return [...propsMarkers, ...localOnly];
    }, [markers, localMarkers]);

    const setMarkersData = useCallback((newMarkers: MarkerData[] | ((prev: MarkerData[]) => MarkerData[])) => {
        if (typeof newMarkers === 'function') {
            setLocalMarkers(prev => {
                const result = newMarkers(prev);
                return result.filter(m => !(markers || []).some(pm => pm.id === m.id));
            });
        } else {
            const newOnly = newMarkers.filter(m => !(markers || []).some(pm => pm.id === m.id));
            setLocalMarkers(newOnly);
        }
    }, [markers]);

    // --- REFS ---
    // Use `any` for internal Leaflet instances to avoid direct Leaflet types in components
    const mapRef = useRef<any | null>(null);
    const mapContainerRef = useRef<HTMLDivElement | null>(null);

    const tempMarkerRef = useRef<any | null>(null);
    const markerClusterGroupRef = useRef<any | null>(null);
    const tileLayerRef = useRef<any | null>(null);
    const isAddingMarkerModeRef = useRef(false);
    const initRetryRef = useRef<number>(0);

    // --- PORTAL ---
    const [portalEl] = useState<HTMLElement | null>(() => {
        if (typeof document !== 'undefined') {
            let el = document.getElementById('global-map-root') as HTMLElement | null;
            if (!el) {
                el = document.createElement('div');
                el.id = 'global-map-root';
                document.body.appendChild(el);
            }
            return el;
        }
        return null;
    });

    // --- HOOKS ---
    const { t } = useTranslation();
    const { isDarkMode } = useTheme();
    const mapStyle = useMapStyle();
    const russiaRestrictions = useRussiaRestrictions();
    const leftContent = useContentStore((state: ContentState) => state.leftContent);
    const rightContent = useContentStore((state: ContentState) => state.rightContent);
    const isTwoPanelMode = rightContent !== null;
    const openEvents = useEventsStore((state: EventsState) => state.openEvents);
    const selectedEvent = useEventsStore((state: EventsState) => state.selectedEvent);
    const setSelectedEvent = useEventsStore((state: EventsState) => state.setSelectedEvent);

    // --- STATE ---
    const [isLoading, setIsLoading] = useState(true);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [isMapReady, setIsMapReady] = useState(false);
    const [coordsForNewMarker, setCoordsForNewMarker] = useState<[number, number] | null>(null);
    const [tempMarker, setTempMarker] = useState<any | null>(null);
    const [mapMessage, setMapMessage] = useState<string | null>(null);
    const [showCultureMessage, setShowCultureMessage] = useState<boolean>(true);
    const [discoveredPlace, setDiscoveredPlace] = useState<DiscoveredPlace | null>(null);
    const [isDiscoveringPlace, setIsDiscoveringPlace] = useState(false);
    const [miniPopup, setMiniPopup] = useState<{
        marker: MarkerData;
        position: { x: number; y: number };
    } | null>(null);
    const [eventMiniPopup, setEventMiniPopup] = useState<{
        event: MockEvent;
        position: { x: number; y: number };
    } | null>(null);

    // --- LEGEND STATE ---
    const [internalLegendOpen, setInternalLegendOpen] = useState(false);
    const legendOpen = externalLegendOpen !== undefined ? externalLegendOpen : internalLegendOpen;
    const setLegendOpen = useCallback((open: boolean) => {
        if (onLegendOpenChange) {
            onLegendOpenChange(open);
        } else {
            setInternalLegendOpen(open);
        }
    }, [onLegendOpenChange]);

    // --- ADD MARKER MODE STATE ---
    const [internalIsAddingMarkerMode, setInternalIsAddingMarkerMode] = useState(false);
    const isAddingMarkerMode = externalIsAddingMarkerMode !== undefined
        ? externalIsAddingMarkerMode
        : internalIsAddingMarkerMode;
    const setIsAddingMarkerMode = useCallback((enabled: boolean) => {
        if (onAddMarkerModeChange) {
            onAddMarkerModeChange(enabled);
        } else {
            setInternalIsAddingMarkerMode(enabled);
        }
        if (enabled) {
            setMapMessage('🎯 Кликните на карту, чтобы добавить метку');
        } else {
            setMapMessage(null);
        }
    }, [onAddMarkerModeChange]);

    // --- REFS SYNC ---
    useEffect(() => {
        isAddingMarkerModeRef.current = isAddingMarkerMode;
    }, [isAddingMarkerMode]);

    useEffect(() => {
        tempMarkerRef.current = tempMarker;
    }, [tempMarker]);

    // --- PORTAL VISIBILITY ---
    useEffect(() => {
        if (portalEl) {
            if (leftContent !== 'map' && leftContent !== null) {
                portalEl.style.display = 'none';
                portalEl.style.visibility = 'hidden';
                portalEl.style.pointerEvents = 'none';
            } else {
                portalEl.style.display = 'block';
                portalEl.style.visibility = 'visible';
                portalEl.style.pointerEvents = 'auto';
            }
        }
    }, [leftContent, portalEl]);

    // --- FACADE MAP TOP OFFSET ---
    const mapDisplayMode = useMapDisplayMode();

    // Динамическое управление видимостью и классом контейнера карты
    useEffect(() => {
        const mapContainer = document.querySelector('.leaflet-container') as HTMLElement | null;
        const facadeMapRoot = document.querySelector('.facade-map-root') as HTMLElement | null;
        
        if (mapContainer) {
            // Управляем видимостью на основе режима отображения
            if (mapDisplayMode.shouldShowFullscreen) {
                mapContainer.style.display = 'block';
                mapContainer.style.visibility = 'visible';
                mapContainer.style.pointerEvents = 'auto';
            } else {
                // Скрываем карту когда открыты только Posts + Activity
                mapContainer.style.display = 'none';
                mapContainer.style.visibility = 'hidden';
                mapContainer.style.pointerEvents = 'none';
            }
        }
        
        // Обновляем CSS переменную для правильного позиционирования
        const headerEl = document.querySelector('.page-header') || document.querySelector('header');
        const headerHeight = headerEl ? (headerEl as HTMLElement).offsetHeight : 0;
        document.documentElement.style.setProperty('--facade-map-top', `${headerHeight}px`);
        
        // Добавляем класс для стилизации в зависимости от режима
        if (facadeMapRoot) {
            facadeMapRoot.classList.remove('two-panel-mode', 'single-panel-mode', 'map-hidden');
            if (!mapDisplayMode.shouldShowFullscreen) {
                facadeMapRoot.classList.add('map-hidden');
            } else if (mapDisplayMode.isTwoPanelMode) {
                facadeMapRoot.classList.add('two-panel-mode');
            } else {
                facadeMapRoot.classList.add('single-panel-mode');
            }
        }
        
        // Инвалидируем размер карты при изменении режима
        if (mapRef.current && mapDisplayMode.shouldShowFullscreen) {
            setTimeout(() => {
                try {
                    mapRef.current?.invalidateSize();
                } catch (e) {}
            }, 100);
        }
    }, [mapDisplayMode.shouldShowFullscreen, mapDisplayMode.isTwoPanelMode, mapDisplayMode.isOnlyPostsAndActivity]);

    useEffect(() => {
        const setFacadeMapTop = () => {
            try {
                const headerEl = document.querySelector('.page-header') || document.querySelector('header');
                const h = headerEl ? (headerEl as HTMLElement).offsetHeight : 0;
                
                // Используем значение из хука режима отображения карты
                const topValue = mapDisplayMode.shouldShowFullscreen ? `${h}px` : `${h}px`;
                document.documentElement.style.setProperty('--facade-map-top', topValue);
                
                if (mapRef.current) {
                    setTimeout(() => {
                        try {
                            mapRef.current?.invalidateSize();
                        } catch (e) { }
                    }, 120);
                }
            } catch (e) { }
        };

        setFacadeMapTop();
        window.addEventListener('resize', setFacadeMapTop);
        return () => window.removeEventListener('resize', setFacadeMapTop);
    }, [mapDisplayMode.shouldShowFullscreen]);

    // --- CENTER/ZOOM FROM PROPS (only if no saved state) ---
    useEffect(() => {
        if (!mapRef.current) return;

        const savedState = useMapStateStore.getState().contexts.osm;
        if (savedState.initialized) {
            try {
                mapRef.current.setView(savedState.center, savedState.zoom, { animate: false });
            } catch (e) { }
            return;
        }

        try {
            mapRef.current.setView(center, zoom, { animate: false });
        } catch (e) { }
    }, [center, zoom]);

    // --- UNIFIED RESIZE HANDLER ---
    useEffect(() => {
        if (!mapRef.current) return;

        let timeoutId: NodeJS.Timeout | null = null;

        const handleResize = () => {
            if (timeoutId) clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                try {
                    mapRef.current?.invalidateSize();
                } catch (e) { }
            }, 350);
        };

        try {
            mapRef.current.invalidateSize();
        } catch (e) { }

        handleResize();

        return () => {
            if (timeoutId) clearTimeout(timeoutId);
        };
    }, [leftContent, rightContent, isTwoPanelMode]);

    // --- INTERSECTION OBSERVER FOR VISIBILITY ---
    useEffect(() => {
        if (!mapRef.current || !mapContainerRef.current) return;

        if ('IntersectionObserver' in window) {
            const observer = new IntersectionObserver(
                (entries) => {
                    entries.forEach((entry) => {
                        if (entry.isIntersecting && entry.intersectionRatio > 0) {
                            setTimeout(() => {
                                try {
                                    mapRef.current?.invalidateSize();
                                } catch (e) { }
                            }, 100);
                        }
                    });
                },
                { threshold: [0, 0.1, 0.5, 1.0], rootMargin: '0px' }
            );

            observer.observe(mapContainerRef.current);
            return () => observer.disconnect();
        }
    }, []);

    // --- MAP INITIALIZATION (main effect) ---
    useEffect(() => {
        const container = mapContainerRef.current || document.getElementById('map');
        const isContainerVisible = (() => {
            if (!container) return false;
            try {
                const style = window.getComputedStyle(container as Element);
                return style.visibility !== 'hidden' && style.display !== 'none' && (container as HTMLElement).offsetWidth > 0 && (container as HTMLElement).offsetHeight > 0;
            } catch (e) {
                return false;
            }
        })();

        if (mapRef.current) {
            setError(null);
            return;
        }

        if (!isContainerVisible) {
            setError(null);
            setIsLoading(false);
            return;
        }

        const checkVisibility = (element: HTMLElement): boolean => {
            const style = window.getComputedStyle(element);
            return style.visibility !== 'hidden' && style.display !== 'none' &&
                element.offsetWidth > 0 && element.offsetHeight > 0;
        };

        // Will collect cleanup callbacks registered during init
        let registeredHandlers: Array<() => void> = [];

        const initMapAndLoadMarkers = async () => {
            setIsLoading(true);
            setError(null);

            try {
                let mapContainer = mapContainerRef.current || document.getElementById('map');
                if (!mapContainer) {
                    let attempts = 0;
                    while (!mapContainer && attempts < 20) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                        mapContainer = mapContainerRef.current || document.getElementById('map');
                        attempts++;
                    }
                }

                if (!mapContainer) {
                    throw new Error('Контейнер карты #map не найден в DOM после ожидания');
                }

                let sizeAttempts = 0;
                while (!checkVisibility(mapContainer) && sizeAttempts < 50) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    sizeAttempts++;
                }

                if (mapContainer.offsetWidth === 0 || mapContainer.offsetHeight === 0) {
                    if (initRetryRef.current < 5) {
                        initRetryRef.current += 1;
                        setTimeout(() => {
                            try { initMapAndLoadMarkers(); } catch (e) { }
                        }, 300);
                        return;
                    }
                    setIsLoading(false);
                    return;
                }

                const config: MapConfig = {
                    provider: 'leaflet',
                    center,
                    zoom,
                    markers: []
                };

                let initResult: any = null;
                try {
                    const registeredApi = typeof mapFacade().getRegisteredApi === 'function' ? mapFacade().getRegisteredApi() : (INTERNAL as any)?.api;
                    if (registeredApi && (registeredApi.map || registeredApi.mapInstance)) {
                        initResult = registeredApi;
                    }
                } catch (e) { }

                if (!initResult) {
                    let initAttempts = 0;
                    const maxInitAttempts = 3;
                    while (initAttempts < maxInitAttempts) {
                        try {
                            initResult = await projectManager.initializeMap(mapContainer, { ...config, preserveState: true } as any);
                            break;
                        } catch (err) {
                            initAttempts++;
                            if (initAttempts >= maxInitAttempts) {
                                throw err;
                            }
                            await new Promise(resolve => setTimeout(resolve, 300 * initAttempts));
                        }
                    }
                }

                const facadeApi = (INTERNAL as any)?.api || initResult || {};
                if (facadeApi && (facadeApi as any).map) {
                    mapRef.current = (facadeApi as any).map as any;
                } else if (facadeApi && (facadeApi as any).mapInstance) {
                    mapRef.current = (facadeApi as any).mapInstance as any;
                                } else {
                    // FACADE: Используем OSMMapRenderer вместо прямого вызова L.map
                    try {
                        // Используем фасад для инициализации карты как последний вариант
                        await mapFacade().initialize(mapContainer, { ...config, preserveState: true });
                        mapRef.current = mapFacade().getMap?.();
                    } catch (e) {
                        console.error("Ошибка инициализации карты через фасад", e);
                    }
                }

                if (!mapRef.current) {
                    throw new Error('Фасад не вернул карту после инициализации.');
                }

                const map = mapRef.current;

                if (mapRef.current && typeof (mapRef.current as any).addLayer !== 'function') {
                    const possibleInner = (facadeApi as any)?.map || (facadeApi as any)?.mapInstance || (initResult && (initResult as any).map);
                    if (possibleInner && typeof possibleInner.addLayer === 'function') {
                        mapRef.current = possibleInner as any;
                    }
                }

                const tileLayerInfo = getTileLayer(mapSettings.mapType);
                let hasTileLayer = false;
                map.eachLayer((layer: any) => {
                    // Avoid direct instanceof check against Leaflet classes; rely on layer properties instead
                    if ((layer as any)?._url === 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png') {
                        hasTileLayer = true;
                        tileLayerRef.current = layer;
                    }
                });

                if (!hasTileLayer) {
                    // Use facade to add tile layer so we keep Leaflet usage centralized
                    const tileLayer = mapFacade().addTileLayer(tileLayerInfo.url, {
                        attribution: tileLayerInfo.attribution,
                        maxZoom: 19,
                        subdomains: 'abc',
                    });
                    tileLayerRef.current = tileLayer;
                }

                const additionalLayers = getAdditionalLayers(mapSettings.showTraffic, mapSettings.showBikeLanes);
                additionalLayers.forEach(layer => {
                    // layers may be L.TileLayer instances, add them using facade when map is managed by facade
                    try { (layer as any).addTo(map); } catch (e) { }
                });

                if (!map.zoomControl) {
                    mapFacade().setZoomControl('bottomright');
                }

                setTimeout(() => {
                    if (mapRef.current) {
                        try { mapRef.current.invalidateSize(); } catch (e) { }
                    }
                }, 100);

                mapRef.current?.eachLayer((layer: any) => {
                    if (layer && typeof layer.getLayers === 'function' && layer !== markerClusterGroupRef.current) {
                        try { mapRef.current?.removeLayer(layer); } catch (e) { }
                    }
                });

                // Подписываемся на событие завершения перемещения через фасад
                const boundsHandler = () => {
                    try {
                        const mapInstance = mapFacade().getMap?.() ?? mapRef.current;
                        if (!mapInstance || !onBoundsChange) return;
                        const bounds = mapInstance.getBounds();
                        if (bounds && typeof bounds.getNorth === 'function') {
                            onBoundsChange({
                                north: bounds.getNorth(),
                                south: bounds.getSouth(),
                                east: bounds.getEast(),
                                west: bounds.getWest()
                            });
                        }
                    } catch (err) {
                        console.debug('[Map] boundsHandler error:', err);
                    }
                };

                mapFacade().onMapMove(boundsHandler);

                // Подписываемся на клик карты через фасад
                const handleMapClick = async (e: any) => {
                    try {
                        if (!mapRef.current) return; // Guard to avoid crashes if map is gone
                        if (isAddingMarkerModeRef.current) {
                            if (tempMarkerRef.current) {
                                try { mapRef.current.removeLayer(tempMarkerRef.current); } catch (err) { }
                            }

                            const clickedLatLng = e.latlng;
                            const zoom = mapRef.current.getZoom();
                            const mapSize = mapRef.current.getSize();
                            const targetScreenY = mapSize.y * 0.25;
                            const screenCenterY = mapSize.y / 2;
                            const offsetY = targetScreenY - screenCenterY;
                            const projectedClick = mapRef.current.project(clickedLatLng, zoom);
                            const targetCenterPoint = mapFacade().point(projectedClick.x, projectedClick.y - offsetY);
                            const targetCenterLatLng = mapRef.current.unproject(targetCenterPoint, zoom);
                            try { mapRef.current.setView(targetCenterLatLng, zoom, { animate: true }); } catch (err) { }

                            const tempIcon = mapFacade().createDivIcon({
                                className: 'temp-marker-icon',
                                html: '<div style="background-color: red; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3); z-index: 3000;"></div>',
                                iconSize: [20, 20],
                                iconAnchor: [10, 10],
                            });

                            const newTempMarker = mapFacade().createMarker([clickedLatLng.lat, clickedLatLng.lng], { icon: tempIcon });
                            setTempMarker(newTempMarker);

                            const placeFound = await handlePlaceDiscovery(clickedLatLng.lat, clickedLatLng.lng);
                            setCoordsForNewMarker([clickedLatLng.lat, clickedLatLng.lng]);

                            if (!placeFound) {
                                setMapMessage('ℹ️ Место не найдено, можно добавить вручную');
                                setTimeout(() => setMapMessage(null), 3000);
                            }

                            setIsAddingMarkerMode(false);
                            setMapMessage(null);
                        } else if (onMapClick) {
                            onMapClick([e.latlng.lat, e.latlng.lng]);
                        }
                    } catch (err) {
                        console.debug('[Map] handleMapClick error:', err);
                    }
                };

                mapFacade().onMapClick(handleMapClick);

                // Сохраняем функции для последующего удаления при unmount
                registeredHandlers.push(() => mapFacade().offMapMove(boundsHandler));
                registeredHandlers.push(() => mapFacade().offMapClick(handleMapClick));

                // Attach to local cleanup via closure: ensure we remove handlers when component unmounts
                // We'll call these in the main effect cleanup below (see return).

                setIsLoading(false);
                setIsMapReady(true);

            } catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                const isNonCriticalError =
                    errMsg.includes('runtime.lastError') ||
                    errMsg.includes('message port closed') ||
                    errMsg.includes('CORS') ||
                    errMsg.includes('Failed to fetch') ||
                    errMsg.includes('NetworkError');

                if (isNonCriticalError && mapRef.current) {
                    setIsLoading(false);
                    setError(null);
                    return;
                }

                if (!isNonCriticalError && !mapRef.current) {
                    setError(t('map.error.initialization') || 'Ошибка инициализации карты');
                } else {
                    setError(null);
                }
                setIsLoading(false);
            }
        };

        initMapAndLoadMarkers();

        return () => {
            if (mapRef.current) {
                if (tempMarkerRef.current) {
                    try { mapRef.current.removeLayer(tempMarkerRef.current); } catch (e) { }
                    tempMarkerRef.current = null;
                }
            }

            // Call any registered facade handler removers
            try {
                if (registeredHandlers && Array.isArray(registeredHandlers)) {
                    registeredHandlers.forEach(fn => {
                        try { fn(); } catch (e) { }
                    });
                }
            } catch (e) { }
        };
    }, [leftContent, center, zoom, mapSettings.mapType, onBoundsChange, onMapClick]);

    // --- MAP STATE SAVING ---
    useEffect(() => {
        if (!mapRef.current || !isMapReady) return;

        const map = mapRef.current;

        const saveState = () => {
            try {
                const currentCenter = map.getCenter();
                const currentZoom = map.getZoom();
                useMapStateStore.getState().saveCurrentState('osm', [currentCenter.lat, currentCenter.lng], currentZoom);
            } catch (e) { }
        };

        // Register saveState via facade (moveend/zoomend semantics are implemented in renderer)
        mapFacade().onMapMove(saveState);
        mapFacade().onMapZoom(saveState);
        saveState();

        return () => {
            try {
                mapFacade().offMapMove(saveState);
                mapFacade().offMapZoom(saveState);
            } catch (e) { }
        };
    }, [isMapReady]);

    // --- MAP TYPE CHANGE ---
    useEffect(() => {
        if (!mapRef.current) return;
        const map = mapRef.current;
        const tileLayerInfo = getTileLayer(mapSettings.mapType);

        if (tileLayerRef.current) {
            map.removeLayer(tileLayerRef.current);
        }

        const newTileLayer = mapFacade().addTileLayer(tileLayerInfo.url, {
            attribution: tileLayerInfo.attribution,
            maxZoom: 19,
            subdomains: 'abc',
        });
        tileLayerRef.current = newTileLayer;
    }, [mapSettings.mapType]);

    // --- TRAFFIC & BIKE LANES ---
    useEffect(() => {
        if (!mapRef.current) return;
        const map = mapRef.current;

        map.eachLayer((layer: any) => {
            // Avoid instanceof checks against Leaflet classes; rely on properties instead
            const containerClass = (layer as any).getContainer?.()?.className || '';
            if (((layer as any)?._url || containerClass.includes('traffic-layer') || containerClass.includes('bike-lanes-layer'))) {
                try { map.removeLayer(layer); } catch (e) { }
            }
        });

        document.querySelectorAll('.layer-indicator').forEach(indicator => indicator.remove());

        if (L) {
            const additionalLayers = getAdditionalLayers(mapSettings.showTraffic, mapSettings.showBikeLanes);
            additionalLayers.forEach((layer) => {
                layer.addTo(map);
                const layerType = (layer as any).getContainer?.()?.className?.includes('traffic-layer') ? 'traffic' : 'bike';
                const indicator = createLayerIndicator(layerType);
                map.getContainer().appendChild(indicator);
            });
        }
    }, [mapSettings.showTraffic, mapSettings.showBikeLanes]);

    // --- MARKERS RENDER (moved to hook) ---
    useMapMarkers({
      mapRef,
      markerClusterGroupRef,
      tileLayerRef,
      markersData,
      isDarkMode,
      filters,
      searchRadiusCenter,
      mapSettings,
      openEvents,
      selectedEvent,
      leftContent,
      rightContent,
      isMapReady,
      setMiniPopup,
      setEventMiniPopup,
      setSelectedMarkerIdForPopup,
      setSelectedMarkerIds,
      isFavorite,
      onHashtagClickFromPopup,
      onAddToFavorites,
      onRemoveFromFavorites,
      onAddToBlog
    });
















    // --- UNIFIED POPUP HANDLER ---
    useEffect(() => {
        if (!markerClusterGroupRef.current) return;

        markerClusterGroupRef.current.eachLayer((layer: any) => {
            if (!layer.markerData) return;

            const markerId = String(layer.markerData.id);
            const isSelected = selectedMarkerIds?.includes(markerId) || false;
            const shouldClose = (selectedMarkerIdForPopup && selectedMarkerIdForPopup === markerId) || 
                (isSelected && (selectedMarkerIds?.length || 0) > 0);

            if (shouldClose && typeof layer.closePopup === 'function') {
                try { layer.closePopup(); } catch (e) { }
            }

            const popup = layer.getPopup?.();
            if (popup) {
                const element = popup.getElement();
                if (element) {
                    if (isSelected && selectedMarkerIdForPopup === markerId) {
                        element.classList.add('selected');
                    } else {
                        element.classList.remove('selected');
                    }
                }
            }
        });
    }, [selectedMarkerIdForPopup, selectedMarkerIds, markersData]);

    // --- EVENT MARKER CENTERING ---
    useEffect(() => {
        if (!mapRef.current || !selectedEvent) return;
        if (selectedEvent.latitude == null || selectedEvent.longitude == null) return;

        const lat = selectedEvent.latitude;
        const lng = selectedEvent.longitude;
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;

        try {
            mapRef.current.setView([lat, lng], 14, { animate: true, duration: 0.5 });
        } catch (error) { }
    }, [selectedEvent]);

    // --- ROUTE RENDER ---
    useEffect(() => {
        if (!mapRef.current || !routeData) return;

        mapRef.current.eachLayer((layer: any) => {
            if ((layer as any).isRouteLayer) {
                try { mapRef.current?.removeLayer(layer); } catch (e) { }
            }
        });

        let routePolyline: any = null;
        let allLatLngs: any[] = [];

        const hasPolyline = routeData.polyline && Array.isArray(routeData.polyline) && routeData.polyline.length > 1;
        if (hasPolyline) {
            const validPolyline = routeData.polyline.filter(point =>
                Array.isArray(point) && point.length === 2 &&
                typeof point[0] === 'number' && typeof point[1] === 'number' &&
                !isNaN(point[0]) && !isNaN(point[1])
            );

            if (validPolyline.length >= 2) {
                routePolyline = mapFacade().createPolyline(validPolyline, {
                    color: '#ff3b3b',
                    weight: 4,
                    opacity: 0.9,
                    dashArray: '12, 12',
                    className: 'route-polyline'
                });
                if (routePolyline) {
                    (routePolyline as any).isRouteLayer = true;
                }
                allLatLngs = validPolyline.map(([lat, lng]) => mapFacade().latLng(lat, lng));
            }
        }

        if (!routePolyline && routeData.markers && Array.isArray(routeData.markers) && routeData.markers.length > 1) {
            const fallback = routeData.markers
                .map((m: any) => [Number(m.latitude), Number(m.longitude)] as [number, number])
                .filter(([lat, lng]) => !isNaN(lat) && !isNaN(lng));
            if (fallback.length > 1) {
                routePolyline = mapFacade().createPolyline(fallback, {
                    color: '#ff3b3b',
                    weight: 4,
                    opacity: 0.9,
                    dashArray: '12, 12',
                    className: 'route-polyline'
                });
                if (routePolyline) {
                    (routePolyline as any).isRouteLayer = true;
                }
                allLatLngs = fallback.map(([lat, lng]) => mapFacade().latLng(lat, lng));
            }
        }

        const routeStyle = document.createElement('style');
        routeStyle.innerHTML = `.route-polyline { stroke-dasharray: 12, 12 !important; animation: route-dash 2s linear infinite; } @keyframes route-dash { 0% { stroke-dashoffset: 0; } 100% { stroke-dashoffset: 24; } }`;
        document.head.appendChild(routeStyle);

        if (routeData.markers && Array.isArray(routeData.markers)) {
            routeData.markers.forEach((marker: any, index: number) => {
                if (!marker || typeof marker !== 'object') return;
                const lat = parseFloat(marker.latitude);
                const lng = parseFloat(marker.longitude);
                if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                    const routeIcon = mapFacade().createDivIcon({
                        className: 'route-marker-icon',
                        html: `<div class="route-marker-base"><div class="route-marker-number">${index + 1}</div><div class="route-marker-icon-inner"><i class="fas fa-route"></i></div></div>`,
                        iconSize: [40, 40],
                        iconAnchor: [20, 40]
                    });
                    const routeMarker = mapFacade().createMarker([lat, lng], { icon: routeIcon });
                    (routeMarker as any).isRouteLayer = true;
                }
            });
        }

        if (mapRef.current && allLatLngs.length > 0) {
            const bounds = mapFacade().latLngBounds(allLatLngs);
            mapFacade().fitBounds(bounds, { padding: [60, 60] });
        }

        let zoomHandler: any;
        if (mapRef.current && routePolyline) {
            const updateStyle = () => {
                const z = mapRef.current?.getZoom() ?? 0;
                const weight = z <= 5 ? 8 : z <= 8 ? 6 : z <= 12 ? 5 : 4;
                routePolyline!.setStyle({ weight });
            };
            updateStyle();
            zoomHandler = () => updateStyle();
            mapRef.current.on('zoomend', zoomHandler);
        }

        const routeStyles = document.createElement('style');
        routeStyles.innerHTML = `.route-marker-icon { background: transparent !important; border: none !important; } .route-marker-base { position: relative; width: 40px; height: 40px; background: linear-gradient(135deg, #ff6b35, #f7931e); border-radius: 50%; border: 3px solid #fff; box-shadow: 0 4px 12px rgba(255, 107, 53, 0.4); display: flex; align-items: center; justify-content: center; animation: route-pulse 2s ease-in-out infinite; } .route-marker-number { position: absolute; top: -8px; right: -8px; background: #fff; color: #ff6b35; border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold; border: 2px solid #ff6b35; } @keyframes route-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.1); } }`;
        document.head.appendChild(routeStyles);

        return () => {
            if (mapRef.current) {
                mapRef.current.eachLayer((layer: L.Layer) => {
                    if ((layer as any).isRouteLayer) {
                        mapRef.current?.removeLayer(layer);
                    }
                });
                if (zoomHandler) {
                    mapRef.current.off('zoomend', zoomHandler);
                }
            }
            document.querySelectorAll('style').forEach(s => {
                if (s.innerHTML.includes('route-marker') || s.innerHTML.includes('route-polyline')) {
                    document.head.removeChild(s);
                }
            });
        };
    }, [routeData]);

    // --- ZONES RENDER ---
    useEffect(() => {
        if (!mapRef.current) return;

        mapRef.current.eachLayer((layer: any) => {
            if ((layer as any)?.isZoneLayer) {
                try { mapRef.current?.removeLayer(layer); } catch (e) { }
            }
        });

        zones.forEach(zone => {
            const color = (zone.severity === 'critical') ? '#EF4444' : (zone.severity === 'warning') ? '#F59E0B' : '#FB923C';

            zone.polygons.forEach(ring => {
                const latLngs = ring.map(([lng, lat]) => [lat, lng] as [number, number]);
                const polygon = mapFacade().createPolygon(latLngs, {
                    color: color,
                    fillColor: color,
                    fillOpacity: 0.2,
                    weight: 2,
                });

                // ИСПРАВЛЕНИЕ: Добавляем полигон на карту и помечаем его
                if (polygon && mapRef.current && typeof (polygon as any).addTo === 'function') {
                    polygon.addTo(mapRef.current);
                    (polygon as any).isZoneLayer = true;
                }
            });
        });
    }, [zones]);

    // --- FLY TO ---
    useEffect(() => {
        if (flyToCoordinates && mapRef.current) {
            mapRef.current.flyTo(flyToCoordinates, mapRef.current.getZoom(), { animate: true, duration: 1.2 });
        }
    }, [flyToCoordinates]);

    // --- SEARCH RADIUS CIRCLE ---
    useEffect(() => {
        if (!mapRef.current) return;
        let radiusCircle: any = null;

        if (filters.radiusOn) {
            radiusCircle = mapFacade().createCircle(searchRadiusCenter, {
                radius: filters.radius * 1000,
                color: mapSettings.themeColor,
                fillColor: mapSettings.themeColor,
                fillOpacity: 0.15,
                weight: 2,
                interactive: true,
            });

            if (radiusCircle) {
                radiusCircle.on('mousedown', function (_: any) {
                    mapRef.current?.dragging?.disable();
                    const onMove = (ev: any) => {
                        if (radiusCircle) radiusCircle.setLatLng(ev.latlng);
                    };
                    const onUp = (ev: any) => {
                        onSearchRadiusCenterChange([ev.latlng.lat, ev.latlng.lng]);
                        mapRef.current?.off('mousemove', onMove);
                        mapRef.current?.off('mouseup', onUp);
                        mapRef.current?.dragging?.enable();
                    };
                    mapRef.current?.on('mousemove', onMove);
                    mapRef.current?.on('mouseup', onUp);
                });
            }
        }

        return () => { if (radiusCircle) radiusCircle.remove(); };
    }, [filters.radiusOn, filters.radius, searchRadiusCenter, mapSettings.themeColor]);

    // --- MINI POPUP CLOSE ON MOVE ---
    useEffect(() => {
        if (!mapRef.current) return;
        const map = mapRef.current;

        const closeMiniPopup = () => {
            setMiniPopup(null);
            setEventMiniPopup(null);
        };

        map.on('movestart', closeMiniPopup);
        map.on('zoomstart', closeMiniPopup);

        return () => {
            map.off('movestart', closeMiniPopup);
            map.off('zoomstart', closeMiniPopup);
        };
    }, []);

    // --- PLACE DISCOVERY ---
    const handlePlaceDiscovery = async (latitude: number, longitude: number) => {
        try {
            setIsDiscoveringPlace(true);
            setMapMessage('🔍 Ищем информацию об этом месте...');

            const hasExistingMarker = await placeDiscoveryService.checkExistingMarker(latitude, longitude);
            if (hasExistingMarker) {
                setMapMessage('⚠️ Здесь уже есть метка');
                setTimeout(() => setMapMessage(null), 3000);
                setIsDiscoveringPlace(false);
                return false;
            }

            const searchResult = await placeDiscoveryService.discoverPlace(latitude, longitude);

            if (searchResult.places.length > 0 && searchResult.bestMatch) {
                setDiscoveredPlace(searchResult.bestMatch);
                setMapMessage(null);
                setIsDiscoveringPlace(false);
                return true;
            } else {
                setMapMessage('ℹ️ Место не найдено, можно добавить вручную');
                setTimeout(() => setMapMessage(null), 3000);
                setIsDiscoveringPlace(false);
                return false;
            }
        } catch (error) {
            setMapMessage('❌ Ошибка при поиске места');
            setTimeout(() => setMapMessage(null), 3000);
            setIsDiscoveringPlace(false);
            return false;
        }
    };

    // --- ADD MARKER ---
    const handleAddMarker = async (data: any) => {
        try {
            const token = localStorage.getItem('token');
            if (!token) {
                setMapMessage('Ошибка: необходимо авторизоваться');
                setTimeout(() => setMapMessage(null), 3000);
                return;
            }

            if (FEATURES.GEOGRAPHIC_RESTRICTIONS_ENABLED) {
                const coordinateCheck = russiaRestrictions.checkCoordinates(data.latitude, data.longitude);
                if (!coordinateCheck.isValid) {
                    setMapMessage(`Ошибка: ${coordinateCheck.errorMessage}`);
                    setTimeout(() => setMapMessage(null), 5000);
                    return;
                }

                const zoneCheck = await canCreateMarker(data.latitude, data.longitude);
                if (!zoneCheck.allowed) {
                    setMapMessage(`Ошибка: ${zoneCheck.reason}`);
                    setTimeout(() => setMapMessage(null), 5000);
                    return;
                }
            }

            const markerData = {
                title: data.title,
                description: data.description,
                latitude: data.latitude,
                longitude: data.longitude,
                category: data.category,
                hashtags: data.hashtags || '',
                photoUrls: data.photoUrls || '',
                address: data.address || ''
            };

            const newMarker = await markerService.createMarker(markerData);

            await activityService.createActivityHelper(
                'marker_created',
                'marker',
                newMarker.id,
                { title: newMarker.title, category: newMarker.category, coordinates: [newMarker.latitude, newMarker.longitude] }
            );

            setMarkersData(prev => [...prev, newMarker]);
            setMapMessage('Метка успешно добавлена!');
            setTimeout(() => setMapMessage(null), 3000);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';
            setMapMessage(`Ошибка при добавлении метки: ${errorMessage}`);
            setTimeout(() => setMapMessage(null), 5000);
        }
    };

    // --- SYNC EXTERNAL ADD MARKER MODE ---
    useEffect(() => {
        if (externalIsAddingMarkerMode !== undefined) {
            if (externalIsAddingMarkerMode) {
                setMapMessage('🎯 Кликните на карту, чтобы добавить метку');
            } else {
                setMapMessage(null);
            }
        }
    }, [externalIsAddingMarkerMode]);

    // --- HELPER FUNCTIONS ---
    // NOTE: use `latLngToContainerPoint` from `mapUtils` which uses facade to avoid leaking map instance
    // Local helper removed — use exported `latLngToContainerPoint(mapFacade, latlng)` instead.

    // --- MAP READY CHECK ---
    const isMapReadyCheck = isMapReady || mapRef.current || ((mapFacade() as any)?.INTERNAL?.api?.map);

    // --- SELECTED MARKER POPUP ---
    const selectedMarkerPopup = useMemo(() => {
        if (!selectedMarkerIdForPopup) return null;
        const marker = markersData.find(m => m.id === selectedMarkerIdForPopup);
        if (!marker) return null;

        const markerPosition = latLngToContainerPoint(mapFacade(), mapFacade().latLng(Number(marker.latitude), Number(marker.longitude)));

        return (
            <div
                key={`popup-${selectedMarkerIdForPopup}`}
                style={{
                    position: 'absolute',
                    left: markerPosition.x,
                    top: markerPosition.y,
                    transform: 'translate(-50%, -100%)',
                    zIndex: 1300,
                }}
                className="popup-card-fixed"
            >
                <MarkerPopup
                    marker={marker}
                    onClose={() => setSelectedMarkerIdForPopup(null)}
                    onHashtagClick={onHashtagClickFromPopup}
                    onMarkerUpdate={() => { }}
                    onAddToFavorites={onAddToFavorites}
                    isFavorite={isFavorite(marker)}
                    isSelected={Boolean(isFavorite(marker) && Array.isArray(selectedMarkerIds) && selectedMarkerIds.includes(marker.id))}
                />
            </div>
        );
    }, [selectedMarkerIdForPopup, markersData, selectedMarkerIds]);

    // --- EVENT MINI POPUP ---
    const eventPopup = eventMiniPopup && eventMiniPopup.position && (
        <div
            style={{
                position: 'absolute',
                left: eventMiniPopup.position.x,
                top: eventMiniPopup.position.y,
                transform: 'translate(-50%, -100%)',
                marginBottom: '10px',
                zIndex: 9999,
                pointerEvents: 'auto'
            }}
            onMouseLeave={() => { setEventMiniPopup(null); }}
        >
            <EventMiniPopup
                event={eventMiniPopup.event}
                onOpenFull={() => {
                    setEventMiniPopup(null);
                    setSelectedEvent(eventMiniPopup.event);
                }}
                isSelected={selectedEvent?.id === eventMiniPopup.event.id}
                showGoButton={true}
            />
        </div>
    );

    // --- MAIN MINI POPUP ---
    const miniPopupElement = miniPopup && (
        <div
            style={{
                position: 'absolute',
                left: miniPopup.position.x,
                top: miniPopup.position.y,
                zIndex: 1200,
                transform: 'translate(-50%, -100%)',
            }}
            onMouseLeave={() => { setMiniPopup(null); }}
        >
            <MiniMarkerPopup
                marker={miniPopup.marker}
                onOpenFull={() => {
                    const markerId = miniPopup?.marker?.id;
                    setMiniPopup(null);
                    if (markerId) {
                        setSelectedMarkerIdForPopup(markerId);
                    }
                }}
                isSelected={false}
            />
        </div>
    );

    // --- SELECTED MARKERS MINI POPUPS ---
    const selectedMarkerPopups = selectedMarkerIds?.map((markerId: string) => {
        const marker = markersData.find(m => m.id === markerId) || markers?.find(m => m.id === markerId);
        if (!marker) return null;

        if (selectedMarkerIdForPopup === markerId || (miniPopup && miniPopup.marker.id === markerId)) {
            return null;
        }

        return (
            <div
                key={`selected-${markerId}`}
                style={{
                    position: 'absolute',
                    left: latLngToContainerPoint(mapFacade(), mapFacade().latLng(Number(marker.latitude), Number(marker.longitude))).x,
                    top: latLngToContainerPoint(mapFacade(), mapFacade().latLng(Number(marker.latitude), Number(marker.longitude))).y,
                    zIndex: 1199,
                    transform: 'translate(-50%, -100%)',
                }}
            >
                <MiniMarkerPopup
                    marker={marker}
                    onOpenFull={() => {
                        setMiniPopup(null);
                        setSelectedMarkerIdForPopup(markerId);
                    }}
                    isSelected={true}
                />
            </div>
        );
    });

    // --- JSX RENDER ---
    const mapContent = (
        <MapContainer>
            {isLoading && (
                <div style={{ position: 'absolute', left: '50%', top: '50%', zIndex: 2000, transform: 'translate(-50%, -50%)' }}>
                    <CircularProgressBar value={progress} size={90} />
                </div>
            )}
            <GlobalLeafletPopupStyles />

            <MapWrapper
                id="map"
                className="facade-map-root"
                ref={mapContainerRef}
                style={{
                    ...mapStyle,
                    transform: isTwoPanelMode ? 'translateX(-20%)' : 'none',
                    width: isTwoPanelMode ? '140%' : '100%',
                    transition: 'transform 0.3s ease, width 0.3s ease',
                }}
            >
                {coordsForNewMarker && showCultureMessage && (
                    <div
                        style={{
                            position: 'absolute',
                            top: '50%',
                            left: '50%',
                            transform: 'translate(-50%, calc(-50% - 20vh - 60px))',
                            zIndex: 2001,
                            maxWidth: '220px',
                            width: '220px',
                        }}
                        className="culture-info-panel"
                    >
                        <GlassPanel
                            isOpen={true}
                            onClose={() => { }}
                            position="center"
                            width="220px"
                            closeOnOverlayClick={false}
                            showCloseButton={false}
                            className="culture-info-glass"
                        >
                            <div className="glass-panel-culture">
                                <div className="glass-panel-culture-header">
                                    🎯 Культура меток
                                </div>
                                <div style={{ opacity: 0.9 }}>
                                    Добавляйте места с уважением к реальности. Название должно быть достоверным и понятным для всех путешественников.
                                </div>
                            </div>
                        </GlassPanel>
                    </div>
                )}

                {coordsForNewMarker && (
                    <ElegantAccordionForm
                        coords={coordsForNewMarker}
                        showCultureMessage={false}
                        onSubmit={async (data: any) => {
                            if (mapRef.current && tempMarkerRef.current) {
                                mapRef.current.removeLayer(tempMarkerRef.current);
                                setTempMarker(null);
                            }
                            const markerDataWithCoords = {
                                ...data,
                                latitude: coordsForNewMarker![0],
                                longitude: coordsForNewMarker![1]
                            };
                            await handleAddMarker(markerDataWithCoords);
                            setCoordsForNewMarker(null);
                            setDiscoveredPlace(null);
                        }}
                        onCancel={() => {
                            if (mapRef.current && tempMarkerRef.current) {
                                mapRef.current.removeLayer(tempMarkerRef.current);
                                setTempMarker(null);
                            }
                            setCoordsForNewMarker(null);
                            setDiscoveredPlace(null);
                            setShowCultureMessage(true);
                        }}
                        discoveredPlace={discoveredPlace}
                        onCultureMessageClose={() => setShowCultureMessage(false)}
                    />
                )}

                {selectedMarkerPopup}
                {eventPopup}
                {mapMessage && <MapMessage>{mapMessage}</MapMessage>}

                {isDiscoveringPlace && (
                    <div className="map-overlay-loading">
                        <div style={{
                            width: '40px',
                            height: '40px',
                            border: '4px solid #e2e8f0',
                            borderTop: '4px solid #4299e1',
                            borderRadius: '50%',
                            animation: 'spin 1s linear infinite'
                        }} />
                        <div style={{ color: '#2d3748', fontSize: '16px', fontWeight: '600', textAlign: 'center' }}>
                            🔍 Ищем место...
                        </div>
                        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
                    </div>
                )} 
            </MapWrapper>

            {isLoading && (
                <LoadingOverlay>
                    <div className="loading-content">
                        <div className="spinner" />
                        <p>{t('map.loading')}</p>
                    </div>
                </LoadingOverlay>
            )}

            {error && !isMapReadyCheck && (
                <ErrorMessage>
                    <p>{error}</p>
                    <button onClick={() => window.location.reload()}>
                        {t('map.error.retry')}
                    </button>
                </ErrorMessage>
            )}

            {legendOpen && (
                <MapLegend
                    onClose={() => {
                        if (onLegendOpenChange) {
                            onLegendOpenChange(false);
                        } else {
                            setLegendOpen(false);
                        }
                    }}
                    mapSettings={mapSettings}
                />
            )}

            {miniPopupElement}
            {selectedMarkerPopups}
        </MapContainer>
    );

    if (portalEl) {
        return createPortal(mapContent, portalEl);
    }

    return mapContent;
}

export default Map;
























































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































