# Use the official Node.js 18 Alpine image as base
FROM node:18-alpine

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy the rest of the application code
COPY . .

# Create a non-root user to run the application
RUN addgroup -g 10001 -S appuser && \
    adduser -S -u 10001 -G appuser appuser

# Change ownership of the app directory to appuser
RUN chown -R appuser:appuser /app
USER 10001

# Set environment variables
ENV HOST=0.0.0.0
ENV PORT=8000

# Expose the port that the app runs on
EXPOSE 8000

# Define the command to run the application
CMD ["node", "server.js"]
