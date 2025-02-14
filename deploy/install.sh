#!/bin/bash

# Exit on error
set -e

# Configuration
APP_NAME="ss"
APP_DIR="/home/nexus/apps/$APP_NAME"
REPO_URL="$PWD"
NODE_VERSION="18"

echo "Starting installation of $APP_NAME..."

# Install required packages
echo "Installing system dependencies..."
sudo apt-get update
sudo apt-get install -y git redis-server sqlite3 nginx

# Install Node.js if not present
if ! command -v node &> /dev/null; then
    echo "Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Create app directory
echo "Creating application directory..."
sudo mkdir -p $APP_DIR
sudo chown nexus:nexus $APP_DIR

# Copy application files
echo "Copying application files..."
rsync -av --exclude 'node_modules' --exclude '.git' --exclude 'logs' --exclude '*.sqlite' . $APP_DIR/

# Set up environment file
echo "Setting up environment file..."
cat > $APP_DIR/.env << EOL
PORT=3000
REDIS_HOST=localhost
REDIS_PORT=6379
NODE_ENV=production
LOG_LEVEL=info
DK_API_KEY=${DK_API_KEY}
DK_API_URL=https://api.dkplus.is/api/v1/
EOL

# Install dependencies
echo "Installing Node.js dependencies..."
cd $APP_DIR
npm install --production

# Set up systemd service
echo "Setting up systemd service..."
sudo tee /etc/systemd/system/$APP_NAME.service << EOL
[Unit]
Description=DK Product Search Service
After=network.target redis-server.service

[Service]
Type=simple
User=nexus
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node src/server.js
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOL

# Set up Nginx configuration
echo "Setting up Nginx configuration..."
sudo tee /etc/nginx/sites-available/$APP_NAME << EOL
server {
    listen 80;
    server_name dk-nexus.api.local;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOL

# Enable Nginx site
sudo ln -sf /etc/nginx/sites-available/$APP_NAME /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Create logs directory with correct permissions
mkdir -p $APP_DIR/logs
chown -R nexus:nexus $APP_DIR/logs

# Start and enable services
echo "Starting services..."
sudo systemctl daemon-reload
sudo systemctl enable $APP_NAME
sudo systemctl start $APP_NAME
sudo systemctl restart nginx

# Verify installation
echo "Verifying installation..."
curl -I http://localhost:3000

echo "Installation completed!"
echo "The application should now be accessible at http://dk-nexus.api.local"
echo "To view logs, use: journalctl -u $APP_NAME -f" 