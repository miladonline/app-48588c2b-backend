/**
 * MCP server for simple todolist app
 *
 * This server uses the official MCP SDK with Express.js and exposes widget-backed tools
 * that render interactive UI components in ChatGPT. Each handler returns structured
 * content that hydrates the widget and provides the model with relevant context.
 */

import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

// Widget URL from Render static site
const WIDGET_URL = process.env.WIDGET_URL || '';

if (!WIDGET_URL) {
  console.warn('⚠️  WIDGET_URL not set, widget will not load');
}

// Backend URL (automatically provided by Render as RENDER_EXTERNAL_URL)
const BACKEND_URL = process.env.RENDER_EXTERNAL_URL || '';

if (!BACKEND_URL) {
  console.warn('⚠️  RENDER_EXTERNAL_URL not set, widget files will not load properly');
}

// HTML template with widget references served through backend proxy
// Backend fetches from Render static site and serves with CORS headers
const WIDGET_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Widget</title>
<link rel="stylesheet" href="${BACKEND_URL}/widget.css">
</head>
<body>
<div id="root"></div>
<script type="module" src="${BACKEND_URL}/widget.js"></script>
</body>
</html>`.trim();

// Define widget configuration
const WIDGET_URI = 'ui://widget/widget.html';
const MIME_TYPE = 'text/html+skybridge';

// Extract backend domain for CSP (widget files served through backend)
const getBackendDomain = (url: string): string => {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
};

const BACKEND_DOMAIN = getBackendDomain(BACKEND_URL);

// In-memory todo storage
interface Todo {
  id: string;
  title: string;
  completed: boolean;
  createdAt: string;
}

let todos: Todo[] = [];
let nextId = 1;

// Initialize MCP server
const server = new McpServer({
  name: 'todolist-app',
  version: '1.0.0'
});

// Register widget HTML resource
server.registerResource(
  'widget-html',
  WIDGET_URI,
  {},
  async () => ({
    contents: [{
      uri: WIDGET_URI,
      mimeType: MIME_TYPE,
      text: WIDGET_HTML,
      _meta: {
        'openai/widgetPrefersBorder': true,
        'openai/widgetDomain': 'https://chatgpt.com',
        'openai/widgetCSP': {
          connect_domains: ['https://chatgpt.com'],
          resource_domains: [BACKEND_DOMAIN, 'https://persistent.oaistatic.com'].filter(Boolean)
        },
        'openai/widgetDescription': 'Interactive todolist widget with theme support and task management'
      }
    }]
  })
);

// Register tool: get_todos
server.registerTool(
  'get_todos',
  {
    title: 'Get Todos',
    description: 'Retrieve all todo items from the list',
    inputSchema: {},
    _meta: {
      'openai/outputTemplate': WIDGET_URI,
      'openai/toolInvocation/invoking': 'Loading todos...',
      'openai/toolInvocation/invoked': 'Todos loaded successfully',
      'openai/widgetAccessible': true,
      'openai/resultCanProduceWidget': true,
      'openai/readOnlyHint': true,
      'annotations': {
        'destructiveHint': false,
        'openWorldHint': false,
        'readOnlyHint': true
      }
    }
  },
  async () => {
    const completedCount = todos.filter(t => t.completed).length;
    const pendingCount = todos.length - completedCount;

    return {
      content: [{
        type: 'text',
        text: `You have ${todos.length} todo(s): ${completedCount} completed, ${pendingCount} pending. View and manage them in the component below.`
      }],
      structuredContent: {
        todos: todos.slice(0, 10),
        summary: `${todos.length} total, ${completedCount} completed, ${pendingCount} pending`
      },
      _meta: {
        fullData: { todos, stats: { total: todos.length, completed: completedCount, pending: pendingCount } }
      }
    };
  }
);

// Register tool: add_todo
server.registerTool(
  'add_todo',
  {
    title: 'Add Todo',
    description: 'Add a new todo item to the list',
    inputSchema: {
      title: z.string().describe('The title/description of the todo item')
    },
    _meta: {
      'openai/outputTemplate': WIDGET_URI,
      'openai/toolInvocation/invoking': 'Adding todo...',
      'openai/toolInvocation/invoked': 'Todo added successfully',
      'openai/widgetAccessible': true,
      'openai/resultCanProduceWidget': true,
      'openai/readOnlyHint': false,
      'annotations': {
        'destructiveHint': false,
        'openWorldHint': false,
        'readOnlyHint': false
      }
    }
  },
  async ({ title }) => {
    const newTodo: Todo = {
      id: String(nextId++),
      title,
      completed: false,
      createdAt: new Date().toISOString()
    };

    todos.push(newTodo);

    return {
      content: [{
        type: 'text',
        text: `Added todo: "${title}". You now have ${todos.length} todo(s).`
      }],
      structuredContent: {
        addedTodo: newTodo,
        todos: todos.slice(0, 10)
      },
      _meta: {
        fullData: { todos, addedTodo: newTodo }
      }
    };
  }
);

// Register tool: toggle_todo
server.registerTool(
  'toggle_todo',
  {
    title: 'Toggle Todo',
    description: 'Mark a todo as completed or uncompleted',
    inputSchema: {
      id: z.string().describe('The ID of the todo item to toggle')
    },
    _meta: {
      'openai/outputTemplate': WIDGET_URI,
      'openai/toolInvocation/invoking': 'Toggling todo...',
      'openai/toolInvocation/invoked': 'Todo toggled successfully',
      'openai/widgetAccessible': true,
      'openai/resultCanProduceWidget': true,
      'openai/readOnlyHint': false,
      'annotations': {
        'destructiveHint': false,
        'openWorldHint': false,
        'readOnlyHint': false
      }
    }
  },
  async ({ id }) => {
    const todo = todos.find(t => t.id === id);

    if (!todo) {
      return {
        content: [{
          type: 'text',
          text: `Todo with ID "${id}" not found.`
        }],
        isError: true
      };
    }

    todo.completed = !todo.completed;

    return {
      content: [{
        type: 'text',
        text: `Marked "${todo.title}" as ${todo.completed ? 'completed' : 'pending'}.`
      }],
      structuredContent: {
        toggledTodo: todo,
        todos: todos.slice(0, 10)
      },
      _meta: {
        fullData: { todos, toggledTodo: todo }
      }
    };
  }
);

// Register tool: delete_todo
server.registerTool(
  'delete_todo',
  {
    title: 'Delete Todo',
    description: 'Delete a todo item from the list',
    inputSchema: {
      id: z.string().describe('The ID of the todo item to delete')
    },
    _meta: {
      'openai/outputTemplate': WIDGET_URI,
      'openai/toolInvocation/invoking': 'Deleting todo...',
      'openai/toolInvocation/invoked': 'Todo deleted successfully',
      'openai/widgetAccessible': true,
      'openai/resultCanProduceWidget': true,
      'openai/readOnlyHint': false,
      'annotations': {
        'destructiveHint': true,
        'openWorldHint': false,
        'readOnlyHint': false
      }
    }
  },
  async ({ id }) => {
    const todoIndex = todos.findIndex(t => t.id === id);

    if (todoIndex === -1) {
      return {
        content: [{
          type: 'text',
          text: `Todo with ID "${id}" not found.`
        }],
        isError: true
      };
    }

    const deletedTodo = todos[todoIndex];
    todos.splice(todoIndex, 1);

    return {
      content: [{
        type: 'text',
        text: `Deleted todo: "${deletedTodo.title}". You now have ${todos.length} todo(s).`
      }],
      structuredContent: {
        deletedTodo,
        todos: todos.slice(0, 10)
      },
      _meta: {
        fullData: { todos, deletedTodo }
      }
    };
  }
);

// Register tool: clear_completed
server.registerTool(
  'clear_completed',
  {
    title: 'Clear Completed Todos',
    description: 'Remove all completed todo items from the list',
    inputSchema: {},
    _meta: {
      'openai/outputTemplate': WIDGET_URI,
      'openai/toolInvocation/invoking': 'Clearing completed todos...',
      'openai/toolInvocation/invoked': 'Completed todos cleared',
      'openai/widgetAccessible': true,
      'openai/resultCanProduceWidget': true,
      'openai/readOnlyHint': false,
      'annotations': {
        'destructiveHint': true,
        'openWorldHint': false,
        'readOnlyHint': false
      }
    }
  },
  async () => {
    const completedCount = todos.filter(t => t.completed).length;
    todos = todos.filter(t => !t.completed);

    return {
      content: [{
        type: 'text',
        text: `Cleared ${completedCount} completed todo(s). You now have ${todos.length} todo(s) remaining.`
      }],
      structuredContent: {
        clearedCount: completedCount,
        todos: todos.slice(0, 10)
      },
      _meta: {
        fullData: { todos, clearedCount: completedCount }
      }
    };
  }
);

// Create Express app
const app = express();

// CORS middleware - Allow ChatGPT and sandbox domains per OpenAI Apps SDK standard
app.use((req, res, next) => {
  const origin = req.headers.origin;

  // Allow ChatGPT domains and sandbox iframes (required for widget embedding)
  // Per OpenAI Apps SDK: specific origins, not wildcards
  if (origin && (
    origin === 'https://chatgpt.com' ||
    origin === 'https://chat.openai.com' ||
    origin.includes('chatgpt-com') && origin.includes('oaiusercontent.com')
  )) {
    res.header('Access-Control-Allow-Origin', origin);
  }

  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());

// Cache for widget file names (refreshed periodically)
let widgetFiles = { js: '', css: '' };
let lastFetch = 0;
const CACHE_TTL = 60000; // 1 minute

// Discover hashed widget filenames from index.html
async function discoverWidgetFiles() {
  const now = Date.now();
  if (widgetFiles.js && widgetFiles.css && now - lastFetch < CACHE_TTL) {
    return widgetFiles;
  }

  try {
    const response = await fetch(WIDGET_URL + '/index.html');
    const html = await response.text();

    // Extract JS filename: <script ... src="/widget.js"> or <script ... src="/widget-abc123.js">
    const jsMatch = html.match(/src="\/(widget(?:-[a-f0-9]+)?\.js)"/);
    if (jsMatch) widgetFiles.js = jsMatch[1];

    // Extract CSS filename: <link ... href="/widget.css"> or <link ... href="/widget-abc123.css">
    const cssMatch = html.match(/href="\/(widget(?:-[a-f0-9]+)?\.css)"/);
    if (cssMatch) widgetFiles.css = cssMatch[1];

    lastFetch = now;
    console.log('Discovered widget files:', widgetFiles);
  } catch (error) {
    console.error('Error discovering widget files:', error);
  }

  return widgetFiles;
}

// Serve widget CSS with CORS headers
app.get('/widget.css', async (req, res) => {
  try {
    const files = await discoverWidgetFiles();
    if (!files.css) {
      return res.status(404).send('/* Widget CSS not found */');
    }

    const response = await fetch(WIDGET_URL + '/' + files.css);
    const css = await response.text();
    res.setHeader('Content-Type', 'text/css');
    res.send(css);
  } catch (error) {
    console.error('Error fetching widget CSS:', error);
    res.status(500).send('/* Error loading widget CSS */');
  }
});

// Serve widget JS with CORS headers
app.get('/widget.js', async (req, res) => {
  try {
    const files = await discoverWidgetFiles();
    if (!files.js) {
      return res.status(404).send('// Widget JS not found');
    }

    const response = await fetch(WIDGET_URL + '/' + files.js);
    const js = await response.text();
    res.setHeader('Content-Type', 'application/javascript');
    res.send(js);
  } catch (error) {
    console.error('Error fetching widget JS:', error);
    res.status(500).send('// Error loading widget JS');
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// MCP endpoint with Streamable HTTP transport
app.post('/mcp', async (req, res) => {
  try {
    // Create new transport for each request (stateless mode)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Enable stateless mode
      enableJsonResponse: true
    });

    // Clean up transport when connection closes
    res.on('close', () => {
      transport.close();
    });

    // Connect server to transport and handle request
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Start server
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log('MCP server listening on port ' + PORT);
  console.log('Backend URL: ' + BACKEND_URL);
  console.log('Widget source: ' + WIDGET_URL);
  console.log('Serving widget files through backend with CORS headers');
});