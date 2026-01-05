FROM node:22-slim

# Install dependencies for Puppeteer and Chromium
RUN apt-get update && apt-get install -y \
    # Build dependencies
    python3 \
    make \
    g++ \
    # Chromium and dependencies
    chromium \
    chromium-sandbox \
    # Fonts for PDF rendering
    fonts-liberation \
    fonts-noto-color-emoji \
    fonts-noto-cjk \
    # Required libraries for Chromium
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    # Cleanup to reduce image size
    && rm -rf /var/lib/apt/lists/*

# Set environment variables for Puppeteer to use system Chrome
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (Puppeteer won't download Chrome)
RUN npm ci --ignore-scripts && npm cache clean --force

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Expose port
EXPOSE 3000

# Support both API and Worker processes via START_COMMAND env var
# API: START_COMMAND="npm run start:api"
# Worker: START_COMMAND="npm run start:worker"
CMD ["sh", "-c", "${START_COMMAND:-npm run start:api}"]
