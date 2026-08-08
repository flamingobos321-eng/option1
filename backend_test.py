#!/usr/bin/env python3
"""
Phase 1 Backend Verification for OptionAI Personal Trading Terminal
Tests 4 endpoints: indices, option-chain, ai/analyze, ai/chat
"""

import requests
import json
import time
import uuid
from typing import Dict, Any

# Base URL from .env NEXT_PUBLIC_BASE_URL
BASE_URL = "https://nifty-copilot-pro.preview.emergentagent.com/api"

# Test configuration
TIMEOUT = 60  # 60s for most calls, 90s for AI analyze
RETRY_DELAY = 5  # seconds to wait before retry on NSE 502


def log_test(test_name: str, status: str, details: str = ""):
    """Log test results"""
    symbol = "✅" if status == "PASS" else "❌"
    print(f"\n{symbol} {test_name}: {status}")
    if details:
        print(f"   {details}")


def retry_on_502(func, *args, **kwargs):
    """Retry once on 502 errors (NSE rate limiting)"""
    try:
        return func(*args, **kwargs)
    except requests.exceptions.RequestException as e:
        if "502" in str(e):
            print(f"   ⚠️  Got 502, retrying after {RETRY_DELAY}s...")
            time.sleep(RETRY_DELAY)
            return func(*args, **kwargs)
        raise


# ============================================================================
# TEST 1: GET /api/market/indices
# ============================================================================
def test_indices():
    """Test GET /api/market/indices"""
    print("\n" + "="*80)
    print("TEST 1: GET /api/market/indices")
    print("="*80)
    
    try:
        def fetch_indices():
            resp = requests.get(f"{BASE_URL}/market/indices", timeout=TIMEOUT)
            return resp
        
        resp = retry_on_502(fetch_indices)
        
        # Check status code
        if resp.status_code != 200:
            log_test("Indices - Status Code", "FAIL", f"Expected 200, got {resp.status_code}")
            return False
        
        log_test("Indices - Status Code", "PASS", "200 OK")
        
        # Parse JSON
        try:
            data = resp.json()
        except json.JSONDecodeError as e:
            log_test("Indices - JSON Parse", "FAIL", f"Invalid JSON: {e}")
            return False
        
        log_test("Indices - JSON Parse", "PASS")
        
        # Check ok field
        if not data.get("ok"):
            log_test("Indices - ok field", "FAIL", f"ok={data.get('ok')}")
            return False
        
        log_test("Indices - ok field", "PASS")
        
        # Check indices object
        if "indices" not in data:
            log_test("Indices - indices field", "FAIL", "Missing 'indices' field")
            return False
        
        indices = data["indices"]
        
        # Check required indices
        required = ["NIFTY 50", "NIFTY BANK", "INDIA VIX"]
        for idx_name in required:
            if idx_name not in indices:
                log_test(f"Indices - {idx_name}", "FAIL", f"Missing {idx_name}")
                return False
            
            idx = indices[idx_name]
            required_fields = ["last", "change", "percentChange", "open", "high", "low", "previousClose"]
            for field in required_fields:
                if field not in idx:
                    log_test(f"Indices - {idx_name}.{field}", "FAIL", f"Missing field {field}")
                    return False
                if not isinstance(idx[field], (int, float)):
                    log_test(f"Indices - {idx_name}.{field}", "FAIL", f"Not numeric: {idx[field]}")
                    return False
            
            log_test(f"Indices - {idx_name}", "PASS", f"last={idx['last']}, change={idx['change']}")
        
        # Check timestamp
        if "timestamp" not in data:
            log_test("Indices - timestamp", "FAIL", "Missing timestamp")
            return False
        
        log_test("Indices - timestamp", "PASS", f"{data['timestamp']}")
        
        print("\n✅ TEST 1 PASSED: All indices data valid")
        return True
        
    except Exception as e:
        log_test("Indices - Exception", "FAIL", str(e))
        return False


# ============================================================================
# TEST 2: GET /api/market/option-chain
# ============================================================================
def test_option_chain(symbol: str):
    """Test GET /api/market/option-chain?symbol=<symbol>"""
    print("\n" + "="*80)
    print(f"TEST 2: GET /api/market/option-chain?symbol={symbol}")
    print("="*80)
    
    try:
        def fetch_chain():
            resp = requests.get(f"{BASE_URL}/market/option-chain?symbol={symbol}", timeout=TIMEOUT)
            return resp
        
        resp = retry_on_502(fetch_chain)
        
        # Check status code
        if resp.status_code != 200:
            log_test(f"Option Chain {symbol} - Status Code", "FAIL", f"Expected 200, got {resp.status_code}")
            return False
        
        log_test(f"Option Chain {symbol} - Status Code", "PASS", "200 OK")
        
        # Parse JSON
        try:
            result = resp.json()
        except json.JSONDecodeError as e:
            log_test(f"Option Chain {symbol} - JSON Parse", "FAIL", f"Invalid JSON: {e}")
            return False
        
        log_test(f"Option Chain {symbol} - JSON Parse", "PASS")
        
        # Check ok field
        if not result.get("ok"):
            log_test(f"Option Chain {symbol} - ok field", "FAIL", f"ok={result.get('ok')}")
            return False
        
        log_test(f"Option Chain {symbol} - ok field", "PASS")
        
        # Check data object
        if "data" not in result:
            log_test(f"Option Chain {symbol} - data field", "FAIL", "Missing 'data' field")
            return False
        
        data = result["data"]
        
        # Check required fields
        required_fields = ["symbol", "spot", "expiry", "atm", "pcr", "maxPain", "atmIv", "totals", "walls", "rows"]
        for field in required_fields:
            if field not in data:
                log_test(f"Option Chain {symbol} - {field}", "FAIL", f"Missing field {field}")
                return False
        
        log_test(f"Option Chain {symbol} - Required Fields", "PASS")
        
        # Check spot is positive
        spot = data["spot"]
        if not isinstance(spot, (int, float)) or spot <= 0:
            log_test(f"Option Chain {symbol} - spot", "FAIL", f"spot={spot} not positive number")
            return False
        
        log_test(f"Option Chain {symbol} - spot", "PASS", f"spot={spot}")
        
        # Check ATM is close to spot
        atm = data["atm"]
        if not isinstance(atm, (int, float)):
            log_test(f"Option Chain {symbol} - atm", "FAIL", f"atm={atm} not numeric")
            return False
        
        # ATM should be within 2% for NIFTY, 3% for BANKNIFTY
        tolerance = 0.03 if symbol == "BANKNIFTY" else 0.02
        atm_diff = abs(atm - spot) / spot
        if atm_diff > tolerance:
            log_test(f"Option Chain {symbol} - atm proximity", "FAIL", 
                    f"atm={atm} too far from spot={spot} (diff={atm_diff:.2%}, max={tolerance:.0%})")
            return False
        
        log_test(f"Option Chain {symbol} - atm", "PASS", f"atm={atm} (diff={atm_diff:.2%})")
        
        # Check PCR is positive
        pcr = data["pcr"]
        if not isinstance(pcr, (int, float)) or pcr <= 0:
            log_test(f"Option Chain {symbol} - pcr", "FAIL", f"pcr={pcr} not positive")
            return False
        
        log_test(f"Option Chain {symbol} - pcr", "PASS", f"pcr={pcr}")
        
        # Check rows array
        rows = data["rows"]
        if not isinstance(rows, list) or len(rows) == 0:
            log_test(f"Option Chain {symbol} - rows", "FAIL", f"rows empty or not array")
            return False
        
        log_test(f"Option Chain {symbol} - rows count", "PASS", f"{len(rows)} strikes")
        
        # Check first row structure
        row = rows[0]
        if "strikePrice" not in row:
            log_test(f"Option Chain {symbol} - row.strikePrice", "FAIL", "Missing strikePrice")
            return False
        
        # Check at least one of CE/PE exists with required fields
        has_valid_leg = False
        for leg_type in ["CE", "PE"]:
            if leg_type in row and row[leg_type] is not None:
                leg = row[leg_type]
                if "lastPrice" in leg and "openInterest" in leg:
                    has_valid_leg = True
                    break
        
        if not has_valid_leg:
            log_test(f"Option Chain {symbol} - row CE/PE", "FAIL", "No valid CE/PE with lastPrice+openInterest")
            return False
        
        log_test(f"Option Chain {symbol} - row structure", "PASS")
        
        # Check walls
        walls = data["walls"]
        if "resistance" not in walls or "support" not in walls:
            log_test(f"Option Chain {symbol} - walls", "FAIL", "Missing resistance/support")
            return False
        
        resistance_strike = walls["resistance"].get("strike")
        support_strike = walls["support"].get("strike")
        
        # Verify strikes exist in rows
        strikes = [r["strikePrice"] for r in rows]
        if resistance_strike not in strikes:
            log_test(f"Option Chain {symbol} - walls.resistance", "FAIL", 
                    f"resistance strike {resistance_strike} not in rows")
            return False
        
        if support_strike not in strikes:
            log_test(f"Option Chain {symbol} - walls.support", "FAIL", 
                    f"support strike {support_strike} not in rows")
            return False
        
        log_test(f"Option Chain {symbol} - walls", "PASS", 
                f"resistance={resistance_strike}, support={support_strike}")
        
        print(f"\n✅ TEST 2 PASSED: {symbol} option chain valid")
        return True
        
    except Exception as e:
        log_test(f"Option Chain {symbol} - Exception", "FAIL", str(e))
        return False


def test_option_chain_invalid():
    """Test option-chain with invalid symbol"""
    print("\n" + "="*80)
    print("TEST 2b: GET /api/market/option-chain?symbol=FOOBAR (invalid)")
    print("="*80)
    
    try:
        resp = requests.get(f"{BASE_URL}/market/option-chain?symbol=FOOBAR", timeout=TIMEOUT)
        
        # Should return non-200 or ok:false
        if resp.status_code == 200:
            data = resp.json()
            if data.get("ok") == True:
                log_test("Option Chain Invalid - Fail-safe", "FAIL", 
                        "Server returned ok:true for invalid symbol FOOBAR")
                return False
        
        log_test("Option Chain Invalid - Fail-safe", "PASS", 
                f"Correctly rejected invalid symbol (status={resp.status_code})")
        return True
        
    except Exception as e:
        log_test("Option Chain Invalid - Exception", "FAIL", str(e))
        return False


# ============================================================================
# TEST 3: POST /api/ai/analyze
# ============================================================================
def test_ai_analyze(symbol: str):
    """Test POST /api/ai/analyze"""
    print("\n" + "="*80)
    print(f"TEST 3: POST /api/ai/analyze (symbol={symbol})")
    print("="*80)
    print("⏳ This may take 10-25 seconds (LLM call)...")
    
    try:
        start_time = time.time()
        resp = requests.post(
            f"{BASE_URL}/ai/analyze",
            json={"symbol": symbol},
            timeout=90  # Longer timeout for LLM
        )
        elapsed = time.time() - start_time
        
        print(f"   Response received in {elapsed:.1f}s")
        
        # Check status code
        if resp.status_code != 200:
            log_test(f"AI Analyze {symbol} - Status Code", "FAIL", 
                    f"Expected 200, got {resp.status_code}")
            return False
        
        log_test(f"AI Analyze {symbol} - Status Code", "PASS", "200 OK")
        
        # Parse JSON
        try:
            result = resp.json()
        except json.JSONDecodeError as e:
            log_test(f"AI Analyze {symbol} - JSON Parse", "FAIL", f"Invalid JSON: {e}")
            return False
        
        log_test(f"AI Analyze {symbol} - JSON Parse", "PASS")
        
        # Check ok field
        if not result.get("ok"):
            log_test(f"AI Analyze {symbol} - ok field", "FAIL", 
                    f"ok={result.get('ok')}, error={result.get('error')}")
            return False
        
        log_test(f"AI Analyze {symbol} - ok field", "PASS")
        
        # Check analysis object
        if "analysis" not in result:
            log_test(f"AI Analyze {symbol} - analysis field", "FAIL", "Missing 'analysis'")
            return False
        
        analysis = result["analysis"]
        
        # Check required analysis fields
        required_fields = ["bias", "volatility_regime", "score", "action", "reasoning"]
        for field in required_fields:
            if field not in analysis:
                log_test(f"AI Analyze {symbol} - analysis.{field}", "FAIL", f"Missing {field}")
                return False
        
        log_test(f"AI Analyze {symbol} - Required Fields", "PASS")
        
        # Check bias enum
        valid_bias = ["STRONG_BULLISH", "BULLISH", "SIDEWAYS", "BEARISH", "STRONG_BEARISH"]
        if analysis["bias"] not in valid_bias:
            log_test(f"AI Analyze {symbol} - bias", "FAIL", 
                    f"Invalid bias={analysis['bias']}, expected one of {valid_bias}")
            return False
        
        log_test(f"AI Analyze {symbol} - bias", "PASS", f"bias={analysis['bias']}")
        
        # Check volatility_regime enum
        valid_vol = ["LOW", "NORMAL", "HIGH", "EXTREME"]
        if analysis["volatility_regime"] not in valid_vol:
            log_test(f"AI Analyze {symbol} - volatility_regime", "FAIL", 
                    f"Invalid volatility_regime={analysis['volatility_regime']}")
            return False
        
        log_test(f"AI Analyze {symbol} - volatility_regime", "PASS", 
                f"volatility_regime={analysis['volatility_regime']}")
        
        # Check score is 0-100 integer
        score = analysis["score"]
        if not isinstance(score, int) or score < 0 or score > 100:
            log_test(f"AI Analyze {symbol} - score", "FAIL", 
                    f"score={score} not integer 0-100")
            return False
        
        log_test(f"AI Analyze {symbol} - score", "PASS", f"score={score}")
        
        # Check action
        action = analysis["action"]
        if action not in ["TRADE", "NO_TRADE"]:
            log_test(f"AI Analyze {symbol} - action", "FAIL", 
                    f"Invalid action={action}, expected TRADE or NO_TRADE")
            return False
        
        log_test(f"AI Analyze {symbol} - action", "PASS", f"action={action}")
        
        # Check reasoning is non-empty array
        reasoning = analysis["reasoning"]
        if not isinstance(reasoning, list) or len(reasoning) == 0:
            log_test(f"AI Analyze {symbol} - reasoning", "FAIL", 
                    f"reasoning not non-empty array")
            return False
        
        log_test(f"AI Analyze {symbol} - reasoning", "PASS", 
                f"{len(reasoning)} reasoning points")
        
        # If action is TRADE, check trade object
        if action == "TRADE":
            if "trade" not in analysis or analysis["trade"] is None:
                log_test(f"AI Analyze {symbol} - trade object", "FAIL", 
                        "action=TRADE but trade is null/missing")
                return False
            
            trade = analysis["trade"]
            required_trade_fields = [
                "strategy", "entry", "stop", "target1", "target2", 
                "max_loss_per_lot", "risk_reward", "invalidation", "legs"
            ]
            for field in required_trade_fields:
                if field not in trade:
                    log_test(f"AI Analyze {symbol} - trade.{field}", "FAIL", 
                            f"Missing trade.{field}")
                    return False
            
            # Check legs array
            legs = trade["legs"]
            if not isinstance(legs, list) or len(legs) == 0:
                log_test(f"AI Analyze {symbol} - trade.legs", "FAIL", 
                        "legs not non-empty array")
                return False
            
            # Check first leg structure
            leg = legs[0]
            required_leg_fields = ["action", "strike", "type", "ltp"]
            for field in required_leg_fields:
                if field not in leg:
                    log_test(f"AI Analyze {symbol} - trade.legs[0].{field}", "FAIL", 
                            f"Missing leg.{field}")
                    return False
            
            log_test(f"AI Analyze {symbol} - trade object", "PASS", 
                    f"strategy={trade['strategy']}, {len(legs)} legs")
        
        # Check snapshot object
        if "snapshot" not in result:
            log_test(f"AI Analyze {symbol} - snapshot", "FAIL", "Missing snapshot")
            return False
        
        log_test(f"AI Analyze {symbol} - snapshot", "PASS")
        
        print(f"\n✅ TEST 3 PASSED: AI analyze for {symbol} valid")
        return True
        
    except Exception as e:
        log_test(f"AI Analyze {symbol} - Exception", "FAIL", str(e))
        return False


# ============================================================================
# TEST 4: POST /api/ai/chat
# ============================================================================
def test_ai_chat():
    """Test POST /api/ai/chat with session context"""
    print("\n" + "="*80)
    print("TEST 4: POST /api/ai/chat (session + context)")
    print("="*80)
    
    session_id = f"test-{uuid.uuid4()}"
    
    try:
        # First message with context
        print(f"\n📨 Message 1: 'What does PCR tell us right now?'")
        resp1 = requests.post(
            f"{BASE_URL}/ai/chat",
            json={
                "session_id": session_id,
                "message": "What does PCR tell us right now?",
                "context": {
                    "symbol": "NIFTY",
                    "spot": 24500,
                    "pcr": 0.8
                }
            },
            timeout=TIMEOUT
        )
        
        # Check status code
        if resp1.status_code != 200:
            log_test("AI Chat - Message 1 Status", "FAIL", 
                    f"Expected 200, got {resp1.status_code}")
            return False
        
        log_test("AI Chat - Message 1 Status", "PASS", "200 OK")
        
        # Parse JSON
        try:
            result1 = resp1.json()
        except json.JSONDecodeError as e:
            log_test("AI Chat - Message 1 JSON", "FAIL", f"Invalid JSON: {e}")
            return False
        
        # Check ok field
        if not result1.get("ok"):
            log_test("AI Chat - Message 1 ok", "FAIL", 
                    f"ok={result1.get('ok')}, error={result1.get('error')}")
            return False
        
        # Check reply
        if "reply" not in result1 or not isinstance(result1["reply"], str):
            log_test("AI Chat - Message 1 reply", "FAIL", "Missing or invalid reply")
            return False
        
        reply1 = result1["reply"]
        log_test("AI Chat - Message 1 reply", "PASS", f"Got reply ({len(reply1)} chars)")
        print(f"   Reply preview: {reply1[:150]}...")
        
        # Check session_id returned
        if result1.get("session_id") != session_id:
            log_test("AI Chat - Message 1 session_id", "FAIL", 
                    f"session_id mismatch: sent={session_id}, got={result1.get('session_id')}")
            return False
        
        log_test("AI Chat - Message 1 session_id", "PASS")
        
        # Second message - test context retention
        print(f"\n📨 Message 2: 'And what's my earlier question?'")
        time.sleep(3)  # Wait for session to persist
        resp2 = requests.post(
            f"{BASE_URL}/ai/chat",
            json={
                "session_id": session_id,
                "message": "And what's my earlier question?"
            },
            timeout=TIMEOUT
        )
        
        if resp2.status_code != 200:
            log_test("AI Chat - Message 2 Status", "FAIL", 
                    f"Expected 200, got {resp2.status_code}")
            return False
        
        log_test("AI Chat - Message 2 Status", "PASS", "200 OK")
        
        try:
            result2 = resp2.json()
        except json.JSONDecodeError as e:
            log_test("AI Chat - Message 2 JSON", "FAIL", f"Invalid JSON: {e}")
            return False
        
        if not result2.get("ok"):
            log_test("AI Chat - Message 2 ok", "FAIL", 
                    f"ok={result2.get('ok')}, error={result2.get('error')}")
            return False
        
        reply2 = result2["reply"]
        log_test("AI Chat - Message 2 reply", "PASS", f"Got reply ({len(reply2)} chars)")
        print(f"   Reply preview: {reply2[:150]}...")
        
        # Check if reply references PCR or previous question
        reply2_lower = reply2.lower()
        has_context = "pcr" in reply2_lower or "put" in reply2_lower or "call" in reply2_lower or "ratio" in reply2_lower
        
        if not has_context:
            log_test("AI Chat - Context Retention", "FAIL", 
                    "Reply doesn't reference PCR/previous question")
            print(f"   Full reply: {reply2}")
            return False
        
        log_test("AI Chat - Context Retention", "PASS", 
                "Reply references previous context")
        
        print(f"\n✅ TEST 4 PASSED: Chat session context maintained")
        return True
        
    except Exception as e:
        log_test("AI Chat - Exception", "FAIL", str(e))
        return False


def test_ai_chat_validation():
    """Test chat validation (missing fields)"""
    print("\n" + "="*80)
    print("TEST 4b: POST /api/ai/chat validation")
    print("="*80)
    
    try:
        # Test missing session_id
        resp1 = requests.post(
            f"{BASE_URL}/ai/chat",
            json={"message": "test"},
            timeout=TIMEOUT
        )
        
        if resp1.status_code == 200 and resp1.json().get("ok") == True:
            log_test("AI Chat - Missing session_id", "FAIL", 
                    "Should reject missing session_id")
            return False
        
        log_test("AI Chat - Missing session_id", "PASS", 
                f"Correctly rejected (status={resp1.status_code})")
        
        # Test missing message
        resp2 = requests.post(
            f"{BASE_URL}/ai/chat",
            json={"session_id": "test-123"},
            timeout=TIMEOUT
        )
        
        if resp2.status_code == 200 and resp2.json().get("ok") == True:
            log_test("AI Chat - Missing message", "FAIL", 
                    "Should reject missing message")
            return False
        
        log_test("AI Chat - Missing message", "PASS", 
                f"Correctly rejected (status={resp2.status_code})")
        
        print(f"\n✅ TEST 4b PASSED: Chat validation working")
        return True
        
    except Exception as e:
        log_test("AI Chat Validation - Exception", "FAIL", str(e))
        return False


# ============================================================================
# MAIN TEST RUNNER
# ============================================================================
def main():
    print("\n" + "="*80)
    print("OPTIONAI PHASE 1 BACKEND VERIFICATION")
    print("="*80)
    print(f"Base URL: {BASE_URL}")
    print(f"Timeout: {TIMEOUT}s (90s for AI analyze)")
    print("="*80)
    
    results = {}
    
    # Test 1: Indices
    results["indices"] = test_indices()
    
    # Test 2: Option Chain (NIFTY and BANKNIFTY)
    results["option_chain_nifty"] = test_option_chain("NIFTY")
    results["option_chain_banknifty"] = test_option_chain("BANKNIFTY")
    results["option_chain_invalid"] = test_option_chain_invalid()
    
    # Test 3: AI Analyze
    results["ai_analyze"] = test_ai_analyze("NIFTY")
    
    # Test 4: AI Chat
    results["ai_chat"] = test_ai_chat()
    results["ai_chat_validation"] = test_ai_chat_validation()
    
    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    passed = sum(1 for v in results.values() if v)
    total = len(results)
    
    for test_name, result in results.items():
        symbol = "✅" if result else "❌"
        print(f"{symbol} {test_name}: {'PASS' if result else 'FAIL'}")
    
    print("="*80)
    print(f"TOTAL: {passed}/{total} tests passed")
    print("="*80)
    
    if passed == total:
        print("\n🎉 ALL TESTS PASSED!")
        return 0
    else:
        print(f"\n⚠️  {total - passed} test(s) failed")
        return 1


if __name__ == "__main__":
    exit(main())
