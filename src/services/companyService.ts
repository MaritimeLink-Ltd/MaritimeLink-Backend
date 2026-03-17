/**
 * Service to fetch company metadata (logo, name) from a domain.
 */
export const getCompanyMetadata = async (domain: string) => {
  try {
    // We use Google's favicon service which is highly reliable
    const logoUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;

    // Extracting name from domain (e.g., "google.com" -> "Google")
    const companyName =
      domain.split('.')[0].charAt(0).toUpperCase() +
      domain.split('.')[0].slice(1);

    return {
      name: companyName,
      logo: logoUrl,
      domain: domain,
    };
  } catch (error) {
    console.error('Error fetching company metadata:', error);
    return null;
  }
};
