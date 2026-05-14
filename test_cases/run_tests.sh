#!/bin/bash

# Run Backend Tests
echo "========================================"
echo "    RUNNING CLOTHIFY BACKEND TESTS      "
echo "========================================"

# Navigate to project root to ensure imports work
cd "$(dirname "$0")/.."

OVERALL_EXIT=0

run_suite() {
    local label="$1"
    local file="$2"
    echo ""
    echo "--- $label ---"
    python3 -W ignore::DeprecationWarning -m pytest "$file" -v 2>/dev/null \
        || python3 -W ignore::DeprecationWarning "$file" -v
    local code=$?
    [ $code -ne 0 ] && OVERALL_EXIT=$code
}

run_suite "API Endpoints"   test_cases/backend/test_api.py
run_suite "Authentication"  test_cases/backend/test_auth.py
run_suite "Projects CRUD"   test_cases/backend/test_projects.py

echo ""
echo "========================================"
if [ $OVERALL_EXIT -eq 0 ]; then
    echo "  ALL BACKEND TESTS PASSED"
else
    echo "  SOME TESTS FAILED (exit $OVERALL_EXIT)"
fi
echo "========================================"

exit $OVERALL_EXIT
