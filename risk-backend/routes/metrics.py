from fastapi import APIRouter, Query
import yfinance as yf
import numpy as np
import pandas as pd
from utils.cache import DATA_CACHE
from database import SessionLocal
from models.stock_price import StockPrice




router = APIRouter()


@router.get("/api/metrics")
def get_metrics(ticker: str = Query(..., description="Stock ticker symbol")):
    # Fast path: Serve from memory cache if available
    if ticker in DATA_CACHE and "metrics" in DATA_CACHE[ticker]:
        return DATA_CACHE[ticker]["metrics"]

    db = SessionLocal()

    try:
        # Step 1: Read the ticker's stored closing prices from SQLite.
        rows = (
            db.query(StockPrice)
            .filter(StockPrice.ticker == ticker)
            .order_by(StockPrice.trade_date.asc())
            .all()
        )

        # Step 2: If there is insufficient data, fetch from Yahoo Finance.
        if len(rows) < 30:
            data = yf.download(
                ticker,
                period="1y",
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

                # Save fetched prices to SQLite, inserting or updating dates.
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

                # Re-read prices from SQLite after saving.
                rows = (
                    db.query(StockPrice)
                    .filter(StockPrice.ticker == ticker)
                    .order_by(StockPrice.trade_date.asc())
                    .all()
                )

        # Step 3: Validate the data.
        if len(rows) < 30:
            return {
                "error": {
                    "message": "Not enough historical data for calculations.",
                    "suggestion": "Check the ticker symbol or try again later."
                }
            }

        close = pd.Series(
            [row.close_price for row in rows],
            index=pd.to_datetime([row.trade_date for row in rows]),
            dtype=float
        )

        # Step 4: Calculate risk metrics from the SQLite prices.
        returns = close.pct_change().dropna()

        daily_std = float(np.std(returns))
        volatility = daily_std * np.sqrt(252)
        var_99 = float(np.percentile(returns, 1))
        tail_losses = returns[returns <= var_99]
        cvar_99 = float(tail_losses.mean()) if len(tail_losses) > 0 else var_99

        sharpe = (
            float((np.mean(returns) * 252) / (daily_std * np.sqrt(252)))
            if daily_std != 0 else 0.0
        )

        downside_returns = returns[returns < 0]
        downside_deviation = (
            float(np.std(downside_returns) * np.sqrt(252))
            if len(downside_returns) > 0 else 0.0
        )

        sortino = (
            float((np.mean(returns) * 252) / downside_deviation)
            if downside_deviation != 0 else 0.0
        )

        consecutive_losses = 0
        max_consecutive_losses = 0

        for ret in returns:
            if ret < 0:
                consecutive_losses += 1
                max_consecutive_losses = max(
                    max_consecutive_losses,
                    consecutive_losses
                )
            else:
                consecutive_losses = 0

        annual_return = float(np.mean(returns) * 252)
        roll_max = close.expanding().max()
        daily_drawdown = (close / roll_max) - 1.0
        max_drawdown = float(daily_drawdown.min())

        calmar = (
            float(annual_return / abs(max_drawdown))
            if max_drawdown != 0 else 0.0
        )

        # Step 5: Preserve the existing API response structure.
        result = {
            "volatility": float(volatility),
            "VaR_99": float(var_99),
            "CVaR_99": float(cvar_99),
            "sharpe_ratio": float(sharpe),
            "max_drawdown": float(max_drawdown),
            "sortino_ratio": float(sortino),
            "max_consecutive_losses": int(max_consecutive_losses),
            "calmar_ratio": float(calmar)
        }

        # Keep the in-memory cache consistent with the database data.
        DATA_CACHE[ticker] = {
            "metrics": result,
            "history": close.tolist(),
            "dates": [timestamp.strftime("%Y-%m-%d") for timestamp in close.index]
        }

        return result

    except Exception as e:
        db.rollback()
        print(f"Error in /api/metrics for {ticker}: {e}")
        return {
            "error": {
                "message": str(e),
                "suggestion": "Try again later or check the ticker symbol."
            }
        }

    finally:
        db.close()



@router.get("/api/history")
def get_history(
    ticker: str = Query(..., description="Stock ticker symbol"),
    timeframe: str = Query("1Y")
):
    timeframe = timeframe.upper()

    period_map = {
        "1D": "1d",
        "5D": "5d",
        "1M": "1mo",
        "3M": "3mo",
        "6M": "6mo",
        "1Y": "1y",
        "2Y": "2y",
        "5Y": "5y",
        "MAX": "max",
    }

    if timeframe not in period_map:
        timeframe = "1Y"

    period = period_map[timeframe]
    interval = "15m" if timeframe in ["1D", "5D"] else "1d"

    # Fast path: Serve default 6M from memory cache if available
    if timeframe == "6M" and ticker in DATA_CACHE and "history" in DATA_CACHE[ticker]:
        return {
            "history": DATA_CACHE[ticker]["history"],
            "dates": DATA_CACHE[ticker]["dates"]
        }

    # Intraday prices are not stored in the daily-price table.
    if interval != "1d":
        try:
            data = yf.download(
                ticker, period=period, interval=interval, progress=False
            )
            if data.empty:
                return {"error": {"message": "No data found for ticker."}}

            close = data["Close"]
            if isinstance(close, pd.DataFrame):
                close = close.iloc[:, 0]
            close = close.dropna()

            return {
                "history": [float(v) for v in close.tolist()],
                "dates": [str(pd.Timestamp(d)) for d in close.index],
            }
        except Exception as e:
            return {"error": {"message": str(e)}}

    db = SessionLocal()

    try:
        # Step 1: Read existing daily prices from SQLite.
        rows = (
            db.query(StockPrice)
            .filter(StockPrice.ticker == ticker)
            .order_by(StockPrice.trade_date.asc())
            .all()
        )

        # Determine the expected historical coverage.
        today = pd.Timestamp.now().normalize()
        offsets = {
            "1M": pd.DateOffset(months=1),
            "3M": pd.DateOffset(months=3),
            "6M": pd.DateOffset(months=6),
            "1Y": pd.DateOffset(years=1),
            "2Y": pd.DateOffset(years=2),
            "5Y": pd.DateOffset(years=5),
        }

        needs_fetch = not rows

        if timeframe == "MAX":
            # Existing records may cover only a small part of all history.
            needs_fetch = True
        elif rows:
            earliest = pd.Timestamp(rows[0].trade_date)
            latest = pd.Timestamp(rows[-1].trade_date)
            expected_start = today - offsets[timeframe]

            # Allow a small margin for weekends and market holidays.
            coverage_ok = earliest <= expected_start + pd.Timedelta(days=10)
            recent_ok = latest >= today - pd.Timedelta(days=7)

            needs_fetch = not (coverage_ok and recent_ok)

        # Step 2: Fetch from Yahoo Finance only if necessary.
        if needs_fetch:
            data = yf.download(
                ticker, period=period, interval="1d", progress=False
            )

            if data.empty:
                if not rows:
                    return {"error": {"message": "No data found for ticker."}}
                # Fall back to existing records if Yahoo Finance is unavailable.
            else:
                close = data["Close"]

                if isinstance(close, pd.DataFrame):
                    close = close.iloc[:, 0]

                close = close.dropna()

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
                                close_price=close_price,
                            )
                        )

                db.commit()

                # Re-read the database after saving.
                rows = (
                    db.query(StockPrice)
                    .filter(StockPrice.ticker == ticker)
                    .order_by(StockPrice.trade_date.asc())
                    .all()
                )

        # Step 3: Apply the requested timeframe to stored daily prices.
        if timeframe != "MAX":
            cutoff = today - offsets[timeframe]
            rows = [
                row for row in rows
                if pd.Timestamp(row.trade_date) >= cutoff
            ]

        return {
            "history": [float(row.close_price) for row in rows],
            "dates": [str(row.trade_date) for row in rows],
        }

    except Exception as e:
        db.rollback()
        print(f"Error in /api/history for {ticker}: {e}")
        return {"error": {"message": str(e)}}

    finally:
        db.close()
