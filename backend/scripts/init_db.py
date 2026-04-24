import os
from pathlib import Path

import psycopg2


def main() -> None:
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise SystemExit("DATABASE_URL is required (hosted Postgres connection string).")

    schema_path = Path(__file__).resolve().parents[1] / "core" / "schema.sql"
    schema_sql = schema_path.read_text(encoding="utf-8")

    conn = psycopg2.connect(db_url)
    try:
        with conn.cursor() as cur:
            cur.execute(schema_sql)
        conn.commit()
        print(f"Applied schema: {schema_path}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()

