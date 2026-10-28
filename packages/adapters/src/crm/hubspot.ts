import {
  DEFAULT_FIELD_MAP,
  type Credentials,
  type CrmCreateContactInput,
  type CrmCreateContactResult,
} from '@hautomai/core';
import { httpJson, ProviderConfigError, credString } from '../util.js';

const API_ROOT = 'https://api.hubapi.com';

/**
 * HubSpot CRM adapter. Maps logical onboarding fields to HubSpot contact
 * properties via the client's fieldMap.
 *
 * NOTE: live sends only work when real credentials exist (API placeholder).
 */
export function createHubspotCrm(creds: Credentials | undefined) {
  return {
    id: 'hubspot',
    label: 'HubSpot CRM',
    async createContact(input: CrmCreateContactInput): Promise<CrmCreateContactResult> {
      const token = credString(creds, 'accessToken');
      if (!token) {
        throw new ProviderConfigError(
          'HubSpot is selected but no accessToken credential is configured (placeholder).',
        );
      }
      const fieldMap = input.fieldMap ?? DEFAULT_FIELD_MAP;
      const properties: Record<string, string> = {
        firstname: input.computed.firstName,
        lastname: input.computed.lastName,
        email: input.customer.email,
        phone: input.customer.phone ?? '',
      };
      const map: Record<string, string | undefined> = {
        'package': input.computed.package,
        'signup_date': input.computed.signupDate,
        'source': input.computed.source,
        'onboarding_status': input.computed.onboardingStatus,
      };
      for (const [logical, value] of Object.entries(map)) {
        const property = fieldMap?.[logical];
        if (property && value !== undefined) {
          properties[property] = value;
        }
      }
      const payload = { properties };
      const data = await httpJson<{ id: string }>(`${API_ROOT}/crm/v3/objects/contacts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      return { externalId: data.id ?? null };
    },
  };
}