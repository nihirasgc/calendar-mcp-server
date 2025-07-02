const express = require('express');
const router = express.Router();
const List = require('../models/List');

// Create a new list
router.post('/', async (req, res) => {
  try {
    const { name, description, userId } = req.body; // Accept userId directly from the request
    const newList = new List({ name, description, userId });
    await newList.save();
    res.status(201).json(newList);
  } catch (error) {
    res.status(500).json({ error: 'Error creating list' });
  }
});

// Edit a list
router.put('/:id', async (req, res) => {
  try {
    const { name, description } = req.body;

    const updatedList = await List.findByIdAndUpdate(
      req.params.id,
      { name, description },
      { new: true }
    );
    res.json(updatedList);
  } catch (error) {
    res.status(500).json({ error: 'Error updating list' });
  }
});

// Delete a list
router.delete('/:id', async (req, res) => {
  try {
    await List.findByIdAndDelete(req.params.id);
    res.json({ message: 'List deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting list' });
  }
});

// Get all lists
router.get('/', async (req, res) => {
  try {
    const lists = await List.find(); // No filtering by user
    res.json(lists);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching lists' });
  }
});

module.exports = router;
