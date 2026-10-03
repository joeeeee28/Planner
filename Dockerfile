FROM node:22-alpine

WORKDIR /app

# Copy dependency manifests
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy backend server code
COPY server ./server

# Expose default backend port
EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001

# Start the OAuth backend server
CMD ["node", "server/oauthServer.mjs"]
