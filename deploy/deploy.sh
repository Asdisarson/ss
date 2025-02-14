#!/bin/bash

# Configuration
APP_NAME="ss"
APP_DIR="/home/nexus/apps/ss"
REPO_URL="git@github.com:yourusername/ss.git"  # Replace with your repo URL
NODE_VERSION="18"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}Starting deployment of ${APP_NAME}...${NC}"

# Create app directory if it doesn't exist
mkdir -p $APP_DIR

# Install Node.js if not installed
if ! command -v node &> /dev/null; then
    echo -e "${GREEN}Installing Node.js...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Install Redis if not installed
if ! command -v redis-server &> /dev/null; then
    echo -e "${GREEN}Installing Redis...${NC}"
    sudo apt-get update
    sudo apt-get install -y redis-server
    sudo systemctl enable redis-server
    sudo systemctl start redis-server
fi

# Install PM2 if not installed
if ! command -v pm2 &> /dev/null; then
    echo -e "${GREEN}Installing PM2...${NC}"
    sudo npm install -g pm2
fi

# Copy application files
echo -e "${GREEN}Copying application files...${NC}"
rsync -av --exclude='node_modules' --exclude='.git' --exclude='logs' --exclude='*.sqlite' ./ $APP_DIR/

# Set up environment file
echo -e "${GREEN}Setting up environment file...${NC}"
if [ ! -f "$APP_DIR/.env" ]; then
    cp $APP_DIR/.env.example $APP_DIR/.env
    echo "Please edit $APP_DIR/.env with your configuration"
fi

# Install dependencies
echo -e "${GREEN}Installing dependencies...${NC}"
cd $APP_DIR
npm install --production

# Setup PM2 process
echo -e "${GREEN}Setting up PM2 process...${NC}"
pm2 delete $APP_NAME 2>/dev/null || true
pm2 start src/server.js --name $APP_NAME --env production

# Save PM2 process list
pm2 save

# Setup PM2 startup script
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u nexus --hp /home/nexus

echo -e "${GREEN}Deployment completed!${NC}"
echo -e "Application is running at http://192.168.112.118:3000"
echo -e "To view logs: pm2 logs ${APP_NAME}"
echo -e "To restart: pm2 restart ${APP_NAME}"
echo -e "To stop: pm2 stop ${APP_NAME}" 