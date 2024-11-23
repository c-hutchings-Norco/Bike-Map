<script>
  import mapbox from 'mapbox-gl';
  import { onMount, onDestroy } from 'svelte';
  import 'mapbox-gl/dist/mapbox-gl.css';
  // Remove the bikeNetwork import

  const MAPBOX_TOKEN = 'pk.eyJ1IjoiY2h1dGNoaW5ncyIsImEiOiJjbTNxZ3NqY28wNHIxMmtvZnc1Zjc0NW12In0.z4_H0bPDZyrgce46gWBCjQ';
  let map;
  let container;
  let currentTime = "11:59 PM";
  let timeSliderValue = 100;
  let stations = [];
  let showHeatmap = false;
  let selectedTimeRange = 'all';
  let selectedFacilityType = 'all';
  let bikeNetwork; // Declare as a variable instead of import

  // Add new state variables
  let selectedFacilityTypes = {
    'BL': true,   // Bike Lane
    'PBL': true,  // Protected Bike Lane
    'SUP': true,  // Shared Use Path
    'SUPM': true, // Shared Use Path (Modified)
    'SLM': true   // Shared Lane Marking
  };

  let hoveredStateId = null;
  let animationActive = false;
  let animationFrame;
  let tooltip;

  // Add this variable declaration
  let statsDisplay;  // For binding the stats display element

  // Add new state variables
  let isLoading = true;
  let error = null;
  let mapInitialized = false;

  // Add new state variables for filtering
  let minUsage = 0;
  let maxUsage = 100;
  let filterActive = false;
  let debounceTimer;
  let filterUpdateCount = 0;
  let lastFilterUpdate = Date.now();

  // Add new variables for marker handling
  let markerRadius = 6;
  let zoomThreshold = 13;

  // First, let's define consistent size constants at the top of the script
  const STATION_SIZES = {
    MIN_DOCKS: 10,
    MAX_DOCKS: 47,
    BASE_RADIUS: {
      small: 6,
      medium: 8,
      large: 12
    }
  };

  // Function to update filter values
  function updateFilter(min, max) {
    minUsage = min;
    maxUsage = max;
    filterActive = true;
    
    // Performance monitoring
    filterUpdateCount++;
    const now = Date.now();
    if (now - lastFilterUpdate < 1000) {
      // If updates are too frequent, implement debouncing
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        applyUsageFilter();
        lastFilterUpdate = now;
      }, 100);
    } else {
      // If updates are spaced out, apply immediately
      applyUsageFilter();
      lastFilterUpdate = now;
    }
  }

  // Function to apply the usage filter
  function applyUsageFilter() {
    if (!map) return;
    
    const filter = [
      'all',
      ['>=', ['get', 'usage'], minUsage],
      ['<=', ['get', 'usage'], maxUsage]
    ];
    
    map.setFilter('stations', filterActive ? filter : null);

    // Ensure sizes are maintained after filtering
    map.setPaintProperty('stations', 'circle-radius', [
      'interpolate',
      ['linear'],
      ['get', 'total_docks'],
      STATION_SIZES.MIN_DOCKS, STATION_SIZES.BASE_RADIUS.small,
      20, STATION_SIZES.BASE_RADIUS.medium,
      STATION_SIZES.MAX_DOCKS, STATION_SIZES.BASE_RADIUS.large
    ]);

    updateFilteredStats();
  }

  // Step 5.3: Update statistics for filtered data
  function updateFilteredStats() {
    if (!map || !statsDisplay) return;

    const filteredStations = stations.filter(station => {
      const usage = station.properties.usage;
      return usage >= minUsage && usage <= maxUsage;
    });

    const stats = {
      total: filteredStations.length,
      avgUsage: filteredStations.reduce((sum, s) => sum + s.properties.usage, 0) / filteredStations.length || 0,
      filtered: stations.length - filteredStations.length
    };

    statsDisplay.innerHTML = `
      <div class="stats-content">
        <div class="stat-item">
          <span class="stat-label">Showing:</span>
          <span class="stat-value">${stats.total} stations</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Filtered out:</span>
          <span class="stat-value">${stats.filtered} stations</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Avg Usage:</span>
          <span class="stat-value">${stats.avgUsage.toFixed(1)}%</span>
        </div>
      </div>
    `;
  }

  // Step 5.4: Performance optimizations
  function optimizePerformance() {
    // Batch updates for multiple filter changes
    let batchTimeout;
    const batchUpdates = () => {
      clearTimeout(batchTimeout);
      batchTimeout = setTimeout(() => {
        applyUsageFilter();
      }, 100);
    };

    // Use requestAnimationFrame for smooth slider updates
    let rafId;
    const smoothUpdate = (min, max) => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        updateFilter(min, max);
      });
    };

    return { batchUpdates, smoothUpdate };
  }

  const { batchUpdates, smoothUpdate } = optimizePerformance();

  // Load GeoJSON data
  async function loadBikeNetwork() {
    try {
      const response = await fetch('/data/Existing_Bike_Network_2022.geojson');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      console.log('Loaded bike network:', data);
      return data;
    } catch (err) {
      console.error('Error loading bike network:', err);
      throw err;
    }
  }

  // Update initializeMap
  async function initializeMap() {
    try {
      // Load data first
      bikeNetwork = await loadBikeNetwork();
      
      mapbox.accessToken = MAPBOX_TOKEN;
      
      map = new mapbox.Map({
        container,
        style: 'mapbox://styles/mapbox/light-v11',
        center: [-71.0589, 42.3601],
        zoom: 12
      });

      // Wait for map to load
      await new Promise((resolve) => {
        map.on('style.load', () => {
          console.log('Map style loaded');
          resolve();
        });
      });

      console.log('Initializing layers...');
      await setupLayers();
      console.log('Layers initialized');
      
      mapInitialized = true;
    } catch (err) {
      error = err.message;
      console.error('Map initialization error:', err);
    } finally {
      isLoading = false;
    }
  }

  // Update setupLayers to handle async operations
  async function setupLayers() {
    try {
      // Add bike network layer
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
            'BL', '#32CD32',
            'PBL', '#228B22',
            'SUP', '#4169E1',
            'SUPM', '#4169E1',
            'SLM', '#FFA500',
            '#808080'
          ],
          'line-width': 3,
          'line-opacity': 0.8
        }
      });

      // Load real station data instead of generating
      stations = await loadStations();
      stations = generateTrafficData(); // Add traffic patterns

      // Add stations source and layer
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
            ['get', 'total_docks'],
            STATION_SIZES.MIN_DOCKS, STATION_SIZES.BASE_RADIUS.small,    // minimum docks -> 6px radius
            20, STATION_SIZES.BASE_RADIUS.medium,    // medium docks -> 8px radius
            STATION_SIZES.MAX_DOCKS, STATION_SIZES.BASE_RADIUS.large    // maximum docks -> 12px radius
          ],
          'circle-color': [
            'match',
            ['get', 'status'],
            'departures', '#4a90e2',
            'balanced', '#9b59b6',
            'arrivals', '#f5a623',
            '#888888'
          ],
          'circle-opacity': 0.8,
          'circle-stroke-width': 2,
          'circle-stroke-color': 'white'
        }
      });

      // Update hover effects to show station names
      const popup = new mapbox.Popup({
        closeButton: false,
        closeOnClick: false
      });

      map.on('mouseenter', 'stations', (e) => {
        map.getCanvas().style.cursor = 'pointer';
        
        const coordinates = e.features[0].geometry.coordinates.slice();
        const { name, total_docks, municipality, usage } = e.features[0].properties;
        
        const description = `
          <h4>${name}</h4>
          <p>Total Docks: ${total_docks}</p>
          <p>Municipality: ${municipality}</p>
          <p>Current Usage: ${Math.round(usage)}%</p>
        `;
        
        popup
          .setLngLat(coordinates)
          .setHTML(description)
          .addTo(map);
      });

      map.on('mouseleave', 'stations', () => {
        map.getCanvas().style.cursor = '';
        popup.remove();
      });

      // Add zoom handler
      map.on('zoom', updateMarkerSizes);

    } catch (err) {
      console.error('Error in setupLayers:', err);
      throw err;
    }
  }

  // Replace the existing generateStations function with this:
  async function loadStations() {
    try {
      const response = await fetch('/data/bluebikes-stations.csv');
      const text = await response.text();
      const rows = text.split('\n').slice(1); // Skip header
      
      const stations = rows
        .filter(row => row.trim()) // Remove empty rows
        .map(row => {
          const [
            number,
            name,
            lat,
            long,
            seasonal_status,
            municipality,
            total_docks
          ] = row.split(',');

          return {
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: [parseFloat(long), parseFloat(lat)]
            },
            properties: {
              id: number,
              name: name,
              status: getRandomStatus(),
              total_docks: parseInt(total_docks),
              municipality: municipality,
              seasonal_status: seasonal_status,
              usage: Math.random() * 100 // Placeholder for real usage data
            }
          };
        })
        .filter(station => 
          !isNaN(station.geometry.coordinates[0]) && 
          !isNaN(station.geometry.coordinates[1])
        );

      console.log(`Loaded ${stations.length} stations`);
      return stations;
    } catch (err) {
      console.error('Error loading stations:', err);
      throw err;
    }
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
    
    const hour = Math.floor((value / 100) * 24);
    updateStationStatuses(hour);
    updateMarkerSizes(); // Ensure markers stay properly sized
    
    // Update statistics display
    const stats = calculateTrafficStats(hour);
    updateStatsDisplay(stats);
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

    // Keep the same circle radius logic as initial setup
    map.setPaintProperty('stations', 'circle-radius', [
      'interpolate',
      ['linear'],
      ['get', 'total_docks'],
      STATION_SIZES.MIN_DOCKS, STATION_SIZES.BASE_RADIUS.small,
      20, STATION_SIZES.BASE_RADIUS.medium,
      STATION_SIZES.MAX_DOCKS, STATION_SIZES.BASE_RADIUS.large
    ]);
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
      night: { start: 22, end: 5, peakHour: 0 }
    };

    return stations.map(station => {
      const hourlyTraffic = new Array(24).fill(0).map((_, hour) => {
        // Base traffic (20-30% usage)
        let traffic = 20 + Math.random() * 10;
        let status = 'balanced';

        // Morning rush hour pattern (6 AM - 10 AM)
        if (hour >= trafficPatterns.morning.start && hour <= trafficPatterns.morning.end) {
          const intensity = 1 - Math.abs(hour - trafficPatterns.morning.peakHour) / 4;
          traffic += 50 * intensity; // Up to 70-80% usage during peak
          status = Math.random() < 0.7 ? 'departures' : 'balanced';
        } 
        // Evening rush hour pattern (4 PM - 7 PM)
        else if (hour >= trafficPatterns.evening.start && hour <= trafficPatterns.evening.end) {
          const intensity = 1 - Math.abs(hour - trafficPatterns.evening.peakHour) / 3;
          traffic += 40 * intensity; // Up to 60-70% usage during peak
          status = Math.random() < 0.7 ? 'arrivals' : 'balanced';
        }
        // Night pattern (10 PM - 5 AM)
        else if (hour >= trafficPatterns.night.start || hour <= trafficPatterns.night.end) {
          traffic = Math.max(5, traffic * 0.3); // Reduced night traffic
          status = 'balanced';
        }

        // Add some randomization based on station properties
        const { municipality, total_docks } = station.properties;
        
        // Adjust for municipality (example: more traffic in urban areas)
        if (municipality === 'Boston') {
          traffic *= 1.2;
        } else if (municipality === 'Cambridge') {
          traffic *= 1.1;
        }

        // Adjust for station size
        traffic *= (total_docks / 20); // Normalize by average dock count

        return {
          hour,
          usage: Math.min(100, Math.round(traffic)),
          status
        };
      });

      return {
        ...station,
        hourlyTraffic
      };
    });
  }

  // Add this function to calculate traffic statistics
  function calculateTrafficStats(hour) {
    const stats = {
      totalUsage: 0,
      avgUsage: 0,
      busyStations: 0,
      quietStations: 0,
      byMunicipality: {}
    };

    stations.forEach(station => {
      const hourData = station.hourlyTraffic[hour];
      const { municipality } = station.properties;

      stats.totalUsage += hourData.usage;
      if (hourData.usage > 70) stats.busyStations++;
      if (hourData.usage < 30) stats.quietStations++;

      // Track by municipality
      if (!stats.byMunicipality[municipality]) {
        stats.byMunicipality[municipality] = {
          count: 0,
          totalUsage: 0
        };
      }
      stats.byMunicipality[municipality].count++;
      stats.byMunicipality[municipality].totalUsage += hourData.usage;
    });

    stats.avgUsage = Math.round(stats.totalUsage / stations.length);

    // Calculate averages by municipality
    Object.keys(stats.byMunicipality).forEach(municipality => {
      const mStats = stats.byMunicipality[municipality];
      mStats.avgUsage = Math.round(mStats.totalUsage / mStats.count);
    });

    return stats;
  }

  function updateStatsDisplay(stats) {
    if (!statsDisplay) return;
    
    let municipalityHtml = '';
    Object.entries(stats.byMunicipality)
      .sort((a, b) => b[1].avgUsage - a[1].avgUsage)
      .forEach(([municipality, mStats]) => {
        municipalityHtml += `
          <div class="municipality-stat">
            <span class="municipality-name">${municipality}:</span>
            <span class="municipality-value">${mStats.avgUsage}%</span>
          </div>
        `;
      });

    statsDisplay.innerHTML = `
      <div class="stats-content">
        <div class="stat-item">
          <span class="stat-label">Network Usage:</span>
          <span class="stat-value">${stats.avgUsage}%</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Busy Stations:</span>
          <span class="stat-value">${stats.busyStations}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Quiet Stations:</span>
          <span class="stat-value">${stats.quietStations}</span>
        </div>
        <div class="municipality-stats">
          ${municipalityHtml}
        </div>
      </div>
    `;
  }

  // Add time range filter
  function filterByTimeRange(range) {
    selectedTimeRange = range;
    let value;
    switch(range) {
      case 'morning':
        value = 33; // 8:00 AM
        break;
      case 'afternoon':
        value = 50; // 12:00 PM
        break;
      case 'evening':
        value = 75; // 6:00 PM
        break;
      default:
        value = timeSliderValue;
    }
    timeSliderValue = value;
    updateTime(value);
  }

  // Add facility type filter function
  function filterByFacilityType() {
    if (!map) return;
    
    const filter = ['any'];
    Object.entries(selectedFacilityTypes).forEach(([type, isSelected]) => {
      if (isSelected) {
        filter.push(['==', ['get', 'ExisFacil'], type]);
      }
    });
    
    map.setFilter('bike-network', filter);
  }

  // Add animation functions
  function startTimeAnimation() {
    animationActive = true;
    animateTime();
  }

  function stopTimeAnimation() {
    animationActive = false;
    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
    }
  }

  function animateTime() {
    if (!animationActive) return;
    
    timeSliderValue = (timeSliderValue + 0.5) % 100;
    updateTime(timeSliderValue);
    
    animationFrame = requestAnimationFrame(animateTime);
  }

  // Enhance hover effects
  function setupHoverEffects() {
    // For bike network
    map.on('mousemove', 'bike-network', (e) => {
      if (e.features.length > 0) {
        map.getCanvas().style.cursor = 'pointer';
        const feature = e.features[0];
        
        tooltip.style.display = 'block';
        tooltip.style.left = e.point.x + 'px';
        tooltip.style.top = e.point.y + 'px';
        tooltip.innerHTML = `
          <strong>${feature.properties.STREET_NAM || 'Unnamed Street'}</strong><br/>
          ${getFacilityTypeName(feature.properties.ExisFacil)}
        `;
      }
    });

    map.on('mouseleave', 'bike-network', () => {
      map.getCanvas().style.cursor = '';
      tooltip.style.display = 'none';
    });

    // For stations
    map.on('mousemove', 'stations', (e) => {
      if (e.features.length > 0) {
        map.getCanvas().style.cursor = 'pointer';
        const feature = e.features[0];
        
        tooltip.style.display = 'block';
        tooltip.style.left = e.point.x + 'px';
        tooltip.style.top = e.point.y + 'px';
        tooltip.innerHTML = `
          <strong>Station #${feature.properties.id}</strong><br/>
          Usage: ${feature.properties.usage}%<br/>
          Status: ${feature.properties.status}
        `;
      }
    });

    map.on('mouseleave', 'stations', () => {
      map.getCanvas().style.cursor = '';
      tooltip.style.display = 'none';
    });
  }

  // Add this function to convert facility codes to readable names
  function getFacilityTypeName(code) {
    const facilityTypes = {
      'BL': 'Bike Lane',
      'PBL': 'Protected Bike Lane',
      'SUP': 'Shared Use Path',
      'SUPM': 'Shared Use Path (Modified)',
      'SLM': 'Shared Lane Marking'
    };
    return facilityTypes[code] || code;
  }

  // Function to update marker sizes based on zoom
  function updateMarkerSizes() {
    if (!map) return;
    
    const zoom = map.getZoom();
    const baseScale = Math.max(1, Math.pow(2, zoom - zoomThreshold));
    
    map.setPaintProperty('stations', 'circle-radius', [
      'interpolate',
      ['linear'],
      ['get', 'total_docks'],
      STATION_SIZES.MIN_DOCKS, STATION_SIZES.BASE_RADIUS.small * baseScale,
      20, STATION_SIZES.BASE_RADIUS.medium * baseScale,
      STATION_SIZES.MAX_DOCKS, STATION_SIZES.BASE_RADIUS.large * baseScale
    ]);
  }

  // Function to add station markers
  function addStationMarkers() {
    if (!map) return;

    // Add stations source if it doesn't exist
    if (!map.getSource('stations')) {
      map.addSource('stations', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: stations
        }
      });
    }

    // Add stations layer
    map.addLayer({
      id: 'stations',
      type: 'circle',
      source: 'stations',
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['get', 'usage'],
          0, markerRadius * 0.5,
          100, markerRadius
        ],
        'circle-color': [
          'match',
          ['get', 'status'],
          'departures', '#4a90e2',
          'balanced', '#9b59b6',
          'arrivals', '#f5a623',
          '#888888'
        ],
        'circle-opacity': 0.8,
        'circle-stroke-width': 2,
        'circle-stroke-color': 'white'
      }
    });

    // Add hover effect for stations
    map.on('mouseenter', 'stations', () => {
      map.getCanvas().style.cursor = 'pointer';
    });

    map.on('mouseleave', 'stations', () => {
      map.getCanvas().style.cursor = '';
    });

    // Add zoom/pan handlers
    map.on('zoom', updateMarkerSizes);
    map.on('moveend', () => {
      // Update markers in visible area
      updateVisibleMarkers();
    });
  }

  // Function to update markers in visible area
  function updateVisibleMarkers() {
    if (!map) return;

    const bounds = map.getBounds();
    const visibleStations = stations.filter(station => {
      const [lng, lat] = station.geometry.coordinates;
      return bounds.contains([lng, lat]);
    });

    // Update source data with only visible stations
    map.getSource('stations').setData({
      type: 'FeatureCollection',
      features: visibleStations
    });
  }

  onMount(() => {
    initializeMap();
  });

  onDestroy(() => {
    if (map) map.remove();
  });
</script>

<div class="app-container">
  {#if isLoading}
    <div class="loading-overlay">
      <div class="loading-spinner"></div>
      <p>Loading map data...</p>
    </div>
  {/if}

  {#if error}
    <div class="error-message">
      <p>Error loading map: {error}</p>
      <button on:click={() => window.location.reload()}>Retry</button>
    </div>
  {/if}

  <header>
    <div class="logo">
      <span class="bike-icon">🚲</span>
      <h1>Bikewatching</h1>
    </div>
    
    <div class="controls-container">
      <div class="time-controls">
        <div class="time-filter">
          <span>Time:</span>
          <input 
            type="range" 
            min="0" 
            max="100" 
            bind:value={timeSliderValue}
            on:input={() => updateTime(timeSliderValue)}
          />
          <span class="time-display">{currentTime}</span>
        </div>

        <button
          class="animation-button"
          class:active={animationActive}
          on:click={() => animationActive ? stopTimeAnimation() : startTimeAnimation()}
        >
          {animationActive ? '⏸' : '▶️'} {animationActive ? 'Pause' : 'Play'}
        </button>
      </div>

      <!-- <div class="filter-controls">
        <div class="facility-filters">
          <span>Show Infrastructure:</span>
          {#each Object.entries(selectedFacilityTypes) as [type, isSelected]}
            <label class="checkbox-label">
              <input
                type="checkbox"
                bind:checked={selectedFacilityTypes[type]}
                on:change={filterByFacilityType}
              />
              {getFacilityTypeName(type)}
            </label>
          {/each}
        </div>
      </div> -->

      <!-- Add usage filter controls -->
      <!-- <div class="filter-section">
        <h3>Filter by Usage</h3>
        <div class="usage-filter">
          <div class="range-inputs">
            <div class="range-group">
              <label for="min-usage">Min Usage:</label>
              <input 
                type="number" 
                id="min-usage"
                bind:value={minUsage}
                min="0"
                max="100"
                on:input={() => smoothUpdate(minUsage, maxUsage)}
              />
            </div>
            <div class="range-group">
              <label for="max-usage">Max Usage:</label>
              <input 
                type="number" 
                id="max-usage"
                bind:value={maxUsage}
                min="0"
                max="100"
                on:input={() => smoothUpdate(minUsage, maxUsage)}
              />
            </div>
          </div>
          <div class="range-slider">
            <input 
              type="range"
              class="slider min-slider"
              min="0"
              max="100"
              bind:value={minUsage}
              on:input={() => smoothUpdate(minUsage, maxUsage)}
            />
            <input 
              type="range"
              class="slider max-slider"
              min="0"
              max="100"
              bind:value={maxUsage}
              on:input={() => smoothUpdate(minUsage, maxUsage)}
            />
          </div>
          <button 
            class="reset-filter"
            on:click={() => {
              minUsage = 0;
              maxUsage = 100;
              filterActive = false;
              applyUsageFilter();
            }}
          >
            Reset Filter
          </button>
        </div>
      </div> -->
    </div>
  </header>

  <div class="map-container">
    <div class="map" bind:this={container}></div>
    
    <!-- Add legend -->
    <div class="legend">
      <h3>LEGEND:</h3>
      <div class="legend-items">
        <div class="legend-item">
          <span class="dot departure"></span>
          <span>More departures</span>
        </div>
        <div class="legend-item">
          <span class="dot balanced"></span>
          <span>Balanced</span>
        </div>
        <div class="legend-item">
          <span class="dot arrival"></span>
          <span>More arrivals</span>
        </div>
      </div>
    </div>

    {#if mapInitialized}
      <div class="stats-display" bind:this={statsDisplay}></div>
      <div class="tooltip" bind:this={tooltip}></div>
    {/if}
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
    bottom: 30px;
    left: 50%;
    transform: translateX(-50%);
    background: white;
    padding: 10px 20px;
    border-radius: 4px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    display: flex;
    align-items: center;
    gap: 10px;
    z-index: 1;
  }

  .legend h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 500;
  }

  .legend-items {
    display: flex;
    gap: 20px;
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
  }

  .dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid white;
  }

  .departure {
    background: #4a90e2;
  }

  .balanced {
    background: #9b59b6;
  }

  .arrival {
    background: #f5a623;
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

  .controls-container {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .time-presets {
    display: flex;
    gap: 1rem;
    margin-top: 0.5rem;
  }

  .time-presets button {
    padding: 0.5rem 1rem;
    border: 1px solid #ddd;
    border-radius: 4px;
    background: white;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .time-presets button.active {
    background: #4a90e2;
    color: white;
    border-color: #4a90e2;
  }

  .stats-display {
    position: absolute;
    top: 20px;
    right: 20px;
    background: white;
    padding: 1rem;
    border-radius: 4px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  }

  .stats-content {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .stat-item {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
  }

  .stat-label {
    color: #666;
  }

  .stat-value {
    font-weight: bold;
  }

  .facility-filters {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-top: 1rem;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
  }

  .checkbox-label input[type="checkbox"] {
    width: 16px;
    height: 16px;
  }

  .animation-controls {
    margin-top: 1rem;
  }

  .animation-controls button {
    padding: 0.5rem 1rem;
    border: 1px solid #ddd;
    border-radius: 4px;
    background: white;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .animation-controls button.active {
    background: #4a90e2;
    color: white;
    border-color: #4a90e2;
  }

  /* Enhanced hover effects */
  :global(.mapboxgl-popup-content) {
    padding: 1rem;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  }

  :global(.mapboxgl-popup-content h3) {
    margin: 0 0 0.5rem 0;
    font-size: 1.1rem;
    color: #333;
  }

  :global(.mapboxgl-popup-content p) {
    margin: 0.25rem 0;
    color: #666;
  }

  .time-controls {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .animation-button {
    padding: 0.5rem 1rem;
    border: 1px solid #ddd;
    border-radius: 4px;
    background: white;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .animation-button.active {
    background: #4a90e2;
    color: white;
    border-color: #4a90e2;
  }

  .tooltip {
    display: none;
    position: fixed;
    background: white;
    padding: 8px 12px;
    border-radius: 4px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    pointer-events: none;
    z-index: 1000;
    font-size: 14px;
    max-width: 200px;
  }

  .filter-controls {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid #eee;
  }

  .facility-filters {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: center;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 4px 8px;
    border-radius: 4px;
    background: #f5f5f5;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .checkbox-label:hover {
    background: #eee;
  }

  .loading-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(255, 255, 255, 0.9);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .loading-spinner {
    width: 50px;
    height: 50px;
    border: 4px solid #f3f3f3;
    border-top: 4px solid #4a90e2;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  .error-message {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: white;
    padding: 2rem;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    text-align: center;
  }

  .error-message button {
    margin-top: 1rem;
    padding: 0.5rem 1rem;
    background: #4a90e2;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  @media (max-width: 768px) {
    .controls-container {
      flex-direction: column;
    }

    .time-controls {
      flex-direction: column;
      align-items: stretch;
    }

    .facility-filters {
      flex-direction: column;
    }
  }

  .filter-section {
    margin-top: 1rem;
    padding: 1rem;
    background: #f5f5f5;
    border-radius: 8px;
  }

  .filter-section h3 {
    margin: 0 0 1rem 0;
    font-size: 1rem;
    color: #333;
  }

  .usage-filter {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .range-inputs {
    display: flex;
    gap: 1rem;
  }

  .range-group {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .range-group input[type="number"] {
    width: 60px;
    padding: 0.25rem;
    border: 1px solid #ddd;
    border-radius: 4px;
  }

  .range-slider {
    position: relative;
    height: 40px;
    padding: 0 10px;
  }

  .slider {
    position: absolute;
    width: calc(100% - 20px);
    height: 4px;
    background: #ddd;
    pointer-events: none;
    -webkit-appearance: none;
  }

  .min-slider {
    z-index: 1;
  }

  .max-slider {
    z-index: 2;
  }

  .slider::-webkit-slider-thumb {
    height: 16px;
    width: 16px;
    border-radius: 50%;
    background: #4a90e2;
    cursor: pointer;
    pointer-events: auto;
    -webkit-appearance: none;
  }

  .slider::-moz-range-thumb {
    height: 16px;
    width: 16px;
    border-radius: 50%;
    background: #4a90e2;
    cursor: pointer;
    pointer-events: auto;
  }

  .reset-filter {
    padding: 0.5rem 1rem;
    background: #4a90e2;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.2s ease;
  }

  .reset-filter:hover {
    background: #357abd;
  }

  /* Performance optimization styles */
  .slider {
    will-change: transform;
    transform: translateZ(0);
  }

  @media (max-width: 768px) {
    .range-inputs {
      flex-direction: column;
    }
  }

  /* Add styles for station markers */
  :global(.mapboxgl-canvas-container) {
    will-change: transform;
  }

  :global(.station-marker) {
    transition: all 0.3s ease;
  }

  /* Add to your existing styles */
  .municipality-stats {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid #eee;
  }

  .municipality-stat {
    display: flex;
    justify-content: space-between;
    margin: 0.25rem 0;
    font-size: 0.9rem;
  }

  .municipality-name {
    color: #666;
  }

  .municipality-value {
    font-weight: bold;
  }
</style>