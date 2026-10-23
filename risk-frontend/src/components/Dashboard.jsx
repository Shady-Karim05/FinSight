import React, { useState, useEffect } from 'react';
import { 
  TrendingUp, 
  TrendingDown, 
  BarChart3, 
  AlertTriangle,
  Calendar,
  Target,
  Layers,
  Activity,
  ArrowLeftRight,
  ShieldAlert,
  Download,
  PlusCircle,
  Star,
  Bookmark
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { formatPercentage, formatCurrency, formatNumber } from '../utils/riskUtils';
import MetricCard from './MetricCard';
import PriceChart from './PriceChart';
import { saveAs } from 'file-saver'; // For saving files (optional, can use anchor download)

const Dashboard = () => {
  const { user, isAuthenticated, openAuthModal, updateWatchlistCount } = useAuth();
  const [selectedAsset, setSelectedAsset] = useState('');
  const [userWatchlist, setUserWatchlist] = useState([]);
  const [isTogglingStar, setIsTogglingStar] = useState(false);
  const [assets, setAssets] = useState([]);
  const [metrics, setMetrics] = useState({});
  const [history, setHistory] = useState({ history: [], dates: [] });
  const [predictions, setPredictions] = useState({ prediction: [], method: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [newTickerInput, setNewTickerInput] = useState('');
  const [isAddingTicker, setIsAddingTicker] = useState(false);
  const [addTickerFeedback, setAddTickerFeedback] = useState(null);

  const isSelectedInWatchlist = userWatchlist.includes(selectedAsset);

  const handleToggleWatchlist = async () => {
    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }
    if (!selectedAsset) return;

    try {
      setIsTogglingStar(true);
      if (isSelectedInWatchlist) {
        await apiService.removeFromUserWatchlist(selectedAsset);
        const updated = userWatchlist.filter(t => t !== selectedAsset);
        setUserWatchlist(updated);
        updateWatchlistCount(-1);
      } else {
        await apiService.addToUserWatchlist(selectedAsset);
        const updated = [...userWatchlist, selectedAsset];
        setUserWatchlist(updated);
        updateWatchlistCount(1);
      }
    } catch (err) {
      console.error('Error toggling watchlist:', err);
    } finally {
      setIsTogglingStar(false);
    }
  };

  const handleAddTicker = async () => {
    const raw = newTickerInput.trim().toUpperCase();
    if (!raw) return;
    try {
      setIsAddingTicker(true);
      setAddTickerFeedback(null);

      if (isAuthenticated) {
        const res = await apiService.addToUserWatchlist(raw);
        setAddTickerFeedback({ type: 'success', message: res.message || `${res.ticker} added to your personal watchlist!` });
        const ticker = res.ticker || raw;
        if (!assets.includes(ticker)) {
          setAssets(prev => [ticker, ...prev]);
        }
        if (!userWatchlist.includes(ticker)) {
          setUserWatchlist(prev => [ticker, ...prev]);
        }
        updateWatchlistCount(1);
        setSelectedAsset(ticker);
        setNewTickerInput('');
        loadAssetData(ticker);
      } else {
        const res = await apiService.addAsset(raw);
        if (res.error) {
          setAddTickerFeedback({ type: 'error', message: res.error.message || 'Failed to add ticker.' });
        } else {
          setAddTickerFeedback({ type: 'success', message: res.message || `${res.ticker} added successfully!` });
          if (!assets.includes(res.ticker)) {
            setAssets(prev => [...prev, res.ticker]);
          }
          setSelectedAsset(res.ticker);
          setNewTickerInput('');
          loadAssetData(res.ticker);
        }
      }
    } catch (err) {
      setAddTickerFeedback({ type: 'error', message: err.message || 'Error communicating with server.' });
    } finally {
      setIsAddingTicker(false);
    }
  };
  const [dashboardError, setDashboardError] = useState(null);
  const [isComparing, setIsComparing] = useState(false);
  const [comparisonData, setComparisonData] = useState(null);
  const [comparisonTimeFrame, setComparisonTimeFrame] = useState('1Y'); // Default comparison timeframe
  const [assetError, setAssetError] = useState(null);
  const [assetLoading, setAssetLoading] = useState(false);
  const [timeFrame, setTimeFrame] = useState('6M'); // Default time frame

  useEffect(() => {
    loadDashboardData();
  }, [isAuthenticated]);

  useEffect(() => {
    if (selectedAsset && selectedAsset !== '') {
      setAssetError(null); // Clear asset error on new selection
      loadAssetData(selectedAsset);
    }
  }, [selectedAsset]);
  
  // Load comparison data when parameters change
  useEffect(() => {
    if (isComparing && selectedAsset) {
      console.log('Loading comparison data due to parameter change:', { timeFrame, selectedAsset, comparisonTimeFrame });
      loadComparisonData();
    }
  }, [timeFrame, selectedAsset, comparisonTimeFrame, isComparing]);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      setDashboardError(null);

      let assetsData = [];

      if (isAuthenticated) {
        try {
          const watchlistRes = await apiService.getUserWatchlist();
          assetsData = watchlistRes.tickers || [];
          setUserWatchlist(watchlistRes.tickers || []);
        } catch (authErr) {
          console.warn('Could not load user watchlist, falling back to public assets:', authErr);
          const publicAssets = await apiService.getAssets();
          assetsData = publicAssets;
        }
      } else {
        const publicAssets = await apiService.getAssets();
        assetsData = publicAssets;
      }
      
      setAssets(assetsData);
      
      // Load data for first asset only if we have assets and no asset is currently selected
      if (assetsData.length > 0 && (!selectedAsset || !assetsData.includes(selectedAsset))) {
        setSelectedAsset(assetsData[0]);
      }
    } catch (err) {
      setDashboardError('Failed to load dashboard data');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadAssetData = async (ticker) => {
    try {
      setAssetError(null);
      setAssetLoading(true);
      
      // Fetch metrics, history, and predictions concurrently and resiliently
      const results = await Promise.allSettled([
        apiService.getMetrics(ticker),
        apiService.getHistory(ticker, timeFrame),
        apiService.getPredictions(ticker, 7)
      ]);
      
      const metricsRes = results[0].status === 'fulfilled' ? results[0].value : null;
      const historyRes = results[1].status === 'fulfilled' ? results[1].value : null;
      const predictionsRes = results[2].status === 'fulfilled' ? results[2].value : null;
      
      // Check if both core data sources failed
      if ((!metricsRes || metricsRes.error) && (!historyRes || historyRes.error)) {
        const errorMsg = (metricsRes && metricsRes.error && metricsRes.error.message) || 
                         (historyRes && historyRes.error && historyRes.error.message) || 
                         'Failed to load asset data.';
        throw new Error(errorMsg);
      }
      
      if (metricsRes && !metricsRes.error) {
        setMetrics(metricsRes);
      }
      if (historyRes && !historyRes.error) {
        setHistory(historyRes);
      }
      if (predictionsRes && !predictionsRes.error) {
        setPredictions(predictionsRes);
      } else {
        setPredictions({ prediction: [], method: '' });
      }
      
      // If comparison is active, reload comparison data
      if (isComparing) {
        loadComparisonData();
      }
    } catch (err) {
      console.error('Error loading asset data:', err);
      setAssetError(err);
    } finally {
      setAssetLoading(false);
    }
  };
  
  // Load historical data for comparison
  const loadComparisonData = async () => {
    if (!selectedAsset) {
      console.log('Not loading comparison data: No asset selected');
      return;
    }
    
    try {
      console.log(`Loading comparison data for ${selectedAsset} with timeframe ${comparisonTimeFrame}`);
      const historyData = await apiService.getHistory(selectedAsset, comparisonTimeFrame);
      
      if (historyData.error) {
        console.error('Error loading comparison data:', historyData.error);
        setComparisonData(null);
        return;
      }
      
      console.log('Raw history data for comparison:', historyData);
      
      // Format comparison data to match chart data format
      if (historyData.history && historyData.dates) {
        const formattedData = historyData.history.map((price, index) => {
          // Ensure date format matches the main chart data format
          const dateStr = historyData.dates[index];
          return {
            date: dateStr,
            comparison: parseFloat(price)
          };
        });
        
        console.log('Formatted comparison data sample:', formattedData.slice(0, 3));
        setComparisonData(formattedData);
      } else {
        console.log('Invalid history data format for comparison');
        setComparisonData(null);
      }
    } catch (err) {
      console.error('Error in loadComparisonData:', err);
      setComparisonData(null);
    }
  };
  
  // Toggle comparison mode
  const toggleComparison = (newIsComparing) => {
    console.log('Toggling comparison mode:', { current: isComparing, new: newIsComparing });
    setIsComparing(newIsComparing);
    
    if (newIsComparing) {
      loadComparisonData();
    } else {
      setComparisonData(null);
    }
  };

  const handleAssetChange = (ticker) => {
    if (ticker !== selectedAsset) {
      setSelectedAsset(ticker);
    }
  };
  
  // Handle comparison timeframe change
  const handleComparisonTimeFrameChange = (tf) => {
    if (tf !== comparisonTimeFrame) {
      setComparisonTimeFrame(tf);
    }
  };


  // Utility function to convert metrics & historical prices to CSV and trigger download
  const exportMetricsToCSV = () => {
    const rows = [
      ['=== FinSight Risk Analytics Report ==='],
      ['Asset', selectedAsset || 'N/A'],
      ['Generated At', new Date().toISOString()],
      [],
      ['--- Executive Risk Metrics ---'],
      ['Metric', 'Value', 'Interpretation'],
      ['Annualized Volatility', `${((metrics.volatility || 0) * 100).toFixed(2)}%`, 'Price fluctuation scale'],
      ['Value at Risk (VaR 99%)', `${((metrics.VaR_99 || 0) * 100).toFixed(2)}%`, 'Maximum expected daily loss on 99% of days'],
      ['CVaR (99% Expected Shortfall)', `${((metrics.CVaR_99 || metrics.VaR_99 || 0) * 100).toFixed(2)}%`, 'Average expected loss in worst 1% tail events'],
      ['Sharpe Ratio', Number(metrics.sharpe_ratio || 0).toFixed(2), 'Risk-adjusted return'],
      ['Sortino Ratio', Number(metrics.sortino_ratio || 0).toFixed(2), 'Downside risk-adjusted return'],
      ['Maximum Drawdown', `${((metrics.max_drawdown || 0) * 100).toFixed(2)}%`, 'Worst peak-to-trough decline'],
      ['Calmar Ratio', Number(metrics.calmar_ratio || 0).toFixed(2), 'Annual return vs max drawdown'],
      ['Max Consecutive Losses', metrics.max_consecutive_losses || 0, 'Longest loss streak in days'],
      [],
      ['--- Historical Prices & Daily Returns ---'],
      ['Date', 'Close Price', 'Daily Return (%)']
    ];

    if (history && history.history && history.dates) {
      history.history.forEach((price, idx) => {
        const prevPrice = idx > 0 ? history.history[idx - 1] : null;
        const dailyRet = prevPrice ? (((price - prevPrice) / prevPrice) * 100).toFixed(2) + '%' : '0.00%';
        rows.push([history.dates[idx] || '', price, dailyRet]);
      });
    }

    const csvContent = rows.map(e => e.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const filename = `${selectedAsset ? selectedAsset.replace(/[^a-zA-Z0-9_-]/g, '_') : 'asset'}_risk_report.csv`;

    if (window.navigator.msSaveOrOpenBlob) {
      window.navigator.msSaveBlob(blob, filename);
    } else {
      const link = document.createElement('a');
      if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    }
  };

  // Helper to filter chart data by time frame
  const filterChartData = (data, timeFrame) => {
    if (!data || data.length === 0) return [];
    if (timeFrame === 'All') return data;
    const now = new Date(data[data.length - 1].date);
    let cutoff;
    switch (timeFrame) {
      case '1M':
        cutoff = new Date(now); cutoff.setMonth(now.getMonth() - 1); break;
      case '3M':
        cutoff = new Date(now); cutoff.setMonth(now.getMonth() - 3); break;
      case '6M':
        cutoff = new Date(now); cutoff.setMonth(now.getMonth() - 6); break;
      case '1Y':
        cutoff = new Date(now); cutoff.setFullYear(now.getFullYear() - 1); break;
      default:
        return data;
    }
    return data.filter(d => new Date(d.date) >= cutoff);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary-600 dark:border-primary-400"></div>
      </div>
    );
  }

  if (dashboardError) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Error</h2>
          <p className="text-gray-600 dark:text-gray-400">{dashboardError}</p>
          <button 
            onClick={loadDashboardData}
            className="btn-primary mt-4"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Asset error blocks only asset-specific content
  let assetErrorMessage = null;
  let assetErrorSuggestion = '';
  if (assetError) {
    if (typeof assetError === 'object' && assetError !== null && assetError.error) {
      assetErrorMessage = assetError.error.message || 'An error occurred.';
      assetErrorSuggestion = assetError.error.suggestion || '';
    } else if (typeof assetError === 'string') {
      assetErrorMessage = assetError;
    }
  }

  const chartData = history.history && history.dates ? 
    history.history.map((price, index) => ({
      date: history.dates[index],
      price: parseFloat(price)
    })) : [];
  const filteredChartData = filterChartData(chartData, timeFrame);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Risk Dashboard</h1>
            <p className="text-gray-600 dark:text-gray-400 mt-2">Predictive analysis and risk assessment</p>
          </div>
          <div className="flex gap-2">
            <Link to="/portfolio" className="btn-secondary flex items-center dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"><Layers className="w-4 h-4 mr-1" /> Portfolio Analysis</Link>
            <Link to="/sentiment" className="btn-secondary flex items-center dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"><Activity className="w-4 h-4 mr-1" /> Sentiment Analysis</Link>
          </div>
        </div>

        {/* Asset Selector & Dynamic Stock Addition */}
        <div className="mb-6">
          <div className="flex flex-col sm:flex-row sm:items-end gap-4">
            <div className="w-full sm:w-72">
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {isAuthenticated ? 'My Watchlist' : 'Select Stock'}
                </label>
                {isAuthenticated ? (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300">
                    {assets.length} Stocks
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => openAuthModal('login')}
                    className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Sign in to save
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <select
                  value={selectedAsset}
                  onChange={(e) => handleAssetChange(e.target.value)}
                  className="block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  {assets.map((asset) => (
                    <option key={asset} value={asset}>
                      {asset}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleToggleWatchlist}
                  disabled={isTogglingStar || !selectedAsset}
                  title={
                    !isAuthenticated
                      ? "Sign In to save to your personal watchlist"
                      : isSelectedInWatchlist
                        ? "Remove from your personal watchlist"
                        : "Add to your personal watchlist"
                  }
                  className={`p-2.5 rounded-md border flex items-center justify-center transition-all ${
                    isSelectedInWatchlist
                      ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700 text-amber-500 shadow-sm'
                      : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-400 hover:text-amber-500 hover:border-amber-300'
                  }`}
                >
                  <Star className={`w-5 h-5 ${isSelectedInWatchlist ? 'fill-amber-400 text-amber-400' : ''}`} />
                </button>
              </div>
            </div>

            <div className="flex-1 max-w-md">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Analyze Any Stock (NSE/BSE/Global)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. ETERNAL.NS (Zomato), AAPL, PAYTM.NS"
                  value={newTickerInput}
                  onChange={(e) => setNewTickerInput(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddTicker()}
                  disabled={isAddingTicker}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <button
                  type="button"
                  onClick={handleAddTicker}
                  disabled={isAddingTicker || !newTickerInput.trim()}
                  className="btn-primary flex items-center gap-1.5 px-4 py-2 text-sm rounded-md bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white font-medium shadow whitespace-nowrap"
                >
                  <PlusCircle className="w-4 h-4" />
                  {isAddingTicker ? 'Fetching...' : 'Add & Track'}
                </button>
              </div>
            </div>
          </div>

          {addTickerFeedback && (
            <div className={`mt-2 text-xs p-2 rounded max-w-lg ${
              addTickerFeedback.type === 'error'
                ? 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300 border border-red-200 dark:border-red-800'
                : 'bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-300 border border-green-200 dark:border-green-800'
            }`}>
              {addTickerFeedback.message}
            </div>
          )}
        </div>

        <div className="mb-8">
          {/* Risk Metrics */}
          {/* Export Button */}
          <div className="flex justify-end mb-2">
            <button
              className="btn-primary px-4 py-2 rounded shadow dark:bg-primary-600 dark:hover:bg-primary-700 flex items-center gap-1.5 text-sm"
              onClick={exportMetricsToCSV}
              title="Download full risk report with metrics and historical prices"
            >
              <Download className="w-4 h-4" />
              Export Risk Report (.CSV)
            </button>
          </div>
          {/* Fix: Always render advanced metrics and below, only replace the metrics grid with error if needed */}
          <>
            {assetErrorMessage ? (
              <div className="bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-300 p-4 rounded mb-4">
                <div className="font-semibold">{assetErrorMessage}</div>
                {assetErrorSuggestion && <div className="text-sm">Suggestion: {assetErrorSuggestion}</div>}
                <button onClick={() => loadAssetData(selectedAsset)} className="btn-primary mt-2">Retry</button>
              </div>
            ) : assetLoading ? (
              // Loading state for metrics
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="metric-card bg-white dark:bg-gray-800 p-4 rounded-lg shadow animate-pulse">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="w-5 h-5 bg-gray-300 dark:bg-gray-600 rounded"></div>
                        <div>
                          <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-20 mb-2"></div>
                          <div className="h-6 bg-gray-300 dark:bg-gray-600 rounded w-16"></div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {selectedAsset && Object.keys(metrics).length > 0 ? (
                  <>
                    <MetricCard
                      title="Volatility"
                      value={metrics.volatility || 0}
                      format="percentage"
                      icon={BarChart3}
                      subtitle="Annualized volatility"
                    />
                    <MetricCard
                      title="VaR (99%)"
                      value={metrics.VaR_99 || 0}
                      format="percentage"
                      icon={AlertTriangle}
                      subtitle="Value at Risk"
                    />
                    <MetricCard
                      title="Sharpe Ratio"
                      value={metrics.sharpe_ratio || 0}
                      format="number"
                      icon={Target}
                      subtitle="Risk-adjusted return"
                    />
                    <MetricCard
                      title="Max Drawdown"
                      value={metrics.max_drawdown || 0}
                      format="percentage"
                      icon={TrendingDown}
                      subtitle="Maximum decline"
                    />
                  </>
                ) : (
                  // Empty state for metrics
                  Array.from({ length: 4 }).map((_, index) => (
                    <div key={index} className="metric-card bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <div className="w-5 h-5 bg-gray-200 dark:bg-gray-700 rounded"></div>
                          <div>
                            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-20 mb-2"></div>
                            <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-16"></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
            {/* Advanced Risk Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
              {assetLoading ? (
                Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="metric-card bg-white dark:bg-gray-800 p-4 rounded-lg shadow animate-pulse">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="w-5 h-5 bg-gray-300 dark:bg-gray-600 rounded"></div>
                        <div>
                          <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-24 mb-2"></div>
                          <div className="h-6 bg-gray-300 dark:bg-gray-600 rounded w-16"></div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              ) : selectedAsset && Object.keys(metrics).length > 0 ? (
                <>
                  <MetricCard
                    title="CVaR (99%)"
                    value={metrics.CVaR_99 || 0}
                    format="percentage"
                    icon={ShieldAlert}
                    subtitle="Expected Shortfall (tail risk)"
                  />
                  <MetricCard
                    title="Sortino Ratio"
                    value={metrics.sortino_ratio || 0}
                    format="number"
                    icon={TrendingUp}
                    subtitle="Downside risk-adjusted return"
                  />
                  <MetricCard
                    title="Calmar Ratio"
                    value={metrics.calmar_ratio || 0}
                    format="number"
                    icon={BarChart3}
                    subtitle="Return vs. drawdown"
                  />
                  <MetricCard
                    title="Max Consecutive Losses"
                    value={metrics.max_consecutive_losses || 0}
                    format="number"
                    icon={AlertTriangle}
                    subtitle="Longest loss streak"
                  />
                </>
              ) : (
                // Empty state for advanced metrics
                Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="metric-card bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="w-5 h-5 bg-gray-200 dark:bg-gray-700 rounded"></div>
                        <div>
                          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-24 mb-2"></div>
                          <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-16"></div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        </div>

        {/* Time Frame and Comparison Controls */}
        <div className="mb-4 flex flex-wrap items-center gap-4">
          <div className="flex gap-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300 self-center">Time Frame:</span>
            {['1M', '3M', '6M', '1Y'].map(tf => (
              <button
                key={tf}
                className={`px-3 py-1 rounded ${timeFrame === tf ? 'bg-primary-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200'}`}
                onClick={() => setTimeFrame(tf)}
              >
                {tf}
              </button>
            ))}
          </div>
          
          <div className="flex items-center gap-2">
            <button
              className={`flex items-center gap-1 px-3 py-1 rounded ${isComparing ? 'bg-green-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200'}`}
              onClick={() => toggleComparison(!isComparing)}
            >
              <ArrowLeftRight className="w-4 h-4" />
              {isComparing ? 'Comparing' : 'Compare'}
            </button>
            
            {isComparing && (
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">vs</span>
                <select
                  value={comparisonTimeFrame}
                  onChange={(e) => handleComparisonTimeFrameChange(e.target.value)}
                  className="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                >
                  {['1M', '3M', '6M', '1Y', '2Y', '5Y'].map(tf => (
                    <option key={tf} value={tf}>{tf}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        <div className="w-full">
          {/* Price Chart */}
          {assetLoading ? (
            <div className="card bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 dark:border-primary-400"></div>
                <span className="ml-2 text-gray-600 dark:text-gray-400">Loading chart data...</span>
              </div>
            </div>
          ) : selectedAsset && filteredChartData.length > 0 ? (
            <PriceChart
              data={filteredChartData}
              comparisonData={comparisonData}
              title={`${selectedAsset} Price History${isComparing ? ` (vs ${comparisonTimeFrame})` : ''}`}
              height={400}
              ticker={selectedAsset}
            />
          ) : selectedAsset ? (
            <div className="card bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 dark:border-primary-400"></div>
                <span className="ml-2 text-gray-600 dark:text-gray-400">Loading chart data...</span>
              </div>
            </div>
          ) : (
            <div className="card bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
              <div className="text-center py-8">
                <BarChart3 className="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Price Chart</h3>
                <p className="text-gray-600 dark:text-gray-400">Select an asset to view price history</p>
              </div>
            </div>
          )}
        </div>

        {/* Predictions Section */}
        {predictions.prediction && predictions.prediction.length > 0 && (
          <div className="mt-8">
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Price Predictions
                </h3>
                <span className="text-sm text-gray-500">
                  Method: {predictions.method}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-4">
                {predictions.prediction.map((price, index) => (
                  <div key={index} className="text-center p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-500">Day {index + 1}</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {formatCurrency(price, selectedAsset)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      
    </div>
  );
};

export default Dashboard;