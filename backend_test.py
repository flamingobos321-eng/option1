#!/usr/bin/env python3
"""
Backend test suite for OptionAI v0.3 - LOT SIZE MISMATCH BUG FIX verification
Tests the new /api/broker/kite/resolve endpoint and updated lot sizes.
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
# NEW ENDPOINT: GET /api/broker/kite/resolve
# ============================================================================

def test_resolve_missing_params():
    """Test /api/broker/kite/resolve with missing parameters → 400"""
    # Missing all params
    r = requests.get(f"{API_BASE}/broker/kite/resolve", timeout=10)
    print(f"Status: {r.status_code}")
    print(f"Response: {r.text[:500]}")
    assert r.status_code == 400, f"Expected 400, got {r.status_code}"
    data = r.json()
    assert data['ok'] == False, "Expected ok:false"
    assert 'error' in data, "Expected error field"
    assert 'required' in data['error'].lower(), f"Expected 'required' in error message, got: {data['error']}"
    
    # Missing type
    r = requests.get(f"{API_BASE}/broker/kite/resolve?symbol=NIFTY&expiry=11-Aug-2026&strike=24500", timeout=10)
    print(f"Missing type - Status: {r.status_code}")
    assert r.status_code == 400, f"Expected 400, got {r.status_code}"
    data = r.json()
    assert data['ok'] == False, "Expected ok:false"
    
    # Missing strike
    r = requests.get(f"{API_BASE}/broker/kite/resolve?symbol=NIFTY&expiry=11-Aug-2026&type=PE", timeout=10)
    print(f"Missing strike - Status: {r.status_code}")
    assert r.status_code == 400, f"Expected 400, got {r.status_code}"
    data = r.json()
    assert data['ok'] == False, "Expected ok:false"

def test_resolve_broker_not_connected_or_ip_error():
    """Test /api/broker/kite/resolve with all params - verify it returns valid response"""
    # This will either:
    # (a) Return 200 with valid data if broker is connected and IP is whitelisted
    # (b) Return 500 with error if broker not connected or IP not whitelisted
    # Both are acceptable - we just need to verify it doesn't crash
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
    print(f"Response: {r.text[:1000]}")
    
    # Should return JSON (not crash/stack trace)
    data = r.json()
    assert 'ok' in data, "Expected 'ok' field in response"
    
    if r.status_code == 200:
        # Broker is connected and working!
        print("✓ Broker connected - endpoint returned valid data")
        assert data['ok'] == True, "Expected ok:true for 200 response"
        assert 'tradingsymbol' in data, "Expected tradingsymbol field"
        assert 'lot_size' in data, "Expected lot_size field"
        assert data['lot_size'] == 65, f"Expected lot_size 65 for NIFTY, got {data['lot_size']}"
        print(f"✓ Resolved: {data['tradingsymbol']}, lot_size={data['lot_size']}")
    elif r.status_code == 500:
        # Broker not connected or IP error - should handle gracefully
        print("✓ Broker error handled gracefully")
        assert data['ok'] == False, "Expected ok:false for 500 response"
        assert 'error' in data, "Expected 'error' field in response"
        error_msg = data['error'].lower()
        print(f"Error message: {data['error']}")
        # Verify it's a known error (not a crash)
        assert any(x in error_msg for x in ['kite not connected', 'ip', 'instrument not found', 'no ips configured']), \
            f"Expected Kite error message, got: {data['error']}"
    else:
        raise AssertionError(f"Unexpected status code: {r.status_code}")

# ============================================================================
# UPDATED ENDPOINT: POST /api/broker/kite/place-order
# ============================================================================

def test_place_order_missing_fields():
    """Test /api/broker/kite/place-order with missing fields → 400"""
    # Missing all fields
    r = requests.post(f"{API_BASE}/broker/kite/place-order", json={}, timeout=10)
    print(f"Status: {r.status_code}")
    print(f"Response: {r.text[:500]}")
    assert r.status_code == 400, f"Expected 400, got {r.status_code}"
    data = r.json()
    assert data['ok'] == False, "Expected ok:false"
    assert 'error' in data, "Expected error field"
    assert 'missing' in data['error'].lower(), f"Expected 'missing' in error, got: {data['error']}"

def test_place_order_invalid_side():
    """Test /api/broker/kite/place-order with invalid side → 400"""
    r = requests.post(
        f"{API_BASE}/broker/kite/place-order",
        json={
            'symbol': 'NIFTY',
            'side': 'HOLD',  # Invalid
            'strike': 24500,
            'type': 'PE',
            'expiry': '11-Aug-2026',
            'quantity': 65
        },
        timeout=10
    )
    print(f"Status: {r.status_code}")
    print(f"Response: {r.text[:500]}")
    assert r.status_code == 400, f"Expected 400, got {r.status_code}"
    data = r.json()
    assert data['ok'] == False, "Expected ok:false"
    assert 'side' in data['error'].lower(), f"Expected 'side' in error, got: {data['error']}"

def test_place_order_invalid_type():
    """Test /api/broker/kite/place-order with invalid type → 400"""
    r = requests.post(
        f"{API_BASE}/broker/kite/place-order",
        json={
            'symbol': 'NIFTY',
            'side': 'BUY',
            'strike': 24500,
            'type': 'XX',  # Invalid
            'expiry': '11-Aug-2026',
            'quantity': 65
        },
        timeout=10
    )
    print(f"Status: {r.status_code}")
    print(f"Response: {r.text[:500]}")
    assert r.status_code == 400, f"Expected 400, got {r.status_code}"
    data = r.json()
    assert data['ok'] == False, "Expected ok:false"
    assert 'type' in data['error'].lower(), f"Expected 'type' in error, got: {data['error']}"

def test_place_order_broker_error():
    """Test /api/broker/kite/place-order with valid fields but broker not connected → 500"""
    # This will fail with either "Kite not connected" or "No IPs configured" - both expected
    r = requests.post(
        f"{API_BASE}/broker/kite/place-order",
        json={
            'symbol': 'NIFTY',
            'side': 'BUY',
            'strike': 24500,
            'type': 'PE',
            'expiry': '11-Aug-2026',
            'quantity': 75  # Wrong lot size, but will fail at broker connection first
        },
        timeout=15
    )
    print(f"Status: {r.status_code}")
    print(f"Response: {r.text[:1000]}")
    
    # Should be 500 (server error)
    assert r.status_code == 500, f"Expected 500, got {r.status_code}"
    
    # Should return JSON (not crash)
    data = r.json()
    assert 'ok' in data, "Expected 'ok' field"
    assert data['ok'] == False, "Expected ok:false"
    assert 'error' in data, "Expected 'error' field"
    
    error_msg = data['error'].lower()
    print(f"Error message: {data['error']}")
    
    # Should be Kite-related error
    assert any(x in error_msg for x in ['kite not connected', 'ip', 'instrument not found', 'no ips configured']), \
        f"Expected Kite error, got: {data['error']}"

# ============================================================================
# UPDATED SIGNAL ENGINE: Verify new lot sizes
# ============================================================================

def test_signal_scan_lot_sizes():
    """Test /api/signal/scan returns updated lot sizes (NIFTY:65, BANKNIFTY:35, FINNIFTY:65)"""
    r = requests.get(f"{API_BASE}/signal/scan", timeout=30)
    print(f"Status: {r.status_code}")
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    
    data = r.json()
    assert data['ok'] == True, "Expected ok:true"
    assert 'perSymbol' in data, "Expected perSymbol field"
    
    # Check lot sizes for each symbol
    lot_sizes = {}
    for item in data['perSymbol']:
        symbol = item['symbol']
        if item.get('best') and 'lotSize' in item['best']:
            lot_sizes[symbol] = item['best']['lotSize']
            print(f"{symbol} lot size: {item['best']['lotSize']}")
    
    # Verify updated lot sizes
    assert lot_sizes.get('NIFTY') == 65, f"Expected NIFTY lot size 65, got {lot_sizes.get('NIFTY')}"
    assert lot_sizes.get('BANKNIFTY') == 35, f"Expected BANKNIFTY lot size 35, got {lot_sizes.get('BANKNIFTY')}"
    assert lot_sizes.get('FINNIFTY') == 65, f"Expected FINNIFTY lot size 65, got {lot_sizes.get('FINNIFTY')}"
    
    print(f"✓ All lot sizes updated correctly: NIFTY=65, BANKNIFTY=35, FINNIFTY=65")

# ============================================================================
# REGRESSION TESTS: Existing endpoints from v0.1
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

def test_regression_kite_login_url():
    """Regression: GET /api/broker/kite/login-url → 200 with Kite URL"""
    r = requests.get(f"{API_BASE}/broker/kite/login-url", timeout=10)
    print(f"Status: {r.status_code}")
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    
    data = r.json()
    assert data['ok'] == True, "Expected ok:true"
    assert 'url' in data, "Expected url field"
    assert data['url'].startswith('https://kite.zerodha.com'), f"Expected Kite URL, got: {data['url']}"
    
    print(f"✓ Kite login URL: {data['url'][:80]}...")

def test_regression_kite_status():
    """Regression: GET /api/broker/kite/status → 200 with connected status"""
    r = requests.get(f"{API_BASE}/broker/kite/status", timeout=10)
    print(f"Status: {r.status_code}")
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    
    data = r.json()
    assert data['ok'] == True, "Expected ok:true"
    assert 'connected' in data, "Expected connected field"
    assert isinstance(data['connected'], bool), "Expected boolean connected value"
    
    print(f"✓ Kite connected: {data['connected']}")
    if data['connected']:
        print(f"  Note: Token stored but may fail on actual API calls due to IP whitelist")

# ============================================================================
# RUN ALL TESTS
# ============================================================================

if __name__ == '__main__':
    print("="*80)
    print("OptionAI v0.3 - LOT SIZE MISMATCH BUG FIX - Backend Test Suite")
    print("="*80)
    
    # NEW ENDPOINT TESTS
    print("\n" + "="*80)
    print("SECTION 1: NEW ENDPOINT - GET /api/broker/kite/resolve")
    print("="*80)
    test("1.1 Resolve - Missing parameters → 400", test_resolve_missing_params)
    test("1.2 Resolve - Verify endpoint works correctly", test_resolve_broker_not_connected_or_ip_error)
    
    # UPDATED ENDPOINT TESTS
    print("\n" + "="*80)
    print("SECTION 2: UPDATED ENDPOINT - POST /api/broker/kite/place-order")
    print("="*80)
    test("2.1 Place Order - Missing fields → 400", test_place_order_missing_fields)
    test("2.2 Place Order - Invalid side → 400", test_place_order_invalid_side)
    test("2.3 Place Order - Invalid type → 400", test_place_order_invalid_type)
    test("2.4 Place Order - Broker error → 500 with JSON", test_place_order_broker_error)
    
    # UPDATED LOT SIZES
    print("\n" + "="*80)
    print("SECTION 3: UPDATED LOT SIZES - GET /api/signal/scan")
    print("="*80)
    test("3.1 Signal Scan - Verify updated lot sizes", test_signal_scan_lot_sizes)
    
    # REGRESSION TESTS
    print("\n" + "="*80)
    print("SECTION 4: REGRESSION TESTS - Existing endpoints")
    print("="*80)
    test("4.1 Regression - GET /api/market/indices", test_regression_market_indices)
    test("4.2 Regression - GET /api/market/option-chain", test_regression_option_chain)
    test("4.3 Regression - GET /api/signal/scan", test_regression_signal_scan)
    test("4.4 Regression - GET /api/broker/kite/login-url", test_regression_kite_login_url)
    test("4.5 Regression - GET /api/broker/kite/status", test_regression_kite_status)
    
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
