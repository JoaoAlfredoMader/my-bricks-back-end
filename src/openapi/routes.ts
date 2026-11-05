import { agencyBodySchema, agencyIdParamSchema, listAgenciesQuerySchema } from "../modules/agencies/agencies.route.js";
import { listAdminAuditLogsQuerySchema, listAuditLogsQuerySchema } from "../modules/audit/audit.schemas.js";
import { contractPdfParamSchema } from "../modules/contract-documents/contract-documents.route.js";
import { updateTemplateSchema } from "../modules/contract-templates/contract-templates.schemas.js";
import { clientIdParamSchema, createClientSchema, listClientsQuerySchema, updateClientSchema } from "../modules/clients/clients.schemas.js";
import {
  contractIdParamSchema,
  createContractSchema,
  endContractSchema,
  listContractsQuerySchema,
  updateContractSchema,
} from "../modules/contracts/contracts.schemas.js";
import {
  documentParamsSchema,
  listDocumentsQuerySchema,
  propertyParamSchema as documentsPropertyParamSchema,
  updateDocumentSchema,
  uploadDocumentSchema,
} from "../modules/documents/documents.schemas.js";
import {
  createFeedbackSchema,
  feedbackIdParamSchema,
  listFeedbackQuerySchema,
  updateFeedbackSchema,
} from "../modules/feedback/feedback.schemas.js";
import { portfolioQuerySchema, propertyKpisParamSchema, propertyKpisQuerySchema } from "../modules/kpis/kpis.route.js";
import { searchCitiesQuerySchema } from "../modules/lookups/lookups.route.js";
import { listOccupantsQuerySchema } from "../modules/occupants/occupants.route.js";
import {
  photoParamsSchema,
  propertyParamSchema as photosPropertyParamSchema,
  reorderPhotosSchema,
  uploadPhotoSchema,
} from "../modules/photos/photos.schemas.js";
import {
  createPropertySchema,
  financingScheduleQuerySchema,
  listPropertiesQuerySchema,
  propertyIdParamSchema,
  updatePropertySchema,
} from "../modules/properties/properties.schemas.js";
import {
  createProposalSchema,
  listProposalsQuerySchema,
  propertyParamSchema as proposalsPropertyParamSchema,
  proposalParamsSchema,
  updateProposalSchema,
} from "../modules/proposals/proposals.schemas.js";
import {
  createReservationSchema,
  listReservationsQuerySchema,
  reservationIdParamSchema,
  updateReservationSchema,
} from "../modules/reservations/reservations.schemas.js";
import {
  createTransactionSchema,
  listTransactionsQuerySchema,
  transactionIdParamSchema,
  updateTransactionSchema,
} from "../modules/transactions/transactions.schemas.js";
import type { Operation } from "./operations.js";
import { input } from "./schemas/common.js";
import {
  agencyPageSchema,
  agencySchema,
  clientPageSchema,
  clientSchema,
  contractCreatedSchema,
  contractPageSchema,
  contractSchema,
  occupantPageSchema,
  propertyPageSchema,
  propertySchema,
  proposalPageSchema,
  proposalSchema,
  reservationPageSchema,
  reservationSchema,
  transactionPageSchema,
  transactionSchema,
} from "./schemas/entities.js";
import { financingScheduleSchema, portfolioKpisSchema, propertyKpisSchema } from "./schemas/insights.js";
import {
  adminFeedbackPageSchema,
  adminFeedbackSchema,
  auditLogPageSchema,
  cityListSchema,
  contractPdfSchema,
  contractTemplateSchema,
  documentListSchema,
  documentSchema,
  feedbackPageSchema,
  feedbackSchema,
  healthSchema,
  photoListSchema,
  photoSchema,
  propertyCatalogSchema,
  sessionSchema,
  transactionCategoryListSchema,
} from "./schemas/platform.js";

// Request bodies become named components of the spec.
const createClient = input("CreateClientRequest", createClientSchema);
const updateClient = input("UpdateClientRequest", updateClientSchema);
const agencyBody = input("AgencyRequest", agencyBodySchema);
const createProperty = input("CreatePropertyRequest", createPropertySchema);
const updateProperty = input("UpdatePropertyRequest", updatePropertySchema);
const createContract = input("CreateContractRequest", createContractSchema);
const updateContract = input("UpdateContractRequest", updateContractSchema);
const endContract = input("EndContractRequest", endContractSchema);
const createReservation = input("CreateReservationRequest", createReservationSchema);
const updateReservation = input("UpdateReservationRequest", updateReservationSchema);
const createTransaction = input("CreateTransactionRequest", createTransactionSchema);
const updateTransaction = input("UpdateTransactionRequest", updateTransactionSchema);
const createProposal = input("CreateProposalRequest", createProposalSchema);
const updateProposal = input("UpdateProposalRequest", updateProposalSchema);
const reorderPhotos = input("ReorderPhotosRequest", reorderPhotosSchema);
const updateDocument = input("UpdateDocumentRequest", updateDocumentSchema);
const updateTemplate = input("UpdateContractTemplateRequest", updateTemplateSchema);
const createFeedback = input("CreateFeedbackRequest", createFeedbackSchema);
const updateFeedback = input("UpdateFeedbackStatusRequest", updateFeedbackSchema);

const ok = (description: string, schema: Operation["response"]["schema"]): Operation["response"] => ({ status: 200, description, schema });
const created = (description: string, schema: Operation["response"]["schema"]): Operation["response"] => ({ status: 201, description, schema });
const noContent = (description: string): Operation["response"] => ({ status: 204, description });

/**
 * Every endpoint of the API, described once. It is the source of the OpenAPI document, and a test
 * compares it with the routes the app actually registers, in both directions: an endpoint that is
 * added without being described, or described without existing, fails the build.
 */
export const OPERATIONS: readonly Operation[] = [
  // ── Health ──
  { id: "getHealth", method: "get", path: "/health", tag: "Health", summary: "Liveness and database check", access: "public", response: ok("The service is up; 503 when the database is down", healthSchema) },

  // ── Session ──
  { id: "getSession", method: "get", path: "/api/me", tag: "Session", summary: "Who am I and which organization am I working in", description: "The organization comes from the session and is never sent by the client. While a platform admin impersonates a user, `impersonatedById` is set.", access: "session", response: ok("The session context", sessionSchema) },

  // ── Reference data ──
  { id: "searchCities", method: "get", path: "/api/lookups/cities", tag: "Reference data", summary: "Search Brazilian municipalities", description: "Accent-insensitive: \"sao paulo\" finds \"São Paulo\".", access: "session", query: searchCitiesQuerySchema, response: ok("Matching municipalities, by name", cityListSchema) },
  { id: "getPropertyCatalog", method: "get", path: "/api/lookups/property-catalog", tag: "Reference data", summary: "Property types with their subtypes and allowed usages", access: "session", response: ok("One entry per property type", propertyCatalogSchema) },
  { id: "listTransactionCategories", method: "get", path: "/api/lookups/transaction-categories", tag: "Reference data", summary: "Revenue and expense categories", description: "The category decides whether a transaction is revenue or expense.", access: "session", response: ok("The categories, revenues first", transactionCategoryListSchema) },

  // ── Clients ──
  { id: "listClients", method: "get", path: "/api/clients", tag: "Clients", summary: "List clients", description: "Owners and admins see every client of the organization; members only the ones they created.", access: "session", query: listClientsQuerySchema, response: ok("A page of clients", clientPageSchema) },
  { id: "createClient", method: "post", path: "/api/clients", tag: "Clients", summary: "Create a client", access: "session", body: createClient, response: created("The new client", clientSchema), errors: [409] },
  { id: "getClient", method: "get", path: "/api/clients/:id", tag: "Clients", summary: "Get a client", access: "session", params: clientIdParamSchema, response: ok("The client", clientSchema) },
  { id: "updateClient", method: "patch", path: "/api/clients/:id", tag: "Clients", summary: "Update a client", description: "Any subset of the fields. `null` clears an optional field.", access: "session", params: clientIdParamSchema, body: updateClient, response: ok("The updated client", clientSchema), errors: [409] },
  { id: "deleteClient", method: "delete", path: "/api/clients/:id", tag: "Clients", summary: "Delete a client", description: "Refused with 409 while the client still owns properties.", access: "session", params: clientIdParamSchema, response: noContent("Deleted"), errors: [409] },

  // ── Agencies ──
  { id: "listAgencies", method: "get", path: "/api/agencies", tag: "Agencies", summary: "List agencies", description: "Agencies are shared by every member of the organization.", access: "session", query: listAgenciesQuerySchema, response: ok("A page of agencies", agencyPageSchema) },
  { id: "createAgency", method: "post", path: "/api/agencies", tag: "Agencies", summary: "Create an agency", access: "session", body: agencyBody, response: created("The new agency", agencySchema), errors: [409] },
  { id: "getAgency", method: "get", path: "/api/agencies/:id", tag: "Agencies", summary: "Get an agency", access: "session", params: agencyIdParamSchema, response: ok("The agency", agencySchema) },
  { id: "updateAgency", method: "patch", path: "/api/agencies/:id", tag: "Agencies", summary: "Rename an agency", access: "session", params: agencyIdParamSchema, body: agencyBody, response: ok("The updated agency", agencySchema), errors: [409] },
  { id: "deleteAgency", method: "delete", path: "/api/agencies/:id", tag: "Agencies", summary: "Delete an agency", description: "Refused with 409 while a property still uses it.", access: "session", params: agencyIdParamSchema, response: noContent("Deleted"), errors: [409] },

  // ── Properties ──
  { id: "listProperties", method: "get", path: "/api/properties", tag: "Properties", summary: "List properties", access: "session", query: listPropertiesQuerySchema, response: ok("A page of properties", propertyPageSchema) },
  { id: "createProperty", method: "post", path: "/api/properties", tag: "Properties", summary: "Create a property", description: "Address, manual rental, acquisition, financing, legal record and insurance are nested. Cross-field rules are checked: the usage must be allowed for the type, the subtype must belong to it, only parking has a spot label, a financing needs a purchase or construction acquisition.", access: "session", body: createProperty, response: created("The new property", propertySchema) },
  { id: "getProperty", method: "get", path: "/api/properties/:id", tag: "Properties", summary: "Get a property", access: "session", params: propertyIdParamSchema, response: ok("The property", propertySchema) },
  { id: "updateProperty", method: "patch", path: "/api/properties/:id", tag: "Properties", summary: "Update a property", description: "Any subset of the fields. `null` clears a nullable field. The nested blocks (address, manualRental, acquisition, financing, legalRecord, insurance) are replaced as a whole, and `null` removes them.", access: "session", params: propertyIdParamSchema, body: updateProperty, response: ok("The updated property", propertySchema) },
  { id: "deleteProperty", method: "delete", path: "/api/properties/:id", tag: "Properties", summary: "Delete a property", description: "Removes everything attached to it: contracts, reservations, transactions, proposals, photos and documents.", access: "session", params: propertyIdParamSchema, response: noContent("Deleted") },
  { id: "getFinancingSchedule", method: "get", path: "/api/properties/:id/financing-schedule", tag: "Properties", summary: "Financing schedule", description: "The SAC or Price installments and where the financing stands on `asOf`.", access: "session", params: propertyIdParamSchema, query: financingScheduleQuerySchema, response: ok("The schedule", financingScheduleSchema) },

  // ── Proposals ──
  { id: "listProposals", method: "get", path: "/api/properties/:propertyId/proposals", tag: "Proposals", summary: "List the proposals of a property", access: "session", params: proposalsPropertyParamSchema, query: listProposalsQuerySchema, response: ok("A page of proposals", proposalPageSchema) },
  { id: "createProposal", method: "post", path: "/api/properties/:propertyId/proposals", tag: "Proposals", summary: "Record a proposal", access: "session", params: proposalsPropertyParamSchema, body: createProposal, response: created("The new proposal", proposalSchema) },
  { id: "getProposal", method: "get", path: "/api/properties/:propertyId/proposals/:id", tag: "Proposals", summary: "Get a proposal", access: "session", params: proposalParamsSchema, response: ok("The proposal", proposalSchema) },
  { id: "updateProposal", method: "patch", path: "/api/properties/:propertyId/proposals/:id", tag: "Proposals", summary: "Update a proposal", access: "session", params: proposalParamsSchema, body: updateProposal, response: ok("The updated proposal", proposalSchema) },
  { id: "deleteProposal", method: "delete", path: "/api/properties/:propertyId/proposals/:id", tag: "Proposals", summary: "Delete a proposal", access: "session", params: proposalParamsSchema, response: noContent("Deleted") },

  // ── Photos ──
  { id: "listPhotos", method: "get", path: "/api/properties/:propertyId/photos", tag: "Photos", summary: "List the photos of a property", access: "session", params: photosPropertyParamSchema, response: ok("The photos in order; position 0 is the cover", photoListSchema) },
  { id: "uploadPhoto", method: "post", path: "/api/properties/:propertyId/photos", tag: "Photos", summary: "Upload a photo", description: "Multipart form with a `file` field: JPEG, PNG or WebP. The bytes must match the declared type. Up to 30 photos per property; the new one goes to the end.", access: "session", params: photosPropertyParamSchema, upload: uploadPhotoSchema, response: created("The new photo", photoSchema), errors: [413, 415, 422] },
  { id: "reorderPhotos", method: "put", path: "/api/properties/:propertyId/photos/order", tag: "Photos", summary: "Reorder the photos", description: "Send every photo of the property exactly once, in the wanted order.", access: "session", params: photosPropertyParamSchema, body: reorderPhotos, response: ok("The photos in the new order", photoListSchema) },
  { id: "getPhotoContent", method: "get", path: "/api/properties/:propertyId/photos/:id/content", tag: "Photos", summary: "The image", access: "session", params: photoParamsSchema, response: { status: 200, description: "The image, inline", binary: { contentType: "image/*" } } },
  { id: "deletePhoto", method: "delete", path: "/api/properties/:propertyId/photos/:id", tag: "Photos", summary: "Delete a photo", access: "session", params: photoParamsSchema, response: noContent("Deleted") },

  // ── Documents ──
  { id: "listDocuments", method: "get", path: "/api/properties/:propertyId/documents", tag: "Documents", summary: "List the documents of a property", access: "session", params: documentsPropertyParamSchema, query: listDocumentsQuerySchema, response: ok("The documents, newest first", documentListSchema) },
  { id: "uploadDocument", method: "post", path: "/api/properties/:propertyId/documents", tag: "Documents", summary: "Upload a document", description: "Multipart form with a `file` field (PDF, JPEG, PNG, WebP, DOCX or XLSX) and an optional `category`. The bytes must match the declared type.", access: "session", params: documentsPropertyParamSchema, upload: uploadDocumentSchema, response: created("The new document", documentSchema), errors: [413, 415] },
  { id: "updateDocument", method: "patch", path: "/api/properties/:propertyId/documents/:id", tag: "Documents", summary: "Change the category of a document", access: "session", params: documentParamsSchema, body: updateDocument, response: ok("The updated document", documentSchema) },
  { id: "getDocumentContent", method: "get", path: "/api/properties/:propertyId/documents/:id/content", tag: "Documents", summary: "Download the document", access: "session", params: documentParamsSchema, response: { status: 200, description: "The file, as an attachment, never cached", binary: { contentType: "application/octet-stream", description: "The type recorded when the file was uploaded" } } },
  { id: "deleteDocument", method: "delete", path: "/api/properties/:propertyId/documents/:id", tag: "Documents", summary: "Delete a document", access: "session", params: documentParamsSchema, response: noContent("Deleted") },

  // ── Contracts ──
  { id: "listContracts", method: "get", path: "/api/contracts", tag: "Contracts", summary: "List contracts", description: "Newest start first. Members only see contracts of the properties they created.", access: "session", query: listContractsQuerySchema, response: ok("A page of contracts", contractPageSchema) },
  { id: "createContract", method: "post", path: "/api/contracts", tag: "Contracts", summary: "Create a contract", description: "The occupant is `occupantId` or a new `occupant` (a known document reuses the stored one). If the property already has an active contract it is ended in the same transaction and `replacedContractId` says which. The property must be in contract rental mode and let out; short-stay contracts need a short-stay property and carry no rent terms.", access: "session", body: createContract, response: created("The new contract", contractCreatedSchema), errors: [409, 422] },
  { id: "getContract", method: "get", path: "/api/contracts/:id", tag: "Contracts", summary: "Get a contract", access: "session", params: contractIdParamSchema, response: ok("The contract", contractSchema) },
  { id: "updateContract", method: "patch", path: "/api/contracts/:id", tag: "Contracts", summary: "Update an active contract", description: "Contracts are never deleted: they are ended or cancelled. Only active ones can be edited (422 otherwise).", access: "session", params: contractIdParamSchema, body: updateContract, response: ok("The updated contract", contractSchema), errors: [422] },
  { id: "endContract", method: "post", path: "/api/contracts/:id/end", tag: "Contracts", summary: "End a contract", access: "session", params: contractIdParamSchema, body: endContract, response: ok("The ended contract", contractSchema), errors: [422] },
  { id: "cancelContract", method: "post", path: "/api/contracts/:id/cancel", tag: "Contracts", summary: "Cancel a contract", access: "session", params: contractIdParamSchema, response: ok("The cancelled contract", contractSchema), errors: [422] },
  { id: "generateContractPdf", method: "post", path: "/api/contracts/:id/pdf", tag: "Contracts", summary: "Generate the contract PDF", description: "Fills the organization's template (or the default one) and stores the PDF; generating again replaces the previous one. Only conventional contracts have a PDF.", access: "session", params: contractPdfParamSchema, response: ok("The generated PDF", contractPdfSchema), errors: [422] },
  { id: "downloadContractPdf", method: "get", path: "/api/contracts/:id/pdf", tag: "Contracts", summary: "Download the contract PDF", description: "404 until the PDF has been generated.", access: "session", params: contractPdfParamSchema, response: { status: 200, description: "The PDF, as an attachment, never cached", binary: { contentType: "application/pdf" } } },

  // ── Contract template ──
  { id: "getContractTemplate", method: "get", path: "/api/contract-template", tag: "Contract template", summary: "The contract template", description: "The organization's own template or, until it saves one, the default (`isDefault: true`).", access: "session", response: ok("The template and the catalog of tokens", contractTemplateSchema) },
  { id: "updateContractTemplate", method: "put", path: "/api/contract-template", tag: "Contract template", summary: "Save the contract template", description: "HTML is sanitized down to p, h1-h3, ul/ol/li, br, strong/b, em/i and u, without attributes. Unknown `{{tokens}}` are reported, not rejected.", access: "owner-admin", body: updateTemplate, response: ok("The saved template", contractTemplateSchema) },
  { id: "resetContractTemplate", method: "delete", path: "/api/contract-template", tag: "Contract template", summary: "Go back to the default template", access: "owner-admin", response: ok("The default template", contractTemplateSchema) },

  // ── Occupants ──
  { id: "listOccupants", method: "get", path: "/api/occupants", tag: "Occupants", summary: "List tenants and guests", description: "Occupants are created together with a contract or a reservation; this list lets a new one reuse them. Members only see those that appear in records of properties they created.", access: "session", query: listOccupantsQuerySchema, response: ok("A page of occupants", occupantPageSchema) },

  // ── Reservations ──
  { id: "listReservations", method: "get", path: "/api/reservations", tag: "Reservations", summary: "List reservations", description: "`from` / `to` keep the stays that overlap the window [from, to), which is what a calendar needs.", access: "session", query: listReservationsQuerySchema, response: ok("A page of reservations, latest check-in first", reservationPageSchema) },
  { id: "createReservation", method: "post", path: "/api/reservations", tag: "Reservations", summary: "Book a stay", description: "Only for properties with short-stay usage. Two confirmed reservations of a property cannot share a night (409 names the clashing one); the check-out day is free.", access: "session", body: createReservation, response: created("The new reservation", reservationSchema), errors: [409, 422] },
  { id: "getReservation", method: "get", path: "/api/reservations/:id", tag: "Reservations", summary: "Get a reservation", access: "session", params: reservationIdParamSchema, response: ok("The reservation", reservationSchema) },
  { id: "updateReservation", method: "patch", path: "/api/reservations/:id", tag: "Reservations", summary: "Update a confirmed reservation", access: "session", params: reservationIdParamSchema, body: updateReservation, response: ok("The updated reservation", reservationSchema), errors: [409, 422] },
  { id: "cancelReservation", method: "post", path: "/api/reservations/:id/cancel", tag: "Reservations", summary: "Cancel a reservation", description: "Reservations are never deleted; a cancelled one frees its dates.", access: "session", params: reservationIdParamSchema, response: ok("The cancelled reservation", reservationSchema), errors: [422] },

  // ── Transactions ──
  { id: "listTransactions", method: "get", path: "/api/transactions", tag: "Transactions", summary: "List transactions", description: "One-off or monthly-recurring revenues and expenses that are not rent. With `from` / `to`, recurring transactions are kept when their monthly occurrences touch the period (the end date counts by month, inclusive), not only when `occurredOn` is inside it.", access: "session", query: listTransactionsQuerySchema, response: ok("A page of transactions, latest first", transactionPageSchema) },
  { id: "createTransaction", method: "post", path: "/api/transactions", tag: "Transactions", summary: "Record a transaction", access: "session", body: createTransaction, response: created("The new transaction", transactionSchema) },
  { id: "getTransaction", method: "get", path: "/api/transactions/:id", tag: "Transactions", summary: "Get a transaction", access: "session", params: transactionIdParamSchema, response: ok("The transaction", transactionSchema) },
  { id: "updateTransaction", method: "patch", path: "/api/transactions/:id", tag: "Transactions", summary: "Update a transaction", access: "session", params: transactionIdParamSchema, body: updateTransaction, response: ok("The updated transaction", transactionSchema) },
  { id: "deleteTransaction", method: "delete", path: "/api/transactions/:id", tag: "Transactions", summary: "Delete a transaction", access: "session", params: transactionIdParamSchema, response: noContent("Deleted") },

  // ── Indicators ──
  { id: "getPortfolioKpis", method: "get", path: "/api/kpis/portfolio", tag: "Indicators", summary: "Portfolio indicators", description: "Calculated on every request from the stored data: NOI, gross yield, cap rate (as fractions) and IRR per property, with totals weighted by ownership share.", access: "session", query: portfolioQuerySchema, response: ok("Totals and one row per property", portfolioKpisSchema) },
  { id: "getPropertyKpis", method: "get", path: "/api/kpis/properties/:id", tag: "Indicators", summary: "Indicators of one property", access: "session", params: propertyKpisParamSchema, query: propertyKpisQuerySchema, response: ok("The property's indicators", propertyKpisSchema) },

  // ── Feedback ──
  { id: "listMyFeedback", method: "get", path: "/api/feedback", tag: "Feedback", summary: "What I sent", access: "session", query: listFeedbackQuerySchema, response: ok("A page of my feedback", feedbackPageSchema) },
  { id: "sendFeedback", method: "post", path: "/api/feedback", tag: "Feedback", summary: "Send feedback to the platform operator", access: "session", body: createFeedback, response: created("The new feedback", feedbackSchema) },

  // ── Audit log ──
  { id: "listAuditLogs", method: "get", path: "/api/audit-logs", tag: "Audit log", summary: "The audit trail of the organization", description: "Owners and admins only. The organization comes from the session. Newest first.", access: "owner-admin", query: listAuditLogsQuerySchema, response: ok("A page of audit entries", auditLogPageSchema) },

  // ── Platform admin ──
  { id: "adminListFeedback", method: "get", path: "/api/admin/feedback", tag: "Platform admin", summary: "Every feedback of every organization", access: "platform-admin", query: listFeedbackQuerySchema, response: ok("A page of feedback with author and organization", adminFeedbackPageSchema) },
  { id: "adminSetFeedbackStatus", method: "patch", path: "/api/admin/feedback/:id", tag: "Platform admin", summary: "Open or resolve a feedback", access: "platform-admin", params: feedbackIdParamSchema, body: updateFeedback, response: ok("The updated feedback", adminFeedbackSchema) },
  { id: "adminListAuditLogs", method: "get", path: "/api/admin/audit-logs", tag: "Platform admin", summary: "The whole audit trail", description: "Optionally narrowed to one organization.", access: "platform-admin", query: listAdminAuditLogsQuerySchema, response: ok("A page of audit entries", auditLogPageSchema) },
];

export const TAGS: ReadonlyArray<{ name: string; description: string }> = [
  { name: "Health", description: "Is the service up" },
  { name: "Session", description: "The signed-in user and the organization they work in. Sign-in, sign-up, guest mode, invitations and the admin plugin live under `/api/auth` (Better Auth)." },
  { name: "Reference data", description: "Cities, property types and transaction categories for the forms" },
  { name: "Clients", description: "The people or companies that own properties" },
  { name: "Agencies", description: "The agencies that manage properties" },
  { name: "Properties", description: "The portfolio" },
  { name: "Proposals", description: "Offers received or made on a property" },
  { name: "Photos", description: "Property photos" },
  { name: "Documents", description: "Property documents" },
  { name: "Contracts", description: "Rental and short-stay contracts, and their PDF" },
  { name: "Contract template", description: "The contract text of the organization" },
  { name: "Occupants", description: "Tenants and guests" },
  { name: "Reservations", description: "Short-stay bookings" },
  { name: "Transactions", description: "Revenues and expenses that are not rent" },
  { name: "Indicators", description: "NOI, yield, cap rate and IRR" },
  { name: "Feedback", description: "Messages to the platform operator" },
  { name: "Audit log", description: "Who did what" },
  { name: "Platform admin", description: "The owner panel" },
];
