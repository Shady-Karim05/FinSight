import os
from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
import yfinance as yf
import numpy as np
from typing import Dict, List
from apscheduler.schedulers.background import BackgroundScheduler
from dotenv import load_dotenv
from pydantic import BaseModel
from statsmodels.tsa.arima.model import ARIMA
import pandas as pd
import psutil
import json
import atexit
from utils.cache import DATA_CACHE, scheduler
from routes.metrics import router as metrics_router
from routes.portfolio import router as portfolio_router
from routes.sentiment import router as sentiment_router
from database import Base, SessionLocal, engine
from models.stock_price import StockPrice
from datetime import date

load_dotenv()

app = FastAPI()
Base.metadata.create_all(bind=engine)

# Allow frontend to access backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

TICKERS = os.getenv("TICKERS", "RELIANCE.NS,HDFCBANK.NS,ICICIBANK.NS,INFY.NS,TCS.NS,LT.NS,ITC.NS,AXISBANK.NS,KOTAKBANK.NS,SBIN.NS,BHARTIARTL.NS,BAJFINANCE.NS,M&M.NS,MARUTI.NS,SUNPHARMA.NS,TATAMOTORS.NS,TATASTEEL.NS,TITAN.NS,ULTRACEMCO.NS,ASIANPAINT.NS,WIPRO.NS,HCLTECH.NS,NTPC.NS,POWERGRID.NS,TRENT.NS,ADANIENT.NS,ONGC.NS,COALINDIA.NS,JSWSTEEL.NS,BAJAJFINSV.NS").split(",")

# Move update_cache to utils/cache.py or define here and import if needed
from utils.cache import DATA_CACHE

def save_stock_prices(ticker: str, close: pd.Series):
    """Insert or update historical closing prices in SQLite."""
    db = SessionLocal()

    try:
        # Load existing dates for this ticker to prevent duplicates.
        existing_rows = (
            db.query(StockPrice)
            .filter(StockPrice.ticker == ticker)
            .all()
        )
        existing_by_date = {
            row.trade_date: row for row in existing_rows
        }

        changed = False

        for timestamp, price in close.items():
            if pd.isna(price):
                continue

            trade_date = pd.Timestamp(timestamp).date()
            close_price = float(price)

            existing = existing_by_date.get(trade_date)

            if existing:
                # Update a price if Yahoo Finance has revised it.
                if existing.close_price != close_price:
                    existing.close_price = close_price
                    changed = True
            else:
                db.add(
                    StockPrice(
                        ticker=ticker,
                        trade_date=trade_date,
                        close_price=close_price,
                    )
                )
                changed = True

        if changed:
            db.commit()

    except Exception as e:
        db.rollback()
        print(f"Error saving SQLite prices for {ticker}: {e}")

    finally:
        db.close()

def update_cache():
    for ticker in TICKERS:
        try:
            data = yf.download(ticker, period="6mo", interval="1d")
            if not data.empty:
                close_col = None
                if isinstance(data.columns, pd.MultiIndex):
                    for col in data.columns:
                        if "close" in str(col).lower():
                            close_col = col
                            break
                else:
                    close_col = 'Close'
                if close_col and close_col in data.columns:
                    close = data[close_col].dropna()
                    if isinstance(close, pd.DataFrame):
                        if close.shape[1] == 1:
                            close = close.iloc[:, 0]
                        else:
                            close = close.squeeze()
                    close = close if isinstance(close, pd.Series) else pd.Series(close)
                    save_stock_prices(ticker, close)
                    if len(close) >= 30:
                        returns = close.pct_change().dropna()
                        volatility = float(np.std(returns) * np.sqrt(252))
                        var_99 = float(np.percentile(returns, 1))
                        tail_losses = returns[returns <= var_99]
                        cvar_99 = float(tail_losses.mean()) if len(tail_losses) > 0 else var_99
                        sharpe = float((np.mean(returns) * 252) / (np.std(returns) * np.sqrt(252))) if np.std(returns) != 0 else 0
                        downside_returns = returns[returns < 0]
                        downside_deviation = np.std(downside_returns) * np.sqrt(252) if len(downside_returns) > 0 else 0
                        sortino = float((np.mean(returns) * 252) / downside_deviation) if downside_deviation != 0 else 0
                        consecutive_losses = 0
                        max_consecutive_losses = 0
                        for ret in returns:
                            if ret < 0:
                                consecutive_losses += 1
                                max_consecutive_losses = max(max_consecutive_losses, consecutive_losses)
                            else:
                                consecutive_losses = 0
                        annual_return = float(np.mean(returns) * 252)
                        roll_max = close.expanding().max()
                        daily_drawdown = (close / roll_max) - 1.0
                        max_drawdown = float(daily_drawdown.min())
                        calmar = float(annual_return / abs(max_drawdown)) if max_drawdown != 0 else 0
                        DATA_CACHE[ticker] = {
                            "metrics": {
                                "volatility": volatility,
                                "VaR_99": var_99,
                                "CVaR_99": cvar_99,
                                "sharpe_ratio": sharpe,
                                "max_drawdown": max_drawdown,
                                "sortino_ratio": sortino,
                                "max_consecutive_losses": max_consecutive_losses,
                                "calmar_ratio": calmar,
                            },
                            "history": close.tolist(),
                            "dates": [str(d.date()) for d in close.index],
                        }
        except Exception as e:
            print(f"Error updating cache for {ticker}: {e}")

import threading

scheduler.add_job(update_cache, 'interval', minutes=2)
scheduler.start()

# Pre-fetch all tickers in a non-blocking background thread
def _background_initial_prefetch():
    print("Pre-fetching tickers in background...")
    update_cache()
    print("Background pre-fetch complete.")

threading.Thread(target=_background_initial_prefetch, daemon=True).start()

# Include routers
app.include_router(metrics_router)
app.include_router(portfolio_router)
app.include_router(sentiment_router)

@app.get("/api/assets")
def get_assets() -> List[str]:
    return TICKERS

@app.post("/api/assets/add")
def add_asset(ticker: str = Query(..., description="Stock ticker symbol to add")) -> Dict:
    clean_ticker = ticker.strip().upper()
    if not clean_ticker:
        return {"error": {"message": "Ticker symbol cannot be empty."}}

    # Common ticker aliases & corporate renames
    ALIASES = {
        "ZOMATO": "ETERNAL.NS",
        "ZOMATO.NS": "ETERNAL.NS",
        "ZOMATO.BO": "ETERNAL.NS",
        "APPLE": "AAPL",
        "GOOGLE": "GOOGL",
        "MICROSOFT": "MSFT",
        "NVIDIA": "NVDA",
        "TESLA": "TSLA",
    }
    was_aliased = clean_ticker in ALIASES
    original_input = clean_ticker
    if was_aliased:
        clean_ticker = ALIASES[clean_ticker]

    if clean_ticker in TICKERS:
        msg = f"{clean_ticker} is already in the watchlist."
        if was_aliased:
            msg = f"'{original_input}' (listed as {clean_ticker}) is already in the watchlist."
        return {"success": True, "ticker": clean_ticker, "message": msg}

    # Verify and download data from Yahoo Finance
    try:
        data = yf.download(clean_ticker, period="6mo", interval="1d", progress=False)
        if data.empty:
            return {
                "error": {
                    "message": f"Ticker '{clean_ticker}' not found or has no price data on Yahoo Finance.",
                    "suggestion": "Ensure the symbol is active. For Indian stocks on NSE, append .NS (e.g. ETERNAL.NS, PAYTM.NS, BEL.NS)."
                }
            }

        close_col = None
        if isinstance(data.columns, pd.MultiIndex):
            for col in data.columns:
                if "close" in str(col).lower():
                    close_col = col
                    break
        elif "Close" in data.columns:
            close_col = "Close"

        if not close_col or close_col not in data.columns:
            return {"error": {"message": f"Could not extract closing prices for '{clean_ticker}'."}}

        close = data[close_col].dropna()
        if isinstance(close, pd.DataFrame):
            close = close.iloc[:, 0]
        close = close if isinstance(close, pd.Series) else pd.Series(close)

        if len(close) < 20:
            return {"error": {"message": f"Insufficient historical data for '{clean_ticker}' (less than 20 trading days)."}}

        # Save to SQLite database
        save_stock_prices(clean_ticker, close)

        # Calculate metrics for DATA_CACHE
        returns = close.pct_change().dropna()
        volatility = float(np.std(returns) * np.sqrt(252))
        var_99 = float(np.percentile(returns, 1))
        tail_losses = returns[returns <= var_99]
        cvar_99 = float(tail_losses.mean()) if len(tail_losses) > 0 else var_99
        sharpe = float((np.mean(returns) * 252) / (np.std(returns) * np.sqrt(252))) if np.std(returns) != 0 else 0
        downside_returns = returns[returns < 0]
        downside_deviation = np.std(downside_returns) * np.sqrt(252) if len(downside_returns) > 0 else 0
        sortino = float((np.mean(returns) * 252) / downside_deviation) if downside_deviation != 0 else 0

        consecutive_losses = 0
        max_consecutive_losses = 0
        for ret in returns:
            if ret < 0:
                consecutive_losses += 1
                max_consecutive_losses = max(max_consecutive_losses, consecutive_losses)
            else:
                consecutive_losses = 0

        annual_return = float(np.mean(returns) * 252)
        roll_max = close.expanding().max()
        daily_drawdown = (close / roll_max) - 1.0
        max_drawdown = float(daily_drawdown.min())
        calmar = float(annual_return / abs(max_drawdown)) if max_drawdown != 0 else 0

        DATA_CACHE[clean_ticker] = {
            "metrics": {
                "volatility": volatility,
                "VaR_99": var_99,
                "CVaR_99": cvar_99,
                "sharpe_ratio": sharpe,
                "max_drawdown": max_drawdown,
                "sortino_ratio": sortino,
                "max_consecutive_losses": max_consecutive_losses,
                "calmar_ratio": calmar,
            },
            "history": close.tolist(),
            "dates": [str(d.date()) for d in close.index],
        }

        # Add to global TICKERS list
        TICKERS.append(clean_ticker)

        return {
            "success": True,
            "ticker": clean_ticker,
            "message": (
                f"{clean_ticker} (formerly {original_input}) successfully added and analyzed!"
                if was_aliased else
                f"{clean_ticker} successfully added and analyzed!"
            )
        }
    except Exception as e:
        return {"error": {"message": f"Failed to add {clean_ticker}: {str(e)}"}}


@app.get("/api/metrics")
def get_metrics(ticker: str = Query(..., description="Stock ticker symbol")) -> Dict:
    if not DATA_CACHE or ticker not in DATA_CACHE:
        try:
            data = yf.download(ticker, period="1y", interval="1d")
            if data.empty:
                return {"error": {"message": "No data found for ticker.", "suggestion": "Check if the ticker symbol is correct or try again later."}}
            
            # Handle multi-index columns
            close_col = None
            if isinstance(data.columns, pd.MultiIndex):
                for col in data.columns:
                    if "close" in str(col).lower():
                        close_col = col
                        break
            else:
                close_col = 'Close'
            
            if not close_col or close_col not in data.columns:
                return {"error": {"message": f"No 'Close' column found in data. Columns: {list(data.columns)}", "suggestion": "Try a different ticker or check data source."}}
            
            close = data[close_col].dropna()
            if isinstance(close, pd.DataFrame):
                if close.shape[1] == 1:
                    close = close.iloc[:, 0]
                else:
                    close = close.squeeze()
            close = close if isinstance(close, pd.Series) else pd.Series(close)
            if len(close) < 30:
                return {"error": {"message": "Not enough data for calculations.", "suggestion": "Try a different ticker or wait for more data to accumulate."}}
            
            # Calculate returns
            returns = close.pct_change().dropna()
            
            # Calculate metrics with proper scaling
            volatility = float(np.std(returns) * np.sqrt(252))  # Annualized volatility
            var_99 = float(np.percentile(returns, 1))  # 1st percentile (99% confidence)
            tail_losses = returns[returns <= var_99]
            cvar_99 = float(tail_losses.mean()) if len(tail_losses) > 0 else var_99
            sharpe = float((np.mean(returns) * 252) / (np.std(returns) * np.sqrt(252))) if np.std(returns) != 0 else 0  # Annualized Sharpe
            
            # Additional risk metrics
            # Sortino ratio (using downside deviation)
            downside_returns = returns[returns < 0]
            downside_deviation = np.std(downside_returns) * np.sqrt(252) if len(downside_returns) > 0 else 0
            sortino = float((np.mean(returns) * 252) / downside_deviation) if downside_deviation != 0 else 0
            
            # Maximum consecutive losses
            consecutive_losses = 0
            max_consecutive_losses = 0
            for ret in returns:
                if ret < 0:
                    consecutive_losses += 1
                    max_consecutive_losses = max(max_consecutive_losses, consecutive_losses)
                else:
                    consecutive_losses = 0
            
            # Calmar ratio (annual return / max drawdown)
            annual_return = float(np.mean(returns) * 252)
            
            roll_max = close.expanding().max()
            daily_drawdown = (close / roll_max) - 1.0
            max_drawdown = float(daily_drawdown.min())
            calmar = float(annual_return / abs(max_drawdown)) if max_drawdown != 0 else 0
            
            # Store in cache for future use
            DATA_CACHE[ticker] = {
                "metrics": {
                    "volatility": volatility,
                    "VaR_99": var_99,
                    "CVaR_99": cvar_99,
                    "sharpe_ratio": sharpe,
                    "max_drawdown": max_drawdown,
                    "sortino_ratio": sortino,
                    "max_consecutive_losses": max_consecutive_losses,
                    "calmar_ratio": calmar,
                },
                "history": close.tolist(),
                "dates": [str(d.date()) for d in close.index],
            }
            
            return DATA_CACHE[ticker]["metrics"]
        except Exception as e:
            print(f"Error in /api/metrics for {ticker}: {e}")
            return {"error": {"message": str(e), "suggestion": "Try again later or contact support if the issue persists."}}
    return DATA_CACHE[ticker]["metrics"]


@app.get("/api/risk_alerts")
def risk_alerts(threshold: float = 0.05) -> Dict:
    # Only flag configured assets with volatility above threshold
    alerts = [ticker for ticker, v in DATA_CACHE.items() if ticker in TICKERS and v["metrics"]["volatility"] > threshold]
    return {"high_risk": alerts}

class PredictRequest(BaseModel):
    ticker: str
    days: int = 7


@app.post("/api/predict")
def predict_prices(req: PredictRequest):
    ticker = req.ticker
    days = min(max(req.days, 1), 30)

    # Fast path: use in-memory history if already cached
    if ticker in DATA_CACHE and "history" in DATA_CACHE[ticker] and len(DATA_CACHE[ticker]["history"]) >= 30:
        close_prices = pd.Series(DATA_CACHE[ticker]["history"], dtype=float)
        try:
            sample = close_prices.tail(60) if len(close_prices) > 60 else close_prices
            model = ARIMA(sample, order=(2, 1, 0))
            model_fit = model.fit()
            forecast = model_fit.forecast(steps=days)
            return {
                "prediction": [float(value) for value in forecast.tolist()],
                "method": "ARIMA"
            }
        except Exception:
            recent_prices = close_prices.tail(10).tolist()
            avg_change = float(np.mean(np.diff(recent_prices)))
            last_price = float(recent_prices[-1])
            return {
                "prediction": [last_price + avg_change * (i + 1) for i in range(days)],
                "method": "Moving Average"
            }

    db = SessionLocal()

    try:
        # 1. Read historical closing prices from SQLite.
        rows = (
            db.query(StockPrice)
            .filter(StockPrice.ticker == ticker)
            .order_by(StockPrice.trade_date.asc())
            .all()
        )

        # 2. Fall back to Yahoo Finance if fewer than 30 records exist.
        if len(rows) < 30:
            data = yf.download(
                ticker,
                period="6mo",
                interval="1d",
                progress=False
            )

            if not data.empty:
                if isinstance(data.columns, pd.MultiIndex):
                    close_columns = [
                        col for col in data.columns
                        if "close" in str(col).lower()
                    ]
                    close = (
                        data[close_columns[0]]
                        if close_columns else pd.Series(dtype=float)
                    )
                elif "Close" in data.columns:
                    close = data["Close"]
                else:
                    close = pd.Series(dtype=float)

                if isinstance(close, pd.DataFrame):
                    close = close.iloc[:, 0]

                close = close.dropna()

                # Persist fetched prices in SQLite.
                existing_by_date = {
                    row.trade_date: row for row in rows
                }

                for timestamp, price in close.items():
                    trade_date = pd.Timestamp(timestamp).date()
                    close_price = float(price)

                    if trade_date in existing_by_date:
                        existing_by_date[trade_date].close_price = close_price
                    else:
                        db.add(
                            StockPrice(
                                ticker=ticker,
                                trade_date=trade_date,
                                close_price=close_price
                            )
                        )

                db.commit()

                # Read the updated records from SQLite.
                rows = (
                    db.query(StockPrice)
                    .filter(StockPrice.ticker == ticker)
                    .order_by(StockPrice.trade_date.asc())
                    .all()
                )

        if len(rows) < 30:
            return {
                "error": {
                    "message": "Not enough historical data for prediction.",
                    "suggestion": "Check the ticker symbol or try again later."
                }
            }

        # 3. Use the stored prices as the prediction input.
        close_prices = pd.Series(
            [row.close_price for row in rows],
            dtype=float
        )

    except Exception as e:
        db.rollback()
        print(f"Error loading prediction data for {ticker}: {e}")
        return {"error": {"message": str(e)}}

    finally:
        db.close()

    # 4. Forecast future prices using the existing ARIMA model.
    try:
        model = ARIMA(close_prices, order=(5, 1, 0))
        model_fit = model.fit()
        forecast = model_fit.forecast(steps=days)

        return {
            "prediction": [float(value) for value in forecast.tolist()],
            "method": "ARIMA"
        }

    except Exception as arima_error:
        print(f"ARIMA failed for {ticker}: {arima_error}; using moving average")

        recent_prices = close_prices.tail(10).tolist()
        avg_change = float(np.mean(np.diff(recent_prices)))
        last_price = float(recent_prices[-1])

        predictions = [
            last_price + avg_change * (i + 1)
            for i in range(days)
        ]

        return {
            "prediction": predictions,
            "method": "Moving Average"
        }

@app.get("/api/test")
def test_yfinance(ticker: str = "AAPL"):
    try:
        import yfinance as yf
        data = yf.download(ticker, period="1mo", interval="1d")
        # Convert the DataFrame to a string for safe return
        return {
            "success": True,
            "data_head": data.head().to_string(),
            "columns": list(data.columns) if hasattr(data, 'columns') else "No columns",
            "shape": data.shape if hasattr(data, 'shape') else "No shape"
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.get("/api/portfolio")
def portfolio_analysis(tickers: str = Query(..., description="Comma-separated ticker symbols"), weights: str = Query(None, description="JSON string of weights for each ticker")):
    """Analyze a portfolio of multiple assets with optional custom weights"""
    try:
        ticker_list = [t.strip() for t in tickers.split(",")]
        if len(ticker_list) < 2:
            return {"error": {"message": "Portfolio analysis requires at least 2 assets", "suggestion": "Select at least two assets for portfolio analysis."}}
        # Parse weights if provided
        weight_dict = None
        if weights:
            try:
                weight_dict = json.loads(weights)
                # Ensure all selected tickers have a weight, and convert to float
                weight_dict = {k: float(weight_dict[k]) for k in ticker_list if k in weight_dict}
                # Normalize weights to sum to 1
                total = sum(weight_dict.values())
                if total > 0:
                    weight_dict = {k: v / total for k, v in weight_dict.items()}
                else:
                    weight_dict = None
            except Exception as e:
                print(f"Invalid weights: {e}")
                weight_dict = None
        # Fetch data for all tickers
        portfolio_data = {}
        for ticker in ticker_list:
            try:
                data = yf.download(ticker, period="1y", interval="1d")
                if not data.empty and 'Close' in data.columns:
                    close_prices = data['Close'].dropna()
                    if isinstance(close_prices, pd.DataFrame):
                        if close_prices.shape[1] == 1:
                            close_prices = close_prices.iloc[:, 0]
                        else:
                            close_prices = close_prices.squeeze()
                    close_prices = close_prices if isinstance(close_prices, pd.Series) else pd.Series(close_prices)
                    if len(close_prices) >= 30:
                        portfolio_data[ticker] = close_prices
            except Exception as e:
                print(f"Error fetching data for {ticker} in /api/portfolio: {e}")
                continue
        if len(portfolio_data) < 2:
            return {"error": {"message": "Not enough valid data for portfolio analysis", "suggestion": "Try different assets or check data availability."}}
        min_length = min(len(data) for data in portfolio_data.values())
        if min_length < 30:
            return {"error": {"message": "Not enough overlapping data for analysis", "suggestion": "Try assets with more historical data."}}
        try:
            aligned_series = []
            for ticker, data in portfolio_data.items():
                recent_data = data.tail(min_length).reset_index(drop=True)
                recent_data.name = ticker
                aligned_series.append(recent_data)
            df = pd.concat(aligned_series, axis=1)
        except Exception as df_error:
            print(f"DataFrame creation error in /api/portfolio: {df_error}")
            return {"error": {"message": f"Failed to align data: {str(df_error)}", "suggestion": "Try again later or contact support if the issue persists."}}
        returns = df.pct_change().dropna()
        if len(returns) < 20:
            return {"error": {"message": "Not enough return data for analysis", "suggestion": "Try assets with more historical data."}}
        # Portfolio returns (custom weights or equal weight)
        if weight_dict and len(weight_dict) == len(ticker_list):
            weights_arr = [weight_dict.get(t, 0) for t in ticker_list]
            returns_matrix = returns[ticker_list].values
            portfolio_returns = (returns_matrix * weights_arr).sum(axis=1)
        else:
            portfolio_returns = returns.mean(axis=1)
        portfolio_volatility = float(np.std(portfolio_returns) * np.sqrt(252))
        portfolio_sharpe = float((np.mean(portfolio_returns) * 252) / (np.std(portfolio_returns) * np.sqrt(252))) if np.std(portfolio_returns) != 0 else 0
        portfolio_var = float(np.percentile(portfolio_returns, 1))
        annual_return = float(np.mean(portfolio_returns) * 252)
        try:
            corr_matrix = returns.corr()
            correlation_dict = {}
            for col in corr_matrix.columns:
                correlation_dict[col] = {}
                for idx in corr_matrix.index:
                    val = corr_matrix.loc[idx, col]
                    correlation_dict[col][idx] = float(val) if not pd.isna(val) else 0.0
        except Exception as corr_error:
            print(f"Correlation calculation error in /api/portfolio: {corr_error}")
            correlation_dict = {}
            for ticker in portfolio_data.keys():
                correlation_dict[ticker] = {t: 1.0 if t == ticker else 0.0 for t in portfolio_data.keys()}
        return {
            "portfolio_metrics": {
                "volatility": portfolio_volatility,
                "sharpe_ratio": portfolio_sharpe,
                "var_99": portfolio_var,
                "annual_return": annual_return
            },
            "correlation_matrix": correlation_dict,
            "assets": list(portfolio_data.keys()),
            "data_points": len(df),
            "weights": weight_dict if weight_dict else None
        }
    except Exception as e:
        print(f"Portfolio analysis error in /api/portfolio: {e}")
        return {"error": {"message": f"Portfolio analysis failed: {str(e)}", "suggestion": "Try again later or contact support if the issue persists."}}

@app.get("/api/sentiment/{ticker}")
def market_sentiment(ticker: str):
    """Get market sentiment and technical indicators"""
    try:
        data = yf.download(ticker, period="6mo", interval="1d")
        if data.empty:
            return {"error": {"message": "No data found for ticker", "suggestion": "Check if the ticker symbol is correct or try again later."}}
        
        if 'Close' not in data.columns:
            return {"error": {"message": "Close price data not available", "suggestion": "Try a different ticker or check data source."}}
        
        close = data['Close'].dropna()
        if isinstance(close, pd.DataFrame):
            if close.shape[1] == 1:
                close = close.iloc[:, 0]
            else:
                close = close.squeeze()
        close = close if isinstance(close, pd.Series) else pd.Series(close)
        if len(close) < 50:  # Need at least 50 days for reliable indicators
            return {"error": {"message": "Not enough data for sentiment analysis", "suggestion": "Try a different ticker or wait for more data to accumulate."}}
        
        # Get current price
        current_price = float(close.iloc[-1])
        
        # Calculate moving averages
        ma_20 = float(close.rolling(window=20).mean().iloc[-1])
        ma_50 = float(close.rolling(window=50).mean().iloc[-1])
        
        # Handle NaN values in moving averages
        if pd.isna(ma_20):
            ma_20 = current_price
        if pd.isna(ma_50):
            ma_50 = current_price
        
        # Calculate RSI
        delta = close.diff()
        gain = delta.where(delta > 0, 0)
        loss = -delta.where(delta < 0, 0)
        
        avg_gain = gain.rolling(window=14).mean()
        avg_loss = loss.rolling(window=14).mean()
        
        # Avoid division by zero
        rs = avg_gain / avg_loss.replace(0, np.nan)
        rsi_series = 100 - (100 / (1 + rs))
        rsi = float(rsi_series.iloc[-1])
        
        # Handle NaN RSI
        if pd.isna(rsi):
            rsi = 50.0
        
        # Calculate momentum
        if len(close) >= 6:
            momentum_5d = float((current_price / close.iloc[-6]) - 1)
        else:
            momentum_5d = 0.0
            
        if len(close) >= 21:
            momentum_20d = float((current_price / close.iloc[-21]) - 1)
        else:
            momentum_20d = 0.0
        
        # Volatility trend
        recent_vol = float(close.pct_change().tail(20).std())
        historical_vol = float(close.pct_change().std())
        vol_trend = "increasing" if recent_vol > historical_vol else "decreasing"
        
        # Generate signals
        signals = []
        
        # Trend signals
        if current_price > ma_20 and ma_20 > ma_50:
            signals.append("bullish_trend")
        elif current_price < ma_20 and ma_20 < ma_50:
            signals.append("bearish_trend")
        
        # RSI signals
        if rsi > 70:
            signals.append("overbought")
        elif rsi < 30:
            signals.append("oversold")
        
        # Momentum signals
        if momentum_5d > 0.05:
            signals.append("strong_momentum")
        elif momentum_5d < -0.05:
            signals.append("weak_momentum")
        
        # Calculate sentiment score
        bullish_signals = len([s for s in signals if "bullish" in s or "strong" in s])
        bearish_signals = len([s for s in signals if "bearish" in s or "weak" in s])
        sentiment_score = bullish_signals - bearish_signals
        
        return {
            "current_price": current_price,
            "moving_averages": {
                "ma_20": ma_20,
                "ma_50": ma_50
            },
            "technical_indicators": {
                "rsi": rsi,
                "momentum_5d": momentum_5d,
                "momentum_20d": momentum_20d
            },
            "volatility_trend": vol_trend,
            "signals": signals,
            "sentiment_score": sentiment_score
        }
    except Exception as e:
        print(f"Error in /api/sentiment for {ticker}: {e}")
        return {"error": {"message": f"Sentiment analysis failed: {str(e)}", "suggestion": "Try again later or contact support if the issue persists."}}

@app.get("/api/health")
def health_check():
    """Comprehensive health check and system status"""
    try:
        # Test data fetching
        test_data = yf.download("AAPL", period="1d", interval="1d")
        data_fetch_ok = not test_data.empty
        
        # Cache status
        cache_status = {
            "cached_tickers": list(DATA_CACHE.keys()),
            "cache_size": len(DATA_CACHE),
            "last_update": "scheduled" if scheduler.running else "manual"
        }
        
        # System info
        system_info = {
            "cpu_percent": psutil.cpu_percent(),
            "memory_percent": psutil.virtual_memory().percent,
            "python_version": "3.x"  # You can make this more specific
        }
        
        return {
            "status": "healthy" if data_fetch_ok else "degraded",
            "timestamp": pd.Timestamp.now().isoformat(),
            "data_fetch": "ok" if data_fetch_ok else "failed",
            "cache_status": cache_status,
            "system_info": system_info,
            "endpoints": [
                "/api/assets",
                "/api/metrics",
                "/api/history", 
                "/api/predict",
                "/api/portfolio",
                "/api/sentiment",
                "/api/risk_alerts"
            ]
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "error": str(e),
            "timestamp": pd.Timestamp.now().isoformat()
        }

@app.get("/api/portfolio_test")
def portfolio_test(tickers: str = Query(..., description="Comma-separated ticker symbols")):
    """Test endpoint for portfolio analysis debugging"""
    try:
        ticker_list = [t.strip() for t in tickers.split(",")]
        
        # Test data fetching
        test_results = {}
        for ticker in ticker_list:
            try:
                data = yf.download(ticker, period="1y", interval="1d")
                if not data.empty and 'Close' in data.columns:
                    close_prices = data['Close'].dropna()
                    if isinstance(close_prices, pd.DataFrame):
                        if close_prices.shape[1] == 1:
                            close_prices = close_prices.iloc[:, 0]
                        else:
                            close_prices = close_prices.squeeze()
                    close_prices = close_prices if isinstance(close_prices, pd.Series) else pd.Series(close_prices)
                    test_results[ticker] = {
                        "success": True,
                        "data_points": len(close_prices),
                        "last_price": float(close_prices.iloc[-1]),
                        "first_price": float(close_prices.iloc[0])
                    }
                else:
                    test_results[ticker] = {"success": False, "error": "No data or missing Close column"}
            except Exception as e:
                test_results[ticker] = {"success": False, "error": str(e)}
        
        return {
            "test_results": test_results,
            "total_tickers": len(ticker_list),
            "successful_fetches": len([r for r in test_results.values() if r.get("success", False)])
        }
    except Exception as e:
        return {"error": f"Test failed: {str(e)}"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000) 
