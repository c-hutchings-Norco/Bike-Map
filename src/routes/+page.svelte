  <script>
    import mapbox from 'mapbox-gl';
    import { onMount, onDestroy } from 'svelte';
    import { scaleLinear, scaleQuantile } from 'd3-scale';
    import { csv } from 'd3-fetch';
    import debounce from 'lodash/debounce';
    import { createStationQuadtree, throttle, calculateStationStats } from '$lib/utils';
    import 'mapbox-gl/dist/mapbox-gl.css';
    import bikeLanes from '../data/bike-lanes-geo.json';
    import bikeTraffic from '../data/bike-traffic.json';
    import bikeNetwork from '../data/Existing_Bike_Network_2022.geojson';

    const MAPBOX_TOKEN = 'pk.eyJ1IjoiY2h1dGNoaW5ncyIsImEiOiJjbTNxZ3NqY28wNHIxMmtvZnc1Zjc0NW12In0.z4_H0bPDZyrgce46gWBCjQ';
    let map;
    let stations = [];
    let markers = new Map(); // Using Map for better performance
    let quadtree;
    let currentHour = 8;
    let showHeatmap = false;
    let selectedStation = null;
    let timeInterval;
    let isPlaying = false;

    // Enhanced color scales
    const trafficColorScale = scaleQuantile()
      .domain([0, 10, 20, 30, 40, 50])
      .range(['#2ecc71', '#a1d344', '#f1c40f', '#e67e22', '#e74c3c', '#c0392b']);

    // Animation controls
    function togglePlayback() {
      isPlaying = !isPlaying;
      if (isPlaying) {
        timeInterval = setInterval(() => {
          currentHour = (currentHour + 1) % 24;
        }, 1000);
      } else {
        clearInterval(timeInterval);
      }
    }

    onDestroy(() => {
      if (timeInterval) clearInterval(timeInterval);
    });

    // Optimized marker update function
    const updateMarkers = throttle(() => {
      if (!map) return;
      
      const bounds = map.getBounds();
      const visibleStations = stations.filter(station => 
        bounds.contains([station.longitude, station.latitude])
      );

      visibleStations.forEach(station => {
        const marker = markers.get(station.id);
        if (marker) {
          const stats = calculateStationStats(station, bikeTraffic, currentHour);
          const el = marker.getElement();
          
          el.style.width = `${10 + Math.sqrt(stats.totalTraffic) * 3}px`;
          el.style.height = el.style.width;
          el.style.backgroundColor = trafficColorScale(Math.abs(stats.netFlow));
          
          // Update popup content
          marker.getPopup().setHTML(`
            <div class="popup-content">
              <h3>${station.name}</h3>
              <div class="stats">
                <div>Pickups: ${stats.pickups}</div>
                <div>Dropoffs: ${stats.dropoffs}</div>
                <div>Net Flow: ${stats.netFlow > 0 ? '+' : ''}${stats.netFlow}</div>
              </div>
            </div>
          `);
        }
      });
    }, 100);

    // Handle map movement
    function onMapMove() {
      if (!map) return;
      
      if (showHeatmap) {
        updateHeatmap();
      } else {
        updateMarkers();
      }
    }

    // Initialize heatmap
    function updateHeatmap() {
      if (!map.getSource('traffic-heat')) {
        map.addSource('traffic-heat', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: stations.map(station => ({
              type: 'Feature',
              geometry: {
                type: 'Point',
                coordinates: [station.longitude, station.latitude]
              },
              properties: {
                traffic: calculateStationStats(station, bikeTraffic, currentHour).totalTraffic
              }
            }))
          }
        });

        map.addLayer({
          id: 'traffic-heat',
          type: 'heatmap',
          source: 'traffic-heat',
          paint: {
            'heatmap-weight': ['get', 'traffic'],
            'heatmap-intensity': 1,
            'heatmap-color': [
              'interpolate',
              ['linear'],
              ['heatmap-density'],
              0, 'rgba(0, 0, 255, 0)',
              0.2, '#2ecc71',
              0.4, '#f1c40f',
              0.6, '#e67e22',
              0.8, '#e74c3c',
              1, '#c0392b'
            ],
            'heatmap-radius': 30
          }
        });
      } else {
        map.getSource('traffic-heat').setData({
          type: 'FeatureCollection',
          features: stations.map(station => ({
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: [station.longitude, station.latitude]
            },
            properties: {
              traffic: calculateStationStats(station, bikeTraffic, currentHour).totalTraffic
            }
          }))
        });
      }
    }

    // Toggle visualization mode
    function toggleVisualizationMode() {
      showHeatmap = !showHeatmap;
      markers.forEach(marker => {
        marker.getElement().style.display = showHeatmap ? 'none' : 'block';
      });
      
      if (showHeatmap) {
        updateHeatmap();
      } else {
        if (map.getLayer('traffic-heat')) {
          map.removeLayer('traffic-heat');
          map.removeSource('traffic-heat');
        }
      }
    }

    async function loadStations() {
      try {
        // Mock data for now
        stations = [
          { 
            id: 1, 
            name: "Station 1", 
            latitude: 42.3601, 
            longitude: -71.0589, 
            capacity: 20 
          },
          { 
            id: 2, 
            name: "Station 2", 
            latitude: 42.3555, 
            longitude: -71.0699, 
            capacity: 15 
          }
        ];
        quadtree = createStationQuadtree(stations);
      } catch (error) {
        console.error('Error loading stations:', error);
        stations = [];
      }
    }

    onMount(async () => {
      await loadStations();
      
      mapbox.accessToken = MAPBOX_TOKEN;
      
      map = new mapbox.Map({
        container: 'map',
        style: 'mapbox://styles/mapbox/light-v11',
        center: [-71.0589, 42.3601],
        zoom: 12
      });

      map.on('load', () => {
        try {
          // Add bike network data
          map.addSource('bike-network', {
            type: 'geojson',
            data: bikeNetwork
          });

          map.addLayer({
            id: 'bike-network',
            type: 'line',
            source: 'bike-network',
            paint: {
              'line-color': [
                'match',
                ['get', 'ExisFacil'],
                'BL', '#3498db',    // Bike Lane
                'BFBL', '#2ecc71',  // Buffered Bike Lane
                'SLM', '#f1c40f',   // Shared Lane Marking
                'SUP', '#9b59b6',   // Separated/Protected
                '#7f8c8d'          // Other/Default
              ],
              'line-width': 3
            }
          });
        } catch (error) {
          console.error('Error adding bike network layer:', error);
        }
        
        // Add bike lanes
        map.addSource('bike-lanes', {
          type: 'geojson',
          data: bikeLanes
        });

        map.addLayer({
          id: 'bike-lanes',
          type: 'line',
          source: 'bike-lanes',
          paint: {
            'line-color': [
              'match',
              ['get', 'type'],
              'protected', '#2ecc71',
              'shared', '#3498db',
              '#7f8c8d'
            ],
            'line-width': 3
          }
        });

        // Add station markers
        markers = stations.map(station => {
          const stats = calculateStationStats(station, bikeTraffic, currentHour);
          const traffic = Math.abs(stats.netFlow);
          
          const el = document.createElement('div');
          el.className = 'station-marker';
          el.style.width = `${10 + traffic * 2}px`;
          el.style.height = `${10 + traffic * 2}px`;
          el.style.backgroundColor = trafficColorScale(Math.abs(stats.netFlow));

          return new mapbox.Marker(el)
            .setLngLat([station.longitude, station.latitude])
            .setPopup(
              new mapbox.Popup({ offset: 25 })
                .setHTML(`
                  <h3>${station.name}</h3>
                  <p>Capacity: ${station.capacity}</p>
                  <p>Net Flow: ${stats.netFlow}</p>
                  <p>Status: ${stats.netFlow > 0 ? 'More pickups' : stats.netFlow < 0 ? 'More dropoffs' : 'Balanced'}</p>
                `)
            )
            .addTo(map);
        });
      });

      map.on('moveend', debounce(onMapMove, 100));
      map.on('zoomend', debounce(onMapMove, 100));
    });

    $: if (currentHour !== undefined && map) {
      if (showHeatmap) {
        updateHeatmap();
      } else {
        updateMarkers();
      }
    }
  </script>

  <main>
    <h1>Boston Bike Map</h1>
    <div id="map"></div>
    
    <div class="controls">
      <div class="visualization-toggle">
        <button on:click={toggleVisualizationMode}>
          {showHeatmap ? 'Show Markers' : 'Show Heatmap'}
        </button>
      </div>

      <div class="time-control">
        <button on:click={togglePlayback}>
          {isPlaying ? '⏸️ Pause' : '▶️ Play'}
        </button>
        <label>
          Hour: <input type="range" min="0" max="23" bind:value={currentHour}>
          {currentHour.toString().padStart(2, '0')}:00
        </label>
      </div>
    </div>

    <div class="legend">
      <h3>Legend</h3>
      <div class="legend-section">
        <h4>Bike Infrastructure</h4>
        <div class="legend-item">
          <div class="line-sample bike-lane"></div>
          <span>Bike Lane</span>
        </div>
        <div class="legend-item">
          <div class="line-sample buffered"></div>
          <span>Buffered Bike Lane</span>
        </div>
        <div class="legend-item">
          <div class="line-sample shared"></div>
          <span>Shared Lane Marking</span>
        </div>
        <div class="legend-item">
          <div class="line-sample protected"></div>
          <span>Protected/Separated</span>
        </div>
      </div>
      
      <div class="legend-section">
        <h4>Traffic Flow</h4>
        <div class="legend-item">
          <div class="circle-sample high-traffic"></div>
          <span>High Traffic (40+ rides)</span>
        </div>
        <div class="legend-item">
          <div class="circle-sample medium-traffic"></div>
          <span>Medium Traffic (20-40 rides)</span>
        </div>
        <div class="legend-item">
          <div class="circle-sample low-traffic"></div>
          <span>Low Traffic (0-20 rides)</span>
        </div>
      </div>

      <div class="legend-section">
        <h4>Visualization Modes</h4>
        <div class="legend-item">
          <span>🎯 Markers: Individual station traffic</span>
        </div>
        <div class="legend-item">
          <span>🌡️ Heatmap: Traffic density areas</span>
        </div>
      </div>
    </div>
  </main>

  <style>
    :global(body) {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen-Sans, Ubuntu, Cantarell, sans-serif;
    }

    main {
      width: 100%;
      height: 100vh;
      position: relative;
    }

    h1 {
      position: absolute;
      top: 1rem;
      left: 1rem;
      z-index: 1;
      margin: 0;
      padding: 0.5rem 1rem;
      background: rgba(255, 255, 255, 0.9);
      border-radius: 4px;
      font-size: 1.5rem;
    }

    #map {
      width: 100%;
      height: 100%;
    }

    .legend {
      position: absolute;
      top: 5rem;
      right: 1rem;
      background: white;
      padding: 1rem;
      border-radius: 4px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      max-width: 250px;
    }

    .legend h3 {
      margin: 0 0 1rem 0;
      font-size: 1.2rem;
    }

    .legend h4 {
      margin: 0.5rem 0;
      font-size: 1rem;
    }

    .legend-section {
      margin-bottom: 1rem;
    }

    .legend-item {
      display: flex;
      align-items: center;
      margin: 0.5rem 0;
    }

    .line-sample {
      width: 30px;
      height: 3px;
      margin-right: 0.5rem;
    }

    .line-sample.protected {
      background-color: #2ecc71;
    }

    .line-sample.shared {
      background-color: #3498db;
    }

    .circle-sample {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      margin-right: 0.5rem;
      border: 1px solid rgba(0,0,0,0.1);
    }

    .circle-sample.high-traffic {
      background-color: #e74c3c;
    }

    .circle-sample.medium-traffic {
      background-color: #f1c40f;
    }

    .circle-sample.low-traffic {
      background-color: #2ecc71;
    }

    :global(.station-marker) {
      border-radius: 50%;
      cursor: pointer;
      border: 2px solid white;
      box-shadow: 0 0 4px rgba(0,0,0,0.3);
      transition: all 0.3s ease;
    }

    .controls {
      position: absolute;
      bottom: 2rem;
      left: 50%;
      transform: translateX(-50%);
      background: white;
      padding: 1rem;
      border-radius: 4px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      display: flex;
      gap: 1rem;
      align-items: center;
    }

    button {
      padding: 0.5rem 1rem;
      border: none;
      border-radius: 4px;
      background: #3498db;
      color: white;
      cursor: pointer;
      transition: background 0.3s ease;
    }

    button:hover {
      background: #2980b9;
    }

    .visualization-toggle {
      border-right: 1px solid #eee;
      padding-right: 1rem;
    }

    :global(.popup-content) {
      padding: 0.5rem;
    }

    :global(.popup-content .stats) {
      margin-top: 0.5rem;
      font-size: 0.9rem;
    }

    .line-sample.bike-lane {
      background-color: #3498db;
    }

    .line-sample.buffered {
      background-color: #2ecc71;
    }

    .line-sample.shared {
      background-color: #f1c40f;
    }

    .line-sample.protected {
      background-color: #9b59b6;
    }
  </style>