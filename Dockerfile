# Stage 1: Build stage
FROM node:20-alpine AS builder
WORKDIR /app

# Install build dependencies for better-sqlite3 native compilation
RUN apk add --no-cache python3 make g++ gcc

# Copy package configuration files
COPY package*.json ./

# Install all dependencies (including devDependencies needed for build)
RUN npm ci

# Copy all source files
COPY . .

# Build Vite frontend and compile Express server.ts with esbuild
RUN npm run build

# Prune node_modules to remove devDependencies, keeping only production dependencies
RUN npm prune --production

# Stage 2: Production runner stage
FROM node:20-alpine AS runner
WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

# Copy only production dependencies and compiled assets
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# Create database folder
RUN mkdir -p /app/data

# Expose server port
EXPOSE 3000

# Start server
CMD ["node", "dist/server.cjs"]
