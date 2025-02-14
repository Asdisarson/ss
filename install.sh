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

# Install screen dependencies
echo "📦 Installing screen dependencies..."
apt install -y python3-pip python3-pil python3-numpy
pip3 install adafruit-circuitpython-rgb-display psutil requests redis

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

# Create systemd service for API
echo "🔧 Creating API systemd service..."
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

# Create systemd service for screen display
echo "🔧 Creating screen display service..."
cat > /etc/systemd/system/api-display.service << EOL
[Unit]
Description=API Status Display
After=product-search-api.service

[Service]
Type=simple
User=$SUDO_USER
WorkingDirectory=/opt/product-search-api
ExecStart=/usr/bin/python3 /opt/product-search-api/display.py
Restart=always
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOL

# Enable SPI if not already enabled
echo "🔧 Enabling SPI interface..."
if ! grep -q "^dtparam=spi=on" /boot/firmware/config.txt; then
    echo "dtparam=spi=on" >> /boot/firmware/config.txt
fi

# Reload systemd and start services
echo "🔄 Starting services..."
systemctl daemon-reload
systemctl enable product-search-api api-display
systemctl start product-search-api api-display

echo "✅ Installation complete!"
echo "🌐 API should now be running on port 3000"
echo "📝 Check logs at /opt/product-search-api/logs/"
echo "⚙️ Service status: systemctl status product-search-api"
echo "🖥️ Display status: systemctl status api-display" 