const express = require('express');
const eventsRouter = require('./routes/events');

const app = express();

app.use(express.json());

app.use('/events', eventsRouter);

module.exports = app;
