const express = require('express');
const router = express.Router();
const Item = require('../models/Item');
const List = require('../models/List');

// Create a new item
router.post('/', async (req, res) => {
  try {
    const { content, listId } = req.body;

    const list = await List.findById(listId);
    if (!list) {
      return res.status(404).json({ error: 'List not found' });
    }

    const newItem = new Item({ content, listId });
    await newItem.save();
    res.status(201).json(newItem);
  } catch (error) {
    res.status(500).json({ error: 'Error creating item' });
  }
});

// Edit an item
router.put('/:id', async (req, res) => {
  try {
    const { content } = req.body;
    const item = await Item.findById(req.params.id);

    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    item.content = content;
    await item.save();
    res.json(item);
  } catch (error) {
    res.status(500).json({ error: 'Error updating item' });
  }
});

// Delete an item
router.delete('/:id', async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);

    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    await item.deleteOne();
    res.json({ message: 'Item deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting item' });
  }
});

// Get all items for a specific list
router.get('/list/:listId', async (req, res) => {
  try {
    const { listId } = req.params;

    const list = await List.findById(listId);
    if (!list) {
      return res.status(404).json({ error: 'List not found' });
    }

    const items = await Item.find({ listId });
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching items' });
  }
});

module.exports = router;
