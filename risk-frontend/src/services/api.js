import axios from 'axios';

const rawBaseUrl = import.meta.env.VITE_API_BASE_URL || 'https://finsight-1-etew.onrender.com';
const API_BASE_URL = rawBaseUrl.endsWith('/') ? rawBaseUrl : `${rawBaseUrl}/`;

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 35000,
});

// API service functions
export const apiService = {
  // Get available assets/tickers
  getAssets: async () => {
    try {
      const response = await api.get('/api/assets');
      return response.data;
    } catch (error) {
      console.error('Error fetching assets:', error);
      throw error;
    }
  },

  // Add any custom asset ticker on the fly
  addAsset: async (ticker) => {
    try {
      const response = await api.post(`/api/assets/add?ticker=${encodeURIComponent(ticker)}`);
      return response.data;
    } catch (error) {
      console.error('Error adding asset:', error);
      throw error;
    }
  },

  // Get risk metrics for a specific ticker
  getMetrics: async (ticker) => {
    try {
      const response = await api.get(`/api/metrics?ticker=${ticker}`);
      return response.data;
    } catch (error) {
      console.error(`Error fetching metrics for ${ticker}:`, error);
      throw error;
    }
  },

  // Get historical data for a ticker
  getHistory: async (ticker) => {
    try {
      const response = await api.get(`/api/history?ticker=${ticker}`);
      return response.data;
    } catch (error) {
      console.error(`Error fetching history for ${ticker}:`, error);
      throw error;
    }
  },

  // Get risk alerts
  getRiskAlerts: async (threshold = 0.05) => {
    try {
      const response = await api.get(`/api/risk_alerts?threshold=${threshold}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching risk alerts:', error);
      throw error;
    }
  },

  // Get price predictions
  getPredictions: async (ticker, days = 7) => {
    try {
      const response = await api.post('/api/predict', {
        ticker,
        days
      });
      return response.data;
    } catch (error) {
      console.error(`Error fetching predictions for ${ticker}:`, error);
      throw error;
    }
  },

  // Get market sentiment and technical indicators
  getSentiment: async (ticker) => {
    try {
      const response = await api.get(`/api/sentiment/${ticker}`);
      return response.data;
    } catch (error) {
      console.error(`Error fetching sentiment for ${ticker}:`, error);
      throw error;
    }
  },

  // Get portfolio analysis
  getPortfolioAnalysis: async (tickers, weights) => {
    try {
      const tickerString = Array.isArray(tickers) ? tickers.join(',') : tickers;
      let url = `/api/portfolio?tickers=${tickerString}`;
      if (weights && Object.keys(weights).length > 0) {
        url += `&weights=${encodeURIComponent(JSON.stringify(weights))}`;
      }
      const response = await api.get(url);
      return response.data;
    } catch (error) {
      console.error('Error fetching portfolio analysis:', error);
      throw error;
    }
  },

  // Markowitz Modern Portfolio Theory Optimizer
  optimizePortfolio: async (tickers, objective = 'max_sharpe') => {
    try {
      const tickerString = Array.isArray(tickers) ? tickers.join(',') : tickers;
      const response = await api.get(`/api/portfolio/optimize?tickers=${tickerString}&objective=${objective}`);
      return response.data;
    } catch (error) {
      console.error('Error optimizing portfolio:', error);
      throw error;
    }
  },

  // Get system health status
  getHealthStatus: async () => {
    try {
      const response = await api.get('/api/health');
      return response.data;
    } catch (error) {
      console.error('Error fetching health status:', error);
      throw error;
    }
  },

  // Test portfolio data fetching
  testPortfolio: async (tickers) => {
    try {
      const tickerString = Array.isArray(tickers) ? tickers.join(',') : tickers;
      const response = await api.get(`/api/portfolio_test?tickers=${tickerString}`);
      return response.data;
    } catch (error) {
      console.error('Error testing portfolio:', error);
      throw error;
    }
  },

  // Test endpoint
  testConnection: async (ticker = 'AAPL') => {
    try {
      const response = await api.get(`/api/test?ticker=${ticker}`);
      return response.data;
    } catch (error) {
      console.error('Error testing connection:', error);
      throw error;
    }
  }
};

export default api;
