"""
Donor Lapse Detection Cron Job
Runs: Daily at 7:00 AM IST
Action: Scans donors table → finds anyone silent >90 days → emits donor.lapse.detected event → triggers Donor Nurture Agent
"""
from datetime import date
from typing import List, Dict

# Simulate DB donor records (in production: SELECT FROM donors WHERE last_gift < NOW() - INTERVAL '90 days')
MOCK_DONORS = [
    {"id": "D-001", "name": "Priya Sharma", "email": "priya@email.com", "last_gift_date": "2025-08-10", "total_given": 15000, "type": "Lapsing"},
    {"id": "D-002", "name": "Vikram Singh", "email": "vikram@email.com", "last_gift_date": "2026-02-28", "total_given": 5000, "type": "Active"},
    {"id": "D-003", "name": "Neha Gupta", "email": "neha@email.com", "last_gift_date": "2025-05-01", "total_given": 45000, "type": "Lapsing"},
]

LAPSE_THRESHOLD_DAYS = 90

def detect_lapsed_donors(donors: List[Dict]) -> List[Dict]:
    """Identify donors who have gone silent beyond the threshold."""
    today = date.today()
    lapsed = []
    
    for donor in donors:
        last_gift = date.fromisoformat(donor["last_gift_date"])
        days_since = (today - last_gift).days
        
        if days_since > LAPSE_THRESHOLD_DAYS:
            lapsed.append({
                **donor,
                "days_since_last_gift": days_since,
                "lapse_severity": "critical" if days_since > 180 else "warning"
            })
    
    return lapsed

def emit_lapse_events(lapsed_donors: List[Dict]) -> None:
    """Emit events to Redis Streams for Donor Nurture Agent to process."""
    for donor in lapsed_donors:
        # In production: redis_client.xadd("donor_events", {...})
        print(f"  📢 Emitting event: donor.lapse.detected for {donor['name']} ({donor['days_since_last_gift']} days)")

def run_lapse_detection():
    """Main cron job entry point."""
    print(f"\n=== Donor Lapse Detection Cron — {date.today()} ===")
    print(f"Scanning {len(MOCK_DONORS)} donors with threshold: {LAPSE_THRESHOLD_DAYS} days\n")
    
    lapsed = detect_lapsed_donors(MOCK_DONORS)
    
    if not lapsed:
        print("✅ No lapsed donors found. All donors are active.")
        return
    
    print(f"⚠️  Found {len(lapsed)} lapsed donor(s):")
    for d in lapsed:
        severity_icon = "🔴" if d["lapse_severity"] == "critical" else "🟡"
        print(f"  {severity_icon} {d['name']} — {d['days_since_last_gift']} days since last gift (₹{d['total_given']:,} lifetime)")
    
    print(f"\nEmitting {len(lapsed)} donor.lapse.detected events to Redis Streams...")
    emit_lapse_events(lapsed)
    
    print("\n✅ Lapse detection complete. Donor Nurture Agent will process these events and draft re-engagement messages.")
    print("   High-value donors (>₹1L) will be queued in Agent HQ HITL queue before outreach is sent.")

if __name__ == "__main__":
    run_lapse_detection()
