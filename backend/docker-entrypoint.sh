#!/bin/sh

set -e

echo "Running database migrations..."
./node_modules/.bin/prisma migrate deploy

echo "Starting server..."
exec ./node_modules/.bin/tsx src/index.ts
