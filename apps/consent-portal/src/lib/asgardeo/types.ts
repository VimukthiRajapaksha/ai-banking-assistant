/** Wire types of Asgardeo's Consent Management API v2 -- the subset this app
 * reads. Field names are Asgardeo's, unchanged. */

export type ConsentState = 'PENDING' | 'ACTIVE' | 'REJECTED' | 'REVOKED' | 'EXPIRED';
export type AuthorizationState = 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED' | 'EXPIRED';

export interface Authorization {
  userId?: string | null;
  state: AuthorizationState;
  updatedTime: number;
}

export interface ConsentedElement {
  id: string;
  name: string;
  displayName?: string;
}

export interface ConsentedPurpose {
  id: string;
  name: string;
  type: string;
  versionId: string;
  version?: string | null;
  /** Present on a single consent; absent from list results. */
  elements?: ConsentedElement[];
  properties?: Record<string, string> | null;
}

export interface Consent {
  id: string;
  subjectId: string;
  serviceId: string;
  state: ConsentState;
  language?: string;
  /** Epoch ms, when the consent was requested. */
  timestamp: number;
  expiryTime?: number | null;
  purposes?: ConsentedPurpose[];
  authorizations?: Authorization[];
  properties?: Record<string, string> | null;
}

export interface PaginationLink {
  rel: 'next' | 'previous';
  href: string;
}

export interface ConsentList {
  totalResults: number;
  links: PaginationLink[];
  Consents: Consent[];
}

export interface PurposeElement {
  id: string;
  name: string;
  displayName?: string | null;
  description?: string | null;
  mandatory: boolean;
}

export interface PurposeVersion {
  id: string;
  version: string;
  description?: string | null;
  elements: PurposeElement[];
  properties?: Record<string, string> | null;
}
