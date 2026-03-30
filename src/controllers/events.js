const Event = require('../models/event');

function listEvents(req, res) {
  res.json(Event.getAllEvents());
}

function getEvent(req, res) {
  const id = parseInt(req.params.id, 10);
  const event = Event.getEventById(id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  res.json(event);
}

function createEvent(req, res) {
  const { name, description, date } = req.body;
  if (!name || !date) {
    return res.status(400).json({ error: 'name and date are required' });
  }
  const event = Event.createEvent({ name, description, date });
  res.status(201).json(event);
}

function updateEvent(req, res) {
  const id = parseInt(req.params.id, 10);
  const { name, description, date } = req.body;
  const event = Event.updateEvent(id, { name, description, date });
  if (!event) return res.status(404).json({ error: 'Event not found' });
  res.json(event);
}

function deleteEvent(req, res) {
  const id = parseInt(req.params.id, 10);
  const event = Event.deleteEvent(id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  res.status(204).send();
}

module.exports = { listEvents, getEvent, createEvent, updateEvent, deleteEvent };
