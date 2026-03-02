import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Workflow } from '../types/index.js';
import { StorageService } from '../services/storage.js';
import { WorkflowService } from '../services/workflow.js';

const router = Router();

// GET /api/workflows — list all workflows
router.get('/', (req: Request, res: Response) => {
  try {
    const storage: StorageService = req.app.locals.storage;
    const workflows = storage.listWorkflows();
    res.json(workflows);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// GET /api/workflows/:id — get single workflow
router.get('/:id', (req: Request, res: Response) => {
  try {
    const storage: StorageService = req.app.locals.storage;
    const workflow = storage.loadWorkflow(req.params.id);
    if (!workflow) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }
    res.json(workflow);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// POST /api/workflows/extract — extract workflow from conversation
router.post('/extract', async (req: Request, res: Response) => {
  try {
    const workflowService: WorkflowService = req.app.locals.workflowService;
    const storage: StorageService = req.app.locals.storage;
    const { conversationId, provider, model } = req.body;

    if (!conversationId || !provider) {
      res.status(400).json({ error: 'conversationId and provider are required' });
      return;
    }

    const settings = storage.loadSettings();
    const apiKey = settings.apiKeys[provider as keyof typeof settings.apiKeys];
    const workflow = await workflowService.extractWorkflow(
      conversationId,
      provider,
      apiKey,
      model
    );
    res.json(workflow);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// PUT /api/workflows/:id — update workflow
router.put('/:id', (req: Request, res: Response) => {
  try {
    const storage: StorageService = req.app.locals.storage;
    const workflow = req.body as Workflow;
    workflow.id = req.params.id;
    workflow.updated = new Date().toISOString();
    const existing = storage.loadWorkflow(req.params.id);
    workflow.created = workflow.created || existing?.created || workflow.updated;
    storage.saveWorkflow(workflow);
    res.json(workflow);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// PATCH /api/workflows/:id/toggle — toggle workflow enabled state
router.patch('/:id/toggle', (req: Request, res: Response) => {
  try {
    const storage: StorageService = req.app.locals.storage;
    const workflow = storage.loadWorkflow(req.params.id);
    if (!workflow) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }
    workflow.enabled = workflow.enabled === false ? true : false;
    workflow.updated = new Date().toISOString();
    storage.saveWorkflow(workflow);
    res.json({ id: workflow.id, enabled: workflow.enabled });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// DELETE /api/workflows/:id — delete workflow
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const storage: StorageService = req.app.locals.storage;
    storage.deleteWorkflow(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// POST /api/workflows/:id/execute — execute workflow (SSE stream)
router.post('/:id/execute', async (req: Request, res: Response) => {
  try {
    const workflowService: WorkflowService = req.app.locals.workflowService;
    const { parameters } = req.body;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    for await (const event of workflowService.execute(req.params.id, parameters || {})) {
      res.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
    }

    res.end();
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: String(error) });
    } else {
      res.write(`event: error\ndata: ${JSON.stringify({ error: String(error) })}\n\n`);
      res.end();
    }
  }
});

export default router;

// Separate router for executions (mounted at /api/executions)
export const executionRoutes = Router();

executionRoutes.get('/:id', (req: Request, res: Response) => {
  try {
    const storage: StorageService = req.app.locals.storage;
    const execution = storage.loadExecution(req.params.id);
    if (!execution) {
      res.status(404).json({ error: 'Execution not found' });
      return;
    }
    res.json(execution);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});
