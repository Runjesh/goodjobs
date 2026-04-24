"""
Failed Payment Recovery Job
Runs: Every 1 hour
Action: Scans failed transactions → emits payment.failed.recovery event → triggers Recovery Agent
"""
from datetime import datetime, timedelta
from typing import List, Dict
import json

MOCK_FAILED_TRANSACTIONS = [
    {"id": "TRX-FAILED-001", "donor_id": "D-002", "donor_name": "Rohan Gupta", "amount": 2500, "reason": "Insufficient Funds", "timestamp": "2026-04-23T10:00:00"},
    {"id": "TRX-FAILED-002", "donor_id": "D-005", "donor_name": "Vikram Singh", "amount": 5000, "reason": "Network Error", "timestamp": "2026-04-23T12:00:00"},
]

def run_payment_recovery():
    print(f"\n=== Payment Recovery Job — {datetime.now()} ===")
    print(f"Scanning {len(MOCK_FAILED_TRANSACTIONS)} failed transactions in last 24h\n")
    
    for tx in MOCK_FAILED_TRANSACTIONS:
        # In production: check if we already sent a nudge in last 24h
        print(f"  🚨 Detected failed payment: {tx['donor_name']} (₹{tx['amount']}) - Reason: {tx['reason']}")
        
        # Trigger Recovery Agent Logic
        nudge_text = f"Namaste {tx['donor_name']}! 🙏 We noticed your donation of ₹{tx['amount']} didn't go through due to a technical error. Your support is vital for our Programs. You can try again here: sevasuite.in/retry/{tx['id']}"
        
        print(f"  📲 [AUTO-RECOVERY] Sending WhatsApp nudge to {tx['donor_name']}")
        print(f"  💬 Message: {nudge_text}")
        
    print(f"\n✅ Payment recovery cycle complete. {len(MOCK_FAILED_TRANSACTIONS)} nudges sent.")

if __name__ == "__main__":
    run_payment_recovery()
