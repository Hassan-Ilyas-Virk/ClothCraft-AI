#!/bin/bash

# Run Backend Tests
echo "========================================"
echo "    RUNNING CLOTHIFY BACKEND TESTS      "
echo "========================================"

# Navigate to project root to ensure imports work
cd "$(dirname "$0")/.."

# Run the python unittest
# 1. We assume python3 is available
# 2. We suppress some tensorflow/torch warnings for cleaner output
python3 -W ignore::DeprecationWarning test_cases/backend/test_api.py

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo ""
    echo "✅ ALL BACKEND TESTS PASSED"
else
    echo ""
    echo "❌ SOME TESTS FAILED"
fi

exit $EXIT_CODE
