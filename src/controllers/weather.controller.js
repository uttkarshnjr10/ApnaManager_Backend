const axios = require('axios');
const Hotel = require('../models/Hotel.model'); // Adjust path to your model

// SIMPLE IN-MEMORY CACHE
// In production with multiple server instances, use Redis.
// For a single server instance, this object works perfectly.
let weatherCache = {
  data: null,
  lastFetch: 0,
  location: '',
};

const CACHE_DURATION = 15 * 60 * 1000; // 15 Minutes

exports.getDashboardWeather = async (req, res) => {
  try {
    // 1. Determine Location
    // Default to Patna, Bihar for your client base
    let queryLocation = process.env.DEFAULT_CITY || 'Patna, Bihar, IN';

    // Optional: If it's a logged-in Hotel, try to use their stored address
    if (req.user && req.user.role === 'Hotel') {
      const hotel = await Hotel.findById(req.user._id);
      if (hotel && hotel.state) {
        // If they have a state/city saved, append it.
        // Using State + India is safer than random text addresses
        queryLocation = `${hotel.state}, IN`;
      }
    }

    // 2. Check Cache
    const now = Date.now();
    if (
      weatherCache.data &&
      now - weatherCache.lastFetch < CACHE_DURATION &&
      weatherCache.location === queryLocation
    ) {
      return res.status(200).json(weatherCache.data);
    }

    // 3. Fetch from OpenWeatherMap
    // We use 'metric' units for Celsius
    const apiKey = process.env.WEATHER_API_KEY;
    if (!apiKey) {
      throw new Error('Weather API Key is missing in .env');
    }

    const url = `https://api.openweathermap.org/data/2.5/weather?q=${queryLocation}&units=metric&appid=${apiKey}`;

    const response = await axios.get(url);
    const data = response.data;

    // 4. Format Data (Send only what frontend needs)
    const weatherData = {
      temp: Math.round(data.main.temp), // Round to whole number (e.g. 28)
      condition: data.weather[0].main, // e.g. "Clouds", "Clear"
      description: data.weather[0].description, // e.g. "scattered clouds"
      iconCode: data.weather[0].icon, // e.g. "01d"
      location: data.name,
    };

    // 5. Update Cache
    weatherCache = {
      data: weatherData,
      lastFetch: now,
      location: queryLocation,
    };

    res.status(200).json(weatherData);
  } catch (error) {
    console.error('Weather Fetch Error:', error.message);
    // Fallback data so the UI doesn't break
    res.status(200).json({
      temp: '--',
      condition: 'Unavailable',
      iconCode: 'unknown',
      location: 'India',
    });
  }
};
