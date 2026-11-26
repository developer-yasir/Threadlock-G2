FROM node:22-slim

# Install system curl and ca-certificates for reliable Telegram Bot API transport
RUN apt-get update && apt-get install -y curl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency manifests
COPY package.json ./
COPY backend/package.json backend/

# Install dependencies (including tsx and vitest)
RUN npm --prefix backend install

# Copy all repository source files
COPY . .

# Default container environment
ENV PORT=4000 \
    HOST=0.0.0.0 \
    NODE_ENV=production

EXPOSE 4000

# Start application
CMD ["npm", "start"]
