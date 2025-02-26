#!/bin/sh
set -e

# Handle process termination gracefully
handle_termination() {
    echo "Received termination signal. Shutting down services..."

    # Kill Node.js app if it's running
    if [ -f /app/node.pid ]; then
        NODE_PID=$(cat /app/node.pid)
        if kill -0 "$NODE_PID" 2>/dev/null; then
            echo "Stopping Node.js application (PID: $NODE_PID)..."
            kill -TERM "$NODE_PID"
        fi
    fi

    # Stop Nginx
    if [ -f /var/run/nginx.pid ]; then
        echo "Stopping Nginx..."
        nginx -s quit
    fi

    exit 0
}

# Set up trap for termination signals
trap handle_termination TERM INT QUIT

# Start Node.js application in background
echo "Starting Node.js application..."
cd /app
node server.js &
echo $! > /app/node.pid

# Give Node.js a moment to start
sleep 2

# Check if Node.js is running
if [ -f /app/node.pid ]; then
    NODE_PID=$(cat /app/node.pid)
    if kill -0 "$NODE_PID" 2>/dev/null; then
        echo "Node.js application started successfully (PID: $NODE_PID)."
    else
        echo "Failed to start Node.js application!"
        exit 1
    fi
fi

# Start Nginx in foreground
echo "Starting Nginx..."
nginx -g "daemon off;"