const { Router } = require('express');
const controller = require('../controllers/events');

const router = Router();

router.get('/', controller.listEvents);
router.get('/:id', controller.getEvent);
router.post('/', controller.createEvent);
router.put('/:id', controller.updateEvent);
router.delete('/:id', controller.deleteEvent);

module.exports = router;
