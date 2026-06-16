FROM node:20-alpine

# Install git for git features
RUN apk add --no-cache git

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm install --production

# Copy app
COPY server/ ./server/
COPY client/ ./client/

# Data volume for users, config, workspace
VOLUME ["/workspace", "/app/data"]

# Default env
ENV PORT=3030
ENV WORKSPACE=/workspace
ENV NODE_ENV=production

EXPOSE 3030

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s \
  CMD wget -qO- http://localhost:3030/api/auth/config || exit 1

CMD ["node", "server/index.js"]
