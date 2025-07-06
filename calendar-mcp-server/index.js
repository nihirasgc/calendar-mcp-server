#!/usr/bin/env node
import 'dotenv/config';
//console.log('✅ Loaded MONGODB_URI:', process.env.MONGODB_URI); // Debug check
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import mongoose from 'mongoose';
import fs from 'fs/promises';
import path from 'path';

// Import your models
import Event from './models/Event.js';
import List from './models/List.js';
import Item from './models/Item.js';

class ContextualMemory {
  constructor(maxEntries = 100, persistPath = './memory.json') {
    this.maxEntries = maxEntries;
    this.persistPath = persistPath;
    this.sessions = new Map(); // sessionId -> session data
    this.loadFromDisk();
  }

  // Get or create session memory
  getSession(sessionId = 'default') {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        interactions: [],
        context: {
          recentEvents: [],
          recentLists: [],
          recentItems: [],
          userPreferences: {},
          currentFocus: null, // What the user is currently working on
        },
        metadata: {
          created: new Date().toISOString(),
          lastAccessed: new Date().toISOString(),
        }
      });
    }
    
    const session = this.sessions.get(sessionId);
    session.metadata.lastAccessed = new Date().toISOString();
    return session;
  }

  // Add interaction to memory
  addInteraction(sessionId, operation, params, result, context = {}) {
    const session = this.getSession(sessionId);
    
    const interaction = {
      timestamp: new Date().toISOString(),
      operation,
      params: this.sanitizeParams(params),
      result: this.sanitizeResult(result),
      context,
    };

    session.interactions.unshift(interaction);
    
    // Keep only recent interactions
    if (session.interactions.length > this.maxEntries) {
      session.interactions = session.interactions.slice(0, this.maxEntries);
    }

    // Update contextual information
    this.updateContext(session, operation, params, result);
    
    this.saveToDisk();
  }

  // Update contextual understanding
  updateContext(session, operation, params, result) {
    const context = session.context;

    switch (operation) {
      case 'create_event':
        if (result.success !== false) {
          context.recentEvents.unshift({
            id: this.extractId(result),
            title: params.title,
            startDate: params.startDate,
            endDate: params.endDate,
            operation: 'created',
            timestamp: new Date().toISOString()
          });
          context.currentFocus = { type: 'event', id: this.extractId(result), title: params.title };
        }
        break;

      case 'create_list':
        if (result.success !== false) {
          context.recentLists.unshift({
            id: this.extractId(result),
            name: params.name,
            operation: 'created',
            timestamp: new Date().toISOString()
          });
          context.currentFocus = { type: 'list', id: this.extractId(result), name: params.name };
        }
        break;

      case 'create_item':
        if (result.success !== false) {
          context.recentItems.unshift({
            id: this.extractId(result),
            content: params.content,
            listId: params.listId,
            operation: 'created',
            timestamp: new Date().toISOString()
          });
        }
        break;

      case 'get_events':
        // Track what events user is interested in
        if (params.calendarId) {
          context.userPreferences.preferredCalendar = params.calendarId;
        }
        if (params.ownerId) {
          context.userPreferences.userId = params.ownerId;
        }
        break;

      case 'assign_list_to_event':
        context.currentFocus = { 
          type: 'event_list_relationship', 
          eventId: params.eventId, 
          listId: params.listId 
        };
        break;
    }

    // Keep recent arrays manageable
    context.recentEvents = context.recentEvents.slice(0, 10);
    context.recentLists = context.recentLists.slice(0, 10);
    context.recentItems = context.recentItems.slice(0, 20);
  }

  // Get contextual suggestions
  getContextualSuggestions(sessionId, currentOperation, currentParams) {
    const session = this.getSession(sessionId);
    const context = session.context;
    const suggestions = [];

    // Suggest based on recent activity
    if (currentOperation === 'create_item' && !currentParams.listId) {
      if (context.recentLists.length > 0) {
        const recentList = context.recentLists[0];
        suggestions.push(`You recently created a list "${recentList.name}" (${recentList.id}). Would you like to add this item there?`);
      }
    }

    if (currentOperation === 'assign_list_to_event' && !currentParams.eventId) {
      if (context.recentEvents.length > 0) {
        const recentEvent = context.recentEvents[0];
        suggestions.push(`You recently created event "${recentEvent.title}" (${recentEvent.id}). Is this the event you want to assign the list to?`);
      }
    }

    // Suggest based on patterns
    if (currentOperation === 'create_event' && context.userPreferences.preferredCalendar) {
      suggestions.push(`Based on your activity, you might want to use calendar: ${context.userPreferences.preferredCalendar}`);
    }

    return suggestions;
  }

  // Get conversation context for AI
  getConversationContext(sessionId, limit = 5) {
    const session = this.getSession(sessionId);
    const recentInteractions = session.interactions.slice(0, limit);
    
    const contextSummary = {
      currentFocus: session.context.currentFocus,
      recentActivity: recentInteractions.map(i => ({
        operation: i.operation,
        timestamp: i.timestamp,
        summary: this.summarizeInteraction(i)
      })),
      userPreferences: session.context.userPreferences,
      suggestions: this.getRecentEntitySuggestions(session.context)
    };

    return contextSummary;
  }

  // Get suggestions for IDs based on recent activity
  getRecentEntitySuggestions(context) {
    return {
      events: context.recentEvents.map(e => ({ id: e.id, title: e.title, when: e.startDate })),
      lists: context.recentLists.map(l => ({ id: l.id, name: l.name })),
      items: context.recentItems.map(i => ({ id: i.id, content: i.content.substring(0, 50) + '...' }))
    };
  }

  // Helper methods
  sanitizeParams(params) {
    // Remove sensitive data, keep structure
    const sanitized = { ...params };
    // You might want to remove sensitive fields here
    return sanitized;
  }

  sanitizeResult(result) {
    // Keep only essential result info
    if (typeof result === 'object' && result.content) {
      return { type: 'content', hasContent: true };
    }
    return result;
  }

  extractId(result) {
    // Extract ID from result text
    if (result?.content?.[0]?.text) {
      const match = result.content[0].text.match(/ID:\s*([a-f0-9]{24})/i);
      return match ? match[1] : null;
    }
    return null;
  }

  summarizeInteraction(interaction) {
    const { operation, params } = interaction;
    switch (operation) {
      case 'create_event':
        return `Created event "${params.title}"`;
      case 'create_list':
        return `Created list "${params.name}"`;
      case 'create_item':
        return `Added item "${params.content?.substring(0, 30)}..."`;
      default:
        return `Performed ${operation}`;
    }
  }

  // Persistence
  async saveToDisk() {
    try {
      const data = {
        sessions: Object.fromEntries(this.sessions.entries()),
        savedAt: new Date().toISOString()
      };
      await fs.writeFile(this.persistPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Failed to save memory to disk:', error);
    }
  }

  async loadFromDisk() {
    try {
      const data = await fs.readFile(this.persistPath, 'utf8');
      const parsed = JSON.parse(data);
      if (parsed.sessions) {
        this.sessions = new Map(Object.entries(parsed.sessions));
      }
    } catch (error) {
      // File doesn't exist or is corrupted, start fresh
      console.error('Could not load memory from disk, starting fresh:', error.message);
    }
  }

  // Clean up old sessions (call periodically)
  cleanup(maxAge = 7 * 24 * 60 * 60 * 1000) { // 7 days
    const cutoff = Date.now() - maxAge;
    for (const [sessionId, session] of this.sessions) {
      if (new Date(session.metadata.lastAccessed).getTime() < cutoff) {
        this.sessions.delete(sessionId);
      }
    }
    this.saveToDisk();
  }
}

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

    // Initialize contextual memory
    this.memory = new ContextualMemory();

    this.setupToolHandlers();
  }

  // Extract session ID from request (you might want to enhance this)
  getSessionId(request) {
    // For now, use a single session. In a real app, you might extract this from:
    // - request headers
    // - user authentication
    // - client connection info
    return 'default';
  }

  setupToolHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'get_context',
            description: 'Get current conversation context and suggestions',
            inputSchema: {
              type: 'object',
              properties: {
                operation: { type: 'string', description: 'Operation you are about to perform (optional)' },
                params: { type: 'object', description: 'Parameters for the operation (optional)' }
              }
            }
          },
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
                deleteItems: { type: 'boolean', default: false, description: 'Whether to delete associated items' }
              },
              required: ['listId']
            }
          },
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

    // Handle tool calls with memory integration
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const sessionId = this.getSessionId(request);

      try {
        // Handle context request
        if (name === 'get_context') {
          return await this.handleGetContext(sessionId, args);
        }

        // Handle confirmation separately
        if (name === 'confirm_operation') {
          const result = await this.handleConfirmation(args);
          // Record confirmation in memory
          this.memory.addInteraction(sessionId, 'confirm_operation', args, result);
          return result;
        }

        // For read operations, execute immediately
        if (this.isReadOperation(name)) {
          const result = await this.executeOperation(name, args);
          // Add to memory
          this.memory.addInteraction(sessionId, name, args, result);
          
          // Enhance result with contextual suggestions
          const enhancedResult = this.enhanceResultWithContext(sessionId, name, args, result);
          return enhancedResult;
        }

        // For write operations, require confirmation
        const confirmationResult = await this.requestConfirmation(name, args);
        // Don't add to memory yet - wait for confirmation
        return confirmationResult;

      } catch (error) {
        // Record error in memory
        this.memory.addInteraction(sessionId, name, args, { error: error.message });
        
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

  // New method to handle context requests
  async handleGetContext(sessionId, args) {
    const context = this.memory.getConversationContext(sessionId);
    
    let suggestions = [];
    if (args.operation && args.params) {
      suggestions = this.memory.getContextualSuggestions(sessionId, args.operation, args.params);
    }

    return {
      content: [
        {
          type: 'text',
          text: `📋 **Current Context**\n\n` +
                `**Current Focus:** ${context.currentFocus ? 
                  `${context.currentFocus.type} - ${context.currentFocus.title || context.currentFocus.name || context.currentFocus.id}` 
                  : 'None'}\n\n` +
                
                `**Recent Activity:**\n${context.recentActivity.map(a => 
                  `• ${a.summary} (${new Date(a.timestamp).toLocaleString()})`
                ).join('\n') || 'No recent activity'}\n\n` +
                
                `**Available for Quick Reference:**\n` +
                `• Recent Events: ${context.suggestions.events.map(e => `"${e.title}" (${e.id})`).join(', ') || 'None'}\n` +
                `• Recent Lists: ${context.suggestions.lists.map(l => `"${l.name}" (${l.id})`).join(', ') || 'None'}\n` +
                `• Recent Items: ${context.suggestions.items.length} items available\n\n` +
                
                (suggestions.length > 0 ? `**Suggestions:**\n${suggestions.map(s => `• ${s}`).join('\n')}\n\n` : '') +
                
                `**User Preferences:**\n${Object.entries(context.userPreferences).map(([k, v]) => `• ${k}: ${v}`).join('\n') || 'None set'}`
        }
      ]
    };
  }

  // Enhance results with contextual information
  enhanceResultWithContext(sessionId, operation, params, result) {
    const suggestions = this.memory.getContextualSuggestions(sessionId, operation, params);
    
    if (suggestions.length === 0) {
      return result;
    }

    // Add suggestions to the result
    const originalText = result.content[0].text;
    const enhancedText = originalText + '\n\n💡 **Contextual Suggestions:**\n' + 
                        suggestions.map(s => `• ${s}`).join('\n');

    return {
      content: [
        {
          type: 'text',
          text: enhancedText
        }
      ]
    };
  }

  // Execute the confirmed operation (modified to record in memory)
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
    
    // Add to memory after successful execution
    const sessionId = 'default'; // You might want to track this better
    this.memory.addInteraction(sessionId, pendingOp.name, pendingOp.args, result);
    
    return {
      content: [
        {
          type: 'text',
          text: `✅ Operation confirmed and executed:\n\n${result.content[0].text}`
        }
      ]
    };
  }

  isReadOperation(operationName) {
    const readOperations = [
      'get_events',
      'get_lists', 
      'get_items',
      'get_event_with_list_and_items',
      'get_context'
    ];
    return readOperations.includes(operationName);
  }

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
          'No pending operation found. Please make a request first.'
        );
      }
      
      actualOperationId = lastOp.id;
      pendingOp = this.pendingOperations.get(actualOperationId);
      
      // Parse natural language response
      const normalizedResponse = response.toLowerCase().trim();
      const confirmWords = ['yes', 'confirm', 'proceed', 'ok', 'y', 'go', 'continue'];
      const cancelWords = ['no', 'cancel', 'abort', 'stop', 'n', 'decline'];
      
      let shouldConfirm;
      if (confirmWords.some(word => normalizedResponse.includes(word))) {
        shouldConfirm = true;
      } else if (cancelWords.some(word => normalizedResponse.includes(word))) {
        shouldConfirm = false;
      } else {
        throw new McpError(
          ErrorCode.InvalidRequest,
          'Please respond with "yes"/"confirm" to proceed or "no"/"cancel" to abort.'
        );
      }
      
      return await this.executeConfirmation(actualOperationId, pendingOp, shouldConfirm);
    }

    // Handle explicit operationId
    if (operationId) {
      pendingOp = this.pendingOperations.get(operationId);
      if (!pendingOp) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `No pending operation found with ID: ${operationId}`
        );
      }
      
      return await this.executeConfirmation(operationId, pendingOp, confirm);
    }

    // Handle boolean confirm without operationId (use last operation)
    if (typeof confirm === 'boolean') {
      const lastOp = this.pendingOperations.get('last_operation');
      if (!lastOp) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          'No pending operation found. Please make a request first.'
        );
      }
      
      actualOperationId = lastOp.id;
      pendingOp = this.pendingOperations.get(actualOperationId);
      
      return await this.executeConfirmation(actualOperationId, pendingOp, confirm);
    }

    throw new McpError(
      ErrorCode.InvalidRequest,
      'Please provide either operationId + confirm, or a natural language response.'
    );
  }

  async executeOperation(name, args) {
    switch (name) {
      case 'create_event':
        return await this.createEvent(args);
      case 'get_events':
        return await this.getEvents(args);
      case 'update_event':
        return await this.updateEvent(args);
      case 'delete_event':
        return await this.deleteEvent(args);
      case 'create_list':
        return await this.createList(args);
      case 'get_lists':
        return await this.getLists(args);
      case 'update_list':
        return await this.updateList(args);
      case 'delete_list':
        return await this.deleteList(args);
      case 'create_item':
        return await this.createItem(args);
      case 'get_items':
        return await this.getItems(args);
      case 'update_item':
        return await this.updateItem(args);
      case 'delete_item':
        return await this.deleteItem(args);
      case 'assign_list_to_event':
        return await this.assignListToEvent(args);
      case 'unassign_list_from_event':
        return await this.unassignListFromEvent(args);
      case 'get_event_with_list_and_items':
        return await this.getEventWithListAndItems(args);
      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown operation: ${name}`
        );
    }
  }

  // Event operations
  async createEvent(args) {
    const event = new Event(args);
    await event.save();
    
    return {
      content: [
        {
          type: 'text',
          text: `✅ Event created successfully!\n\nID: ${event._id}\nTitle: ${event.title}\nStart: ${event.startDate}\nEnd: ${event.endDate}${event.location ? `\nLocation: ${event.location}` : ''}${event.description ? `\nDescription: ${event.description}` : ''}`
        }
      ]
    };
  }

  async getEvents(args) {
    const filter = {};
    
    if (args.calendarId) filter.calendarId = args.calendarId;
    if (args.ownerId) filter.ownerId = args.ownerId;
    if (args.status) filter.status = args.status;
    if (args.tags && args.tags.length > 0) filter.tags = { $in: args.tags };
    if (args.listId) filter.listId = args.listId;
    
    if (args.startDate || args.endDate) {
      filter.$or = [];
      if (args.startDate) {
        filter.$or.push({ startDate: { $gte: new Date(args.startDate) } });
      }
      if (args.endDate) {
        filter.$or.push({ endDate: { $lte: new Date(args.endDate) } });
      }
    }

    const events = await Event.find(filter).sort({ startDate: 1 });
    
    if (events.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No events found matching the criteria.'
          }
        ]
      };
    }

    const eventList = events.map(event => 
      `📅 **${event.title}**\n` +
      `   ID: ${event._id}\n` +
      `   Start: ${event.startDate}\n` +
      `   End: ${event.endDate}\n` +
      `   Status: ${event.status}\n` +
      `   Calendar: ${event.calendarId}\n` +
      `   Owner: ${event.ownerId}` +
      (event.location ? `\n   Location: ${event.location}` : '') +
      (event.description ? `\n   Description: ${event.description}` : '') +
      (event.tags && event.tags.length > 0 ? `\n   Tags: ${event.tags.join(', ')}` : '') +
      (event.listId ? `\n   List: ${event.listId}` : '')
    ).join('\n\n');

    return {
      content: [
        {
          type: 'text',
          text: `Found ${events.length} event(s):\n\n${eventList}`
        }
      ]
    };
  }

  async updateEvent(args) {
    const { eventId, ...updateData } = args;
    
    const event = await Event.findByIdAndUpdate(
      eventId,
      updateData,
      { new: true, runValidators: true }
    );
    
    if (!event) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Event with ID ${eventId} not found`
      );
    }

    return {
      content: [
        {
          type: 'text',
          text: `✅ Event updated successfully!\n\nID: ${event._id}\nTitle: ${event.title}\nStart: ${event.startDate}\nEnd: ${event.endDate}${event.location ? `\nLocation: ${event.location}` : ''}${event.description ? `\nDescription: ${event.description}` : ''}`
        }
      ]
    };
  }

  async deleteEvent(args) {
    const event = await Event.findByIdAndDelete(args.eventId);
    
    if (!event) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Event with ID ${args.eventId} not found`
      );
    }

    return {
      content: [
        {
          type: 'text',
          text: `✅ Event "${event.title}" deleted successfully!`
        }
      ]
    };
  }

  // List operations
  async createList(args) {
    const list = new List(args);
    await list.save();
    
    return {
      content: [
        {
          type: 'text',
          text: `✅ List created successfully!\n\nID: ${list._id}\nName: ${list.name}${list.description ? `\nDescription: ${list.description}` : ''}\nUser: ${list.userId}`
        }
      ]
    };
  }

  async getLists(args) {
    const filter = {};
    
    if (args.userId) filter.userId = args.userId;
    if (args.name) filter.name = new RegExp(args.name, 'i');

    const lists = await List.find(filter).sort({ name: 1 });
    
    if (lists.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No lists found matching the criteria.'
          }
        ]
      };
    }

    const listText = lists.map(list => 
      `📝 **${list.name}**\n` +
      `   ID: ${list._id}\n` +
      `   User: ${list.userId}` +
      (list.description ? `\n   Description: ${list.description}` : '')
    ).join('\n\n');

    return {
      content: [
        {
          type: 'text',
          text: `Found ${lists.length} list(s):\n\n${listText}`
        }
      ]
    };
  }

  async updateList(args) {
    const { listId, ...updateData } = args;
    
    const list = await List.findByIdAndUpdate(
      listId,
      updateData,
      { new: true, runValidators: true }
    );
    
    if (!list) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `List with ID ${listId} not found`
      );
    }

    return {
      content: [
        {
          type: 'text',
          text: `✅ List updated successfully!\n\nID: ${list._id}\nName: ${list.name}${list.description ? `\nDescription: ${list.description}` : ''}`
        }
      ]
    };
  }

  async deleteList(args) {
    const list = await List.findByIdAndDelete(args.listId);
    
    if (!list) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `List with ID ${args.listId} not found`
      );
    }

    // Optionally delete associated items
    if (args.deleteItems) {
      const deletedItems = await Item.deleteMany({ listId: args.listId });
      return {
        content: [
          {
            type: 'text',
            text: `✅ List "${list.name}" and ${deletedItems.deletedCount} associated items deleted successfully!`
          }
        ]
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: `✅ List "${list.name}" deleted successfully!`
        }
      ]
    };
  }

  // Item operations
  async createItem(args) {
    const item = new Item(args);
    await item.save();
    
    return {
      content: [
        {
          type: 'text',
          text: `✅ Item created successfully!\n\nID: ${item._id}\nContent: ${item.content}\nList: ${item.listId}`
        }
      ]
    };
  }

  async getItems(args) {
    const filter = {};
    
    if (args.listId) filter.listId = args.listId;
    if (args.content) filter.content = new RegExp(args.content, 'i');

    const items = await Item.find(filter).sort({ createdAt: -1 });
    
    if (items.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No items found matching the criteria.'
          }
        ]
      };
    }

    const itemText = items.map(item => 
      `• **${item.content}**\n` +
      `  ID: ${item._id}\n` +
      `  List: ${item.listId}`
    ).join('\n\n');

    return {
      content: [
        {
          type: 'text',
          text: `Found ${items.length} item(s):\n\n${itemText}`
        }
      ]
    };
  }

  async updateItem(args) {
    const { itemId, ...updateData } = args;
    
    const item = await Item.findByIdAndUpdate(
      itemId,
      updateData,
      { new: true, runValidators: true }
    );
    
    if (!item) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Item with ID ${itemId} not found`
      );
    }

    return {
      content: [
        {
          type: 'text',
          text: `✅ Item updated successfully!\n\nID: ${item._id}\nContent: ${item.content}`
        }
      ]
    };
  }

  async deleteItem(args) {
    const item = await Item.findByIdAndDelete(args.itemId);
    
    if (!item) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Item with ID ${args.itemId} not found`
      );
    }

    return {
      content: [
        {
          type: 'text',
          text: `✅ Item "${item.content}" deleted successfully!`
        }
      ]
    };
  }

  // Event-List relationship operations
  async assignListToEvent(args) {
    const event = await Event.findByIdAndUpdate(
      args.eventId,
      { listId: args.listId },
      { new: true }
    );
    
    if (!event) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Event with ID ${args.eventId} not found`
      );
    }

    const list = await List.findById(args.listId);
    if (!list) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `List with ID ${args.listId} not found`
      );
    }

    return {
      content: [
        {
          type: 'text',
          text: `✅ List "${list.name}" assigned to event "${event.title}" successfully!`
        }
      ]
    };
  }

  async unassignListFromEvent(args) {
    const event = await Event.findByIdAndUpdate(
      args.eventId,
      { $unset: { listId: 1 } },
      { new: true }
    );
    
    if (!event) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Event with ID ${args.eventId} not found`
      );
    }

    return {
      content: [
        {
          type: 'text',
          text: `✅ List assignment removed from event "${event.title}" successfully!`
        }
      ]
    };
  }

  async getEventWithListAndItems(args) {
    const event = await Event.findById(args.eventId);
    
    if (!event) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Event with ID ${args.eventId} not found`
      );
    }

    let result = `📅 **Event: ${event.title}**\n` +
                `ID: ${event._id}\n` +
                `Start: ${event.startDate}\n` +
                `End: ${event.endDate}\n` +
                `Status: ${event.status}\n` +
                `Calendar: ${event.calendarId}\n` +
                `Owner: ${event.ownerId}`;

    if (event.location) result += `\nLocation: ${event.location}`;
    if (event.description) result += `\nDescription: ${event.description}`;
    if (event.tags && event.tags.length > 0) result += `\nTags: ${event.tags.join(', ')}`;

    if (event.listId) {
      const list = await List.findById(event.listId);
      if (list) {
        result += `\n\n📝 **Assigned List: ${list.name}**\n`;
        if (list.description) result += `Description: ${list.description}\n`;
        
        const items = await Item.find({ listId: event.listId }).sort({ createdAt: -1 });
        if (items.length > 0) {
          result += `\n**Items (${items.length}):**\n`;
          result += items.map(item => `• ${item.content}`).join('\n');
        } else {
          result += '\nNo items in this list yet.';
        }
      }
    } else {
      result += '\n\n📝 No list assigned to this event.';
    }

    return {
      content: [
        {
          type: 'text',
          text: result
        }
      ]
    };
  }

  async run() {
    // Connect to MongoDB
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI environment variable is required');
    }

    try {
      await mongoose.connect(process.env.MONGODB_URI);
      console.error('Connected to MongoDB');
    } catch (error) {
      console.error('Failed to connect to MongoDB:', error);
      process.exit(1);
    }

    // Set up cleanup
    process.on('SIGINT', async () => {
      console.error('Received SIGINT, cleaning up...');
      this.memory.cleanup();
      await mongoose.disconnect();
      process.exit(0);
    });

    // Clean up old sessions periodically (every 6 hours)
    setInterval(() => {
      this.memory.cleanup();
    }, 6 * 60 * 60 * 1000);

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Calendar MCP server running on stdio');
  }
}

const server = new CalendarMCPServer();
server.run().catch(console.error);