"""Write the OpenAPI document to a file (default: backend/openapi.json).

Uses inert placeholder settings: the schema does not depend on real configuration and
no connection is made (clients are lazy).
"""

import json
import sys
from pathlib import Path

from pydantic import SecretStr

from app.core.config import Settings
from app.main import create_app

DEFAULT_OUTPUT = Path(__file__).resolve().parents[2] / "openapi.json"


def build_schema() -> str:
    settings = Settings(
        environment="dev",
        database_url=SecretStr("postgresql+asyncpg://openapi:unused@localhost:1/openapi"),
        redis_url=SecretStr("redis://localhost:1/0"),
        app_secret_key=SecretStr("openapi-export-placeholder-key-not-used-0000"),
        breach_check_mode="local_only",
        password_hash_time_cost=1,
        password_hash_memory_kib=1024,
        password_hash_parallelism=1,
    )
    app = create_app(settings, configure_logs=False)
    return json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n"


def main() -> None:
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUTPUT
    output.write_text(build_schema(), encoding="utf-8")


if __name__ == "__main__":
    main()
