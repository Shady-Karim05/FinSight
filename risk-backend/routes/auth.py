from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from database import get_db
from models.user import User
from models.watchlist import UserWatchlist
from utils.auth import create_access_token, get_current_user, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])

DEFAULT_STARTER_STOCKS = ["RELIANCE.NS", "TCS.NS", "INFY.NS", "HDFCBANK.NS"]


class RegisterRequest(BaseModel):
    email: str
    username: str
    password: str


class LoginRequest(BaseModel):
    username_or_email: str
    password: str


class UserProfileResponse(BaseModel):
    id: int
    email: str
    username: str
    created_at: datetime
    watchlist_count: int


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserProfileResponse


@router.post("/register", response_model=AuthResponse)
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    email_clean = req.email.strip().lower()
    username_clean = req.username.strip()

    if not email_clean or "@" not in email_clean:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A valid email address is required."
        )

    if len(username_clean) < 3:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username must be at least 3 characters long."
        )

    if len(req.password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 6 characters long."
        )

    # Check if user already exists
    existing_email = db.query(User).filter(User.email == email_clean).first()
    if existing_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An account with this email already exists."
        )

    existing_username = db.query(User).filter(User.username.ilike(username_clean)).first()
    if existing_username:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This username is already taken. Please choose another."
        )

    # Create new user
    new_user = User(
        email=email_clean,
        username=username_clean,
        hashed_password=hash_password(req.password)
    )
    db.add(new_user)
    db.flush()  # Populates new_user.id

    # Automatically seed starter stocks for the user's personal watchlist
    for ticker in DEFAULT_STARTER_STOCKS:
        db.add(UserWatchlist(user_id=new_user.id, ticker=ticker))

    db.commit()
    db.refresh(new_user)

    # Generate token
    token = create_access_token(data={"sub": str(new_user.id), "username": new_user.username})

    return AuthResponse(
        access_token=token,
        user=UserProfileResponse(
            id=new_user.id,
            email=new_user.email,
            username=new_user.username,
            created_at=new_user.created_at,
            watchlist_count=len(DEFAULT_STARTER_STOCKS)
        )
    )


@router.post("/login", response_model=AuthResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)):
    identifier = req.username_or_email.strip().lower()

    # Allow login by either email or username
    user = (
        db.query(User)
        .filter((User.email == identifier) | (User.username.ilike(identifier)))
        .first()
    )

    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email/username or password."
        )

    token = create_access_token(data={"sub": str(user.id), "username": user.username})
    count = db.query(UserWatchlist).filter(UserWatchlist.user_id == user.id).count()

    return AuthResponse(
        access_token=token,
        user=UserProfileResponse(
            id=user.id,
            email=user.email,
            username=user.username,
            created_at=user.created_at,
            watchlist_count=count
        )
    )


@router.get("/me", response_model=UserProfileResponse)
def get_me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    count = db.query(UserWatchlist).filter(UserWatchlist.user_id == user.id).count()
    return UserProfileResponse(
        id=user.id,
        email=user.email,
        username=user.username,
        created_at=user.created_at,
        watchlist_count=count
    )
