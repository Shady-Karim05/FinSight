from datetime import datetime
from typing import List

import pandas as pd
import yfinance as yf
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models.stock_price import StockPrice
from models.user import User
from models.watchlist import UserWatchlist
from utils.auth import get_current_user
from utils.cache import DATA_CACHE

router = APIRouter(prefix="/api/user/watchlist", tags=["watchlist"])


class WatchlistAddRequest(BaseModel):
    ticker: str


class WatchlistResponse(BaseModel):
    tickers: List[str]
    count: int


@router.get("", response_model=WatchlistResponse)
def get_user_watchlist(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Fetch all tickers belonging to the currently authenticated user."""
    items = (
        db.query(UserWatchlist)
        .filter(UserWatchlist.user_id == user.id)
        .order_by(UserWatchlist.added_at.desc())
        .all()
    )
    tickers = [item.ticker for item in items]
    return WatchlistResponse(tickers=tickers, count=len(tickers))


@router.post("")
def add_to_user_watchlist(
    req: WatchlistAddRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Add a stock ticker specifically to the current user's personal watchlist."""
    clean_ticker = req.ticker.strip().upper()
    if not clean_ticker:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Stock ticker cannot be empty."
        )

    # Alias mapping for company names / ticker renames
    ALIASES = {
        "ZOMATO": "ETERNAL.NS",
        "ZOMATO.NS": "ETERNAL.NS",
        "APPLE": "AAPL",
        "GOOGLE": "GOOGL",
        "MICROSOFT": "MSFT",
        "NVIDIA": "NVDA",
        "TESLA": "TSLA",
    }
    if clean_ticker in ALIASES:
        clean_ticker = ALIASES[clean_ticker]

    # Check if this user already has this stock
    existing = (
        db.query(UserWatchlist)
        .filter(UserWatchlist.user_id == user.id, UserWatchlist.ticker == clean_ticker)
        .first()
    )
    if existing:
        return {
            "success": True,
            "ticker": clean_ticker,
            "message": f"{clean_ticker} is already in your personal watchlist.",
            "already_present": True
        }

    # Verify that the stock exists on Yahoo Finance if we have no prior data
    has_cached = (
        clean_ticker in DATA_CACHE or
        db.query(StockPrice).filter(StockPrice.ticker == clean_ticker).first() is not None
    )

    if not has_cached:
        try:
            data = yf.download(clean_ticker, period="6mo", interval="1d", progress=False)
            if data.empty or len(data) < 5:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Could not find market data for '{clean_ticker}'. Please verify the symbol."
                )

            # Store prices in database
            close_col = 'Close'
            if isinstance(data.columns, pd.MultiIndex):
                for col in data.columns:
                    if "close" in str(col).lower():
                        close_col = col
                        break
            if close_col in data.columns:
                close = data[close_col].dropna()
                if isinstance(close, pd.DataFrame):
                    close = close.iloc[:, 0]
                for timestamp, price in close.items():
                    trade_date = pd.Timestamp(timestamp).date()
                    db.add(StockPrice(ticker=clean_ticker, trade_date=trade_date, close_price=float(price)))
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Error validating ticker '{clean_ticker}': {str(e)}"
            )

    # Insert into user's personal watchlist
    entry = UserWatchlist(user_id=user.id, ticker=clean_ticker)
    db.add(entry)
    db.commit()

    return {
        "success": True,
        "ticker": clean_ticker,
        "message": f"Added {clean_ticker} to your personal watchlist.",
        "already_present": False
    }


@router.delete("/{ticker}")
def remove_from_user_watchlist(
    ticker: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Remove a stock ticker from the current user's personal watchlist."""
    clean_ticker = ticker.strip().upper()
    entry = (
        db.query(UserWatchlist)
        .filter(UserWatchlist.user_id == user.id, UserWatchlist.ticker == clean_ticker)
        .first()
    )

    if not entry:
        return {
            "success": False,
            "ticker": clean_ticker,
            "message": f"{clean_ticker} was not found in your watchlist."
        }

    db.delete(entry)
    db.commit()

    return {
        "success": True,
        "ticker": clean_ticker,
        "message": f"Removed {clean_ticker} from your personal watchlist."
    }
