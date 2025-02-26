# Stage 1: Build Node.js application
FROM node:18-alpine AS nodejs-build

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application code
COPY . .

# Stage 2: Final image with Nginx and Node.js
FROM nginx:alpine

# Install Node.js in the Nginx image
RUN apk add --no-cache nodejs npm

# Create app directory and copy from build stage
WORKDIR /app
COPY --from=nodejs-build /app /app

# Copy Nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy startup script
COPY start.sh /start.sh
RUN chmod +x /start.sh

# Expose HTTP and HTTPS ports
EXPOSE 80 443

# Start Nginx and Node.js app
CMD ["/start.sh"]