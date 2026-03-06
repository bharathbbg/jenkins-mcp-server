# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY src ./src

# Build the project
RUN npm run build

# Production stage
FROM node:20-slim AS runner

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm install --omit=dev

# Copy compiled code from builder
COPY --from=builder /app/build ./build

# The server runs on stdio by default, but we expose 3000 for SSE
EXPOSE 3000

# Use environment variables for configuration
ENV NODE_ENV=production
ENV TRANSPORT=stdio
ENV PORT=3000

# Entry point
ENTRYPOINT ["node", "build/index.js"]
