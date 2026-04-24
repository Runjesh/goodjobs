import os

import psycopg2


SEED = [
    ("Tata Trusts", "Philanthropy", "Mumbai", 0.0, 0.0, ["Education", "Health", "Livelihoods"]),
    ("HDFC Bank", "BFSI", "Mumbai", 125000.0, 2500.0, ["Financial inclusion", "Education", "Health"]),
    ("Infosys", "IT", "Bengaluru", 150000.0, 3000.0, ["STEM", "Digital literacy", "Education"]),
    ("Reliance Industries", "Conglomerate", "Mumbai", 800000.0, 16000.0, ["Disaster relief", "Health", "Education"]),
]


def main() -> None:
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise SystemExit("DATABASE_URL is required.")

    ngo_id = os.getenv("SEVASUITE_NGO_ID", "ngo_001")

    conn = psycopg2.connect(db_url)
    try:
        with conn.cursor() as cur:
            for (name, sector, city, rev, csr, focus_areas) in SEED:
                cur.execute(
                    """
                    INSERT INTO csr_prospect_companies
                      (ngo_id, company_name, sector, hq_city, annual_revenue_cr, csr_obligation_cr, focus_areas)
                    VALUES
                      (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (ngo_id, company_name, hq_city) DO NOTHING
                    """,
                    (ngo_id, name, sector, city, rev, csr, focus_areas),
                )
        conn.commit()
        print(f"Seeded csr_prospect_companies for ngo_id={ngo_id} ({len(SEED)} rows).")
    finally:
        conn.close()


if __name__ == "__main__":
    main()

