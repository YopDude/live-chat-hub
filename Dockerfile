# Use an official Node image pre-packaged with stable Google Chrome and dependencies
FROM ghcr.io/puppeteer/puppeteer:24.43.1

# Set working directory inside the container
WORKDIR /usr/src/app

# Copy dependency mappings
COPY package*.json ./

# Install dependencies cleanly
RUN npm ci

# Copy the rest of your application code
COPY . .

# Expose the server port
EXPOSE 3000

# Start your server application
CMD [ "npm", "start" ]