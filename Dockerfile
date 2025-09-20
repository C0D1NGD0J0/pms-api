FROM node:22-slim

# Install build dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --ignore-scripts && npm cache clean --force

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Expose port
EXPOSE 3000

CMD ["npm", "start"]
