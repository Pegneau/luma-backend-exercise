let events = [];
let nextId = 1;

function getAllEvents() {
  return events;
}

function getEventById(id) {
  return events.find((e) => e.id === id) || null;
}

function createEvent(data) {
  const event = { id: nextId++, ...data };
  events.push(event);
  return event;
}

function updateEvent(id, data) {
  const index = events.findIndex((e) => e.id === id);
  if (index === -1) return null;
  events[index] = { ...events[index], ...data };
  return events[index];
}

function deleteEvent(id) {
  const index = events.findIndex((e) => e.id === id);
  if (index === -1) return null;
  const [removed] = events.splice(index, 1);
  return removed;
}

function _reset() {
  events = [];
  nextId = 1;
}

module.exports = { getAllEvents, getEventById, createEvent, updateEvent, deleteEvent, _reset };
