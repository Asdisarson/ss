process.env.NODE_ENV = 'test';
process.env.PORT = 3001;
process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = 6379;
process.env.LOG_LEVEL = 'error';
process.env.DB_FILE = ':memory:'; // Use in-memory SQLite for tests

const { redis, db } = require('../src/server');

// Increase the timeout for tests
jest.setTimeout(10000);

// Clean up function
afterAll(async (done) => {
    try {
        // Close Redis connection
        if (redis) {
            await redis.quit();
        }
        
        // Close database connection
        if (db) {
            await new Promise((resolve, reject) => {
                db.close((err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        }
        done();
    } catch (error) {
        done(error);
    }
}); 