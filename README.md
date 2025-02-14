# Product Search API

A high-performance REST API for product search and inventory management, featuring full-text search capabilities, Redis caching, and real-time warehouse stock levels.

## Features

- 🔍 Advanced multi-term search across product codes, names, and barcodes
- 📊 Real-time warehouse inventory tracking
- 🚀 Redis caching for optimized performance
- 📝 Comprehensive logging system
- 🔄 Automatic product synchronization
- 📋 Pagination support
- 🔒 Production-ready error handling

## Prerequisites

- Node.js >= 14
- Redis server
- SQLite3

## Installation

### Standard Installation

1. Clone the repository:
```bash
git clone [repository-url]
cd [project-directory]
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
```

4. Edit `.env` with your configuration:
```
PORT=3000
REDIS_HOST=localhost
REDIS_PORT=6379
NODE_ENV=development
LOG_LEVEL=info
DK_API_KEY=your-api-key
```

### Raspberry Pi Installation (Ubuntu Server)

1. Update your system:
```bash
sudo apt update && sudo apt upgrade -y
```

2. Clone the repository:
```bash
git clone [repository-url]
cd [project-directory]
```

3. Make the installation script executable:
```bash
chmod +x install.sh
```

4. Run the installation script:
```bash
sudo ./install.sh
```

The script will:
- Install Node.js and Redis
- Set up the application in `/opt/product-search-api`
- Create a systemd service for automatic startup
- Configure logging and permissions
- Start the service

#### Managing the Service

```bash
# Check service status
sudo systemctl status product-search-api

# Start the service
sudo systemctl start product-search-api

# Stop the service
sudo systemctl stop product-search-api

# Restart the service
sudo systemctl restart product-search-api

# View logs
sudo journalctl -u product-search-api -f
```

#### Updating the Application

1. Stop the service:
```bash
sudo systemctl stop product-search-api
```

2. Navigate to the application directory:
```bash
cd /opt/product-search-api
```

3. Pull the latest changes:
```bash
git pull origin main
```

4. Install dependencies:
```bash
npm ci --production
```

5. Restart the service:
```bash
sudo systemctl restart product-search-api
```

## Usage

### Development
```bash
npm run dev
```

### Production
```bash
npm start
```

## API Endpoints

### Get All Products
```
GET /api/products
```

### Search Products
```
GET /api/products/search
```

Query Parameters:
- `q`: Search query (required)
- `page`: Page number (default: 1)
- `pageSize`: Results per page (10, 25, 50, 100, 1000) (default: 25)

Example:
```
GET /api/products/search?q=blue shirt&page=1&pageSize=25
```

Response:
```json
{
    "total": 150,
    "page": 1,
    "pageSize": 25,
    "totalPages": 6,
    "results": [...]
}
```

## Monitoring

Logs are stored in the `logs` directory:
- `logs/error.log`: Error-level logs
- `logs/combined.log`: All logs

You can also view system logs:
```bash
sudo journalctl -u product-search-api -f
```

## Performance

- Redis caching with 5-minute TTL
- Database indexes for optimized search
- Relevance-based search results
- Response time logging

## Error Handling

- Comprehensive error logging
- Graceful shutdown handling
- Production/Development error responses
- Automatic retry mechanisms for external services

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the ISC License - see the LICENSE file for details. 