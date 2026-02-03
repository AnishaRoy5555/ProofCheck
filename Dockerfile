FROM node:18-slim

WORKDIR /app

# Create temp directory for downloaded repos
RUN mkdir -p temp

COPY package*.json ./
RUN npm ci --only=production

COPY . .

# Expose port (Railway uses PORT env var)
EXPOSE 3001

CMD ["node", "server.js"]
