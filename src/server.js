const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
const DB_FILE = './database.sqlite';

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
        `, async (err) => {
            if (err) {
                console.error('Error creating products table:', err);
                reject(err);
                return;
            }

            // If this is a new database, fetch products
            if (isNewDatabase) {
                console.log('New database detected, fetching initial products...');
                try {
                    await fetchAndStoreProducts();
                    console.log('Initial product sync completed');
                } catch (error) {
                    console.error('Error during initial product sync:', error);
                }
            }

            resolve();
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

// Start server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
}); 