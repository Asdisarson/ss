const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const Redis = require('ioredis');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
const DB_FILE = './database.sqlite';

// Redis setup
const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,  // Will be ignored if not set
    retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
    }
});

redis.on('error', (err) => {
    console.error('Redis error:', err);
});

// Cache configuration
const CACHE_TTL = 300; // 5 minutes in seconds
const VALID_PAGE_SIZES = [10, 25, 50, 100, 1000];
const DEFAULT_PAGE_SIZE = 25;

// Middleware
app.use(cors());
app.use(express.json());

// Check if database exists
const isNewDatabase = !fs.existsSync(DB_FILE);

// Database setup
const db = new sqlite3.Database(DB_FILE, async (err) => {
    if (err) {
        console.error('Error connecting to the database:', err);
    } else {
        console.log('Connected to SQLite database');
        await initializeDatabase();
    }
});

// Initialize database tables
async function initializeDatabase() {
    return new Promise((resolve, reject) => {
        // Create products table
        db.serialize(() => {
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
            });

            // Create indexes for faster searching
            db.run('CREATE INDEX IF NOT EXISTS idx_item_code ON products(item_code)');
            db.run('CREATE INDEX IF NOT EXISTS idx_name ON products(name)');
            db.run('CREATE INDEX IF NOT EXISTS idx_barcodes ON products(barcodes)');

            // If this is a new database, fetch products
            if (isNewDatabase) {
                console.log('New database detected, fetching initial products...');
                fetchAndStoreProducts()
                    .then(() => {
                        console.log('Initial product sync completed');
                        resolve();
                    })
                    .catch(error => {
                        console.error('Error during initial product sync:', error);
                        reject(error);
                    });
            } else {
                resolve();
            }
        });
    });
}

// Function to fetch and store products
async function fetchAndStoreProducts() {
    try {
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

        // Begin transaction
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');

            // Clear existing products
            db.run('DELETE FROM products', [], (err) => {
                if (err) {
                    console.error('Error clearing products:', err);
                    db.run('ROLLBACK');
                    return;
                }

                // Prepare insert statement
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

                // Insert each product
                products.forEach(product => {
                    // Handle null/undefined values for name components
                    const description = product.Description || '';
                    const description2 = product.Description2 || '';
                    const extraDesc1 = product.ExtraDesc1 || '';

                    // Build name with fallbacks
                    let name = description;
                    if (description2) {
                        name = `${description} ${description2}`.trim();
                    } else if (extraDesc1) {
                        name = `${description} ${extraDesc1}`.trim();
                    }

                    // If name is still empty, use item code or 'Unknown Product'
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
                });

                stmt.finalize();
                db.run('COMMIT');
            });
        });

        return { success: true, message: 'Products updated successfully' };
    } catch (error) {
        console.error('Error fetching products:', error);
        return { success: false, message: error.message };
    }
}

// Get all products
app.get('/api/products', (req, res) => {
    db.all('SELECT * FROM products', [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// Search products
app.get('/api/products/search', async (req, res) => {
    const searchQuery = req.query.q?.trim();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    let pageSize = parseInt(req.query.pageSize) || DEFAULT_PAGE_SIZE;
    
    // Validate page size
    if (!VALID_PAGE_SIZES.includes(pageSize)) {
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

    // Split search terms
    const terms = searchQuery.split(/\s+/).filter(term => term.length > 0);
    
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
            return res.json(JSON.parse(cachedResult));
        }
    } catch (error) {
        console.error('Redis cache error:', error);
        // Continue without cache if Redis fails
    }

    // Calculate offset for pagination
    const offset = (page - 1) * pageSize;

    // Build the SQL query dynamically
    let countSql = 'SELECT COUNT(*) as total FROM products WHERE ';
    let sql = 'SELECT *, ';
    
    // Add relevance scoring for each term
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

    // Add search conditions for each term
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

    // Prepare parameters for the query
    const params = [];
    terms.forEach(term => {
        params.push(term); // Exact match
        params.push(`%${term}%`); // Contains
        params.push(`%${term}`); // Ends with
    });

    try {
        // Get total count first
        const totalCount = await new Promise((resolve, reject) => {
            db.get(countSql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row.total);
            });
        });

        // Then get paginated results
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

        // Cache the results
        try {
            await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(result));
        } catch (error) {
            console.error('Redis cache error:', error);
            // Continue without cache if Redis fails
        }

        res.json(result);
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Start server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
}); 