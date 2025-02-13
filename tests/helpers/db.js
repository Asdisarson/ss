const { db } = require('../../src/server');

const clearDatabase = () => {
    return new Promise((resolve, reject) => {
        db.run('DELETE FROM products', (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
};

const seedDatabase = (products) => {
    return new Promise((resolve, reject) => {
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

        products.forEach((product) => {
            stmt.run(
                product.item_code,
                product.name,
                product.unit_price_with_tax,
                JSON.stringify(product.barcodes || []),
                product.warehouse_glaesibaer || 0,
                product.warehouse_kringlan || 0
            );
        });

        stmt.finalize((err) => {
            if (err) reject(err);
            else resolve();
        });
    });
};

module.exports = {
    clearDatabase,
    seedDatabase,
}; 