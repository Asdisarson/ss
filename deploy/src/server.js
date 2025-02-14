const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const Redis = require('ioredis');
const path = require('path');
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
            url: 'https://api.dkplus.is/api/v1/Product',
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
                            item_code, 
                            name, 
                            unit_price_with_tax, 
                            barcodes, 
                            warehouse_glaesibaer, 
                            warehouse_kringlan
                        ) VALUES (?, ?, ?, ?, ?, ?)
                    `);

                    let insertCount = 0;
                    products.forEach((product) => {
                        try {
                            const description = product.Description || '';
                            const description2 = product.Description2 || '';
                            const extraDesc1 = product.ExtraDesc1 || '';

                            let name = description;
                            if (description2) {
                                name = `${description} ${description2}`.trim();
                            } else if (extraDesc1) {
                                name = `${extraDesc1}`.trim();
                            }

                            name = name.trim() || product.ItemCode || 'Unknown Product';
                            const barcodes = JSON.stringify(product.Barcodes?.map((b) => b.Barcode) || []);
                            const warehouseBG1 = product.Warehouses?.find((w) => w.Warehouse == 'bg1')
                                ?.QuantityInStock || 0;
                            const warehouseBG2 = product.Warehouses?.find((w) => w.Warehouse == 'bg2')
                                ?.QuantityInStock || 0;

                            stmt.run(
                                product.ItemCode || '',
                                name,
                                product.UnitPrice1WithTax || 0,
                                barcodes,
                                warehouseBG1,
                                warehouseBG2,
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

// Redis setup with error handling
const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        log('warn', `Redis connection attempt ${times} failed. Retrying in ${delay}ms`);
        return delay;
    },
    maxRetriesPerRequest: 3,
});

redis.on('error', (err) => {
    log('error', 'Redis error:', err);
});

redis.on('connect', () => {
    log('info', 'Successfully connected to Redis');
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
app.get('/api/search', (req, res) => {
    const searchTerm = req.query.q?.trim() || '';
    const cacheKey = `search:${searchTerm}`;

    // Only search if we have 2 or more characters
    if (searchTerm.length < 2) {
        return res.json([]);
    }

    redis.get(cacheKey, (err, cachedResult) => {
        if (err) {
            log('error', 'Redis error:', err);
        } else if (cachedResult) {
            return res.json(JSON.parse(cachedResult));
        }

        // Split search terms and create pattern variations for fuzzy matching
        const terms = searchTerm.toLowerCase().split(/\s+/).filter(Boolean);
        const fuzzyTerms = terms.map(term => {
            // Create variations with 1 character difference
            const variations = [];
            for (let i = 0; i < term.length; i++) {
                variations.push(term.slice(0, i) + '%' + term.slice(i));
            }
            return variations;
        }).flat();

        // Build dynamic query with enhanced scoring
        const query = `
            WITH scored_products AS (
                SELECT 
                    item_code,
                    name,
                    unit_price_with_tax,
                    barcodes,
                    warehouse_glaesibaer,
                    warehouse_kringlan,
                    (
                        CASE
                            -- Exact matches (highest priority)
                            WHEN LOWER(item_code) = LOWER(?) THEN 2000
                            WHEN barcodes LIKE ? THEN 1500
                            WHEN LOWER(name) = LOWER(?) THEN 1000
                            -- Starts with matches
                            WHEN LOWER(item_code) LIKE LOWER(?) || '%' THEN 800
                            WHEN LOWER(name) LIKE LOWER(?) || '%' THEN 600
                            -- Word boundary matches in name
                            WHEN LOWER(name) LIKE '% ' || LOWER(?) || ' %' THEN 500
                            WHEN LOWER(name) LIKE '% ' || LOWER(?) || '%' THEN 450
                            WHEN LOWER(name) LIKE '%' || LOWER(?) || ' %' THEN 450
                            -- Contains matches
                            WHEN LOWER(item_code) LIKE '%' || LOWER(?) || '%' THEN 400
                            WHEN barcodes LIKE '%' || ? || '%' THEN 300
                            WHEN LOWER(name) LIKE '%' || LOWER(?) || '%' THEN 200
                            -- Fuzzy matches
                            ${fuzzyTerms.map(() => `
                                WHEN LOWER(item_code) LIKE ? THEN 100
                                WHEN LOWER(name) LIKE ? THEN 50
                            `).join('\n')}
                            ELSE 0
                        END +
                        -- Additional points for each term match in name
                        CASE 
                            WHEN ${terms.map(() => `LOWER(name) LIKE '%' || LOWER(?) || '%'`).join(' AND ')}
                            THEN ${terms.length * 100}
                            ELSE 0
                        END
                    ) as base_score,
                    -- Store match positions for highlighting
                    LOWER(name) as name_lower
                FROM products
                WHERE 
                    LOWER(item_code) LIKE '%' || LOWER(?) || '%'
                    OR barcodes LIKE '%' || ? || '%'
                    OR LOWER(name) LIKE '%' || LOWER(?) || '%'
                    ${fuzzyTerms.map(() => `
                        OR LOWER(item_code) LIKE ?
                        OR LOWER(name) LIKE ?
                    `).join('\n')}
                    -- Additional term-specific matches
                    OR (${terms.map(() => `LOWER(name) LIKE '%' || LOWER(?) || '%'`).join(' OR ')})
            )
            SELECT 
                item_code,
                name,
                unit_price_with_tax,
                barcodes,
                warehouse_glaesibaer,
                warehouse_kringlan,
                base_score as relevance,
                name_lower
            FROM scored_products
            WHERE base_score > 0
            ORDER BY base_score DESC, item_code ASC
            LIMIT 100`;

        // Prepare parameters for the query
        const baseParams = [
            searchTerm, // Exact item_code match
            `%"${searchTerm}"%`, // Exact barcode match
            searchTerm, // Exact name match
            searchTerm, // Starts with item_code
            searchTerm, // Starts with name
            searchTerm, // Word boundary start
            searchTerm, // Word boundary end
            searchTerm, // Word boundary middle
            searchTerm, // Contains item_code
            searchTerm, // Contains barcode
            searchTerm, // Contains name
        ];

        // Add fuzzy match parameters
        const fuzzyParams = fuzzyTerms.flatMap(term => [term, term]);

        // Add term match bonus parameters
        const termParams = terms.map(term => term);

        // Add WHERE clause parameters
        const whereParams = [
            searchTerm, // LIKE item_code
            searchTerm, // LIKE barcode
            searchTerm, // LIKE name
            ...fuzzyTerms.flatMap(term => [term, term]), // Fuzzy matches
            ...terms // Term-specific matches
        ];

        const params = [...baseParams, ...fuzzyParams, ...termParams, ...whereParams];
        
        db.all(query, params, (dbErr, rows) => {
            if (dbErr) {
                log('error', 'Search error:', dbErr);
                return res.status(500).json({ error: 'Database error' });
            }

            // Cache results for 5 minutes
            redis.setex(cacheKey, 300, JSON.stringify(rows))
                .catch((redisErr) => log('error', 'Redis cache error:', redisErr));

            res.json(rows);
        });
    });
});

// Start server
app.listen(port, () => {
    log('info', `Server is running on http://localhost:${port}`);
});

// Process termination handling
process.on('SIGTERM', () => {
    log('info', 'SIGTERM received. Shutting down gracefully...');
    db.close(() => {
        log('info', 'Database connection closed.');
        redis.quit(() => {
            log('info', 'Redis connection closed.');
            process.exit(0);
        });
    });
});

// Export for testing
module.exports = { app, redis, db }; 