import request from 'supertest';
import { createSupplierApp } from '../suppliers/app';

const app = createSupplierApp({ chaos: false });
const query = { city: 'Paris', checkIn: '2026-10-01', checkOut: '2026-10-04' };

describe('mock supplier APIs', () => {
  it.each(['/supplierA/hotels', '/supplierB/hotels'])('%s returns a hotel list', async (path) => {
    const res = await request(app).get(path).query(query).expect(200);
    expect(res.body.hotels.length).toBeGreaterThan(0);
    for (const hotel of res.body.hotels) {
      expect(hotel).toEqual(
        expect.objectContaining({
          hotelId: expect.any(String),
          name: expect.any(String),
          price: expect.any(Number),
        }),
      );
    }
  });

  it('validates required query params', async () => {
    await request(app).get('/supplierA/hotels').query({ city: 'Paris' }).expect(400);
  });

  it('returns an empty list for behavior=empty', async () => {
    const res = await request(app).get('/supplierA/hotels').query({ ...query, behavior: 'empty' }).expect(200);
    expect(res.body.hotels).toEqual([]);
  });

  it('returns 500 for behavior=error', async () => {
    await request(app).get('/supplierB/hotels').query({ ...query, behavior: 'error' }).expect(500);
  });

  it('prices are deterministic per city and differ between cities', async () => {
    const paris = await request(app).get('/supplierA/hotels').query(query).expect(200);
    const parisAgain = await request(app).get('/supplierA/hotels').query(query).expect(200);
    const rome = await request(app).get('/supplierA/hotels').query({ ...query, city: 'Rome' }).expect(200);

    expect(paris.body.hotels).toEqual(parisAgain.body.hotels);
    expect(rome.body.hotels).not.toEqual(paris.body.hotels);
  });

  it('behavior=tie makes both suppliers quote the same price', async () => {
    const a = await request(app).get('/supplierA/hotels').query({ ...query, behavior: 'tie' }).expect(200);
    const b = await request(app).get('/supplierB/hotels').query({ ...query, behavior: 'tie' }).expect(200);
    expect(a.body.hotels[0].price).toBe(b.body.hotels[0].price);
  });

  it('behavior=flaky fails twice and then succeeds', async () => {
    const flaky = { ...query, behavior: 'flaky', flakyKey: 'unit-test' };
    await request(app).get('/supplierA/hotels').query(flaky).expect(503);
    await request(app).get('/supplierA/hotels').query(flaky).expect(503);
    const res = await request(app).get('/supplierA/hotels').query(flaky).expect(200);
    expect(res.body.attempt).toBe(3);
    expect(res.body.hotels.length).toBeGreaterThan(0);
  });
});
