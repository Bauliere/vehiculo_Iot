from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / ".env", env_file_encoding="utf-8", extra="ignore"
    )
    db_host: str = ""
    db_port: int = Field(default=3306, ge=1, le=65535)
    db_name: str = "vehiculo_iot"
    db_user: str = ""
    db_password: SecretStr = SecretStr("")
    db_ssl_ca: str = ""
    db_timeout_seconds: int = Field(default=5, ge=1, le=30)
    api_control_key: SecretStr = SecretStr("")
    api_admin_key: SecretStr = SecretStr("")

    def validate_database(self):
        from app.errors import ApiError

        if not all((self.db_host, self.db_name, self.db_user, self.db_password.get_secret_value())):
            raise ApiError(503, "Completa la configuración local de RDS en .env.")
        if not self.db_ssl_ca or not Path(self.db_ssl_ca).is_file():
            raise ApiError(503, "Configura DB_SSL_CA con el archivo CA de Amazon RDS.")
