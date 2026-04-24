import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression
from datetime import datetime, timedelta
from typing import List, Dict, Any

def predict_revenue(transactions: List[Dict[str, Any]], days_ahead: int = 90) -> List[Dict[str, Any]]:
    """
    ML model (linear regression) to project next N-day fundraising.
    """
    if not transactions:
        return []

    df = pd.DataFrame(transactions)
    df['date'] = pd.to_datetime(df['date'])
    daily_raised = df.groupby('date')['amount'].sum().reset_index()
    
    # Prepare X (ordinal days) and y (cumulative or daily amount)
    daily_raised['day_index'] = (daily_raised['date'] - daily_raised['date'].min()).dt.days
    X = daily_raised[['day_index']].values
    y = daily_raised['amount'].values
    
    model = LinearRegression()
    model.fit(X, y)
    
    # Predict future
    last_day = daily_raised['day_index'].max()
    future_X = np.arange(last_day + 1, last_day + 1 + days_ahead).reshape(-1, 1)
    future_y = model.predict(future_X)
    
    predictions = []
    start_date = daily_raised['date'].max()
    for i, pred in enumerate(future_y):
        pred_date = start_date + timedelta(days=i+1)
        predictions.append({
            "date": pred_date.strftime("%Y-%m-%d"),
            "amount": float(max(0, pred)),
            "is_estimate": True
        })
        
    return predictions

def detect_anomalies(data: List[float], threshold_z: float = 2.0) -> List[int]:
    """
    Z-score based anomaly detection.
    """
    if len(data) < 2:
        return []
    
    mean = np.mean(data)
    std = np.std(data)
    if std == 0:
        return []
        
    anomalies = []
    for i, val in enumerate(data):
        z_score = abs(val - mean) / std
        if z_score > threshold_z:
            anomalies.append(i)
            
    return anomalies

def calculate_propensity_score(donor_history: Dict[str, Any]) -> int:
    """
    Calculates probability (0-100) of donation in the next 30 days.
    Uses Recency, Frequency, and Monetary (RFM) logic.
    """
    # Placeholder logic - in real life this would be a trained logistic regression model
    last_gift_days = donor_history.get('days_since_last_gift', 365)
    total_gifts = donor_history.get('total_gifts_count', 0)
    avg_amount = donor_history.get('average_gift_amount', 0)
    
    # Simple weighted score
    recency_score = max(0, 40 - (last_gift_days / 10)) # High if recent
    frequency_score = min(30, total_gifts * 5)         # High if frequent
    monetary_score = min(30, avg_amount / 1000)      # High if generous
    
    total = int(recency_score + frequency_score + monetary_score)
    return min(100, max(0, total))

def suggest_campaign_goal(cause: str, historical_performance: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Suggests a fundraising goal based on similar past campaigns.
    """
    if not historical_performance:
        return {"suggested_goal": 500000, "confidence": "low"}
        
    matching = [p for p in historical_performance if p.get('cause') == cause]
    if not matching:
        matching = historical_performance
        
    avg_raised = np.mean([m['raised'] for m in matching])
    suggested = int(avg_raised * 1.2) # Suggest 20% growth
    
    return {
        "suggested_goal": suggested,
        "confidence": "high" if len(matching) > 2 else "medium",
        "rationale": f"Based on average of ₹{avg_raised:,.0f} raised in {len(matching)} similar {cause} campaigns."
    }

def classify_fcra_transaction(description: str) -> Dict[str, Any]:
    """
    AI Auto-classification of transactions for FCRA reporting.
    """
    desc = description.lower()
    
    # Simple rule-based classification with confidence scores
    if any(k in desc for k in ['salary', 'wages', 'staff']):
        return {"category": "Administrative", "confidence": 0.95}
    if any(k in desc for k in ['rent', 'electricity', 'office']):
        return {"category": "Administrative", "confidence": 0.92}
    if any(k in desc for k in ['training', 'workshop', 'literacy', 'books']):
        return {"category": "Educational", "confidence": 0.88}
    if any(k in desc for k in ['medical', 'hospital', 'health', 'camp']):
        return {"category": "Medical", "confidence": 0.90}
        
    return {"category": "General Welfare", "confidence": 0.65}
