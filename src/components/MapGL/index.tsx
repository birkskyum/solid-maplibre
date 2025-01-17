import {
  createSignal,
  createEffect,
  onMount,
  onCleanup,
  createContext,
  useContext,
  Component,
  createUniqueId,
  untrack,
} from 'solid-js'
import { mapEvents } from '../../events'
import { vectorStyleList } from '../../mapStyles'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { MapboxMap, MapboxOptions } from 'mapbox-gl/src/ui/map'
import type { LngLatLike } from 'mapbox-gl/src/geo/lng_lat.js'
import type { LngLatBounds } from 'mapbox-gl/src/geo/lng_lat_bounds.js'
import type { PaddingOptions } from 'mapbox-gl/src/geo/edge_insets.js'
import type { StyleSpecification } from 'mapbox-gl/src/style-spec/types.js'
import type { JSX } from 'solid-js'

export type Viewport = {
  id?: string
  center?: LngLatLike
  bounds?: LngLatBounds
  zoom?: number
  pitch?: number
  bearing?: number
  padding?: PaddingOptions
}

const MapContext = createContext<MapboxMap>()
/** Provides the Mapbox Map Object */
export const useMap = (): MapboxMap => useContext(MapContext)

/** Creates a new Map Container */
export const MapGL: Component<{
  id?: string
  /** Map Container CSS Style */
  style?: JSX.CSSProperties
  /** Map Container CSS Class */
  class?: string
  /** SolidJS Class List for Map Container */
  classList?: {
    [k: string]: boolean | undefined
  }
  /** Current Map View */
  viewport?: Viewport
  /** Mapbox Options
   * @see https://docs.mapbox.com/mapbox-gl-js/api/map/#map-parameters
   */
  options?: MapboxOptions
  /** Type for pan, move and zoom transitions */
  transitionType?: 'flyTo' | 'easeTo' | 'jumpTo'
  /** Event listener for Viewport updates */
  onViewportChange?: (viewport: Viewport) => void
  /** Displays Map Tile Borders */
  showTileBoundaries?: boolean
  /** Displays Wireframe if Terrain is visible */
  showTerrainWireframe?: boolean
  /** Displays Borders if Padding is set */
  showPadding?: boolean
  /** Displays Label Collision Boxes */
  showCollisionBoxes?: boolean
  /** Displays all feature outlines even if normally not drawn by style rules */
  showOverdrawInspector?: boolean
  /** Mouse Cursor Style */
  cursorStyle?: string
  //** Dark Map Style */
  darkStyle?: StyleSpecification | string
  //** Disable automatic map resize */
  disableResize?: boolean
  //** Debug Mode */
  debug?: boolean
  ref?: HTMLDivElement
  /** Children within the Map Container */
  children?: any
}> = props => {
  props.id = props.id || createUniqueId()

  const [mapRoot, setMapRoot] = createSignal<MapboxMap>()
  const [transitionType, setTransitionType] = createSignal('flyTo')
  const [darkMode, setDarkMode] = createSignal(
    window.matchMedia('(prefers-color-scheme: dark)').matches ||
      document.body.classList.contains('dark')
  )

  const debug = (text, value) =>
    props.debug && console.debug(`${text}: %c${value}`, 'color: #00F')

  const mapRef = (
    <div
      id={props.id}
      class={props?.class}
      classList={props?.classList}
      style={{ position: 'absolute', inset: 0, ...props.style }}
    />
  )

  const getStyle = (light, dark) => {
    const style = darkMode() ? dark || light : light
    return typeof style === 'string' || style instanceof String
      ? style?.split(':').reduce((p, c) => p && p[c], vectorStyleList) || style
      : style || { version: 8, sources: {}, layers: [] }
  }

  onMount(() => {
    const map: MapboxMap = new mapboxgl.Map({
      ...props.options,
      style: getStyle(props.options.style, props.darkStyle),
      container: mapRef,
      interactive: !!props.onViewportChange,
      bounds: props.viewport?.bounds,
      center: props.viewport?.center,
      zoom: props.viewport?.zoom || null,
      pitch: props.viewport?.pitch || null,
      bearing: props.viewport?.bearing || null,
      fitBoundsOptions: { padding: props.viewport?.padding },
    } as MapboxOptions)

    map.debug = props.debug
    // map.container = containerRef

    map.once('load').then(() => setMapRoot(map))

    // onCleanup(() => map.remove())

    // Listen to map container size changes
    const resizeObserver = new ResizeObserver(() => map.resize())
    createEffect(() =>
      props.disableResize
        ? resizeObserver.disconnect()
        : resizeObserver.observe(mapRef as Element)
    )

    // Listen to dark theme changes
    const darkTheme = window.matchMedia('(prefers-color-scheme: dark)')
    darkTheme.addEventListener('change', () => setDarkMode(darkTheme.matches))

    const bodyClassObserver = new MutationObserver(() =>
      setDarkMode(document.body.classList.contains('dark'))
    )
    bodyClassObserver.observe(document.body, { attributes: true })

    // Hook up events
    createEffect(() =>
      mapEvents.forEach(item => {
        const prop = props[item]
        if (prop) {
          const event = item.slice(2).toLowerCase()
          if (typeof prop === 'function') {
            const callback = e => prop(e)
            map.on(event, callback)
            onCleanup(() => map.off(event, callback))
          } else {
            Object.keys(prop).forEach(layerId => {
              const callback = e => prop[layerId](e)
              map.on(event, layerId, callback)
              onCleanup(() => map.off(event, layerId, callback))
            })
          }
        }
      })
    )

    // Update debug features
    createEffect(() => {
      map.showTileBoundaries = props.showTileBoundaries
      map.showTerrainWireframe = props.showTerrainWireframe
      map.showPadding = props.showPadding
      map.showCollisionBoxes = props.showCollisionBoxes
      map.showOverdrawInspector = props.showOverdrawInspector
    })

    // Update cursor
    createEffect(prev => {
      if (props.cursorStyle === prev) return
      debug('Update Cursor to', props.cursorStyle)
      map.getCanvas().style.cursor = props.cursorStyle
      return props.cursorStyle
    })

    //Update transition type
    createEffect(prev => {
      if (props.transitionType === prev) return
      debug('Update Transition to', props.transitionType)
      setTransitionType(props.transitionType)
      return props.transitionType
    })

    // Update projection
    createEffect(prev => {
      if (props.options?.projection === prev) return
      debug('Update Projection to', props.options?.projection.name)
      map.setProjection(props.options?.projection)
      return props.options?.projection
    })

    // Update map style
    createEffect(prev => {
      const style = getStyle(props.options?.style, props.darkStyle)
      if (style === prev) return
      let oldLayers = []
      let oldSources = {}
      debug('Update Mapstyle to', style)
      if (map.isStyleLoaded()) {
        const oldStyle = map.getStyle()
        oldLayers = oldStyle.layers.filter(l => l.id.startsWith('cl-'))
        oldSources = Object.keys(oldStyle.sources)
          .filter(s => s.startsWith('cl-'))
          .reduce((obj, key) => ({ ...obj, [key]: oldStyle.sources[key] }), {})
      }
      map.setStyle(style)
      map.once('styledata', () => {
        const newStyle = map.getStyle()
        map.setStyle({
          ...newStyle,
          sources: { ...newStyle.sources, ...oldSources },
          layers: [...newStyle.layers, ...oldLayers],
        })
      })
      return style
    }, props.options?.style)

    // Hook up viewport events
    createEffect(() => {
      const viewport = {
        id: null,
        center: map.getCenter(),
        zoom: map.getZoom(),
        pitch: map.getPitch(),
        bearing: map.getBearing(),
        padding: props.viewport?.padding,
        bounds: props.viewport?.bounds,
      }

      const callMove = event => {
        if (event.originalEvent)
          props.onViewportChange &&
            props.onViewportChange({ ...viewport, id: props.id })
        setTransitionType('jumpTo')
      }

      const callEnd = event => {
        if (event.originalEvent)
          props.onViewportChange && props.onViewportChange(viewport)
        setTransitionType(props.transitionType)
      }

      map.on('move', callMove).on('moveend', callEnd)
      onCleanup(() => map.off('move', callMove).off('moveend', callEnd))
    })

    // Update boundaries
    createEffect(prev => {
      if (props.viewport?.bounds != prev)
        props.onViewportChange({
          ...props.viewport,
          ...map.cameraForBounds(props.viewport?.bounds, {
            padding: props.viewport?.padding,
          }),
        })
      return props.viewport?.bounds
    }, props.viewport?.bounds)

    // Update Viewport
    createEffect(() => {
      if (props.id === props.viewport?.id) return
      const viewport = {
        ...props.viewport,
        padding: props.viewport?.padding || 0,
      }
      switch (untrack(transitionType)) {
        case 'easeTo':
          map.stop().easeTo(viewport)
        case 'jumpTo':
          map.stop().jumpTo(viewport)
        default:
          map.stop().flyTo(viewport)
      }
    })
  })

  return (
    <MapContext.Provider value={mapRoot}>
      {mapRoot() && (
        <div style={{ position: 'absolute', 'z-index': 10 }}>
          {props.children}
        </div>
      )}
      {mapRef}
    </MapContext.Provider>
  )
}
