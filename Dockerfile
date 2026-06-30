# Use lightweight official Node.js image
FROM node:20-alpine

# Set working directory
WORKDIR /usr/src/app

# Copy dependency configs
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy application source code
COPY . .

# Expose server port (default 3000)
EXPOSE 3000

# Start server
CMD [ "npm", "start" ]
