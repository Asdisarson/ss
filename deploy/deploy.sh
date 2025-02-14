#!/bin/bash

# Exit on error
set -e

# Configuration
PI_USER="nexus"
PI_HOST="dk-nexus.api.local"
PI_PASSWORD="Ashnazg91"
APP_NAME="ss"
REMOTE_DIR="/home/nexus/apps/$APP_NAME"

# Check if sshpass is installed
if ! command -v sshpass &> /dev/null; then
    echo "Installing sshpass..."
    sudo apt-get update
    sudo apt-get install -y sshpass
fi

# Create deploy directory
echo "Preparing deployment package..."
DEPLOY_DIR="$(pwd)/deploy/tmp"
rm -rf "$DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR"

# Copy necessary files
cp -r src package.json package-lock.json .env.example deploy/install.sh "$DEPLOY_DIR/"

# Make scripts executable
chmod +x "$DEPLOY_DIR/install.sh"

# Create archive
ARCHIVE_NAME="$APP_NAME.tar.gz"
cd "$DEPLOY_DIR"
tar czf "../$ARCHIVE_NAME" .
cd ..

# Copy files to Raspberry Pi
echo "Copying files to Raspberry Pi..."
sshpass -p "$PI_PASSWORD" scp -o StrictHostKeyChecking=no "$ARCHIVE_NAME" "$PI_USER@$PI_HOST:~/"

# Execute installation script
echo "Installing application on Raspberry Pi..."
sshpass -p "$PI_PASSWORD" ssh -o StrictHostKeyChecking=no "$PI_USER@$PI_HOST" << EOF
    cd ~
    mkdir -p apps/$APP_NAME
    tar xzf $ARCHIVE_NAME -C apps/$APP_NAME
    cd apps/$APP_NAME
    chmod +x install.sh
    ./install.sh
EOF

# Clean up
echo "Cleaning up..."
rm -rf "$DEPLOY_DIR" "$ARCHIVE_NAME"

echo "Deployment completed!"
echo "The application should now be accessible at http://$PI_HOST" 