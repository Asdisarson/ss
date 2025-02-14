#!/bin/bash

echo "🚀 Starting installation of Product Search API..."

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "Please run as root (use sudo)"
    exit 1
fi

# Update system
echo "📦 Updating system packages..."
apt update && apt upgrade -y

# Install Node.js
echo "📦 Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Install Redis
echo "📦 Installing Redis..."
apt install -y redis-server

# Configure Redis to start on boot
echo "🔧 Configuring Redis..."
systemctl enable redis-server
systemctl start redis-server

# Create app directory
echo "📁 Creating application directory..."
mkdir -p /opt/product-search-api
cd /opt/product-search-api

# Copy application files
echo "📋 Copying application files..."
cp -r * /opt/product-search-api/

# Install dependencies
echo "📦 Installing Node.js dependencies..."
npm ci --production

# Create logs directory
echo "📁 Creating logs directory..."
mkdir -p logs
chown -R $SUDO_USER:$SUDO_USER logs

# Setup environment
echo "🔧 Setting up environment..."
cp .env.example .env

# Create systemd service
echo "🔧 Creating systemd service..."
cat > /etc/systemd/system/product-search-api.service << EOL
[Unit]
Description=Product Search API
After=network.target redis-server.service

[Service]
Type=simple
User=$SUDO_USER
WorkingDirectory=/opt/product-search-api
ExecStart=/usr/bin/npm start
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOL

# Reload systemd and start service
echo "🔄 Starting service..."
systemctl daemon-reload
systemctl enable product-search-api
systemctl start product-search-api

echo "✅ Installation complete!"
echo "🌐 API should now be running on port 3000"
echo "📝 Check logs at /opt/product-search-api/logs/"
echo "⚙️ Service status: systemctl status product-search-api" 