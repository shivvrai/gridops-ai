"""Application configuration loaded from environment variables."""
from pydantic import ConfigDict
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    model_config = ConfigDict(env_file=".env", env_file_encoding="utf-8")

    # Database
    database_url: str = "sqlite+aiosqlite:///./faultloc.db"
    database_url_sync: str = "sqlite:///./faultloc.db"

    # Server
    app_host: str = "0.0.0.0"
    app_port: int = 8000

    # Localization tuning
    confirmation_window_seconds: int = 60
    corroboration_threshold: int = 3
    corroboration_window_seconds: int = 30
    sweep_interval_seconds: int = 10
    grace_period_minutes: int = 30

    # AI feature
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"


settings = Settings()
