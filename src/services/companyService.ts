import axios from 'axios';
import { env } from '../config/env.js';
import { KycRiskLevel } from '../generated/client/index.js';

type GeminiGroundingMetadata = {
  webSearchQueries?: string[];
  groundingChunks?: Array<{
    web?: {
      uri?: string;
      title?: string;
    };
  }>;
};

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
    groundingMetadata?: GeminiGroundingMetadata;
  }>;
};

export type CompanyDetailsInput = {
  organizationName?: string | null;
  address?: string | null;
  companyCity?: string | null;
  companyState?: string | null;
  companyZip?: string | null;
  companyCountry?: string | null;
  website?: string | null;
  companyLinkedIn?: string | null;
};

export type GeminiCompanyDetails = {
  name?: string | null;
  registration_number?: string | null;
  country_code?: string | null;
  company_phone?: string[] | null;
  company_email?: string[] | null;
  company_website?: string | null;
  company_legal_form?: string | null;
  status?: string | null;
  brands?: string | null;
  address_street?: string | null;
  address_location?: string | null;
  address_city?: string | null;
  country_region?: string | null;
  zip_code?: string | null;
  country_name?: string | null;
  size?: string | null;
  vat_number?: string | null;
  founding_date?: string | null;
  industry?: Array<{ value?: string | null }> | null;
  linkedin?: string | null;
  logo?: string | null;
  source?: 'GEMINI_GOOGLE_SEARCH' | null;
  sources?: Array<{ title?: string; uri?: string }>;
  searchQueries?: string[];
};

type CompanyMismatch = {
  field: string;
  entered: string;
  external: string;
};

const GEMINI_SEARCH_MODEL = 'gemini-2.0-flash';

const normalizeText = (value?: string | null) =>
  value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || '';

const normalizeDomain = (value?: string | null) =>
  value
    ?.trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0] || '';

const getFallbackName = (domain: string) =>
  domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1);

const getFaviconUrl = (domain: string) =>
  `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;

const extractJsonObject = (text: string) => {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Gemini response did not contain a JSON object');
  }

  return JSON.parse(cleaned.slice(start, end + 1)) as GeminiCompanyDetails;
};

const getGroundingSources = (metadata?: GeminiGroundingMetadata) =>
  metadata?.groundingChunks
    ?.map((chunk) => chunk.web)
    .filter((web): web is { uri?: string; title?: string } => Boolean(web))
    .map((web) => ({
      title: web.title,
      uri: web.uri,
    })) || [];

export const fetchGeminiCompanyDetails = async (
  input: CompanyDetailsInput,
): Promise<GeminiCompanyDetails | null> => {
  if (!env.GEMINI_API_KEY) {
    console.warn('GEMINI_API_KEY is not set. Skipping company lookup.');
    return null;
  }

  if (env.NODE_ENV === 'test') {
    return null;
  }

  const domain = normalizeDomain(input.website);
  const companyHint = input.organizationName || domain;

  if (!companyHint) return null;

  const prompt = `
You are verifying company registration details for a maritime recruiting/training platform.
Use Google Search grounding to find the best public information for this company.

Input:
- Company name: ${input.organizationName || 'unknown'}
- Website/domain: ${domain || 'unknown'}
- LinkedIn: ${input.companyLinkedIn || 'unknown'}
- Entered address: ${input.address || 'unknown'}, ${input.companyCity || 'unknown'}, ${input.companyState || 'unknown'}, ${input.companyZip || 'unknown'}, ${input.companyCountry || 'unknown'}

Return ONLY valid JSON. Do not wrap in markdown. Use null when unknown.
Schema:
{
  "name": string | null,
  "registration_number": string | null,
  "country_code": string | null,
  "company_phone": string[] | null,
  "company_email": string[] | null,
  "company_website": string | null,
  "company_legal_form": string | null,
  "status": string | null,
  "brands": string | null,
  "address_street": string | null,
  "address_location": string | null,
  "address_city": string | null,
  "country_region": string | null,
  "zip_code": string | null,
  "country_name": string | null,
  "size": string | null,
  "vat_number": string | null,
  "founding_date": string | null,
  "industry": [{"value": string}] | null,
  "linkedin": string | null,
  "logo": string | null
}
`;

  try {
    const response = await axios.post<GeminiGenerateContentResponse>(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_SEARCH_MODEL}:generateContent`,
      {
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        tools: [{ google_search: {} }],
      },
      {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': env.GEMINI_API_KEY,
        },
      },
    );

    const candidate = response.data.candidates?.[0];
    const text = candidate?.content?.parts?.map((part) => part.text).join('');
    if (!text) return null;

    const details = extractJsonObject(text);
    const groundingMetadata = candidate?.groundingMetadata;

    return {
      ...details,
      company_website:
        details.company_website || (domain ? `https://${domain}` : null),
      logo: details.logo || (domain ? getFaviconUrl(domain) : null),
      source: 'GEMINI_GOOGLE_SEARCH',
      sources: getGroundingSources(groundingMetadata),
      searchQueries: groundingMetadata?.webSearchQueries || [],
    };
  } catch (error) {
    console.error('Error fetching Gemini company details:', error);
    return null;
  }
};

export const compareCompanyDetails = (
  entered: CompanyDetailsInput,
  external: GeminiCompanyDetails | null,
) => {
  const mismatches: CompanyMismatch[] = [];

  const compareText = (
    field: string,
    enteredValue?: string | null,
    externalValue?: string | null,
  ) => {
    if (!enteredValue || !externalValue) return;
    if (normalizeText(enteredValue) !== normalizeText(externalValue)) {
      mismatches.push({
        field,
        entered: enteredValue,
        external: externalValue,
      });
    }
  };

  const compareDomain = (
    field: string,
    enteredValue?: string | null,
    externalValue?: string | null,
  ) => {
    if (!enteredValue || !externalValue) return;
    if (normalizeDomain(enteredValue) !== normalizeDomain(externalValue)) {
      mismatches.push({
        field,
        entered: enteredValue,
        external: externalValue,
      });
    }
  };

  if (external) {
    const externalAddress = [external.address_street, external.address_location]
      .filter(Boolean)
      .join(', ');

    compareText('organizationName', entered.organizationName, external.name);
    compareText('address', entered.address, externalAddress);
    compareText('companyCity', entered.companyCity, external.address_city);
    compareText('companyState', entered.companyState, external.country_region);
    compareText('companyZip', entered.companyZip, external.zip_code);
    compareText(
      'companyCountry',
      entered.companyCountry,
      external.country_name,
    );
    compareDomain('website', entered.website, external.company_website);
    compareDomain(
      'companyLinkedIn',
      entered.companyLinkedIn,
      external.linkedin,
    );
  }

  return {
    mismatchDetected: mismatches.length > 0,
    riskLevel: mismatches.length > 0 ? KycRiskLevel.HIGH : KycRiskLevel.LOW,
    mismatchDetails:
      mismatches.length > 0
        ? JSON.stringify({ source: 'GEMINI_GOOGLE_SEARCH', mismatches })
        : null,
  };
};

/**
 * Service to fetch company metadata (logo, name) from a domain.
 */
export const getCompanyMetadata = async (domain: string) => {
  const normalizedDomain = normalizeDomain(domain);
  const fallback = {
    name: getFallbackName(normalizedDomain),
    logo: getFaviconUrl(normalizedDomain),
    domain: normalizedDomain,
    details: null,
    source: null,
  };

  if (!normalizedDomain) return null;

  try {
    const details = await fetchGeminiCompanyDetails({
      website: normalizedDomain,
    });

    return {
      name: details?.name || fallback.name,
      logo: details?.logo || fallback.logo,
      domain: normalizedDomain,
      details,
      source: details?.source || null,
      sources: details?.sources || [],
      searchQueries: details?.searchQueries || [],
    };
  } catch (error) {
    console.error('Error fetching company metadata:', error);
    return fallback;
  }
};
