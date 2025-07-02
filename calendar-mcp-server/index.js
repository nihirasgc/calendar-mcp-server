#!/usr/bin/env node
import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import mongoose from 'mongoose';

// Import your models
import Event from './models/Event.js';
import List from './models/List.js';
import Item from './models/Item.js';

class CalendarMCPServer {
  constructor() {
    this.server = new Server(
      {
        name: 'calendar-mcp-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Store pending operations for confirmation
    this.pendingOperations = new Map();
    this.operationCounter = 0;

    this.setupToolHandlers();
  }

  setupToolHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          // Confirmation tool
          {
            name: 'confirm_operation',
            description: 'Confirm a pending operation',
            inputSchema: {
              type: 'object',
              properties: {
                operationId: { type: 'string', description: 'Operation ID to confirm (optional if using natural language)' },
                confirm: { type: 'boolean', description: 'Whether to proceed with the operation' },
                response: { type: 'string', description: 'Natural language response like "yes", "no", "confirm", "cancel"' }
              },
              required: []
            }
          },

          // Event CRUD operations
          {
            name: 'create_event',
            description: 'Create a new event',
            inputSchema: {
              type: 'object',
              properties: {
                calendarId: { type: 'string', description: 'Calendar ID' },
                ownerId: { type: 'string', description: 'Owner ID' },
                title: { type: 'string', description: 'Event title' },
                startDate: { type: 'string', format: 'date-time', description: 'Start date' },
                endDate: { type: 'string', format: 'date-time', description: 'End date' },
                description: { type: 'string', description: 'Event description' },
                location: { type: 'string', description: 'Event location' },
                isAllDay: { type: 'boolean', description: 'Is all day event' },
                recurrenceRule: { type: 'string', description: 'Recurrence rule' },
                recurrenceExceptions: { type: 'array', items: { type: 'string' }, description: 'Recurrence exceptions' },
                status: { type: 'string', enum: ['confirmed', 'tentative', 'cancelled'], description: 'Event status' },
                tags: { type: 'array', items: { type: 'string' }, description: 'Event tags' },
                attendees: { type: 'array', items: { type: 'string' }, description: 'Attendee emails or IDs' },
                listId: { type: 'string', description: 'Optional: Assign event to a list' }
              },
              required: ['calendarId', 'ownerId', 'title', 'startDate', 'endDate']
            }
          },
          {
            name: 'get_events',
            description: 'Get events with optional filters',
            inputSchema: {
              type: 'object',
              properties: {
                calendarId: { type: 'string', description: 'Filter by calendar ID' },
                ownerId: { type: 'string', description: 'Filter by owner ID' },
                startDate: { type: 'string', format: 'date-time', description: 'Filter events from this date' },
                endDate: { type: 'string', format: 'date-time', description: 'Filter events until this date' },
                status: { type: 'string', enum: ['confirmed', 'tentative', 'cancelled'], description: 'Filter by status' },
                tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
                listId: { type: 'string', description: 'Filter events assigned to a specific list' }
              }
            }
          },
          {
            name: 'update_event',
            description: 'Update an existing event',
            inputSchema: {
              type: 'object',
              properties: {
                eventId: { type: 'string', description: 'Event ID to update' },
                calendarId: { type: 'string', description: 'Calendar ID' },
                ownerId: { type: 'string', description: 'Owner ID' },
                title: { type: 'string', description: 'Event title' },
                startDate: { type: 'string', format: 'date-time', description: 'Start date' },
                endDate: { type: 'string', format: 'date-time', description: 'End date' },
                description: { type: 'string', description: 'Event description' },
                location: { type: 'string', description: 'Event location' },
                isAllDay: { type: 'boolean', description: 'Is all day event' },
                recurrenceRule: { type: 'string', description: 'Recurrence rule' },
                recurrenceExceptions: { type: 'array', items: { type: 'string' }, description: 'Recurrence exceptions' },
                status: { type: 'string', enum: ['confirmed', 'tentative', 'cancelled'], description: 'Event status' },
                tags: { type: 'array', items: { type: 'string' }, description: 'Event tags' },
                attendees: { type: 'array', items: { type: 'string' }, description: 'Attendee emails or IDs' },
                listId: { type: 'string', description: 'Assign event to a list' }
              },
              required: ['eventId']
            }
          },
          {
            name: 'delete_event',
            description: 'Delete an event',
            inputSchema: {
              type: 'object',
              properties: {
                eventId: { type: 'string', description: 'Event ID to delete' }
              },
              required: ['eventId']
            }
          },

          // List CRUD operations
          {
            name: 'create_list',
            description: 'Create a new list',
            inputSchema: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'List name' },
                description: { type: 'string', description: 'List description' },
                userId: { type: 'string', description: 'User ID who owns the list' }
              },
              required: ['name', 'userId']
            }
          },
          {
            name: 'get_lists',
            description: 'Get lists with optional filters',
            inputSchema: {
              type: 'object',
              properties: {
                userId: { type: 'string', description: 'Filter by user ID' },
                name: { type: 'string', description: 'Filter by list name' }
              }
            }
          },
          {
            name: 'update_list',
            description: 'Update an existing list',
            inputSchema: {
              type: 'object',
              properties: {
                listId: { type: 'string', description: 'List ID to update' },
                name: { type: 'string', description: 'List name' },
                description: { type: 'string', description: 'List description' }
              },
              required: ['listId']
            }
          },
          {
            name: 'delete_list',
            description: 'Delete a list and optionally its items',
            inputSchema: {
              type: 'object',
              properties: {
                listId: { type: 'string', description: 'List ID to delete' },
                deleteItems: { type: 'boolean', description: 'Whether to delete associated items', default: false }
              },
              required: ['listId']
            }
          },

          // Item CRUD operations
          {
            name: 'create_item',
            description: 'Create a new item in a list',
            inputSchema: {
              type: 'object',
              properties: {
                content: { type: 'string', description: 'Item content/description' },
                listId: { type: 'string', description: 'List ID to add item to' }
              },
              required: ['content', 'listId']
            }
          },
          {
            name: 'get_items',
            description: 'Get items with optional filters',
            inputSchema: {
              type: 'object',
              properties: {
                listId: { type: 'string', description: 'Filter by list ID' },
                content: { type: 'string', description: 'Search by content' }
              }
            }
          },
          {
            name: 'update_item',
            description: 'Update an existing item',
            inputSchema: {
              type: 'object',
              properties: {
                itemId: { type: 'string', description: 'Item ID to update' },
                content: { type: 'string', description: 'Item content/description' }
              },
              required: ['itemId']
            }
          },
          {
            name: 'delete_item',
            description: 'Delete an item',
            inputSchema: {
              type: 'object',
              properties: {
                itemId: { type: 'string', description: 'Item ID to delete' }
              },
              required: ['itemId']
            }
          },

          // Relationship operations
          {
            name: 'assign_list_to_event',
            description: 'Assign a list to an event',
            inputSchema: {
              type: 'object',
              properties: {
                eventId: { type: 'string', description: 'Event ID' },
                listId: { type: 'string', description: 'List ID to assign' }
              },
              required: ['eventId', 'listId']
            }
          },
          {
            name: 'unassign_list_from_event',
            description: 'Remove list assignment from an event',
            inputSchema: {
              type: 'object',
              properties: {
                eventId: { type: 'string', description: 'Event ID' }
              },
              required: ['eventId']
            }
          },
          {
            name: 'get_event_with_list_and_items',
            description: 'Get event with its assigned list and all items in that list',
            inputSchema: {
              type: 'object',
              properties: {
                eventId: { type: 'string', description: 'Event ID' }
              },
              required: ['eventId']
            }
          }
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        // Handle confirmation separately
        if (name === 'confirm_operation') {
          return await this.handleConfirmation(args);
        }

        // For read operations, execute immediately
        if (this.isReadOperation(name)) {
          return await this.executeOperation(name, args);
        }

        // For write operations, require confirmation
        return await this.requestConfirmation(name, args);

      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(
          ErrorCode.InternalError,
          `Error executing ${name}: ${error.message}`
        );
      }
    });
  }

  // Check if operation is read-only
  isReadOperation(operationName) {
    const readOperations = [
      'get_events',
      'get_lists', 
      'get_items',
      'get_event_with_list_and_items'
    ];
    return readOperations.includes(operationName);
  }

  // Request confirmation for write operations
  async requestConfirmation(operationName, args) {
    const operationId = `op_${++this.operationCounter}_${Date.now()}`;
    
    // Store the pending operation
    this.pendingOperations.set(operationId, {
      name: operationName,
      args: args,
      timestamp: Date.now()
    });

    // Also store by a simple key for natural language responses
    this.pendingOperations.set('last_operation', {
      id: operationId,
      name: operationName,
      args: args,
      timestamp: Date.now()
    });

    // Generate confirmation message
    const confirmationMessage = this.generateConfirmationMessage(operationName, args);

    return {
      content: [
        {
          type: 'text',
          text: `⚠️  CONFIRMATION REQUIRED\n\n${confirmationMessage}\n\nOperation ID: ${operationId}\n\nTo proceed, you can either:\n1. Use the confirm_operation tool with operationId: "${operationId}" and confirm: true/false\n2. Simply reply with "yes", "confirm", "proceed" to confirm OR "no", "cancel", "abort" to cancel`
        }
      ]
    };
  }

  // Generate human-readable confirmation message
  generateConfirmationMessage(operationName, args) {
    switch (operationName) {
      case 'create_event':
        return `Create new event: "${args.title}" from ${args.startDate} to ${args.endDate}${args.location ? ` at ${args.location}` : ''}`;
      
      case 'update_event':
        return `Update event with ID: ${args.eventId}${args.title ? `\nNew title: "${args.title}"` : ''}${args.startDate ? `\nNew start: ${args.startDate}` : ''}${args.endDate ? `\nNew end: ${args.endDate}` : ''}`;
      
      case 'delete_event':
        return `DELETE event with ID: ${args.eventId}\n⚠️  This action cannot be undone!`;
      
      case 'create_list':
        return `Create new list: "${args.name}"${args.description ? ` - ${args.description}` : ''}`;
      
      case 'update_list':
        return `Update list with ID: ${args.listId}${args.name ? `\nNew name: "${args.name}"` : ''}${args.description ? `\nNew description: "${args.description}"` : ''}`;
      
      case 'delete_list':
        return `DELETE list with ID: ${args.listId}${args.deleteItems ? '\n⚠️  This will also DELETE all items in the list!' : ''}\n⚠️  This action cannot be undone!`;
      
      case 'create_item':
        return `Create new item: "${args.content}" in list ${args.listId}`;
      
      case 'update_item':
        return `Update item with ID: ${args.itemId}${args.content ? `\nNew content: "${args.content}"` : ''}`;
      
      case 'delete_item':
        return `DELETE item with ID: ${args.itemId}\n⚠️  This action cannot be undone!`;
      
      case 'assign_list_to_event':
        return `Assign list ${args.listId} to event ${args.eventId}`;
      
      case 'unassign_list_from_event':
        return `Remove list assignment from event ${args.eventId}`;
      
      default:
        return `Execute operation: ${operationName} with parameters: ${JSON.stringify(args, null, 2)}`;
    }
  }

  // Handle confirmation response
  async handleConfirmation(args) {
    const { operationId, confirm, response } = args;
    
    let pendingOp;
    let actualOperationId;

    // Handle natural language responses
    if (response && !operationId) {
      const lastOp = this.pendingOperations.get('last_operation');
      if (!lastOp) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          'No pending operation found. Please specify an operationId or ensure there is a recent operation awaiting confirmation.'
        );
      }
      
      actualOperationId = lastOp.id;
      pendingOp = this.pendingOperations.get(actualOperationId);
      
      // Parse natural language response
      const normalizedResponse = response.toLowerCase().trim();
      const confirmWords = ['yes', 'y', 'confirm', 'proceed', 'ok', 'okay', 'continue', 'go', 'do it'];
      const cancelWords = ['no', 'n', 'cancel', 'abort', 'stop', 'nope', 'negative'];
      
      let shouldConfirm;
      if (confirmWords.some(word => normalizedResponse.includes(word))) {
        shouldConfirm = true;
      } else if (cancelWords.some(word => normalizedResponse.includes(word))) {
        shouldConfirm = false;
      } else {
        throw new McpError(
          ErrorCode.InvalidRequest,
          'Please respond with a clear confirmation like "yes", "confirm", "proceed" OR "no", "cancel", "abort"'
        );
      }
      
      // Clean up last_operation reference
      this.pendingOperations.delete('last_operation');
      
      return await this.executeConfirmation(actualOperationId, pendingOp, shouldConfirm);
    }
    
    // Handle structured confirmation
    if (!operationId) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'Either operationId or response must be provided'
      );
    }
    
    actualOperationId = operationId;
    pendingOp = this.pendingOperations.get(actualOperationId);
    
    if (!pendingOp) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Operation ${actualOperationId} not found or has expired`
      );
    }

    return await this.executeConfirmation(actualOperationId, pendingOp, confirm);
  }

  // Execute the confirmation logic
  async executeConfirmation(operationId, pendingOp, shouldConfirm) {
    // Remove from pending operations
    this.pendingOperations.delete(operationId);

    if (!shouldConfirm) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Operation cancelled: ${pendingOp.name}`
          }
        ]
      };
    }

    // Execute the confirmed operation
    const result = await this.executeOperation(pendingOp.name, pendingOp.args);
    
    return {
      content: [
        {
          type: 'text',
          text: `✅ Operation confirmed and executed:\n\n${result.content[0].text}`
        }
      ]
    };
  }

  // Execute the actual operation
  async executeOperation(name, args) {
    switch (name) {
      // Event CRUD
      case 'create_event':
        return await this.createEvent(args);
      case 'get_events':
        return await this.getEvents(args);
      case 'update_event':
        return await this.updateEvent(args);
      case 'delete_event':
        return await this.deleteEvent(args);

      // List CRUD
      case 'create_list':
        return await this.createList(args);
      case 'get_lists':
        return await this.getLists(args);
      case 'update_list':
        return await this.updateList(args);
      case 'delete_list':
        return await this.deleteList(args);

      // Item CRUD
      case 'create_item':
        return await this.createItem(args);
      case 'get_items':
        return await this.getItems(args);
      case 'update_item':
        return await this.updateItem(args);
      case 'delete_item':
        return await this.deleteItem(args);

      // Relationships
      case 'assign_list_to_event':
        return await this.assignListToEvent(args);
      case 'unassign_list_from_event':
        return await this.unassignListFromEvent(args);
      case 'get_event_with_list_and_items':
        return await this.getEventWithListAndItems(args);

      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        );
    }
  }

  // Clean up expired pending operations (optional)
  cleanupExpiredOperations() {
    const now = Date.now();
    const expireTime = 5 * 60 * 1000; // 5 minutes
    
    for (const [operationId, operation] of this.pendingOperations.entries()) {
      if (now - operation.timestamp > expireTime) {
        this.pendingOperations.delete(operationId);
      }
    }
  }

  // Event CRUD methods
  async createEvent(args) {
    const event = new Event(args);
    await event.save();
    return {
      content: [
        {
          type: 'text',
          text: `Event created successfully with ID: ${event._id}`,
        },
      ],
    };
  }

  async getEvents(args) {
    const query = {};
    if (args.calendarId) query.calendarId = args.calendarId;
    if (args.ownerId) query.ownerId = args.ownerId;
    if (args.status) query.status = args.status;
    if (args.listId) query.list = args.listId;
    if (args.tags && args.tags.length > 0) query.tags = { $in: args.tags };
    if (args.startDate || args.endDate) {
      query.startDate = {};
      if (args.startDate) query.startDate.$gte = new Date(args.startDate);
      if (args.endDate) query.startDate.$lte = new Date(args.endDate);
    }

    const events = await Event.find(query).populate('list');
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(events, null, 2),
        },
      ],
    };
  }

  async updateEvent(args) {
    const { eventId, ...updateData } = args;
    const event = await Event.findByIdAndUpdate(eventId, updateData, { new: true });
    if (!event) {
      throw new McpError(ErrorCode.InvalidRequest, 'Event not found');
    }
    return {
      content: [
        {
          type: 'text',
          text: `Event updated successfully: ${JSON.stringify(event, null, 2)}`,
        },
      ],
    };
  }

  async deleteEvent(args) {
    const event = await Event.findByIdAndDelete(args.eventId);
    if (!event) {
      throw new McpError(ErrorCode.InvalidRequest, 'Event not found');
    }
    return {
      content: [
        {
          type: 'text',
          text: `Event deleted successfully`,
        },
      ],
    };
  }

  // List CRUD methods
  async createList(args) {
    const list = new List(args);
    await list.save();
    return {
      content: [
        {
          type: 'text',
          text: `List created successfully with ID: ${list._id}`,
        },
      ],
    };
  }

  async getLists(args) {
    const query = {};
    if (args.userId) query.userId = args.userId;
    if (args.name) query.name = new RegExp(args.name, 'i');

    const lists = await List.find(query);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(lists, null, 2),
        },
      ],
    };
  }

  async updateList(args) {
    const { listId, ...updateData } = args;
    const list = await List.findByIdAndUpdate(listId, updateData, { new: true });
    if (!list) {
      throw new McpError(ErrorCode.InvalidRequest, 'List not found');
    }
    return {
      content: [
        {
          type: 'text',
          text: `List updated successfully: ${JSON.stringify(list, null, 2)}`,
        },
      ],
    };
  }

  async deleteList(args) {
    const list = await List.findByIdAndDelete(args.listId);
    if (!list) {
      throw new McpError(ErrorCode.InvalidRequest, 'List not found');
    }

    // Optionally delete associated items
    if (args.deleteItems) {
      await Item.deleteMany({ listId: args.listId });
    }

    // Remove list reference from events
    await Event.updateMany({ list: args.listId }, { $unset: { list: 1 } });

    return {
      content: [
        {
          type: 'text',
          text: `List deleted successfully${args.deleteItems ? ' (items also deleted)' : ''}`,
        },
      ],
    };
  }

  // Item CRUD methods
  async createItem(args) {
    const item = new Item(args);
    await item.save();
    return {
      content: [
        {
          type: 'text',
          text: `Item created successfully with ID: ${item._id}`,
        },
      ],
    };
  }

  async getItems(args) {
    const query = {};
    if (args.listId) query.listId = args.listId;
    if (args.content) query.content = new RegExp(args.content, 'i');

    const items = await Item.find(query).populate('listId');
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(items, null, 2),
        },
      ],
    };
  }

  async updateItem(args) {
    const { itemId, ...updateData } = args;
    const item = await Item.findByIdAndUpdate(itemId, updateData, { new: true });
    if (!item) {
      throw new McpError(ErrorCode.InvalidRequest, 'Item not found');
    }
    return {
      content: [
        {
          type: 'text',
          text: `Item updated successfully: ${JSON.stringify(item, null, 2)}`,
        },
      ],
    };
  }

  async deleteItem(args) {
    const item = await Item.findByIdAndDelete(args.itemId);
    if (!item) {
      throw new McpError(ErrorCode.InvalidRequest, 'Item not found');
    }
    return {
      content: [
        {
          type: 'text',
          text: `Item deleted successfully`,
        },
      ],
    };
  }

  // Relationship methods
  async assignListToEvent(args) {
    const event = await Event.findByIdAndUpdate(
      args.eventId,
      { list: args.listId },
      { new: true }
    ).populate('list');
    
    if (!event) {
      throw new McpError(ErrorCode.InvalidRequest, 'Event not found');
    }

    return {
      content: [
        {
          type: 'text',
          text: `List assigned to event successfully: ${JSON.stringify(event, null, 2)}`,
        },
      ],
    };
  }

  async unassignListFromEvent(args) {
    const event = await Event.findByIdAndUpdate(
      args.eventId,
      { $unset: { list: 1 } },
      { new: true }
    );
    
    if (!event) {
      throw new McpError(ErrorCode.InvalidRequest, 'Event not found');
    }

    return {
      content: [
        {
          type: 'text',
          text: `List unassigned from event successfully`,
        },
      ],
    };
  }

  async getEventWithListAndItems(args) {
    const event = await Event.findById(args.eventId).populate('list');
    if (!event) {
      throw new McpError(ErrorCode.InvalidRequest, 'Event not found');
    }

    let items = [];
    if (event.list) {
      items = await Item.find({ listId: event.list._id });
    }

    const result = {
      event: event.toObject(),
      items: items
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  async run() {
    // Connect to MongoDB
    try {
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/calendar-mcp');
      console.error('Connected to MongoDB');
    } catch (error) {
      console.error('MongoDB connection error:', error);
      process.exit(1);
    }

    // Clean up expired operations every 5 minutes
    setInterval(() => {
      this.cleanupExpiredOperations();
    }, 5 * 60 * 1000);

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Calendar MCP server running on stdio with confirmation enabled');
  }
}

const server = new CalendarMCPServer();
server.run().catch(console.error);