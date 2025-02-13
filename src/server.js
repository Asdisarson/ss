const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const Redis = require('ioredis');
const winston = require('winston');
const expressWinston = require('express-winston');
require('dotenv').config();

// Configure Winston logger
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ 
            filename: 'logs/error.log', 
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
        new winston.transports.File({ 
            filename: 'logs/combined.log',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        })
    ]
});

// Add console logging if not in production
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    }));
}

// Create logs directory if it doesn't exist
if (!fs.existsSync('logs')) {
    fs.mkdirSync('logs');
}

const app = express();
const port = process.env.PORT || 3000;
const DB_FILE = './database.sqlite';

// Redis setup with error handling
const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        logger.warn(`Redis connection attempt ${times} failed. Retrying in ${delay}ms`);
        return delay;
    },
    maxRetriesPerRequest: 3
});

redis.on('error', (err) => {
    logger.error('Redis error:', err);
});

redis.on('connect', () => {
    logger.info('Successfully connected to Redis');
});

// Cache configuration
const CACHE_TTL = 300; // 5 minutes in seconds
const VALID_PAGE_SIZES = [10, 25, 50, 100, 1000];
const DEFAULT_PAGE_SIZE = 25;

// Middleware
app.use(cors());
app.use(express.json());

// Request logging middleware
app.use(expressWinston.logger({
    winstonInstance: logger,
    meta: true,
    msg: 'HTTP {{req.method}} {{req.url}}',
    expressFormat: true,
    colorize: false,
}));

// Error logging middleware
app.use(expressWinston.errorLogger({
    winstonInstance: logger,
    meta: true,
}));

// Global error handler
app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({
        error: process.env.NODE_ENV === 'production' 
            ? 'An internal server error occurred' 
            : err.message
    });
});

// Check if database exists
const isNewDatabase = !fs.existsSync(DB_FILE);

// Database setup with error handling
const db = new sqlite3.Database(DB_FILE, async (err) => {
    if (err) {
        logger.error('Error connecting to the database:', err);
        process.exit(1); // Exit if we can't connect to the database
    } else {
        logger.info('Connected to SQLite database');
        try {
            await initializeDatabase();
            logger.info('Database initialization completed');
        } catch (error) {
            logger.error('Database initialization failed:', error);
            process.exit(1);
        }
    }
});

// Initialize database tables
async function initializeDatabase() {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            try {
                // Create products table
                db.run(`
                    CREATE TABLE IF NOT EXISTS products (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        item_code TEXT UNIQUE NOT NULL,
                        name TEXT NOT NULL,
                        unit_price_with_tax REAL,
                        barcodes TEXT,
                        warehouse_glaesibaer INTEGER DEFAULT 0,
                        warehouse_kringlan INTEGER DEFAULT 0,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `, (err) => {
                    if (err) {
                        logger.error('Error creating products table:', err);
                        reject(err);
                        return;
                    }
                    logger.info('Products table created or already exists');
                });

                // Create indexes for faster searching
                db.run('CREATE INDEX IF NOT EXISTS idx_item_code ON products(item_code)', err => {
                    if (err) logger.warn('Error creating item_code index:', err);
                    else logger.info('Item code index created or already exists');
                });
                db.run('CREATE INDEX IF NOT EXISTS idx_name ON products(name)', err => {
                    if (err) logger.warn('Error creating name index:', err);
                    else logger.info('Name index created or already exists');
                });
                db.run('CREATE INDEX IF NOT EXISTS idx_barcodes ON products(barcodes)', err => {
                    if (err) logger.warn('Error creating barcodes index:', err);
                    else logger.info('Barcodes index created or already exists');
                });

                if (isNewDatabase) {
                    logger.info('New database detected, fetching initial products...');
                    fetchAndStoreProducts()
                        .then(() => {
                            logger.info('Initial product sync completed');
                            resolve();
                        })
                        .catch(error => {
                            logger.error('Error during initial product sync:', error);
                            reject(error);
                        });
                } else {
                    resolve();
                }
            } catch (error) {
                logger.error('Error in database initialization:', error);
                reject(error);
            }
        });
    });
}

// Function to fetch and store products with error handling
async function fetchAndStoreProducts() {
    try {
        logger.info('Starting product fetch from API');
        const data = new FormData();
        const config = {
            method: 'get',
            maxBodyLength: Infinity,
            url: 'https://api.dkplus.is/api/v1/Product',
            headers: {
                'Authorization': 'Bearer 9fd1c68e-64bc-4930-921e-5dd45d1344f6',
                ...data.getHeaders()
            },
            data: data
        };

        const response = await axios.request(config);
        const products = response.data;
        logger.info(`Fetched ${products.length} products from API`);

        return new Promise((resolve, reject) => {
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');

                db.run('DELETE FROM products', [], (err) => {
                    if (err) {
                        logger.error('Error clearing products:', err);
                        db.run('ROLLBACK');
                        reject(err);
                        return;
                    }
                    logger.info('Cleared existing products');

                    const stmt = db.prepare(`
                        INSERT INTO products (
                            item_code, 
                            name, 
                            unit_price_with_tax, 
                            barcodes, 
                            warehouse_glaesibaer, 
                            warehouse_kringlan
                        ) VALUES (?, ?, ?, ?, ?, ?)
                    `);

                    let insertCount = 0;
                    products.forEach(product => {
                        try {
                            const description = product.Description || '';
                            const description2 = product.Description2 || '';
                            const extraDesc1 = product.ExtraDesc1 || '';

                            let name = description;
                            if (description2) {
                                name = `${description} ${description2}`.trim();
                            } else if (extraDesc1) {
                                name = `${description} ${extraDesc1}`.trim();
                            }

                            name = name.trim() || product.ItemCode || 'Unknown Product';
                            const barcodes = JSON.stringify(product.Barcodes?.map(b => b.Barcode) || []);
                            const warehouseBG1 = product.Warehouses?.find(w => w.Warehouse === 'bg1')?.QuantityInStock || 0;
                            const warehouseBG2 = product.Warehouses?.find(w => w.Warehouse === 'bg2')?.QuantityInStock || 0;

                            stmt.run(
                                product.ItemCode || '',
                                name,
                                product.UnitPrice1WithTax || 0,
                                barcodes,
                                warehouseBG1,
                                warehouseBG2
                            );
                            insertCount++;
                        } catch (error) {
                            logger.error(`Error processing product ${product.ItemCode}:`, error);
                        }
                    });

                    stmt.finalize();
                    db.run('COMMIT', (err) => {
                        if (err) {
                            logger.error('Error committing transaction:', err);
                            db.run('ROLLBACK');
                            reject(err);
                        } else {
                            logger.info(`Successfully inserted ${insertCount} products`);
                            resolve();
                        }
                    });
                });
            });
        });
    } catch (error) {
        logger.error('Error in fetchAndStoreProducts:', error);
        throw error;
    }
}

// Get all products with error handling
app.get('/api/products', async (req, res) => {
    try {
        const rows = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM products', [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        logger.info(`Retrieved ${rows.length} products`);
        res.json(rows);
    } catch (error) {
        logger.error('Error retrieving products:', error);
        res.status(500).json({ error: 'Error retrieving products' });
    }
});

// Search products with error handling
app.get('/api/products/search', async (req, res) => {
    const startTime = Date.now();
    try {
        const searchQuery = req.query.q?.trim();
        const page = Math.max(1, parseInt(req.query.page) || 1);
        let pageSize = parseInt(req.query.pageSize) || DEFAULT_PAGE_SIZE;
        
        if (!VALID_PAGE_SIZES.includes(pageSize)) {
            logger.warn(`Invalid page size requested: ${pageSize}, using default: ${DEFAULT_PAGE_SIZE}`);
            pageSize = DEFAULT_PAGE_SIZE;
        }
        
        if (!searchQuery) {
            return res.json({
                total: 0,
                page,
                pageSize,
                totalPages: 0,
                results: []
            });
        }

        const terms = searchQuery.split(/\s+/).filter(term => term.length > 0);
        logger.info(`Search request: query="${searchQuery}", terms=${terms.length}, page=${page}, pageSize=${pageSize}`);
        
        if (terms.length === 0) {
            return res.json({
                total: 0,
                page,
                pageSize,
                totalPages: 0,
                results: []
            });
        }

        // Try to get cached results
        const cacheKey = `search:${searchQuery}:page${page}:size${pageSize}`;
        try {
            const cachedResult = await redis.get(cacheKey);
            if (cachedResult) {
                logger.info(`Cache hit for key: ${cacheKey}`);
                const endTime = Date.now();
                logger.info(`Search completed in ${endTime - startTime}ms (cached)`);
                return res.json(JSON.parse(cachedResult));
            }
            logger.info(`Cache miss for key: ${cacheKey}`);
        } catch (error) {
            logger.error('Redis cache error:', error);
        }

        const offset = (page - 1) * pageSize;
        let countSql = 'SELECT COUNT(*) as total FROM products WHERE ';
        let sql = 'SELECT *, ';
        
        const relevanceTerms = terms.map((_, index) => {
            return `
                CASE 
                    WHEN item_code LIKE $${index * 3 + 1} THEN 100
                    WHEN item_code LIKE $${index * 3 + 2} THEN 50
                    WHEN name LIKE $${index * 3 + 2} THEN 40
                    WHEN barcodes LIKE $${index * 3 + 2} THEN 30
                    WHEN item_code LIKE $${index * 3 + 3} THEN 20
                    WHEN name LIKE $${index * 3 + 3} THEN 10
                    WHEN barcodes LIKE $${index * 3 + 3} THEN 5
                    ELSE 0
                END`;
        });

        sql += `(${relevanceTerms.join(' + ')}) as relevance `;
        sql += 'FROM products WHERE ';

        const conditions = terms.map((_, index) => {
            return `(
                item_code LIKE $${index * 3 + 1} OR 
                item_code LIKE $${index * 3 + 2} OR 
                item_code LIKE $${index * 3 + 3} OR
                name LIKE $${index * 3 + 2} OR 
                name LIKE $${index * 3 + 3} OR
                barcodes LIKE $${index * 3 + 2} OR 
                barcodes LIKE $${index * 3 + 3}
            )`;
        });

        const whereClause = conditions.join(' AND ');
        countSql += whereClause;
        sql += whereClause;
        sql += ' ORDER BY relevance DESC LIMIT ? OFFSET ?';

        const params = [];
        terms.forEach(term => {
            params.push(term);
            params.push(`%${term}%`);
            params.push(`%${term}`);
        });

        try {
            const totalCount = await new Promise((resolve, reject) => {
                db.get(countSql, params, (err, row) => {
                    if (err) reject(err);
                    else resolve(row.total);
                });
            });

            const searchParams = [...params, pageSize, offset];
            const rows = await new Promise((resolve, reject) => {
                db.all(sql, searchParams, (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });

            const totalPages = Math.ceil(totalCount / pageSize);
            const result = {
                total: totalCount,
                page,
                pageSize,
                totalPages,
                results: rows
            };

            try {
                await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(result));
                logger.info(`Cached results for key: ${cacheKey}`);
            } catch (error) {
                logger.error('Redis cache error:', error);
            }

            const endTime = Date.now();
            logger.info(`Search completed in ${endTime - startTime}ms with ${rows.length} results`);
            res.json(result);
        } catch (error) {
            logger.error('Search error:', error);
            throw error;
        }
    } catch (error) {
        logger.error('Search endpoint error:', error);
        res.status(500).json({ 
            error: process.env.NODE_ENV === 'production' 
                ? 'An error occurred while searching' 
                : error.message 
        });
    }
});

// Process termination handling
process.on('SIGTERM', () => {
    logger.info('SIGTERM received. Shutting down gracefully...');
    db.close(() => {
        logger.info('Database connection closed.');
        redis.quit(() => {
            logger.info('Redis connection closed.');
            process.exit(0);
        });
    });
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start server only if not in test environment
if (process.env.NODE_ENV !== 'test') {
    app.listen(port, () => {
        logger.info(`Server is running on port ${port}`);
    });
}

// Export for testing
module.exports = {
    app,
    redis,
    db
}; 