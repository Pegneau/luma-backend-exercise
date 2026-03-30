const request = require('supertest');
const app = require('../src/app');
const Event = require('../src/models/event');

beforeEach(() => {
  Event._reset();
});

describe('GET /events', () => {
  it('returns an empty array when no events exist', async () => {
    const res = await request(app).get('/events');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('POST /events', () => {
  it('creates a new event', async () => {
    const res = await request(app)
      .post('/events')
      .send({ name: 'Luma Launch', date: '2026-06-01', description: 'Welcome event' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 1, name: 'Luma Launch', date: '2026-06-01' });
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app).post('/events').send({ date: '2026-06-01' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when date is missing', async () => {
    const res = await request(app).post('/events').send({ name: 'Test Event' });
    expect(res.status).toBe(400);
  });
});

describe('GET /events/:id', () => {
  it('returns a single event by id', async () => {
    await request(app).post('/events').send({ name: 'Event A', date: '2026-07-01' });
    const res = await request(app).get('/events/1');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, name: 'Event A' });
  });

  it('returns 404 for a non-existent event', async () => {
    const res = await request(app).get('/events/999');
    expect(res.status).toBe(404);
  });
});

describe('PUT /events/:id', () => {
  it('updates an existing event', async () => {
    await request(app).post('/events').send({ name: 'Original', date: '2026-08-01' });
    const res = await request(app)
      .put('/events/1')
      .send({ name: 'Updated', date: '2026-09-01' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, name: 'Updated', date: '2026-09-01' });
  });

  it('returns 404 when updating a non-existent event', async () => {
    const res = await request(app).put('/events/999').send({ name: 'X', date: '2026-01-01' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /events/:id', () => {
  it('deletes an existing event', async () => {
    await request(app).post('/events').send({ name: 'To delete', date: '2026-10-01' });
    const res = await request(app).delete('/events/1');
    expect(res.status).toBe(204);
  });

  it('returns 404 when deleting a non-existent event', async () => {
    const res = await request(app).delete('/events/999');
    expect(res.status).toBe(404);
  });
});
