#!/bin/bash
# This script is for Linux/macOS.
# To run, ensure you are in your project's root directory and your virtual environment is active.
# Then execute with: sh seed_db.sh
 
echo "Starting database seeding process..."
echo "-------------------------------------"

# Define the list of commands to run
COMMANDS=(
    "seed_locations"
    "seed_currencies"
    "seed_roles"
    "seed_lookups"
)

# Function to run a Django management command
run_command() {
    echo "--- Running python manage.py $1 ---"
    python manage.py "$1"
    if [ $? -ne 0 ]; then
        echo "Error running command: $1"
        exit 1
    fi
    echo "--- Command $1 completed. ---"
    echo ""
}

# Run each command in the list
for cmd in "${COMMANDS[@]}"; do
    run_command "$cmd"
done

echo "-------------------------------------"
echo "Database seeding complete."
