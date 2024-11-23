<script>
  import mapbox from 'mapbox-gl';
  import { onMount, onDestroy } from 'svelte';
  import 'mapbox-gl/dist/mapbox-gl.css';
  import bikeNetwork from '../data/Existing_Bike_Network_2022.geojson';

  const MAPBOX_TOKEN = 'pk.eyJ1IjoiY2h1dGNoaW5ncyIsImEiOiJjbTNxZ3NqY28wNHIxMmtvZnc1Zjc0NW12In0.z4_H0bPDZyrgce46gWBCjQ';
  let map;
  let container;
  let currentTime = "11:59 PM";
  let timeSliderValue = 100;
  let stations = [];
  let showHeatmap = false;

  // Generate stations at network intersections
  function generateStations() {
    const intersections = new Set();
    
    // Extract unique coordinates from bike network
    bikeNetwork.features.forEach(feature => {
      if (feature.geometry.type === 'LineString') {
        feature.geometry.coordinates.forEach(coord => {
          intersections.add(JSON.stringify(coord));
        });
      }
    });

    // Convert to station features
    return Array.from(intersections).map((coord, index) => {
      const [lng, lat] = JSON.parse(coord);
      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [lng, lat]
        },
        properties: {
          id: index,
          status: getRandomStatus(),
          usage: Math.floor(Math.random() * 100)
        }
      };
    });
  }

  function getRandomStatus() {
    const statuses = ['departures', 'balanced', 'arrivals'];
    return statuses[Math.floor(Math.random() * statuses.length)];
  }

  function updateTime(value) {
    const minutes = Math.floor((value / 100) * 24 * 60);
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    currentTime = `${displayHours}:${mins.toString().padStart(2, '0')} ${period}`;
    
    // Update station statuses based on time
    updateStationStatuses(hours);
  }

  function updateStationStatuses(hour) {
    if (!map || !map.getSource('stations')) return;

    const updatedStations = stations.map(station => {
      const hourData = station.hourlyTraffic[hour];
      return {
        ...station,
        properties: {
          ...station.properties,
          status: hourData.status,
          usage: hourData.usage
        }
      };
    });

    map.getSource('stations').setData({
      type: 'FeatureCollection',
      features: updatedStations
    });

    // Update traffic heatmap if enabled
    if (map.getLayer('traffic-heat')) {
      map.setPaintProperty('traffic-heat', 'heatmap-weight', [
        'interpolate',
        ['linear'],
        ['get', 'usage'],
        0, 0,
        100, 1
      ]);
    }
  }

  function getTimeBasedStatus(hour) {
    if (hour >= 6 && hour < 10) {
      // Morning rush: more departures from residential areas
      return Math.random() < 0.7 ? 'departures' : 'balanced';
    } else if (hour >= 16 && hour < 19) {
      // Evening rush: more arrivals in residential areas
      return Math.random() < 0.7 ? 'arrivals' : 'balanced';
    } else {
      // Other times: mostly balanced
      return 'balanced';
    }
  }

  // Add these functions for traffic simulation
  function generateTrafficData() {
    const trafficPatterns = {
      morning: { start: 6, end: 10, peakHour: 8 },
      evening: { start: 16, end: 19, peakHour: 17 },
    };

    return stations.map(station => {
      const hourlyTraffic = new Array(24).fill(0).map((_, hour) => {
        // Base traffic (20-30% usage)
        let traffic = 20 + Math.random() * 10;

        // Morning rush hour pattern
        if (hour >= trafficPatterns.morning.start && hour <= trafficPatterns.morning.end) {
          const intensity = 1 - Math.abs(hour - trafficPatterns.morning.peakHour) / 4;
          traffic += 50 * intensity; // Up to 70-80% usage during peak
        }

        // Evening rush hour pattern
        if (hour >= trafficPatterns.evening.start && hour <= trafficPatterns.evening.end) {
          const intensity = 1 - Math.abs(hour - trafficPatterns.evening.peakHour) / 3;
          traffic += 40 * intensity; // Up to 60-70% usage during peak
        }

        return {
          hour,
          usage: Math.min(100, Math.round(traffic)),
          status: getTimeBasedStatus(hour)
        };
      });

      return {
        ...station,
        hourlyTraffic
      };
    });
  }

  onMount(() => {
    mapbox.accessToken = MAPBOX_TOKEN;
    
    map = new mapbox.Map({
      container,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [-71.0589, 42.3601],
      zoom: 12
    });

    map.on('load', () => {
      // Add bike network with facility types
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
            'BL', '#32CD32',    // Bike Lane - Light Green
            'PBL', '#228B22',   // Protected Bike Lane - Dark Green
            'SUP', '#4169E1',   // Shared Use Path - Blue
            'SUPM', '#4169E1',  // Shared Use Path (Modified) - Blue
            'SLM', '#FFA500',   // Shared Lane Marking - Orange
            '#808080'           // Other/Default - Gray
          ],
          'line-width': 3,
          'line-opacity': 0.8
        }
      });

      // Generate and add stations
      stations = generateStations();
      
      map.addSource('stations', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: stations
        }
      });

      map.addLayer({
        id: 'stations',
        type: 'circle',
        source: 'stations',
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['get', 'usage'],
            0, 6,
            100, 15
          ],
          'circle-color': [
            'match',
            ['get', 'status'],
            'departures', '#4a90e2',
            'balanced', '#9b59b6',
            'arrivals', '#f5a623',
            '#ccc'
          ],
          'circle-opacity': 0.8,
          'circle-stroke-width': 2,
          'circle-stroke-color': 'white'
        }
      });

      // Add hover effects and popups
      map.on('mouseenter', ['bike-network', 'stations'], () => {
        map.getCanvas().style.cursor = 'pointer';
      });

      map.on('mouseleave', ['bike-network', 'stations'], () => {
        map.getCanvas().style.cursor = '';
      });

      // Popup for bike lanes
      map.on('click', 'bike-network', (e) => {
        const coordinates = e.lngLat;
        const properties = e.features[0].properties;

        const facilityTypes = {
          'BL': 'Bike Lane',
          'PBL': 'Protected Bike Lane',
          'SUP': 'Shared Use Path',
          'SUPM': 'Shared Use Path (Modified)',
          'SLM': 'Shared Lane Marking'
        };

        new mapbox.Popup()
          .setLngLat(coordinates)
          .setHTML(`
            <div class="popup-content">
              <h3>${properties.STREET_NAM || 'Unnamed Street'}</h3>
              <p>Type: ${facilityTypes[properties.ExisFacil] || properties.ExisFacil}</p>
              ${properties.InstallDat ? `<p>Installed: ${properties.InstallDat}</p>` : ''}
            </div>
          `)
          .addTo(map);
      });

      // Popup for stations
      map.on('click', 'stations', (e) => {
        const coordinates = e.features[0].geometry.coordinates.slice();
        const props = e.features[0].properties;

        new mapbox.Popup()
          .setLngLat(coordinates)
          .setHTML(`
            <div class="popup-content">
              <h3>Station #${props.id}</h3>
              <p>Status: ${props.status}</p>
              <p>Usage: ${props.usage}%</p>
              <p>Time: ${currentTime}</p>
            </div>
          `)
          .addTo(map);
      });

      // Add traffic heatmap layer
      map.addLayer({
        id: 'traffic-heat',
        type: 'heatmap',
        source: 'stations',
        paint: {
          'heatmap-weight': [
            'interpolate',
            ['linear'],
            ['get', 'usage'],
            0, 0,
            100, 1
          ],
          'heatmap-intensity': 1,
          'heatmap-color': [
            'interpolate',
            ['linear'],
            ['heatmap-density'],
            0, 'rgba(0, 0, 255, 0)',
            0.2, 'rgba(0, 0, 255, 0.2)',
            0.4, 'rgba(0, 255, 255, 0.4)',
            0.6, 'rgba(0, 255, 0, 0.6)',
            0.8, 'rgba(255, 255, 0, 0.8)',
            1, 'rgba(255, 0, 0, 1)'
          ],
          'heatmap-radius': 30
        }
      }, 'stations');

      // Generate traffic data
      stations = generateTrafficData();

      // Update initial view
      updateTime(timeSliderValue);
    });
  });

  onDestroy(() => {
    if (map) map.remove();
  });
</script>

<div class="app-container">
  <header>
    <div class="logo">
      <span class="bike-icon">🚲</span>
      <h1>Bikewatching</h1>
    </div>
    <div class="time-filter">
      <span>Filter by time:</span>
      <input 
        type="range" 
        min="0" 
        max="100" 
        bind:value={timeSliderValue}
        on:input={() => updateTime(timeSliderValue)}
      />
      <span class="time-display">{currentTime}</span>
    </div>
    <div class="view-controls">
      <label>
        <input 
          type="checkbox" 
          bind:checked={showHeatmap} 
          on:change={() => {
            if (map) {
              map.setLayoutProperty('traffic-heat', 'visibility', 
                showHeatmap ? 'visible' : 'none');
            }
          }}
        />
        Show Traffic Heatmap
      </label>
    </div>
  </header>

  <div class="map-container">
    <div class="map" bind:this={container}></div>
  </div>

  <div class="legend">
    <div class="legend-section">
      <span class="legend-label">Bike Infrastructure:</span>
      <div class="legend-item">
        <div class="line-sample bike-lane"></div>
        <span>Bike Lane</span>
      </div>
      <div class="legend-item">
        <div class="line-sample protected"></div>
        <span>Protected Lane</span>
      </div>
      <div class="legend-item">
        <div class="line-sample shared"></div>
        <span>Shared Lane</span>
      </div>
    </div>
    
    <div class="legend-section">
      <span class="legend-label">Station Status:</span>
      <div class="legend-item">
        <div class="circle-sample departures"></div>
        <span>More departures</span>
      </div>
      <div class="legend-item">
        <div class="circle-sample balanced"></div>
        <span>Balanced</span>
      </div>
      <div class="legend-item">
        <div class="circle-sample arrivals"></div>
        <span>More arrivals</span>
      </div>
    </div>
  </div>
</div>

<style>
  .app-container {
    width: 100%;
    height: 100vh;
    display: flex;
    flex-direction: column;
  }

  header {
    padding: 1rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: white;
    border-bottom: 1px solid #eee;
  }

  .logo {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .bike-icon {
    font-size: 1.5rem;
  }

  h1 {
    margin: 0;
    font-size: 1.5rem;
  }

  .time-filter {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  input[type="range"] {
    width: 300px;
  }

  .time-display {
    min-width: 80px;
  }

  .map-container {
    flex: 1;
    position: relative;
  }

  .map {
    width: 100%;
    height: 100%;
  }

  .legend {
    position: absolute;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: white;
    padding: 10px 20px;
    border-radius: 4px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    display: flex;
    align-items: center;
    gap: 20px;
  }

  .legend-label {
    font-weight: bold;
    color: #666;
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .circle-sample {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid white;
    box-shadow: 0 0 4px rgba(0,0,0,0.2);
  }

  .circle-sample.departures {
    background-color: #4a90e2;
  }

  .circle-sample.balanced {
    background-color: #9b59b6;
  }

  .circle-sample.arrivals {
    background-color: #f5a623;
  }

  .legend-section {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 0 20px;
    border-right: 1px solid #eee;
  }

  .legend-section:last-child {
    border-right: none;
  }

  .line-sample {
    width: 30px;
    height: 3px;
  }

  .line-sample.bike-lane {
    background-color: #32CD32;
  }

  .line-sample.protected {
    background-color: #228B22;
  }

  .line-sample.shared {
    background-color: #FFA500;
  }

  .view-controls {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-left: 2rem;
  }

  .view-controls label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
  }
</style>