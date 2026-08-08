#!/usr/bin/env python3
"""
Focused test for POST /api/ai/chat multi-turn context retention fix
Tests the specific requirements from the review request
"""

import requests
import json
import time
import uuid
import re

# Base URL from .env NEXT_PUBLIC_BASE_URL
BASE_URL = "https://nifty-copilot-pro.preview.emergentagent.com/api"
TIMEOUT = 60


def log_test(test_name: str, status: str, details: str = ""):
    """Log test results"""
    symbol = "✅" if status == "PASS" else "❌"
    print(f"\n{symbol} {test_name}: {status}")
    if details:
        print(f"   {details}")


def test_multi_turn_memory():
    """
    Test 1: Multi-turn memory across the SAME session_id
    - Turn A: Remember NIFTY target 24800 and stop 24450
    - Turn B: Ask what target and stop were shared
    - Reply MUST contain both "24800" and "24450" (or with commas)
    """
    print("\n" + "="*80)
    print("TEST 1: Multi-turn memory across SAME session_id")
    print("="*80)
    
    session_id = f"pytest-{uuid.uuid4()}"
    print(f"Session ID: {session_id}")
    
    try:
        # Turn A: Store the target and stop
        print(f"\n📨 Turn A: Storing NIFTY target 24800 and stop 24450")
        resp_a = requests.post(
            f"{BASE_URL}/ai/chat",
            json={
                "session_id": session_id,
                "message": "Please remember: my personal NIFTY target for today is 24800 and my stop is 24450."
            },
            timeout=TIMEOUT
        )
        
        # Check status code
        if resp_a.status_code != 200:
            log_test("Turn A - Status Code", "FAIL", f"Expected 200, got {resp_a.status_code}")
            print(f"Response: {resp_a.text}")
            return False
        
        log_test("Turn A - Status Code", "PASS", "200 OK")
        
        # Parse JSON
        try:
            result_a = resp_a.json()
        except json.JSONDecodeError as e:
            log_test("Turn A - JSON Parse", "FAIL", f"Invalid JSON: {e}")
            return False
        
        # Check ok field
        if not result_a.get("ok"):
            log_test("Turn A - ok field", "FAIL", 
                    f"ok={result_a.get('ok')}, error={result_a.get('error')}")
            return False
        
        log_test("Turn A - ok field", "PASS")
        
        # Check reply exists
        if "reply" not in result_a or not isinstance(result_a["reply"], str):
            log_test("Turn A - reply", "FAIL", "Missing or invalid reply")
            return False
        
        reply_a = result_a["reply"]
        log_test("Turn A - reply", "PASS", f"Got reply ({len(reply_a)} chars)")
        print(f"   Reply: {reply_a[:200]}...")
        
        # Check session_id returned
        if result_a.get("session_id") != session_id:
            log_test("Turn A - session_id", "FAIL", 
                    f"session_id mismatch: sent={session_id}, got={result_a.get('session_id')}")
            return False
        
        log_test("Turn A - session_id", "PASS")
        
        # Wait 2 seconds as per review request
        print(f"\n⏳ Waiting 2 seconds...")
        time.sleep(2)
        
        # Turn B: Ask what target and stop were shared
        print(f"\n📨 Turn B: Asking what NIFTY target and stop were shared")
        resp_b = requests.post(
            f"{BASE_URL}/ai/chat",
            json={
                "session_id": session_id,
                "message": "What NIFTY target and stop did I share with you earlier?"
            },
            timeout=TIMEOUT
        )
        
        # Check status code
        if resp_b.status_code != 200:
            log_test("Turn B - Status Code", "FAIL", f"Expected 200, got {resp_b.status_code}")
            print(f"Response: {resp_b.text}")
            return False
        
        log_test("Turn B - Status Code", "PASS", "200 OK")
        
        # Parse JSON
        try:
            result_b = resp_b.json()
        except json.JSONDecodeError as e:
            log_test("Turn B - JSON Parse", "FAIL", f"Invalid JSON: {e}")
            return False
        
        # Check ok field
        if not result_b.get("ok"):
            log_test("Turn B - ok field", "FAIL", 
                    f"ok={result_b.get('ok')}, error={result_b.get('error')}")
            return False
        
        log_test("Turn B - ok field", "PASS")
        
        # Check reply exists
        if "reply" not in result_b or not isinstance(result_b["reply"], str):
            log_test("Turn B - reply", "FAIL", "Missing or invalid reply")
            return False
        
        reply_b = result_b["reply"]
        log_test("Turn B - reply", "PASS", f"Got reply ({len(reply_b)} chars)")
        print(f"   Reply: {reply_b}")
        
        # CRITICAL CHECK: Reply MUST contain both "24800" and "24450" (or with commas)
        # Accept: 24800, 24,800
        # Accept: 24450, 24,450
        has_target = "24800" in reply_b or "24,800" in reply_b
        has_stop = "24450" in reply_b or "24,450" in reply_b
        
        if not has_target:
            log_test("Turn B - Context Retention (target)", "FAIL", 
                    "Reply does NOT contain target value 24800 or 24,800")
            print(f"   Full reply: {reply_b}")
            return False
        
        log_test("Turn B - Context Retention (target)", "PASS", "Reply contains 24800")
        
        if not has_stop:
            log_test("Turn B - Context Retention (stop)", "FAIL", 
                    "Reply does NOT contain stop value 24450 or 24,450")
            print(f"   Full reply: {reply_b}")
            return False
        
        log_test("Turn B - Context Retention (stop)", "PASS", "Reply contains 24450")
        
        print(f"\n✅ TEST 1 PASSED: Multi-turn memory working correctly")
        return True
        
    except Exception as e:
        log_test("Multi-turn Memory - Exception", "FAIL", str(e))
        import traceback
        traceback.print_exc()
        return False


def test_cross_session_isolation():
    """
    Test 2: Cross-session isolation
    - New session_id asking about NIFTY target
    - Reply must NOT contain "24800" (verifying histories are keyed by session_id)
    """
    print("\n" + "="*80)
    print("TEST 2: Cross-session isolation")
    print("="*80)
    
    session_id = f"pytest-other-{uuid.uuid4()}"
    print(f"Session ID: {session_id}")
    
    try:
        print(f"\n📨 Asking about NIFTY target in NEW session (should not know)")
        resp = requests.post(
            f"{BASE_URL}/ai/chat",
            json={
                "session_id": session_id,
                "message": "What NIFTY target did I mention?"
            },
            timeout=TIMEOUT
        )
        
        # Check status code
        if resp.status_code != 200:
            log_test("Cross-session - Status Code", "FAIL", f"Expected 200, got {resp.status_code}")
            return False
        
        log_test("Cross-session - Status Code", "PASS", "200 OK")
        
        # Parse JSON
        try:
            result = resp.json()
        except json.JSONDecodeError as e:
            log_test("Cross-session - JSON Parse", "FAIL", f"Invalid JSON: {e}")
            return False
        
        # Check ok field
        if not result.get("ok"):
            log_test("Cross-session - ok field", "FAIL", 
                    f"ok={result.get('ok')}, error={result.get('error')}")
            return False
        
        log_test("Cross-session - ok field", "PASS")
        
        # Check reply exists
        if "reply" not in result or not isinstance(result["reply"], str):
            log_test("Cross-session - reply", "FAIL", "Missing or invalid reply")
            return False
        
        reply = result["reply"]
        log_test("Cross-session - reply", "PASS", f"Got reply ({len(reply)} chars)")
        print(f"   Reply: {reply}")
        
        # CRITICAL CHECK: Reply must NOT contain "24800" (from previous session)
        has_leaked_target = "24800" in reply or "24,800" in reply
        
        if has_leaked_target:
            log_test("Cross-session - Isolation", "FAIL", 
                    "Reply contains 24800 from different session - session isolation BROKEN")
            print(f"   Full reply: {reply}")
            return False
        
        log_test("Cross-session - Isolation", "PASS", 
                "Reply does NOT contain 24800 - sessions are properly isolated")
        
        print(f"\n✅ TEST 2 PASSED: Cross-session isolation working correctly")
        return True
        
    except Exception as e:
        log_test("Cross-session Isolation - Exception", "FAIL", str(e))
        import traceback
        traceback.print_exc()
        return False


def test_validation():
    """
    Test 3: Validation
    - Missing session_id → HTTP 400
    - Missing message → HTTP 400
    """
    print("\n" + "="*80)
    print("TEST 3: Validation (missing fields)")
    print("="*80)
    
    try:
        # Test missing session_id
        print(f"\n📨 Test 3a: Missing session_id")
        resp1 = requests.post(
            f"{BASE_URL}/ai/chat",
            json={"message": "test message"},
            timeout=TIMEOUT
        )
        
        if resp1.status_code != 400:
            log_test("Validation - Missing session_id", "FAIL", 
                    f"Expected 400, got {resp1.status_code}")
            return False
        
        log_test("Validation - Missing session_id", "PASS", "Correctly returned 400")
        
        # Test missing message
        print(f"\n📨 Test 3b: Missing message")
        resp2 = requests.post(
            f"{BASE_URL}/ai/chat",
            json={"session_id": "test-123"},
            timeout=TIMEOUT
        )
        
        if resp2.status_code != 400:
            log_test("Validation - Missing message", "FAIL", 
                    f"Expected 400, got {resp2.status_code}")
            return False
        
        log_test("Validation - Missing message", "PASS", "Correctly returned 400")
        
        print(f"\n✅ TEST 3 PASSED: Validation working correctly")
        return True
        
    except Exception as e:
        log_test("Validation - Exception", "FAIL", str(e))
        import traceback
        traceback.print_exc()
        return False


def test_optional_context_injection():
    """
    Test 4: Optional context injection still works
    - Send with context: {"symbol":"NIFTY","spot":24500,"pcr":0.5}
    - Reply should reference PCR / bearish tilt / calls dominance
    """
    print("\n" + "="*80)
    print("TEST 4: Optional context injection")
    print("="*80)
    
    session_id = f"pytest-context-{uuid.uuid4()}"
    print(f"Session ID: {session_id}")
    
    try:
        print(f"\n📨 Sending message with market context (PCR=0.5)")
        resp = requests.post(
            f"{BASE_URL}/ai/chat",
            json={
                "session_id": session_id,
                "message": "Given the snapshot, what does PCR of 0.5 imply?",
                "context": {
                    "symbol": "NIFTY",
                    "spot": 24500,
                    "pcr": 0.5
                }
            },
            timeout=TIMEOUT
        )
        
        # Check status code
        if resp.status_code != 200:
            log_test("Context Injection - Status Code", "FAIL", f"Expected 200, got {resp.status_code}")
            return False
        
        log_test("Context Injection - Status Code", "PASS", "200 OK")
        
        # Parse JSON
        try:
            result = resp.json()
        except json.JSONDecodeError as e:
            log_test("Context Injection - JSON Parse", "FAIL", f"Invalid JSON: {e}")
            return False
        
        # Check ok field
        if not result.get("ok"):
            log_test("Context Injection - ok field", "FAIL", 
                    f"ok={result.get('ok')}, error={result.get('error')}")
            return False
        
        log_test("Context Injection - ok field", "PASS")
        
        # Check reply exists
        if "reply" not in result or not isinstance(result["reply"], str):
            log_test("Context Injection - reply", "FAIL", "Missing or invalid reply")
            return False
        
        reply = result["reply"]
        log_test("Context Injection - reply", "PASS", f"Got reply ({len(reply)} chars)")
        print(f"   Reply: {reply}")
        
        # Check if reply is non-empty and mentions PCR
        if len(reply.strip()) == 0:
            log_test("Context Injection - Non-empty reply", "FAIL", "Reply is empty")
            return False
        
        log_test("Context Injection - Non-empty reply", "PASS")
        
        # Check if reply mentions PCR (case insensitive)
        reply_lower = reply.lower()
        mentions_pcr = "pcr" in reply_lower or "put" in reply_lower or "call" in reply_lower
        
        if not mentions_pcr:
            log_test("Context Injection - PCR reference", "FAIL", 
                    "Reply does not mention PCR/put/call")
            return False
        
        log_test("Context Injection - PCR reference", "PASS", 
                "Reply references PCR/put/call context")
        
        print(f"\n✅ TEST 4 PASSED: Context injection working correctly")
        return True
        
    except Exception as e:
        log_test("Context Injection - Exception", "FAIL", str(e))
        import traceback
        traceback.print_exc()
        return False


def main():
    """Run all tests"""
    print("\n" + "="*80)
    print("POST /api/ai/chat - MULTI-TURN CONTEXT RETENTION VERIFICATION")
    print("="*80)
    print(f"Base URL: {BASE_URL}")
    print(f"Timeout: {TIMEOUT}s")
    print("="*80)
    
    results = {}
    
    # Test 1: Multi-turn memory (CRITICAL)
    results["multi_turn_memory"] = test_multi_turn_memory()
    
    # Test 2: Cross-session isolation
    results["cross_session_isolation"] = test_cross_session_isolation()
    
    # Test 3: Validation
    results["validation"] = test_validation()
    
    # Test 4: Optional context injection
    results["context_injection"] = test_optional_context_injection()
    
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
        print("\n🎉 ALL TESTS PASSED - Multi-turn context retention is working!")
        return 0
    else:
        print(f"\n⚠️  {total - passed} test(s) failed")
        return 1


if __name__ == "__main__":
    exit(main())
