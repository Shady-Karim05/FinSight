import React, { useState } from 'react';
import { User, LogIn } from 'lucide-react';
import SentimentAnalysis from '../components/SentimentAnalysis';
import { apiService } from '../services/api';
import { useAuth } from '../context/AuthContext';

const SentimentPage = () => {
  const { user, isAuthenticated, openAuthModal } = useAuth();
  const [assets, setAssets] = useState([]);
  const [selectedAsset, setSelectedAsset] = useState('');

  React.useEffect(() => {
    const fetchAssets = async () => {
      try {
        let stockList = [];
        if (isAuthenticated) {
          const watchlistRes = await apiService.getUserWatchlist();
          stockList = watchlistRes.tickers || [];
        } else {
          stockList = await apiService.getAssets();
        }
        setAssets(stockList);
        if (stockList.length > 0 && (!selectedAsset || !stockList.includes(selectedAsset))) {
          setSelectedAsset(stockList[0]);
        }
      } catch (err) {
        setAssets([]);
      }
    };
    fetchAssets();
  }, [isAuthenticated]);

  const handleAssetChange = (e) => {
    setSelectedAsset(e.target.value);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 bg-gray-50 dark:bg-gray-900 min-h-screen">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-2">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Market Sentiment & Technical Signals</h1>
        {isAuthenticated && (
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 w-fit">
            <User className="w-3.5 h-3.5 mr-1" />
            {user?.username}'s Watchlist ({assets.length} stocks)
          </span>
        )}
      </div>

      <p className="text-gray-600 dark:text-gray-400 mb-6">
        {isAuthenticated
          ? "Viewing MACD, Bollinger Bands, and technical momentum for your chosen stocks."
          : "Select an asset to view technical indicators and sentiment signals."}
      </p>

      {/* Guest Mode Callout */}
      {!isAuthenticated && (
        <div className="mb-6 p-4 rounded-xl bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 flex items-center justify-between gap-4">
          <div className="text-sm text-blue-900 dark:text-blue-300">
            <strong>Viewing default public stocks.</strong> Sign in to see technical indicators for your personal watchlist.
          </div>
          <button
            type="button"
            onClick={() => openAuthModal('login')}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-sm transition-all whitespace-nowrap"
          >
            <LogIn className="w-3.5 h-3.5" />
            Sign In
          </button>
        </div>
      )}

      {/* Asset Selector */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          {isAuthenticated ? 'Your Watchlist Asset' : 'Select Asset'}
        </label>
        {assets.length === 0 ? (
          <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-sm">
            Your personal watchlist is currently empty. Visit the Dashboard to add your favorite stocks to track them here.
          </div>
        ) : (
          <select
            value={selectedAsset}
            onChange={handleAssetChange}
            className="block w-full max-w-xs px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          >
            {assets.map((asset) => (
              <option key={asset} value={asset} className="dark:bg-gray-700">
                {asset}
              </option>
            ))}
          </select>
        )}
      </div>

      {selectedAsset && <SentimentAnalysis ticker={selectedAsset} />}
    </div>
  );
};

export default SentimentPage; 