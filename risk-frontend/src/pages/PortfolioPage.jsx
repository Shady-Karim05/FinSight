import React, { useState } from 'react';
import { Sparkles, ShieldCheck, Scale, RefreshCw, User, CheckSquare, LogIn } from 'lucide-react';
import PortfolioAnalysis from '../components/PortfolioAnalysis';
import { apiService } from '../services/api';
import { useAuth } from '../context/AuthContext';

const PortfolioPage = () => {
  const { user, isAuthenticated, openAuthModal } = useAuth();
  const [assets, setAssets] = useState([]);
  const [selectedAssets, setSelectedAssets] = useState([]);
  const [weights, setWeights] = useState({});
  const [optimizing, setOptimizing] = useState(false);
  const [optResult, setOptResult] = useState(null);

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

        // Automatically pre-select user's first 2 to 4 stocks if available
        if (stockList.length >= 2) {
          const initialSelected = stockList.slice(0, Math.min(4, stockList.length));
          setSelectedAssets(initialSelected);
          const initialWeight = (1 / initialSelected.length).toFixed(3);
          const initialWeights = {};
          initialSelected.forEach((a) => {
            initialWeights[a] = parseFloat(initialWeight);
          });
          setWeights(initialWeights);
        } else {
          setSelectedAssets(stockList);
        }
      } catch (err) {
        setAssets([]);
      }
    };
    fetchAssets();
  }, [isAuthenticated]);

  const handleSelectAll = () => {
    if (assets.length === 0) return;
    setSelectedAssets(assets);
    const equalWeight = (1 / assets.length).toFixed(3);
    const newWeights = {};
    assets.forEach((a) => {
      newWeights[a] = parseFloat(equalWeight);
    });
    setWeights(newWeights);
    setOptResult(null);
  };

  const handleAssetChange = (e) => {
    const { options } = e.target;
    const selected = [];
    for (let i = 0; i < options.length; i++) {
      if (options[i].selected) {
        selected.push(options[i].value);
      }
    }
    setSelectedAssets(selected);
    setOptResult(null);
    // Remove weights for unselected assets
    setWeights((prev) => {
      const newWeights = { ...prev };
      Object.keys(newWeights).forEach((k) => {
        if (!selected.includes(k)) delete newWeights[k];
      });
      return newWeights;
    });
  };

  const handleWeightChange = (asset, value) => {
    setWeights((prev) => ({ ...prev, [asset]: value }));
  };

  const handleOptimize = async (objective) => {
    if (selectedAssets.length < 2) return;
    try {
      setOptimizing(true);
      const res = await apiService.optimizePortfolio(selectedAssets, objective);
      if (res && res.weights) {
        setWeights(res.weights);
        setOptResult(res);
      }
    } catch (err) {
      console.error('Optimization error:', err);
    } finally {
      setOptimizing(false);
    }
  };

  const handleEqualizeWeights = () => {
    if (selectedAssets.length === 0) return;
    const equalWeight = (1 / selectedAssets.length).toFixed(3);
    const newWeights = {};
    selectedAssets.forEach((a) => {
      newWeights[a] = parseFloat(equalWeight);
    });
    setWeights(newWeights);
    setOptResult(null);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 bg-gray-50 dark:bg-gray-900 min-h-screen">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-2">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Portfolio Analysis & Optimization</h1>
        {isAuthenticated && (
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 w-fit">
            <User className="w-3.5 h-3.5 mr-1" />
            {user?.username}'s Watchlist ({assets.length} stocks)
          </span>
        )}
      </div>

      <p className="text-gray-600 dark:text-gray-400 mb-6">
        {isAuthenticated
          ? "Analyzing allocation and risk across your personally chosen watchlist stocks."
          : "Select two or more assets to analyze portfolio risk, return, and correlations."}
      </p>

      {/* Guest Mode Callout */}
      {!isAuthenticated && (
        <div className="mb-6 p-4 rounded-xl bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 flex items-center justify-between gap-4">
          <div className="text-sm text-blue-900 dark:text-blue-300">
            <strong>Viewing default public stocks.</strong> Sign in to optimize your private, saved stock portfolio.
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
        <div className="flex items-center justify-between mb-2 max-w-lg">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            {isAuthenticated ? 'Your Watchlist Assets' : 'Select Assets'} (Hold Ctrl/Cmd to select multiple)
          </label>
          {assets.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSelectAll}
                className="text-xs text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1 font-medium"
              >
                <CheckSquare className="w-3.5 h-3.5" />
                Select All ({assets.length})
              </button>
              {selectedAssets.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setSelectedAssets([]); setWeights({}); setOptResult(null); }}
                  className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:underline"
                >
                  Clear
                </button>
              )}
            </div>
          )}
        </div>

        {assets.length === 0 ? (
          <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-sm">
            Your personal watchlist is currently empty. Visit the Dashboard and click the Star (⭐) on any stock to add it here.
          </div>
        ) : (
          <select
            multiple
            value={selectedAssets}
            onChange={handleAssetChange}
            className="block w-full max-w-lg px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            size={Math.min(Math.max(assets.length, 3), 6)}
          >
            {assets.map((asset) => (
              <option key={asset} value={asset} className="dark:bg-gray-700 py-1">
                {asset}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Modern Portfolio Theory (MPT) Optimizer Actions */}
      {selectedAssets.length >= 2 && (
        <div className="mb-6 p-4 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-1.5">
                <Sparkles className="w-5 h-5 text-amber-500" />
                Markowitz Portfolio Optimizer (MPT)
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Mathematically optimize weights using Modern Portfolio Theory
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleOptimize('max_sharpe')}
                disabled={optimizing}
                className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5 rounded bg-primary-600 hover:bg-primary-700 text-white shadow"
                title="Find allocation that maximizes risk-adjusted return"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {optimizing ? 'Optimizing...' : 'Max Sharpe Ratio'}
              </button>
              <button
                type="button"
                onClick={() => handleOptimize('min_variance')}
                disabled={optimizing}
                className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5 rounded bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200"
                title="Find safest allocation that minimizes volatility"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-blue-500" />
                Safest Mix (Min Risk)
              </button>
              <button
                type="button"
                onClick={handleEqualizeWeights}
                className="text-xs px-2.5 py-1.5 flex items-center gap-1 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                title="Reset to 1/N equal weighting"
              >
                <Scale className="w-3.5 h-3.5" />
                Equalize
              </button>
            </div>
          </div>

          {/* Optimization Results Badge */}
          {optResult && !optResult.error && (
            <div className="mb-4 p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-md text-xs text-emerald-800 dark:text-emerald-300 flex flex-wrap items-center gap-4">
              <span className="font-semibold uppercase tracking-wider">
                {optResult.objective === 'max_sharpe' ? '⚡ Maximum Sharpe Optimal Mix' : '🛡️ Minimum Variance Optimal Mix'}
              </span>
              <span>Expected Annual Return: <strong>{(optResult.expected_annual_return * 100).toFixed(2)}%</strong></span>
              <span>Annual Volatility: <strong>{(optResult.annual_volatility * 100).toFixed(2)}%</strong></span>
              <span>Sharpe Ratio: <strong>{optResult.sharpe_ratio.toFixed(2)}</strong></span>
            </div>
          )}

          {/* Custom Weights Inputs */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
              Allocation Weights (Adjust manually or use buttons above):
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {selectedAssets.map((asset) => (
                <div key={asset} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700/50 rounded border border-gray-200 dark:border-gray-600">
                  <span className="text-sm font-medium text-gray-900 dark:text-white truncate max-w-[140px]">{asset}</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      value={weights[asset] !== undefined ? weights[asset] : ''}
                      onChange={e => handleWeightChange(asset, e.target.value)}
                      className="w-20 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-right"
                      placeholder="0.00"
                    />
                    <span className="text-xs text-gray-500">
                      ({((parseFloat(weights[asset]) || 0) * 100).toFixed(0)}%)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <PortfolioAnalysis selectedAssets={selectedAssets} weights={weights} />
    </div>
  );
};

export default PortfolioPage;
