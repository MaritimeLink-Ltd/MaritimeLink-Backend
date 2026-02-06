import { env } from '../config/env.js';

async function listModels() {
  console.log('🔍 Listing available Gemini models...');

  try {
    // Hack directly to API because SDK listModels might need specific setup
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('❌ No API KEY found.');
      return;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.models) {
      console.log('✅ Available Models:');
      data.models.forEach(
        (m: { name: string; supportedGenerationMethods: string[] }) => {
          console.log(
            `- ${m.name} (Supported methods: ${m.supportedGenerationMethods})`,
          );
        },
      );
    } else {
      console.error('❌ Failed to list models:', JSON.stringify(data, null, 2));
    }
  } catch (error) {
    console.error('❌ Error listing models:', error);
  }
}

listModels();
