const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const Redis = require('ioredis');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const gzip = promisify(zlib.gzip);
const ungzip = promisify(zlib.gunzip);
require('dotenv').config();

// Logging utility
const LOG_FILE = path.join(__dirname, '..', 'logs', 'app.log');

// Ensure logs directory exists
if (!fs.existsSync(path.dirname(LOG_FILE))) {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
}

function log(level, message, error = null) {
    const timestamp = new Date().toISOString();
    const logEntry = {
        timestamp,
        level,
        message,
        ...(error && { error: error.stack || error.message || error }),
    };
    
    const logLine = JSON.stringify(logEntry) + '\n';
    fs.appendFileSync(LOG_FILE, logLine);

    // Also log to console in development
    if (process.env.NODE_ENV !== 'production') {
        console[level](message, error || '');
    }
}

// Error handling middleware
function errorHandler(err, req, res, next) {
    log('error', 'Unhandled error:', err);
    res.status(500).json({
        error: process.env.NODE_ENV === 'production'
            ? 'Internal server error'
            : err.message
    });
}

// Function declarations first
async function fetchAndStoreProducts(db) {
    try {
        log('info', 'Starting product fetch from API');
        const data = new FormData();
        const config = {
            method: 'get',
            maxBodyLength: Infinity,
            url: `${process.env.DK_API_URL}Product`,
            headers: {
                Authorization: `Bearer ${process.env.DK_API_KEY}`,
                ...data.getHeaders(),
            },
            data,
        };

        const response = await axios.request(config);
        const products = response.data;
        log('info', `Fetched ${products.length} products from API`);

        return new Promise((resolve, reject) => {
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');

                db.run('DELETE FROM products', [], (deleteErr) => {
                    if (deleteErr) {
                        log('error', 'Error clearing products:', deleteErr);
                        db.run('ROLLBACK');
                        reject(deleteErr);
                        return;
                    }
                    log('info', 'Cleared existing products');

                    const stmt = db.prepare(`
                        INSERT INTO products (
                            record_id,
                            item_code,
                            name,
                            description,
                            description2,
                            extra_desc1,
                            extra_desc2,
                            unit_price_with_tax,
                            unit_price1,
                            unit_price2,
                            unit_price3,
                            purchase_price,
                            cost_price,
                            currency_code,
                            barcodes,
                            categories,
                            warehouse_data,
                            inactive,
                            allow_discount,
                            max_discount_allowed,
                            record_created,
                            record_modified
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `);

                    let insertCount = 0;
                    products.forEach((product) => {
                        try {
                            const name = [
                                product.Description,
                                product.Description2,
                                product.ExtraDesc1
                            ].filter(Boolean).join(' ').trim() || product.ItemCode || 'Unknown Product';

                            stmt.run(
                                product.RecordID || null,
                                product.ItemCode || '',
                                name,
                                product.Description || null,
                                product.Description2 || null,
                                product.ExtraDesc1 || null,
                                product.ExtraDesc2 || null,
                                product.UnitPrice1WithTax || 0,
                                product.UnitPrice1 || 0,
                                product.UnitPrice2 || 0,
                                product.UnitPrice3 || 0,
                                product.PurchasePrice || 0,
                                product.CostPrice || 0,
                                product.CurrencyCode || 'ISK',
                                JSON.stringify(product.Barcodes?.map((b) => b.Barcode) || []),
                                JSON.stringify(product.Categories || []),
                                JSON.stringify(product.Warehouses || []),
                                product.Inactive ? 1 : 0,
                                product.AllowDiscount ? 1 : 0,
                                product.MaxDiscountAllowed || 0,
                                product.RecordCreated || null,
                                product.RecordModified || null
                            );
                            insertCount += 1;
                        } catch (error) {
                            log('error', `Error processing product ${product.ItemCode}:`, error);
                        }
                    });

                    stmt.finalize();
                    db.run('COMMIT', (commitErr) => {
                        if (commitErr) {
                            log('error', 'Error committing transaction:', commitErr);
                            db.run('ROLLBACK');
                            reject(commitErr);
                        } else {
                            log('info', `Successfully inserted ${insertCount} products`);
                            resolve();
                        }
                    });
                });
            });
        });
    } catch (error) {
        log('error', 'Error in fetchAndStoreProducts:', error);
        throw error;
    }
}

// Initialize database tables
async function initializeDatabase(db, isNewDatabase) {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            try {
                // Create products table with expanded fields
                db.run(`
                    CREATE TABLE IF NOT EXISTS products (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        record_id INTEGER,
                        item_code TEXT UNIQUE NOT NULL,
                        name TEXT NOT NULL,
                        description TEXT,
                        description2 TEXT,
                        extra_desc1 TEXT,
                        extra_desc2 TEXT,
                        unit_price_with_tax REAL,
                        unit_price1 REAL,
                        unit_price2 REAL,
                        unit_price3 REAL,
                        purchase_price REAL,
                        cost_price REAL,
                        currency_code TEXT,
                        barcodes TEXT,
                        categories TEXT,
                        warehouse_data TEXT,
                        inactive BOOLEAN DEFAULT 0,
                        allow_discount BOOLEAN DEFAULT 1,
                        max_discount_allowed REAL,
                        record_created DATETIME,
                        record_modified DATETIME,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `, (err) => {
                    if (err) {
                        console.error('Error creating products table:', err);
                        reject(err);
                        return;
                    }
                    console.log('Products table created or already exists');
                });

                // Create indexes for faster searching
                db.run('CREATE INDEX IF NOT EXISTS idx_item_code ON products(item_code)');
                db.run('CREATE INDEX IF NOT EXISTS idx_name ON products(name)');
                db.run('CREATE INDEX IF NOT EXISTS idx_barcodes ON products(barcodes)');
                db.run('CREATE INDEX IF NOT EXISTS idx_categories ON products(categories)');

                if (isNewDatabase) {
                    console.log('New database detected, fetching initial products...');
                    fetchAndStoreProducts(db)
                        .then(() => {
                            console.log('Initial product sync completed');
                            resolve();
                        })
                        .catch((error) => {
                            console.error('Error during initial product sync:', error);
                            reject(error);
                        });
                } else {
                    resolve();
                }
            } catch (error) {
                console.error('Error in database initialization:', error);
                reject(error);
            }
        });
    });
}

const app = express();
const port = process.env.PORT || 3000;
const DB_FILE = process.env.DB_FILE || './database.sqlite';

// Cache configuration
const CACHE_CONFIG = {
  PREFIX: 'ss:',
  DEFAULT_TTL: 300, // 5 minutes
  COMPRESSED_MIN_SIZE: 1024, // Compress if larger than 1KB
  CATEGORIES: {
    PRODUCT: 'product:',
    SEARCH: 'search:',
    INVENTORY: 'inventory:'
  }
};

// Redis setup with error handling
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    log('warn', `Redis connection attempt ${times} failed. Retrying in ${delay}ms`);
    return delay;
  },
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  autoResendUnfulfilledCommands: true,
  reconnectOnError: (err) => {
    const targetError = 'READONLY';
    if (err.message.includes(targetError)) {
      return true;
    }
    return false;
  }
});

// Redis helper functions
const cacheUtils = {
  generateKey: (category, identifier) => {
    return `${CACHE_CONFIG.PREFIX}${category}${identifier}`;
  },

  async set(key, data, ttl = CACHE_CONFIG.DEFAULT_TTL) {
    try {
      const stringData = JSON.stringify(data);
      let finalData = stringData;

      // Compress if data is large
      if (stringData.length > CACHE_CONFIG.COMPRESSED_MIN_SIZE) {
        const compressed = await gzip(stringData);
        finalData = compressed.toString('base64');
        key = `${key}:compressed`;
      }

      await redis.setex(key, ttl, finalData);
      log('debug', `Cache set: ${key}`);
    } catch (error) {
      log('error', `Cache set error for key ${key}:`, error);
    }
  },

  async get(key) {
    try {
      const data = await redis.get(key);
      if (!data) {
        // Try compressed version
        const compressedData = await redis.get(`${key}:compressed`);
        if (compressedData) {
          const buffer = Buffer.from(compressedData, 'base64');
          const decompressed = await ungzip(buffer);
          return JSON.parse(decompressed.toString());
        }
        return null;
      }
      return JSON.parse(data);
    } catch (error) {
      log('error', `Cache get error for key ${key}:`, error);
      return null;
    }
  },

  async invalidate(key) {
    try {
      await Promise.all([
        redis.del(key),
        redis.del(`${key}:compressed`)
      ]);
      log('debug', `Cache invalidated: ${key}`);
    } catch (error) {
      log('error', `Cache invalidation error for key ${key}:`, error);
    }
  }
};

// Redis event handlers
redis.on('error', (err) => {
  log('error', 'Redis error:', err);
});

redis.on('connect', () => {
  log('info', 'Successfully connected to Redis');
});

redis.on('ready', () => {
  log('info', 'Redis is ready to accept commands');
});

redis.on('close', () => {
  log('warn', 'Redis connection closed');
});

redis.on('reconnecting', () => {
  log('warn', 'Redis reconnecting...');
});

// Track last update time
let lastUpdateTime = null;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(errorHandler);

// Database setup
const db = new sqlite3.Database(DB_FILE, async (err) => {
    if (err) {
        log('error', 'Error connecting to the database:', err);
        process.exit(1);
    } else {
        log('info', 'Connected to SQLite database');
        try {
            const isNewDatabase = !fs.existsSync(DB_FILE);
            await initializeDatabase(db, isNewDatabase);
            log('info', 'Database initialization completed');
        } catch (error) {
            log('error', 'Database initialization failed:', error);
            process.exit(1);
        }
    }
});

// View logs endpoint
app.get('/logs', (req, res) => {
    try {
        // Read last 1000 lines by default
        const lines = req.query.lines ? parseInt(req.query.lines, 10) : 1000;
        const logs = fs.readFileSync(LOG_FILE, 'utf8')
            .split('\n')
            .filter(line => line.trim())
            .slice(-lines)
            .map(line => JSON.parse(line))
            .reverse(); // Most recent first

        // If HTML is requested, render a simple log viewer
        if (req.headers.accept?.includes('text/html')) {
            const html = `
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Application Logs</title>
                    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
                    <style>
                        .log-error { color: #dc3545; }
                        .log-warn { color: #ffc107; }
                        .log-info { color: #0dcaf0; }
                        pre { white-space: pre-wrap; word-wrap: break-word; }
                    </style>
                </head>
                <body class="bg-dark text-light">
                    <div class="container-fluid py-3">
                        <h1 class="mb-4">Application Logs</h1>
                        <div class="mb-3">
                            <select class="form-select d-inline-block w-auto" onchange="window.location.href='?lines='+this.value">
                                <option value="100" ${lines === 100 ? 'selected' : ''}>Last 100 lines</option>
                                <option value="500" ${lines === 500 ? 'selected' : ''}>Last 500 lines</option>
                                <option value="1000" ${lines === 1000 ? 'selected' : ''}>Last 1000 lines</option>
                                <option value="5000" ${lines === 5000 ? 'selected' : ''}>Last 5000 lines</option>
                            </select>
                        </div>
                        ${logs.map(entry => `
                            <div class="log-entry mb-2">
                                <small class="text-muted">${entry.timestamp}</small>
                                <span class="log-${entry.level}">[${entry.level.toUpperCase()}]</span>
                                <span>${entry.message}</span>
                                ${entry.error ? `<pre class="mt-1 text-danger">${entry.error}</pre>` : ''}
                            </div>
                        `).join('')}
                    </div>
                </body>
                </html>
            `;
            res.send(html);
        } else {
            res.json(logs);
        }
    } catch (error) {
        log('error', 'Error reading logs:', error);
        res.status(500).json({ error: 'Failed to read logs' });
    }
});

// Default route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'search.html'));
});

// Force refresh endpoint
app.post('/api/refresh', async (req, res) => {
    try {
        await fetchAndStoreProducts(db);
        lastUpdateTime = new Date();
        res.json({
            success: true,
            message: 'Data refreshed successfully',
            lastUpdate: lastUpdateTime,
        });
    } catch (error) {
        log('error', 'Refresh error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to refresh data',
        });
    }
});

// Get last update time
app.get('/api/last-update', (req, res) => {
    res.json({ lastUpdate: lastUpdateTime });
});

// Search endpoint
app.get('/api/search', async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }

    const cacheKey = cacheUtils.generateKey(CACHE_CONFIG.CATEGORIES.SEARCH, query);
    const cachedResult = await cacheUtils.get(cacheKey);

    if (cachedResult) {
      log('info', `Cache hit for search: ${query}`);
      return res.json(cachedResult);
    }

    // Simplified query without JSON functions
    db.all(
      `SELECT * FROM products 
       WHERE name LIKE ? 
         OR item_code LIKE ? 
         OR barcodes LIKE ?
         OR description LIKE ?
         OR description2 LIKE ?
         OR extra_desc1 LIKE ?
         OR extra_desc2 LIKE ?
       LIMIT 100`,
      Array(7).fill(`%${query}%`),
      async (err, rows) => {
        if (err) {
          log('error', 'Database error:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        // Cache the results
        await cacheUtils.set(cacheKey, rows);
        res.json(rows);
      }
    );
  } catch (error) {
    log('error', 'Search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(port, () => {
    log('info', `Server is running on http://localhost:${port}`);
});

// Process termination handling
process.on('SIGTERM', async () => {
  try {
    await Promise.all([
      new Promise((resolve) => {
        redis.quit(() => {
          log('info', 'Redis connection closed.');
          resolve();
        });
      }),
      new Promise((resolve) => {
        db.close(() => {
          log('info', 'Database connection closed.');
          resolve();
        });
      })
    ]);
    process.exit(0);
  } catch (error) {
    log('error', 'Error during shutdown:', error);
    process.exit(1);
  }
});

// Export for testing
module.exports = { app, redis, db }; 