FROM node:22-alpine

# Install build dependencies
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package*.json ./

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Change ownership to non-root user
RUN chown -R appuser:nodejs /app
USER appuser

# Install only production dependencies
RUN npm ci --only=production --ignore-scripts && npm cache clean --force

# Install build dependencies separately
RUN npm install typescript tsc-alias --no-save

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Remove build dependencies
RUN npm uninstall typescript tsc-alias

CMD ["npm", "start"]
