import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env.js';

// Initialize Gemini
const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY || '');
const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });

/**
 * Helper to retry Gemini calls on 429 Rate Limit errors
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries = 3,
  delay = 2000,
): Promise<T> {
  try {
    return await fn();
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };
    if (retries > 0 && (err.status === 429 || err.message?.includes('429'))) {
      console.warn(
        `⚠️ Gemini Rate Limit Hit. Retrying in ${delay}ms... (Attempts left: ${retries})`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      return retryWithBackoff(fn, retries - 1, delay * 2);
    }
    throw error;
  }
}

interface OCRResult {
  name?: string;
  number?: string;
  issuingCountry?: string;
  issueDate?: string;
  expiryDate?: string;
  dateOfBirth?: string;
  rawText?: string;
}

/**
 * Analyze Document using Gemini Vision
 */
export const analyzeDocument = async (
  fileBuffer: Buffer,
  mimeType: string,
): Promise<OCRResult> => {
  try {
    if (!env.GEMINI_API_KEY) {
      console.warn('⚠️ GEMINI_API_KEY is not set. Skipping OCR.');
      return {};
    }

    const prompt = `
      Analyze this document image (it may be a maritime certificate or a personal identity document like a passport, driving license, national ID, or residence permit).
      Extract the following fields in strict JSON format:
      1. name (Name of the person)
      2. number (Certificate, License, Passport, or ID number)
      3. issuingCountry (Country of issue)
      4. issueDate (YYYY-MM-DD format)
      5. expiryDate (YYYY-MM-DD format)
      6. dateOfBirth (Date of birth of the person, YYYY-MM-DD format, if visible on the document)

      If a field is not visible, return null. Return ONLY the JSON object.
    `;

    const imagePart = {
      inlineData: {
        data: fileBuffer.toString('base64'),
        mimeType,
      },
    };

    const result = await retryWithBackoff(() =>
      model.generateContent([prompt, imagePart]),
    );
    const response = await result.response;
    const text = response.text();

    // Clean markdown code blocks if present
    const cleanJson = text.replace(/```json|```/g, '').trim();

    try {
      return JSON.parse(cleanJson);
    } catch (error) {
      console.error('❌ Failed to parse Gemini JSON:', text, error);
      return { rawText: text };
    }
  } catch (error) {
    console.error('❌ Gemini OCR Error:', error);
    throw new Error('OCR Failed');
  }
};

/**
 * Validate Document Type
 */
export const validateDocumentType = async (
  fileBuffer: Buffer,
  mimeType: string,
  expectedCategory: string,
): Promise<boolean> => {
  try {
    if (!env.GEMINI_API_KEY) return true; // Skip if no key

    const prompt = `
      Is this image a valid maritime document of type "${expectedCategory}"? 
      Examples: "Medical Certificate", "Passport", "STCW Certificate", "Seaman Book".
      Return strictly "YES" or "NO".
    `;

    const imagePart = {
      inlineData: {
        data: fileBuffer.toString('base64'),
        mimeType,
      },
    };

    const result = await retryWithBackoff(() =>
      model.generateContent([prompt, imagePart]),
    );
    const response = await result.response;
    const text = response.text().trim().toUpperCase();

    return text.includes('YES');
  } catch (error) {
    console.error('❌ Gemini Validation Error:', error);
    return true; // Default to allow on error
  }
};
