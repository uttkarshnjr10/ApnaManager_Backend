const axios = require('axios');
const Hotel = require('../models/hotel.model');
const logger = require('../utils/logger');

// SIMPLE IN-MEMORY CACHE
// Keyed by location string to support multiple users with different locations.
const weatherCache = new Map();
const CACHE_DURATION = 15 * 60 * 1000; // 15 Minutes

exports.getDashboardWeather = async (req, res) => {
  try {
    // 1. Determine location — priority: query params (lat/lon) > Hotel state > default
    let queryLocation = process.env.DEFAULT_CITY || 'Patna, Bihar, IN';
    let apiUrl;

    const { lat, lon } = req.query;

    if (lat && lon) {
      // Client sent geolocation coordinates — use the precise lat/lon API
      const parsedLat = parseFloat(lat);
      const parsedLon = parseFloat(lon);

      if (isNaN(parsedLat) || isNaN(parsedLon) || parsedLat < -90 || parsedLat > 90 || parsedLon < -180 || parsedLon > 180) {
        return res.status(400).json({ message: 'Invalid latitude or longitude values' });
      }

      queryLocation = `${parsedLat.toFixed(4)},${parsedLon.toFixed(4)}`;
      const apiKey = process.env.WEATHER_API_KEY;
      if (!apiKey) throw new Error('Weather API Key is missing in .env');
      apiUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${parsedLat}&lon=${parsedLon}&units=metric&appid=${apiKey}`;
    } else {
      // Fallback: If it's a logged-in Hotel, try to use their stored state
      if (req.user && req.user.role === 'Hotel') {
        const hotel = await Hotel.findById(req.user._id);
        if (hotel && hotel.state) {
          queryLocation = `${hotel.state}, IN`;
        }
      }

      const apiKey = process.env.WEATHER_API_KEY;
      if (!apiKey) throw new Error('Weather API Key is missing in .env');
      apiUrl = `https://api.openweathermap.org/data/2.5/weather?q=${queryLocation}&units=metric&appid=${apiKey}`;
    }

    // 2. Check Cache
    const now = Date.now();
    const cached = weatherCache.get(queryLocation);
    if (cached && now - cached.lastFetch < CACHE_DURATION) {
      return res.status(200).json(cached.data);
    }

    // 3. Fetch from OpenWeatherMap
    const response = await axios.get(apiUrl);
    const data = response.data;

    // 4. Format Data (Send only what frontend needs)
    const weatherData = {
      temp: Math.round(data.main.temp),
      condition: data.weather[0].main,
      description: data.weather[0].description,
      iconCode: data.weather[0].icon,
      location: data.name,
    };

    // 5. Update Cache (per-location)
    weatherCache.set(queryLocation, {
      data: weatherData,
      lastFetch: now,
    });

    // Evict stale cache entries to prevent memory leak (keep max 50)
    if (weatherCache.size > 50) {
      const oldestKey = weatherCache.keys().next().value;
      weatherCache.delete(oldestKey);
    }

    res.status(200).json(weatherData);
  } catch (error) {
    logger.error(`Weather Fetch Error: ${error.message}`);
    // Fallback data so the UI doesn't break
    res.status(200).json({
      temp: '--',
      condition: 'Unavailable',
      iconCode: 'unknown',
      location: 'India',
    });
  }
};
