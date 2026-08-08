#!/usr/bin/env python3
"""
Detailed test for AI chat context retention
"""

import requests
import json
import time
import uuid

BASE_URL = "https://nifty-copilot-pro.preview.emergentagent.com/api"
TIMEOUT = 60

def test_chat_context_detailed():
    """Test chat context with multiple approaches"""
    session_id = f"test-{uuid.uuid4()}"
    
    print(f"Session ID: {session_id}\n")
    
    # Test 1: Ask about a specific number
    print("="*80)
    print("Message 1: Ask about a specific PCR value")
    print("="*80)
    resp1 = requests.post(
        f"{BASE_URL}/ai/chat",
        json={
            "session_id": session_id,
            "message": "The PCR is currently 1.25. What does this tell us?",
            "context": {"symbol": "NIFTY", "spot": 24500, "pcr": 1.25}
        },
        timeout=TIMEOUT
    )
    
    result1 = resp1.json()
    print(f"Status: {resp1.status_code}")
    print(f"Reply: {result1.get('reply', 'N/A')}\n")
    
    time.sleep(3)
    
    # Test 2: Ask to recall the specific number
    print("="*80)
    print("Message 2: Ask to recall the PCR value")
    print("="*80)
    resp2 = requests.post(
        f"{BASE_URL}/ai/chat",
        json={
            "session_id": session_id,
            "message": "What was the PCR value I just mentioned?"
        },
        timeout=TIMEOUT
    )
    
    result2 = resp2.json()
    print(f"Status: {resp2.status_code}")
    print(f"Reply: {result2.get('reply', 'N/A')}\n")
    
    # Check if reply mentions 1.25
    reply2 = result2.get('reply', '').lower()
    if '1.25' in reply2 or '1.2' in reply2:
        print("✅ Context retained: Reply mentions the PCR value")
        return True
    else:
        print("❌ Context NOT retained: Reply doesn't mention the PCR value")
        return False

if __name__ == "__main__":
    result = test_chat_context_detailed()
    exit(0 if result else 1)
