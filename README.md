# luma-backend-exercise

Luma take-home backend exercise — a REST API for managing events.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- npm

### Installation

```bash
npm install
```

### Running the server

```bash
# Production
npm start

# Development (with auto-reload)
npm run dev
```

The server starts on `http://localhost:3000` by default. Set the `PORT` environment variable to override.

### Running tests

```bash
npm test
```

## API

| Method | Endpoint       | Description          |
|--------|---------------|----------------------|
| GET    | /events        | List all events      |
| POST   | /events        | Create a new event   |
| GET    | /events/:id    | Get event by ID      |
| PUT    | /events/:id    | Update event by ID   |
| DELETE | /events/:id    | Delete event by ID   |

### Event object

```json
{
  "id": 1,
  "name": "Luma Launch",
  "description": "Welcome event",
  "date": "2026-06-01"
}
```

`name` and `date` are required when creating an event.

## Project structure

```
src/
  app.js          # Express app setup
  index.js        # Server entry point
  routes/
    events.js     # Event routes
  controllers/
    events.js     # Route handlers
  models/
    event.js      # In-memory data store
tests/
  events.test.js  # Integration tests
```
