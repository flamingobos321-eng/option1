#!/usr/bin/env python3
"""
Backend test suite for OptionAI v0.4 - POSITION MANAGEMENT ENDPOINTS
Tests the new exit-position and place-stop endpoints plus regression tests.
"""
import requests
import json
import time
import os
from dotenv import load_dotenv

load_dotenv('/app/.env')
BASE_URL = os.getenv('NEXT_PUBLIC_BASE_URL', 'https://nifty-copilot-pro.preview.emergentagent.com')
API_BASE = f"{BASE_URL}/api"

print(f"🔍 Testing against: {API_BASE}\n")

# Test counters
passed = 0
failed = 0

def test(name, fn):
    global passed, failed
    print(f"\n{'='*80}")
    print(f"TEST: {name}")
    print('='*80)
    try:
        fn()
        print(f"✅ PASSED: {name}")
        passed += 1
    except AssertionError as e:
        print(f"❌ FAILED: {name}")
        print(f"   Reason: {e}")
        failed += 1
    except Exception as e:
        print(f"❌ ERROR: {name}")
        print(f"   Exception: {e}")
        failed += 1

# ============================================================================
# NEW ENDPOINT 1: POST /api/broker/kite/exit-position
# ============================================================================

def test_exit_position_empty_body():
    """Test exit-position with empty body → 400 with 'tradingsymbol and product required'"""
    r = requests.post(f"{API_BASE}/broker/kite/exit-position", json={}, timeout=10)
    print(f"Status: {r.status_code}")
    print(f"Response: {r.text[:500]}")
    print(f"Content-Type: {r.headers.get('content-type', 'N/A')}")
    
    # Must be 400
    assert r.status_code == 400, f"Expected 400, got {r.status_code}"
    
    # Must be JSON
    content_type = r.headers.get('content-type', '')
    assert 'application/json' in content_type, f"Expected JSON response, got: {content_type}"
    
    # Must have ok:false and error message
    data = r.json()
    assert data['ok'] == False, "Expected ok:false"
    assert 'error' in data, "Expected error field"
    
    # Error message must mention required fields
    error_msg = data['error'].lower()
    assert 'tradingsymbol' in error_msg and 'product' in error_msg and 'required' in error_msg, \
        f"Expected 'tradingsymbol and product required', got: {data['error']}"
    
    print(f"✓ Correct error message: {data['error']}")

def test_exit_position_nonexistent():
    """Test exit-position for non-existent position → 400 or 500 with error (not crash)"""
    r = requests.post(
        f"{API_BASE}/broker/kite/exit-position",
        json={
            'tradingsymbol': 'TESTFAKE99999XX',
            'product': 'MIS'
        },
        timeout=15
    )
    print(f"Status: {r.status_code}")
    print(f"Response: {r.text[:1000]}")
    print(f"Content-Type: {r.headers.get('content-type', 'N/A')}")
    
    # Must be 400 or 500 (not 200, not 404, not HTML error)
    assert r.status_code in [400, 500], f"Expected 400 or 500, got {r.status_code}"
    
    # Must be JSON (not HTML crash page)
    content_type = r.headers.get('content-type', '')
    assert 'application/json' in content_type, f"Expected JSON response, got: {content_type}"
    
    # Must have ok:false and error message
    data = r.json()
    assert data['ok'] == False, "Expected ok:false"
    assert 'error' in data, "Expected error field"
    
    error_msg = data['error'].lower()
    print(f"Error message: {data['error']}")
    
    # Should mention either "no open position" or broker error
    # Acceptable errors: "No open position", "Kite not connected", "No IPs configured", etc.
    is_valid_error = any(x in error_msg for x in [
        'no open position',
        'kite not connected',
        'no ips configured',
        'ip',
        'instrument not found',
        'getpositions'
    ])
    assert is_valid_error, f"Expected position/broker error, got: {data['error']}"
    
    print(f"✓ Handled gracefully with error: {data['error']}")

def test_exit_position_routing():
    """Verify exit-position endpoint is properly routed (not 404)"""
    # We already tested this above, but let's be explicit
    r = requests.post(f"{API_BASE}/broker/kite/exit-position", json={}, timeout=10)
    print(f"Status: {r.status_code}")
    
    # Must NOT be 404
    assert r.status_code != 404, "Endpoint returned 404 - routing issue!"
    
    # Should be 400 (from empty body validation)
    assert r.status_code == 400, f"Expected 400 for empty body, got {r.status_code}"
    
    print(f"✓ Endpoint is properly routed under /api")

# ============================================================================
# NEW ENDPOINT 2: POST /api/broker/kite/place-stop
# ============================================================================

def test_place_stop_empty_body():
    """Test place-stop with empty body → 400 with required fields error"""
    r = requests.post(f"{API_BASE}/broker/kite/place-stop", json={}, timeout=10)
    print(f"Status: {r.status_code}")
    print(f"Response: {r.text[:500]}")
    print(f"Content-Type: {r.headers.get('content-type', 'N/A')}")
    
    # Must be 400
    assert r.status_code == 400, f"Expected 400, got {r.status_code}"
    
    # Must be JSON
    content_type = r.headers.get('content-type', '')
    assert 'application/json' in content_type, f"Expected JSON response, got: {content_type}"
    
    # Must have ok:false and error message
    data = r.json()
    assert data['ok'] == False, "Expected ok:false"
    assert 'error' in data, "Expected error field"
    
    # Error message must mention required fields
    error_msg = data['error'].lower()
    assert 'tradingsymbol' in error_msg or 'product' in error_msg or 'trigger_price' in error_msg, \
        f"Expected mention of required fields, got: {data['error']}"
    assert 'required' in error_msg, f"Expected 'required' in error message, got: {data['error']}"
    
    print(f"✓ Correct error message: {data['error']}")

def test_place_stop_nonexistent_position():
    """Test place-stop for non-existent position → 400 or 500 with error"""
    r = requests.post(
        f"{API_BASE}/broker/kite/place-stop",
        json={
            'tradingsymbol': 'X',
            'product': 'MIS',
            'trigger_price': 100
        },
        timeout=15
    )
    print(f"Status: {r.status_code}")
    print(f"Response: {r.text[:1000]}")
    print(f"Content-Type: {r.headers.get('content-type', 'N/A')}")
    
    # Must be 400 or 500
    assert r.status_code in [400, 500], f"Expected 400 or 500, got {r.status_code}"
    
    # Must be JSON
    content_type = r.headers.get('content-type', '')
    assert 'application/json' in content_type, f"Expected JSON response, got: {content_type}"
    
    # Must have ok:false and error message
    data = r.json()
    assert data['ok'] == False, "Expected ok:false"
    assert 'error' in data, "Expected error field"
    
    error_msg = data['error'].lower()
    print(f"Error message: {data['error']}")
    
    # Should mention either "no open position" or broker error
    is_valid_error = any(x in error_msg for x in [
        'no open position',
        'nothing to protect',
        'kite not connected',
        'no ips configured',
        'ip',
        'instrument not found',
        'getpositions'
    ])
    assert is_valid_error, f"Expected position/broker error, got: {data['error']}"
    
    print(f"✓ Handled gracefully with error: {data['error']}")

def test_place_stop_invalid_trigger_price():
    """Test place-stop with invalid trigger_price → 400 with 'invalid trigger_price'"""
    r = requests.post(
        f"{API_BASE}/broker/kite/place-stop",
        json={
            'tradingsymbol': 'X',
            'product': 'MIS',
            'trigger_price': 'not-a-number'
        },
        timeout=10
    )
    print(f"Status: {r.status_code}")
    print(f"Response: {r.text[:500]}")
    
    # Must be 400
    assert r.status_code == 400, f"Expected 400, got {r.status_code}"
    
    # Must be JSON
    data = r.json()
    assert data['ok'] == False, "Expected ok:false"
    assert 'error' in data, "Expected error field"
    
    # Error message must mention invalid trigger_price
    error_msg = data['error'].lower()
    assert 'invalid' in error_msg and 'trigger_price' in error_msg, \
        f"Expected 'invalid trigger_price', got: {data['error']}"
    
    print(f"✓ Correct error message: {data['error']}")

def test_place_stop_sl_without_price():
    """Test place-stop with SL order type but no price → 400 or broker error (both acceptable)"""
    r = requests.post(
        f"{API_BASE}/broker/kite/place-stop",
        json={
            'tradingsymbol': 'X',
            'product': 'MIS',
            'trigger_price': 100,
            'order_type': 'SL'
            # Missing 'price' field
        },
        timeout=15
    )
    print(f"Status: {r.status_code}")
    print(f"Response: {r.text[:1000]}")
    
    # Can be 400 (validation) or 500 (broker error) - both acceptable per review request
    assert r.status_code in [400, 500], f"Expected 400 or 500, got {r.status_code}"
    
    # Must be JSON
    data = r.json()
    assert data['ok'] == False, "Expected ok:false"
    assert 'error' in data, "Expected error field"
    
    error_msg = data['error'].lower()
    print(f"Error message: {data['error']}")
    
    # Acceptable errors:
    # 1. "SL (limit-stop) order requires price" (validation before Kite call)
    # 2. "No open position" (Kite call happens first)
    # 3. Broker error (Kite not connected, IP whitelist, etc.)
    is_valid_error = any(x in error_msg for x in [
        'sl',
        'limit',
        'price',
        'requires',
        'no open position',
        'nothing to protect',
        'kite not connected',
        'no ips configured'
    ])
    assert is_valid_error, f"Expected SL/price/position/broker error, got: {data['error']}"
    
    print(f"✓ Handled gracefully with error: {data['error']}")

# ============================================================================
# REGRESSION TESTS: Existing endpoints must still work
# ============================================================================

def test_regression_market_indices():
    """Regression: GET /api/market/indices → 200 with indices"""
    r = requests.get(f"{API_BASE}/market/indices", timeout=15)
    print(f"Status: {r.status_code}")
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    
    data = r.json()
    assert data['ok'] == True, "Expected ok:true"
    assert 'indices' in data, "Expected indices field"
    assert 'NIFTY 50' in data['indices'], "Expected NIFTY 50 in indices"
    
    nifty = data['indices']['NIFTY 50']
    assert 'last' in nifty, "Expected 'last' field"
    assert isinstance(nifty['last'], (int, float)), "Expected numeric 'last' value"
    print(f"✓ NIFTY 50 last: {nifty['last']}")

def test_regression_option_chain():
    """Regression: GET /api/market/option-chain?symbol=NIFTY → 200 with chain data"""
    r = requests.get(f"{API_BASE}/market/option-chain?symbol=NIFTY", timeout=15)
    print(f"Status: {r.status_code}")
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    
    data = r.json()
    assert data['ok'] == True, "Expected ok:true"
    assert 'data' in data, "Expected data field"
    
    chain = data['data']
    assert 'spot' in chain, "Expected spot field"
    assert 'atm' in chain, "Expected atm field"
    assert 'pcr' in chain, "Expected pcr field"
    assert 'rows' in chain, "Expected rows field"
    assert len(chain['rows']) > 0, "Expected non-empty rows"
    
    print(f"✓ NIFTY spot: {chain['spot']}, ATM: {chain['atm']}, PCR: {chain['pcr']}, Rows: {len(chain['rows'])}")

def test_regression_signal_scan():
    """Regression: GET /api/signal/scan → 200 with signal data"""
    r = requests.get(f"{API_BASE}/signal/scan", timeout=30)
    print(f"Status: {r.status_code}")
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    
    data = r.json()
    assert data['ok'] == True, "Expected ok:true"
    assert 'perSymbol' in data, "Expected perSymbol field"
    assert 'bestOverall' in data, "Expected bestOverall field"
    
    print(f"✓ Scanned {len(data['perSymbol'])} symbols")
    if data['bestOverall']:
        best = data['bestOverall']
        print(f"✓ Best overall: {best['symbol']} {best['action']} {best['priority']}")

def test_regression_kite_status():
    """Regression: GET /api/broker/kite/status → 200 with connected flag"""
    r = requests.get(f"{API_BASE}/broker/kite/status", timeout=10)
    print(f"Status: {r.status_code}")
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    
    data = r.json()
    assert data['ok'] == True, "Expected ok:true"
    assert 'connected' in data, "Expected connected field"
    assert isinstance(data['connected'], bool), "Expected boolean connected value"
    
    print(f"✓ Kite connected: {data['connected']}")

def test_regression_kite_resolve():
    """Regression: GET /api/broker/kite/resolve → 200 or 500 (depends on broker connection)"""
    r = requests.get(
        f"{API_BASE}/broker/kite/resolve",
        params={
            'symbol': 'NIFTY',
            'expiry': '11-Aug-2026',
            'strike': '24500',
            'type': 'PE'
        },
        timeout=15
    )
    print(f"Status: {r.status_code}")
    print(f"Response: {r.text[:500]}")
    
    # Should return JSON (not crash)
    data = r.json()
    assert 'ok' in data, "Expected 'ok' field in response"
    
    if r.status_code == 200:
        # Broker is connected
        print("✓ Broker connected - endpoint returned valid data")
        assert data['ok'] == True, "Expected ok:true for 200 response"
        assert 'tradingsymbol' in data, "Expected tradingsymbol field"
        assert 'lot_size' in data, "Expected lot_size field"
        assert data['lot_size'] == 65, f"Expected lot_size 65 for NIFTY, got {data['lot_size']}"
        print(f"✓ Resolved: {data['tradingsymbol']}, lot_size={data['lot_size']}")
    elif r.status_code == 500:
        # Broker not connected - should handle gracefully
        print("✓ Broker error handled gracefully")
        assert data['ok'] == False, "Expected ok:false for 500 response"
        assert 'error' in data, "Expected 'error' field in response"
        print(f"Error message: {data['error']}")
    else:
        raise AssertionError(f"Unexpected status code: {r.status_code}")

# ============================================================================
# RUN ALL TESTS
# ============================================================================

if __name__ == '__main__':
    print("="*80)
    print("OptionAI v0.4 - POSITION MANAGEMENT ENDPOINTS - Backend Test Suite")
    print("="*80)
    
    # NEW ENDPOINT 1: exit-position
    print("\n" + "="*80)
    print("SECTION 1: NEW ENDPOINT - POST /api/broker/kite/exit-position")
    print("="*80)
    test("1.1 Exit Position - Empty body → 400", test_exit_position_empty_body)
    test("1.2 Exit Position - Non-existent position → 400/500", test_exit_position_nonexistent)
    test("1.3 Exit Position - Routing verification", test_exit_position_routing)
    
    # NEW ENDPOINT 2: place-stop
    print("\n" + "="*80)
    print("SECTION 2: NEW ENDPOINT - POST /api/broker/kite/place-stop")
    print("="*80)
    test("2.1 Place Stop - Empty body → 400", test_place_stop_empty_body)
    test("2.2 Place Stop - Non-existent position → 400/500", test_place_stop_nonexistent_position)
    test("2.3 Place Stop - Invalid trigger_price → 400", test_place_stop_invalid_trigger_price)
    test("2.4 Place Stop - SL without price → 400/500", test_place_stop_sl_without_price)
    
    # REGRESSION TESTS
    print("\n" + "="*80)
    print("SECTION 3: REGRESSION TESTS - Existing endpoints")
    print("="*80)
    test("3.1 Regression - GET /api/market/indices", test_regression_market_indices)
    test("3.2 Regression - GET /api/market/option-chain", test_regression_option_chain)
    test("3.3 Regression - GET /api/signal/scan", test_regression_signal_scan)
    test("3.4 Regression - GET /api/broker/kite/status", test_regression_kite_status)
    test("3.5 Regression - GET /api/broker/kite/resolve", test_regression_kite_resolve)
    
    # SUMMARY
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    print(f"✅ PASSED: {passed}")
    print(f"❌ FAILED: {failed}")
    print(f"TOTAL: {passed + failed}")
    print("="*80)
    
    if failed == 0:
        print("\n🎉 ALL TESTS PASSED!")
    else:
        print(f"\n⚠️  {failed} TEST(S) FAILED")
    
    exit(0 if failed == 0 else 1)
