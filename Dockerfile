FROM node:22-alpine

# Install build dependencies
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production --ignore-scripts

# Install build dependencies separately
RUN npm install typescript tsc-alias --no-save

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Remove build dependencies
RUN npm uninstall typescript tsc-alias

EXPOSE 3000

CMD ["npm", "start"]