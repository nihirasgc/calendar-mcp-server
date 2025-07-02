const express = require('express');
const router = express.Router();
const List = require('../models/List');
const Item = require('../models/Item');
const Event = require('../models/Event');

// POST /api/mcp/parse
router.post('/parse', async (req, res) => {
  const { prompt } = req.body;

  try {
    const lowerPrompt = prompt.toLowerCase();
    const responseMessages = [];

    // === CREATE LIST WITH TASKS ===
    const listWithTasksMatch = prompt.match(/(?:create|make) a list called (.+?) with tasks (.+)/i);
    if (listWithTasksMatch) {
      const listName = listWithTasksMatch[1].trim();
      const tasks = listWithTasksMatch[2].split(',').map(task => task.trim());

      const newList = new List({ name: listName, userId: process.env.MCP_USER_ID });
      await newList.save();

      for (const task of tasks) {
        const newItem = new Item({ content: task, listId: newList._id });
        await newItem.save();
      }

      responseMessages.push(`List "${listName}" created with tasks: ${tasks.join(', ')}`);
    }

    // === ADD ITEM TO LIST ===
    const itemMatch = prompt.match(/add item (.+?) to (.+)/i);
    if (itemMatch) {
      const content = itemMatch[1].trim();
      const listName = itemMatch[2].trim();

      const list = await List.findOne({ name: listName });
      if (!list) return res.status(404).json({ error: 'List not found' });

      const newItem = new Item({ content, listId: list._id });
      await newItem.save();

      responseMessages.push(`Item "${content}" added to list "${list.name}".`);
    }

    // === CREATE EVENT ===
    const eventMatch = prompt.match(/(?:create|schedule) an event called (.+?) on (.+?)(?: and assign the list)?$/i);
    if (eventMatch) {
      const title = eventMatch[1].trim();
      const dateRange = eventMatch[2].trim();

      const timeMatch = dateRange.match(/(.+?) (\d+(?:AM|PM)) to (\d+(?:AM|PM))/i);
      if (!timeMatch) return res.status(400).json({ error: 'Unable to parse date and time.' });

      const [_, dateStr, startTime, endTime] = timeMatch;
      const fullDate = new Date(`${dateStr} ${new Date().getFullYear()}`);

      const startDate = new Date(`${fullDate.toDateString()} ${startTime}`);
      const endDate = new Date(`${fullDate.toDateString()} ${endTime}`);

      // Link most recent list if mentioned
      let linkedList = null;
      if (lowerPrompt.includes('assign the list')) {
        linkedList = await List.findOne().sort({ createdAt: -1 });
      }

      const newEvent = new Event({
        title,
        startDate,
        endDate,
        ownerId: 'dummy-owner-id',
        list: linkedList ? linkedList._id : undefined
      });

      await newEvent.save();

      responseMessages.push(`Event "${title}" created on ${dateStr} from ${startTime} to ${endTime}${linkedList ? ` and linked to list "${linkedList.name}"` : ''}.`);
    }

    if (responseMessages.length === 0) {
      return res.status(400).json({ error: 'Prompt format not recognized.' });
    }

    res.json({ success: true, messages: responseMessages });

  } catch (err) {
    console.error('MCP Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
