import { quadtree } from 'd3-quadtree';

// Optimize marker rendering with quadtree
export function createStationQuadtree(stations) {
  return quadtree()
    .x(d => d.longitude)
    .y(d => d.latitude)
    .addAll(stations);
}

// Throttle function for performance
export function throttle(func, limit) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

// Calculate station statistics
export function calculateStationStats(station, trafficData, hour) {
  const hourData = trafficData.hourly_data.filter(d => 
    d.station_id === station.id && d.hour === hour
  )[0] || { pickups: 0, dropoffs: 0 };

  return {
    ...station,
    pickups: hourData.pickups,
    dropoffs: hourData.dropoffs,
    netFlow: hourData.pickups - hourData.dropoffs,
    totalTraffic: hourData.pickups + hourData.dropoffs
  };
} 