const request = require('supertest');
const { app } = require('../src/server');
const { clearDatabase, seedDatabase } = require('./helpers/db');

let server;

const testProducts = [
    {
        item_code: 'TEST001',
        name: 'Test Product 1',
        unit_price_with_tax: 1000,
        barcodes: ['1234567890'],
        warehouse_glaesibaer: 5,
        warehouse_kringlan: 3
    },
    {
        item_code: 'TEST002',
        name: 'Blue Test Shirt',
        unit_price_with_tax: 2000,
        barcodes: ['0987654321'],
        warehouse_glaesibaer: 2,
        warehouse_kringlan: 4
    }
];

beforeAll((done) => {
    server = app.listen(0, () => {
        clearDatabase()
            .then(() => seedDatabase(testProducts))
            .then(() => done())
            .catch(done);
    });
});

afterAll((done) => {
    if (server) {
        server.close(() => {
            done();
        });
    } else {
        done();
    }
});

describe('API Endpoints', () => {
    describe('GET /api/products', () => {
        it('should return all products', (done) => {
            request(server)
                .get('/api/products')
                .expect('Content-Type', /json/)
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    expect(Array.isArray(res.body)).toBeTruthy();
                    expect(res.body).toHaveLength(2);
                    expect(res.body[0]).toHaveProperty('item_code', 'TEST001');
                    expect(res.body[1]).toHaveProperty('item_code', 'TEST002');
                    done();
                });
        });
    });

    describe('GET /api/products/search', () => {
        it('should return empty results for empty query', (done) => {
            request(server)
                .get('/api/products/search')
                .query({ q: '' })
                .expect('Content-Type', /json/)
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.body).toEqual({
                        total: 0,
                        page: 1,
                        pageSize: 25,
                        totalPages: 0,
                        results: [],
                    });
                    done();
                });
        });

        it('should return paginated results for valid query', (done) => {
            request(server)
                .get('/api/products/search')
                .query({ q: 'test', page: 1, pageSize: 10 })
                .expect('Content-Type', /json/)
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.body).toHaveProperty('total', 2);
                    expect(res.body).toHaveProperty('page', 1);
                    expect(res.body).toHaveProperty('pageSize', 10);
                    expect(res.body).toHaveProperty('totalPages', 1);
                    expect(res.body.results).toHaveLength(2);
                    done();
                });
        });

        it('should handle invalid page size', (done) => {
            request(server)
                .get('/api/products/search')
                .query({ q: 'test', pageSize: 999 })
                .expect('Content-Type', /json/)
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.body.pageSize).toBe(25); // Default page size
                    done();
                });
        });

        it('should find products by specific terms', (done) => {
            request(server)
                .get('/api/products/search')
                .query({ q: 'blue shirt' })
                .expect('Content-Type', /json/)
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.body.total).toBe(1);
                    expect(res.body.results[0]).toHaveProperty('item_code', 'TEST002');
                    done();
                });
        });
    });
});