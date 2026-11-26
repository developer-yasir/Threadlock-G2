FROM node:22-slim

# Install system curl and ca-certificates for reliable Telegram Bot API transport
RUN apt-get update && apt-get install -y curl ca-certificates && rm -rf /var/lib/apt/lists/*

# Hugging Face Spaces requires running as a non-root user with UID 1000
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH

WORKDIR /app

# Copy dependency manifests
COPY --chown=user:user package.json ./
COPY --chown=user:user backend/package.json backend/

# Install dependencies (including tsx)
RUN npm --prefix backend install

# Copy all repository source files
COPY --chown=user:user . .

# Hugging Face Spaces standard port
ENV PORT=7860 \
    HOST=0.0.0.0

EXPOSE 7860

# Start application
CMD ["npm", "start"]
