/**
 * Single-file Express v5 + TypeScript server to test Gemini API requests
 * using the @google/genai SDK, reading request JSON files from ./test-fixtures.
 *
 * SETUP:
 *   npm install @google/genai   (already installed)
 *   GEMINI_API_KEY must be set in .env
 *
 * RUN:
 *   npx tsx test.ts
 *
 * TEST:
 *   Open in browser or curl:
 *   http://localhost:3000/test/document-ocr
 *   http://localhost:3000/test/company-lookup
 */

import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import { GoogleGenAI, ContentListUnion } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------

dotenv.config({ override: true });

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY is not set. Add it to your .env file.');
}

const MODEL_ID = 'gemini-3-flash-preview';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'test-fixtures');

// ---------------------------------------------------------------------------
// SETUP
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

interface GeminiRequestBody {
  contents: unknown;
  generationConfig?: Record<string, unknown>;
  config?: Record<string, unknown>;
  tools?: unknown;
  [key: string]: unknown;
}

function loadRequestBody(filename: string): GeminiRequestBody {
  const filePath = path.join(FIXTURES_DIR, filename);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Request file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf-8');

  try {
    return JSON.parse(raw) as GeminiRequestBody;
  } catch (err) {
    throw new Error(
      `Failed to parse ${filename} as JSON. Check the file is valid JSON. Original error: ${
        (err as Error).message
      }`,
    );
  }
}

async function callGemini(filename: string) {
  const body = loadRequestBody(filename);

  const config: Record<string, unknown> = {
    ...(body.generationConfig ?? {}),
    ...(body.config ?? {}),
  };
  if (body.tools) {
    config.tools = body.tools;
  }

  const response = await ai.models.generateContent({
    model: MODEL_ID,
    contents: body.contents as ContentListUnion,
    ...(Object.keys(config).length ? { config } : {}),
  });

  return response;
}

// ---------------------------------------------------------------------------
// ROUTES
// ---------------------------------------------------------------------------

app.get('/', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    endpoints: ['/test/document-ocr', '/test/company-lookup'],
  });
});

app.get('/test/document-ocr', async (_req: Request, res: Response) => {
  try {
    const response = await callGemini('document_ocr_request.json');
    res.json({ success: true, text: response.text, raw: response });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

app.get('/test/company-lookup', async (_req: Request, res: Response) => {
  try {
    const response = await callGemini('company_lookup_request.json');
    res.json({ success: true, text: response.text, raw: response });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// START SERVER
// ---------------------------------------------------------------------------

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('  GET /test/document-ocr');
  console.log('  GET /test/company-lookup');
});
